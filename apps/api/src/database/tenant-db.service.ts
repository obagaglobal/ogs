import { Injectable } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client.js';
import { toSessionSettings, type DbContext } from './db-context.js';
import { PrismaService } from './prisma.service.js';

/**
 * The transaction handle business code receives. It can run queries but cannot
 * open nested transactions or disconnect.
 */
export type Db = Prisma.TransactionClient;

export interface RunOptions {
  /** Default: READ COMMITTED. */
  readonly isolationLevel?: Prisma.TransactionIsolationLevel;
  /** Maximum time the unit of work may take. Default 10 s. */
  readonly timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 10_000;
const MAX_WAIT_FOR_CONNECTION_MS = 5_000;

/**
 * The only door to the database for application code (review §6.2).
 *
 * Every unit of work is one interactive transaction whose FIRST statement sets
 * the RLS context with set_config(..., is_local => true). Transaction-local
 * settings disappear at COMMIT or ROLLBACK, so a pooled connection can never
 * carry one request's tenant into the next. Session-level SET is banned.
 */
@Injectable()
export class TenantDb {
  constructor(private readonly prisma: PrismaService) {}

  async run<T>(ctx: DbContext, work: (db: Db) => Promise<T>, options: RunOptions = {}): Promise<T> {
    const settings = toSessionSettings(ctx);

    return this.prisma.client.$transaction(
      async (tx) => {
        await tx.$executeRaw`
          SELECT set_config('app.user_id', ${settings['app.user_id']}, true),
                 set_config('app.tenant_id', ${settings['app.tenant_id']}, true),
                 set_config('app.is_platform', ${settings['app.is_platform']}, true),
                 set_config('app.actor_kind', ${settings['app.actor_kind']}, true)`;

        if (ctx.kind === 'platform') {
          // Review §6.3: every use of platform context is audited, in the same
          // transaction, so the record exists exactly when the work commits.
          // createMany issues no RETURNING (see audit_log RLS notes).
          await tx.auditLog.createMany({
            data: [
              {
                action: 'platform.context_used',
                reason: ctx.reason.trim(),
                tenantId: ctx.tenantId ?? null,
              },
            ],
          });
        }

        return work(tx);
      },
      {
        isolationLevel: options.isolationLevel ?? Prisma.TransactionIsolationLevel.ReadCommitted,
        timeout: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
        maxWait: MAX_WAIT_FOR_CONNECTION_MS,
      },
    );
  }
}
