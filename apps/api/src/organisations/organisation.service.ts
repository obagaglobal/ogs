import { randomBytes } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import type {
  OrganisationApplicationResponse,
  OrganisationProfileInput,
  RegisterOrganisationRequest,
} from '@ogs/contracts';
import { AuditService, type AuditRequestMeta } from '../audit/audit.service.js';
import { conflict, notFound } from '../common/domain-error.js';
import {
  MembershipStatus,
  TenantDb,
  TenantKind,
  TenantStatus,
  type Db,
  type DbContext,
} from '../database/index.js';
import { OutboxService } from '../events/outbox.service.js';

export const ORGANISATION_DOCUMENT_PURPOSE = 'organisation.document';

/** Statuses in which the organisation may still edit its application. */
const EDITABLE: ReadonlySet<string> = new Set(['DRAFT', 'CHANGES_REQUESTED']);
/** Identity fields that freeze once OGS has approved them. */
const LOCKED_AFTER_APPROVAL = ['legalName', 'registrationNumber', 'kraPin', 'country'] as const;

const profileSelect = {
  legalName: true,
  tradingName: true,
  registrationNumber: true,
  registrationNumberAbsentWhy: true,
  kraPin: true,
  kraPinAbsentWhy: true,
  country: true,
  region: true,
  address: true,
  phone: true,
  contactEmail: true,
  industry: true,
  employeeBand: true,
} as const;

function slugFor(name: string): string {
  const base =
    name
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'organisation';
  return `${base}-${randomBytes(3).toString('hex')}`;
}

function toProfileData(input: OrganisationProfileInput) {
  return Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined));
}

/** What still blocks submission (Phase 4 plan §2.1). Field names match the profile. */
export function missingForSubmission(
  profile: Record<string, string | null>,
  documentCount: number,
): string[] {
  const missing: string[] = [];
  const has = (key: string) => (profile[key] ?? '').trim() !== '';
  if (!has('legalName')) missing.push('legalName');
  if (!has('registrationNumber') && !has('registrationNumberAbsentWhy'))
    missing.push('registrationNumber');
  if (!has('kraPin') && !has('kraPinAbsentWhy')) missing.push('kraPin');
  for (const key of ['region', 'address', 'phone', 'contactEmail']) {
    if (!has(key)) missing.push(key);
  }
  if (documentCount === 0) missing.push('documents');
  return missing;
}

/**
 * Organisation applications from the applicant's side (Phase 4 plan §2.1).
 * Decisions live in OrganisationReviewService (platform staff).
 */
@Injectable()
export class OrganisationService {
  constructor(
    private readonly db: TenantDb,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
  ) {}

  /**
   * Creates the pending tenant, its profile, a DRAFT application and the
   * applicant's org_admin membership, atomically, under the narrow
   * `organisations.register` job (no tenant context exists yet).
   */
  async register(userId: string, input: RegisterOrganisationRequest, meta: AuditRequestMeta) {
    return this.db.run({ kind: 'system', job: 'organisations.register' }, async (tx) => {
      const tenant = await tx.tenant.create({
        data: {
          kind: TenantKind.ORGANISATION,
          status: TenantStatus.PENDING_APPROVAL,
          name: input.tradingName ?? input.legalName,
          slug: slugFor(input.tradingName ?? input.legalName),
        },
        select: { id: true },
      });
      await tx.organisationProfile.create({
        data: { tenantId: tenant.id, ...toProfileData(input), legalName: input.legalName },
        select: { tenantId: true },
      });
      const application = await tx.organisationApplication.create({
        data: { tenantId: tenant.id, applicantUserId: userId },
        select: { id: true },
      });
      await tx.organisationApplicationEvent.createMany({
        data: [
          {
            applicationId: application.id,
            tenantId: tenant.id,
            toStatus: 'DRAFT',
            actorUserId: userId,
          },
        ],
      });
      const membership = await tx.membership.create({
        data: {
          tenantId: tenant.id,
          userId,
          status: MembershipStatus.ACTIVE,
          joinedAt: new Date(),
        },
        select: { id: true },
      });
      const adminRole = await tx.role.findFirst({
        where: { tenantId: null, code: 'org_admin' },
        select: { id: true },
      });
      if (adminRole === null) {
        throw new Error('System role org_admin missing (catalogue not synced)');
      }
      await tx.membershipRole.createMany({
        data: [{ membershipId: membership.id, roleId: adminRole.id, tenantId: tenant.id }],
      });
      await this.audit.record(tx, {
        action: 'organisation.registered',
        tenantId: tenant.id,
        entityType: 'tenant',
        entityId: tenant.id,
        request: meta,
        metadata: { applicantUserId: userId },
      });
      return { tenantId: tenant.id, applicationId: application.id };
    });
  }

  async application(ctx: DbContext): Promise<OrganisationApplicationResponse> {
    const tenantId = tenantOf(ctx);
    return this.db.run(ctx, async (tx) => this.load(tx, tenantId));
  }

  /** Edits the profile while editable; after approval only non-identity fields change. */
  async updateProfile(ctx: DbContext, input: OrganisationProfileInput, meta: AuditRequestMeta) {
    const tenantId = tenantOf(ctx);
    return this.db.run(ctx, async (tx) => {
      const application = await tx.organisationApplication.findUnique({
        where: { tenantId },
        select: { status: true },
      });
      if (application === null) {
        throw notFound();
      }
      const approved = application.status === 'APPROVED';
      if (!approved && !EDITABLE.has(application.status)) {
        throw conflict('application_locked');
      }
      if (approved && LOCKED_AFTER_APPROVAL.some((field) => input[field] !== undefined)) {
        throw conflict('field_locked_after_approval');
      }
      const data = toProfileData(input);
      await tx.organisationProfile.update({
        where: { tenantId },
        data,
        select: { tenantId: true },
      });
      if (input.tradingName !== undefined || input.legalName !== undefined) {
        const profile = await tx.organisationProfile.findUniqueOrThrow({
          where: { tenantId },
          select: { legalName: true, tradingName: true },
        });
        await tx.tenant.update({
          where: { id: tenantId },
          data: { name: profile.tradingName ?? profile.legalName },
          select: { id: true },
        });
      }
      await this.audit.record(tx, {
        action: 'organisation.profile_updated',
        tenantId,
        entityType: 'tenant',
        entityId: tenantId,
        request: meta,
        metadata: { fields: Object.keys(data) },
      });
      return this.load(tx, tenantId);
    });
  }

  async submit(ctx: DbContext, userId: string, meta: AuditRequestMeta) {
    const tenantId = tenantOf(ctx);
    return this.db.run(ctx, async (tx) => {
      const current = await this.load(tx, tenantId);
      if (!EDITABLE.has(current.status)) {
        throw conflict('invalid_transition');
      }
      if (current.missing.length > 0) {
        throw conflict('application_incomplete');
      }
      const changed = await tx.organisationApplication.updateMany({
        where: { tenantId, status: current.status },
        data: { status: 'SUBMITTED', submittedAt: new Date() },
      });
      if (changed.count !== 1) {
        throw conflict('invalid_transition');
      }
      await tx.organisationApplicationEvent.createMany({
        data: [
          {
            applicationId: current.applicationId,
            tenantId,
            fromStatus: current.status,
            toStatus: 'SUBMITTED',
            actorUserId: userId,
          },
        ],
      });
      await this.audit.record(tx, {
        action: 'organisation.application_submitted',
        tenantId,
        entityType: 'organisation_application',
        entityId: current.applicationId,
        request: meta,
      });
      await this.outbox.publish(tx, {
        type: 'organisations.application_submitted',
        tenantId,
        payload: { applicationId: current.applicationId },
      });
      return this.load(tx, tenantId);
    });
  }

  /** Shared by the applicant view and the platform review view. */
  async load(tx: Db, tenantId: string): Promise<OrganisationApplicationResponse> {
    const application = await tx.organisationApplication.findUnique({
      where: { tenantId },
      select: {
        id: true,
        status: true,
        decisionReason: true,
        submittedAt: true,
        decidedAt: true,
        tenant: { select: { status: true, organisationProfile: { select: profileSelect } } },
        events: {
          select: { fromStatus: true, toStatus: true, reason: true, occurredAt: true },
          orderBy: { occurredAt: 'asc' },
        },
      },
    });
    const profile = application?.tenant.organisationProfile;
    if (application === null || profile === null || profile === undefined) {
      throw notFound();
    }
    const documents = await tx.fileMetadata.findMany({
      where: { tenantId, purpose: ORGANISATION_DOCUMENT_PURPOSE },
      select: {
        id: true,
        purpose: true,
        originalName: true,
        mimeType: true,
        sizeBytes: true,
        status: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'asc' },
    });
    const usable = documents.filter((document) => document.status !== 'REJECTED').length;
    return {
      applicationId: application.id,
      tenantId,
      tenantStatus: application.tenant.status,
      status: application.status,
      decisionReason: application.decisionReason,
      submittedAt: application.submittedAt?.toISOString() ?? null,
      decidedAt: application.decidedAt?.toISOString() ?? null,
      missing: missingForSubmission(profile, usable),
      profile,
      documents: documents.map((document) => ({
        ...document,
        createdAt: document.createdAt.toISOString(),
      })),
      history: application.events.map((event) => ({
        ...event,
        occurredAt: event.occurredAt.toISOString(),
      })),
    };
  }
}

/** The tenant a workspace context acts for (organisation endpoints are workspace-only). */
export function tenantOf(ctx: DbContext): string {
  if (ctx.kind !== 'workspace') {
    throw notFound();
  }
  return ctx.tenantId;
}
