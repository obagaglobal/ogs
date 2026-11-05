import { describe, expect, it, vi } from 'vitest';
import type { Db } from '../database/index.js';
import { AuditEntryError, AuditService } from './audit.service.js';

function fakeDb() {
  const createMany = vi.fn().mockResolvedValue({ count: 1 });
  return { db: { auditLog: { createMany } } as unknown as Db, createMany };
}

function firstRow(createMany: ReturnType<typeof vi.fn>): Record<string, unknown> {
  const call = createMany.mock.calls[0] as [{ data: Record<string, unknown>[] }] | undefined;
  return call?.[0].data[0] ?? {};
}

describe('AuditService', () => {
  const service = new AuditService();

  it('writes one row and never passes actor columns (the database fills them)', async () => {
    const { db, createMany } = fakeDb();
    await service.record(db, {
      action: 'tenant.approved',
      tenantId: '01930000-0000-7000-8000-000000000002',
      entityType: 'tenant',
      entityId: '01930000-0000-7000-8000-000000000002',
      request: { requestId: 'req-1', ip: '203.0.113.7', userAgent: 'test' },
      metadata: { previousStatus: 'PENDING_APPROVAL' },
    });
    expect(createMany).toHaveBeenCalledOnce();
    const row = firstRow(createMany);
    expect(row).toMatchObject({ action: 'tenant.approved', ip: '203.0.113.7' });
    expect(row).not.toHaveProperty('actorUserId');
    expect(row).not.toHaveProperty('actorKind');
  });

  it('drops an invalid IP instead of failing the business transaction', async () => {
    const { db, createMany } = fakeDb();
    await service.record(db, { action: 'user.viewed', request: { ip: 'not-an-ip' } });
    expect(firstRow(createMany)['ip']).toBeNull();
  });

  it.each(['Tenant.Approved', 'approved', 'tenant..approved', 'tenant approved'])(
    'rejects malformed action %j',
    async (action) => {
      const { db } = fakeDb();
      await expect(service.record(db, { action })).rejects.toThrow(AuditEntryError);
    },
  );

  it.each([
    { password: 'x' },
    { newPassword: 'x' },
    { accessToken: 'x' },
    { nested: { client_secret: 'x' } },
    { list: [{ Authorization: 'Bearer x' }] },
    { otp: '123456' },
    { 'api-key': 'x' },
  ])('rejects secret-looking metadata %j without echoing the value', async (metadata) => {
    const { db, createMany } = fakeDb();
    const error: unknown = await service
      .record(db, { action: 'user.updated', metadata })
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(AuditEntryError);
    expect(String(error)).not.toMatch(/Bearer x|123456/);
    expect(createMany).not.toHaveBeenCalled();
  });

  it('allows innocent keys that merely contain short secret words', async () => {
    const { db, createMany } = fakeDb();
    await service.record(db, { action: 'site.visited', metadata: { footprint: 1, spinner: true } });
    expect(createMany).toHaveBeenCalledOnce();
  });
});
