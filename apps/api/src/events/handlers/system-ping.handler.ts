import { Injectable, Logger } from '@nestjs/common';
import type { EventEnvelope, EventHandler } from '../event.types.js';

/**
 * Proves the outbox → dispatcher → queue → handler pipeline end to end.
 * Publish `system.ping` and the worker logs it. Idempotent: it only logs.
 */
@Injectable()
export class SystemPingHandler implements EventHandler {
  readonly type = 'system.ping';
  private readonly logger = new Logger(SystemPingHandler.name);

  handle(envelope: EventEnvelope): Promise<void> {
    this.logger.log(`system.ping received (${envelope.eventId})`);
    return Promise.resolve();
  }
}
