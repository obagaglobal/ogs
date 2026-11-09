import { Injectable } from '@nestjs/common';
import type { CustomerJobProgress } from '@ogs/contracts';
import { AuditService, type AuditRequestMeta } from '../audit/audit.service.js';
import { conflict, forbiddenRule, notFound } from '../common/domain-error.js';
import { TenantDb, type Db } from '../database/index.js';
import { OutboxService } from '../events/outbox.service.js';
import { FileService, type Download } from '../files/file.service.js';
import { idempotent } from '../orders/order-support.js';
import { requestScope, type Customer } from '../orders/order-views.js';
import { customerScope } from '../tickets/ticket-views.js';
import { confirmJob } from './job-confirmation.js';
import { JobLifecycleService } from './job-lifecycle.service.js';
import { moveJob } from './job-support.js';
import { loadCustomerProgress } from './job-views.js';
import { requireJobCommand } from './transitions.js';

/**
 * The customer's side of jobs (Phase 9 plan §2.9): the live tracker on order
 * and ticket pages, confirming the work or reporting a problem (P9-7), and
 * the report's photos. Who sees an order or a ticket follows Phase 7/8
 * (ADR-054, ADR-060); who may confirm: the requester, admins with
 * request.read_all / ticket.read_all, holders of ticket.confirm_completion,
 * and individuals for their own orders.
 */
@Injectable()
export class CustomerJobsService {
  constructor(
    private readonly db: TenantDb,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly files: FileService,
    private readonly lifecycle: JobLifecycleService,
  ) {}

  async forRequest(customer: Customer, requestId: string): Promise<CustomerJobProgress> {
    return this.db.run(customer.ctx, async (tx) => {
      const { jobId, decides } = await this.requestJob(tx, customer, requestId);
      return loadCustomerProgress(tx, jobId, decides);
    });
  }

  async forTicket(customer: Customer, ticketId: string): Promise<CustomerJobProgress> {
    return this.db.run(customer.ctx, async (tx) => {
      const scope = await customerScope(tx, customer);
      const ticket = await tx.ticket.findFirst({
        where: { AND: [{ id: ticketId }, scope.where] },
        select: { id: true },
      });
      if (ticket === null) {
        throw notFound();
      }
      const job = await tx.job.findFirst({
        where: { ticketId },
        orderBy: { createdAt: 'desc' },
        select: { id: true },
      });
      // Ticket jobs are confirmed through "Accept resolution" (P9-7).
      return loadCustomerProgress(tx, job?.id ?? null, false);
    });
  }

  async confirm(
    customer: Customer,
    requestId: string,
    version: number,
    key: string,
    meta: AuditRequestMeta,
  ): Promise<CustomerJobProgress> {
    const result = await this.db.run(customer.ctx, async (tx) =>
      idempotent(
        tx,
        {
          key,
          userId: customer.userId,
          scope: customer.scope,
          route: `requests/${requestId}/job/confirm`,
          body: { version },
        },
        async () => {
          const found = await this.requestJob(tx, customer, requestId);
          if (!found.decides) {
            throw forbiddenRule('permission_denied');
          }
          if (found.jobId === null) {
            throw notFound();
          }
          await confirmJob(tx, found.jobId, version, customer.userId);
          await this.audit.record(tx, {
            action: 'job.confirmed',
            tenantId: customer.tenantId ?? null,
            entityType: 'job',
            entityId: found.jobId,
            request: meta,
          });
          await this.outbox.publish(tx, {
            type: 'jobs.completed',
            tenantId: customer.tenantId ?? null,
            payload: { jobId: found.jobId },
          });
          await this.outbox.publish(tx, {
            type: 'jobs.order_sync',
            tenantId: customer.tenantId ?? null,
            payload: { jobId: found.jobId },
          });
          return loadCustomerProgress(tx, found.jobId, found.decides);
        },
      ),
    );
    // Immediately (the outbox event is the guarantee); also on an idempotent replay.
    if (result.job !== null) {
      await this.lifecycle.syncOrder(result.job.id);
    }
    return result;
  }

  /** "Report a problem" (P9-7): the job goes back to work with the same assignee. */
  async reportProblem(
    customer: Customer,
    requestId: string,
    version: number,
    reason: string,
    key: string,
    meta: AuditRequestMeta,
  ): Promise<CustomerJobProgress> {
    return this.db.run(customer.ctx, async (tx) =>
      idempotent(
        tx,
        {
          key,
          userId: customer.userId,
          scope: customer.scope,
          route: `requests/${requestId}/job/report-problem`,
          body: { version, reason },
        },
        async () => {
          const found = await this.requestJob(tx, customer, requestId);
          if (!found.decides) {
            throw forbiddenRule('permission_denied');
          }
          if (found.jobId === null) {
            throw notFound();
          }
          const job = await this.decidable(tx, found.jobId, version);
          requireJobCommand('reportProblem', job.status);
          const decided = await tx.jobCompletion.updateMany({
            where: { jobId: job.id, outcome: null },
            data: {
              outcome: 'ISSUE_RAISED',
              decidedAt: new Date(),
              decidedBy: customer.userId,
              decisionReason: reason,
            },
          });
          if (decided.count !== 1) {
            throw conflict('no_open_report');
          }
          const assignment = await tx.jobAssignment.findFirst({
            where: { jobId: job.id, status: 'ACTIVE' },
            select: { id: true },
          });
          await moveJob(
            tx,
            job,
            'reportProblem',
            'IN_PROGRESS',
            {},
            {
              assignmentId: assignment?.id ?? null,
              reason,
            },
          );
          await this.audit.record(tx, {
            action: 'job.problem_reported',
            tenantId: customer.tenantId ?? null,
            entityType: 'job',
            entityId: job.id,
            reason,
            request: meta,
          });
          await this.outbox.publish(tx, {
            type: 'jobs.problem_reported',
            tenantId: customer.tenantId ?? null,
            payload: { jobId: job.id },
          });
          return loadCustomerProgress(tx, job.id, found.decides);
        },
      ),
    );
  }

  /** A photo cited in the report (RLS shows the customer no other). */
  async photo(
    customer: Customer,
    source: { kind: 'REQUEST' | 'TICKET'; id: string },
    photoId: string,
  ): Promise<Download> {
    const fileId = await this.db.run(customer.ctx, async (tx) => {
      let jobId: string | null;
      if (source.kind === 'REQUEST') {
        jobId = (await this.requestJob(tx, customer, source.id)).jobId;
      } else {
        const scope = await customerScope(tx, customer);
        const ticket = await tx.ticket.findFirst({
          where: { AND: [{ id: source.id }, scope.where] },
          select: { id: true },
        });
        if (ticket === null) {
          throw notFound();
        }
        jobId =
          (
            await tx.job.findFirst({
              where: { ticketId: source.id, evidence: { some: { id: photoId } } },
              select: { id: true },
            })
          )?.id ?? null;
      }
      if (jobId === null) {
        throw notFound();
      }
      const evidence = await tx.jobEvidence.findFirst({
        where: { id: photoId, jobId },
        select: { fileId: true },
      });
      if (evidence === null) {
        throw notFound();
      }
      return evidence.fileId;
    });
    return this.files.evidenceDownloadUrl(customer.ctx, fileId);
  }

  // ---------------------------------------------------------------- helpers

  /** The order's job of a request the customer can see (ADR-054). */
  private async requestJob(
    tx: Db,
    customer: Customer,
    requestId: string,
  ): Promise<{ jobId: string | null; decides: boolean }> {
    const request = await tx.serviceRequest.findFirst({
      where: { id: requestId, ...requestScope(customer) },
      select: { createdBy: true, order: { select: { id: true } } },
    });
    if (request === null) {
      throw notFound();
    }
    const decides =
      customer.tenantId === undefined ||
      request.createdBy === customer.userId ||
      customer.permissions.has('request.read_all') ||
      customer.permissions.has('ticket.confirm_completion');
    if (request.order === null) {
      return { jobId: null, decides };
    }
    const job = await tx.job.findFirst({
      where: { serviceOrderId: request.order.id },
      select: { id: true },
    });
    return { jobId: job?.id ?? null, decides };
  }

  private async decidable(tx: Db, jobId: string, version: number) {
    const job = await tx.job.findUnique({
      where: { id: jobId },
      select: { id: true, status: true, version: true },
    });
    if (job === null) {
      throw notFound();
    }
    if (job.version !== version) {
      throw conflict('stale_version');
    }
    return job;
  }
}
