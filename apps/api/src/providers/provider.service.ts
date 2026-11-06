import { randomBytes } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import type { OrganisationProfileInput, ProviderResponse } from '@ogs/contracts';
import {
  EDITABLE_APPLICATION,
  type ApplicationStatusValue,
} from '../applications/application-rules.js';
import { AuditService, type AuditRequestMeta } from '../audit/audit.service.js';
import { conflict, notFound } from '../common/domain-error.js';
import {
  MembershipStatus,
  Prisma,
  TenantDb,
  TenantKind,
  TenantStatus,
  type Db,
  type DbContext,
} from '../database/index.js';
import { OutboxService } from '../events/outbox.service.js';

export const PROVIDER_DOCUMENT_PURPOSES = {
  COMPANY: ['provider.company_document', 'provider.certificate'],
  INDIVIDUAL: ['provider.identity', 'provider.certificate'],
} as const;

/** Who is acting as which provider (resolved from the request's workspace). */
export interface ProviderSubject {
  readonly ctx: DbContext;
  readonly kind: 'COMPANY' | 'INDIVIDUAL';
  readonly userId: string;
  /** Provider company tenant (COMPANY only). */
  readonly tenantId?: string;
}

export type ExperienceValue = 'UNDER_1_YEAR' | 'YEARS_1_3' | 'YEARS_3_5' | 'OVER_5_YEARS';

export const toClock = (minutes: number): string =>
  `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
export const fromClock = (clock: string): number => {
  const [hours, minutes] = clock.split(':').map(Number);
  return (hours ?? 0) * 60 + (minutes ?? 0);
};

function slugFor(name: string): string {
  const base =
    name
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'provider';
  return `${base}-${randomBytes(3).toString('hex')}`;
}

/**
 * Providers from their own side (Phase 5 plan §2.1–§2.3): registration, the
 * application, and the profile that eligibility reads (skills, coverage,
 * availability). Staff decisions live in ProviderReviewService.
 */
@Injectable()
export class ProviderService {
  constructor(
    private readonly db: TenantDb,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
  ) {}

  /** A provider company: pending tenant + business profile + provider + DRAFT application + provider_admin. */
  async registerCompany(
    userId: string,
    input: { legalName: string; tradingName?: string | undefined },
    meta: AuditRequestMeta,
  ) {
    const displayName = input.tradingName ?? input.legalName;
    return this.db.run({ kind: 'system', job: 'providers.register' }, async (tx) => {
      const tenant = await tx.tenant.create({
        data: {
          kind: TenantKind.PROVIDER_COMPANY,
          status: TenantStatus.PENDING_APPROVAL,
          name: displayName,
          slug: slugFor(displayName),
        },
        select: { id: true },
      });
      await tx.organisationProfile.createMany({
        data: [
          {
            tenantId: tenant.id,
            legalName: input.legalName,
            ...(input.tradingName === undefined ? {} : { tradingName: input.tradingName }),
          },
        ],
      });
      const provider = await tx.provider.create({
        data: { kind: 'COMPANY', tenantId: tenant.id, displayName },
        select: { id: true },
      });
      const application = await tx.providerApplication.create({
        data: { providerId: provider.id, applicantUserId: userId },
        select: { id: true },
      });
      await tx.providerApplicationEvent.createMany({
        data: [{ applicationId: application.id, toStatus: 'DRAFT', actorUserId: userId }],
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
        where: { tenantId: null, code: 'provider_admin' },
        select: { id: true },
      });
      if (adminRole === null) {
        throw new Error('System role provider_admin missing (catalogue not synced)');
      }
      await tx.membershipRole.createMany({
        data: [{ membershipId: membership.id, roleId: adminRole.id, tenantId: tenant.id }],
      });
      await this.audit.record(tx, {
        action: 'provider.registered',
        tenantId: tenant.id,
        entityType: 'provider',
        entityId: provider.id,
        request: meta,
        metadata: { kind: 'COMPANY', applicantUserId: userId },
      });
      return { tenantId: tenant.id, providerId: provider.id, applicationId: application.id };
    });
  }

  /** An individual provider: a user-owned profile and its DRAFT application (P5-1). */
  async applyIndividual(
    userId: string,
    input: { displayName: string; phone?: string | undefined; homeRegion?: string | undefined },
    meta: AuditRequestMeta,
  ) {
    try {
      return await this.db.run({ kind: 'user', userId }, async (tx) => {
        if (input.homeRegion !== undefined) {
          await assertRegions(tx, [input.homeRegion]);
        }
        const provider = await tx.provider.create({
          data: {
            kind: 'INDIVIDUAL',
            ownerUserId: userId,
            displayName: input.displayName,
            phone: input.phone ?? null,
            homeRegion: input.homeRegion ?? null,
          },
          select: { id: true },
        });
        const application = await tx.providerApplication.create({
          data: { providerId: provider.id, applicantUserId: userId },
          select: { id: true },
        });
        await tx.providerApplicationEvent.createMany({
          data: [{ applicationId: application.id, toStatus: 'DRAFT', actorUserId: userId }],
        });
        await this.audit.record(tx, {
          action: 'provider.registered',
          entityType: 'provider',
          entityId: provider.id,
          request: meta,
          metadata: { kind: 'INDIVIDUAL' },
        });
        return { providerId: provider.id, applicationId: application.id };
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw conflict('already_a_provider');
      }
      throw error;
    }
  }

  async get(subject: ProviderSubject): Promise<ProviderResponse> {
    return this.db.run(subject.ctx, async (tx) =>
      this.load(tx, await this.providerId(tx, subject)),
    );
  }

  async updateProfile(
    subject: ProviderSubject,
    change: {
      displayName?: string | undefined;
      phone?: string | null | undefined;
      homeRegion?: string | null | undefined;
      remoteOk?: boolean | undefined;
      acceptingWork?: boolean | undefined;
    },
    meta: AuditRequestMeta,
  ): Promise<ProviderResponse> {
    return this.mutate(
      subject,
      meta,
      'provider.profile_updated',
      { fields: Object.keys(change) },
      async (tx, id) => {
        if (typeof change.homeRegion === 'string') {
          await assertRegions(tx, [change.homeRegion]);
        }
        await tx.provider.update({
          where: { id },
          data: {
            ...(change.displayName === undefined ? {} : { displayName: change.displayName }),
            ...(change.phone === undefined ? {} : { phone: change.phone }),
            ...(change.homeRegion === undefined ? {} : { homeRegion: change.homeRegion }),
            ...(change.remoteOk === undefined ? {} : { remoteOk: change.remoteOk }),
            ...(change.acceptingWork === undefined ? {} : { acceptingWork: change.acceptingWork }),
            version: { increment: 1 },
          },
          select: { id: true },
        });
      },
      { allowAcceptingWorkOnly: change },
    );
  }

  async setSkills(
    subject: ProviderSubject,
    skills: readonly { code: string; experience: ExperienceValue }[],
    meta: AuditRequestMeta,
  ) {
    return this.mutate(
      subject,
      meta,
      'provider.skills_changed',
      { skills: skills.map((s) => s.code) },
      async (tx, id) => {
        const known = await tx.skill.count({
          where: { code: { in: skills.map((s) => s.code) }, active: true },
        });
        if (known !== skills.length) {
          throw conflict('skill_unknown');
        }
        await tx.providerSkill.deleteMany({ where: { providerId: id } });
        await tx.providerSkill.createMany({
          data: skills.map((skill) => ({
            providerId: id,
            skillCode: skill.code,
            experience: skill.experience,
          })),
        });
      },
    );
  }

  async setRegions(
    subject: ProviderSubject,
    regionCodes: readonly string[],
    meta: AuditRequestMeta,
  ) {
    return this.mutate(
      subject,
      meta,
      'provider.regions_changed',
      { regions: [...regionCodes] },
      async (tx, id) => {
        await assertRegions(tx, regionCodes);
        await tx.providerRegion.deleteMany({ where: { providerId: id } });
        await tx.providerRegion.createMany({
          data: regionCodes.map((regionCode) => ({ providerId: id, regionCode })),
        });
      },
    );
  }

  async setWorkingHours(
    subject: ProviderSubject,
    hours: readonly { weekday: number; start: string; end: string }[],
    meta: AuditRequestMeta,
  ) {
    return this.mutate(
      subject,
      meta,
      'provider.hours_changed',
      { entries: hours.length },
      async (tx, id) => {
        await tx.providerWorkingHours.deleteMany({ where: { providerId: id } });
        await tx.providerWorkingHours.createMany({
          data: hours.map((entry) => ({
            providerId: id,
            weekday: entry.weekday,
            startMinute: fromClock(entry.start),
            endMinute: fromClock(entry.end),
          })),
        });
      },
    );
  }

  async addTimeOff(
    subject: ProviderSubject,
    input: { startsAt: string; endsAt: string; reason?: string | undefined },
    meta: AuditRequestMeta,
  ) {
    return this.mutate(subject, meta, 'provider.time_off_added', {}, async (tx, id) => {
      await tx.providerTimeOff.createMany({
        data: [
          {
            providerId: id,
            startsAt: new Date(input.startsAt),
            endsAt: new Date(input.endsAt),
            reason: input.reason ?? null,
          },
        ],
      });
    });
  }

  async removeTimeOff(subject: ProviderSubject, timeOffId: string, meta: AuditRequestMeta) {
    return this.mutate(
      subject,
      meta,
      'provider.time_off_removed',
      { timeOffId },
      async (tx, id) => {
        const removed = await tx.providerTimeOff.deleteMany({
          where: { id: timeOffId, providerId: id },
        });
        if (removed.count !== 1) {
          throw notFound();
        }
      },
    );
  }

  /** Business details of a provider company (shared shape with organisations). */
  async updateBusiness(
    subject: ProviderSubject,
    input: OrganisationProfileInput,
    meta: AuditRequestMeta,
  ) {
    if (subject.kind !== 'COMPANY' || subject.tenantId === undefined) {
      throw notFound();
    }
    const tenantId = subject.tenantId;
    return this.mutate(
      subject,
      meta,
      'provider.business_updated',
      { fields: Object.keys(input) },
      async (tx) => {
        const data = Object.fromEntries(
          Object.entries(input).filter(([, value]) => value !== undefined),
        );
        await tx.organisationProfile.update({
          where: { tenantId },
          data,
          select: { tenantId: true },
        });
      },
    );
  }

  async submit(subject: ProviderSubject, meta: AuditRequestMeta): Promise<ProviderResponse> {
    return this.db.run(subject.ctx, async (tx) => {
      const id = await this.providerId(tx, subject);
      const current = await this.load(tx, id);
      if (!EDITABLE_APPLICATION.has(current.application.status)) {
        throw conflict('invalid_transition');
      }
      if (current.application.missing.length > 0) {
        throw conflict('application_incomplete');
      }
      const changed = await tx.providerApplication.updateMany({
        where: { id: current.application.applicationId, status: current.application.status },
        data: { status: 'SUBMITTED', submittedAt: new Date() },
      });
      if (changed.count !== 1) {
        throw conflict('invalid_transition');
      }
      await tx.providerApplicationEvent.createMany({
        data: [
          {
            applicationId: current.application.applicationId,
            fromStatus: current.application.status,
            toStatus: 'SUBMITTED',
            actorUserId: subject.userId,
          },
        ],
      });
      await this.audit.record(tx, {
        action: 'provider.application_submitted',
        tenantId: subject.tenantId ?? null,
        entityType: 'provider_application',
        entityId: current.application.applicationId,
        request: meta,
      });
      await this.outbox.publish(tx, {
        type: 'providers.application_submitted',
        tenantId: subject.tenantId ?? null,
        payload: { applicationId: current.application.applicationId },
      });
      return this.load(tx, id);
    });
  }

  // --------------------------------------------------------------------------

  /**
   * Shared write path: the provider must not be suspended or rejected, and while
   * an application is under review (SUBMITTED) its content is frozen. The
   * accepting-work switch alone stays usable after approval at all times.
   */
  private async mutate(
    subject: ProviderSubject,
    meta: AuditRequestMeta,
    action: string,
    metadata: Prisma.InputJsonObject,
    work: (tx: Db, providerId: string) => Promise<void>,
    options: { allowAcceptingWorkOnly?: object } = {},
  ): Promise<ProviderResponse> {
    return this.db.run(subject.ctx, async (tx) => {
      const id = await this.providerId(tx, subject);
      const state = await tx.provider.findUniqueOrThrow({
        where: { id },
        select: { status: true, application: { select: { status: true } } },
      });
      if (state.status === 'SUSPENDED' || state.status === 'REJECTED') {
        throw conflict(state.status === 'SUSPENDED' ? 'provider_suspended' : 'application_locked');
      }
      const applicationStatus: ApplicationStatusValue = state.application?.status ?? 'DRAFT';
      const onlyAcceptingWork =
        options.allowAcceptingWorkOnly !== undefined &&
        Object.keys(options.allowAcceptingWorkOnly).every((key) => key === 'acceptingWork');
      if (applicationStatus === 'SUBMITTED' && !onlyAcceptingWork) {
        throw conflict('application_locked');
      }
      await work(tx, id);
      await this.audit.record(tx, {
        action,
        tenantId: subject.tenantId ?? null,
        entityType: 'provider',
        entityId: id,
        request: meta,
        metadata,
      });
      return this.load(tx, id);
    });
  }

  async providerId(tx: Db, subject: ProviderSubject): Promise<string> {
    const provider = await tx.provider.findFirst({
      where:
        subject.kind === 'COMPANY'
          ? { kind: 'COMPANY', tenantId: subject.tenantId ?? '' }
          : { kind: 'INDIVIDUAL', ownerUserId: subject.userId },
      select: { id: true },
    });
    if (provider === null) {
      throw notFound();
    }
    return provider.id;
  }

  /** Full view of one provider; used by the provider itself and by staff review. */
  async load(tx: Db, providerId: string): Promise<ProviderResponse> {
    const provider = await tx.provider.findUnique({
      where: { id: providerId },
      select: {
        id: true,
        kind: true,
        tenantId: true,
        ownerUserId: true,
        displayName: true,
        status: true,
        phone: true,
        homeRegion: true,
        remoteOk: true,
        acceptingWork: true,
        skills: {
          select: { skillCode: true, experience: true, skill: { select: { name: true } } },
          orderBy: { skillCode: 'asc' },
        },
        regions: {
          select: { regionCode: true, region: { select: { name: true } } },
          orderBy: { regionCode: 'asc' },
        },
        workingHours: {
          select: { weekday: true, startMinute: true, endMinute: true },
          orderBy: [{ weekday: 'asc' }, { startMinute: 'asc' }],
        },
        timeOff: {
          where: { endsAt: { gt: new Date() } },
          select: { id: true, startsAt: true, endsAt: true, reason: true },
          orderBy: { startsAt: 'asc' },
        },
        application: {
          select: {
            id: true,
            status: true,
            decisionReason: true,
            submittedAt: true,
            events: {
              select: { fromStatus: true, toStatus: true, reason: true, occurredAt: true },
              orderBy: { occurredAt: 'asc' },
            },
          },
        },
      },
    });
    const application = provider?.application ?? null;
    if (provider === null || application === null) {
      throw notFound();
    }
    const purposes = [...PROVIDER_DOCUMENT_PURPOSES[provider.kind]];
    const documents = await tx.fileMetadata.findMany({
      where: {
        purpose: { in: purposes },
        ...(provider.kind === 'COMPANY'
          ? { tenantId: provider.tenantId ?? '' }
          : { ownerUserId: provider.ownerUserId ?? '' }),
      },
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
    const business =
      provider.kind === 'COMPANY' && provider.tenantId !== null
        ? await tx.organisationProfile.findUnique({
            where: { tenantId: provider.tenantId },
            select: {
              legalName: true,
              registrationNumber: true,
              registrationNumberAbsentWhy: true,
              kraPin: true,
              kraPinAbsentWhy: true,
            },
          })
        : null;
    return {
      providerId: provider.id,
      kind: provider.kind,
      displayName: provider.displayName,
      status: provider.status,
      phone: provider.phone,
      homeRegion: provider.homeRegion,
      remoteOk: provider.remoteOk,
      acceptingWork: provider.acceptingWork,
      application: {
        applicationId: application.id,
        status: application.status,
        decisionReason: application.decisionReason,
        submittedAt: application.submittedAt?.toISOString() ?? null,
        missing: missingFor(provider, documents, business),
        history: application.events.map((event) => ({
          ...event,
          occurredAt: event.occurredAt.toISOString(),
        })),
      },
      skills: provider.skills.map((s) => ({
        code: s.skillCode,
        name: s.skill.name,
        experience: s.experience,
      })),
      regions: provider.regions.map((r) => ({ code: r.regionCode, name: r.region.name })),
      workingHours: provider.workingHours.map((h) => ({
        weekday: h.weekday,
        start: toClock(h.startMinute),
        end: toClock(h.endMinute),
      })),
      timeOff: provider.timeOff.map((t) => ({
        id: t.id,
        startsAt: t.startsAt.toISOString(),
        endsAt: t.endsAt.toISOString(),
        reason: t.reason,
      })),
      documents: documents.map((d) => ({ ...d, createdAt: d.createdAt.toISOString() })),
      business,
    };
  }
}

/** What still blocks submission (Phase 5 plan §2.2). */
export function missingFor(
  provider: {
    kind: 'COMPANY' | 'INDIVIDUAL';
    phone: string | null;
    homeRegion: string | null;
    skills: readonly unknown[];
    regions: readonly unknown[];
  },
  documents: readonly { purpose: string; status: string }[],
  business: {
    legalName: string;
    registrationNumber: string | null;
    registrationNumberAbsentWhy: string | null;
    kraPin: string | null;
    kraPinAbsentWhy: string | null;
  } | null,
): string[] {
  const missing: string[] = [];
  const usable = (purpose: string) =>
    documents.some((document) => document.purpose === purpose && document.status !== 'REJECTED');
  if (provider.phone === null) missing.push('phone');
  if (provider.homeRegion === null) missing.push('homeRegion');
  if (provider.skills.length === 0) missing.push('skills');
  if (provider.regions.length === 0) missing.push('regions');
  if (provider.kind === 'COMPANY') {
    if ((business?.registrationNumber ?? business?.registrationNumberAbsentWhy ?? null) === null) {
      missing.push('registrationNumber');
    }
    if ((business?.kraPin ?? business?.kraPinAbsentWhy ?? null) === null) {
      missing.push('kraPin');
    }
    if (!usable('provider.company_document')) missing.push('companyDocuments');
  } else {
    if (!usable('provider.identity')) missing.push('identityDocument');
    if (!usable('provider.certificate')) missing.push('skillEvidence');
  }
  return missing;
}

async function assertRegions(tx: Db, codes: readonly string[]): Promise<void> {
  if (codes.length === 0) {
    return;
  }
  const known = await tx.region.count({ where: { code: { in: [...codes] }, active: true } });
  if (known !== new Set(codes).size) {
    throw conflict('region_unknown');
  }
}
