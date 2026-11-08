import { setTimeout as sleep } from 'node:timers/promises';
import { Injectable, Logger } from '@nestjs/common';
import { REOPEN_WINDOW_MS } from '@ogs/contracts';
import { AuditService } from '../audit/audit.service.js';
import { TenantDb, type DbContext } from '../database/index.js';
import { OutboxService } from '../events/outbox.service.js';
import { writeEvent } from './ticket-support.js';

const JOB = 'tickets.auto_close';

/**
 * Auto-close (Phase 8 plan §2.2, P8-2). Resolving publishes a delayed
 * `tickets.auto_close` event at resolved_at + 7 days, and the worker sweeps
 * hourly as a safety net. `close` is idempotent: the status, resolved_at and
 * version guard make the change happen once, and a concurrent reopen wins or
 * loses cleanly (the protect_ticket trigger re-checks the window).
 */
@Injectable()
export class TicketAutoCloseService {
  constructor(
    private readonly db: TenantDb,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
  ) {}

  /** Returns true if this call closed the ticket. */
  async close(ticketId: string): Promise<boolean> {
    const info = await this.db.run({ kind: 'system', job: JOB }, async (tx) =>
      tx.ticket.findUnique({
        where: { id: ticketId },
        select: { status: true, resolvedAt: true, version: true, customerTenantId: true },
      }),
    );
    if (
      info?.status !== 'RESOLVED' ||
      info.resolvedAt === null ||
      info.resolvedAt.getTime() + REOPEN_WINDOW_MS > Date.now()
    ) {
      return false;
    }
    const tenantId = info.customerTenantId;
    const ctx: DbContext =
      tenantId === null ? { kind: 'system', job: JOB } : { kind: 'system', job: JOB, tenantId };
    return this.db.run(ctx, async (tx) => {
      const changed = await tx.ticket.updateMany({
        where: {
          id: ticketId,
          status: 'RESOLVED',
          version: info.version,
          resolvedAt: { lte: new Date(Date.now() - REOPEN_WINDOW_MS) },
        },
        data: {
          status: 'CLOSED',
          closure: 'AUTO_CLOSED',
          closedAt: new Date(),
          version: { increment: 1 },
        },
      });
      if (changed.count !== 1) {
        return false;
      }
      await writeEvent(tx, ticketId, 'autoClose', { fromValue: 'RESOLVED', toValue: 'CLOSED' });
      await this.audit.record(tx, {
        action: 'ticket.auto_closed',
        tenantId,
        entityType: 'ticket',
        entityId: ticketId,
      });
      await this.outbox.publish(tx, {
        type: 'tickets.closed',
        tenantId,
        payload: { ticketId },
      });
      return true;
    });
  }

  /** Closes every resolution older than the window; returns how many this call closed. */
  async sweep(): Promise<number> {
    const due = await this.db.run({ kind: 'system', job: JOB }, async (tx) =>
      tx.ticket.findMany({
        where: { status: 'RESOLVED', resolvedAt: { lte: new Date(Date.now() - REOPEN_WINDOW_MS) } },
        select: { id: true },
        orderBy: { resolvedAt: 'asc' },
        take: 200,
      }),
    );
    let closed = 0;
    for (const { id } of due) {
      if (await this.close(id)) {
        closed += 1;
      }
    }
    return closed;
  }
}

/** The hourly safety net for auto-close (worker only). */
export class TicketAutoCloseSweeper {
  private readonly logger = new Logger(TicketAutoCloseSweeper.name);
  private running = false;
  private loop: Promise<void> | undefined;
  private readonly stopController = new AbortController();

  constructor(
    private readonly service: TicketAutoCloseService,
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
        const closed = await this.service.sweep();
        if (closed > 0) {
          this.logger.log(`auto-closed ${String(closed)} resolved ticket(s)`);
        }
      } catch (error) {
        this.logger.error(
          `ticket auto-close sweep failed (${error instanceof Error ? error.name : 'UnknownError'})`,
        );
      }
      await sleep(this.intervalMs, undefined, { signal: this.stopController.signal }).catch(
        () => undefined,
      );
    }
  }
}
