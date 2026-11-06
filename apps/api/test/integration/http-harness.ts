import { randomInt, randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import { setTimeout as sleep } from 'node:timers/promises';
import type { INestApplication, INestApplicationContext } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import type pg from 'pg';
import request from 'supertest';
import { PasswordHasher } from '../../src/identity/password-hasher.js';
import { urls } from './support.js';

/**
 * One in-process OGS stack per test file: the HTTP API (AppModule) plus the
 * worker (WorkerModule: outbox dispatcher + email handlers), against the test
 * database, a run-unique Redis prefix and Mailpit (see env-setup.ts).
 */
export interface Stack {
  readonly app: INestApplication;
  readonly worker: INestApplicationContext;
  readonly server: Server;
  close(): Promise<void>;
}

export async function startStack(options: { worker?: boolean } = {}): Promise<Stack> {
  const { AppModule } = await import('../../src/app.module.js');
  const { WorkerModule } = await import('../../src/worker.module.js');
  const { configureApp } = await import('../../src/app.factory.js');

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>({ logger: ['error'] });
  configureApp(app);
  await app.init();

  let worker: INestApplicationContext | undefined;
  if (options.worker !== false) {
    const workerRef = await Test.createTestingModule({ imports: [WorkerModule] }).compile();
    worker = workerRef.createNestApplication({ logger: ['error'] });
    await worker.init();
  }

  return {
    app,
    worker: worker ?? app,
    server: app.getHttpServer(),
    close: async () => {
      if (worker !== undefined) {
        await worker.close();
      }
      await app.close();
    },
  };
}

/** A random documentation-range IP, so per-IP rate limits are per test client. */
const randomIp = () => `198.51.100.${String(randomInt(1, 255))}`;

export interface CallOptions {
  readonly workspace?: string;
  readonly csrf?: string | false;
  readonly headers?: Record<string, string>;
}

/**
 * A browser-like API client: keeps its cookie jar, sends JSON, attaches the
 * session's CSRF token on unsafe requests and its own client IP.
 */
export class Client {
  readonly agent: ReturnType<typeof request.agent>;
  readonly ip = randomIp();
  csrf: string | undefined;

  constructor(server: Server) {
    this.agent = request.agent(server);
  }

  get(path: string, options: CallOptions = {}) {
    return this.decorate(this.agent.get(`/api/v1${path}`), options, false);
  }

  post(path: string, body: unknown = {}, options: CallOptions = {}) {
    return this.decorate(this.agent.post(`/api/v1${path}`).send(body as object), options, true);
  }

  delete(path: string, options: CallOptions = {}) {
    return this.decorate(
      this.agent.delete(`/api/v1${path}`).set('Content-Type', 'application/json'),
      options,
      true,
    );
  }

  async login(email: string, password: string): Promise<request.Response> {
    const response = await this.post('/auth/login', { email, password });
    if (response.status === 200) {
      await this.refreshCsrf();
    }
    return response;
  }

  async refreshCsrf(): Promise<string> {
    const response = await this.get('/auth/csrf');
    const body = response.body as { csrfToken?: string };
    if (response.status !== 200 || body.csrfToken === undefined) {
      throw new Error(`could not fetch CSRF token (${String(response.status)})`);
    }
    this.csrf = body.csrfToken;
    return this.csrf;
  }

  private decorate(test: request.Test, options: CallOptions, unsafe: boolean): request.Test {
    let decorated = test.set('X-Forwarded-For', this.ip);
    if (unsafe) {
      decorated = decorated.set('Content-Type', 'application/json');
      const csrf = options.csrf ?? this.csrf;
      if (csrf !== false && csrf !== undefined) {
        decorated = decorated.set('X-CSRF-Token', csrf);
      }
    }
    if (options.workspace !== undefined) {
      decorated = decorated.set('X-OGS-Workspace', options.workspace);
    }
    for (const [name, value] of Object.entries(options.headers ?? {})) {
      decorated = decorated.set(name, value);
    }
    return decorated;
  }
}

// ---------------------------------------------------------------------------
// Mailpit
// ---------------------------------------------------------------------------

interface MailSummary {
  ID: string;
  Subject: string;
}

export interface Mail {
  readonly subject: string;
  readonly text: string;
  readonly html: string;
}

/** All messages to `to`, newest first. */
export async function mailsTo(to: string): Promise<MailSummary[]> {
  const response = await fetch(
    `${urls().mailpitApi}/search?query=${encodeURIComponent(`to:"${to}"`)}`,
  );
  const body = (await response.json()) as { messages?: MailSummary[] };
  return body.messages ?? [];
}

/** Waits for the n-th message to `to` whose subject matches, and returns it. */
export async function waitForMail(
  to: string,
  subject: RegExp,
  count = 1,
  timeoutMs = 15_000,
): Promise<Mail> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const matching = (await mailsTo(to)).filter((message) => subject.test(message.Subject));
    const message = matching.length >= count ? matching[0] : undefined;
    if (message !== undefined) {
      const full = (await (await fetch(`${urls().mailpitApi}/message/${message.ID}`)).json()) as {
        Subject: string;
        Text: string;
        HTML: string;
      };
      return { subject: full.Subject, text: full.Text, html: full.HTML };
    }
    if (Date.now() > deadline) {
      throw new Error(`no email "${subject.source}" to ${to} within ${String(timeoutMs)} ms`);
    }
    await sleep(100);
  }
}

export function tokenFrom(mail: Mail): string {
  const match = /#token=([A-Za-z0-9_-]{43})/.exec(mail.text);
  if (match?.[1] === undefined) {
    throw new Error('no token in email');
  }
  return match[1];
}

// ---------------------------------------------------------------------------
// Fixtures (as ogs_maint)
// ---------------------------------------------------------------------------

const hasher = new PasswordHasher();

export const uniqueEmail = (label = 'user') => `${label}-${randomUUID().slice(0, 8)}@example.test`;

export interface FixtureUser {
  readonly id: string;
  readonly email: string;
  readonly password: string;
}

/** An ACTIVE (verified) user with a password, created directly in the database. */
export async function createLoginUser(
  maint: pg.Client,
  options: { status?: string; password?: string; passwordHash?: string } = {},
): Promise<FixtureUser> {
  const id = randomUUID();
  const email = uniqueEmail();
  const password = options.password ?? `pass phrase ${randomUUID()}`;
  await maint.query('INSERT INTO app_user (id, email, status) VALUES ($1, $2, $3)', [
    id,
    email,
    options.status ?? 'ACTIVE',
  ]);
  await maint.query('INSERT INTO credential (user_id, password_hash) VALUES ($1, $2)', [
    id,
    options.passwordHash ?? (await hasher.hash(password)),
  ]);
  return { id, email, password };
}

/** Grants a system role (by code) to a membership. */
export async function grantRole(
  maint: pg.Client,
  membershipId: string,
  tenantId: string,
  roleCode: string,
): Promise<void> {
  const result = await maint.query(
    `INSERT INTO membership_role (membership_id, role_id, tenant_id)
     SELECT $1, r.id, $2 FROM role r WHERE r.tenant_id IS NULL AND r.code = $3`,
    [membershipId, tenantId, roleCode],
  );
  if (result.rowCount !== 1) {
    throw new Error(`role ${roleCode} not found (has the catalogue been synced?)`);
  }
}
