import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { z } from 'zod';
import type { TypedConfigService } from '../config/env.js';
import { MembershipStatus, TenantDb, type Db, type DbContext } from '../database/index.js';
import type { EventEnvelope, EventHandler } from '../events/event.types.js';
import { deliverOnce } from './deliver-once.js';
import { EmailSender } from './email-sender.js';
import { templates } from './email-templates.js';

/**
 * Who hears about a provider (Phase 5): the ACTIVE provider_admins of a
 * provider company, or the individual provider themself. Runs as the job
 * `providers.notify` (in the company tenant for companies); RLS lets that job
 * read provider rows and the email of individual providers only.
 */
async function recipients(
  tx: Db,
  providerId: string,
): Promise<{ name: string; emails: string[] } | null> {
  const provider = await tx.provider.findUnique({
    where: { id: providerId },
    select: { displayName: true, tenantId: true, ownerUserId: true },
  });
  if (provider === null) {
    return null;
  }
  if (provider.tenantId !== null) {
    const members = await tx.membership.findMany({
      where: {
        tenantId: provider.tenantId,
        status: MembershipStatus.ACTIVE,
        roles: { some: { role: { code: 'provider_admin', tenantId: null } } },
      },
      select: { user: { select: { email: true } } },
    });
    return { name: provider.displayName, emails: members.map((member) => member.user.email) };
  }
  const owner = await tx.appUser.findUnique({
    where: { id: provider.ownerUserId ?? '' },
    select: { email: true },
  });
  return { name: provider.displayName, emails: owner === null ? [] : [owner.email] };
}

function notifyContext(envelope: EventEnvelope): DbContext {
  return envelope.tenantId === null
    ? { kind: 'system', job: 'providers.notify' }
    : { kind: 'system', job: 'providers.notify', tenantId: envelope.tenantId };
}

function baseUrl(config: TypedConfigService): string {
  return config.get('APP_PUBLIC_URL', { infer: true }).replace(/\/$/, '');
}

/** Approved / rejected / changes requested → the provider. */
@Injectable()
export class ProviderDecisionHandler implements EventHandler {
  readonly type = 'providers.application_decided';
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
        providerId: z.uuid(),
        decision: z.enum(['APPROVED', 'REJECTED', 'CHANGES_REQUESTED']),
      })
      .parse(envelope.payload);
    await deliverOnce(this.db, notifyContext(envelope), envelope, this.sender, async (tx) => {
      const application = await tx.providerApplication.findUnique({
        where: { id: payload.applicationId },
        select: { decisionReason: true },
      });
      const to = await recipients(tx, payload.providerId);
      if (application === null || to === null) {
        return [];
      }
      const url =
        payload.decision === 'APPROVED' ? `${this.base}/` : `${this.base}/provider/application`;
      return to.emails.map((email) =>
        templates.providerDecision(
          email,
          to.name,
          payload.decision,
          application.decisionReason,
          url,
        ),
      );
    });
  }
}

/** Suspended / reactivated → the provider. */
@Injectable()
export class ProviderStatusChangedHandler implements EventHandler {
  readonly type = 'providers.status_changed';
  private readonly base: string;

  constructor(
    private readonly db: TenantDb,
    private readonly sender: EmailSender,
    @Inject(ConfigService) config: TypedConfigService,
  ) {
    this.base = baseUrl(config);
  }

  async handle(envelope: EventEnvelope): Promise<void> {
    const { providerId, status } = z
      .object({ providerId: z.uuid(), status: z.enum(['SUSPENDED', 'ACTIVE']) })
      .parse(envelope.payload);
    await deliverOnce(this.db, notifyContext(envelope), envelope, this.sender, async (tx) => {
      const to = await recipients(tx, providerId);
      return to === null
        ? []
        : to.emails.map((email) =>
            templates.providerStatusChanged(email, to.name, status, `${this.base}/`),
          );
    });
  }
}

export const PHASE_5_EMAIL_HANDLERS = [
  ProviderDecisionHandler,
  ProviderStatusChangedHandler,
] as const;
