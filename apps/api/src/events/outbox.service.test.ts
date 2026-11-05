import { describe, expect, it, vi } from 'vitest';
import type { Db } from '../database/index.js';
import { OutboxEventError, OutboxService } from './outbox.service.js';

describe('OutboxService', () => {
  const service = new OutboxService();

  it('inserts with createMany (no RETURNING: writers may not read the outbox)', async () => {
    const createMany = vi.fn().mockResolvedValue({ count: 1 });
    const db = { outboxEvent: { createMany } } as unknown as Db;
    await service.publish(db, { type: 'system.ping', payload: { n: 1 } });
    expect(createMany).toHaveBeenCalledWith({
      data: [{ type: 'system.ping', tenantId: null, payload: { n: 1 } }],
    });
  });

  it('rejects malformed event types', async () => {
    const db = { outboxEvent: { createMany: vi.fn() } } as unknown as Db;
    await expect(service.publish(db, { type: 'Ping', payload: {} })).rejects.toThrow(
      OutboxEventError,
    );
  });
});
