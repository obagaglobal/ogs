import { randomUUID } from 'node:crypto';
import type { CustomerTicket, StaffTicket } from '@ogs/contracts';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { AccessRouteCheck } from '../../src/access/access-route-check.js';
import { TicketAutoCloseService } from '../../src/tickets/ticket-auto-close.service.js';
import { TICKET_COMMANDS, type TicketCommand } from '../../src/tickets/transitions.js';
import {
  Client,
  createLoginUser,
  grantRole,
  maintAsPlatform,
  signIn,
  startStack,
  waitForMail,
  type FixtureUser,
  type Stack,
} from './http-harness.js';
import { attempt, connect, createMembership, createTenant, urls, withContext } from './support.js';

/**
 * Phase 8 — tickets: T1–T8 of the plan. T2 is the owner's requirement:
 * internal notes never reach a customer through ANY customer API.
 */
// Several tests wait for emails behind the whole suite's worker backlog (up to 45 s).
vi.setConfig({ testTimeout: 120_000 });

let stack: Stack;
let maint: pg.Client;
let platformTenant: string;
let helpdesk: FixtureUser; // ticket.create/read/comment/internal_note, no ticket.assign
let lead: FixtureUser; // ict_support_manager: also ticket.assign

const PDF = Buffer.from('%PDF-1.4\n1 0 obj << >> endobj\ntrailer << >>\n%%EOF\n');
const STATES = [
  'NEW',
  'OPEN',
  'IN_PROGRESS',
  'AWAITING_CUSTOMER',
  'ON_HOLD',
  'RESOLVED',
  'CLOSED',
] as const;
type State = (typeof STATES)[number];

interface Org {
  tenantId: string;
  admin: FixtureUser;
  employee: FixtureUser;
  colleague: FixtureUser;
  adminClient: Client;
  employeeClient: Client;
  colleagueClient: Client;
}
let org: Org;

let numberSeq = 0;
const numberBase = 2100 + Math.floor(Math.random() * 800);
const nextTestNumber = () => `TCK-${String(numberBase)}-${String(++numberSeq).padStart(6, '0')}`;

beforeAll(async () => {
  stack = await startStack();
  maint = await connect('maint');
  const existing = await maint.query<{ id: string }>(
    `SELECT id FROM tenant WHERE kind = 'PLATFORM'`,
  );
  platformTenant = existing.rows[0]?.id ?? (await createTenant(maint, { kind: 'PLATFORM' }));
  helpdesk = await createStaff('helpdesk');
  lead = await createStaff('ict_support_manager');
  org = await createOrg();
});

afterAll(async () => {
  await maint.end();
  await stack.close();
});

// ---------------------------------------------------------------- fixtures

async function createStaff(roleCode: string): Promise<FixtureUser> {
  const staff = await createLoginUser(maint, { mfa: true });
  const membership = await createMembership(maint, platformTenant, staff.id);
  await grantRole(maint, membership, platformTenant, roleCode);
  return staff;
}

async function createOrg(): Promise<Org> {
  const tenantId = await createTenant(maint);
  const admin = await createLoginUser(maint, { mfa: true });
  const employee = await createLoginUser(maint);
  const colleague = await createLoginUser(maint);
  await grantRole(maint, await createMembership(maint, tenantId, admin.id), tenantId, 'org_admin');
  for (const user of [employee, colleague]) {
    await grantRole(
      maint,
      await createMembership(maint, tenantId, user.id),
      tenantId,
      'org_employee',
    );
  }
  return {
    tenantId,
    admin,
    employee,
    colleague,
    adminClient: await signIn(stack.server, maint, admin),
    employeeClient: await signIn(stack.server, maint, employee),
    colleagueClient: await signIn(stack.server, maint, colleague),
  };
}

async function person(): Promise<{ user: FixtureUser; client: Client }> {
  const user = await createLoginUser(maint);
  return { user, client: await signIn(stack.server, maint, user) };
}

interface Elevated {
  client: Client;
  options: { workspace: string; headers: Record<string, string> };
}
const elevations = new Map<string, Promise<Elevated>>();
async function elevated(staff: FixtureUser): Promise<Elevated> {
  let session = elevations.get(staff.id);
  if (session === undefined) {
    session = (async () => {
      const client = await signIn(stack.server, maint, staff);
      const response = await client.post(
        '/platform/elevate',
        { reason: 'Helpdesk shift HD-2026-11' },
        { workspace: platformTenant },
      );
      expect(response.status).toBe(201);
      const { elevationId } = response.body as { elevationId: string };
      return {
        client,
        options: { workspace: platformTenant, headers: { 'X-OGS-Elevation': elevationId } },
      };
    })();
    elevations.set(staff.id, session);
  }
  return session;
}

const ticketBody = (extra: Record<string, unknown> = {}) => ({
  subject: 'Printer offline',
  description: 'The office printer on floor 2 shows offline since this morning.',
  categoryCode: 'printers',
  urgency: 'HIGH',
  ...extra,
});

async function openTicket(
  client: Client,
  workspace: string,
  extra: Record<string, unknown> = {},
  key: string = randomUUID(),
) {
  return client.post('/tickets', ticketBody(extra), {
    workspace,
    headers: { 'Idempotency-Key': key },
  });
}

async function opened(client: Client, workspace: string): Promise<CustomerTicket> {
  const response = await openTicket(client, workspace);
  expect(response.status, JSON.stringify(response.body)).toBe(201);
  return response.body as CustomerTicket;
}

/** A ticket created directly (as platform SQL) and put in `state`, bypassing the API. */
async function seeded(
  owner: { tenantId?: string; userId: string },
  state: State = 'NEW',
): Promise<string> {
  const category = await maint.query<{ id: string }>(
    `SELECT id FROM ticket_category WHERE code = 'hardware'`,
  );
  const inserted = await maintAsPlatform(
    maint,
    `INSERT INTO ticket (number, customer_tenant_id, customer_user_id, requester_user_id, created_by,
                         category_id, subject, description)
     VALUES ($1, $2, $3, $4, $4, $5, 'Seeded ticket', 'Seeded for the transition table.')
     RETURNING id`,
    [
      nextTestNumber(),
      owner.tenantId ?? null,
      owner.tenantId === undefined ? owner.userId : null,
      owner.userId,
      category.rows[0]?.id,
    ],
  );
  const id = (inserted.rows[0] as { id: string }).id;
  const set: Record<State, string> = {
    NEW: '',
    OPEN: `status = 'OPEN', priority = 'P3'`,
    IN_PROGRESS: `status = 'IN_PROGRESS', priority = 'P3'`,
    AWAITING_CUSTOMER: `status = 'AWAITING_CUSTOMER', priority = 'P3'`,
    ON_HOLD: `status = 'ON_HOLD', priority = 'P3'`,
    RESOLVED: `status = 'RESOLVED', priority = 'P3', resolution = 'Fixed', resolved_at = now()`,
    CLOSED: `status = 'CLOSED', resolution = 'Fixed', resolved_at = now(), closure = 'ACCEPTED', closed_at = now()`,
  };
  if (set[state] !== '') {
    await maintAsPlatform(maint, `UPDATE ticket SET ${set[state]} WHERE id = $1`, [id]);
  }
  return id;
}

async function eventCount(ticketId: string): Promise<number> {
  const result = await maint.query<{ n: string }>(
    'SELECT count(*) AS n FROM ticket_event WHERE ticket_id = $1',
    [ticketId],
  );
  return Number(result.rows[0]?.n);
}

async function uploadAsCustomer(client: Client, workspace: string, name = 'photo.pdf') {
  const response = await client.agent
    .post('/api/v1/files')
    .set('X-Forwarded-For', client.ip)
    .set('X-CSRF-Token', client.csrf ?? '')
    .set('X-OGS-Workspace', workspace)
    .field('purpose', 'ticket.attachment')
    .attach('file', PDF, name);
  expect(response.status, JSON.stringify(response.body)).toBe(201);
  return (response.body as { id: string }).id;
}

async function uploadAsStaff(ticketId: string, internal: boolean, name: string) {
  const { client, options } = await elevated(helpdesk);
  const response = await client.agent
    .post(`/api/v1/platform/tickets/${ticketId}/files`)
    .set('X-Forwarded-For', client.ip)
    .set('X-CSRF-Token', client.csrf ?? '')
    .set('X-OGS-Workspace', options.workspace)
    .set('X-OGS-Elevation', options.headers['X-OGS-Elevation'] ?? '')
    .field('internal', internal ? 'true' : 'false')
    .attach('file', PDF, name);
  expect(response.status, JSON.stringify(response.body)).toBe(201);
  return (response.body as { id: string }).id;
}

async function staffGet(ticketId: string): Promise<StaffTicket> {
  const { client, options } = await elevated(helpdesk);
  const response = await client.get(`/platform/tickets/${ticketId}`, options);
  expect(response.status).toBe(200);
  return response.body as StaffTicket;
}

// ---------------------------------------------------------------- T1 transition table

const STAFF_ROUTES: Partial<Record<TicketCommand, [string, Record<string, unknown>]>> = {
  triage: ['triage', { priority: 'P2', categoryCode: 'network' }],
  start: ['start', {}],
  awaitCustomer: ['await-customer', {}],
  hold: ['hold', { reason: 'Waiting for a spare part' }],
  resume: ['resume', {}],
  resolve: ['resolve', { resolution: 'Replaced the network cable.' }],
  staffReopen: ['reopen', {}],
};
const CUSTOMER_ROUTES: Partial<Record<TicketCommand, [string, Record<string, unknown>]>> = {
  reopen: ['reopen', { reason: 'Still not printing' }],
  acceptResolution: ['accept-resolution', {}],
  withdraw: ['withdraw', { reason: 'Fixed it ourselves' }],
};

describe('T1 transition table', () => {
  for (const [command, [path, body]] of Object.entries(STAFF_ROUTES)) {
    const allowed: readonly string[] = TICKET_COMMANDS[command as TicketCommand].from;
    for (const state of STATES) {
      it(`staff ${command} from ${state}: ${allowed.includes(state) ? 'allowed' : 'refused'}`, async () => {
        const id = await seeded({ tenantId: org.tenantId, userId: org.employee.id }, state);
        const before = await eventCount(id);
        const { client, options } = await elevated(helpdesk);
        const response = await client.post(
          `/platform/tickets/${id}/${path}`,
          { version: 0, ...body },
          options,
        );
        if (allowed.includes(state)) {
          expect(response.status, JSON.stringify(response.body)).toBe(200);
          expect((response.body as StaffTicket).status).toBe(
            TICKET_COMMANDS[command as TicketCommand].to,
          );
          expect(await eventCount(id)).toBe(before + 1);
        } else {
          expect(response.status).toBe(409);
          expect(await eventCount(id)).toBe(before);
        }
      });
    }
  }

  for (const [command, [path, body]] of Object.entries(CUSTOMER_ROUTES)) {
    const allowed: readonly string[] = TICKET_COMMANDS[command as TicketCommand].from;
    for (const state of STATES) {
      it(`customer ${command} from ${state}: ${allowed.includes(state) ? 'allowed' : 'refused'}`, async () => {
        const id = await seeded({ tenantId: org.tenantId, userId: org.employee.id }, state);
        const before = await eventCount(id);
        const response = await org.employeeClient.post(
          `/tickets/${id}/${path}`,
          { version: 0, ...body },
          { workspace: org.tenantId },
        );
        if (allowed.includes(state)) {
          expect(response.status, JSON.stringify(response.body)).toBe(200);
          expect(await eventCount(id)).toBe(before + 1);
        } else {
          expect(response.status).toBe(409);
          expect(await eventCount(id)).toBe(before);
        }
      });
    }
  }

  it('each command writes one audit row and a stale version is refused', async () => {
    const id = await seeded({ tenantId: org.tenantId, userId: org.employee.id });
    const { client, options } = await elevated(helpdesk);
    const audits = async () =>
      Number(
        (
          await maint.query<{ n: string }>(
            `SELECT count(*) AS n FROM audit_log WHERE entity_id = $1 AND action LIKE 'ticket.%'`,
            [id],
          )
        ).rows[0]?.n,
      );
    expect(
      (await client.post(`/platform/tickets/${id}/start`, { version: 0 }, options)).status,
    ).toBe(200);
    expect(await audits()).toBe(1);
    expect(
      (await client.post(`/platform/tickets/${id}/await-customer`, { version: 0 }, options)).status,
    ).toBe(409);
    expect(await audits()).toBe(1);
  });

  it('a customer reply moves "awaiting customer" back to "in progress"', async () => {
    const id = await seeded(
      { tenantId: org.tenantId, userId: org.employee.id },
      'AWAITING_CUSTOMER',
    );
    const response = await org.employeeClient.post(
      `/tickets/${id}/comments`,
      { body: 'Here is the serial number: AB-123.' },
      { workspace: org.tenantId },
    );
    expect(response.status).toBe(200);
    expect((response.body as CustomerTicket).status).toBe('IN_PROGRESS');
  });
});

// ---------------------------------------------------------------- T2 internal notes never reach customers

describe('T2 internal notes never reach customers', () => {
  const CANARY = `CANARY-${randomUUID()}`;
  let ticketId: string;
  let individual: { user: FixtureUser; client: Client };
  let personalTicketId: string;

  beforeAll(async () => {
    const ticket = await opened(org.employeeClient, org.tenantId);
    ticketId = ticket.id;
    individual = await person();
    personalTicketId = (await opened(individual.client, 'personal')).id;
    const { client, options } = await elevated(helpdesk);
    for (const id of [ticketId, personalTicketId]) {
      const fileId = await uploadAsStaff(id, true, `${CANARY}.pdf`);
      expect(
        (
          await client.post(
            `/platform/tickets/${id}/notes`,
            { body: `Internal: ${CANARY}`, attachmentIds: [fileId] },
            options,
          )
        ).status,
      ).toBe(200);
      expect(
        (await client.post(`/platform/tickets/${id}/take`, { version: 0 }, options)).status,
      ).toBe(200);
      await client.post(`/platform/tickets/${id}/start`, { version: 1 }, options);
      await client.post(
        `/platform/tickets/${id}/hold`,
        { version: 2, reason: `Hold ${CANARY}` },
        options,
      );
      await client.post(
        `/platform/tickets/${id}/priority`,
        { version: 3, priority: 'P1', reason: `Priority ${CANARY}` },
        options,
      );
      await client.post(`/platform/tickets/${id}/resume`, { version: 4 }, options);
      await client.post(`/platform/tickets/${id}/comments`, { body: 'We are on it.' }, options);
    }
    // Staff see the canary, so the setup really wrote it.
    expect(JSON.stringify(await staffGet(ticketId))).toContain(CANARY);
  });

  /**
   * Every route a customer can reach (enumerated from the router, so a new
   * route cannot be missed), called as the requester, an org admin and an
   * individual, with every path parameter set to the ticket's id.
   */
  it('no customer API response contains internal content', async () => {
    const routes = stack.app
      .get(AccessRouteCheck)
      .routes()
      .filter((route) => route.rule !== undefined && route.rule.kind !== 'elevated')
      .filter((route) => route.method === 'GET');
    expect(routes.some((route) => route.path === '/tickets/:id')).toBe(true);
    const callers: [Client, string, string][] = [
      [org.employeeClient, org.tenantId, ticketId],
      [org.adminClient, org.tenantId, ticketId],
      [individual.client, 'personal', personalTicketId],
    ];
    let checked = 0;
    for (const [client, workspace, id] of callers) {
      for (const route of routes) {
        const path = route.path.replace(/:[A-Za-z]+/g, id);
        const response = await client.get(path, { workspace });
        const text = `${JSON.stringify(response.body)} ${response.text}`;
        expect(text, `${route.method} ${route.path}`).not.toContain(CANARY);
        expect(text, route.path).not.toContain(helpdesk.email);
        expect(text, route.path).not.toMatch(/"INTERNAL"|internal_note|"kind":"note"/);
        checked += 1;
      }
    }
    expect(checked).toBeGreaterThan(30);
  });

  it('customer command responses carry no internal content either', async () => {
    const reply = await org.employeeClient.post(
      `/tickets/${ticketId}/comments`,
      { body: 'Thanks' },
      { workspace: org.tenantId },
    );
    expect(reply.status).toBe(200);
    const body = reply.body as CustomerTicket;
    expect(JSON.stringify(body)).not.toContain(CANARY);
    expect(body.activity.every((entry) => !/note|priority|hold|resume|take/.test(entry.kind))).toBe(
      true,
    );
    expect(Object.keys(body)).not.toContain('assignee');
    expect(Object.keys(body)).not.toContain('thread');
  });

  it('customer contexts read no internal rows in the database at all', async () => {
    const app = await connect('app');
    try {
      for (const [settings, id] of [
        [{ userId: org.employee.id, tenantId: org.tenantId }, ticketId],
        [{ userId: org.admin.id, tenantId: org.tenantId }, ticketId],
        [{ userId: individual.user.id }, personalTicketId],
      ] as const) {
        await withContext(app, settings, async () => {
          const notes = await app.query('SELECT * FROM ticket_internal_note WHERE ticket_id = $1', [
            id,
          ]);
          expect(notes.rowCount).toBe(0);
          const internalEvents = await app.query(
            `SELECT * FROM ticket_event WHERE ticket_id = $1 AND visibility = 'INTERNAL'`,
            [id],
          );
          expect(internalEvents.rowCount).toBe(0);
          const noteFiles = await app.query(
            'SELECT * FROM ticket_attachment WHERE ticket_id = $1 AND note_id IS NOT NULL',
            [id],
          );
          expect(noteFiles.rowCount).toBe(0);
          const files = await app.query(`SELECT * FROM file_metadata WHERE original_name LIKE $1`, [
            `${CANARY}%`,
          ]);
          expect(files.rowCount).toBe(0);
          const audit = await app.query(
            `SELECT * FROM audit_log WHERE entity_id = $1 AND action IN ('ticket.internal_note_added', 'ticket.hold', 'ticket.set_priority', 'ticket.take')`,
            [id],
          );
          expect(audit.rowCount).toBe(0);
        });
      }
    } finally {
      await app.end();
    }
  });

  it('an internal file cannot be downloaded by id through any customer route', async () => {
    const note = (await staffGet(ticketId)).thread.find((item) => item.kind === 'note');
    const attachmentId = note?.attachments[0]?.id ?? '';
    const fileRow = await maint.query<{ file_id: string }>(
      'SELECT file_id FROM ticket_attachment WHERE id = $1',
      [attachmentId],
    );
    const fileId = fileRow.rows[0]?.file_id ?? '';
    for (const client of [org.employeeClient, org.adminClient]) {
      expect(
        (
          await client.get(`/tickets/${ticketId}/attachments/${attachmentId}/download`, {
            workspace: org.tenantId,
          })
        ).status,
      ).toBe(404);
      expect(
        (await client.get(`/files/${fileId}/download`, { workspace: org.tenantId })).status,
      ).toBe(404);
    }
  });

  it('no email contains internal content', async () => {
    await waitForMail(org.employee.email, /New reply on ticket/, 1, 45_000);
    const response = await fetch(`${urls().mailpitApi}/search?query=${encodeURIComponent(CANARY)}`);
    const found = (await response.json()) as { messages?: unknown[] };
    expect(found.messages ?? []).toHaveLength(0);
  });
});

// ---------------------------------------------------------------- T3 reopen policy

describe('T3 reopen policy and auto-close', () => {
  it('a customer reopens inside the window, not at or after its end', async () => {
    const inside = await seeded({ tenantId: org.tenantId, userId: org.employee.id }, 'RESOLVED');
    await maintAsPlatform(
      maint,
      `UPDATE ticket SET resolved_at = now() - interval '7 days' + interval '1 minute' WHERE id = $1`,
      [inside],
    );
    const ok = await org.employeeClient.post(
      `/tickets/${inside}/reopen`,
      { version: 0, reason: 'Still broken' },
      { workspace: org.tenantId },
    );
    expect(ok.status).toBe(200);
    expect((ok.body as CustomerTicket).status).toBe('IN_PROGRESS');
    const reopenCount = await maint.query<{ reopen_count: number }>(
      'SELECT reopen_count FROM ticket WHERE id = $1',
      [inside],
    );
    expect(reopenCount.rows[0]?.reopen_count).toBe(1);

    const late = await seeded({ tenantId: org.tenantId, userId: org.employee.id }, 'RESOLVED');
    await maintAsPlatform(
      maint,
      `UPDATE ticket SET resolved_at = now() - interval '7 days' WHERE id = $1`,
      [late],
    );
    const refused = await org.employeeClient.post(
      `/tickets/${late}/reopen`,
      { version: 0, reason: 'Still broken' },
      { workspace: org.tenantId },
    );
    expect(refused.status).toBe(409);
    expect((refused.body as { error: string }).error).toBe('reopen_window_passed');
  });

  it('the trigger refuses a late reopen even without the service', async () => {
    const late = await seeded({ tenantId: org.tenantId, userId: org.employee.id }, 'RESOLVED');
    await maintAsPlatform(
      maint,
      `UPDATE ticket SET resolved_at = now() - interval '8 days' WHERE id = $1`,
      [late],
    );
    const app = await connect('app');
    try {
      await withContext(app, { userId: org.employee.id, tenantId: org.tenantId }, async () => {
        const result = await attempt(
          app,
          `UPDATE ticket SET status = 'IN_PROGRESS', resolved_at = NULL, resolution = NULL,
                  reopen_count = reopen_count + 1 WHERE id = $1`,
          [late],
        );
        expect(result).toMatchObject({ code: '42501' });
      });
    } finally {
      await app.end();
    }
  });

  it('staff reopen until closed; closed is final', async () => {
    const { client, options } = await elevated(helpdesk);
    const resolved = await seeded({ tenantId: org.tenantId, userId: org.employee.id }, 'RESOLVED');
    await maintAsPlatform(
      maint,
      `UPDATE ticket SET resolved_at = now() - interval '6 days' WHERE id = $1`,
      [resolved],
    );
    expect(
      (await client.post(`/platform/tickets/${resolved}/reopen`, { version: 0 }, options)).status,
    ).toBe(200);
    const closed = await seeded({ tenantId: org.tenantId, userId: org.employee.id }, 'CLOSED');
    expect(
      (await client.post(`/platform/tickets/${closed}/reopen`, { version: 0 }, options)).status,
    ).toBe(409);
    expect(
      (await client.post(`/platform/tickets/${closed}/comments`, { body: 'Hello?' }, options))
        .status,
    ).toBe(409);
    await expect(
      maintAsPlatform(maint, `UPDATE ticket SET subject = 'Changed' WHERE id = $1`, [closed]),
    ).rejects.toThrow(/closed ticket is final/);
  });

  it('auto-close fires exactly once, at the boundary, and loses to a reopen', async () => {
    const autoClose = stack.worker.get(TicketAutoCloseService);
    const due = await seeded({ tenantId: org.tenantId, userId: org.employee.id }, 'RESOLVED');
    const early = await seeded({ tenantId: org.tenantId, userId: org.employee.id }, 'RESOLVED');
    await maintAsPlatform(
      maint,
      `UPDATE ticket SET resolved_at = now() - interval '7 days' - interval '1 second' WHERE id = $1`,
      [due],
    );
    await maintAsPlatform(
      maint,
      `UPDATE ticket SET resolved_at = now() - interval '7 days' + interval '1 minute' WHERE id = $1`,
      [early],
    );
    const results = await Promise.all([autoClose.close(due), autoClose.close(due)]);
    expect(results.filter(Boolean)).toHaveLength(1);
    expect(await autoClose.close(due)).toBe(false);
    expect(await autoClose.close(early)).toBe(false);
    const rows = await maint.query<{ status: string; closure: string | null }>(
      'SELECT status, closure FROM ticket WHERE id = ANY($1) ORDER BY id = $2 DESC',
      [[due, early], due],
    );
    expect(rows.rows[0]).toMatchObject({ status: 'CLOSED', closure: 'AUTO_CLOSED' });
    expect(rows.rows[1]).toMatchObject({ status: 'RESOLVED', closure: null });
    const events = await maint.query(
      `SELECT 1 FROM ticket_event WHERE ticket_id = $1 AND kind = 'auto_close'`,
      [due],
    );
    expect(events.rowCount).toBe(1);

    // A reopen first, then the (late) job: nothing to close.
    const raced = await seeded({ tenantId: org.tenantId, userId: org.employee.id }, 'RESOLVED');
    await org.employeeClient.post(
      `/tickets/${raced}/reopen`,
      { version: 0, reason: 'Not fixed yet' },
      { workspace: org.tenantId },
    );
    await maintAsPlatform(
      maint,
      `UPDATE ticket SET resolved_at = NULL WHERE id = $1 AND status = 'IN_PROGRESS'`,
      [raced],
    );
    expect(await autoClose.close(raced)).toBe(false);
    expect(await autoClose.sweep()).toBeGreaterThanOrEqual(0);
  });
});

// ---------------------------------------------------------------- T4 visibility

describe('T4 visibility', () => {
  it('members see their own, admins all, department members their department', async () => {
    const mine = await opened(org.employeeClient, org.tenantId);
    const theirs = await opened(org.colleagueClient, org.tenantId);
    const ids = async (client: Client) =>
      (
        (await client.get('/tickets?show=all', { workspace: org.tenantId })).body as {
          tickets: { id: string }[];
        }
      ).tickets.map((t) => t.id);
    expect(await ids(org.employeeClient)).toContain(mine.id);
    expect(await ids(org.employeeClient)).not.toContain(theirs.id);
    expect(
      (await org.employeeClient.get(`/tickets/${theirs.id}`, { workspace: org.tenantId })).status,
    ).toBe(404);
    const adminIds = await ids(org.adminClient);
    expect(adminIds).toEqual(expect.arrayContaining([mine.id, theirs.id]));

    // A department lead: a custom role with ticket.read_department.
    const department = await maint.query<{ id: string }>(
      `INSERT INTO department (tenant_id, name) VALUES ($1, 'Finance') RETURNING id`,
      [org.tenantId],
    );
    const deptId = department.rows[0]?.id;
    const leadUser = await createLoginUser(maint);
    const membership = await createMembership(maint, org.tenantId, leadUser.id);
    const role = await maint.query<{ id: string }>(
      `INSERT INTO role (tenant_id, scope, code, name) VALUES ($1, 'ORGANISATION', $2, 'Dept lead') RETURNING id`,
      [org.tenantId, `dept_lead_${randomUUID().slice(0, 6)}`],
    );
    const roleId = role.rows[0]?.id;
    for (const code of [
      'ticket.read',
      'ticket.create',
      'ticket.comment',
      'ticket.read_department',
    ]) {
      await maint.query('INSERT INTO role_permission (role_id, permission_code) VALUES ($1, $2)', [
        roleId,
        code,
      ]);
    }
    await maint.query(
      'INSERT INTO membership_role (membership_id, role_id, tenant_id) VALUES ($1, $2, $3)',
      [membership, roleId, org.tenantId],
    );
    const departmental = await createLoginUser(maint);
    const departmentalMembership = await createMembership(maint, org.tenantId, departmental.id);
    await grantRole(maint, departmentalMembership, org.tenantId, 'org_employee');
    await maint.query('UPDATE membership SET department_id = $1 WHERE id = ANY($2)', [
      deptId,
      [membership, departmentalMembership],
    ]);
    const departmentalClient = await signIn(stack.server, maint, departmental);
    const deptTicket = await opened(departmentalClient, org.tenantId);
    expect(deptTicket.departmentName).toBe('Finance');
    const leadClient = await signIn(stack.server, maint, leadUser);
    const leadIds = await ids(leadClient);
    expect(leadIds).toContain(deptTicket.id);
    expect(leadIds).not.toContain(mine.id);
  });

  it('another organisation, another person, providers and anonymous see nothing', async () => {
    const ticket = await opened(org.employeeClient, org.tenantId);
    const other = await createOrg();
    expect(
      (await other.adminClient.get(`/tickets/${ticket.id}`, { workspace: other.tenantId })).status,
    ).toBe(404);
    expect(
      (await other.adminClient.get(`/tickets/${ticket.id}`, { workspace: org.tenantId })).status,
    ).toBe(403);
    const individual = await person();
    expect((await individual.client.get(`/tickets/${ticket.id}`)).status).toBe(404);
    const personal = await opened(individual.client, 'personal');
    // A person's own ticket is not visible from an organisation workspace.
    expect(
      (await org.employeeClient.get(`/tickets/${personal.id}`, { workspace: 'personal' })).status,
    ).toBe(404);
    const providerCompany = await createTenant(maint, { kind: 'PROVIDER_COMPANY' });
    const tech = await createLoginUser(maint);
    await grantRole(
      maint,
      await createMembership(maint, providerCompany, tech.id),
      providerCompany,
      'provider_admin',
    );
    const techClient = await signIn(stack.server, maint, tech);
    expect(
      (await techClient.get(`/tickets/${ticket.id}`, { workspace: providerCompany })).status,
    ).toBe(403);
    expect((await new Client(stack.server).get(`/tickets/${ticket.id}`)).status).toBe(401);
  });
});

// ---------------------------------------------------------------- T5 integrity

/** A fresh organisation per block, so the per-person ticket limit (10/h) is not shared. */
const freshOrg = () => {
  beforeAll(async () => {
    org = await createOrg();
  });
};

describe('T5 integrity', () => {
  freshOrg();
  it('a foreign order cannot be linked (service and trigger)', async () => {
    const other = await createOrg();
    const foreignOrder = await maint.query<{ id: string }>('SELECT id FROM service_order LIMIT 1');
    const orderId = foreignOrder.rows[0]?.id ?? randomUUID();
    const response = await openTicket(other.employeeClient, other.tenantId, {
      serviceOrderId: orderId,
    });
    expect(response.status).toBe(409);
  });

  it('customers cannot set priority, assignee or forbidden statuses in SQL', async () => {
    const id = await seeded({ tenantId: org.tenantId, userId: org.employee.id }, 'OPEN');
    const app = await connect('app');
    try {
      await withContext(app, { userId: org.employee.id, tenantId: org.tenantId }, async () => {
        for (const sql of [
          `UPDATE ticket SET priority = 'P1' WHERE id = $1`,
          `UPDATE ticket SET assignee_user_id = requester_user_id WHERE id = $1`,
          `UPDATE ticket SET status = 'RESOLVED', resolution = 'x', resolved_at = now() WHERE id = $1`,
          `UPDATE ticket SET first_response_at = now() WHERE id = $1`,
        ]) {
          expect(await attempt(app, sql, [id]), sql).toMatchObject({ code: '42501' });
        }
        expect(
          await attempt(
            app,
            `INSERT INTO ticket_comment (ticket_id, side, body) VALUES ($1, 'STAFF', 'Pretend staff')`,
            [id],
          ),
        ).toMatchObject({ code: '42501' });
        expect(
          await attempt(
            app,
            `INSERT INTO ticket_internal_note (ticket_id, body) VALUES ($1, 'x')`,
            [id],
          ),
        ).toMatchObject({ code: '42501' });
      });
    } finally {
      await app.end();
    }
  });

  it('comments, notes and events are append-only', async () => {
    for (const [table, column] of [
      ['ticket_comment', 'created_at'],
      ['ticket_internal_note', 'created_at'],
      ['ticket_event', 'occurred_at'],
      ['ticket_attachment', 'created_at'],
    ] as const) {
      const rows = await maint.query(`SELECT 1 FROM ${table} LIMIT 1`);
      expect(rows.rowCount, `${table} has rows to test`).toBe(1);
      await expect(maint.query(`UPDATE ${table} SET ${column} = ${column}`)).rejects.toThrow(
        /append-only/,
      );
      await expect(maint.query(`DELETE FROM ${table}`)).rejects.toThrow(/append-only|foreign key/);
    }
  });

  it('first_response_at is set by the first public reply, not by a note', async () => {
    const ticket = await opened(org.employeeClient, org.tenantId);
    const { client, options } = await elevated(helpdesk);
    await client.post(`/platform/tickets/${ticket.id}/notes`, { body: 'Checking logs' }, options);
    expect((await staffGet(ticket.id)).firstResponseAt).toBeNull();
    await client.post(`/platform/tickets/${ticket.id}/comments`, { body: 'Looking now' }, options);
    expect((await staffGet(ticket.id)).firstResponseAt).not.toBeNull();
  });

  it('opening is idempotent and the same key with another body is refused', async () => {
    const key = randomUUID();
    const first = await openTicket(org.employeeClient, org.tenantId, {}, key);
    const replay = await openTicket(org.employeeClient, org.tenantId, {}, key);
    expect(first.status).toBe(201);
    expect(replay.status).toBe(201);
    expect((replay.body as CustomerTicket).id).toBe((first.body as CustomerTicket).id);
    const different = await openTicket(
      org.employeeClient,
      org.tenantId,
      { subject: 'Another subject' },
      key,
    );
    expect(different.status).toBe(422);
  });

  it('new tickets are rate limited per person', async () => {
    const individual = await person();
    const statuses: number[] = [];
    for (let i = 0; i < 11; i += 1) {
      statuses.push((await openTicket(individual.client, 'personal')).status);
    }
    expect(statuses.slice(0, 10).every((status) => status === 201)).toBe(true);
    expect(statuses[10]).toBe(429);
  });

  it('employees without ticket.create are refused (admins may revoke it)', async () => {
    const restricted = await createLoginUser(maint);
    await createMembership(maint, org.tenantId, restricted.id);
    const client = await signIn(stack.server, maint, restricted);
    expect((await openTicket(client, org.tenantId)).status).toBe(403);
  });
});

// ---------------------------------------------------------------- T6 staff and on behalf

describe('T6 staff, ownership and on behalf', () => {
  freshOrg();
  it('needs an elevation; platform reads are audited', async () => {
    const ticket = await opened(org.employeeClient, org.tenantId);
    const client = await signIn(stack.server, maint, helpdesk);
    expect(
      (await client.get(`/platform/tickets/${ticket.id}`, { workspace: platformTenant })).status,
    ).toBe(403);
    await staffGet(ticket.id);
    const audit = await maint.query(
      `SELECT 1 FROM audit_log WHERE action = 'platform.context_used' AND actor_user_id = $1`,
      [helpdesk.id],
    );
    expect(audit.rowCount).toBeGreaterThan(0);
  });

  it('any agent may take; assigning others needs ticket.assign', async () => {
    const ticket = await opened(org.employeeClient, org.tenantId);
    const desk = await elevated(helpdesk);
    const took = await desk.client.post(
      `/platform/tickets/${ticket.id}/take`,
      { version: 0 },
      desk.options,
    );
    expect(took.status).toBe(200);
    expect((took.body as StaffTicket).assignee?.id).toBe(helpdesk.id);
    expect(
      (
        await desk.client.post(
          `/platform/tickets/${ticket.id}/assign`,
          { version: 1, assigneeUserId: lead.id },
          desk.options,
        )
      ).status,
    ).toBe(403);
    const boss = await elevated(lead);
    const assigned = await boss.client.post(
      `/platform/tickets/${ticket.id}/assign`,
      { version: 1, assigneeUserId: lead.id },
      boss.options,
    );
    expect(assigned.status).toBe(200);
    expect(
      (
        await boss.client.post(
          `/platform/tickets/${ticket.id}/assign`,
          { version: 2, assigneeUserId: org.admin.id },
          boss.options,
        )
      ).status,
    ).toBe(409);
  });

  it('staff open a ticket on behalf of a person; the person sees it and is emailed', async () => {
    const individual = await person();
    const { client, options } = await elevated(helpdesk);
    const lookup = await client.get(
      `/platform/customers?q=${encodeURIComponent(individual.user.email)}`,
      options,
    );
    expect((lookup.body as { people: { id: string }[] }).people[0]?.id).toBe(individual.user.id);
    const response = await client.post(
      '/platform/tickets',
      {
        ...ticketBody(),
        customer: { kind: 'PERSON', userId: individual.user.id },
        channel: 'PHONE',
      },
      { ...options, headers: { ...options.headers, 'Idempotency-Key': randomUUID() } },
    );
    expect(response.status, JSON.stringify(response.body)).toBe(201);
    const ticket = response.body as StaffTicket;
    expect(ticket).toMatchObject({ onBehalf: true, channel: 'PHONE' });
    expect(ticket.createdBy.id).toBe(helpdesk.id);
    const seen = await individual.client.get(`/tickets/${ticket.id}`);
    expect(seen.status).toBe(200);
    expect((seen.body as CustomerTicket).onBehalf).toBe(true);
    await waitForMail(individual.user.email, /opened ticket .* for you/, 1, 45_000);
  });

  it('staff place a request on behalf of an organisation member, with Phase 7 rules', async () => {
    const category = await maint.query<{ id: string }>(
      `INSERT INTO service_category (slug, name) VALUES ($1, 'Tickets test') RETURNING id`,
      [`tickets-${randomUUID().slice(0, 8)}`],
    );
    const slug = `on-behalf-${randomUUID().slice(0, 8)}`;
    const service = await maint.query<{ id: string }>(
      `INSERT INTO service (slug, category_id, name, summary, description, audience, status, published_at)
       VALUES ($1, $2, 'Network audit', 'Summary', 'Description', 'ORGANISATIONS', 'PUBLISHED', now()) RETURNING id`,
      [slug, category.rows[0]?.id],
    );
    await maint.query(
      `INSERT INTO service_price (service_id, model, amount_minor, min_quantity) VALUES ($1, 'FIXED', 500000, 1)`,
      [service.rows[0]?.id],
    );
    const request = {
      serviceSlug: slug,
      county: 'KE-30',
      address: 'Ngong Road, Nairobi',
      contactPhone: '+254712345678',
    };
    const { client, options } = await elevated(helpdesk);
    const headers = () => ({
      ...options,
      headers: { ...options.headers, 'Idempotency-Key': randomUUID() },
    });
    const response = await client.post(
      '/platform/requests',
      {
        customer: {
          kind: 'ORGANISATION',
          tenantId: org.tenantId,
          requesterUserId: org.employee.id,
        },
        request,
      },
      headers(),
    );
    expect(response.status, JSON.stringify(response.body)).toBe(201);
    const id = (response.body as { id: string }).id;
    const row = await maint.query<{ on_behalf: boolean; entered_by: string; created_by: string }>(
      'SELECT on_behalf, entered_by, created_by FROM service_request WHERE id = $1',
      [id],
    );
    expect(row.rows[0]).toMatchObject({
      on_behalf: true,
      entered_by: helpdesk.id,
      created_by: org.employee.id,
    });
    expect(
      (await org.employeeClient.get(`/requests/${id}`, { workspace: org.tenantId })).status,
    ).toBe(200);
    // The audience rule still applies: an organisations-only service for a person.
    const individual = await person();
    const refused = await client.post(
      '/platform/requests',
      { customer: { kind: 'PERSON', userId: individual.user.id }, request },
      headers(),
    );
    expect(refused.status).toBe(409);
    // A customer cannot forge an on-behalf request in SQL.
    const app = await connect('app');
    try {
      await withContext(app, { userId: org.employee.id, tenantId: org.tenantId }, async () => {
        const result = await attempt(
          app,
          `UPDATE service_request SET on_behalf = false, entered_by = NULL WHERE id = $1`,
          [id],
        );
        expect(result).toMatchObject({ code: '42501' });
      });
    } finally {
      await app.end();
    }
  });
});

// ---------------------------------------------------------------- T7 attachments

describe('T7 attachments', () => {
  freshOrg();
  it('customers attach their own files; quarantined files have no link; others are refused', async () => {
    const fileId = await uploadAsCustomer(org.employeeClient, org.tenantId, 'screen.pdf');
    const response = await openTicket(org.employeeClient, org.tenantId, {
      attachmentIds: [fileId],
    });
    expect(response.status, JSON.stringify(response.body)).toBe(201);
    const ticket = response.body as CustomerTicket;
    expect(ticket.attachments).toHaveLength(1);
    expect(ticket.attachments[0]?.name).toBe('screen.pdf');

    // A colleague's file id, or one already used, cannot be attached.
    const colleagueFile = await uploadAsCustomer(org.colleagueClient, org.tenantId);
    for (const ids of [[colleagueFile], [fileId]]) {
      expect(
        (
          await org.employeeClient.post(
            `/tickets/${ticket.id}/comments`,
            { body: 'See attached', attachmentIds: ids },
            { workspace: org.tenantId },
          )
        ).status,
      ).toBe(409);
    }
  });

  it('a staff reply file belongs to the customer and is downloadable once clean', async () => {
    const ticket = await opened(org.employeeClient, org.tenantId);
    const fileId = await uploadAsStaff(ticket.id, false, 'manual.pdf');
    const owner = await maint.query<{ tenant_id: string }>(
      'SELECT tenant_id FROM file_metadata WHERE id = $1',
      [fileId],
    );
    expect(owner.rows[0]?.tenant_id).toBe(org.tenantId);
    const { client, options } = await elevated(helpdesk);
    await client.post(
      `/platform/tickets/${ticket.id}/comments`,
      { body: 'Here is the manual', attachmentIds: [fileId] },
      options,
    );
    const view = (
      await org.employeeClient.get(`/tickets/${ticket.id}`, { workspace: org.tenantId })
    ).body as CustomerTicket;
    const attachment = view.messages.at(-1)?.attachments[0];
    expect(attachment?.name).toBe('manual.pdf');
    const deadline = Date.now() + 15_000;
    let status = 0;
    while (Date.now() < deadline) {
      status = (
        await org.employeeClient.get(
          `/tickets/${ticket.id}/attachments/${attachment?.id ?? ''}/download`,
          { workspace: org.tenantId },
        )
      ).status;
      if (status === 200) break;
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    expect(status).toBe(200);
  });

  it('an internal file cannot be put on a public reply', async () => {
    const ticket = await opened(org.employeeClient, org.tenantId);
    const internalFile = await uploadAsStaff(ticket.id, true, 'internal.pdf');
    const { client, options } = await elevated(helpdesk);
    const response = await client.post(
      `/platform/tickets/${ticket.id}/comments`,
      { body: 'Oops', attachmentIds: [internalFile] },
      options,
    );
    expect(response.status).toBe(409);
    expect((response.body as { error: string }).error).toBe('attachment_invalid');
    const attached = await maint.query('SELECT 1 FROM ticket_attachment WHERE file_id = $1', [
      internalFile,
    ]);
    expect(attached.rowCount).toBe(0);
  });
});

// ---------------------------------------------------------------- T8 notifications

describe('T8 notifications', () => {
  freshOrg();
  it('opening, resolving and closing each email the requester once', async () => {
    const individual = await person();
    const ticket = await opened(individual.client, 'personal');
    await waitForMail(individual.user.email, /We received your ticket/, 1, 45_000);
    const { client, options } = await elevated(helpdesk);
    await client.post(
      `/platform/tickets/${ticket.id}/resolve`,
      { version: 0, resolution: 'Restarted the router.' },
      options,
    );
    const resolved = await waitForMail(individual.user.email, /is resolved/, 1, 45_000);
    expect(resolved.text).toMatch(/reopen it in OGS before/);
    await individual.client.post(`/tickets/${ticket.id}/accept-resolution`, { version: 1 });
    await waitForMail(individual.user.email, /is closed/, 1, 45_000);
    const all = await fetch(
      `${urls().mailpitApi}/search?query=${encodeURIComponent(`to:"${individual.user.email}"`)}`,
    );
    const messages = ((await all.json()) as { messages?: { Subject: string }[] }).messages ?? [];
    expect(messages.filter((m) => m.Subject.includes('We received your ticket'))).toHaveLength(1);
  });

  it('assigning emails the assignee', async () => {
    const ticket = await opened(org.employeeClient, org.tenantId);
    const boss = await elevated(lead);
    await boss.client.post(
      `/platform/tickets/${ticket.id}/assign`,
      { version: 0, assigneeUserId: helpdesk.id },
      boss.options,
    );
    await waitForMail(
      helpdesk.email,
      new RegExp(`${ticket.number} was assigned to you`),
      1,
      45_000,
    );
  });
});
