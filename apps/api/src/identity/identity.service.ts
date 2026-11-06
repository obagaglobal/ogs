import { Injectable, Logger } from '@nestjs/common';
import { sha256Hex } from '../common/secrets.js';
import { AuditService } from '../audit/audit.service.js';
import { Prisma, TenantDb, UserStatus, type Db, type DbContext } from '../database/index.js';
import { OutboxService } from '../events/outbox.service.js';
import { SessionStore } from '../sessions/session.store.js';
import { PasswordHasher } from './password-hasher.js';
import { PasswordPolicy, type PasswordRejection } from './password-policy.js';
import { RateLimiter } from './rate-limiter.js';

export interface RequestMeta {
  readonly ip: string | null;
  readonly userAgent: string | null;
  readonly requestId: string;
}

/** Thrown for a new password that fails the server-side policy. Safe to show. */
export class WeakPasswordError extends Error {
  override readonly name = 'WeakPasswordError';
  constructor(readonly reason: PasswordRejection) {
    super(reason);
  }
}

/** Unknown, expired or already-used email token. Deliberately vague. */
export class InvalidTokenError extends Error {
  override readonly name = 'InvalidTokenError';
}

/** Any sign-in failure. Never says which part was wrong (ASVS 2.2: no enumeration). */
export class InvalidCredentialsError extends Error {
  override readonly name = 'InvalidCredentialsError';
}

export type AuthEventKind = Prisma.AuthenticationEventCreateManyInput['kind'];

/** Lockout policy (Phase 3 plan §2.3). */
export const LOCKOUT = {
  /** From this many consecutive failures, each further failure locks for 2^(n-5) s (max 60 s). */
  softAfter: 5,
  /** At this many, the account locks for hardMinutes and the owner is emailed. */
  hardAfter: 10,
  hardMinutes: 15,
} as const;

const EMAIL_VERIFICATION_TTL_MS = 24 * 60 * 60 * 1000;
const PASSWORD_RESET_TTL_MS = 30 * 60 * 1000;
export const TOKEN_TTL = {
  EMAIL_VERIFICATION: EMAIL_VERIFICATION_TTL_MS,
  PASSWORD_RESET: PASSWORD_RESET_TTL_MS,
} as const;

/** Identity jobs: the only contexts RLS lets touch credentials and tokens. */
const job = (name: string): DbContext => ({ kind: 'system', job: `identity.${name}` });

/**
 * Accounts and passwords (Phase 3 plan §2.1, §2.3). Sessions are created by the
 * controller after `login` succeeds. Emails are never sent from here: this
 * service publishes outbox events and the worker sends the mail.
 */
@Injectable()
export class IdentityService {
  private readonly logger = new Logger(IdentityService.name);
  private dummyHash: Promise<string> | undefined;

  constructor(
    private readonly db: TenantDb,
    private readonly hasher: PasswordHasher,
    private readonly policy: PasswordPolicy,
    private readonly limiter: RateLimiter,
    private readonly outbox: OutboxService,
    private readonly audit: AuditService,
    private readonly sessions: SessionStore,
  ) {}

  /**
   * Always resolves the same way whether or not the email is registered; the
   * owner of an existing address gets a "you already have an account" email.
   */
  async register(email: string, password: string, meta: RequestMeta): Promise<void> {
    await this.limiter.consume('registerPerIp', meta.ip ?? 'unknown');
    this.assertAcceptable(password, email);
    const passwordHash = await this.hasher.hash(password);

    try {
      await this.db.run(job('register'), async (tx) => {
        const existing = await tx.appUser.findUnique({ where: { email }, select: { id: true } });
        if (existing !== null) {
          await this.event(tx, 'REGISTER_EXISTING_EMAIL', meta, { userId: existing.id });
          await this.outbox.publish(tx, {
            type: 'identity.account_exists_notice',
            payload: { userId: existing.id },
          });
          return;
        }
        const user = await tx.appUser.create({
          data: { email, status: UserStatus.PENDING_VERIFICATION },
          select: { id: true },
        });
        await tx.credential.create({ data: { userId: user.id, passwordHash } });
        await this.event(tx, 'REGISTERED', meta, { userId: user.id });
        await this.outbox.publish(tx, {
          type: 'identity.email_verification_requested',
          payload: { userId: user.id },
        });
      });
    } catch (error) {
      // Two registrations for the same email raced: the loser behaves like "exists".
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        return;
      }
      throw error;
    }
  }

  async verifyEmail(token: string, meta: RequestMeta): Promise<void> {
    await this.limiter.consume('tokenPerIp', meta.ip ?? 'unknown');
    await this.db.run(job('verify_email'), async (tx) => {
      const userId = await this.consumeToken(tx, token, 'EMAIL_VERIFICATION');
      await tx.appUser.updateMany({
        where: { id: userId, status: UserStatus.PENDING_VERIFICATION },
        data: { status: UserStatus.ACTIVE },
      });
      await this.event(tx, 'EMAIL_VERIFIED', meta, { userId });
    });
  }

  async resendVerification(userId: string, meta: RequestMeta): Promise<void> {
    await this.limiter.consume('resendPerAccount', userId);
    await this.db.run(job('resend_verification'), async (tx) => {
      const user = await tx.appUser.findUnique({ where: { id: userId }, select: { status: true } });
      if (user?.status !== UserStatus.PENDING_VERIFICATION) {
        return;
      }
      await this.outbox.publish(tx, {
        type: 'identity.email_verification_requested',
        payload: { userId },
      });
      this.logger.debug(`Verification email re-requested (${meta.requestId})`);
    });
  }

  /**
   * Checks email + password. Returns the user id on success. Every failure path
   * does the same Argon2 work and throws the same error (no enumeration by
   * status, body or timing).
   */
  async login(
    email: string,
    password: string,
    meta: RequestMeta,
  ): Promise<{ userId: string; mfaEnabled: boolean }> {
    await this.limiter.consume('loginPerIp', meta.ip ?? 'unknown');
    await this.limiter.consume('loginPerAccount', email);

    const account = await this.db.run(job('login'), async (tx) =>
      tx.appUser.findUnique({
        where: { email },
        select: {
          id: true,
          status: true,
          mfaEnabled: true,
          credential: { select: { passwordHash: true, lockedUntil: true } },
        },
      }),
    );

    const credential = account?.credential ?? null;
    const usable =
      credential !== null &&
      (account?.status === UserStatus.ACTIVE ||
        account?.status === UserStatus.PENDING_VERIFICATION);
    const lockedUntil = credential?.lockedUntil ?? null;
    const locked = lockedUntil !== null && lockedUntil > new Date();
    // Unknown or disabled accounts are checked against a dummy hash: same work, same timing.
    const hash = usable ? credential.passwordHash : await this.dummy();
    const passwordOk = await this.hasher.verify(hash, password);

    if (account === null || !usable) {
      await this.db.run(job('login'), async (tx) =>
        this.event(tx, 'LOGIN_FAILED', meta, {
          userId: account?.id ?? null,
          email,
          reason: account === null ? 'unknown_account' : 'account_disabled',
        }),
      );
      throw new InvalidCredentialsError();
    }
    const userId = account.id;

    if (locked) {
      await this.db.run(job('login'), async (tx) =>
        this.event(tx, 'LOGIN_FAILED', meta, { userId, reason: 'locked' }),
      );
      throw new InvalidCredentialsError();
    }

    if (!passwordOk) {
      await this.recordFailure(userId, meta);
      throw new InvalidCredentialsError();
    }

    const upgrade = this.hasher.needsRehash(hash) ? await this.hasher.hash(password) : undefined;
    await this.db.run(job('login'), async (tx) => {
      await tx.credential.update({
        where: { userId },
        data: {
          failedAttempts: 0,
          lockedUntil: null,
          ...(upgrade === undefined ? {} : { passwordHash: upgrade }),
        },
      });
      await this.event(tx, 'LOGIN_SUCCEEDED', meta, { userId });
    });
    return { userId, mfaEnabled: account.mfaEnabled };
  }

  /** Always succeeds from the caller's point of view (no enumeration). */
  async forgotPassword(email: string, meta: RequestMeta): Promise<void> {
    await this.limiter.consume('forgotPerIp', meta.ip ?? 'unknown');
    try {
      await this.limiter.consume('forgotPerAccount', email);
    } catch {
      return; // Silently drop: answering differently would reveal the account exists.
    }
    await this.db.run(job('password_reset'), async (tx) => {
      const user = await tx.appUser.findUnique({
        where: { email },
        select: { id: true, status: true },
      });
      if (user === null || user.status === UserStatus.DEACTIVATED) {
        await this.event(tx, 'PASSWORD_RESET_REQUESTED', meta, {
          email,
          reason: 'unknown_account',
        });
        return;
      }
      await this.event(tx, 'PASSWORD_RESET_REQUESTED', meta, { userId: user.id });
      await this.outbox.publish(tx, {
        type: 'identity.password_reset_requested',
        payload: { userId: user.id },
      });
    });
  }

  /** Sets a new password from an emailed token and signs the user out everywhere. */
  async resetPassword(token: string, password: string, meta: RequestMeta): Promise<void> {
    await this.limiter.consume('tokenPerIp', meta.ip ?? 'unknown');
    const userId = await this.db.run(job('password_reset'), async (tx) => {
      const id = await this.consumeToken(tx, token, 'PASSWORD_RESET');
      const user = await tx.appUser.findUnique({ where: { id }, select: { email: true } });
      if (user === null) {
        throw new InvalidTokenError();
      }
      this.assertAcceptable(password, user.email);
      const passwordHash = await this.hasher.hash(password);
      await tx.credential.update({
        where: { userId: id },
        data: { passwordHash, passwordChangedAt: new Date(), failedAttempts: 0, lockedUntil: null },
      });
      // Receiving the email proves ownership of the address.
      await tx.appUser.updateMany({
        where: { id, status: UserStatus.PENDING_VERIFICATION },
        data: { status: UserStatus.ACTIVE },
      });
      await this.event(tx, 'PASSWORD_RESET_COMPLETED', meta, { userId: id });
      await this.outbox.publish(tx, {
        type: 'identity.security_notice',
        payload: { userId: id, notice: 'password_reset' },
      });
      await this.audit.record(tx, {
        action: 'identity.password_reset',
        entityType: 'user',
        entityId: id,
        request: meta,
      });
      return id;
    });
    await this.sessions.revokeAll(userId);
  }

  /** Changes the password of a signed-in user; every other session is signed out. */
  async changePassword(
    userId: string,
    currentPassword: string,
    newPassword: string,
    currentSessionToken: string,
    meta: RequestMeta,
  ): Promise<void> {
    await this.limiter.consume('loginPerAccount', userId);
    const account = await this.db.run(job('change_password'), async (tx) =>
      tx.appUser.findUnique({
        where: { id: userId },
        select: { email: true, credential: { select: { passwordHash: true } } },
      }),
    );
    const credential = account?.credential ?? null;
    if (account === null || credential === null) {
      throw new InvalidCredentialsError();
    }
    if (!(await this.hasher.verify(credential.passwordHash, currentPassword))) {
      await this.recordFailure(userId, meta);
      throw new InvalidCredentialsError();
    }
    this.assertAcceptable(newPassword, account.email);
    const passwordHash = await this.hasher.hash(newPassword);
    await this.db.run(job('change_password'), async (tx) => {
      await tx.credential.update({
        where: { userId },
        data: { passwordHash, passwordChangedAt: new Date(), failedAttempts: 0, lockedUntil: null },
      });
      await this.event(tx, 'PASSWORD_CHANGED', meta, { userId });
      await this.outbox.publish(tx, {
        type: 'identity.security_notice',
        payload: { userId: userId, notice: 'password_changed' },
      });
      await this.audit.record(tx, {
        action: 'identity.password_changed',
        entityType: 'user',
        entityId: userId,
        request: meta,
      });
    });
    await this.sessions.revokeAll(userId, currentSessionToken);
  }

  async profileOf(userId: string): Promise<{ status: UserStatus; mfaEnabled: boolean }> {
    const user = await this.db.run({ kind: 'user', userId }, async (tx) =>
      tx.appUser.findUnique({ where: { id: userId }, select: { status: true, mfaEnabled: true } }),
    );
    if (user === null) {
      throw new InvalidCredentialsError();
    }
    return user;
  }

  async recordLogout(userId: string, meta: RequestMeta): Promise<void> {
    await this.db.run(job('logout'), async (tx) => this.event(tx, 'LOGOUT', meta, { userId }));
  }

  async recordSessionRevoked(userId: string, meta: RequestMeta, reason: string): Promise<void> {
    await this.db.run(job('session_revoked'), async (tx) =>
      this.event(tx, 'SESSION_REVOKED', meta, { userId, reason }),
    );
  }

  // ---------------------------------------------------------------------------

  private assertAcceptable(password: string, email: string): void {
    const rejection = this.policy.check(password, email);
    if (rejection !== undefined) {
      throw new WeakPasswordError(rejection);
    }
  }

  /** Marks a token used (exactly once, even under races) and returns its user. */
  private async consumeToken(
    tx: Db,
    token: string,
    purpose: 'EMAIL_VERIFICATION' | 'PASSWORD_RESET',
  ): Promise<string> {
    const row = await tx.userToken.findUnique({
      where: { tokenHash: sha256Hex(token) },
      select: { id: true, userId: true, purpose: true, expiresAt: true, consumedAt: true },
    });
    if (row === null) {
      throw new InvalidTokenError();
    }
    if (row.purpose !== purpose || row.consumedAt !== null || row.expiresAt <= new Date()) {
      throw new InvalidTokenError();
    }
    const consumed = await tx.userToken.updateMany({
      where: { id: row.id, consumedAt: null },
      data: { consumedAt: new Date() },
    });
    if (consumed.count !== 1) {
      throw new InvalidTokenError();
    }
    return row.userId;
  }

  /** Atomic counter update: concurrent failures cannot skip the lockout. */
  private async recordFailure(userId: string, meta: RequestMeta): Promise<void> {
    await this.db.run(job('login'), async (tx) => {
      const [row] = await tx.$queryRaw<{ hard_locked: boolean }[]>`
        UPDATE credential SET
          failed_attempts = CASE WHEN failed_attempts + 1 >= ${LOCKOUT.hardAfter} THEN 0
                                 ELSE failed_attempts + 1 END,
          locked_until = CASE
            WHEN failed_attempts + 1 >= ${LOCKOUT.hardAfter}
              THEN now() + make_interval(mins => ${LOCKOUT.hardMinutes})
            WHEN failed_attempts + 1 >= ${LOCKOUT.softAfter}
              THEN now() + make_interval(secs => least(power(2, failed_attempts + 1 - ${LOCKOUT.softAfter}), 60))
            ELSE locked_until END,
          updated_at = now()
        WHERE user_id = ${userId}::uuid
        RETURNING (failed_attempts = 0) AS hard_locked`;
      await this.event(tx, 'LOGIN_FAILED', meta, { userId, reason: 'bad_password' });
      if (row?.hard_locked === true) {
        await this.event(tx, 'ACCOUNT_LOCKED', meta, { userId });
        await this.outbox.publish(tx, { type: 'identity.account_locked', payload: { userId } });
        await this.audit.record(tx, {
          action: 'identity.account_locked',
          entityType: 'user',
          entityId: userId,
          request: meta,
        });
      }
    });
  }

  private async event(
    tx: Db,
    kind: AuthEventKind,
    meta: RequestMeta,
    details: { userId?: string | null; email?: string; reason?: string },
  ): Promise<void> {
    await tx.authenticationEvent.createMany({
      data: [
        {
          kind,
          userId: details.userId ?? null,
          emailHash: details.email === undefined ? null : sha256Hex(details.email),
          reason: details.reason ?? null,
          ip: meta.ip,
          userAgent: meta.userAgent?.slice(0, 500) ?? null,
          requestId: meta.requestId,
        },
      ],
    });
  }

  private async dummy(): Promise<string> {
    this.dummyHash ??= this.hasher.hash('dummy-password-for-constant-time-checks');
    return this.dummyHash;
  }
}
