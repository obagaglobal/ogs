import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuditService } from '../../audit/audit.service.js';
import type { TypedConfigService } from '../../config/env.js';
import {
  MembershipStatus,
  TenantDb,
  TenantKind,
  TenantStatus,
  type Db,
  type DbContext,
} from '../../database/index.js';
import type { AuthEventKind, RequestMeta } from '../identity.service.js';
import { OutboxService } from '../../events/outbox.service.js';
import { RateLimiter } from '../rate-limiter.js';
import { hashRecoveryCode, newRecoveryCodes } from './recovery-codes.js';
import { SecretBox } from './secret-box.js';
import { newTotpSecret, otpauthUri, verifyTotp } from './totp.js';

/** Roles whose holders must use MFA (review §11: org admins, finance, platform staff). */
export const MFA_REQUIRED_ROLE_CODES: ReadonlySet<string> = new Set([
  'org_admin',
  'provider_admin',
]);

export class MfaCodeInvalidError extends Error {
  override readonly name = 'MfaCodeInvalidError';
}
export class MfaStateError extends Error {
  override readonly name = 'MfaStateError';
  constructor(
    readonly code:
      'mfa_already_enabled' | 'mfa_not_enabled' | 'mfa_setup_missing' | 'mfa_required_by_role',
  ) {
    super(code);
  }
}

export interface MfaStatus {
  readonly enrolled: boolean;
  readonly required: boolean;
  readonly recoveryCodesRemaining: number;
}

export type MfaProof = { readonly code: string } | { readonly recoveryCode: string };

function isConfirmed<T extends { confirmedAt: Date | null }>(
  factor: T | null,
): factor is T & { confirmedAt: Date } {
  return factor !== null && factor.confirmedAt !== null;
}

const job = (name: string): DbContext => ({ kind: 'system', job: `identity.${name}` });

/**
 * TOTP second factor (Phase 3 plan §3.1, decision P3-5): enrolment, sign-in
 * verification, step-up, recovery codes. Secrets are sealed with SecretBox and
 * live only in identity-job-only tables.
 */
@Injectable()
export class MfaService {
  private readonly box: SecretBox;

  constructor(
    private readonly db: TenantDb,
    private readonly limiter: RateLimiter,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    @Inject(ConfigService) config: TypedConfigService,
  ) {
    this.box = new SecretBox(config.get('MFA_ENCRYPTION_KEYS', { infer: true }));
  }

  /**
   * MFA is mandatory for anyone with an ACTIVE membership in the PLATFORM
   * tenant (all OGS staff, including finance) or holding an admin role.
   */
  async isRequired(userId: string): Promise<boolean> {
    const count = await this.db.run({ kind: 'user', userId }, async (tx) =>
      tx.membership.count({
        where: {
          userId,
          status: MembershipStatus.ACTIVE,
          // P4-1: only ACTIVE tenants. An applicant admin of a pending organisation
          // (which can do nothing operational) enrols when it is approved.
          tenant: { deletedAt: null, status: TenantStatus.ACTIVE },
          OR: [
            { tenant: { kind: TenantKind.PLATFORM } },
            { roles: { some: { role: { code: { in: [...MFA_REQUIRED_ROLE_CODES] } } } } },
          ],
        },
      }),
    );
    return count > 0;
  }

  async status(userId: string): Promise<MfaStatus> {
    const [enrolled, remaining] = await this.db.run(job('mfa_status'), async (tx) => {
      const factor = await tx.mfaFactor.findUnique({
        where: { userId },
        select: { confirmedAt: true },
      });
      const codes = await tx.recoveryCode.count({ where: { userId, usedAt: null } });
      return [isConfirmed(factor), codes] as const;
    });
    return { enrolled, required: await this.isRequired(userId), recoveryCodesRemaining: remaining };
  }

  /** Starts (or restarts) enrolment. The secret is shown once, for the authenticator app. */
  async startSetup(userId: string, email: string): Promise<{ secret: string; otpauthUri: string }> {
    const secret = newTotpSecret();
    await this.db.run(job('mfa_setup'), async (tx) => {
      const existing = await tx.mfaFactor.findUnique({
        where: { userId },
        select: { confirmedAt: true },
      });
      if (isConfirmed(existing)) {
        throw new MfaStateError('mfa_already_enabled');
      }
      const sealed = this.box.seal(secret);
      await tx.mfaFactor.upsert({
        where: { userId },
        create: { userId, secretSealed: sealed.sealed, keyId: sealed.keyId },
        update: {
          secretSealed: sealed.sealed,
          keyId: sealed.keyId,
          lastUsedStep: 0n,
          createdAt: new Date(),
        },
        select: { userId: true },
      });
    });
    const uri = otpauthUri(secret, email);
    return { secret: new URL(uri).searchParams.get('secret') ?? '', otpauthUri: uri };
  }

  /** Confirms enrolment with a first code. Returns the recovery codes (shown once). */
  async confirmSetup(userId: string, code: string, meta: RequestMeta): Promise<string[]> {
    await this.limiter.consume('mfaPerAccount', userId);
    return this.db.run(job('mfa_confirm'), async (tx) => {
      const factor = await tx.mfaFactor.findUnique({ where: { userId } });
      if (factor === null) {
        throw new MfaStateError('mfa_setup_missing');
      }
      if (factor.confirmedAt !== null) {
        throw new MfaStateError('mfa_already_enabled');
      }
      const step = this.check(factor, code);
      if (step === undefined) {
        await this.event(tx, 'MFA_FAILED', userId, meta, 'setup');
        throw new MfaCodeInvalidError();
      }
      await tx.mfaFactor.update({
        where: { userId },
        data: { confirmedAt: new Date(), lastUsedStep: BigInt(step) },
        select: { userId: true },
      });
      await tx.appUser.update({
        where: { id: userId },
        data: { mfaEnabled: true },
        select: { id: true },
      });
      const codes = await this.replaceRecoveryCodes(tx, userId);
      await this.event(tx, 'MFA_ENABLED', userId, meta);
      await this.outbox.publish(tx, {
        type: 'identity.security_notice',
        payload: { userId: userId, notice: 'mfa_enabled' },
      });
      await this.audit.record(tx, {
        action: 'identity.mfa_enabled',
        entityType: 'user',
        entityId: userId,
        request: meta,
      });
      return codes;
    });
  }

  /** Checks a TOTP code or a recovery code (sign-in second step and step-up). */
  async verify(
    userId: string,
    proof: MfaProof,
    meta: RequestMeta,
  ): Promise<'totp' | 'recovery_code'> {
    await this.limiter.consume('mfaPerAccount', userId);
    const result = await this.db.run(job('mfa_verify'), async (tx) => {
      if ('recoveryCode' in proof) {
        const used = await tx.recoveryCode.updateMany({
          where: { userId, codeHash: hashRecoveryCode(proof.recoveryCode), usedAt: null },
          data: { usedAt: new Date() },
        });
        if (used.count === 1) {
          await this.event(tx, 'RECOVERY_CODE_USED', userId, meta);
          return 'recovery_code' as const;
        }
      } else {
        const factor = await tx.mfaFactor.findUnique({ where: { userId } });
        if (!isConfirmed(factor)) {
          throw new MfaStateError('mfa_not_enabled');
        }
        const step = this.check(factor, proof.code);
        if (step !== undefined) {
          // Conditional update: two concurrent uses of one code cannot both win.
          const claimed = await tx.mfaFactor.updateMany({
            where: { userId, lastUsedStep: { lt: BigInt(step) } },
            data: { lastUsedStep: BigInt(step) },
          });
          if (claimed.count === 1) {
            await this.event(tx, 'MFA_VERIFIED', userId, meta);
            return 'totp' as const;
          }
        }
      }
      await this.event(tx, 'MFA_FAILED', userId, meta);
      return undefined;
    });
    if (result === undefined) {
      throw new MfaCodeInvalidError();
    }
    return result;
  }

  async regenerateRecoveryCodes(userId: string, meta: RequestMeta): Promise<string[]> {
    return this.db.run(job('mfa_recovery_codes'), async (tx) => {
      const factor = await tx.mfaFactor.findUnique({
        where: { userId },
        select: { confirmedAt: true },
      });
      if (!isConfirmed(factor)) {
        throw new MfaStateError('mfa_not_enabled');
      }
      const codes = await this.replaceRecoveryCodes(tx, userId);
      await this.event(tx, 'RECOVERY_CODES_REGENERATED', userId, meta);
      await this.outbox.publish(tx, {
        type: 'identity.security_notice',
        payload: { userId: userId, notice: 'recovery_codes_regenerated' },
      });
      await this.audit.record(tx, {
        action: 'identity.mfa_recovery_codes_regenerated',
        entityType: 'user',
        entityId: userId,
        request: meta,
      });
      return codes;
    });
  }

  /** Removes the factor. Refused while a role or platform membership requires MFA. */
  async disable(userId: string, meta: RequestMeta): Promise<void> {
    if (await this.isRequired(userId)) {
      throw new MfaStateError('mfa_required_by_role');
    }
    await this.db.run(job('mfa_disable'), async (tx) => {
      const removed = await tx.mfaFactor.deleteMany({ where: { userId } });
      if (removed.count === 0) {
        throw new MfaStateError('mfa_not_enabled');
      }
      await tx.recoveryCode.deleteMany({ where: { userId } });
      await tx.appUser.update({
        where: { id: userId },
        data: { mfaEnabled: false },
        select: { id: true },
      });
      await this.event(tx, 'MFA_DISABLED', userId, meta);
      await this.outbox.publish(tx, {
        type: 'identity.security_notice',
        payload: { userId: userId, notice: 'mfa_disabled' },
      });
      await this.audit.record(tx, {
        action: 'identity.mfa_disabled',
        entityType: 'user',
        entityId: userId,
        request: meta,
      });
    });
  }

  private check(
    factor: { secretSealed: string; keyId: string; lastUsedStep: bigint },
    code: string,
  ): number | undefined {
    const secret = this.box.open({ sealed: factor.secretSealed, keyId: factor.keyId });
    return verifyTotp(secret, code, Math.floor(Date.now() / 1000), Number(factor.lastUsedStep));
  }

  private async replaceRecoveryCodes(tx: Db, userId: string): Promise<string[]> {
    const codes = newRecoveryCodes();
    await tx.recoveryCode.deleteMany({ where: { userId } });
    await tx.recoveryCode.createMany({
      data: codes.map((code) => ({ userId, codeHash: hashRecoveryCode(code) })),
    });
    return codes;
  }

  private async event(
    tx: Db,
    kind: AuthEventKind,
    userId: string,
    meta: RequestMeta,
    reason?: string,
  ) {
    await tx.authenticationEvent.createMany({
      data: [
        {
          kind,
          userId,
          reason: reason ?? null,
          ip: meta.ip,
          userAgent: meta.userAgent,
          requestId: meta.requestId,
        },
      ],
    });
  }
}
