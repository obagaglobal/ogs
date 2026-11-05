import type { Prisma } from '../database/index.js';

/** BullMQ queue carrying outbox events to their handlers. */
export const EVENTS_QUEUE = 'ogs-events';
/** Events whose handler failed on every attempt. Inspected and replayed manually. */
export const EVENTS_DEAD_LETTER_QUEUE = 'ogs-events-dead';

export const EVENT_TYPE_PATTERN = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/;

/** What a handler receives. `eventId` is the idempotency key: delivery is at least once. */
export interface EventEnvelope {
  readonly eventId: string;
  readonly type: string;
  readonly tenantId: string | null;
  readonly payload: Prisma.JsonValue;
  /** ISO-8601. */
  readonly occurredAt: string;
}

export interface DeadLetter extends EventEnvelope {
  readonly attemptsMade: number;
  /** Error class name only: messages may contain data and are logged, not stored. */
  readonly failure: string;
}

/** Minimal producer surface the dispatcher needs (a fake replaces it in tests). */
export interface EventQueue {
  add(type: string, envelope: EventEnvelope, options: { readonly jobId: string }): Promise<unknown>;
}

export const EVENT_QUEUE = Symbol('EVENT_QUEUE');
export const EVENT_HANDLERS = Symbol('EVENT_HANDLERS');

/**
 * Handles one event type. MUST be idempotent on `eventId`. Handlers that touch
 * the database use TenantDb with a `system` context carrying `envelope.tenantId`.
 */
export interface EventHandler {
  readonly type: string;
  handle(envelope: EventEnvelope): Promise<void>;
}
