import { Injectable } from '@nestjs/common';
import type {
  ApplicationQueueResponse,
  ApplicationStatus,
  PlatformApplicationResponse,
} from '@ogs/contracts';
import { AuditService, type AuditRequestMeta } from '../audit/audit.service.js';
import { conflict, notFound } from '../common/domain-error.js';
import { TenantDb, TenantStatus, type DbContext } from '../database/index.js';
import { OutboxService } from '../events/outbox.service.js';
import { FileService } from '../files/file.service.js';
import { OrganisationService } from './organisation.service.js';

export type Decision = 'APPROVED' | 'REJECTED' | 'CHANGES_REQUESTED';

const TENANT_STATUS_AFTER: Record<Decision, TenantStatus> = {
  APPROVED: TenantStatus.ACTIVE,
  REJECTED: TenantStatus.REJECTED,
  CHANGES_REQUESTED: TenantStatus.PENDING_APPROVAL,
};

/**
 * Platform review of organisation applications (Phase 4 plan §2.2). Every
 * method runs in the `platform` context of an elevation, so TenantDb already
 * audits the access with the elevation's reason; decisions add their own audit
 * row and an outbox event that emails the organisation's admins.
 */
@Injectable()
export class OrganisationReviewService {
  constructor(
    private readonly db: TenantDb,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly organisations: OrganisationService,
    private readonly files: FileService,
  ) {}

  async queue(ctx: DbContext, status: ApplicationStatus): Promise<ApplicationQueueResponse> {
    const rows = await this.db.run(ctx, async (tx) =>
      tx.organisationApplication.findMany({
        where: { status, ...scope(ctx) },
        select: {
          id: true,
          tenantId: true,
          status: true,
          submittedAt: true,
          applicantUserId: true,
          tenant: { select: { organisationProfile: { select: { legalName: true } } } },
        },
        orderBy: [{ submittedAt: 'asc' }, { createdAt: 'asc' }],
        take: 200,
      }),
    );
    const emails = await this.emails(
      ctx,
      rows.map((row) => row.applicantUserId),
    );
    return {
      applications: rows.map((row) => ({
        applicationId: row.id,
        type: 'organisation' as const,
        tenantId: row.tenantId,
        legalName: row.tenant.organisationProfile?.legalName ?? '',
        status: row.status,
        submittedAt: row.submittedAt?.toISOString() ?? null,
        applicantEmail: emails.get(row.applicantUserId) ?? '',
      })),
    };
  }

  async detail(ctx: DbContext, applicationId: string): Promise<PlatformApplicationResponse> {
    const { view, applicantUserId } = await this.db.run(ctx, async (tx) => {
      const application = await tx.organisationApplication.findFirst({
        where: { id: applicationId, ...scope(ctx) },
        select: { tenantId: true, applicantUserId: true },
      });
      if (application === null) {
        throw notFound();
      }
      return {
        view: await this.organisations.load(tx, application.tenantId),
        applicantUserId: application.applicantUserId,
      };
    });
    const emails = await this.emails(ctx, [applicantUserId]);
    const documents = await Promise.all(
      view.documents.map(async (document) => ({
        ...document,
        downloadUrl:
          document.status === 'CLEAN' ? (await this.files.downloadUrl(ctx, document.id)).url : null,
      })),
    );
    return { ...view, documents, applicantEmail: emails.get(applicantUserId) ?? '' };
  }

  async decide(
    ctx: DbContext,
    applicationId: string,
    decision: Decision,
    reason: string | null,
    meta: AuditRequestMeta,
  ): Promise<void> {
    if (ctx.kind !== 'platform') {
      throw notFound();
    }
    await this.db.run(ctx, async (tx) => {
      const application = await tx.organisationApplication.findFirst({
        where: { id: applicationId, ...scope(ctx) },
        select: { id: true, tenantId: true, status: true, applicantUserId: true },
      });
      if (application === null) {
        throw notFound();
      }
      if (application.applicantUserId === ctx.userId) {
        throw conflict('cannot_decide_own_application');
      }
      const changed = await tx.organisationApplication.updateMany({
        where: { id: application.id, status: 'SUBMITTED' },
        data: {
          status: decision,
          decidedAt: new Date(),
          decidedBy: ctx.userId,
          decisionReason: reason,
        },
      });
      if (changed.count !== 1) {
        throw conflict('invalid_transition');
      }
      await tx.tenant.update({
        where: { id: application.tenantId },
        data: { status: TENANT_STATUS_AFTER[decision] },
        select: { id: true },
      });
      await tx.organisationApplicationEvent.createMany({
        data: [
          {
            applicationId: application.id,
            tenantId: application.tenantId,
            fromStatus: 'SUBMITTED',
            toStatus: decision,
            actorUserId: ctx.userId,
            reason,
          },
        ],
      });
      await this.audit.record(tx, {
        action: `organisation.application_${decision.toLowerCase()}`,
        tenantId: application.tenantId,
        entityType: 'organisation_application',
        entityId: application.id,
        ...(reason === null ? {} : { reason }),
        request: meta,
      });
      await this.outbox.publish(tx, {
        type: 'organisations.application_decided',
        tenantId: application.tenantId,
        payload: { applicationId: application.id, decision },
      });
    });
  }

  /** Suspend an ACTIVE organisation or reactivate a SUSPENDED one (reason required). */
  async setTenantStatus(
    ctx: DbContext,
    tenantId: string,
    target: 'SUSPENDED' | 'ACTIVE',
    reason: string,
    meta: AuditRequestMeta,
  ): Promise<void> {
    const from = target === 'SUSPENDED' ? TenantStatus.ACTIVE : TenantStatus.SUSPENDED;
    // An elevation scoped to another tenant must not reach this one.
    const scoped = scope(ctx).tenantId;
    if (scoped !== undefined && scoped !== tenantId) {
      throw notFound();
    }
    await this.db.run(ctx, async (tx) => {
      const changed = await tx.tenant.updateMany({
        where: { id: tenantId, status: from, kind: 'ORGANISATION' },
        data: { status: target },
      });
      if (changed.count !== 1) {
        const exists = await tx.tenant.count({ where: { id: tenantId } });
        throw exists === 0 ? notFound() : conflict('invalid_transition');
      }
      await this.audit.record(tx, {
        action: target === 'SUSPENDED' ? 'organisation.suspended' : 'organisation.reactivated',
        tenantId,
        entityType: 'tenant',
        entityId: tenantId,
        reason,
        request: meta,
      });
      await this.outbox.publish(tx, {
        type: 'organisations.tenant_status_changed',
        tenantId,
        payload: { tenantId, status: target },
      });
    });
  }

  private async emails(ctx: DbContext, userIds: string[]): Promise<Map<string, string>> {
    const users = await this.db.run(ctx, async (tx) =>
      tx.appUser.findMany({ where: { id: { in: userIds } }, select: { id: true, email: true } }),
    );
    return new Map(users.map((user) => [user.id, user.email]));
  }
}

/** An elevation scoped to one tenant only sees that tenant's application. */
function scope(ctx: DbContext): { tenantId?: string } {
  return ctx.kind === 'platform' && ctx.tenantId !== undefined ? { tenantId: ctx.tenantId } : {};
}
