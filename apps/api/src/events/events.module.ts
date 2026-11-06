import { Global, Module } from '@nestjs/common';
import { OutboxService } from './outbox.service.js';

/**
 * Publishing side of events, used by the API and the worker alike. Publishing
 * only writes to the database; nothing here touches Redis.
 */
@Global()
@Module({
  providers: [OutboxService],
  exports: [OutboxService],
})
export class EventsModule {}
