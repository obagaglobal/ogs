import { Injectable } from '@nestjs/common';
import {
  JOB_PAGE_SIZE,
  type dispatchTicketSchema,
  type JobCandidates,
  type jobBriefInputSchema,
  type sendOfferSchema,
  type StaffJob,
  type StaffJobQueue,
  type StaffJobSummary,
  type staffJobFiltersSchema,
} from '@ogs/contracts';
import type { z } from 'zod';
import { AuditService, type AuditRequestMeta } from '../audit/audit.service.js';
import { nextNumber } from '../common/document-numbers.js';
import { conflict, notFound, unprocessable } from '../common/domain-error.js';
import { Prisma, TenantDb, type Db } from '../database/index.js';
import { OutboxService } from '../events/outbox.service.js';
import { FileService, type Download } from '../files/file.service.js';
import { EligibilityService } from '../providers/eligibility.service.js';
import { requirePermission, type JobStaff } from './job-actors.js';
import { JobLifecycleService } from './job-lifecycle.service.js';
import {
  changeJob,
  isEligibilityViolation,
  moveJob,
  notEligible,
  writeJobEvent,
  type JobRef,
} from './job-support.js';
import { loadStaffJob, STAFF_SUMMARY_SELECT, staffSummary, summaryPeople } from './job-views.js';
import { requireJobCommand } from './transitions.js';

type Filters = z.output<typeof staffJobFiltersSchema>;
type Brief = z.output<typeof jobBriefInputSchema>;
type Dispatch = z.output<typeof dispatchTicketSchema>;
type Offer = z.output<typeof sendOfferSchema>;

const date = (value: string | null) => (value === null ? null : new Date(`${value}T00:00:00Z`));

/**
 * The dispatch desk (Phase 9 plan §2.6). Every method runs in an elevated
 * `platform` context and checks the permission the transition table names.
 * Audit rows of internal decisions (offers, declines, reassignment reasons)
 * carry no tenant, so an organisation's own audit log never shows them
 * (as ADR-059); customer-visible changes carry the customer's tenant.
 */
@Injectable()
export class StaffJobsService {
  constructor(
    private readonly db: TenantDb,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly files: FileService,
    private readonly eligibility: EligibilityService,
    private readonly lifecycle: JobLifecycleService,
  ) {}

  async queue(staff: JobStaff, filters: Filters): Promise<StaffJobQueue> {
    return this.db.run(staff.ctx, async (tx) => {
      const where: Prisma.JobWhereInput = {
        ...(filters.status === undefined
          ? { status: { notIn: ['COMPLETED', 'CANCELLED'] } }
          : { status: filters.status }),
        ...(filters.source === 'ORDER' ? { serviceOrderId: { not: null } } : {}),
        ...(filters.source === 'TICKET' ? { ticketId: { not: null } } : {}),
        ...(filters.county === undefined ? {} : { regionCode: filters.county }),
      };
      const [rows, total, queued, offered, inProgress, awaitingConfirmation] = await Promise.all([
        tx.job.findMany({
          where,
          select: STAFF_SUMMARY_SELECT,
          orderBy: { createdAt: 'asc' },
          skip: (filters.page - 1) * JOB_PAGE_SIZE,
          take: JOB_PAGE_SIZE,
        }),
        tx.job.count({ where }),
        tx.job.count({ where: { status: 'QUEUED' } }),
        tx.job.count({ where: { status: 'OFFERED' } }),
        tx.job.count({
          where: { status: { in: ['ASSIGNED', 'ON_THE_WAY', 'IN_PROGRESS', 'PAUSED'] } },
        }),
        tx.job.count({ where: { status: 'AWAITING_CONFIRMATION' } }),
      ]);
      const people = await this.people(tx, summaryPeople(rows));
      return {
        jobs: rows.map((row) => staffSummary(row, people)),
        total,
        page: filters.page,
        pageSize: JOB_PAGE_SIZE,
        counts: { queued, offered, inProgress, awaitingConfirmation },
      };
    });
  }

  /** The current (or latest) job of an order or a ticket, for the staff order and ticket pages. */
  async bySource(
    staff: JobStaff,
    kind: 'ORDER' | 'TICKET',
    id: string,
  ): Promise<{ job: StaffJobSummary | null }> {
    return this.db.run(staff.ctx, async (tx) => {
      const row = await tx.job.findFirst({
        where: kind === 'ORDER' ? { serviceOrderId: id } : { ticketId: id },
        orderBy: { createdAt: 'desc' },
        select: STAFF_SUMMARY_SELECT,
      });
      if (row === null) {
        return { job: null };
      }
      return { job: staffSummary(row, await this.people(tx, summaryPeople([row]))) };
    });
  }

  async detail(staff: JobStaff, id: string): Promise<StaffJob> {
    return this.db.run(staff.ctx, async (tx) => loadStaffJob(tx, id, staff.permissions));
  }

  /**
   * Ranked suggestions (ADR-013, ADR-035): providers from EligibilityService,
   * kept only if app.can_take_job agrees (one definition of eligibility, P9-11),
   * and internal technicians who can take the job.
   */
  async candidates(staff: JobStaff, id: string): Promise<JobCandidates> {
    requirePermission(staff, 'ticket.assign');
    const job = await this.db.run(staff.ctx, async (tx) =>
      tx.job.findUnique({
        where: { id },
        select: {
          regionCode: true,
          remoteAllowed: true,
          allowIndividual: true,
          allowCompany: true,
          windowFrom: true,
          skills: { select: { skillCode: true, minExperience: true } },
        },
      }),
    );
    if (job === null) {
      throw notFound();
    }
    const kinds: ('COMPANY' | 'INDIVIDUAL')[] = [];
    if (job.allowCompany) kinds.push('COMPANY');
    if (job.allowIndividual) kinds.push('INDIVIDUAL');
    const providers =
      kinds.length === 0
        ? []
        : await this.eligibility.find(staff.ctx, {
            skillCodes: job.skills.map((s) => s.skillCode),
            minExperience: Object.fromEntries(
              job.skills.map((s) => [s.skillCode, s.minExperience]),
            ),
            regionCode: job.regionCode,
            remoteAllowed: job.remoteAllowed,
            kinds,
          });
    return this.db.run(staff.ctx, async (tx) => {
      const allowed: typeof providers = [];
      for (const candidate of providers) {
        if (await canTake(tx, id, candidate.kind, candidate.providerId, null)) {
          allowed.push(candidate);
        }
      }
      const platform = await tx.tenant.findFirst({
        where: { kind: 'PLATFORM' },
        select: { id: true },
      });
      const members =
        platform === null
          ? []
          : await tx.membership.findMany({
              where: {
                tenantId: platform.id,
                status: 'ACTIVE',
                roles: {
                  some: {
                    role: { permissions: { some: { permissionCode: 'assignment.respond' } } },
                  },
                },
              },
              select: { userId: true, user: { select: { email: true } } },
            });
      const internal: { id: string; label: string }[] = [];
      for (const member of members) {
        if (await canTake(tx, id, 'INTERNAL', null, member.userId)) {
          internal.push({ id: member.userId, label: member.user.email });
        }
      }
      return { internal, providers: allowed };
    });
  }

  /** Staff send a technician to a ticket (plan §2.4, P9-7): a new QUEUED job with a brief. */
  async dispatchTicket(
    staff: JobStaff,
    ticketId: string,
    input: Dispatch,
    meta: AuditRequestMeta,
  ): Promise<StaffJob> {
    requirePermission(staff, 'ticket.assign');
    return this.db.run(staff.ctx, async (tx) => {
      const ticket = await tx.ticket.findUnique({
        where: { id: ticketId },
        select: { status: true, customerTenantId: true, customerUserId: true },
      });
      if (ticket === null) {
        throw notFound();
      }
      if (ticket.status === 'CLOSED' || ticket.status === 'RESOLVED') {
        throw conflict('ticket_not_open');
      }
      const open = await tx.job.count({
        where: { ticketId, status: { notIn: ['COMPLETED', 'CANCELLED'] } },
      });
      if (open > 0) {
        throw conflict('job_already_open');
      }
      if (input.serviceId !== null) {
        const service = await tx.service.count({ where: { id: input.serviceId } });
        if (service !== 1) {
          throw unprocessable('service_unknown');
        }
      }
      const codes = [...new Set(input.skills.map((s) => s.code))];
      if (
        codes.length > 0 &&
        (await tx.skill.count({ where: { code: { in: codes } } })) !== codes.length
      ) {
        throw unprocessable('skill_unknown');
      }
      const tenant =
        ticket.customerTenantId === null
          ? null
          : await tx.tenant.findUnique({
              where: { id: ticket.customerTenantId },
              select: { name: true },
            });
      const job = await tx.job.create({
        data: {
          number: await nextNumber(tx, 'JOB'),
          ticketId,
          customerTenantId: ticket.customerTenantId,
          customerUserId: ticket.customerUserId,
          customerDisplay: tenant?.name ?? 'Private customer',
          serviceId: input.serviceId,
          title: input.title,
          brief: input.brief,
          allowInternal: input.channels.internal,
          allowIndividual: input.channels.individual,
          allowCompany: input.channels.company,
          onSite: input.onSite,
          remoteAllowed: input.remoteAllowed,
          regionCode: input.regionCode,
          siteAddress: input.siteAddress,
          siteContactName: input.siteContactName,
          siteContactPhone: input.siteContactPhone,
          windowFrom: date(input.windowFrom),
          windowTo: date(input.windowTo),
          createdBy: staff.userId,
        },
        select: { id: true, number: true },
      });
      if (input.skills.length > 0) {
        await tx.jobSkill.createMany({
          data: input.skills.map((s) => ({
            jobId: job.id,
            skillCode: s.code,
            minExperience: s.minExperience,
          })),
          skipDuplicates: true,
        });
      }
      await writeJobEvent(tx, job.id, 'dispatchTicket', { toValue: 'QUEUED' });
      await this.audit.record(tx, {
        action: 'job.created',
        tenantId: ticket.customerTenantId,
        entityType: 'job',
        entityId: job.id,
        request: meta,
        metadata: { number: job.number, ticketId },
      });
      await this.outbox.publish(tx, {
        type: 'jobs.queued',
        tenantId: ticket.customerTenantId,
        payload: { jobId: job.id },
      });
      return loadStaffJob(tx, job.id, staff.permissions);
    });
  }

  async editBrief(
    staff: JobStaff,
    id: string,
    input: Brief,
    meta: AuditRequestMeta,
  ): Promise<StaffJob> {
    requirePermission(staff, 'ticket.assign');
    return this.db.run(staff.ctx, async (tx) => {
      const job = await this.load(tx, id, input.version);
      requireJobCommand('editBrief', job.status);
      await changeJob(tx, job, 'editBrief', {
        title: input.title,
        brief: input.brief,
        siteAddress: input.siteAddress,
        siteContactName: input.siteContactName,
        siteContactPhone: input.siteContactPhone,
        windowFrom: date(input.windowFrom),
        windowTo: date(input.windowTo),
      });
      await this.audit.record(tx, {
        action: 'job.brief_edited',
        entityType: 'job',
        entityId: id,
        request: meta,
      });
      return loadStaffJob(tx, id, staff.permissions);
    });
  }

  /** Sends the job to ONE eligible assignee (P9-4); the job is OFFERED until they answer. */
  async offer(
    staff: JobStaff,
    id: string,
    input: Offer,
    meta: AuditRequestMeta,
  ): Promise<StaffJob> {
    requirePermission(staff, 'ticket.assign');
    try {
      return await this.db.run(staff.ctx, async (tx) => {
        const job = await this.load(tx, id, input.version);
        requireJobCommand('offer', job.status);
        const target = await this.target(tx, input.assignee);
        if (
          !(await canTake(tx, id, input.assignee.kind, target.providerId, target.technicianUserId))
        ) {
          throw notEligible();
        }
        const expiresAt = new Date(Date.now() + input.windowMinutes * 60_000);
        const offer = await tx.jobOffer.create({
          data: {
            jobId: id,
            kind: input.assignee.kind,
            providerId: target.providerId,
            assigneeTenantId: target.tenantId,
            technicianUserId: target.technicianUserId,
            offeredBy: staff.userId,
            expiresAt,
          },
          select: { id: true },
        });
        await moveJob(tx, job, 'offer', 'OFFERED');
        await this.audit.record(tx, {
          action: 'job.offered',
          entityType: 'job',
          entityId: id,
          request: meta,
          metadata: {
            offerId: offer.id,
            kind: input.assignee.kind,
            windowMinutes: input.windowMinutes,
          },
        });
        await this.outbox.publish(tx, {
          type: 'jobs.offered',
          payload: { jobId: id, offerId: offer.id },
        });
        await this.outbox.publish(tx, {
          type: 'jobs.offer_expire',
          payload: { offerId: offer.id },
          availableAt: expiresAt,
        });
        return loadStaffJob(tx, id, staff.permissions);
      });
    } catch (error) {
      if (isEligibilityViolation(error)) {
        throw notEligible();
      }
      throw error;
    }
  }

  async withdraw(
    staff: JobStaff,
    id: string,
    offerId: string,
    version: number,
    meta: AuditRequestMeta,
  ): Promise<StaffJob> {
    requirePermission(staff, 'ticket.assign');
    return this.db.run(staff.ctx, async (tx) => {
      const job = await this.load(tx, id, version);
      requireJobCommand('withdraw', job.status);
      const changed = await tx.jobOffer.updateMany({
        where: { id: offerId, jobId: id, status: 'PENDING' },
        data: {
          status: 'WITHDRAWN',
          respondedAt: new Date(),
          respondedBy: staff.userId,
          version: { increment: 1 },
        },
      });
      if (changed.count !== 1) {
        throw conflict('offer_not_pending');
      }
      await moveJob(tx, job, 'withdraw', 'QUEUED');
      await this.audit.record(tx, {
        action: 'job.offer_withdrawn',
        entityType: 'job',
        entityId: id,
        request: meta,
        metadata: { offerId },
      });
      await this.outbox.publish(tx, {
        type: 'jobs.offer_withdrawn',
        payload: { jobId: id, offerId },
      });
      return loadStaffJob(tx, id, staff.permissions);
    });
  }

  /** Takes the job from its assignee (reason required); it returns to the queue. */
  async reassign(
    staff: JobStaff,
    id: string,
    version: number,
    reason: string,
    meta: AuditRequestMeta,
  ): Promise<StaffJob> {
    requirePermission(staff, 'ticket.assign');
    return this.db.run(staff.ctx, async (tx) => {
      const job = await this.load(tx, id, version);
      requireJobCommand('reassign', job.status);
      const active = await this.endActive(tx, id, staff.userId, 'REASSIGNED', reason);
      await moveJob(
        tx,
        job,
        'reassign',
        'QUEUED',
        { assignedAt: null },
        {
          assignmentId: active,
          reason,
        },
      );
      await this.audit.record(tx, {
        action: 'job.reassigned',
        entityType: 'job',
        entityId: id,
        reason,
        request: meta,
        metadata: { assignmentId: active },
      });
      if (active !== null) {
        await this.outbox.publish(tx, {
          type: 'jobs.removed',
          payload: { jobId: id, assignmentId: active },
        });
      }
      return loadStaffJob(tx, id, staff.permissions);
    });
  }

  async cancel(
    staff: JobStaff,
    id: string,
    version: number,
    reason: string,
    meta: AuditRequestMeta,
  ): Promise<StaffJob> {
    requirePermission(staff, 'ticket.assign');
    return this.db.run(staff.ctx, async (tx) => {
      const job = await this.load(tx, id, version);
      requireJobCommand('cancel', job.status);
      await tx.jobOffer.updateMany({
        where: { jobId: id, status: 'PENDING' },
        data: { status: 'WITHDRAWN', respondedAt: new Date(), respondedBy: staff.userId },
      });
      const active = await this.endActive(tx, id, staff.userId, 'JOB_CANCELLED', reason);
      await moveJob(
        tx,
        job,
        'cancel',
        'CANCELLED',
        { cancelReason: reason },
        {
          assignmentId: active,
          reason,
        },
      );
      await this.audit.record(tx, {
        action: 'job.cancelled',
        tenantId: job.customerTenantId,
        entityType: 'job',
        entityId: id,
        reason,
        request: meta,
      });
      await this.outbox.publish(tx, {
        type: 'jobs.cancelled',
        tenantId: job.customerTenantId,
        payload: { jobId: id },
      });
      if (active !== null) {
        await this.outbox.publish(tx, {
          type: 'jobs.removed',
          payload: { jobId: id, assignmentId: active },
        });
      }
      return loadStaffJob(tx, id, staff.permissions);
    });
  }

  /** P9-7: a service manager confirms on the customer's behalf (reason, audited). */
  async confirm(
    staff: JobStaff,
    id: string,
    version: number,
    reason: string,
    meta: AuditRequestMeta,
  ): Promise<StaffJob> {
    requirePermission(staff, 'ticket.confirm_completion');
    const result = await this.db.run(staff.ctx, async (tx) => {
      const job = await this.load(tx, id, version);
      requireJobCommand('staffConfirm', job.status);
      const decided = await tx.jobCompletion.updateMany({
        where: { jobId: id, outcome: null },
        data: {
          outcome: 'STAFF_CONFIRMED',
          decidedAt: new Date(),
          decidedBy: staff.userId,
          decisionReason: reason,
        },
      });
      if (decided.count !== 1) {
        throw conflict('no_open_report');
      }
      const active = await this.endActive(tx, id, staff.userId, 'JOB_COMPLETED', null);
      await moveJob(
        tx,
        job,
        'staffConfirm',
        'COMPLETED',
        { confirmedAt: new Date() },
        {
          assignmentId: active,
          reason,
        },
      );
      await this.audit.record(tx, {
        action: 'job.confirmed_by_staff',
        tenantId: job.customerTenantId,
        entityType: 'job',
        entityId: id,
        reason,
        request: meta,
      });
      await this.outbox.publish(tx, {
        type: 'jobs.completed',
        tenantId: job.customerTenantId,
        payload: { jobId: id },
      });
      await this.outbox.publish(tx, {
        type: 'jobs.order_sync',
        tenantId: job.customerTenantId,
        payload: { jobId: id },
      });
      return loadStaffJob(tx, id, staff.permissions);
    });
    await this.lifecycle.syncOrder(id);
    return result;
  }

  async photo(staff: JobStaff, id: string, photoId: string): Promise<Download> {
    const fileId = await this.db.run(staff.ctx, async (tx) => {
      const evidence = await tx.jobEvidence.findFirst({
        where: { id: photoId, jobId: id },
        select: { fileId: true },
      });
      if (evidence === null) {
        throw notFound();
      }
      return evidence.fileId;
    });
    return this.files.evidenceDownloadUrl(staff.ctx, fileId);
  }

  // ---------------------------------------------------------------- helpers

  private async people(tx: Db, ids: readonly (string | null)[]): Promise<Map<string, string>> {
    const unique = [...new Set(ids.filter((value): value is string => value !== null))];
    const users =
      unique.length === 0
        ? []
        : await tx.appUser.findMany({
            where: { id: { in: unique } },
            select: { id: true, email: true },
          });
    return new Map(users.map((user) => [user.id, user.email]));
  }

  private async load(
    tx: Db,
    id: string,
    version: number,
  ): Promise<JobRef & { customerTenantId: string | null }> {
    const job = await tx.job.findUnique({
      where: { id },
      select: { id: true, status: true, version: true, customerTenantId: true },
    });
    if (job === null) {
      throw notFound();
    }
    if (job.version !== version) {
      throw conflict('stale_version');
    }
    return job;
  }

  /** Ends the ACTIVE assignment (if any) and returns its id. */
  private async endActive(
    tx: Db,
    jobId: string,
    userId: string,
    reason: 'REASSIGNED' | 'JOB_CANCELLED' | 'JOB_COMPLETED',
    note: string | null,
  ): Promise<string | null> {
    const active = await tx.jobAssignment.findFirst({
      where: { jobId, status: 'ACTIVE' },
      select: { id: true },
    });
    if (active === null) {
      return null;
    }
    await tx.jobAssignment.update({
      where: { id: active.id },
      data: {
        status: 'ENDED',
        endReason: reason,
        endNote: note,
        endedAt: new Date(),
        endedBy: userId,
      },
      select: { id: true },
    });
    return active.id;
  }

  /** Resolves an offer's addressee: the provider (and company tenant) or the technician. */
  private async target(
    tx: Db,
    assignee: Offer['assignee'],
  ): Promise<{
    providerId: string | null;
    tenantId: string | null;
    technicianUserId: string | null;
  }> {
    if (assignee.kind === 'INTERNAL') {
      const platform = await tx.tenant.findFirst({
        where: { kind: 'PLATFORM' },
        select: { id: true },
      });
      if (platform === null) {
        throw notEligible();
      }
      return {
        providerId: null,
        tenantId: platform.id,
        technicianUserId: assignee.technicianUserId,
      };
    }
    const provider = await tx.provider.findUnique({
      where: { id: assignee.providerId },
      select: { kind: true, tenantId: true },
    });
    if (provider?.kind !== assignee.kind) {
      throw notEligible();
    }
    return { providerId: assignee.providerId, tenantId: provider.tenantId, technicianUserId: null };
  }
}

/** The database's eligibility answer (app.can_take_job, plan §2.3). */
export async function canTake(
  tx: Db,
  jobId: string,
  kind: 'INTERNAL' | 'INDIVIDUAL' | 'COMPANY',
  providerId: string | null,
  technicianUserId: string | null,
): Promise<boolean> {
  const rows = await tx.$queryRaw<{ ok: boolean }[]>`
    SELECT app.can_take_job(${jobId}::uuid, ${kind}::"AssigneeKind", ${providerId}::uuid,
                            ${technicianUserId}::uuid) AS ok`;
  return rows[0]?.ok === true;
}
