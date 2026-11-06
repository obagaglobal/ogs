import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TenantDb, type DbContext } from '../../src/database/index.js';
import { BasicFileScanner, FileScanHandler } from '../../src/files/file-scanner.js';
import {
  FileNotAvailableError,
  FileNotFoundError,
  FileRejectedError,
  FileService,
} from '../../src/files/file.service.js';
import { ObjectStorage } from '../../src/files/object-storage.js';
import { startStack, type Stack } from './http-harness.js';
import { connect, createMembership, createTenant, createUser } from './support.js';

// Smallest byte strings that file-type recognises.
const PDF = Buffer.from('%PDF-1.4\n1 0 obj << >> endobj\ntrailer << >>\n%%EOF\n');
const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.from('0000000d49484452000000010000000108060000001f15c489', 'hex'),
]);

let stack: Stack;
let maint: pg.Client;
let files: FileService;
let storage: ObjectStorage;
let scanner: FileScanHandler;

const workspace = (userId: string, tenantId: string): DbContext => ({
  kind: 'workspace',
  userId,
  tenantId,
  restricted: false,
});

async function scan(fileId: string): Promise<void> {
  await scanner.handle({
    eventId: fileId,
    type: 'files.uploaded',
    tenantId: null,
    payload: { fileId },
    occurredAt: new Date().toISOString(),
  });
}

async function statusOf(fileId: string): Promise<{ status: string; status_reason: string | null }> {
  const { rows } = await maint.query<{ status: string; status_reason: string | null }>(
    'SELECT status, status_reason FROM file_metadata WHERE id = $1',
    [fileId],
  );
  const row = rows[0];
  if (row === undefined) {
    throw new Error('file not found');
  }
  return row;
}

beforeAll(async () => {
  // No worker: the scan is run by hand so the QUARANTINED state can be observed.
  stack = await startStack({ worker: false });
  maint = await connect('maint');
  files = stack.app.get(FileService);
  storage = stack.app.get(ObjectStorage);
  scanner = new FileScanHandler(stack.app.get(TenantDb), storage, new BasicFileScanner());
});

afterAll(async () => {
  await maint.end();
  await stack.close();
});

describe('B4 — file storage', () => {
  let userA: string;
  let tenantA: string;
  let userB: string;
  let tenantB: string;

  beforeAll(async () => {
    tenantA = await createTenant(maint);
    tenantB = await createTenant(maint);
    userA = await createUser(maint);
    userB = await createUser(maint);
    await createMembership(maint, tenantA, userA);
    await createMembership(maint, tenantB, userB);
  });

  it('stores a tenant file quarantined, releases it after the scan, then serves a 60-second link', async () => {
    const ctx = workspace(userA, tenantA);
    const stored = await files.upload(ctx, {
      purpose: 'provider.document',
      originalName: 'licence.pdf',
      bytes: PDF,
    });
    expect(stored).toMatchObject({ mimeType: 'application/pdf', status: 'QUARANTINED' });
    await expect(files.downloadUrl(ctx, stored.id)).rejects.toBeInstanceOf(FileNotAvailableError);

    await scan(stored.id);
    expect((await statusOf(stored.id)).status).toBe('CLEAN');

    const { url, expiresInSeconds } = await files.downloadUrl(ctx, stored.id);
    expect(expiresInSeconds).toBe(60);
    expect(url).toContain('X-Amz-Expires=60');
    const download = await fetch(url);
    expect(download.status).toBe(200);
    expect(download.headers.get('content-disposition')).toBe('attachment; filename="licence.pdf"');
    expect(Buffer.from(await download.arrayBuffer()).equals(PDF)).toBe(true);
    // An unsigned request for the same object is refused: the bucket is private.
    expect((await fetch(url.split('?')[0] ?? '')).status).toBeGreaterThanOrEqual(400);
  });

  it('another tenant (or the same user acting personally) cannot reach the file', async () => {
    const stored = await files.upload(workspace(userA, tenantA), {
      purpose: 'provider.document',
      originalName: 'secret.pdf',
      bytes: PDF,
    });
    await scan(stored.id);
    await expect(files.downloadUrl(workspace(userB, tenantB), stored.id)).rejects.toBeInstanceOf(
      FileNotFoundError,
    );
    await expect(
      files.downloadUrl({ kind: 'user', userId: userA }, stored.id),
    ).rejects.toBeInstanceOf(FileNotFoundError);
  });

  it('personal files belong to their owner only', async () => {
    const stored = await files.upload(
      { kind: 'user', userId: userA },
      {
        purpose: 'user.avatar',
        originalName: 'me.png',
        bytes: PNG,
      },
    );
    await scan(stored.id);
    expect((await files.downloadUrl({ kind: 'user', userId: userA }, stored.id)).url).toContain(
      stored.id,
    );
    await expect(
      files.downloadUrl({ kind: 'user', userId: userB }, stored.id),
    ).rejects.toBeInstanceOf(FileNotFoundError);
  });

  it.each([
    [
      'type detected from bytes, not the name',
      'provider.document',
      'evil.pdf',
      Buffer.from('#!/bin/sh\nrm -rf /\n'),
      'type_not_allowed',
    ],
    ['allowed type list per purpose', 'user.avatar', 'doc.pdf', PDF, 'type_not_allowed'],
    [
      'size limit per purpose',
      'user.avatar',
      'huge.png',
      Buffer.concat([PNG, Buffer.alloc(2 * 1024 * 1024)]),
      'too_large',
    ],
    ['unknown purpose', 'random.thing', 'a.pdf', PDF, 'unknown_purpose'],
    ['empty file', 'provider.document', 'a.pdf', Buffer.alloc(0), 'empty_file'],
  ])('rejects: %s', async (_label, purpose, originalName, bytes, reason) => {
    // Avatars are personal; everything else is uploaded in the tenant workspace.
    const ctx: DbContext =
      purpose === 'user.avatar' ? { kind: 'user', userId: userA } : workspace(userA, tenantA);
    await expect(files.upload(ctx, { purpose, originalName, bytes })).rejects.toMatchObject({
      reason,
    });
  });

  it('avatars cannot be owned by a tenant', async () => {
    await expect(
      files.upload(workspace(userA, tenantA), {
        purpose: 'user.avatar',
        originalName: 'x.png',
        bytes: PNG,
      }),
    ).rejects.toBeInstanceOf(FileRejectedError);
  });

  it('the scanner rejects an object whose bytes changed after upload', async () => {
    const stored = await files.upload(workspace(userA, tenantA), {
      purpose: 'provider.document',
      originalName: 'tampered.pdf',
      bytes: PDF,
    });
    const { rows } = await maint.query<{ storage_key: string }>(
      'SELECT storage_key FROM file_metadata WHERE id = $1',
      [stored.id],
    );
    await storage.put(
      rows[0]?.storage_key ?? '',
      Buffer.from('%PDF-1.4 different'),
      'application/pdf',
    );
    await scan(stored.id);
    expect(await statusOf(stored.id)).toEqual({
      status: 'REJECTED',
      status_reason: 'integrity_mismatch',
    });
    await expect(files.downloadUrl(workspace(userA, tenantA), stored.id)).rejects.toBeInstanceOf(
      FileNotAvailableError,
    );
  });

  it('a tenant user cannot mark a file clean (only the scanner job can)', async () => {
    const stored = await files.upload(workspace(userA, tenantA), {
      purpose: 'provider.document',
      originalName: 'x.pdf',
      bytes: PDF,
    });
    const db = stack.app.get(TenantDb);
    const changed = await db.run(workspace(userA, tenantA), async (tx) =>
      tx.fileMetadata.updateMany({ where: { id: stored.id }, data: { status: 'CLEAN' } }),
    );
    expect(changed.count).toBe(0);
    expect((await statusOf(stored.id)).status).toBe('QUARANTINED');
  });
});
