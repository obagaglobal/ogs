import { isIP } from 'node:net';
import { Injectable } from '@nestjs/common';
import type { Db, Prisma } from '../database/index.js';

export interface AuditRequestMeta {
  readonly requestId?: string | null;
  readonly ip?: string | null;
  readonly userAgent?: string | null;
}

export interface AuditEntry {
  /** Dotted lower-case verb, e.g. `tenant.approved` (CHECK-constrained in SQL). */
  readonly action: string;
  /** Owning tenant of the affected record; null/absent for user- or platform-level events. */
  readonly tenantId?: string | null;
  readonly entityType?: string;
  readonly entityId?: string;
  readonly reason?: string;
  readonly request?: AuditRequestMeta;
  /** Non-secret context only. Keys that look like secrets are rejected. */
  readonly metadata?: Prisma.InputJsonObject;
}

export class AuditEntryError extends Error {
  override readonly name = 'AuditEntryError';
}

const ACTION_PATTERN = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/;
/** Normalised key fragments that must never appear in audit metadata. */
const SECRET_KEY_FRAGMENTS = [
  'password',
  'passwd',
  'secret',
  'token',
  'authorization',
  'cookie',
  'apikey',
  'privatekey',
  'credential',
  'cardnumber',
  'cvv',
];
/** Short names matched exactly (as substrings they would catch innocent keys). */
const SECRET_KEY_EXACT = new Set(['otp', 'pin', 'mfacode']);
const MAX_DEPTH = 5;

function assertNoSecretKeys(value: unknown, path: string, depth: number): void {
  if (depth > MAX_DEPTH) {
    throw new AuditEntryError(`audit metadata nested deeper than ${String(MAX_DEPTH)} levels`);
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => {
      assertNoSecretKeys(item, `${path}[${String(index)}]`, depth + 1);
    });
    return;
  }
  if (value === null || typeof value !== 'object') {
    return;
  }
  for (const [key, child] of Object.entries(value)) {
    const normalised = key.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (
      SECRET_KEY_EXACT.has(normalised) ||
      SECRET_KEY_FRAGMENTS.some((fragment) => normalised.includes(fragment))
    ) {
      // Name the path, never the value.
      throw new AuditEntryError(`audit metadata key "${path}${key}" looks like a secret`);
    }
    assertNoSecretKeys(child, `${path}${key}.`, depth + 1);
  }
}

function truncate(value: string | null | undefined, max: number): string | null {
  if (value === undefined || value === null || value.length === 0) {
    return null;
  }
  return value.length > max ? value.slice(0, max) : value;
}

/**
 * Append-only audit trail (review §11 "Repudiation").
 *
 * `record` takes the caller's transaction handle, so the audit row commits or
 * rolls back together with the change it describes. The actor (user and kind)
 * is NOT a parameter: the database fills it from the transaction's RLS context
 * and the insert policy rejects any other value.
 */
@Injectable()
export class AuditService {
  async record(db: Db, entry: AuditEntry): Promise<void> {
    if (!ACTION_PATTERN.test(entry.action) || entry.action.length > 100) {
      throw new AuditEntryError('audit action must be a dotted lower-case name');
    }
    const metadata = entry.metadata ?? {};
    assertNoSecretKeys(metadata, '', 0);

    const ip = entry.request?.ip;
    // createMany: INSERT without RETURNING (the writer may not be allowed to read the row back).
    await db.auditLog.createMany({
      data: [
        {
          action: entry.action,
          tenantId: entry.tenantId ?? null,
          entityType: truncate(entry.entityType, 100),
          entityId: truncate(entry.entityId, 100),
          reason: truncate(entry.reason, 500),
          requestId: truncate(entry.request?.requestId, 100),
          ip: ip !== undefined && ip !== null && isIP(ip) !== 0 ? ip : null,
          userAgent: truncate(entry.request?.userAgent, 500),
          metadata,
        },
      ],
    });
  }
}
