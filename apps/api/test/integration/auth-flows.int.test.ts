import { Redis } from 'ioredis';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PasswordHasher } from '../../src/identity/password-hasher.js';
import {
  Client,
  createLoginUser,
  mailsTo,
  maintAsPlatform,
  startStack,
  tokenFrom,
  uniqueEmail,
  waitForMail,
  type Stack,
} from './http-harness.js';
import { connect, urls } from './support.js';

const GOOD_PASSWORD = 'tea plantation sunrise kericho';

let stack: Stack;
let maint: pg.Client;
let redis: Redis;

beforeAll(async () => {
  stack = await startStack();
  maint = await connect('maint');
  redis = new Redis(urls().redis);
});

afterAll(async () => {
  redis.disconnect();
  await maint.end();
  await stack.close();
});

async function authEvents(userId: string): Promise<string[]> {
  const { rows } = await maint.query<{ kind: string }>(
    'SELECT kind FROM authentication_event WHERE user_id = $1 ORDER BY occurred_at, id',
    [userId],
  );
  return rows.map((row) => row.kind);
}

async function userId(email: string): Promise<string> {
  const { rows } = await maint.query<{ id: string }>('SELECT id FROM app_user WHERE email = $1', [
    email,
  ]);
  const id = rows[0]?.id;
  if (id === undefined) {
    throw new Error(`no user ${email}`);
  }
  return id;
}

/** Finds a session record in Redis by its public id (tests only). */
async function sessionKey(publicId: string): Promise<string> {
  for (const key of await redis.keys(`${urls().queuePrefix}:sess:*`)) {
    const raw = await redis.get(key);
    if (raw !== null && (JSON.parse(raw) as { id: string }).id === publicId) {
      return key;
    }
  }
  throw new Error('session not found in Redis');
}

describe('A1 — register, verify, sign in, sign out, reset', () => {
  it('runs the whole account lifecycle through the API, worker and Mailpit', async () => {
    const client = new Client(stack.server);
    const email = uniqueEmail('lifecycle');

    expect((await client.post('/auth/register', { email, password: GOOD_PASSWORD })).status).toBe(
      202,
    );
    const verification = await waitForMail(email, /Confirm your email/);
    expect(verification.text).toContain('http://localhost:5173/verify-email#token=');

    // Unverified users can sign in but do nothing else (P3-7).
    const login = await client.login(email, GOOD_PASSWORD);
    expect(login.status).toBe(200);
    expect(login.body).toMatchObject({ user: { email, status: 'PENDING_VERIFICATION' } });
    expect((await client.get('/me/workspaces')).body).toEqual({ error: 'email_unverified' });

    expect(
      (await client.post('/auth/verify-email', { token: tokenFrom(verification) })).status,
    ).toBe(204);
    expect((await client.get('/me/workspaces')).status).toBe(200);
    // Single use.
    expect(
      (await client.post('/auth/verify-email', { token: tokenFrom(verification) })).body,
    ).toEqual({
      error: 'invalid_or_expired_token',
    });

    expect((await client.post('/auth/logout')).status).toBe(204);
    expect((await client.get('/auth/session')).status).toBe(401);

    // Forgot → reset: every existing session is signed out.
    const other = new Client(stack.server);
    await other.login(email, GOOD_PASSWORD);
    expect((await other.get('/auth/session')).status).toBe(200);
    expect((await client.post('/auth/password/forgot', { email })).status).toBe(202);
    const reset = await waitForMail(email, /Reset your OGS password/);
    const newPassword = 'mangoes ripen slowly in mombasa';
    expect(
      (
        await client.post('/auth/password/reset', {
          token: tokenFrom(reset),
          password: newPassword,
        })
      ).status,
    ).toBe(204);
    expect((await other.get('/auth/session')).status).toBe(401);
    expect((await client.login(email, GOOD_PASSWORD)).status).toBe(401);
    expect((await client.login(email, newPassword)).status).toBe(200);

    const id = await userId(email);
    expect(await authEvents(id)).toEqual(
      expect.arrayContaining([
        'REGISTERED',
        'LOGIN_SUCCEEDED',
        'EMAIL_VERIFIED',
        'LOGOUT',
        'PASSWORD_RESET_REQUESTED',
        'PASSWORD_RESET_COMPLETED',
        'LOGIN_FAILED',
      ]),
    );
  });

  it('rejects a breached or email-derived password with a reason code', async () => {
    const client = new Client(stack.server);
    const breached = await client.post('/auth/register', {
      email: uniqueEmail(),
      password: 'password1234',
    });
    expect(breached.status).toBe(400);
    expect(breached.body).toEqual({ error: 'weak_password_breached' });
    const short = await client.post('/auth/register', { email: uniqueEmail(), password: 'short' });
    expect(short.body).toEqual({ error: 'invalid_request', fields: ['password'] });
  });
});

describe('A2 — no account enumeration', () => {
  it('register: same answer for a new and an existing email; the owner is told by email', async () => {
    const existing = await createLoginUser(maint);
    const client = new Client(stack.server);
    const fresh = await client.post('/auth/register', {
      email: uniqueEmail(),
      password: GOOD_PASSWORD,
    });
    const taken = await client.post('/auth/register', {
      email: existing.email,
      password: GOOD_PASSWORD,
    });
    expect([fresh.status, fresh.text]).toEqual([taken.status, taken.text]);
    await waitForMail(existing.email, /already have an OGS account/);
  });

  it('login: unknown email, wrong password and disabled account look identical', async () => {
    const active = await createLoginUser(maint);
    const suspended = await createLoginUser(maint, { status: 'SUSPENDED' });
    const client = new Client(stack.server);
    const answers = await Promise.all([
      client.post('/auth/login', { email: uniqueEmail(), password: GOOD_PASSWORD }),
      client.post('/auth/login', { email: active.email, password: 'wrong password entirely' }),
      client.post('/auth/login', { email: suspended.email, password: suspended.password }),
    ]);
    for (const answer of answers) {
      expect([answer.status, answer.body]).toEqual([401, { error: 'invalid_credentials' }]);
    }
  });

  it('login: unknown and known emails take comparable time (dummy hash)', async () => {
    const known = await createLoginUser(maint);
    const client = new Client(stack.server);
    const time = async (email: string) => {
      const started = performance.now();
      await client.post('/auth/login', { email, password: 'not the right one' });
      return performance.now() - started;
    };
    const unknown: number[] = [];
    const existing: number[] = [];
    for (let i = 0; i < 4; i += 1) {
      unknown.push(await time(uniqueEmail()));
      existing.push(await time(known.email));
    }
    const median = (values: number[]) =>
      [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)] ?? 0;
    // Both paths run one Argon2id verification (~40 ms). Without the dummy hash the
    // unknown path would be several times faster.
    expect(median(unknown)).toBeGreaterThan(median(existing) * 0.5);
  });

  it('forgot password: same answer for unknown and known emails', async () => {
    const known = await createLoginUser(maint);
    const client = new Client(stack.server);
    const a = await client.post('/auth/password/forgot', { email: uniqueEmail() });
    const b = await client.post('/auth/password/forgot', { email: known.email });
    expect([a.status, a.text]).toEqual([b.status, b.text]);
    expect(a.status).toBe(202);
  });
});

describe('A3 — Argon2id hashes are upgraded on login', () => {
  it('rehashes a password stored with weaker parameters', async () => {
    const weak = new PasswordHasher({ memoryKiB: 1024, passes: 1, parallelism: 1 });
    const password = 'old parameters need upgrading';
    const user = await createLoginUser(maint, {
      password,
      passwordHash: await weak.hash(password),
    });
    expect((await new Client(stack.server).login(user.email, password)).status).toBe(200);
    const { rows } = await maint.query<{ password_hash: string }>(
      'SELECT password_hash FROM credential WHERE user_id = $1',
      [user.id],
    );
    expect(rows[0]?.password_hash).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$/);
  });
});

describe('A4 — lockout and rate limits', () => {
  it('after 5 failures even the right password is refused briefly', async () => {
    const user = await createLoginUser(maint);
    const client = new Client(stack.server);
    for (let i = 0; i < 5; i += 1) {
      await client.post('/auth/login', { email: user.email, password: 'wrong wrong wrong' });
    }
    expect(
      (await client.post('/auth/login', { email: user.email, password: user.password })).status,
    ).toBe(401);
    expect(await authEvents(user.id)).toContain('LOGIN_FAILED');
  });

  it('10 failures lock the account for 15 minutes and email the owner', async () => {
    const user = await createLoginUser(maint);
    // Clear soft locks between attempts so all 10 reach the password check.
    for (let i = 0; i < 10; i += 1) {
      await maint.query('UPDATE credential SET locked_until = NULL WHERE user_id = $1', [user.id]);
      await new Client(stack.server).post('/auth/login', {
        email: user.email,
        password: `bad ${String(i)}`,
      });
    }
    const { rows } = await maint.query<{ minutes: number }>(
      `SELECT extract(epoch FROM locked_until - now()) / 60 AS minutes FROM credential WHERE user_id = $1`,
      [user.id],
    );
    expect(Number(rows[0]?.minutes)).toBeGreaterThan(14);
    expect(await authEvents(user.id)).toContain('ACCOUNT_LOCKED');
    await waitForMail(user.email, /temporarily locked/);
  });

  it('returns 429 with Retry-After when a client exceeds the per-account limit', async () => {
    const email = uniqueEmail('limited');
    const client = new Client(stack.server);
    let last = await client.post('/auth/login', { email, password: 'x' });
    for (let i = 0; i < 10; i += 1) {
      last = await client.post('/auth/login', { email, password: 'x' });
    }
    expect(last.status).toBe(429);
    expect(Number(last.headers['retry-after'])).toBeGreaterThan(0);
    expect(last.body).toMatchObject({ error: 'rate_limited' });
  });
});

describe('A5 — sessions', () => {
  it('lists sessions, revokes one, revokes all others', async () => {
    const user = await createLoginUser(maint);
    const a = new Client(stack.server);
    const b = new Client(stack.server);
    const c = new Client(stack.server);
    await a.login(user.email, user.password);
    await b.login(user.email, user.password);
    await c.login(user.email, user.password);

    const listed = (await a.get('/auth/sessions')).body as {
      sessions: { id: string; current: boolean }[];
    };
    expect(listed.sessions).toHaveLength(3);
    const bId = ((await b.get('/auth/session')).body as { session: { id: string } }).session.id;

    expect((await a.delete(`/auth/sessions/${bId}`)).status).toBe(204);
    expect((await b.get('/auth/session')).status).toBe(401);
    expect((await a.post('/auth/sessions/revoke-others')).status).toBe(204);
    expect((await c.get('/auth/session')).status).toBe(401);
    expect((await a.get('/auth/session')).status).toBe(200);
  });

  it('cannot revoke another user’s session (404)', async () => {
    const alice = await createLoginUser(maint);
    const bob = await createLoginUser(maint);
    const a = new Client(stack.server);
    const b = new Client(stack.server);
    await a.login(alice.email, alice.password);
    await b.login(bob.email, bob.password);
    const bobSession = ((await b.get('/auth/session')).body as { session: { id: string } }).session
      .id;
    expect((await a.delete(`/auth/sessions/${bobSession}`)).status).toBe(404);
    expect((await b.get('/auth/session')).status).toBe(200);
  });

  it('an idle session expires after 30 minutes; an old one after 12 hours', async () => {
    const user = await createLoginUser(maint);
    const idle = new Client(stack.server);
    const old = new Client(stack.server);
    await idle.login(user.email, user.password);
    await old.login(user.email, user.password);
    const idleId = ((await idle.get('/auth/session')).body as { session: { id: string } }).session
      .id;
    const oldId = ((await old.get('/auth/session')).body as { session: { id: string } }).session.id;

    const age = async (id: string, field: 'lastSeenAt' | 'absoluteExpiresAt', value: number) => {
      const key = await sessionKey(id);
      const record = JSON.parse((await redis.get(key)) ?? '{}') as Record<string, unknown>;
      await redis.set(key, JSON.stringify({ ...record, [field]: value }), 'KEEPTTL');
    };
    await age(idleId, 'lastSeenAt', Date.now() - 31 * 60 * 1000);
    await age(oldId, 'absoluteExpiresAt', Date.now() - 1000);
    expect((await idle.get('/auth/session')).status).toBe(401);
    expect((await old.get('/auth/session')).status).toBe(401);
  });

  it('a password change signs out every other session and rotates this one', async () => {
    const user = await createLoginUser(maint);
    const a = new Client(stack.server);
    const b = new Client(stack.server);
    await a.login(user.email, user.password);
    await b.login(user.email, user.password);
    const before = ((await a.get('/auth/session')).body as { session: { id: string } }).session.id;
    const change = await a.post('/auth/password/change', {
      currentPassword: user.password,
      newPassword: 'a brand new passphrase today',
    });
    expect(change.status).toBe(204);
    expect((await b.get('/auth/session')).status).toBe(401);
    expect((await a.get('/auth/session')).body).toMatchObject({ session: { id: before } });
    // The old CSRF token died with the rotated cookie; fetch a fresh one.
    await a.refreshCsrf();
    expect((await a.post('/auth/logout')).status).toBe(204);
  });

  it('a suspended user is signed out on the next request', async () => {
    const user = await createLoginUser(maint);
    const client = new Client(stack.server);
    await client.login(user.email, user.password);
    await maintAsPlatform(maint, `UPDATE app_user SET status = 'SUSPENDED' WHERE id = $1`, [
      user.id,
    ]);
    expect((await client.get('/auth/session')).status).toBe(401);
  });
});

describe('A6 — CSRF and content type', () => {
  it('unsafe requests need this session’s CSRF token and a JSON body', async () => {
    const alice = await createLoginUser(maint);
    const bob = await createLoginUser(maint);
    const a = new Client(stack.server);
    const b = new Client(stack.server);
    await a.login(alice.email, alice.password);
    await b.login(bob.email, bob.password);

    expect((await a.post('/auth/logout', {}, { csrf: false })).body).toEqual({
      error: 'csrf_invalid',
    });
    expect((await a.post('/auth/logout', {}, { csrf: b.csrf ?? '' })).body).toEqual({
      error: 'csrf_invalid',
    });
    const form = await a.agent
      .post('/api/v1/auth/logout')
      .set('Content-Type', 'application/x-www-form-urlencoded')
      .set('X-CSRF-Token', a.csrf ?? '')
      .send('x=1');
    expect([form.status, form.body]).toEqual([415, { error: 'json_required' }]);
    expect((await a.get('/auth/session')).status).toBe(200);
  });
});

describe('A7 — session cookie flags', () => {
  it('is HttpOnly, SameSite=Lax, Path=/ (Secure + __Host- in production: unit-tested)', async () => {
    const user = await createLoginUser(maint);
    const response = await new Client(stack.server).post('/auth/login', {
      email: user.email,
      password: user.password,
    });
    const cookie = ([] as string[]).concat(response.headers['set-cookie'] ?? [])[0] ?? '';
    expect(cookie).toMatch(/^ogs_session=[A-Za-z0-9_-]{43};/);
    expect(cookie).toMatch(/HttpOnly/);
    expect(cookie).toMatch(/SameSite=Lax/);
    expect(cookie).toMatch(/Path=\//);
    expect(cookie).not.toMatch(/Domain=/);
  });
});

describe('A11 — no secrets leak', () => {
  it('passwords and tokens never appear in responses, audit rows or authentication events', async () => {
    const email = uniqueEmail('secrets');
    const client = new Client(stack.server);
    await client.post('/auth/register', { email, password: GOOD_PASSWORD });
    const mail = await waitForMail(email, /Confirm your email/);
    const token = tokenFrom(mail);
    const login = await client.login(email, GOOD_PASSWORD);
    await client.post('/auth/verify-email', { token });

    expect(JSON.stringify(login.body)).not.toContain(GOOD_PASSWORD);
    const id = await userId(email);
    const dump = await maint.query(
      `SELECT (SELECT coalesce(json_agg(a), '[]') FROM audit_log a WHERE a.entity_id = $1 OR a.actor_user_id::text = $1) AS audit,
              (SELECT coalesce(json_agg(e), '[]') FROM authentication_event e WHERE e.user_id::text = $1) AS events,
              (SELECT coalesce(json_agg(t), '[]') FROM user_token t WHERE t.user_id::text = $1) AS tokens`,
      [id],
    );
    const text = JSON.stringify(dump.rows);
    expect(text).not.toContain(GOOD_PASSWORD);
    expect(text).not.toContain(token);
    expect(text).not.toContain(email); // events store a hash of unknown emails, never the address
  });
});

describe('A12 — email through the outbox', () => {
  it('a re-delivered event sends one email, not two', async () => {
    const email = uniqueEmail('once');
    const client = new Client(stack.server);
    await client.post('/auth/register', { email, password: GOOD_PASSWORD });
    await waitForMail(email, /Confirm your email/);

    // Simulate an at-least-once redelivery of the same event to the handler.
    const { rows } = await maint.query<{
      id: string;
      tenant_id: string | null;
      payload: unknown;
      occurred_at: Date;
    }>(
      `SELECT id, tenant_id, payload, occurred_at FROM outbox_event
        WHERE type = 'identity.email_verification_requested' AND payload->>'userId' = $1`,
      [await userId(email)],
    );
    const event = rows[0];
    if (event === undefined) {
      throw new Error('event not found');
    }
    const { EmailVerificationHandler } =
      await import('../../src/notifications/identity-email.handlers.js');
    const handler = stack.worker.get(EmailVerificationHandler);
    await handler.handle({
      eventId: event.id,
      type: 'identity.email_verification_requested',
      tenantId: event.tenant_id,
      payload: event.payload as never,
      occurredAt: event.occurred_at.toISOString(),
    });
    expect(await mailsTo(email)).toHaveLength(1);
  });
});
