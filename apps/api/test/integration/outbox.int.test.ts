import { randomUUID } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';
import { Redis } from 'ioredis';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { DbContext } from '../../src/database/index.js';
import { BullEventQueue } from '../../src/events/bull-event-queue.js';
import { EventConsumer } from '../../src/events/event-consumer.js';
import type { EventEnvelope, EventHandler, EventQueue } from '../../src/events/event.types.js';
import { OutboxDispatcher } from '../../src/events/outbox-dispatcher.service.js';
import { OutboxService } from '../../src/events/outbox.service.js';
import { connect, createTenantDb, createTwoTenants, urls, type Fixture } from './support.js';

class RecordingQueue implements EventQueue {
  readonly jobIds: string[] = [];
  failWith: Error | undefined;

  async add(_type: string, _envelope: EventEnvelope, options: { readonly jobId: string }) {
    if (this.failWith !== undefined) {
      throw this.failWith;
    }
    // Yield so two dispatchers genuinely interleave.
    await sleep(1);
    this.jobIds.push(options.jobId);
  }
}

async function until(condition: () => Promise<boolean>, timeoutMs = 15_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!(await condition())) {
    if (Date.now() > deadline) {
      throw new Error('condition not met in time');
    }
    await sleep(50);
  }
}

describe('transactional outbox (T8)', () => {
  let maint: pg.Client;
  let fx: Fixture;
  const { db, client } = createTenantDb(5);
  const outbox = new OutboxService();

  beforeAll(async () => {
    maint = await connect('maint');
    fx = await createTwoTenants(maint);
  });

  afterAll(async () => {
    await client.$disconnect();
    await maint.end();
  });

  const ctxA = (): DbContext => ({
    kind: 'workspace',
    userId: fx.userA,
    tenantId: fx.tenantA,
    restricted: false,
  });

  async function eventIds(marker: string): Promise<{ id: string; dispatched: boolean }[]> {
    const result = await maint.query<{ id: string; dispatched: boolean }>(
      `SELECT id, dispatched_at IS NOT NULL AS dispatched FROM outbox_event WHERE payload->>'marker' = $1`,
      [marker],
    );
    return result.rows;
  }

  async function drain(dispatcher: OutboxDispatcher): Promise<void> {
    while ((await dispatcher.dispatchBatch()) > 0) {
      // keep going until nothing is left
    }
  }

  it('a committed change produces exactly one event', async () => {
    const marker = randomUUID();
    await db.run(ctxA(), async (tx) =>
      outbox.publish(tx, { type: 'test.committed', tenantId: fx.tenantA, payload: { marker } }),
    );
    expect(await eventIds(marker)).toHaveLength(1);
  });

  it('a rolled-back change produces no event', async () => {
    const marker = randomUUID();
    await expect(
      db.run(ctxA(), async (tx) => {
        await outbox.publish(tx, {
          type: 'test.rolled_back',
          tenantId: fx.tenantA,
          payload: { marker },
        });
        throw new Error('business failure');
      }),
    ).rejects.toThrow('business failure');
    expect(await eventIds(marker)).toHaveLength(0);
  });

  it('cannot publish an event for another tenant', async () => {
    await expect(
      db.run(ctxA(), async (tx) =>
        outbox.publish(tx, { type: 'test.cross_tenant', tenantId: fx.tenantB, payload: {} }),
      ),
    ).rejects.toThrow();
  });

  it('two racing dispatchers enqueue every event exactly once', async () => {
    const marker = randomUUID();
    await db.run(ctxA(), async (tx) => {
      for (let i = 0; i < 30; i += 1) {
        await outbox.publish(tx, {
          type: 'test.race',
          tenantId: fx.tenantA,
          payload: { marker, i },
        });
      }
    });
    const ours = new Set((await eventIds(marker)).map((row) => row.id));

    const queue1 = new RecordingQueue();
    const queue2 = new RecordingQueue();
    const options = { batchSize: 7, pollIntervalMs: 50 };
    await Promise.all([
      drain(new OutboxDispatcher(db, queue1, options)),
      drain(new OutboxDispatcher(db, queue2, options)),
    ]);

    const enqueued = [...queue1.jobIds, ...queue2.jobIds].filter((id) => ours.has(id));
    expect(enqueued).toHaveLength(30);
    expect(new Set(enqueued).size).toBe(30);
    expect((await eventIds(marker)).every((row) => row.dispatched)).toBe(true);
  });

  it('an enqueue failure rolls back: the event stays pending and is retried', async () => {
    const marker = randomUUID();
    await db.run(ctxA(), async (tx) =>
      outbox.publish(tx, { type: 'test.retry', tenantId: fx.tenantA, payload: { marker } }),
    );
    const queue = new RecordingQueue();
    queue.failWith = new Error('redis down');
    const dispatcher = new OutboxDispatcher(db, queue, { batchSize: 1000, pollIntervalMs: 50 });

    await expect(dispatcher.dispatchBatch()).rejects.toThrow('redis down');
    expect(await eventIds(marker)).toEqual([expect.objectContaining({ dispatched: false })]);

    queue.failWith = undefined;
    await drain(dispatcher);
    expect(await eventIds(marker)).toEqual([expect.objectContaining({ dispatched: true })]);
  });

  describe('through real BullMQ', () => {
    const handled: string[] = [];
    const handlers: EventHandler[] = [
      {
        type: 'test.works',
        handle: async (envelope) => {
          handled.push(envelope.eventId);
          return Promise.resolve();
        },
      },
      {
        type: 'test.always_fails',
        handle: async () => Promise.reject(new TypeError('handler bug')),
      },
    ];
    let producerConnection: Redis;
    let consumerConnection: Redis;
    let queue: BullEventQueue;
    let consumer: EventConsumer;

    beforeAll(() => {
      const { redis, queuePrefix } = urls();
      producerConnection = new Redis(redis, { maxRetriesPerRequest: null });
      consumerConnection = new Redis(redis, { maxRetriesPerRequest: null });
      queue = new BullEventQueue(producerConnection, {
        prefix: queuePrefix,
        attempts: 2,
        backoffMs: 10,
      });
      consumer = new EventConsumer(consumerConnection, queue, handlers, {
        prefix: queuePrefix,
        concurrency: 2,
      });
      consumer.start();
    });

    afterAll(async () => {
      await consumer.stop();
      await queue.events.obliterate({ force: true });
      await queue.deadLetterQueue.obliterate({ force: true });
      await queue.close();
      producerConnection.disconnect();
      consumerConnection.disconnect();
    });

    it('delivers to the handler, retries a failing one, then dead-letters it', async () => {
      const marker = randomUUID();
      await db.run(ctxA(), async (tx) => {
        await outbox.publish(tx, { type: 'test.works', tenantId: fx.tenantA, payload: { marker } });
        await outbox.publish(tx, {
          type: 'test.always_fails',
          tenantId: fx.tenantA,
          payload: { marker },
        });
      });
      const rows = await maint.query<{ id: string; type: string }>(
        `SELECT id, type FROM outbox_event WHERE payload->>'marker' = $1`,
        [marker],
      );
      const worksId = rows.rows.find((row) => row.type === 'test.works')?.id;
      const failsId = rows.rows.find((row) => row.type === 'test.always_fails')?.id;

      await drain(new OutboxDispatcher(db, queue, { batchSize: 1000, pollIntervalMs: 50 }));

      await until(async () => Promise.resolve(worksId !== undefined && handled.includes(worksId)));
      await until(
        async () => (await queue.deadLetterQueue.getJob(failsId ?? 'missing')) !== undefined,
      );

      const letter = await queue.deadLetterQueue.getJob(failsId ?? 'missing');
      expect(letter?.data).toMatchObject({
        eventId: failsId,
        type: 'test.always_fails',
        attemptsMade: 2,
        failure: 'TypeError',
      });
      // Handled once, even though the dispatcher could have re-sent it.
      expect(handled.filter((id) => id === worksId)).toHaveLength(1);
    });
  });
});
