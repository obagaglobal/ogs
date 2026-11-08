import { createHash } from 'node:crypto';
import type { OrderStatus, RequestStatus } from '@ogs/contracts';
import { conflict, unprocessable } from '../common/domain-error.js';
import { Prisma, type Db } from '../database/index.js';
import type { OrderCommand, RequestCommand } from './transitions.js';

export { nextNumber } from '../common/document-numbers.js';

/** Changes a request's status iff it is still at (status, version); writes the history row. */
export async function moveRequest(
  tx: Db,
  request: { id: string; status: RequestStatus; version: number },
  command: RequestCommand,
  to: RequestStatus,
  reason: string | null = null,
): Promise<void> {
  const changed = await tx.serviceRequest.updateMany({
    where: { id: request.id, status: request.status, version: request.version },
    data: {
      status: to,
      version: { increment: 1 },
      ...(to === 'CANCELLED' ? { cancelReason: reason } : {}),
    },
  });
  if (changed.count !== 1) {
    throw conflict('stale_version');
  }
  await tx.serviceRequestEvent.createMany({
    data: [{ requestId: request.id, fromStatus: request.status, toStatus: to, command, reason }],
  });
}

export async function moveOrder(
  tx: Db,
  order: { id: string; status: OrderStatus; version: number },
  command: OrderCommand | 'create',
  to: OrderStatus,
  reason: string | null = null,
  extra: Prisma.ServiceOrderUpdateManyMutationInput = {},
): Promise<number> {
  const changed = await tx.serviceOrder.updateMany({
    where: { id: order.id, status: order.status, version: order.version },
    data: {
      ...extra,
      status: to,
      version: { increment: 1 },
      ...(to === 'CANCELLED' ? { cancelReason: reason } : {}),
    },
  });
  if (changed.count !== 1) {
    throw conflict('stale_version');
  }
  await tx.serviceOrderEvent.createMany({
    data: [{ orderId: order.id, fromStatus: order.status, toStatus: to, command, reason }],
  });
  return order.version + 1;
}

// ---------------------------------------------------------------- idempotency (P7-7)

export interface IdempotencyInput {
  readonly key: string;
  readonly userId: string;
  /** The workspace the call acts in ('personal', a tenant id, 'platform:<id>'). */
  readonly scope: string;
  readonly route: string;
  readonly body: unknown;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function idempotencyKeyFrom(header: unknown): string {
  if (typeof header !== 'string' || !UUID.test(header)) {
    throw unprocessable('idempotency_key_required');
  }
  return header.toLowerCase();
}

/** JSON with sorted keys, so the same body always hashes the same. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonical).join(',')}]`;
  }
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([a], [b]) => a.localeCompare(b));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

/**
 * Runs `work` at most once per key, in the caller's transaction. The key row is
 * inserted first: a concurrent call with the same key blocks on its unique
 * index until this transaction ends, then sees the stored response. The same
 * key with a different body is refused (422); an expired key starts afresh.
 */
export async function idempotent<T>(
  tx: Db,
  input: IdempotencyInput,
  work: () => Promise<T>,
): Promise<T> {
  const hash = createHash('sha256').update(canonical(input.body)).digest('hex');
  await tx.$executeRaw`
    DELETE FROM idempotency_key
     WHERE user_id = ${input.userId}::uuid AND scope = ${input.scope} AND route = ${input.route}
       AND key = ${input.key}::uuid AND expires_at <= now()`;
  const inserted = await tx.$executeRaw`
    INSERT INTO idempotency_key (key, user_id, scope, route, request_hash, expires_at)
    VALUES (${input.key}::uuid, ${input.userId}::uuid, ${input.scope}, ${input.route}, ${hash},
            now() + interval '24 hours')
    ON CONFLICT (user_id, scope, route, key) DO NOTHING`;
  const where = {
    userId_scope_route_key: {
      userId: input.userId,
      scope: input.scope,
      route: input.route,
      key: input.key,
    },
  };
  if (inserted === 0) {
    const existing = await tx.idempotencyKey.findUnique({
      where,
      select: { requestHash: true, responseBody: true },
    });
    if (existing === null) {
      throw conflict('idempotency_in_progress');
    }
    if (existing.responseBody === null) {
      throw conflict('idempotency_in_progress');
    }
    if (existing.requestHash !== hash) {
      throw unprocessable('idempotency_key_reused');
    }
    return existing.responseBody as T;
  }
  const result = await work();
  await tx.idempotencyKey.update({
    where,
    data: { responseStatus: 200, responseBody: result as Prisma.InputJsonValue },
    select: { id: true },
  });
  return result;
}
