import { Queue, type DefaultJobOptions } from 'bullmq';
import type { Redis } from 'ioredis';
import {
  EVENTS_DEAD_LETTER_QUEUE,
  EVENTS_QUEUE,
  type DeadLetter,
  type EventEnvelope,
  type EventQueue,
} from './event.types.js';

export interface EventQueueSettings {
  /** BullMQ key prefix (QUEUE_PREFIX). */
  readonly prefix: string;
  /** Total handler attempts per event, including the first. */
  readonly attempts: number;
  /** Base delay of the exponential retry backoff. */
  readonly backoffMs: number;
}

export const DEFAULT_EVENT_QUEUE_SETTINGS: Omit<EventQueueSettings, 'prefix'> = {
  attempts: 5,
  backoffMs: 1_000,
};

export function eventJobOptions(settings: EventQueueSettings): DefaultJobOptions {
  return {
    attempts: settings.attempts,
    backoff: { type: 'exponential', delay: settings.backoffMs },
    // Completed jobs are kept for a day so a re-enqueue of the same event id
    // (dispatcher retry after a partial failure) is still deduplicated.
    removeOnComplete: { age: 24 * 60 * 60, count: 50_000 },
    removeOnFail: { age: 7 * 24 * 60 * 60 },
  };
}

/** BullMQ-backed producer for the events queue and its dead-letter queue. */
export class BullEventQueue implements EventQueue {
  private readonly queue: Queue<EventEnvelope>;
  private readonly deadLetters: Queue<DeadLetter>;

  constructor(connection: Redis, settings: EventQueueSettings) {
    this.queue = new Queue<EventEnvelope>(EVENTS_QUEUE, {
      connection,
      prefix: settings.prefix,
      defaultJobOptions: eventJobOptions(settings),
    });
    this.deadLetters = new Queue<DeadLetter>(EVENTS_DEAD_LETTER_QUEUE, {
      connection,
      prefix: settings.prefix,
      // Dead letters stay until someone deals with them.
      defaultJobOptions: { removeOnComplete: false, removeOnFail: false },
    });
  }

  async add(type: string, envelope: EventEnvelope, options: { readonly jobId: string }) {
    return this.queue.add(type, envelope, { jobId: options.jobId });
  }

  async addDeadLetter(letter: DeadLetter): Promise<void> {
    await this.deadLetters.add(letter.type, letter, { jobId: letter.eventId });
  }

  /** For tests and operational tooling. */
  get events(): Queue<EventEnvelope> {
    return this.queue;
  }

  get deadLetterQueue(): Queue<DeadLetter> {
    return this.deadLetters;
  }

  async close(): Promise<void> {
    await Promise.all([this.queue.close(), this.deadLetters.close()]);
  }
}
