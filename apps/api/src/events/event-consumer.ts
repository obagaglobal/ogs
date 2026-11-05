import { Logger } from '@nestjs/common';
import { Worker, type Job } from 'bullmq';
import type { Redis } from 'ioredis';
import type { BullEventQueue } from './bull-event-queue.js';
import { EVENTS_QUEUE, type EventEnvelope, type EventHandler } from './event.types.js';

export interface EventConsumerSettings {
  readonly prefix: string;
  readonly concurrency: number;
}

/**
 * Runs event handlers from the events queue (worker process only).
 *
 * Retries come from the job options (exponential backoff). When the last
 * attempt fails the event is copied to the dead-letter queue and logged.
 * Logs carry the event id, type and error class, never the payload.
 */
export class EventConsumer {
  private readonly logger = new Logger(EventConsumer.name);
  private readonly handlers: ReadonlyMap<string, EventHandler>;
  private worker: Worker<EventEnvelope> | undefined;

  constructor(
    private readonly connection: Redis,
    private readonly queue: BullEventQueue,
    handlers: readonly EventHandler[],
    private readonly settings: EventConsumerSettings,
  ) {
    const byType = new Map<string, EventHandler>();
    for (const handler of handlers) {
      if (byType.has(handler.type)) {
        throw new Error(`Duplicate event handler for "${handler.type}"`);
      }
      byType.set(handler.type, handler);
    }
    this.handlers = byType;
  }

  start(): void {
    if (this.worker !== undefined) {
      return;
    }
    const worker = new Worker<EventEnvelope>(EVENTS_QUEUE, async (job) => this.process(job), {
      connection: this.connection,
      prefix: this.settings.prefix,
      concurrency: this.settings.concurrency,
    });
    worker.on('failed', (job, error) => {
      if (job === undefined) {
        return;
      }
      void this.onFailed(job, error);
    });
    worker.on('error', (error) => {
      this.logger.error(`Event worker error (${error.name})`);
    });
    this.worker = worker;
  }

  async stop(): Promise<void> {
    await this.worker?.close();
    this.worker = undefined;
  }

  private async process(job: Job<EventEnvelope>): Promise<void> {
    const handler = this.handlers.get(job.data.type);
    if (handler === undefined) {
      // Nothing subscribes to this event yet: completing it is correct.
      this.logger.debug(`No handler for ${job.data.type} (${job.data.eventId})`);
      return;
    }
    await handler.handle(job.data);
  }

  private async onFailed(job: Job<EventEnvelope>, error: Error): Promise<void> {
    const maxAttempts = job.opts.attempts ?? 1;
    const label = `${job.data.type} (${job.data.eventId}), attempt ${String(job.attemptsMade)}/${String(maxAttempts)}`;
    if (job.attemptsMade < maxAttempts) {
      this.logger.warn(`Event handler failed for ${label}: ${error.name}; will retry`);
      return;
    }
    this.logger.error(
      `Event handler gave up on ${label}: ${error.name}; moved to dead-letter queue`,
    );
    try {
      await this.queue.addDeadLetter({
        ...job.data,
        attemptsMade: job.attemptsMade,
        failure: error.name,
      });
    } catch (dlqError) {
      const name = dlqError instanceof Error ? dlqError.name : 'UnknownError';
      this.logger.error(`Could not dead-letter ${label}: ${name}`);
    }
  }
}
