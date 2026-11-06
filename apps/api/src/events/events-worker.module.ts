import {
  Inject,
  Module,
  type BeforeApplicationShutdown,
  type OnApplicationBootstrap,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { TypedConfigService } from '../config/env.js';
import { TenantDb } from '../database/index.js';
import { RedisService } from '../redis/redis.service.js';
import { BullEventQueue, DEFAULT_EVENT_QUEUE_SETTINGS } from './bull-event-queue.js';
import { EventConsumer } from './event-consumer.js';
import { EVENT_HANDLERS, type EventHandler } from './event.types.js';
import {
  AccountExistsHandler,
  AccountLockedHandler,
  EmailVerificationHandler,
  PasswordResetHandler,
} from '../notifications/identity-email.handlers.js';
import { NotificationsModule } from '../notifications/notifications.module.js';
import {
  ApplicationDecisionHandler,
  InvitationEmailHandler,
  SecurityNoticeHandler,
  TenantStatusChangedHandler,
} from '../notifications/organisation-email.handlers.js';
import {
  ProviderDecisionHandler,
  ProviderStatusChangedHandler,
} from '../notifications/provider-email.handlers.js';
import { BasicFileScanner, FileScanHandler, FileScanner } from '../files/file-scanner.js';
import { SystemPingHandler } from './handlers/system-ping.handler.js';
import { PHASE_7_HANDLERS } from '../notifications/order-email.handlers.js';
import {
  QuotationExpiryService,
  QuotationExpirySweeper,
} from '../orders/quotation-expiry.service.js';
import { OutboxDispatcher } from './outbox-dispatcher.service.js';

const EVENT_CONSUMER_CONCURRENCY = 5;

/**
 * Consuming side of events: the outbox dispatcher and the BullMQ worker.
 * Imported by WorkerModule only; the HTTP API never runs these loops.
 */
@Module({
  imports: [NotificationsModule],
  providers: [
    SystemPingHandler,
    { provide: FileScanner, useClass: BasicFileScanner },
    FileScanHandler,
    {
      provide: EVENT_HANDLERS,
      useFactory: (...handlers: EventHandler[]) => handlers,
      inject: [
        SystemPingHandler,
        EmailVerificationHandler,
        PasswordResetHandler,
        AccountExistsHandler,
        AccountLockedHandler,
        FileScanHandler,
        InvitationEmailHandler,
        ApplicationDecisionHandler,
        TenantStatusChangedHandler,
        SecurityNoticeHandler,
        ProviderDecisionHandler,
        ProviderStatusChangedHandler,
        ...PHASE_7_HANDLERS,
      ],
    },
    {
      provide: BullEventQueue,
      useFactory: (redis: RedisService, config: TypedConfigService) =>
        new BullEventQueue(redis.createConnection('events-producer'), {
          ...DEFAULT_EVENT_QUEUE_SETTINGS,
          prefix: config.get('QUEUE_PREFIX', { infer: true }),
        }),
      inject: [RedisService, ConfigService],
    },
    {
      provide: QuotationExpirySweeper,
      useFactory: (expiry: QuotationExpiryService) => new QuotationExpirySweeper(expiry),
      inject: [QuotationExpiryService],
    },
    {
      provide: OutboxDispatcher,
      useFactory: (db: TenantDb, queue: BullEventQueue, config: TypedConfigService) =>
        new OutboxDispatcher(db, queue, {
          batchSize: config.get('OUTBOX_BATCH_SIZE', { infer: true }),
          pollIntervalMs: config.get('OUTBOX_POLL_INTERVAL_MS', { infer: true }),
        }),
      inject: [TenantDb, BullEventQueue, ConfigService],
    },
    {
      provide: EventConsumer,
      useFactory: (
        redis: RedisService,
        queue: BullEventQueue,
        handlers: EventHandler[],
        config: TypedConfigService,
      ) =>
        new EventConsumer(redis.createConnection('events-consumer'), queue, handlers, {
          prefix: config.get('QUEUE_PREFIX', { infer: true }),
          concurrency: EVENT_CONSUMER_CONCURRENCY,
        }),
      inject: [RedisService, BullEventQueue, EVENT_HANDLERS, ConfigService],
    },
  ],
})
export class EventsWorkerModule implements OnApplicationBootstrap, BeforeApplicationShutdown {
  constructor(
    @Inject(OutboxDispatcher) private readonly dispatcher: OutboxDispatcher,
    @Inject(EventConsumer) private readonly consumer: EventConsumer,
    @Inject(BullEventQueue) private readonly queue: BullEventQueue,
    @Inject(QuotationExpirySweeper) private readonly sweeper: QuotationExpirySweeper,
  ) {}

  onApplicationBootstrap(): void {
    this.consumer.start();
    this.dispatcher.start();
    this.sweeper.start();
  }

  // Runs before RedisService/PrismaService close their connections (onApplicationShutdown).
  async beforeApplicationShutdown(): Promise<void> {
    // Stop taking new work first, then let in-flight jobs finish, then close.
    await this.sweeper.stop();
    await this.dispatcher.stop();
    await this.consumer.stop();
    await this.queue.close();
  }
}
