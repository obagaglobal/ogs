import { setTimeout as sleep } from 'node:timers/promises';
import { Injectable, Logger } from '@nestjs/common';
import { AuditService } from '../audit/audit.service.js';
import { TenantDb, type DbContext } from '../database/index.js';
import { OutboxService } from '../events/outbox.service.js';
import { moveRequest } from './order-support.js';

/**
 * Quotation expiry (Phase 7 plan §2.4, P7-3). Two triggers, one effect:
 * a delayed outbox event fires at `expires_at`, and an hourly sweep catches
 * anything the event missed. `expire` is idempotent: the status guard makes
 * the change happen exactly once, whoever gets there first.
 */
@Injectable()
export class QuotationExpiryService {
  constructor(
    private readonly db: TenantDb,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
  ) {}

  /** Returns true if this call expired the quotation. */
  async expire(quotationId: string): Promise<boolean> {
    const info = await this.db.run({ kind: 'system', job: 'orders.expire' }, async (tx) =>
      tx.quotation.findUnique({
        where: { id: quotationId },
        select: {
          requestId: true,
          status: true,
          expiresAt: true,
          request: { select: { customerTenantId: true } },
        },
      }),
    );
    if (info?.status !== 'ISSUED' || info.expiresAt === null || info.expiresAt > new Date()) {
      return false;
    }
    const tenantId = info.request.customerTenantId;
    const ctx: DbContext =
      tenantId === null
        ? { kind: 'system', job: 'orders.expire' }
        : { kind: 'system', job: 'orders.expire', tenantId };
    return this.db.run(ctx, async (tx) => {
      const now = new Date();
      const changed = await tx.quotation.updateMany({
        where: { id: quotationId, status: 'ISSUED', expiresAt: { lte: now } },
        data: { status: 'EXPIRED', decidedAt: now, version: { increment: 1 } },
      });
      if (changed.count !== 1) {
        return false;
      }
      const request = await tx.serviceRequest.findUnique({
        where: { id: info.requestId },
        select: { id: true, status: true, version: true },
      });
      if (request?.status === 'QUOTATION_ISSUED') {
        await moveRequest(
          tx,
          request,
          'expireQuotation',
          'AWAITING_QUOTATION',
          'Quotation expired',
        );
      }
      await this.audit.record(tx, {
        action: 'quotation.expired',
        tenantId,
        entityType: 'quotation',
        entityId: quotationId,
      });
      await this.outbox.publish(tx, {
        type: 'orders.quotation_expired',
        tenantId,
        payload: { requestId: info.requestId, quotationId },
      });
      return true;
    });
  }

  /** Expires every overdue quotation; returns how many this call expired. */
  async sweep(): Promise<number> {
    const due = await this.db.run({ kind: 'system', job: 'orders.expire' }, async (tx) =>
      tx.quotation.findMany({
        where: { status: 'ISSUED', expiresAt: { lte: new Date() } },
        select: { id: true },
        orderBy: { expiresAt: 'asc' },
        take: 200,
      }),
    );
    let expired = 0;
    for (const { id } of due) {
      if (await this.expire(id)) {
        expired += 1;
      }
    }
    return expired;
  }
}

/** The hourly safety net for quotation expiry (worker only). */
export class QuotationExpirySweeper {
  private readonly logger = new Logger(QuotationExpirySweeper.name);
  private running = false;
  private loop: Promise<void> | undefined;
  private readonly stopController = new AbortController();

  constructor(
    private readonly expiry: QuotationExpiryService,
    private readonly intervalMs = 60 * 60 * 1000,
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
      try {
        const expired = await this.expiry.sweep();
        if (expired > 0) {
          this.logger.log(`expired ${String(expired)} overdue quotation(s)`);
        }
      } catch (error) {
        this.logger.error(
          `quotation sweep failed (${error instanceof Error ? error.name : 'UnknownError'})`,
        );
      }
      await sleep(this.intervalMs, undefined, { signal: this.stopController.signal }).catch(
        () => undefined,
      );
    }
  }
}
