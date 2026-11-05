import { Inject, Injectable, Logger, type OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Redis } from 'ioredis';
import { withTimeout } from '../common/with-timeout.js';
import type { TypedConfigService } from '../config/env.js';

const PING_TIMEOUT_MS = 1_000;

/**
 * Creates and tracks Redis connections for this process (BullMQ queues and
 * workers, readiness probe; sessions in Phase 3). All connections are lazy:
 * nothing connects until it is used, so modules can be built without Redis.
 */
@Injectable()
export class RedisService implements OnApplicationShutdown {
  private readonly logger = new Logger(RedisService.name);
  private readonly url: string;
  private readonly connections = new Set<Redis>();
  private healthConnection: Redis | undefined;

  constructor(@Inject(ConfigService) config: TypedConfigService) {
    this.url = config.get('REDIS_URL', { infer: true });
  }

  /**
   * A new connection suitable for BullMQ (which requires
   * `maxRetriesPerRequest: null`). Closed automatically on shutdown.
   */
  createConnection(purpose: string): Redis {
    const connection = new Redis(this.url, {
      lazyConnect: true,
      maxRetriesPerRequest: null,
      connectionName: `ogs-${purpose}`,
    });
    connection.on('error', (error: Error) => {
      // ioredis reconnects on its own; log the class of error, never the URL.
      this.logger.warn(`Redis connection "${purpose}" error: ${error.name}`);
    });
    this.connections.add(connection);
    return connection;
  }

  async isUp(): Promise<boolean> {
    this.healthConnection ??= this.createHealthConnection();
    try {
      await withTimeout(this.healthConnection.ping(), PING_TIMEOUT_MS);
      return true;
    } catch {
      return false;
    }
  }

  async onApplicationShutdown(): Promise<void> {
    await Promise.allSettled(
      [...this.connections].map(async (connection) => {
        if (connection.status === 'wait' || connection.status === 'end') {
          connection.disconnect();
          return;
        }
        await connection.quit();
      }),
    );
    this.connections.clear();
  }

  private createHealthConnection(): Redis {
    const connection = new Redis(this.url, {
      lazyConnect: true,
      // Fail fast: a readiness probe must not queue behind reconnect attempts.
      maxRetriesPerRequest: 0,
      connectTimeout: PING_TIMEOUT_MS,
      connectionName: 'ogs-health',
    });
    connection.on('error', () => {
      // Reported through isUp(); avoid log spam while Redis is down.
    });
    this.connections.add(connection);
    return connection;
  }
}
