import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { z } from 'zod';
import { newSecret, sha256Hex } from '../common/secrets.js';
import type { TypedConfigService } from '../config/env.js';
import { MembershipStatus, TenantDb, type Db } from '../database/index.js';
import type { EventEnvelope, EventHandler } from '../events/event.types.js';
import { deliverOnce } from './deliver-once.js';
import { EmailSender, type EmailMessage } from './email-sender.js';
import { templates } from './email-templates.js';

const ADMIN_ROLE_CODES = ['org_admin', 'provider_admin'];

function baseUrl(config: TypedConfigService): string {
  return config.get('APP_PUBLIC_URL', { infer: true }).replace(/\/$/, '');
}

function tenantOfEnvelope(envelope: EventEnvelope): string {
  if (envelope.tenantId === null) {
    throw new Error(`${envelope.type} without tenant`);
  }
  return envelope.tenantId;
}

/** Emails of the tenant's ACTIVE admins (decision and status notices go to them). */
async function adminEmails(tx: Db, tenantId: string): Promise<string[]> {
  const members = await tx.membership.findMany({
    where: {
      tenantId,
      status: MembershipStatus.ACTIVE,
      roles: { some: { role: { code: { in: ADMIN_ROLE_CODES }, tenantId: null } } },
    },
    select: { user: { select: { email: true } } },
  });
  return members.map((member) => member.user.email);
}

/** Mints the invitation token (only its hash is stored) and emails the link. */
@Injectable()
export class InvitationEmailHandler implements EventHandler {
  readonly type = 'invitations.created';
  private readonly logger = new Logger(InvitationEmailHandler.name);
  private readonly base: string;

  constructor(
    private readonly db: TenantDb,
    private readonly sender: EmailSender,
    @Inject(ConfigService) config: TypedConfigService,
  ) {
    this.base = baseUrl(config);
  }

  async handle(envelope: EventEnvelope): Promise<void> {
    const { invitationId } = z.object({ invitationId: z.uuid() }).parse(envelope.payload);
    const tenantId = tenantOfEnvelope(envelope);
    const sent = await deliverOnce(
      this.db,
      { kind: 'system', job: 'invitations.email', tenantId },
      envelope,
      this.sender,
      async (tx): Promise<EmailMessage[]> => {
        const invitation = await tx.invitation.findFirst({
          where: { id: invitationId, status: 'PENDING', expiresAt: { gt: new Date() } },
          select: { email: true, tenant: { select: { name: true } } },
        });
        if (invitation === null) {
          return []; // revoked or expired before we got to it
        }
        const token = newSecret();
        await tx.invitation.update({
          where: { id: invitationId },
          data: { tokenHash: sha256Hex(token) },
          select: { id: true },
        });
        const fragment = new URLSearchParams({ token, email: invitation.email }).toString();
        return [
          templates.invitation(
            invitation.email,
            invitation.tenant.name,
            `${this.base}/invitations/accept#${fragment}`,
          ),
        ];
      },
    );
    this.logger.log(`invitation ${invitationId}: ${String(sent)} email(s)`);
  }
}

/** Approved / rejected / changes requested → the organisation's admins. */
@Injectable()
export class ApplicationDecisionHandler implements EventHandler {
  readonly type = 'organisations.application_decided';
  private readonly base: string;

  constructor(
    private readonly db: TenantDb,
    private readonly sender: EmailSender,
    @Inject(ConfigService) config: TypedConfigService,
  ) {
    this.base = baseUrl(config);
  }

  async handle(envelope: EventEnvelope): Promise<void> {
    const payload = z
      .object({
        applicationId: z.uuid(),
        decision: z.enum(['APPROVED', 'REJECTED', 'CHANGES_REQUESTED']),
      })
      .parse(envelope.payload);
    const tenantId = tenantOfEnvelope(envelope);
    await deliverOnce(
      this.db,
      { kind: 'system', job: 'organisations.notify', tenantId },
      envelope,
      this.sender,
      async (tx) => {
        const application = await tx.organisationApplication.findUnique({
          where: { id: payload.applicationId },
          select: { decisionReason: true, tenant: { select: { name: true } } },
        });
        if (application === null) {
          return [];
        }
        const url =
          payload.decision === 'APPROVED'
            ? `${this.base}/`
            : `${this.base}/organisation/application`;
        return (await adminEmails(tx, tenantId)).map((email) =>
          templates.applicationDecision(
            email,
            application.tenant.name,
            payload.decision,
            application.decisionReason,
            url,
          ),
        );
      },
    );
  }
}

/** Suspended / reactivated → the organisation's admins. */
@Injectable()
export class TenantStatusChangedHandler implements EventHandler {
  readonly type = 'organisations.tenant_status_changed';
  private readonly base: string;

  constructor(
    private readonly db: TenantDb,
    private readonly sender: EmailSender,
    @Inject(ConfigService) config: TypedConfigService,
  ) {
    this.base = baseUrl(config);
  }

  async handle(envelope: EventEnvelope): Promise<void> {
    const { status } = z
      .object({ tenantId: z.uuid(), status: z.enum(['SUSPENDED', 'ACTIVE']) })
      .parse(envelope.payload);
    const tenantId = tenantOfEnvelope(envelope);
    await deliverOnce(
      this.db,
      { kind: 'system', job: 'organisations.notify', tenantId },
      envelope,
      this.sender,
      async (tx) => {
        const tenant = await tx.tenant.findUnique({
          where: { id: tenantId },
          select: { name: true },
        });
        if (tenant === null) {
          return [];
        }
        return (await adminEmails(tx, tenantId)).map((email) =>
          templates.tenantStatusChanged(email, tenant.name, status, `${this.base}/`),
        );
      },
    );
  }
}

/** ASVS follow-up F-2: password and MFA changes are always reported to the owner. */
@Injectable()
export class SecurityNoticeHandler implements EventHandler {
  readonly type = 'identity.security_notice';
  private readonly base: string;

  constructor(
    private readonly db: TenantDb,
    private readonly sender: EmailSender,
    @Inject(ConfigService) config: TypedConfigService,
  ) {
    this.base = baseUrl(config);
  }

  async handle(envelope: EventEnvelope): Promise<void> {
    const { userId, notice } = z
      .object({
        userId: z.uuid(),
        notice: z.enum([
          'password_changed',
          'password_reset',
          'mfa_enabled',
          'mfa_disabled',
          'recovery_codes_regenerated',
        ]),
      })
      .parse(envelope.payload);
    await deliverOnce(
      this.db,
      { kind: 'system', job: 'identity.email' },
      envelope,
      this.sender,
      async (tx) => {
        const user = await tx.appUser.findUnique({
          where: { id: userId },
          select: { email: true },
        });
        return user === null
          ? []
          : [templates.securityNotice(user.email, notice, `${this.base}/security`)];
      },
      userId,
    );
  }
}

export const PHASE_4_EMAIL_HANDLERS = [
  InvitationEmailHandler,
  ApplicationDecisionHandler,
  TenantStatusChangedHandler,
  SecurityNoticeHandler,
] as const;
