import { setTimeout as sleep } from 'node:timers/promises';
import { Injectable, Logger } from '@nestjs/common';
import { CONFIRM_WINDOW_MS } from '@ogs/contracts';
import { AuditService } from '../audit/audit.service.js';
import { nextNumber } from '../common/document-numbers.js';
import { Prisma, TenantDb, type Db, type DbContext } from '../database/index.js';
import { OutboxService } from '../events/outbox.service.js';
import { moveOrder } from '../orders/order-support.js';
import { moveJob, writeJobEvent } from './job-support.js';

/** System contexts of the jobs worker (RLS: app.is_job('jobs.%')). */
const CREATE_JOB = 'jobs.dispatch';
const EXPIRE_JOB = 'jobs.expire';
const CONFIRM_JOB = 'jobs.confirm';
const SYNC_JOB = 'jobs.sync';

function system(job: string, tenantId: string | null): DbContext {
  return tenantId === null ? { kind: 'system', job } : { kind: 'system', job, tenantId };
}

/**
 * The jobs worker's side of the lifecycle (Phase 9 plan §2.4):
 *  - opens a QUEUED job when an order is ready for assignment;
 *  - expires offers at their deadline (delayed event plus sweep);
 *  - auto-confirms reports after 7 days (delayed event plus sweep);
 *  - moves orders into and out of delivery with their job (P9-10).
 * Every method is idempotent: the status/version guards make each change happen
 * once, and a concurrent human command wins or loses cleanly.
 */
@Injectable()
export class JobLifecycleService {
  constructor(
    private readonly db: TenantDb,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
  ) {}

  /** Opens the order's job if it has none. Returns the job id (new or existing), or null. */
  async ensureForOrder(orderId: string): Promise<string | null> {
    const order = await this.db.run(system(CREATE_JOB, null), async (tx) =>
      tx.serviceOrder.findUnique({
        where: { id: orderId },
        select: { status: true, customerTenantId: true, job: { select: { id: true } } },
      }),
    );
    if (order === null) {
      return null;
    }
    if (order.job !== null) {
      return order.job.id;
    }
    if (order.status !== 'READY_FOR_ASSIGNMENT') {
      return null;
    }
    try {
      return await this.db.run(system(CREATE_JOB, order.customerTenantId), async (tx) =>
        this.createForOrder(tx, orderId),
      );
    } catch (error) {
      // A concurrent call created it first (unique service_order_id).
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        return this.db.run(system(CREATE_JOB, null), async (tx) =>
          tx.job
            .findUnique({ where: { serviceOrderId: orderId }, select: { id: true } })
            .then((job) => job?.id ?? null),
        );
      }
      throw error;
    }
  }

  private async createForOrder(tx: Db, orderId: string): Promise<string | null> {
    const order = await tx.serviceOrder.findUnique({
      where: { id: orderId },
      select: {
        id: true,
        status: true,
        customerTenantId: true,
        customerUserId: true,
        request: {
          select: {
            serviceId: true,
            serviceName: true,
            county: true,
            address: true,
            contactPhone: true,
            description: true,
            preferredFrom: true,
            preferredTo: true,
          },
        },
      },
    });
    if (order?.status !== 'READY_FOR_ASSIGNMENT') {
      return null;
    }
    const service = await tx.service.findUnique({
      where: { id: order.request.serviceId },
      select: {
        deliveryMode: true,
        channelOgs: true,
        channelIndividual: true,
        channelCompany: true,
        skills: { select: { skillCode: true, minExperience: true } },
      },
    });
    const tenant =
      order.customerTenantId === null
        ? null
        : await tx.tenant.findUnique({
            where: { id: order.customerTenantId },
            select: { name: true },
          });
    const anyChannel =
      service === null || service.channelOgs || service.channelIndividual || service.channelCompany;
    const job = await tx.job.create({
      data: {
        number: await nextNumber(tx, 'JOB'),
        serviceOrderId: order.id,
        customerTenantId: order.customerTenantId,
        customerUserId: order.customerUserId,
        // No name field for people yet: providers see "Private customer" (plan §2.5).
        customerDisplay: tenant?.name ?? 'Private customer',
        serviceId: order.request.serviceId,
        title: order.request.serviceName,
        allowInternal: !anyChannel || (service?.channelOgs ?? true),
        allowIndividual: !anyChannel || (service?.channelIndividual ?? true),
        allowCompany: !anyChannel || (service?.channelCompany ?? true),
        onSite: service?.deliveryMode !== 'REMOTE',
        remoteAllowed: service?.deliveryMode !== 'ON_SITE',
        regionCode: order.request.county,
        // The brief starts from the customer's description; staff edit it before offering.
        brief: order.request.description.slice(0, 4000),
        siteAddress: order.request.address,
        siteContactPhone: order.request.contactPhone,
        windowFrom: order.request.preferredFrom,
        windowTo: order.request.preferredTo,
      },
      select: { id: true, number: true },
    });
    if (service !== null && service.skills.length > 0) {
      await tx.jobSkill.createMany({
        data: service.skills.map((skill) => ({
          jobId: job.id,
          skillCode: skill.skillCode,
          minExperience: skill.minExperience,
        })),
      });
    }
    await writeJobEvent(tx, job.id, 'create', { toValue: 'QUEUED' });
    await this.audit.record(tx, {
      action: 'job.created',
      tenantId: order.customerTenantId,
      entityType: 'job',
      entityId: job.id,
      metadata: { number: job.number, orderId: order.id },
    });
    await this.outbox.publish(tx, {
      type: 'jobs.queued',
      tenantId: order.customerTenantId,
      payload: { jobId: job.id },
    });
    return job.id;
  }

  /** Ready orders without a job (missed events, orders from before Phase 9). */
  async sweepReadyOrders(): Promise<number> {
    const due = await this.db.run(system(CREATE_JOB, null), async (tx) =>
      tx.serviceOrder.findMany({
        where: { status: 'READY_FOR_ASSIGNMENT', job: null },
        select: { id: true },
        orderBy: { createdAt: 'asc' },
        take: 100,
      }),
    );
    let created = 0;
    for (const { id } of due) {
      if ((await this.ensureForOrder(id)) !== null) {
        created += 1;
      }
    }
    return created;
  }

  /** Expires a PENDING offer at or after its deadline; the job returns to the queue. */
  async expireOffer(offerId: string): Promise<boolean> {
    const offer = await this.db.run(system(EXPIRE_JOB, null), async (tx) =>
      tx.jobOffer.findUnique({
        where: { id: offerId },
        select: {
          status: true,
          expiresAt: true,
          offeredBy: true,
          job: { select: { id: true, status: true, version: true, customerTenantId: true } },
        },
      }),
    );
    if (offer?.status !== 'PENDING' || offer.expiresAt.getTime() > Date.now()) {
      return false;
    }
    const tenantId = offer.job.customerTenantId;
    return this.db.run(system(EXPIRE_JOB, tenantId), async (tx) => {
      const changed = await tx.jobOffer.updateMany({
        where: { id: offerId, status: 'PENDING', expiresAt: { lte: new Date() } },
        data: { status: 'EXPIRED', respondedAt: new Date(), version: { increment: 1 } },
      });
      if (changed.count !== 1) {
        return false;
      }
      if (offer.job.status === 'OFFERED') {
        await moveJob(tx, offer.job, 'expire', 'QUEUED');
      }
      await this.audit.record(tx, {
        action: 'job.offer_expired',
        tenantId,
        entityType: 'job',
        entityId: offer.job.id,
        metadata: { offerId },
      });
      await this.outbox.publish(tx, {
        type: 'jobs.offer_expired',
        tenantId,
        payload: { jobId: offer.job.id, offerId },
      });
      return true;
    });
  }

  async sweepExpiredOffers(): Promise<number> {
    const due = await this.db.run(system(EXPIRE_JOB, null), async (tx) =>
      tx.jobOffer.findMany({
        where: { status: 'PENDING', expiresAt: { lte: new Date() } },
        select: { id: true },
        orderBy: { expiresAt: 'asc' },
        take: 200,
      }),
    );
    let expired = 0;
    for (const { id } of due) {
      if (await this.expireOffer(id)) {
        expired += 1;
      }
    }
    return expired;
  }

  /** Confirms a report nobody decided within 7 days (P9-7). */
  async autoConfirm(jobId: string): Promise<boolean> {
    const job = await this.db.run(system(CONFIRM_JOB, null), async (tx) =>
      tx.job.findUnique({
        where: { id: jobId },
        select: {
          id: true,
          status: true,
          version: true,
          customerTenantId: true,
          completions: {
            where: { outcome: null },
            select: { id: true, submittedAt: true, assignmentId: true },
          },
        },
      }),
    );
    const report = job?.completions[0];
    if (
      job?.status !== 'AWAITING_CONFIRMATION' ||
      report === undefined ||
      report.submittedAt.getTime() + CONFIRM_WINDOW_MS > Date.now()
    ) {
      return false;
    }
    const tenantId = job.customerTenantId;
    const done = await this.db.run(system(CONFIRM_JOB, tenantId), async (tx) => {
      const decided = await tx.jobCompletion.updateMany({
        where: { id: report.id, outcome: null },
        data: { outcome: 'AUTO_CONFIRMED', decidedAt: new Date(), decidedBy: null },
      });
      if (decided.count !== 1) {
        return false;
      }
      const now = new Date();
      await moveJob(tx, job, 'autoConfirm', 'COMPLETED', { confirmedAt: now });
      await tx.jobAssignment.updateMany({
        where: { jobId, status: 'ACTIVE' },
        data: { status: 'ENDED', endReason: 'JOB_COMPLETED', endedAt: now, endedBy: null },
      });
      await this.audit.record(tx, {
        action: 'job.auto_confirmed',
        tenantId,
        entityType: 'job',
        entityId: jobId,
      });
      await this.outbox.publish(tx, { type: 'jobs.completed', tenantId, payload: { jobId } });
      await this.outbox.publish(tx, { type: 'jobs.order_sync', tenantId, payload: { jobId } });
      return true;
    });
    if (done) {
      await this.syncOrder(jobId);
    }
    return done;
  }

  async sweepAutoConfirm(): Promise<number> {
    const due = await this.db.run(system(CONFIRM_JOB, null), async (tx) =>
      tx.jobCompletion.findMany({
        where: {
          outcome: null,
          submittedAt: { lte: new Date(Date.now() - CONFIRM_WINDOW_MS) },
          job: { status: 'AWAITING_CONFIRMATION' },
        },
        select: { jobId: true },
        take: 200,
      }),
    );
    let confirmed = 0;
    for (const { jobId } of due) {
      if (await this.autoConfirm(jobId)) {
        confirmed += 1;
      }
    }
    return confirmed;
  }

  /**
   * Moves the job's order with it (P9-10): READY_FOR_ASSIGNMENT → IN_DELIVERY
   * once the job has been accepted, → COMPLETED once the job is. Idempotent.
   */
  async syncOrder(jobId: string): Promise<void> {
    const job = await this.db.run(system(SYNC_JOB, null), async (tx) =>
      tx.job.findUnique({
        where: { id: jobId },
        select: {
          status: true,
          assignedAt: true,
          customerTenantId: true,
          serviceOrder: { select: { id: true, status: true, version: true } },
        },
      }),
    );
    const order = job?.serviceOrder;
    if (job === null || order === null || order === undefined) {
      return;
    }
    const delivered = job.status === 'COMPLETED';
    const started =
      delivered ||
      (job.status !== 'QUEUED' && job.status !== 'OFFERED' && job.status !== 'CANCELLED');
    if (!started) {
      return;
    }
    await this.db.run(system(SYNC_JOB, job.customerTenantId), async (tx) => {
      let current = { id: order.id, status: order.status, version: order.version };
      if (current.status === 'READY_FOR_ASSIGNMENT') {
        const version = await moveOrder(tx, current, 'startDelivery', 'IN_DELIVERY');
        current = { id: order.id, status: 'IN_DELIVERY', version };
      }
      if (delivered && current.status === 'IN_DELIVERY') {
        await moveOrder(tx, current, 'completeDelivery', 'COMPLETED');
        await this.outbox.publish(tx, {
          type: 'jobs.order_completed',
          tenantId: job.customerTenantId,
          payload: { jobId },
        });
      }
    });
  }
}

/** The worker's safety net for jobs: every 5 minutes (worker only). */
export class JobSweeper {
  private readonly logger = new Logger(JobSweeper.name);
  private running = false;
  private loop: Promise<void> | undefined;
  private readonly stopController = new AbortController();

  constructor(
    private readonly service: JobLifecycleService,
    private readonly intervalMs = 5 * 60 * 1000,
  ) {}

  start(): void {
    if (this.running) {
      return;
    }
    this.running = true;
    this.loop = this.run();
  }

  async stop(): Promise<void> {
    this.running = false;
    this.stopController.abort();
    await this.loop;
  }

  private async run(): Promise<void> {
    while (this.running) {
      for (const [name, sweep] of [
        ['ready orders', () => this.service.sweepReadyOrders()],
        ['expired offers', () => this.service.sweepExpiredOffers()],
        ['auto-confirm', () => this.service.sweepAutoConfirm()],
      ] as const) {
        try {
          const changed = await sweep();
          if (changed > 0) {
            this.logger.log(`jobs sweep (${name}): ${String(changed)} change(s)`);
          }
        } catch (error) {
          this.logger.error(
            `jobs sweep (${name}) failed (${error instanceof Error ? error.name : 'UnknownError'})`,
          );
        }
      }
      await sleep(this.intervalMs, undefined, { signal: this.stopController.signal }).catch(
        () => undefined,
      );
    }
  }
}
