import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { z } from 'zod';
import { newSecret, sha256Hex } from '../common/secrets.js';
import type { TypedConfigService } from '../config/env.js';
import { TenantDb, type Db } from '../database/index.js';
import type { EventEnvelope, EventHandler } from '../events/event.types.js';
import { TOKEN_TTL } from '../identity/identity.service.js';
import { EmailSender, type EmailMessage } from './email-sender.js';
import { templates } from './email-templates.js';

const payloadSchema = z.object({ userId: z.uuid() });

type TokenPurpose = keyof typeof TOKEN_TTL;

/**
 * Sends one kind of identity email for an outbox event (Phase 3 plan §2.6).
 *
 * Exactly-once as far as we can make it:
 *  1. In one transaction: skip if this event was already SENT; otherwise mint a
 *     fresh token (older unused ones of the same purpose are retired), and mark
 *     the delivery PENDING. Only the token's hash is stored.
 *  2. Send the email (outside any transaction).
 *  3. Mark the delivery SENT.
 * A crash between 2 and 3 can resend once (with a new token); it never loses one.
 */
abstract class IdentityEmailHandler implements EventHandler {
  abstract readonly type: string;
  protected abstract readonly tokenPurpose: TokenPurpose | undefined;
  protected readonly logger = new Logger(this.constructor.name);
  protected readonly baseUrl: string;

  constructor(
    protected readonly db: TenantDb,
    protected readonly sender: EmailSender,
    config: TypedConfigService,
  ) {
    this.baseUrl = config.get('APP_PUBLIC_URL', { infer: true }).replace(/\/$/, '');
  }

  protected abstract compose(email: string, token: string | undefined): EmailMessage;

  async handle(envelope: EventEnvelope): Promise<void> {
    const { userId } = payloadSchema.parse(envelope.payload);
    const prepared = await this.db.run({ kind: 'system', job: 'identity.email' }, async (tx) =>
      this.prepare(tx, envelope, userId),
    );
    if (prepared === undefined) {
      return;
    }
    await this.sender.send(this.compose(prepared.email, prepared.token));
    await this.db.run({ kind: 'system', job: 'identity.email' }, async (tx) =>
      tx.notificationDelivery.update({
        where: { eventId: envelope.eventId },
        data: { status: 'SENT', sentAt: new Date() },
      }),
    );
    this.logger.log(`${this.type} delivered (${envelope.eventId})`);
  }

  private async prepare(tx: Db, envelope: EventEnvelope, userId: string) {
    const delivery = await tx.notificationDelivery.findUnique({
      where: { eventId: envelope.eventId },
      select: { status: true },
    });
    if (delivery?.status === 'SENT') {
      return undefined;
    }
    const user = await tx.appUser.findUnique({
      where: { id: userId },
      select: { email: true, status: true },
    });
    if (user === null || user.status === 'DEACTIVATED') {
      return undefined;
    }
    if (this.tokenPurpose === 'EMAIL_VERIFICATION' && user.status !== 'PENDING_VERIFICATION') {
      return undefined; // Already verified: nothing to confirm.
    }

    let token: string | undefined;
    if (this.tokenPurpose !== undefined) {
      const now = new Date();
      await tx.userToken.updateMany({
        where: { userId, purpose: this.tokenPurpose, consumedAt: null },
        data: { consumedAt: now },
      });
      token = newSecret();
      await tx.userToken.create({
        data: {
          userId,
          purpose: this.tokenPurpose,
          tokenHash: sha256Hex(token),
          expiresAt: new Date(now.getTime() + TOKEN_TTL[this.tokenPurpose]),
        },
        select: { id: true },
      });
    }
    await tx.notificationDelivery.upsert({
      where: { eventId: envelope.eventId },
      create: { eventId: envelope.eventId, kind: this.type, userId },
      update: {},
    });
    return { email: user.email, token };
  }
}

@Injectable()
export class EmailVerificationHandler extends IdentityEmailHandler {
  readonly type = 'identity.email_verification_requested';
  protected readonly tokenPurpose = 'EMAIL_VERIFICATION';

  constructor(
    db: TenantDb,
    sender: EmailSender,
    @Inject(ConfigService) config: TypedConfigService,
  ) {
    super(db, sender, config);
  }

  protected compose(email: string, token: string | undefined): EmailMessage {
    return templates.emailVerification(email, `${this.baseUrl}/verify-email#token=${token ?? ''}`);
  }
}

@Injectable()
export class PasswordResetHandler extends IdentityEmailHandler {
  readonly type = 'identity.password_reset_requested';
  protected readonly tokenPurpose = 'PASSWORD_RESET';

  constructor(
    db: TenantDb,
    sender: EmailSender,
    @Inject(ConfigService) config: TypedConfigService,
  ) {
    super(db, sender, config);
  }

  protected compose(email: string, token: string | undefined): EmailMessage {
    return templates.passwordReset(email, `${this.baseUrl}/reset-password#token=${token ?? ''}`);
  }
}

@Injectable()
export class AccountExistsHandler extends IdentityEmailHandler {
  readonly type = 'identity.account_exists_notice';
  protected readonly tokenPurpose = undefined;

  constructor(
    db: TenantDb,
    sender: EmailSender,
    @Inject(ConfigService) config: TypedConfigService,
  ) {
    super(db, sender, config);
  }

  protected compose(email: string): EmailMessage {
    return templates.accountExists(
      email,
      `${this.baseUrl}/sign-in`,
      `${this.baseUrl}/forgot-password`,
    );
  }
}

@Injectable()
export class AccountLockedHandler extends IdentityEmailHandler {
  readonly type = 'identity.account_locked';
  protected readonly tokenPurpose = undefined;

  constructor(
    db: TenantDb,
    sender: EmailSender,
    @Inject(ConfigService) config: TypedConfigService,
  ) {
    super(db, sender, config);
  }

  protected compose(email: string): EmailMessage {
    return templates.accountLocked(email, `${this.baseUrl}/forgot-password`);
  }
}

export const IDENTITY_EMAIL_HANDLERS = [
  EmailVerificationHandler,
  PasswordResetHandler,
  AccountExistsHandler,
  AccountLockedHandler,
] as const;
