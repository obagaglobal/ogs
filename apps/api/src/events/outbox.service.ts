import { Injectable } from '@nestjs/common';
import type { Db, Prisma } from '../database/index.js';
import { EVENT_TYPE_PATTERN } from './event.types.js';

export interface OutboxEventInput {
  /** Dotted lower-case name, e.g. `ticket.assigned`. */
  readonly type: string;
  /** Tenant the event belongs to (RLS: must be the current tenant unless platform). */
  readonly tenantId?: string | null;
  /** Identifiers and small facts only. Handlers re-read current state from the database. */
  readonly payload: Prisma.InputJsonObject;
  /** Deliver no earlier than this (default: now). */
  readonly availableAt?: Date;
}

export class OutboxEventError extends Error {
  override readonly name = 'OutboxEventError';
}

/**
 * Transactional outbox writer (review §3). Call it with the SAME transaction
 * handle as the business change: the event exists if and only if the change
 * commits. The worker's dispatcher delivers it to BullMQ afterwards.
 */
@Injectable()
export class OutboxService {
  async publish(db: Db, event: OutboxEventInput): Promise<void> {
    if (!EVENT_TYPE_PATTERN.test(event.type) || event.type.length > 150) {
      throw new OutboxEventError('event type must be a dotted lower-case name');
    }
    // createMany: INSERT without RETURNING. Only the dispatcher may read outbox rows.
    await db.outboxEvent.createMany({
      data: [
        {
          type: event.type,
          tenantId: event.tenantId ?? null,
          payload: event.payload,
          ...(event.availableAt === undefined ? {} : { availableAt: event.availableAt }),
        },
      ],
    });
  }
}
