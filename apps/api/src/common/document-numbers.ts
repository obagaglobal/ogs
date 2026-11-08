import type { Db } from '../database/index.js';

/** Document kinds with yearly counters (P7-8): requests, quotations, orders, tickets. */
export type DocumentKind = 'REQ' | 'QUO' | 'ORD' | 'TCK';

/**
 * Next document number, e.g. REQ-2026-000123 (P7-8). The counter row is
 * upserted and incremented in the caller's transaction, so concurrent callers
 * serialise on it and a rolled-back transaction gives its number back.
 */
export async function nextNumber(tx: Db, kind: DocumentKind): Promise<string> {
  const rows = await tx.$queryRaw<{ year: number; last: number }[]>`
    INSERT INTO document_counter (kind, year, last)
    VALUES (${kind}, EXTRACT(YEAR FROM now() AT TIME ZONE 'Africa/Nairobi')::int, 1)
    ON CONFLICT (kind, year) DO UPDATE SET last = document_counter.last + 1
    RETURNING year, last`;
  const row = rows[0];
  if (row === undefined) {
    throw new Error('document counter returned no row');
  }
  return `${kind}-${String(row.year)}-${String(row.last).padStart(6, '0')}`;
}
