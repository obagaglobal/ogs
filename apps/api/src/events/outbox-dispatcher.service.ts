import { setTimeout as sleep } from 'node:timers/promises';
import { Logger } from '@nestjs/common';
import type { Prisma, TenantDb } from '../database/index.js';
import type { EventEnvelope, EventQueue } from './event.types.js';

export interface OutboxDispatcherOptions {
  readonly batchSize: number;
  readonly pollIntervalMs: number;
}

interface OutboxRow {
  readonly id: string;
  readonly type: string;
  readonly tenant_id: string | null;
  readonly payload: Prisma.JsonValue;
  readonly occurred_at: Date;
}

const MAX_ERROR_BACKOFF_MS = 30_000;

/**
 * Moves committed outbox rows to BullMQ (worker process only).
 *
 * Each batch runs in one `system`-context transaction:
 *   1. claim up to N undelivered rows with FOR UPDATE SKIP LOCKED, so several
 *      dispatchers never claim the same row;
 *   2. enqueue each with jobId = event id, so a retried enqueue is deduplicated;
 *   3. mark them dispatched.
 * If anything fails the transaction rolls back and the rows are retried.
 * Delivery is therefore at least once; handlers are idempotent on eventId.
 */
export class OutboxDispatcher {
  private readonly logger = new Logger(OutboxDispatcher.name);
  private running = false;
  private loop: Promise<void> | undefined;
  private readonly stopController = new AbortController();

  constructor(
    private readonly db: TenantDb,
    private readonly queue: EventQueue,
    private readonly options: OutboxDispatcherOptions,
  ) {}

  /** Dispatches one batch. Returns how many events were enqueued. */
  async dispatchBatch(): Promise<number> {
    return this.db.run(
      { kind: 'system', job: 'outbox.dispatch' },
      async (tx) => {
        const rows = await tx.$queryRaw<OutboxRow[]>`
          SELECT id, type, tenant_id, payload, occurred_at
            FROM outbox_event
           WHERE dispatched_at IS NULL AND available_at <= now()
           ORDER BY occurred_at, id
           LIMIT ${this.options.batchSize}
             FOR UPDATE SKIP LOCKED`;
        if (rows.length === 0) {
          return 0;
        }

        for (const row of rows) {
          const envelope: EventEnvelope = {
            eventId: row.id,
            type: row.type,
            tenantId: row.tenant_id,
            payload: row.payload,
            occurredAt: row.occurred_at.toISOString(),
          };
          await this.queue.add(row.type, envelope, { jobId: row.id });
        }

        const ids = rows.map((row) => row.id);
        await tx.$executeRaw`
          UPDATE outbox_event
             SET dispatched_at = now(), attempts = attempts + 1, last_error = NULL
           WHERE id = ANY(${ids}::uuid[])`;
        return rows.length;
      },
      { timeoutMs: 30_000 },
    );
  }

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
    let consecutiveErrors = 0;
    while (this.running) {
      let delay = this.options.pollIntervalMs;
      try {
        const dispatched = await this.dispatchBatch();
        consecutiveErrors = 0;
        // A full batch means more may be waiting: go again immediately.
        if (dispatched === this.options.batchSize) {
          delay = 0;
        }
      } catch (error) {
        consecutiveErrors += 1;
        delay = Math.min(
          this.options.pollIntervalMs * 2 ** consecutiveErrors,
          MAX_ERROR_BACKOFF_MS,
        );
        const name = error instanceof Error ? error.name : 'UnknownError';
        this.logger.error(`Outbox dispatch failed (${name}); retrying in ${String(delay)} ms`);
      }
      if (delay > 0) {
        // stop() aborts the signal, so shutdown never waits out a poll interval.
        await sleep(delay, undefined, { signal: this.stopController.signal }).catch(
          () => undefined,
        );
      }
    }
  }
}
