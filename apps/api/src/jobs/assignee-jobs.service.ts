import { Injectable } from '@nestjs/common';
import {
  CONFIRM_WINDOW_MS,
  JOB_PAGE_SIZE,
  MAX_JOB_PHOTOS,
  areaOf,
  assigneeJobListSchema,
  assigneeOfferSchema,
  type AssigneeJob,
  type AssigneeJobList,
  type AssigneeOffer,
  type assigneeJobFiltersSchema,
  type completionInputSchema,
  type declineOfferSchema,
} from '@ogs/contracts';
import type { z } from 'zod';
import { AuditService, type AuditRequestMeta } from '../audit/audit.service.js';
import { conflict, forbiddenRule, notFound, unprocessable } from '../common/domain-error.js';
import { TenantDb, type Db } from '../database/index.js';
import { OutboxService } from '../events/outbox.service.js';
import { FileService, type Download, type StoredFile } from '../files/file.service.js';
import { RateLimiter } from '../identity/rate-limiter.js';
import { idempotent } from '../orders/order-support.js';
import { requirePermission, type JobAssignee } from './job-actors.js';
import { JobLifecycleService } from './job-lifecycle.service.js';
import { isEligibilityViolation, moveJob, notEligible, writeJobEvent } from './job-support.js';
import { cardOf, companyTechnicians, loadAssigneeJob, technicianFirstName } from './job-views.js';
import { canTake } from './staff-jobs.service.js';
import { requireJobCommand, type JobCommand } from './transitions.js';

type Filters = z.output<typeof assigneeJobFiltersSchema>;
type Decline = z.output<typeof declineOfferSchema>;
type Completion = z.output<typeof completionInputSchema>;

const day = (date: Date | null) => (date === null ? null : date.toISOString().slice(0, 10));

/** Status moves an assignee makes from the job page (plan §2.4). */
export type ProgressCommand = Extract<JobCommand, 'onTheWay' | 'start' | 'pause' | 'resume'>;
const PROGRESS_TARGET: Record<ProgressCommand, 'ON_THE_WAY' | 'IN_PROGRESS' | 'PAUSED'> = {
  onTheWay: 'ON_THE_WAY',
  start: 'IN_PROGRESS',
  pause: 'PAUSED',
  resume: 'IN_PROGRESS',
};

/**
 * The field side of jobs (Phase 9 plan §2.6): offers, status, notes, photos,
 * completion reports and technician changes. Everything runs in the caller's
 * own context: RLS shows an assignee only the job they hold (or are offered),
 * and only while they hold it (T3, T4). Audit rows and outbox events written
 * here carry no tenant: the customer's tenant is not this context's to write.
 */
@Injectable()
export class AssigneeJobsService {
  constructor(
    private readonly db: TenantDb,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly files: FileService,
    private readonly limiter: RateLimiter,
    private readonly lifecycle: JobLifecycleService,
  ) {}

  async list(assignee: JobAssignee, filters: Filters): Promise<AssigneeJobList> {
    return this.db.run(assignee.ctx, async (tx) => {
      const now = new Date();
      const offerWhere = { status: 'PENDING' as const, expiresAt: { gt: now } };
      const activeWhere = { status: 'ACTIVE' as const, ...this.mine(assignee) };
      const [offers, active] = await Promise.all([
        tx.jobOffer.count({ where: offerWhere }),
        tx.jobAssignment.count({ where: activeWhere }),
      ]);
      const skip = (filters.page - 1) * JOB_PAGE_SIZE;
      const base = {
        view: filters.view,
        page: filters.page,
        pageSize: JOB_PAGE_SIZE,
        counts: { offers, active },
      };
      if (filters.view === 'offers') {
        const rows = await tx.jobOffer.findMany({
          where: offerWhere,
          orderBy: { expiresAt: 'asc' },
          skip,
          take: JOB_PAGE_SIZE,
          select: { id: true, expiresAt: true, job: { select: CARD_SELECT } },
        });
        return assigneeJobListSchema.parse({
          ...base,
          items: rows.map((row) => cardOf(row.job, { id: row.id, expiresAt: row.expiresAt })),
          done: [],
          total: offers,
        });
      }
      if (filters.view === 'active') {
        const rows = await tx.jobAssignment.findMany({
          where: activeWhere,
          orderBy: { startedAt: 'asc' },
          skip,
          take: JOB_PAGE_SIZE,
          select: { job: { select: CARD_SELECT } },
        });
        return assigneeJobListSchema.parse({
          ...base,
          items: rows.map((row) => cardOf(row.job, null)),
          done: [],
          total: active,
        });
      }
      // Done: the assignment's own copies only. The job itself is out of reach.
      const doneWhere = { status: 'ENDED' as const, ...this.mine(assignee) };
      const [rows, total] = await Promise.all([
        tx.jobAssignment.findMany({
          where: doneWhere,
          orderBy: { endedAt: 'desc' },
          skip,
          take: JOB_PAGE_SIZE,
          select: {
            id: true,
            jobNumber: true,
            title: true,
            startedAt: true,
            endedAt: true,
            endReason: true,
          },
        }),
        tx.jobAssignment.count({ where: doneWhere }),
      ]);
      return assigneeJobListSchema.parse({
        ...base,
        items: [],
        done: rows.map((row) => ({
          assignmentId: row.id,
          number: row.jobNumber,
          title: row.title,
          startedAt: row.startedAt.toISOString(),
          endedAt: row.endedAt?.toISOString() ?? null,
          endReason: row.endReason,
        })),
        total,
      });
    });
  }

  /** The offer before accepting (plan §2.5): the brief and the area, no address or contact. */
  async offer(assignee: JobAssignee, offerId: string): Promise<AssigneeOffer> {
    requirePermission(assignee, 'assignment.respond');
    return this.db.run(assignee.ctx, async (tx) => {
      const offer = await this.pendingOffer(tx, offerId);
      const job = await tx.job.findUnique({
        where: { id: offer.jobId },
        select: {
          id: true,
          number: true,
          title: true,
          brief: true,
          onSite: true,
          regionCode: true,
          siteAddress: true,
          windowFrom: true,
          windowTo: true,
          skills: {
            select: { skillCode: true, minExperience: true, skill: { select: { name: true } } },
          },
        },
      });
      if (job === null) {
        throw notFound();
      }
      const technicians =
        offer.kind === 'COMPANY' && assignee.tenantId !== undefined
          ? await companyTechnicians(tx, assignee.tenantId)
          : [];
      return assigneeOfferSchema.parse({
        offerId: offer.id,
        jobId: job.id,
        number: job.number,
        title: job.title,
        brief: job.brief,
        skills: job.skills.map((s) => ({
          code: s.skillCode,
          name: s.skill.name,
          minExperience: s.minExperience,
        })),
        onSite: job.onSite,
        regionCode: job.regionCode,
        area: areaOf(job.siteAddress),
        windowFrom: day(job.windowFrom),
        windowTo: day(job.windowTo),
        expiresAt: offer.expiresAt.toISOString(),
        kind: offer.kind,
        technicians,
      });
    });
  }

  /**
   * Accepts an offer (plan §2.4). Order matters for RLS: the job moves to
   * ASSIGNED and the assignment is inserted while the offer is still PENDING
   * (the job is visible through it), then the offer becomes ACCEPTED.
   */
  async accept(
    assignee: JobAssignee,
    offerId: string,
    technicianUserId: string | undefined,
    key: string,
    meta: AuditRequestMeta,
  ): Promise<AssigneeJob> {
    requirePermission(assignee, 'assignment.respond');
    await this.limiter.consume('jobCommandsPerUser', assignee.userId);
    try {
      const result = await this.db.run(assignee.ctx, async (tx) =>
        idempotent(
          tx,
          {
            key,
            userId: assignee.userId,
            scope: assignee.scope,
            route: `jobs/offers/${offerId}/accept`,
            body: { technicianUserId: technicianUserId ?? null },
          },
          async () => {
            const offer = await this.pendingOffer(tx, offerId);
            const job = await tx.job.findUnique({
              where: { id: offer.jobId },
              select: {
                id: true,
                status: true,
                version: true,
                number: true,
                title: true,
                customerTenantId: true,
                customerUserId: true,
              },
            });
            if (job === null) {
              throw notFound();
            }
            requireJobCommand('accept', job.status);
            const technician = await this.technicianFor(tx, assignee, offer, technicianUserId);
            if (
              !(await canTake(tx, job.id, offer.kind, offer.providerId, offer.technicianUserId))
            ) {
              throw notEligible();
            }
            const now = new Date();
            // The job first (visible through the PENDING offer); its ONE event is
            // written below, once the assignment it belongs to exists.
            const changed = await tx.job.updateMany({
              where: { id: job.id, status: job.status, version: job.version },
              data: { status: 'ASSIGNED', assignedAt: now, version: { increment: 1 } },
            });
            if (changed.count !== 1) {
              throw conflict('stale_version');
            }
            const assignment = await tx.jobAssignment.create({
              data: {
                jobId: job.id,
                offerId: offer.id,
                jobNumber: job.number,
                title: job.title,
                customerTenantId: job.customerTenantId,
                customerUserId: job.customerUserId,
                kind: offer.kind,
                providerId: offer.providerId,
                assigneeTenantId: offer.assigneeTenantId,
                technicianUserId: technician.userId,
                technicianName: technician.firstName,
              },
              select: { id: true },
            });
            await tx.jobOffer.update({
              where: { id: offer.id },
              data: {
                status: 'ACCEPTED',
                respondedAt: now,
                respondedBy: assignee.userId,
                version: { increment: 1 },
              },
              select: { id: true },
            });
            await writeJobEvent(tx, job.id, 'accept', {
              assignmentId: assignment.id,
              fromValue: job.status,
              toValue: 'ASSIGNED',
            });
            await this.audit.record(tx, {
              action: 'job.offer_accepted',
              entityType: 'job',
              entityId: job.id,
              request: meta,
              metadata: { offerId: offer.id, assignmentId: assignment.id },
            });
            await this.outbox.publish(tx, {
              type: 'jobs.assigned',
              payload: { jobId: job.id, assignmentId: assignment.id },
            });
            await this.outbox.publish(tx, { type: 'jobs.order_sync', payload: { jobId: job.id } });
            return loadAssigneeJob(tx, assignee, job.id);
          },
        ),
      );
      // Immediately (the jobs.order_sync event is the guarantee); also on a replay.
      await this.lifecycle.syncOrder(result.id);
      return result;
    } catch (error) {
      if (isEligibilityViolation(error)) {
        throw notEligible();
      }
      throw error;
    }
  }

  /** Declines an offer with a reason (P9-4); the job returns to the queue. */
  async decline(
    assignee: JobAssignee,
    offerId: string,
    input: Decline,
    key: string,
    meta: AuditRequestMeta,
  ): Promise<{ declined: true }> {
    requirePermission(assignee, 'assignment.respond');
    await this.limiter.consume('jobCommandsPerUser', assignee.userId);
    return this.db.run(assignee.ctx, async (tx) =>
      idempotent(
        tx,
        {
          key,
          userId: assignee.userId,
          scope: assignee.scope,
          route: `jobs/offers/${offerId}/decline`,
          body: input,
        },
        async () => {
          const offer = await this.pendingOffer(tx, offerId);
          const job = await tx.job.findUnique({
            where: { id: offer.jobId },
            select: { id: true, status: true, version: true },
          });
          if (job === null) {
            throw notFound();
          }
          requireJobCommand('decline', job.status);
          // The job first, while the offer still makes it visible.
          await moveJob(
            tx,
            job,
            'decline',
            'QUEUED',
            {},
            {
              reason: input.note ?? input.reason,
            },
          );
          await tx.jobOffer.update({
            where: { id: offer.id },
            data: {
              status: 'DECLINED',
              declineReason: input.reason,
              declineNote: input.note ?? null,
              respondedAt: new Date(),
              respondedBy: assignee.userId,
              version: { increment: 1 },
            },
            select: { id: true },
          });
          await this.audit.record(tx, {
            action: 'job.offer_declined',
            entityType: 'job',
            entityId: job.id,
            reason: input.note ?? input.reason,
            request: meta,
            metadata: { offerId: offer.id, reason: input.reason },
          });
          await this.outbox.publish(tx, {
            type: 'jobs.offer_declined',
            payload: { jobId: job.id, offerId: offer.id },
          });
          return { declined: true as const };
        },
      ),
    );
  }

  async detail(assignee: JobAssignee, jobId: string): Promise<AssigneeJob> {
    return this.db.run(assignee.ctx, async (tx) => loadAssigneeJob(tx, assignee, jobId));
  }

  /** On the way, start, pause (reason), resume (plan §2.4). */
  async progress(
    assignee: JobAssignee,
    jobId: string,
    command: ProgressCommand,
    version: number,
    reason: string | null,
    key: string,
    meta: AuditRequestMeta,
  ): Promise<AssigneeJob> {
    requirePermission(assignee, 'ticket.update_progress');
    await this.limiter.consume('jobCommandsPerUser', assignee.userId);
    const result = await this.db.run(assignee.ctx, async (tx) =>
      idempotent(
        tx,
        {
          key,
          userId: assignee.userId,
          scope: assignee.scope,
          route: `jobs/${jobId}/${command}`,
          body: { version, reason },
        },
        async () => {
          const { job, assignmentId } = await this.working(tx, assignee, jobId, version);
          requireJobCommand(command, job.status);
          if (command === 'start' && job.status === 'ASSIGNED' && job.onSite) {
            throw conflict('on_the_way_first');
          }
          if (command === 'onTheWay' && !job.onSite) {
            throw conflict('remote_job');
          }
          if (command === 'pause' && (reason === null || reason.trim().length < 3)) {
            throw unprocessable('reason_required');
          }
          await moveJob(
            tx,
            job,
            command,
            PROGRESS_TARGET[command],
            command === 'start' && job.startedAt === null ? { startedAt: new Date() } : {},
            { assignmentId, reason },
          );
          await this.audit.record(tx, {
            action: `job.${command === 'onTheWay' ? 'on_the_way' : command}`,
            entityType: 'job',
            entityId: jobId,
            ...(reason === null ? {} : { reason }),
            request: meta,
          });
          if (command === 'onTheWay' || command === 'start') {
            await this.outbox.publish(tx, {
              type: command === 'onTheWay' ? 'jobs.on_the_way' : 'jobs.started',
              payload: { jobId },
            });
          }
          return loadAssigneeJob(tx, assignee, jobId);
        },
      ),
    );
    return result;
  }

  async note(
    assignee: JobAssignee,
    jobId: string,
    body: string,
    key: string,
  ): Promise<AssigneeJob> {
    requirePermission(assignee, 'ticket.update_progress');
    await this.limiter.consume('jobCommandsPerUser', assignee.userId);
    return this.db.run(assignee.ctx, async (tx) =>
      idempotent(
        tx,
        {
          key,
          userId: assignee.userId,
          scope: assignee.scope,
          route: `jobs/${jobId}/notes`,
          body: { body },
        },
        async () => {
          const { job, assignmentId } = await this.working(tx, assignee, jobId);
          requireJobCommand('workNote', job.status);
          await tx.jobWorkNote.createMany({ data: [{ jobId, assignmentId, body }] });
          await writeJobEvent(tx, jobId, 'workNote', { assignmentId });
          return loadAssigneeJob(tx, assignee, jobId);
        },
      ),
    );
  }

  /** A photo from the phone (plan §2.6): owned by the customer, linked in one transaction. */
  async photo(
    assignee: JobAssignee,
    jobId: string,
    file: { originalName: string; bytes: Buffer },
    caption: string,
  ): Promise<{ photo: StoredFile; job: AssigneeJob }> {
    requirePermission(assignee, 'ticket.update_progress');
    await this.limiter.consume('jobPhotosPerJob', jobId);
    const { customer, assignmentId } = await this.db.run(assignee.ctx, async (tx) => {
      const { job, assignmentId: active } = await this.working(tx, assignee, jobId);
      requireJobCommand('photo', job.status);
      const count = await tx.jobEvidence.count({ where: { assignmentId: active } });
      if (count >= MAX_JOB_PHOTOS) {
        throw conflict('too_many_photos');
      }
      return {
        customer: { tenantId: job.customerTenantId, userId: job.customerUserId },
        assignmentId: active,
      };
    });
    const stored = await this.files.uploadJobEvidence(
      assignee.ctx,
      customer,
      file,
      async (tx, fileId) => {
        await tx.jobEvidence.createMany({ data: [{ jobId, assignmentId, fileId, caption }] });
        await writeJobEvent(tx, jobId, 'photo', { assignmentId });
      },
    );
    const job = await this.detail(assignee, jobId);
    return { photo: stored, job };
  }

  /** The completion report (plan §2.4): the job then waits for the customer. */
  async complete(
    assignee: JobAssignee,
    jobId: string,
    input: Completion,
    key: string,
    meta: AuditRequestMeta,
  ): Promise<AssigneeJob> {
    requirePermission(assignee, 'ticket.update_progress');
    await this.limiter.consume('jobCommandsPerUser', assignee.userId);
    return this.db.run(assignee.ctx, async (tx) =>
      idempotent(
        tx,
        {
          key,
          userId: assignee.userId,
          scope: assignee.scope,
          route: `jobs/${jobId}/completion`,
          body: input,
        },
        async () => {
          const { job, assignmentId } = await this.working(tx, assignee, jobId, input.version);
          requireJobCommand('submitReport', job.status);
          const evidenceIds = [...new Set(input.evidenceIds)];
          if (job.onSite && evidenceIds.length === 0) {
            throw unprocessable('photo_required');
          }
          const own = await tx.jobEvidence.count({
            where: { id: { in: evidenceIds }, assignmentId },
          });
          if (own !== evidenceIds.length) {
            throw unprocessable('photo_unknown');
          }
          await tx.jobCompletion.createMany({
            data: [
              {
                jobId,
                assignmentId,
                summary: input.summary,
                minutesOnSite: input.minutesOnSite,
                materials: input.materials,
                evidenceIds,
              },
            ],
          });
          await moveJob(
            tx,
            job,
            'submitReport',
            'AWAITING_CONFIRMATION',
            { completedAt: new Date() },
            {
              assignmentId,
            },
          );
          await this.audit.record(tx, {
            action: 'job.report_submitted',
            entityType: 'job',
            entityId: jobId,
            request: meta,
          });
          await this.outbox.publish(tx, { type: 'jobs.report_submitted', payload: { jobId } });
          // P9-7: the report confirms itself after 7 days (plus the worker's sweep).
          await this.outbox.publish(tx, {
            type: 'jobs.auto_confirm',
            payload: { jobId },
            availableAt: new Date(Date.now() + CONFIRM_WINDOW_MS + 60_000),
          });
          return loadAssigneeJob(tx, assignee, jobId);
        },
      ),
    );
  }

  /** A company dispatcher hands the job to another of its technicians (P9-5, audited). */
  async changeTechnician(
    assignee: JobAssignee,
    jobId: string,
    input: { version: number; technicianUserId: string; reason: string },
    key: string,
    meta: AuditRequestMeta,
  ): Promise<AssigneeJob> {
    if (assignee.kind !== 'COMPANY' || assignee.tenantId === undefined) {
      throw forbiddenRule('not_a_company');
    }
    requirePermission(assignee, 'ticket.assign');
    await this.limiter.consume('jobCommandsPerUser', assignee.userId);
    const tenantId = assignee.tenantId;
    return this.db.run(assignee.ctx, async (tx) =>
      idempotent(
        tx,
        {
          key,
          userId: assignee.userId,
          scope: assignee.scope,
          route: `jobs/${jobId}/technician`,
          body: input,
        },
        async () => {
          const current = await tx.jobAssignment.findFirst({
            where: { jobId, status: 'ACTIVE', kind: 'COMPANY', assigneeTenantId: tenantId },
            select: {
              id: true,
              offerId: true,
              jobNumber: true,
              title: true,
              customerTenantId: true,
              customerUserId: true,
              providerId: true,
              technicianUserId: true,
            },
          });
          if (current === null) {
            throw notFound();
          }
          const job = await tx.job.findUnique({
            where: { id: jobId },
            select: { id: true, status: true, version: true },
          });
          if (job === null) {
            throw notFound();
          }
          if (job.version !== input.version) {
            throw conflict('stale_version');
          }
          requireJobCommand('changeTechnician', job.status);
          if (current.technicianUserId === input.technicianUserId) {
            throw conflict('same_technician');
          }
          const technicians = await companyTechnicians(tx, tenantId);
          const next = technicians.find((t) => t.id === input.technicianUserId);
          if (next === undefined) {
            throw unprocessable('technician_unknown');
          }
          const now = new Date();
          await tx.jobAssignment.update({
            where: { id: current.id },
            data: {
              status: 'ENDED',
              endReason: 'TECHNICIAN_CHANGED',
              endNote: input.reason,
              endedAt: now,
              endedBy: assignee.userId,
            },
            select: { id: true },
          });
          const replacement = await tx.jobAssignment.create({
            data: {
              jobId,
              offerId: current.offerId,
              jobNumber: current.jobNumber,
              title: current.title,
              customerTenantId: current.customerTenantId,
              customerUserId: current.customerUserId,
              kind: 'COMPANY',
              providerId: current.providerId,
              assigneeTenantId: tenantId,
              technicianUserId: next.id,
              technicianName: technicianFirstName('COMPANY', next.label, null),
            },
            select: { id: true },
          });
          await writeJobEvent(tx, jobId, 'changeTechnician', {
            assignmentId: replacement.id,
            reason: input.reason,
          });
          await this.audit.record(tx, {
            action: 'job.technician_changed',
            tenantId,
            entityType: 'job',
            entityId: jobId,
            reason: input.reason,
            request: meta,
            metadata: { from: current.id, to: replacement.id },
          });
          await this.outbox.publish(tx, {
            type: 'jobs.assigned',
            tenantId,
            payload: { jobId, assignmentId: replacement.id },
          });
          await this.outbox.publish(tx, {
            type: 'jobs.removed',
            tenantId,
            payload: { jobId, assignmentId: current.id },
          });
          return loadAssigneeJob(tx, assignee, jobId);
        },
      ),
    );
  }

  async photoDownload(assignee: JobAssignee, jobId: string, photoId: string): Promise<Download> {
    const fileId = await this.db.run(assignee.ctx, async (tx) => {
      const assignment = await tx.jobAssignment.findFirst({
        where: { jobId, status: 'ACTIVE' },
        select: { id: true },
      });
      if (assignment === null) {
        throw notFound();
      }
      const evidence = await tx.jobEvidence.findFirst({
        where: { id: photoId, assignmentId: assignment.id },
        select: { fileId: true },
      });
      if (evidence === null) {
        throw notFound();
      }
      return evidence.fileId;
    });
    return this.files.evidenceDownloadUrl(assignee.ctx, fileId);
  }

  // ---------------------------------------------------------------- helpers

  /**
   * Assignments that are this person's own: a company technician sees the
   * jobs naming them; a company dispatcher (ticket.assign) and everyone else
   * see what RLS shows them.
   */
  private mine(assignee: JobAssignee): { technicianUserId?: string } {
    if (assignee.kind === 'COMPANY' && !assignee.permissions.has('ticket.assign')) {
      return { technicianUserId: assignee.userId };
    }
    return {};
  }

  private async pendingOffer(tx: Db, offerId: string) {
    const offer = await tx.jobOffer.findFirst({
      where: { id: offerId, status: 'PENDING' },
      select: {
        id: true,
        jobId: true,
        kind: true,
        providerId: true,
        assigneeTenantId: true,
        technicianUserId: true,
        expiresAt: true,
      },
    });
    if (offer === null) {
      throw notFound();
    }
    if (offer.expiresAt.getTime() <= Date.now()) {
      throw conflict('offer_expired');
    }
    return offer;
  }

  /** Who will do the work, and the first name the customer will see (P9-5, P9-8). */
  private async technicianFor(
    tx: Db,
    assignee: JobAssignee,
    offer: { kind: 'INTERNAL' | 'INDIVIDUAL' | 'COMPANY'; providerId: string | null },
    technicianUserId: string | undefined,
  ): Promise<{ userId: string; firstName: string | null }> {
    if (offer.kind === 'COMPANY') {
      if (technicianUserId === undefined || assignee.tenantId === undefined) {
        throw unprocessable('technician_required');
      }
      const technicians = await companyTechnicians(tx, assignee.tenantId);
      const chosen = technicians.find((t) => t.id === technicianUserId);
      if (chosen === undefined) {
        throw unprocessable('technician_unknown');
      }
      return { userId: chosen.id, firstName: technicianFirstName('COMPANY', chosen.label, null) };
    }
    const me = await tx.appUser.findUnique({
      where: { id: assignee.userId },
      select: { email: true },
    });
    const provider =
      offer.kind === 'INDIVIDUAL' && offer.providerId !== null
        ? await tx.provider.findUnique({
            where: { id: offer.providerId },
            select: { displayName: true },
          })
        : null;
    return {
      userId: assignee.userId,
      firstName: technicianFirstName(offer.kind, me?.email ?? null, provider?.displayName ?? null),
    };
  }

  /** The job the caller holds, at the expected version (if given). */
  private async working(tx: Db, assignee: JobAssignee, jobId: string, version?: number) {
    const assignment = await tx.jobAssignment.findFirst({
      where: { jobId, status: 'ACTIVE' },
      select: { id: true, technicianUserId: true },
    });
    if (assignment === null) {
      throw notFound();
    }
    if (assignee.kind !== 'INDIVIDUAL' && assignment.technicianUserId !== assignee.userId) {
      // A company dispatcher sees the job but does not do the work.
      throw forbiddenRule('not_your_job');
    }
    const job = await tx.job.findUnique({
      where: { id: jobId },
      select: {
        id: true,
        status: true,
        version: true,
        onSite: true,
        startedAt: true,
        customerTenantId: true,
        customerUserId: true,
      },
    });
    if (job === null) {
      throw notFound();
    }
    if (version !== undefined && job.version !== version) {
      throw conflict('stale_version');
    }
    return { job, assignmentId: assignment.id };
  }
}

const CARD_SELECT = {
  id: true,
  number: true,
  title: true,
  status: true,
  regionCode: true,
  siteAddress: true,
  windowFrom: true,
  windowTo: true,
} as const;
