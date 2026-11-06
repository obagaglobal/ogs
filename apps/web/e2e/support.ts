import { argon2Sync, createHmac, randomBytes } from 'node:crypto';
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

/**
 * Polls Mailpit for the newest message to `to` (whose subject matches, when
 * given) and returns its plain text. Emails are sent by the worker, so they
 * arrive a moment after the action that caused them.
 */
export async function latestMailText(
  to: string,
  subject?: RegExp,
  timeoutMs = 20_000,
): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const search = (await (
      await fetch(`${MAILPIT_API}/search?query=${encodeURIComponent(`to:"${to}"`)}`)
    ).json()) as { messages?: { ID: string; Subject: string }[] };
    const id = search.messages?.find((m) => subject === undefined || subject.test(m.Subject))?.ID;
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

/** Seeded by `pnpm db:seed`. */
export const PLATFORM_TENANT_ID = '01930000-0000-7000-8000-000000000001';

/** Same PHC format and parameters as the API's PasswordHasher. */
function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const tag = argon2Sync('argon2id', {
    message: Buffer.from(password.normalize('NFKC'), 'utf8'),
    nonce: salt,
    memory: 19456,
    passes: 2,
    parallelism: 1,
    tagLength: 32,
  });
  const b64 = (b: Buffer) => b.toString('base64').replace(/=+$/, '');
  return `$argon2id$v=19$m=19456,t=2,p=1$${b64(salt)}$${b64(tag)}`;
}

/** A verified OGS staff member (PLATFORM tenant) who can review organisations. */
export async function createReviewer(email: string, password: string): Promise<void> {
  await maintQuery(
    `WITH u AS (INSERT INTO app_user (email, status) VALUES ($1, 'ACTIVE') RETURNING id),
          c AS (INSERT INTO credential (user_id, password_hash) SELECT id, $2 FROM u),
          m AS (INSERT INTO membership (tenant_id, user_id, status, joined_at)
                SELECT $3::uuid, id, 'ACTIVE', now() FROM u RETURNING id)
     INSERT INTO membership_role (membership_id, role_id, tenant_id)
     SELECT m.id, r.id, $3::uuid FROM m, role r
      WHERE r.tenant_id IS NULL AND r.code = 'provider_relationship_manager'`,
    [email, hashPassword(password), PLATFORM_TENANT_ID],
  );
}
