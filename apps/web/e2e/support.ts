import { createHmac } from 'node:crypto';
import { existsSync } from 'node:fs';
import pg from 'pg';

// The e2e test needs the maintenance connection to give its fresh user a
// workspace (membership management arrives in Phase 4).
const apiEnv = new URL('../../api/.env', import.meta.url);
if (existsSync(apiEnv)) {
  process.loadEnvFile(apiEnv);
}

export const MAILPIT_API = process.env['MAILPIT_API_URL'] ?? 'http://127.0.0.1:8025/api/v1';
/** Seeded by `pnpm db:seed`. */
export const ACME_TENANT_ID = '01930000-0000-7000-8000-000000000002';

export async function maintQuery(sql: string, params: unknown[] = []): Promise<void> {
  const connectionString = process.env['DATABASE_MAINT_URL'];
  if (connectionString === undefined) {
    throw new Error('DATABASE_MAINT_URL missing (apps/api/.env)');
  }
  const client = new pg.Client({ connectionString });
  await client.connect();
  try {
    await client.query(sql, params);
  } finally {
    await client.end();
  }
}

export async function grantMembership(
  email: string,
  tenantId: string,
  roleCode: string,
): Promise<void> {
  await maintQuery(
    `WITH m AS (
       INSERT INTO membership (tenant_id, user_id, status, joined_at)
       SELECT $2, u.id, 'ACTIVE', now() FROM app_user u WHERE u.email = $1
       ON CONFLICT (tenant_id, user_id) DO UPDATE SET status = 'ACTIVE'
       RETURNING id
     )
     INSERT INTO membership_role (membership_id, role_id, tenant_id)
     SELECT m.id, r.id, $2 FROM m, role r WHERE r.tenant_id IS NULL AND r.code = $3
     ON CONFLICT DO NOTHING`,
    [email, tenantId, roleCode],
  );
}

/** Polls Mailpit for the newest message to `to` and returns its plain text. */
export async function latestMailText(to: string, timeoutMs = 20_000): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const search = (await (
      await fetch(`${MAILPIT_API}/search?query=${encodeURIComponent(`to:"${to}"`)}`)
    ).json()) as { messages?: { ID: string }[] };
    const id = search.messages?.[0]?.ID;
    if (id !== undefined) {
      const message = (await (await fetch(`${MAILPIT_API}/message/${id}`)).json()) as {
        Text: string;
      };
      return message.Text;
    }
    if (Date.now() > deadline) {
      throw new Error(`no email to ${to}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}

/** RFC 6238 TOTP (SHA-1, 6 digits, 30 s) from a base32 secret, like an authenticator app. */
export function totp(base32Secret: string, now = Date.now()): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = '';
  for (const char of base32Secret.replace(/=+$/, '').toUpperCase()) {
    bits += alphabet.indexOf(char).toString(2).padStart(5, '0');
  }
  const bytes = Buffer.from(bits.match(/.{8}/g)?.map((byte) => parseInt(byte, 2)) ?? []);
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(now / 1000 / 30)));
  const hmac = createHmac('sha1', bytes).update(counter).digest();
  const offset = (hmac[hmac.length - 1] ?? 0) & 0x0f;
  return String((hmac.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).padStart(6, '0');
}
