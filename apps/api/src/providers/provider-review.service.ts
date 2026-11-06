import { Injectable } from '@nestjs/common';
import type {
  ApplicationQueueResponse,
  ApplicationStatus,
  PlatformProviderApplicationResponse,
  VerificationChecklist,
} from '@ogs/contracts';
import type { Decision } from '../applications/application-rules.js';
import { AuditService, type AuditRequestMeta } from '../audit/audit.service.js';
import { conflict, forbiddenRule, notFound } from '../common/domain-error.js';
import { TenantDb, TenantStatus, type Db, type DbContext } from '../database/index.js';
import { OutboxService } from '../events/outbox.service.js';
import { FileService } from '../files/file.service.js';
import { ProviderService } from './provider.service.js';

type ProviderKindValue = 'COMPANY' | 'INDIVIDUAL';
type ProviderStatusValue = 'PENDING_APPROVAL' | 'ACTIVE' | 'REJECTED' | 'SUSPENDED';

/** The approve permission depends on the kind (Phase 5 plan §2.2). */
export const APPROVE_PERMISSION: Record<ProviderKindValue, string> = {
  COMPANY: 'platform.tenant.approve',
  INDIVIDUAL: 'platform.provider.approve',
};

/** Who may see an individual's identity document (P5-5). */
const IDENTITY_VIEWERS = ['platform.provider.approve', 'platform.compliance.review'];

const PROVIDER_STATUS_AFTER: Record<Decision, ProviderStatusValue> = {
  APPROVED: 'ACTIVE',
  REJECTED: 'REJECTED',
  CHANGES_REQUESTED: 'PENDING_APPROVAL',
};
const TENANT_STATUS_AFTER: Record<Decision, TenantStatus> = {
  APPROVED: TenantStatus.ACTIVE,
  REJECTED: TenantStatus.REJECTED,
  CHANGES_REQUESTED: TenantStatus.PENDING_APPROVAL,
};

/** Rejected individual applications may be deleted 24 months after the decision (ADR-018). */
export const INDIVIDUAL_RETENTION_MONTHS = 24;

/**
 * Staff review of provider applications and the provider lifecycle after
 * approval (Phase 5 plan §2.2, §2.5, §2.7). Every method runs in the
 * `platform` context of an elevation, so TenantDb already audits the access
 * with the elevation's reason.
 */
@Injectable()
export class ProviderReviewService {
  constructor(
    private readonly db: TenantDb,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly providers: ProviderService,
    private readonly files: FileService,
  ) {}

  async queue(
    ctx: DbContext,
    status: ApplicationStatus,
    kind?: ProviderKindValue,
  ): Promise<ApplicationQueueResponse['applications']> {
    const scoped = scopedTenant(ctx);
    const rows = await this.db.run(ctx, async (tx) =>
      tx.providerApplication.findMany({
        where: {
          status,
          provider: {
            ...(kind === undefined ? {} : { kind }),
            // An elevation scoped to one tenant only sees that provider company.
            ...(scoped === undefined ? {} : { tenantId: scoped }),
          },
        },
        select: {
          id: true,
          status: true,
          submittedAt: true,
          applicantUserId: true,
          provider: { select: { kind: true, tenantId: true, displayName: true } },
        },
        orderBy: [{ submittedAt: 'asc' }, { createdAt: 'asc' }],
        take: 200,
      }),
    );
    const emails = await this.emails(
      ctx,
      rows.map((row) => row.applicantUserId),
    );
    return rows.map((row) => ({
      applicationId: row.id,
      type:
        row.provider.kind === 'COMPANY'
          ? ('provider_company' as const)
          : ('individual_provider' as const),
      tenantId: row.provider.tenantId,
      legalName: row.provider.displayName,
      status: row.status,
      submittedAt: row.submittedAt?.toISOString() ?? null,
      applicantEmail: emails.get(row.applicantUserId) ?? '',
    }));
  }

  async detail(
    ctx: DbContext,
    permissions: ReadonlySet<string>,
    applicationId: string,
    meta: AuditRequestMeta,
  ): Promise<PlatformProviderApplicationResponse> {
    const mayViewIdentity = IDENTITY_VIEWERS.some((code) => permissions.has(code));
    const { view, applicantUserId, verification, tenantId } = await this.db.run(ctx, async (tx) => {
      const application = await this.find(tx, ctx, applicationId);
      const latest = await tx.providerVerification.findFirst({
        where: { applicationId: application.id },
        orderBy: { createdAt: 'desc' },
        select: {
          identityChecked: true,
          registrationChecked: true,
          taxChecked: true,
          skillsChecked: true,
          notes: true,
        },
      });
      return {
        view: await this.providers.load(tx, application.providerId),
        applicantUserId: application.applicantUserId,
        verification: latest,
        tenantId: application.provider.tenantId,
      };
    });
    const visible = view.documents.filter(
      (document) => document.purpose !== 'provider.identity' || mayViewIdentity,
    );
    const documents = await Promise.all(
      visible.map(async (document) => ({
        ...document,
        downloadUrl:
          document.status === 'CLEAN' ? (await this.files.downloadUrl(ctx, document.id)).url : null,
      })),
    );
    const identityLinks = documents.filter(
      (document) => document.purpose === 'provider.identity' && document.downloadUrl !== null,
    );
    if (identityLinks.length > 0) {
      // Every staff access to identity documents is audited with the elevation's reason.
      await this.db.run(ctx, async (tx) => {
        for (const document of identityLinks) {
          await this.audit.record(tx, {
            action: 'provider.identity_document_viewed',
            tenantId,
            entityType: 'file',
            entityId: document.id,
            ...(ctx.kind === 'platform' ? { reason: ctx.reason } : {}),
            request: meta,
            metadata: { applicationId },
          });
        }
      });
    }
    const emails = await this.emails(ctx, [applicantUserId]);
    return {
      ...view,
      documents,
      applicantEmail: emails.get(applicantUserId) ?? '',
      verification:
        verification === null
          ? null
          : {
              identityChecked: verification.identityChecked,
              registrationChecked: verification.registrationChecked,
              taxChecked: verification.taxChecked,
              skillsChecked: verification.skillsChecked,
              ...(verification.notes === null ? {} : { notes: verification.notes }),
            },
    };
  }

  async decide(
    ctx: DbContext,
    permissions: ReadonlySet<string>,
    applicationId: string,
    decision: Decision,
    input: { reason: string | null; checklist?: VerificationChecklist },
    meta: AuditRequestMeta,
  ): Promise<void> {
    if (ctx.kind !== 'platform') {
      throw notFound();
    }
    await this.db.run(ctx, async (tx) => {
      const application = await this.find(tx, ctx, applicationId);
      const kind = application.provider.kind;
      if (!permissions.has(APPROVE_PERMISSION[kind])) {
        throw forbiddenRule('permission_denied');
      }
      if (application.applicantUserId === ctx.userId) {
        throw conflict('cannot_decide_own_application');
      }
      const now = new Date();
      const changed = await tx.providerApplication.updateMany({
        where: { id: application.id, status: 'SUBMITTED' },
        data: {
          status: decision,
          decidedAt: now,
          decidedBy: ctx.userId,
          decisionReason: input.reason,
        },
      });
      if (changed.count !== 1) {
        throw conflict('invalid_transition');
      }
      await tx.provider.update({
        where: { id: application.providerId },
        data: {
          status: PROVIDER_STATUS_AFTER[decision],
          ...(decision === 'REJECTED' && kind === 'INDIVIDUAL'
            ? { retainUntil: addMonths(now, INDIVIDUAL_RETENTION_MONTHS) }
            : {}),
        },
        select: { id: true },
      });
      if (application.provider.tenantId !== null) {
        await tx.tenant.update({
          where: { id: application.provider.tenantId },
          data: { status: TENANT_STATUS_AFTER[decision] },
          select: { id: true },
        });
      }
      await tx.providerApplicationEvent.createMany({
        data: [
          {
            applicationId: application.id,
            fromStatus: 'SUBMITTED',
            toStatus: decision,
            actorUserId: ctx.userId,
            reason: input.reason,
          },
        ],
      });
      if (input.checklist !== undefined) {
        await tx.providerVerification.createMany({
          data: [
            {
              applicationId: application.id,
              reviewerUserId: ctx.userId,
              identityChecked: input.checklist.identityChecked,
              registrationChecked: input.checklist.registrationChecked,
              taxChecked: input.checklist.taxChecked,
              skillsChecked: input.checklist.skillsChecked,
              notes: input.checklist.notes ?? null,
            },
          ],
        });
      }
      await this.audit.record(tx, {
        action: `provider.application_${decision.toLowerCase()}`,
        tenantId: application.provider.tenantId,
        entityType: 'provider_application',
        entityId: application.id,
        ...(input.reason === null ? {} : { reason: input.reason }),
        request: meta,
        metadata: {
          kind,
          ...(input.checklist === undefined
            ? {}
            : {
                checklist: {
                  identityChecked: input.checklist.identityChecked,
                  registrationChecked: input.checklist.registrationChecked,
                  taxChecked: input.checklist.taxChecked,
                  skillsChecked: input.checklist.skillsChecked,
                },
              }),
        },
      });
      await this.outbox.publish(tx, {
        type: 'providers.application_decided',
        tenantId: application.provider.tenantId,
        payload: { applicationId: application.id, providerId: application.providerId, decision },
      });
    });
  }

  /**
   * Suspend an ACTIVE provider or reactivate a SUSPENDED one (plan §2.5). A
   * provider company is suspended together with its tenant, so its workspace
   * turns read-only; eligibility drops it at once either way.
   */
  async setStatus(
    ctx: DbContext,
    permissions: ReadonlySet<string>,
    providerId: string,
    target: 'SUSPENDED' | 'ACTIVE',
    reason: string,
    meta: AuditRequestMeta,
  ): Promise<void> {
    const from: ProviderStatusValue = target === 'SUSPENDED' ? 'ACTIVE' : 'SUSPENDED';
    const scoped = scopedTenant(ctx);
    await this.db.run(ctx, async (tx) => {
      const provider = await tx.provider.findFirst({
        where: { id: providerId, ...(scoped === undefined ? {} : { tenantId: scoped }) },
        select: { id: true, kind: true, status: true, tenantId: true },
      });
      if (provider === null) {
        throw notFound();
      }
      if (!permissions.has(APPROVE_PERMISSION[provider.kind])) {
        throw forbiddenRule('permission_denied');
      }
      const changed = await tx.provider.updateMany({
        where: { id: provider.id, status: from },
        data: { status: target },
      });
      if (changed.count !== 1) {
        throw conflict('invalid_transition');
      }
      if (provider.tenantId !== null) {
        await tx.tenant.updateMany({
          where: {
            id: provider.tenantId,
            status: target === 'SUSPENDED' ? TenantStatus.ACTIVE : TenantStatus.SUSPENDED,
          },
          data: { status: target },
        });
      }
      await this.audit.record(tx, {
        action: target === 'SUSPENDED' ? 'provider.suspended' : 'provider.reactivated',
        tenantId: provider.tenantId,
        entityType: 'provider',
        entityId: provider.id,
        reason,
        request: meta,
      });
      await this.outbox.publish(tx, {
        type: 'providers.status_changed',
        tenantId: provider.tenantId,
        payload: { providerId: provider.id, status: target },
      });
    });
  }

  private async find(tx: Db, ctx: DbContext, applicationId: string) {
    const scoped = scopedTenant(ctx);
    const application = await tx.providerApplication.findFirst({
      where: {
        id: applicationId,
        ...(scoped === undefined ? {} : { provider: { tenantId: scoped } }),
      },
      select: {
        id: true,
        providerId: true,
        applicantUserId: true,
        provider: { select: { kind: true, tenantId: true } },
      },
    });
    if (application === null) {
      throw notFound();
    }
    return application;
  }

  private async emails(ctx: DbContext, userIds: string[]): Promise<Map<string, string>> {
    const users = await this.db.run(ctx, async (tx) =>
      tx.appUser.findMany({ where: { id: { in: userIds } }, select: { id: true, email: true } }),
    );
    return new Map(users.map((user) => [user.id, user.email]));
  }
}

function scopedTenant(ctx: DbContext): string | undefined {
  return ctx.kind === 'platform' ? ctx.tenantId : undefined;
}

function addMonths(date: Date, months: number): Date {
  const result = new Date(date);
  result.setUTCMonth(result.getUTCMonth() + months);
  return result;
}
