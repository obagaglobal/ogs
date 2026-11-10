import { randomUUID } from 'node:crypto';
import type {
  AssigneeJob,
  AssigneeJobList,
  AssigneeOffer,
  CustomerJobProgress,
  JobCandidates,
  StaffJob,
} from '@ogs/contracts';
import type pg from 'pg';
import type request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { AccessRouteCheck } from '../../src/access/access-route-check.js';
import { JobLifecycleService } from '../../src/jobs/job-lifecycle.service.js';
import { JOB_COMMANDS } from '../../src/jobs/transitions.js';
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
import { attempt, connect, createMembership, createTenant, withContext } from './support.js';

/**
 * Phase 9 — jobs, offers, assignments and field work: T1–T10 of the plan.
 * T3–T5 are the owner's requirements: providers see ONLY the jobs assigned to
 * them (RLS), lose access the moment that ends, and never see internal notes,
 * billing details or other customers' data.
 */
vi.setConfig({ testTimeout: 120_000 });

let stack: Stack;
let maint: pg.Client;
let app: pg.Client;
let platformTenant: string;
let dispatcher: FixtureUser; // operations_manager: ticket.assign
let manager: FixtureUser; // service_manager: ticket.assign + ticket.confirm_completion
let helpdesk: FixtureUser; // ticket.internal_note, no ticket.assign
let internalTech: FixtureUser; // technician: assignment.respond + ticket.update_progress
let skill: string;
let serviceId: string;
let servicePriceId: string;

interface Individual {
  user: FixtureUser;
  providerId: string;
  client: Client;
}
interface Company {
  tenantId: string;
  providerId: string;
  admin: FixtureUser;
  tech: FixtureUser;
  otherTech: FixtureUser;
  adminClient: Client;
  techClient: Client;
  otherTechClient: Client;
}
interface Customer {
  user: FixtureUser;
  client: Client;
}
interface Org {
  tenantId: string;
  admin: FixtureUser;
  employee: FixtureUser;
  adminClient: Client;
  employeeClient: Client;
}

let individual: Individual;
let rival: Individual;
let company: Company;
let internalClient: Client;
let customer: Customer;
let org: Org;

const JPEG = Buffer.concat([
  Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01]),
  Buffer.alloc(64, 0),
  Buffer.from([0xff, 0xd9]),
]);
const t = () => randomUUID().replace(/-/g, '').slice(0, 10);
let numberSeq = 0;
const numberBase = 3100 + Math.floor(Math.random() * 800);
const fixtureNumber = (kind: string) =>
  `${kind}-${String(numberBase)}-${String(++numberSeq).padStart(6, '0')}`;

const lifecycle = () => stack.worker.get(JobLifecycleService);

beforeAll(async () => {
  stack = await startStack();
  maint = await connect('maint');
  app = await connect('app');
  const existing = await maint.query<{ id: string }>(
    `SELECT id FROM tenant WHERE kind = 'PLATFORM'`,
  );
  platformTenant = existing.rows[0]?.id ?? (await createTenant(maint, { kind: 'PLATFORM' }));
  dispatcher = await createStaff('operations_manager');
  manager = await createStaff('service_manager');
  helpdesk = await createStaff('helpdesk');
  internalTech = await createStaff('technician');
  internalClient = await signIn(stack.server, maint, internalTech);
  skill = await testSkill();
  ({ serviceId, servicePriceId } = await createService());
  individual = await createIndividual();
  rival = await createIndividual();
  company = await createCompany();
  const customerUser = await createLoginUser(maint);
  customer = { user: customerUser, client: await signIn(stack.server, maint, customerUser) };
  org = await createOrg();
});

afterAll(async () => {
  await app.end();
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

async function testSkill(): Promise<string> {
  const code = `j_${t()}`;
  await maint.query(`INSERT INTO skill (code, name, category) VALUES ($1, $2, 'Test')`, [
    code,
    `Job skill ${code}`,
  ]);
  return code;
}

async function createService(): Promise<{ serviceId: string; servicePriceId: string }> {
  const k = t();
  const category = await maint.query<{ id: string }>(
    `INSERT INTO service_category (slug, name) VALUES ($1, 'Jobs test') RETURNING id`,
    [`jobs-${k}`],
  );
  const service = await maint.query<{ id: string }>(
    `INSERT INTO service (slug, category_id, name, summary, description, status, published_at)
     VALUES ($1, $2, 'Network repair', 'Summary', 'Description', 'PUBLISHED', now()) RETURNING id`,
    [`network-repair-${k}`, category.rows[0]?.id],
  );
  const id = service.rows[0]?.id ?? '';
  await maint.query(
    `INSERT INTO service_skill (service_id, skill_code, min_experience) VALUES ($1, $2, 'YEARS_1_3')`,
    [id, skill],
  );
  const price = await maint.query<{ id: string }>(
    `INSERT INTO service_price (service_id, model, amount_minor) VALUES ($1, 'FIXED', 777777) RETURNING id`,
    [id],
  );
  return { serviceId: id, servicePriceId: price.rows[0]?.id ?? '' };
}

interface ProviderOptions {
  kind?: 'INDIVIDUAL' | 'COMPANY';
  ownerUserId?: string | null;
  tenantId?: string | null;
  status?: string;
  applicationStatus?: string;
  accepting?: boolean;
  experience?: string | null;
  regions?: string[];
  remote?: boolean;
  name?: string;
}

async function seedProvider(options: ProviderOptions): Promise<string> {
  const id = randomUUID();
  const kind = options.kind ?? 'INDIVIDUAL';
  const owner =
    kind === 'INDIVIDUAL' ? (options.ownerUserId ?? (await createLoginUser(maint)).id) : null;
  await maint.query(
    `INSERT INTO provider (id, kind, tenant_id, owner_user_id, display_name, status, home_region, remote_ok, accepting_work)
     VALUES ($1, $2, $3, $4, $5, $6, 'KE-30', $7, $8)`,
    [
      id,
      kind,
      options.tenantId ?? null,
      owner,
      options.name ?? `Grace Provider ${id.slice(0, 4)}`,
      options.status ?? 'ACTIVE',
      options.remote ?? false,
      options.accepting ?? true,
    ],
  );
  await maint.query(
    `INSERT INTO provider_application (provider_id, status, applicant_user_id) VALUES ($1, $2, $3)`,
    [id, options.applicationStatus ?? 'APPROVED', owner ?? (await createLoginUser(maint)).id],
  );
  if (options.experience !== null) {
    await maint.query(
      'INSERT INTO provider_skill (provider_id, skill_code, experience) VALUES ($1, $2, $3)',
      [id, skill, options.experience ?? 'YEARS_3_5'],
    );
  }
  for (const region of options.regions ?? ['KE-30']) {
    await maint.query('INSERT INTO provider_region (provider_id, region_code) VALUES ($1, $2)', [
      id,
      region,
    ]);
  }
  return id;
}

async function createIndividual(): Promise<Individual> {
  const user = await createLoginUser(maint);
  const providerId = await seedProvider({ ownerUserId: user.id });
  return { user, providerId, client: await signIn(stack.server, maint, user) };
}

async function createCompany(): Promise<Company> {
  const tenantId = await createTenant(maint, { kind: 'PROVIDER_COMPANY' });
  const admin = await createLoginUser(maint, { mfa: true });
  const tech = await createLoginUser(maint, { email: `amina.otieno-${t()}@example.test` });
  const otherTech = await createLoginUser(maint);
  await grantRole(
    maint,
    await createMembership(maint, tenantId, admin.id),
    tenantId,
    'provider_admin',
  );
  for (const user of [tech, otherTech]) {
    await grantRole(
      maint,
      await createMembership(maint, tenantId, user.id),
      tenantId,
      'provider_technician',
    );
  }
  const providerId = await seedProvider({
    kind: 'COMPANY',
    tenantId,
    name: 'Rift Valley Networks',
  });
  return {
    tenantId,
    providerId,
    admin,
    tech,
    otherTech,
    adminClient: await signIn(stack.server, maint, admin),
    techClient: await signIn(stack.server, maint, tech),
    otherTechClient: await signIn(stack.server, maint, otherTech),
  };
}

async function createOrg(): Promise<Org> {
  const tenantId = await createTenant(maint);
  const admin = await createLoginUser(maint, { mfa: true });
  const employee = await createLoginUser(maint);
  await grantRole(maint, await createMembership(maint, tenantId, admin.id), tenantId, 'org_admin');
  await grantRole(
    maint,
    await createMembership(maint, tenantId, employee.id),
    tenantId,
    'org_employee',
  );
  return {
    tenantId,
    admin,
    employee,
    adminClient: await signIn(stack.server, maint, admin),
    employeeClient: await signIn(stack.server, maint, employee),
  };
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
        { reason: 'Dispatch shift DS-2026-11' },
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

const key = () => ({ 'Idempotency-Key': randomUUID() });
function ok(response: request.Response, label = ''): void {
  expect(
    [200, 201],
    `${label} ${String(response.status)} ${JSON.stringify(response.body)}`,
  ).toContain(response.status);
}

/** A READY_FOR_ASSIGNMENT order and its job (opened by the jobs worker's service). */
async function readyOrder(
  owner: { userId: string; tenantId?: string } = { userId: customer.user.id },
  address = 'Moi Avenue 12, Nairobi CBD, 3rd floor',
): Promise<{ requestId: string; orderId: string; jobId: string }> {
  const request = await maint.query<{ id: string }>(
    `INSERT INTO service_request (number, customer_tenant_id, customer_user_id, created_by, service_id, service_price_id,
       service_name, price_model, unit_amount_minor, county, address, contact_phone, description, status)
     VALUES ($1, $2, $3, $4, $5, $6, 'Network repair', 'FIXED', 777777, 'KE-30', $7, '+254700000000',
             'Office Wi-Fi drops every hour.', 'ORDERED') RETURNING id`,
    [
      fixtureNumber('REQ'),
      owner.tenantId ?? null,
      owner.tenantId === undefined ? owner.userId : null,
      owner.userId,
      serviceId,
      servicePriceId,
      address,
    ],
  );
  const requestId = request.rows[0]?.id ?? '';
  const order = await maintAsPlatform(
    maint,
    `INSERT INTO service_order (number, request_id, customer_tenant_id, customer_user_id, payment_terms,
       subtotal_minor, vat_minor, total_minor, paid_minor, status)
     VALUES ($1, $2, $3, $4, 'PREPAY', 777777, 124444, 902221, 902221, 'READY_FOR_ASSIGNMENT') RETURNING id`,
    [
      fixtureNumber('ORD'),
      requestId,
      owner.tenantId ?? null,
      owner.tenantId === undefined ? owner.userId : null,
    ],
  );
  const orderId = (order.rows[0] as { id: string }).id;
  const jobId = await lifecycle().ensureForOrder(orderId);
  expect(jobId).not.toBeNull();
  return { requestId, orderId, jobId: jobId ?? '' };
}

/** A ticket (seeded) dispatched as a job through the staff API. */
async function ticketJob(): Promise<{ ticketId: string; jobId: string }> {
  const category = await maint.query<{ id: string }>(
    `SELECT id FROM ticket_category WHERE code = 'network'`,
  );
  const ticket = await maintAsPlatform(
    maint,
    `INSERT INTO ticket (number, customer_tenant_id, requester_user_id, created_by, category_id, subject, description)
     VALUES ($1, $2, $3, $3, $4, 'Switch down', 'The core switch in the server room is down.')
     RETURNING id`,
    [fixtureNumber('TCK'), org.tenantId, org.employee.id, category.rows[0]?.id],
  );
  const ticketId = (ticket.rows[0] as { id: string }).id;
  const { client, options } = await elevated(dispatcher);
  const response = await client.post(
    `/platform/tickets/${ticketId}/jobs`,
    {
      title: 'Replace the core switch',
      brief: 'Swap the faulty switch; spare is in the cabinet.',
      regionCode: 'KE-30',
      siteAddress: 'Kenyatta Avenue 5, Nairobi, 2nd floor',
      siteContactName: 'Wanjiru',
      siteContactPhone: '+254700000001',
      skills: [{ code: skill, minExperience: 'YEARS_1_3' }],
    },
    options,
  );
  ok(response, 'dispatch ticket');
  return { ticketId, jobId: (response.body as StaffJob).id };
}

async function staffJob(jobId: string, staff: FixtureUser = dispatcher): Promise<StaffJob> {
  const { client, options } = await elevated(staff);
  const response = await client.get(`/platform/jobs/${jobId}`, options);
  expect(response.status).toBe(200);
  return response.body as StaffJob;
}

type Assignee =
  | { kind: 'INTERNAL'; technicianUserId: string }
  | { kind: 'INDIVIDUAL'; providerId: string }
  | { kind: 'COMPANY'; providerId: string };

async function offer(jobId: string, assignee: Assignee, windowMinutes = 120) {
  const { client, options } = await elevated(dispatcher);
  const job = await staffJob(jobId);
  return client.post(
    `/platform/jobs/${jobId}/offers`,
    { version: job.version, assignee, windowMinutes },
    options,
  );
}

async function offered(jobId: string, assignee: Assignee): Promise<string> {
  const response = await offer(jobId, assignee);
  ok(response, 'offer');
  const pending = (response.body as StaffJob).offers.find((o) => o.status === 'PENDING');
  expect(pending).toBeDefined();
  return pending?.id ?? '';
}

const IND = (i: Individual): Assignee => ({ kind: 'INDIVIDUAL', providerId: i.providerId });
const CO: () => Assignee = () => ({ kind: 'COMPANY', providerId: company.providerId });
const INT: () => Assignee = () => ({ kind: 'INTERNAL', technicianUserId: internalTech.id });

async function accept(
  client: Client,
  workspace: string,
  offerId: string,
  technicianUserId?: string,
) {
  return client.post(
    `/jobs/offers/${offerId}/accept`,
    technicianUserId === undefined ? {} : { technicianUserId },
    { workspace, headers: key() },
  );
}

async function assigneeJob(client: Client, workspace: string, jobId: string) {
  return client.get(`/jobs/${jobId}`, { workspace });
}

async function move(
  client: Client,
  workspace: string,
  jobId: string,
  path: string,
  body: Record<string, unknown> = {},
) {
  const current = await assigneeJob(client, workspace, jobId);
  const version = (current.body as AssigneeJob).version;
  return client.post(`/jobs/${jobId}/${path}`, { version, ...body }, { workspace, headers: key() });
}

async function uploadPhoto(
  client: Client,
  workspace: string,
  jobId: string,
  options: { key?: string | null; caption?: string; bytes?: Buffer } = {},
) {
  let call = client.agent
    .post(`/api/v1/jobs/${jobId}/photos`)
    .set('X-Forwarded-For', client.ip)
    .set('X-CSRF-Token', client.csrf ?? '')
    .set('X-OGS-Workspace', workspace);
  if (options.key !== null) {
    call = call.set('Idempotency-Key', options.key ?? randomUUID());
  }
  return call
    .field('caption', options.caption ?? 'Switch replaced')
    .attach('file', options.bytes ?? JPEG, 'switch.jpg');
}

/** Puts an INDIVIDUAL-held job in IN_PROGRESS with one photo; returns the photo id. */
async function workedByIndividual(jobId: string, who: Individual = individual): Promise<string> {
  const offerId = await offered(jobId, IND(who));
  ok(await accept(who.client, 'provider', offerId), 'accept');
  ok(await move(who.client, 'provider', jobId, 'on-the-way'), 'on the way');
  ok(await move(who.client, 'provider', jobId, 'start'), 'start');
  const photo = await uploadPhoto(who.client, 'provider', jobId);
  ok(photo, 'photo');
  return (photo.body as AssigneeJob).photos[0]?.id ?? '';
}

async function rows(sql: string, params: unknown[]): Promise<number> {
  const result = await app.query(sql, params);
  return result.rowCount ?? 0;
}

const JOB_TABLES = [
  ['job', 'id'],
  ['job_skill', 'job_id'],
  ['job_offer', 'job_id'],
  ['job_assignment', 'job_id'],
  ['job_event', 'job_id'],
  ['job_work_note', 'job_id'],
  ['job_evidence', 'job_id'],
  ['job_completion', 'job_id'],
] as const;

async function visibleJobRows(settings: Parameters<typeof withContext>[1], jobId: string) {
  return withContext(app, settings, async () => {
    const counts: Record<string, number> = {};
    for (const [table, column] of JOB_TABLES) {
      counts[table] = await rows(`SELECT 1 FROM ${table} WHERE ${column} = $1`, [jobId]);
    }
    return counts;
  });
}

// ---------------------------------------------------------------- full journey (T6, T7, T8, T9)

describe('order → offer → decline → company → work → customer confirms', () => {
  it('runs the whole journey, moving the order with its job', async () => {
    const { requestId, orderId, jobId } = await readyOrder();
    let staff = await staffJob(jobId);
    expect(staff.status).toBe('QUEUED');
    expect(staff.source.kind).toBe('ORDER');
    expect(staff.siteAddress).toContain('Moi Avenue');

    // The customer sees "finding a technician" and nothing internal.
    const progress0 = await customer.client.get(`/requests/${requestId}/progress`, {
      workspace: 'personal',
    });
    expect(progress0.status).toBe(200);
    expect((progress0.body as CustomerJobProgress).job?.label).toBe('finding_technician');

    // Offer to an individual, who sees the area only, then declines (reason needed).
    const firstOffer = await offered(jobId, IND(individual));
    const preview = await individual.client.get(`/jobs/offers/${firstOffer}`, {
      workspace: 'provider',
    });
    expect(preview.status).toBe(200);
    const shown = preview.body as AssigneeOffer;
    expect(shown.area).toBe('Moi Avenue 12');
    expect(JSON.stringify(shown)).not.toContain('3rd floor');
    expect(JSON.stringify(shown)).not.toContain('+254700000000');
    const noNote = await individual.client.post(
      `/jobs/offers/${firstOffer}/decline`,
      { reason: 'OTHER' },
      { workspace: 'provider', headers: key() },
    );
    expect(noNote.status).toBe(400);
    ok(
      await individual.client.post(
        `/jobs/offers/${firstOffer}/decline`,
        { reason: 'NOT_AVAILABLE' },
        { workspace: 'provider', headers: key() },
      ),
      'decline',
    );
    staff = await staffJob(jobId);
    expect(staff.status).toBe('QUEUED');
    expect(staff.offers[0]?.declineReason).toBe('NOT_AVAILABLE');

    // Re-offer to the company: its admin accepts and names a technician (P9-5).
    const secondOffer = await offered(jobId, CO());
    const withoutTech = await accept(company.adminClient, company.tenantId, secondOffer);
    expect(withoutTech.status).toBe(422);
    const accepted = await accept(
      company.adminClient,
      company.tenantId,
      secondOffer,
      company.tech.id,
    );
    ok(accepted, 'company accept');
    expect((accepted.body as AssigneeJob).status).toBe('ASSIGNED');
    const order1 = await maint.query<{ status: string }>(
      'SELECT status FROM service_order WHERE id = $1',
      [orderId],
    );
    expect(order1.rows[0]?.status).toBe('IN_DELIVERY');

    // The technician (not the other one) works the job.
    const techView = await assigneeJob(company.techClient, company.tenantId, jobId);
    expect(techView.status).toBe(200);
    expect((techView.body as AssigneeJob).siteAddress).toContain('3rd floor');
    expect((techView.body as AssigneeJob).siteContactPhone).toBe('+254700000000');
    expect((await assigneeJob(company.otherTechClient, company.tenantId, jobId)).status).toBe(404);

    const startEarly = await move(company.techClient, company.tenantId, jobId, 'start');
    expect(startEarly.status).toBe(409);
    ok(await move(company.techClient, company.tenantId, jobId, 'on-the-way'), 'on the way');
    ok(await move(company.techClient, company.tenantId, jobId, 'start'), 'start');
    const noReason = await move(company.techClient, company.tenantId, jobId, 'pause');
    expect(noReason.status).toBe(400);
    ok(
      await move(company.techClient, company.tenantId, jobId, 'pause', {
        reason: 'Waiting for the spare part',
      }),
      'pause',
    );
    ok(await move(company.techClient, company.tenantId, jobId, 'resume'), 'resume');
    ok(
      await company.techClient.post(
        `/jobs/${jobId}/notes`,
        { body: 'Replaced the access point on floor 3.' },
        { workspace: company.tenantId, headers: key() },
      ),
      'note',
    );
    const photo = await uploadPhoto(company.techClient, company.tenantId, jobId);
    ok(photo, 'photo');
    const photoId = (photo.body as AssigneeJob).photos[0]?.id ?? '';
    const noPhoto = await move(company.techClient, company.tenantId, jobId, 'completion', {
      summary: 'Replaced the faulty access point and tested the Wi-Fi.',
    });
    expect(noPhoto.status).toBe(422);
    ok(
      await move(company.techClient, company.tenantId, jobId, 'completion', {
        summary: 'Replaced the faulty access point and tested the Wi-Fi.',
        minutesOnSite: 75,
        evidenceIds: [photoId],
      }),
      'report',
    );

    // The customer tracks it, sees the report and the photo, and confirms.
    const progress = await customer.client.get(`/requests/${requestId}/progress`, {
      workspace: 'personal',
    });
    const view = (progress.body as CustomerJobProgress).job;
    expect(view?.label).toBe('check_and_confirm');
    expect(view?.assignee).toEqual({ firstName: 'Amina', initials: 'AM', partner: true });
    expect(view?.report?.photos.map((p) => p.id)).toEqual([photoId]);
    expect(view?.can.confirm).toBe(true);
    expect(JSON.stringify(progress.body)).not.toContain('Waiting for the spare part');
    expect(JSON.stringify(progress.body)).not.toContain('Replaced the access point on floor 3');
    ok(
      await customer.client.post(
        `/requests/${requestId}/job/confirm`,
        { version: view?.version },
        { workspace: 'personal', headers: key() },
      ),
      'confirm',
    );
    staff = await staffJob(jobId);
    expect(staff.status).toBe('COMPLETED');
    expect(staff.report?.outcome).toBe('CONFIRMED');
    const order2 = await maint.query<{ status: string }>(
      'SELECT status FROM service_order WHERE id = $1',
      [orderId],
    );
    expect(order2.rows[0]?.status).toBe('COMPLETED');

    // Access ends with the job (T4): the job is gone, only the "Done" copy stays.
    expect((await assigneeJob(company.techClient, company.tenantId, jobId)).status).toBe(404);
    const done = await company.techClient.get('/jobs?view=done', { workspace: company.tenantId });
    expect((done.body as AssigneeJobList).done.some((d) => d.number === staff.number)).toBe(true);

    // T8: every assignment change is audited, one event per command.
    const audits = await maint.query<{ action: string }>(
      `SELECT action FROM audit_log WHERE entity_type = 'job' AND entity_id = $1 ORDER BY occurred_at`,
      [jobId],
    );
    expect(audits.rows.map((r) => r.action)).toEqual([
      'job.created',
      'job.offered',
      'job.offer_declined',
      'job.offered',
      'job.offer_accepted',
      'job.on_the_way',
      'job.start',
      'job.pause',
      'job.resume',
      'job.report_submitted',
      'job.confirmed',
    ]);
    const events = await maint.query<{ kind: string }>(
      'SELECT kind FROM job_event WHERE job_id = $1 ORDER BY occurred_at',
      [jobId],
    );
    expect(events.rows.map((r) => r.kind)).toEqual([
      'create',
      'offer',
      'decline',
      'offer',
      'accept',
      'on_the_way',
      'start',
      'pause',
      'resume',
      'work_note',
      'photo',
      'submit_report',
      'confirm',
    ]);
  });
});

// ---------------------------------------------------------------- T1 transition table

describe('T1 commands are refused outside their states', () => {
  it('assignee and customer commands answer 409 from every state the table does not list', async () => {
    const { requestId, jobId } = await readyOrder();
    const results: string[] = [];
    const tryAll = async (state: string) => {
      const job = await staffJob(jobId);
      expect(job.status).toBe(state);
      const assigneeCalls: [keyof typeof JOB_COMMANDS, string, Record<string, unknown>][] = [
        ['onTheWay', 'on-the-way', {}],
        ['start', 'start', {}],
        ['pause', 'pause', { reason: 'Lunch break now' }],
        ['resume', 'resume', {}],
      ];
      for (const [command, path] of assigneeCalls) {
        const allowed = (JOB_COMMANDS[command].from as readonly string[]).includes(state);
        if (allowed) {
          continue;
        }
        const response = await individual.client.post(
          `/jobs/${jobId}/${path}`,
          { version: job.version, reason: 'Lunch break now' },
          { workspace: 'provider', headers: key() },
        );
        if (![404, 409].includes(response.status)) {
          results.push(`${command} from ${state}: ${String(response.status)}`);
        }
      }
      if (!(JOB_COMMANDS.confirm.from as readonly string[]).includes(state)) {
        const response = await customer.client.post(
          `/requests/${requestId}/job/confirm`,
          { version: job.version },
          { workspace: 'personal', headers: key() },
        );
        if (response.status !== 409) {
          results.push(`confirm from ${state}: ${String(response.status)}`);
        }
      }
      const after = await staffJob(jobId);
      if (after.version !== job.version) {
        results.push(`${state}: a refused command changed the job`);
      }
    };
    await tryAll('QUEUED');
    const offerId = await offered(jobId, IND(individual));
    await tryAll('OFFERED');
    ok(await accept(individual.client, 'provider', offerId));
    await tryAll('ASSIGNED');
    ok(await move(individual.client, 'provider', jobId, 'on-the-way'));
    await tryAll('ON_THE_WAY');
    ok(await move(individual.client, 'provider', jobId, 'start'));
    await tryAll('IN_PROGRESS');
    expect(results).toEqual([]);
  });

  it('a stale version is refused and changes nothing', async () => {
    const { jobId } = await readyOrder();
    const { client, options } = await elevated(dispatcher);
    const response = await client.post(
      `/platform/jobs/${jobId}/offers`,
      { version: 99, assignee: IND(individual) },
      options,
    );
    expect(response.status).toBe(409);
    expect((await staffJob(jobId)).status).toBe('QUEUED');
  });

  it('a retried command (same Idempotency-Key) happens once', async () => {
    const { jobId } = await readyOrder();
    const offerId = await offered(jobId, IND(individual));
    const headers = key();
    const first = await individual.client.post(
      `/jobs/offers/${offerId}/accept`,
      {},
      {
        workspace: 'provider',
        headers,
      },
    );
    const again = await individual.client.post(
      `/jobs/offers/${offerId}/accept`,
      {},
      {
        workspace: 'provider',
        headers,
      },
    );
    ok(first);
    ok(again);
    expect(again.body).toEqual(first.body);
    const assignments = await maint.query('SELECT 1 FROM job_assignment WHERE job_id = $1', [
      jobId,
    ]);
    expect(assignments.rowCount).toBe(1);
  });
});

// ---------------------------------------------------------------- T2 eligibility in the database

describe('T2 only approved, eligible, active providers can receive work (database)', () => {
  it('the job_offer trigger refuses every ineligible assignee, by raw SQL', async () => {
    const { jobId } = await readyOrder();
    const suspendedTenant = await createTenant(maint, {
      kind: 'PROVIDER_COMPANY',
      status: 'SUSPENDED',
    });
    const cases: [string, string, string | null][] = [
      [
        'pending',
        await seedProvider({ status: 'PENDING_APPROVAL', applicationStatus: 'SUBMITTED' }),
        null,
      ],
      ['rejected', await seedProvider({ status: 'REJECTED', applicationStatus: 'REJECTED' }), null],
      ['suspended', await seedProvider({ status: 'SUSPENDED' }), null],
      ['not accepting work', await seedProvider({ accepting: false }), null],
      ['no skill', await seedProvider({ experience: null }), null],
      ['too little experience', await seedProvider({ experience: 'UNDER_1_YEAR' }), null],
      ['other county, no remote', await seedProvider({ regions: ['KE-01'] }), null],
      [
        'company tenant suspended',
        await seedProvider({ kind: 'COMPANY', tenantId: suspendedTenant }),
        suspendedTenant,
      ],
    ];
    const good = await seedProvider({});
    await withContext(app, { userId: dispatcher.id, isPlatform: true }, async () => {
      for (const [label, providerId, tenantId] of cases) {
        const result = await attempt(
          app,
          `INSERT INTO job_offer (job_id, kind, provider_id, assignee_tenant_id, offered_by, expires_at)
           VALUES ($1, $2, $3, $4, $5, now() + interval '1 hour')`,
          [
            jobId,
            tenantId === null ? 'INDIVIDUAL' : 'COMPANY',
            providerId,
            tenantId,
            dispatcher.id,
          ],
        );
        expect(result, label).toHaveProperty('error');
        expect((result as { error: string }).error, label).toContain('not eligible');
      }
      // Internal: a platform member without the technician permissions.
      const helpdeskOffer = await attempt(
        app,
        `INSERT INTO job_offer (job_id, kind, technician_user_id, assignee_tenant_id, offered_by, expires_at)
         VALUES ($1, 'INTERNAL', $2, $3, $4, now() + interval '1 hour')`,
        [jobId, helpdesk.id, platformTenant, dispatcher.id],
      );
      expect(helpdeskOffer).toHaveProperty('error');
      // Positive control.
      const fine = await attempt(
        app,
        `INSERT INTO job_offer (job_id, kind, provider_id, offered_by, expires_at)
         VALUES ($1, 'INDIVIDUAL', $2, $3, now() + interval '1 hour')`,
        [jobId, good, dispatcher.id],
      );
      expect(fine).toHaveProperty('rowCount', 1);
    });
  });

  it('the API refuses an ineligible assignee with 422 and changes nothing', async () => {
    const { jobId } = await readyOrder();
    const unskilled = await seedProvider({ experience: null });
    const response = await offer(jobId, { kind: 'INDIVIDUAL', providerId: unskilled });
    expect(response.status).toBe(422);
    expect((response.body as { error: string }).error).toBe('not_eligible');
    expect((await staffJob(jobId)).status).toBe('QUEUED');
    const helpdeskOffer = await offer(jobId, { kind: 'INTERNAL', technicianUserId: helpdesk.id });
    expect(helpdeskOffer.status).toBe(422);
  });

  it('eligibility is checked again on accept', async () => {
    const user = await createLoginUser(maint);
    const providerId = await seedProvider({ ownerUserId: user.id });
    const client = await signIn(stack.server, maint, user);
    const { jobId } = await readyOrder();
    const offerId = await offered(jobId, { kind: 'INDIVIDUAL', providerId });
    await maintAsPlatform(maint, 'UPDATE provider SET accepting_work = false WHERE id = $1', [
      providerId,
    ]);
    const response = await accept(client, 'provider', offerId);
    expect(response.status).toBe(422);
    expect((await staffJob(jobId)).status).toBe('OFFERED');
  });

  it('suggestions agree with the database rule', async () => {
    const { jobId } = await readyOrder();
    const { client, options } = await elevated(dispatcher);
    const response = await client.get(`/platform/jobs/${jobId}/candidates`, options);
    expect(response.status).toBe(200);
    const candidates = response.body as JobCandidates;
    expect(candidates.internal.map((c) => c.id)).toContain(internalTech.id);
    expect(candidates.internal.map((c) => c.id)).not.toContain(helpdesk.id);
    const offeredIds = candidates.providers.map((c) => c.providerId);
    expect(offeredIds).toEqual(expect.arrayContaining([individual.providerId, company.providerId]));
    for (const providerId of offeredIds) {
      const rule = await maint.query<{ ok: boolean }>(
        `SELECT app.can_take_job($1, (SELECT kind::text FROM provider WHERE id = $2)::"AssigneeKind", $2, NULL) AS ok`,
        [jobId, providerId],
      );
      expect(rule.rows[0]?.ok, providerId).toBe(true);
    }
  });

  it('suspending a provider withdraws its offers and releases its jobs at once', async () => {
    const victim = await createIndividual();
    const held = await readyOrder();
    await workedByIndividual(held.jobId, victim);
    const pending = await readyOrder();
    await offered(pending.jobId, IND(victim));
    // Suspend the way staff do (Phase 5 route), so the release trigger runs as ogs_app.
    const prm = await elevated(await createStaff('provider_relationship_manager'));
    const reason = { reason: 'Customer complaint under investigation (CMP-88).' };
    expect(
      (
        await prm.client.post(
          `/platform/providers/${victim.providerId}/suspend`,
          reason,
          prm.options,
        )
      ).status,
    ).toBe(204);
    expect((await staffJob(held.jobId)).status).toBe('QUEUED');
    expect((await staffJob(held.jobId)).assignments[0]?.endReason).toBe('PROVIDER_SUSPENDED');
    expect((await staffJob(pending.jobId)).status).toBe('QUEUED');
    expect((await staffJob(pending.jobId)).offers[0]?.status).toBe('WITHDRAWN');
    const counts = await visibleJobRows(
      { userId: victim.user.id, providerId: victim.providerId },
      held.jobId,
    );
    expect(counts['job']).toBe(0);
    expect(counts['job_evidence']).toBe(0);
  });
});

// ---------------------------------------------------------------- T3 provider RLS isolation

describe('T3 providers see only what is assigned to them', () => {
  let held: { requestId: string; orderId: string; jobId: string };

  beforeAll(async () => {
    held = await readyOrder();
    await workedByIndividual(held.jobId);
    ok(
      await individual.client.post(
        `/jobs/${held.jobId}/notes`,
        { body: 'Note by the holder' },
        { workspace: 'provider', headers: key() },
      ),
    );
  });

  it('the holder sees every job row; a rival provider none, through SQL and the API', async () => {
    const mine = await visibleJobRows(
      { userId: individual.user.id, providerId: individual.providerId },
      held.jobId,
    );
    expect(mine['job']).toBe(1);
    expect(mine['job_work_note']).toBe(1);
    expect(mine['job_evidence']).toBe(1);
    const theirs = await visibleJobRows(
      { userId: rival.user.id, providerId: rival.providerId },
      held.jobId,
    );
    expect(
      Object.values(theirs).every((n) => n === 0),
      JSON.stringify(theirs),
    ).toBe(true);
    expect((await assigneeJob(rival.client, 'provider', held.jobId)).status).toBe(404);
    expect((await assigneeJob(company.adminClient, company.tenantId, held.jobId)).status).toBe(404);
    expect((await assigneeJob(internalClient, platformTenant, held.jobId)).status).toBe(404);
  });

  it('no provider context reads a single customer row', async () => {
    const customerTables = [
      'service_order',
      'service_request',
      'quotation',
      'quotation_line',
      'payment',
      'organisation_billing',
      'ticket',
      'ticket_comment',
      'ticket_attachment',
      'ticket_event',
      'ticket_internal_note',
    ];
    const contexts = [
      { userId: individual.user.id, providerId: individual.providerId },
      { userId: company.admin.id, tenantId: company.tenantId },
      { userId: company.tech.id, tenantId: company.tenantId },
    ];
    for (const settings of contexts) {
      await withContext(app, settings, async () => {
        for (const table of customerTables) {
          expect(
            await rows(`SELECT 1 FROM ${table}`, []),
            `${table} ${JSON.stringify(settings)}`,
          ).toBe(0);
        }
      });
    }
  });

  it('the Provider workspace and the personal workspace are separate capacities (P9-3)', async () => {
    const own = await readyOrder({ userId: individual.user.id });
    await withContext(app, { userId: individual.user.id }, async () => {
      expect(await rows('SELECT 1 FROM service_order WHERE id = $1', [own.orderId])).toBe(1);
      expect(await rows('SELECT 1 FROM job WHERE id = $1', [held.jobId])).toBe(0);
    });
    await withContext(
      app,
      { userId: individual.user.id, providerId: individual.providerId },
      async () => {
        expect(await rows('SELECT 1 FROM service_order WHERE id = $1', [own.orderId])).toBe(0);
        expect(await rows('SELECT 1 FROM job WHERE id = $1', [own.jobId])).toBe(0);
        expect(await rows('SELECT 1 FROM job WHERE id = $1', [held.jobId])).toBe(1);
      },
    );
  });

  it('company technicians see only jobs naming them; the company dispatcher sees all of them', async () => {
    const job = await readyOrder();
    const offerId = await offered(job.jobId, CO());
    ok(await accept(company.adminClient, company.tenantId, offerId, company.tech.id));
    const tech = await visibleJobRows(
      { userId: company.tech.id, tenantId: company.tenantId },
      job.jobId,
    );
    const other = await visibleJobRows(
      { userId: company.otherTech.id, tenantId: company.tenantId },
      job.jobId,
    );
    const admin = await visibleJobRows(
      { userId: company.admin.id, tenantId: company.tenantId },
      job.jobId,
    );
    expect(tech['job']).toBe(1);
    expect(other['job']).toBe(0);
    expect(admin['job']).toBe(1);
    const list = await company.otherTechClient.get('/jobs?view=active', {
      workspace: company.tenantId,
    });
    expect((list.body as AssigneeJobList).items.some((i) => i.id === job.jobId)).toBe(false);
  });

  it('personal and organisation workspaces are not assignees', async () => {
    expect((await customer.client.get('/jobs', { workspace: 'personal' })).status).toBe(403);
    expect((await org.adminClient.get('/jobs', { workspace: org.tenantId })).status).toBe(403);
  });

  it('app.holds_permission answers only for ACTIVE memberships of the current tenant', async () => {
    const check = (settings: Parameters<typeof withContext>[1]) =>
      withContext(app, settings, async () => {
        const result = await app.query<{ ok: boolean }>(
          `SELECT app.holds_permission('ticket.assign') AS ok`,
        );
        return result.rows[0]?.ok;
      });
    expect(await check({ userId: company.admin.id, tenantId: company.tenantId })).toBe(true);
    expect(await check({ userId: company.tech.id, tenantId: company.tenantId })).toBe(false);
    expect(await check({ userId: company.admin.id, tenantId: org.tenantId })).toBe(false);
    expect(await check({ userId: company.admin.id })).toBe(false);
  });
});

// ---------------------------------------------------------------- T4 no access after reassignment

describe('T4 access ends when the assignment does', () => {
  it('staff reassignment: the old holder gets 404 everywhere and SQL sees nothing', async () => {
    const job = await readyOrder();
    const photoId = await workedByIndividual(job.jobId);
    const { client, options } = await elevated(dispatcher);
    const staff = await staffJob(job.jobId);
    ok(
      await client.post(
        `/platform/jobs/${job.jobId}/reassign`,
        { version: staff.version, reason: 'Customer asked for a different technician' },
        options,
      ),
    );
    expect((await assigneeJob(individual.client, 'provider', job.jobId)).status).toBe(404);
    expect(
      (
        await individual.client.get(`/jobs/${job.jobId}/photos/${photoId}/download`, {
          workspace: 'provider',
        })
      ).status,
    ).toBe(404);
    const counts = await visibleJobRows(
      { userId: individual.user.id, providerId: individual.providerId },
      job.jobId,
    );
    expect(counts['job']).toBe(0);
    expect(counts['job_event']).toBe(0);
    expect(counts['job_evidence']).toBe(0);
    // This job's photo files (read with BYPASSRLS): the old holder must see none of
    // them. The same fixture still holds other jobs' photos, so scope to this job.
    const files = (
      await maint.query<{ file_id: string }>(`SELECT file_id FROM job_evidence WHERE job_id = $1`, [
        job.jobId,
      ])
    ).rows.map((row) => row.file_id);
    expect(files.length).toBeGreaterThan(0);
    await withContext(
      app,
      { userId: individual.user.id, providerId: individual.providerId },
      async () => {
        expect(await rows(`SELECT 1 FROM file_metadata WHERE id = ANY($1::uuid[])`, [files])).toBe(
          0,
        );
      },
    );
    // The next assignee does not inherit the previous one's notes or photos (P9-9).
    const offerId = await offered(job.jobId, IND(rival));
    ok(await accept(rival.client, 'provider', offerId));
    const next = (await assigneeJob(rival.client, 'provider', job.jobId)).body as AssigneeJob;
    expect(next.photos).toEqual([]);
    expect(next.workNotes).toEqual([]);
  });

  it('a company technician change: the old technician loses the job, the new one has it', async () => {
    const job = await readyOrder();
    const offerId = await offered(job.jobId, CO());
    ok(await accept(company.adminClient, company.tenantId, offerId, company.tech.id));
    const before = (await assigneeJob(company.adminClient, company.tenantId, job.jobId))
      .body as AssigneeJob;
    expect(before.can.changeTechnician).toBe(true);
    ok(
      await company.adminClient.post(
        `/jobs/${job.jobId}/technician`,
        {
          version: before.version,
          technicianUserId: company.otherTech.id,
          reason: 'Amina is off sick',
        },
        { workspace: company.tenantId, headers: key() },
      ),
    );
    expect((await assigneeJob(company.techClient, company.tenantId, job.jobId)).status).toBe(404);
    expect((await assigneeJob(company.otherTechClient, company.tenantId, job.jobId)).status).toBe(
      200,
    );
    const audit = await maint.query(
      `SELECT 1 FROM audit_log WHERE entity_id = $1 AND action = 'job.technician_changed'`,
      [job.jobId],
    );
    expect(audit.rowCount).toBe(1);
  });

  it('cancelling the job ends access', async () => {
    const job = await readyOrder();
    await workedByIndividual(job.jobId);
    const { client, options } = await elevated(dispatcher);
    const staff = await staffJob(job.jobId);
    ok(
      await client.post(
        `/platform/jobs/${job.jobId}/cancel`,
        { version: staff.version, reason: 'Customer cancelled the visit' },
        options,
      ),
    );
    expect((await assigneeJob(individual.client, 'provider', job.jobId)).status).toBe(404);
    expect((await staffJob(job.jobId)).assignments[0]?.endReason).toBe('JOB_CANCELLED');
  });

  it('ending a company technician’s membership releases their job', async () => {
    const leaver = await createLoginUser(maint);
    const membership = await createMembership(maint, company.tenantId, leaver.id);
    await grantRole(maint, membership, company.tenantId, 'provider_technician');
    const job = await readyOrder();
    const offerId = await offered(job.jobId, CO());
    ok(await accept(company.adminClient, company.tenantId, offerId, leaver.id));
    await withContext(
      app,
      { userId: company.admin.id, tenantId: company.tenantId },
      async () => {
        await app.query(`UPDATE membership SET status = 'SUSPENDED' WHERE id = $1`, [membership]);
      },
      true,
    );
    const staff = await staffJob(job.jobId);
    expect(staff.status).toBe('QUEUED');
    expect(staff.assignments[0]?.endReason).toBe('REMOVED');
  });
});

// ---------------------------------------------------------------- T5 nothing confidential reaches providers

describe('T5 providers never see internal notes, billing details or other customers’ data', () => {
  const CANARY = `CANARY-${randomUUID()}`;
  let ticket: { ticketId: string; jobId: string };
  let canaryCustomer: Customer;
  let order: { requestId: string; orderId: string; jobId: string };

  beforeAll(async () => {
    // A ticket job with an internal note and an internal hold reason.
    ticket = await ticketJob();
    const desk = await elevated(helpdesk);
    ok(
      await desk.client.post(
        `/platform/tickets/${ticket.ticketId}/notes`,
        { body: `Internal: ${CANARY}` },
        desk.options,
      ),
    );
    // An order job for a customer whose email carries the canary, with a
    // reassignment reason that carries it too.
    const user = await createLoginUser(maint, { email: `canary-${t()}@example.test` });
    canaryCustomer = { user, client: await signIn(stack.server, maint, user) };
    order = await readyOrder({ userId: user.id });
    const first = await offered(order.jobId, IND(individual));
    ok(await accept(individual.client, 'provider', first));
    const { client, options } = await elevated(dispatcher);
    ok(
      await client.post(
        `/platform/jobs/${order.jobId}/reassign`,
        { version: (await staffJob(order.jobId)).version, reason: `Reason ${CANARY}` },
        options,
      ),
    );
    ok(await accept(individual.client, 'provider', await offered(order.jobId, IND(individual))));
    ok(
      await accept(
        company.adminClient,
        company.tenantId,
        await offered(ticket.jobId, CO()),
        company.tech.id,
      ),
    );
    // Staff see the canary, so the setup really wrote it.
    expect(JSON.stringify(await staffJob(order.jobId))).toContain(CANARY);
  });

  const forbidden = (text: string, label: string) => {
    expect(text, label).not.toContain(CANARY);
    expect(text, label).not.toContain(canaryCustomer.user.email);
    expect(text, label).not.toMatch(/777777|902221|124444/);
    // Money is always a `…Minor` key (with a currency); a list's `total` is only a count.
    expect(text, label).not.toMatch(/"\w*Minor"\s*:|"(amount|currency)"|"price|"email"/i);
    expect(text, label).not.toMatch(/internalNotes":\[\{/);
  };

  it('no provider API response contains internal, billing or customer-account data', async () => {
    const routes = stack.app
      .get(AccessRouteCheck)
      .routes()
      .filter((route) => route.rule !== undefined && route.rule.kind !== 'elevated')
      .filter((route) => route.method === 'GET' && route.path.startsWith('/jobs'));
    expect(routes.some((route) => route.path === '/jobs/:id')).toBe(true);
    const callers: [Client, string, string][] = [
      [individual.client, 'provider', order.jobId],
      [company.adminClient, company.tenantId, ticket.jobId],
      [company.techClient, company.tenantId, ticket.jobId],
    ];
    let checked = 0;
    for (const [client, workspace, id] of callers) {
      for (const route of routes) {
        const path = route.path.replace(/:[A-Za-z]+/g, id);
        for (const query of ['', '?view=offers', '?view=active', '?view=done']) {
          if (query !== '' && route.path !== '/jobs') {
            continue;
          }
          const response = await client.get(`${path}${query}`, { workspace });
          forbidden(`${JSON.stringify(response.body)} ${response.text}`, `${route.path}${query}`);
          checked += 1;
        }
      }
    }
    expect(checked).toBeGreaterThan(10);
    // The holder does get the job (the test is not passing on 404s).
    const view = await assigneeJob(company.techClient, company.tenantId, ticket.jobId);
    expect(view.status).toBe(200);
    expect((view.body as AssigneeJob).internalNotes).toEqual([]);
  });

  it('provider contexts read no internal note, internal event or ticket row in the database', async () => {
    for (const settings of [
      { userId: company.tech.id, tenantId: company.tenantId },
      { userId: company.admin.id, tenantId: company.tenantId },
      { userId: individual.user.id, providerId: individual.providerId },
    ]) {
      await withContext(app, settings, async () => {
        expect(await rows('SELECT 1 FROM ticket_internal_note', [])).toBe(0);
        expect(await rows('SELECT 1 FROM ticket WHERE id = $1', [ticket.ticketId])).toBe(0);
        expect(
          await rows('SELECT 1 FROM job_event WHERE job_id = $1 AND NOT provider_visible', [
            order.jobId,
          ]),
        ).toBe(0);
        expect(
          await rows('SELECT 1 FROM app_user WHERE email = $1', [canaryCustomer.user.email]),
        ).toBe(0);
      });
    }
  });

  it('an INTERNAL OGS technician on a ticket job may read its internal notes (P9-2)', async () => {
    const job = await ticketJob();
    const desk = await elevated(helpdesk);
    ok(
      await desk.client.post(
        `/platform/tickets/${job.ticketId}/notes`,
        { body: 'Bring the console cable.' },
        desk.options,
      ),
    );
    const offerId = await offered(job.jobId, INT());
    ok(await accept(internalClient, platformTenant, offerId));
    const view = (await assigneeJob(internalClient, platformTenant, job.jobId)).body as AssigneeJob;
    expect(view.internalNotes.map((n) => n.body)).toContain('Bring the console cable.');
  });

  it('provider-bound emails carry no canary, address, phone or money', async () => {
    const mail = await waitForMail(individual.user.email, /New job offer/, 1, 45_000);
    const text = JSON.stringify(mail);
    expect(text).not.toContain(CANARY);
    expect(text).not.toContain('+2547');
    expect(text).not.toMatch(/KES|777,777|7,777/);
  }, 120_000);
});

// ---------------------------------------------------------------- T6 offers

describe('T6 offers: accept, decline, timeout, withdrawal', () => {
  /** A PENDING offer that expires `seconds` from now (raw SQL: the API's minimum is 30 minutes). */
  async function shortOffer(jobId: string, providerId: string, seconds: number): Promise<string> {
    await maint.query('BEGIN');
    try {
      await maint.query(
        `SELECT set_config('app.is_platform', 'true', true), set_config('app.user_id', $1, true)`,
        [dispatcher.id],
      );
      const inserted = await maint.query<{ id: string }>(
        `INSERT INTO job_offer (job_id, kind, provider_id, offered_by, expires_at)
         VALUES ($1, 'INDIVIDUAL', $2, $3, now() + ($4 || ' seconds')::interval) RETURNING id`,
        [jobId, providerId, dispatcher.id, String(seconds)],
      );
      await maint.query(`UPDATE job SET status = 'OFFERED', version = version + 1 WHERE id = $1`, [
        jobId,
      ]);
      await maint.query('COMMIT');
      return inserted.rows[0]?.id ?? '';
    } catch (error) {
      await maint.query('ROLLBACK');
      throw error;
    }
  }

  it('an offer expires exactly once at its deadline, and a late accept is refused', async () => {
    const { jobId } = await readyOrder();
    const offerId = await shortOffer(jobId, individual.providerId, 1);
    expect(await lifecycle().expireOffer(offerId)).toBe(false); // not yet
    await new Promise((resolve) => setTimeout(resolve, 1_300));
    const late = await accept(individual.client, 'provider', offerId);
    expect(late.status).toBe(409);
    expect((late.body as { error: string }).error).toBe('offer_expired');
    expect(await lifecycle().expireOffer(offerId)).toBe(true);
    expect(await lifecycle().expireOffer(offerId)).toBe(false);
    const job = await staffJob(jobId);
    expect(job.status).toBe('QUEUED');
    expect(job.offers[0]?.status).toBe('EXPIRED');
    // Back in the queue: a new offer works.
    await offered(jobId, IND(rival));
  });

  it('the sweep expires overdue offers', async () => {
    const { jobId } = await readyOrder();
    await shortOffer(jobId, individual.providerId, 1);
    await new Promise((resolve) => setTimeout(resolve, 1_300));
    expect(await lifecycle().sweepExpiredOffers()).toBeGreaterThanOrEqual(1);
    expect((await staffJob(jobId)).status).toBe('QUEUED');
  });

  it('only one pending offer per job; staff withdraw it', async () => {
    const { jobId } = await readyOrder();
    const offerId = await offered(jobId, IND(individual));
    const second = await offer(jobId, IND(rival));
    expect(second.status).toBe(409);
    const { client, options } = await elevated(dispatcher);
    ok(
      await client.post(
        `/platform/jobs/${jobId}/offers/${offerId}/withdraw`,
        { version: (await staffJob(jobId)).version },
        options,
      ),
    );
    expect((await staffJob(jobId)).status).toBe('QUEUED');
    expect((await accept(individual.client, 'provider', offerId)).status).toBe(404);
  });

  it('a provider cannot answer someone else’s offer', async () => {
    const { jobId } = await readyOrder();
    const offerId = await offered(jobId, IND(individual));
    expect((await accept(rival.client, 'provider', offerId)).status).toBe(404);
    expect(
      (
        await rival.client.post(
          `/jobs/offers/${offerId}/decline`,
          { reason: 'TOO_FAR' },
          { workspace: 'provider', headers: key() },
        )
      ).status,
    ).toBe(404);
  });

  it('a company accept must name one of its own technicians', async () => {
    const { jobId } = await readyOrder();
    const offerId = await offered(jobId, CO());
    const outsider = await accept(
      company.adminClient,
      company.tenantId,
      offerId,
      individual.user.id,
    );
    expect(outsider.status).toBe(422);
    expect((await staffJob(jobId)).status).toBe('OFFERED');
  });
});

// ---------------------------------------------------------------- T7 work and completion

describe('T7 work, reports and confirmation', () => {
  it('the customer can report a problem; the same assignee continues', async () => {
    const job = await readyOrder();
    const photoId = await workedByIndividual(job.jobId);
    ok(
      await move(individual.client, 'provider', job.jobId, 'completion', {
        summary: 'Replaced the router and tested every room.',
        evidenceIds: [photoId],
      }),
    );
    const progress = (
      await customer.client.get(`/requests/${job.requestId}/progress`, { workspace: 'personal' })
    ).body as CustomerJobProgress;
    ok(
      await customer.client.post(
        `/requests/${job.requestId}/job/report-problem`,
        { version: progress.job?.version, reason: 'The kitchen still has no Wi-Fi.' },
        { workspace: 'personal', headers: key() },
      ),
    );
    const view = (await assigneeJob(individual.client, 'provider', job.jobId)).body as AssigneeJob;
    expect(view.status).toBe('IN_PROGRESS');
    expect(view.can.complete).toBe(true);
  });

  it('reports auto-confirm after 7 days, exactly once', async () => {
    const fresh = await readyOrder();
    const freshPhoto = await workedByIndividual(fresh.jobId);
    ok(
      await move(individual.client, 'provider', fresh.jobId, 'completion', {
        summary: 'Replaced the router and tested every room.',
        evidenceIds: [freshPhoto],
      }),
    );
    expect(await lifecycle().autoConfirm(fresh.jobId)).toBe(false); // not 7 days yet

    // A report submitted 7 days ago (submitted_at is immutable, so it is written that way).
    const job = await readyOrder();
    const photoId = await workedByIndividual(job.jobId);
    await maint.query('BEGIN');
    try {
      await maint.query(`SELECT set_config('app.user_id', $1, true)`, [individual.user.id]);
      await maint.query(
        `INSERT INTO job_completion (job_id, assignment_id, summary, evidence_ids, submitted_by, submitted_at)
         SELECT $1, a.id, 'Replaced the router and tested every room.', ARRAY[$2::uuid], $3,
                now() - interval '7 days 1 minute'
           FROM job_assignment a WHERE a.job_id = $1 AND a.status = 'ACTIVE'`,
        [job.jobId, photoId, individual.user.id],
      );
      await maint.query(`SELECT set_config('app.is_platform', 'true', true)`);
      await maint.query(
        `UPDATE job SET status = 'AWAITING_CONFIRMATION', version = version + 1 WHERE id = $1`,
        [job.jobId],
      );
      await maint.query('COMMIT');
    } catch (error) {
      await maint.query('ROLLBACK');
      throw error;
    }
    expect(await lifecycle().autoConfirm(job.jobId)).toBe(true);
    expect(await lifecycle().autoConfirm(job.jobId)).toBe(false);
    expect((await staffJob(job.jobId)).report?.outcome).toBe('AUTO_CONFIRMED');
  });

  it('staff confirm on the customer’s behalf with a reason (audited)', async () => {
    const job = await readyOrder();
    const photoId = await workedByIndividual(job.jobId);
    ok(
      await move(individual.client, 'provider', job.jobId, 'completion', {
        summary: 'Replaced the router and tested every room.',
        evidenceIds: [photoId],
      }),
    );
    const { client, options } = await elevated(manager);
    const staff = await staffJob(job.jobId, manager);
    expect(staff.can.confirm).toBe(true);
    ok(
      await client.post(
        `/platform/jobs/${job.jobId}/confirm`,
        { version: staff.version, reason: 'Customer confirmed by phone' },
        options,
      ),
    );
    expect((await staffJob(job.jobId)).report?.outcome).toBe('STAFF_CONFIRMED');
    const dispatcherTry = await (
      await elevated(dispatcher)
    ).client.post(
      `/platform/jobs/${job.jobId}/confirm`,
      { version: 0, reason: 'Not allowed for dispatchers' },
      (await elevated(dispatcher)).options,
    );
    expect(dispatcherTry.status).toBe(403);
  });

  it('a ticket job is confirmed by accepting the ticket’s resolution (P9-7)', async () => {
    const job = await ticketJob();
    const offerId = await offered(job.jobId, IND(individual));
    ok(await accept(individual.client, 'provider', offerId));
    ok(await move(individual.client, 'provider', job.jobId, 'on-the-way'));
    ok(await move(individual.client, 'provider', job.jobId, 'start'));
    const photo = await uploadPhoto(individual.client, 'provider', job.jobId);
    ok(photo);
    ok(
      await move(individual.client, 'provider', job.jobId, 'completion', {
        summary: 'Replaced the core switch and restored the network.',
        evidenceIds: [(photo.body as AssigneeJob).photos[0]?.id],
      }),
    );
    const progress = (
      await org.employeeClient.get(`/tickets/${job.ticketId}/progress`, { workspace: org.tenantId })
    ).body as CustomerJobProgress;
    expect(progress.job?.label).toBe('check_and_confirm');
    expect(progress.job?.can.confirm).toBe(false);
    // Staff resolve the ticket; the requester accepts the resolution.
    const desk = await elevated(helpdesk);
    const ticket = await desk.client.get(`/platform/tickets/${job.ticketId}`, desk.options);
    ok(
      await desk.client.post(
        `/platform/tickets/${job.ticketId}/resolve`,
        { version: (ticket.body as { version: number }).version, resolution: 'Switch replaced.' },
        desk.options,
      ),
    );
    const customerTicket = await org.employeeClient.get(`/tickets/${job.ticketId}`, {
      workspace: org.tenantId,
    });
    ok(
      await org.employeeClient.post(
        `/tickets/${job.ticketId}/accept-resolution`,
        { version: (customerTicket.body as { version: number }).version },
        { workspace: org.tenantId },
      ),
    );
    expect((await staffJob(job.jobId)).status).toBe('COMPLETED');
  });

  it('a photo retried with the same Idempotency-Key is stored once', async () => {
    const job = await readyOrder();
    await workedByIndividual(job.jobId); // one photo already
    const photos = async () =>
      (await maint.query('SELECT 1 FROM job_evidence WHERE job_id = $1', [job.jobId])).rowCount ??
      0;
    const files = async () =>
      (
        await maint.query(
          `SELECT 1 FROM file_metadata f JOIN job_evidence e ON e.file_id = f.id WHERE e.job_id = $1`,
          [job.jobId],
        )
      ).rowCount ?? 0;
    const events = async () =>
      (
        await maint.query(`SELECT 1 FROM job_event WHERE job_id = $1 AND kind = 'photo'`, [
          job.jobId,
        ])
      ).rowCount ?? 0;
    expect(await photos()).toBe(1);

    // The connection drops after the server stored the photo; the phone retries.
    const key = randomUUID();
    const first = await uploadPhoto(individual.client, 'provider', job.jobId, { key });
    ok(first, 'first upload');
    const retry = await uploadPhoto(individual.client, 'provider', job.jobId, { key });
    ok(retry, 'retry');
    expect(await photos()).toBe(2);
    expect(await files()).toBe(2);
    expect(await events()).toBe(2);
    expect((retry.body as AssigneeJob).photos).toHaveLength(2);

    // Two retries racing each other still store one photo.
    const raceKey = randomUUID();
    const raced = await Promise.all([
      uploadPhoto(individual.client, 'provider', job.jobId, { key: raceKey }),
      uploadPhoto(individual.client, 'provider', job.jobId, { key: raceKey }),
    ]);
    for (const response of raced) {
      // The loser of the race answers like a replay (or 409 while the winner is mid-flight).
      expect([200, 201, 409]).toContain(response.status);
    }
    expect(raced.some((response) => [200, 201].includes(response.status))).toBe(true);
    expect(await photos()).toBe(3);
    expect(await events()).toBe(3);

    // The same key with a different photo or caption is refused, and so is no key at all.
    const otherPhoto = Buffer.concat([
      JPEG.subarray(0, JPEG.length - 2),
      Buffer.from([0x01, 0xff, 0xd9]),
    ]);
    expect(
      (await uploadPhoto(individual.client, 'provider', job.jobId, { key, bytes: otherPhoto }))
        .status,
    ).toBe(422);
    expect(
      (await uploadPhoto(individual.client, 'provider', job.jobId, { key, caption: 'Other' }))
        .status,
    ).toBe(422);
    expect(
      (await uploadPhoto(individual.client, 'provider', job.jobId, { key: null })).status,
    ).toBe(422);
    expect(await photos()).toBe(3);
  });

  it('photos: images only; the customer sees them only once cited in a report', async () => {
    const job = await readyOrder();
    const photoId = await workedByIndividual(job.jobId);
    const pdf = await uploadPhoto(individual.client, 'provider', job.jobId, {
      bytes: Buffer.from('%PDF-1.4\n%%EOF\n'),
    });
    expect(pdf.status).toBe(400);
    expect(
      (
        await customer.client.get(`/requests/${job.requestId}/job/photos/${photoId}/download`, {
          workspace: 'personal',
        })
      ).status,
    ).toBe(404);
    // The generic files route never serves job photos.
    const fileId = (
      await maint.query<{ file_id: string }>('SELECT file_id FROM job_evidence WHERE id = $1', [
        photoId,
      ])
    ).rows[0]?.file_id;
    expect(
      (await customer.client.get(`/files/${fileId ?? ''}/download`, { workspace: 'personal' }))
        .status,
    ).toBe(404);
  });
});

// ---------------------------------------------------------------- T9 customer view, T10 emails

describe('T9 the customer’s tracker shows only customer fields', () => {
  it('a reassignment shows as "arranging a new technician"; another customer gets 404', async () => {
    const job = await readyOrder();
    await workedByIndividual(job.jobId);
    const { client, options } = await elevated(dispatcher);
    ok(
      await client.post(
        `/platform/jobs/${job.jobId}/reassign`,
        { version: (await staffJob(job.jobId)).version, reason: 'Secret internal reason' },
        options,
      ),
    );
    const progress = await customer.client.get(`/requests/${job.requestId}/progress`, {
      workspace: 'personal',
    });
    const body = progress.body as CustomerJobProgress;
    expect(body.job?.label).toBe('finding_technician');
    expect(body.job?.activity.map((a) => a.kind)).toContain('reassign');
    expect(JSON.stringify(body)).not.toContain('Secret internal reason');
    expect(JSON.stringify(body)).not.toMatch(/providerId|brief|siteAddress|declineReason/);
    const stranger = await createLoginUser(maint);
    const strangerClient = await signIn(stack.server, maint, stranger);
    expect(
      (await strangerClient.get(`/requests/${job.requestId}/progress`, { workspace: 'personal' }))
        .status,
    ).toBe(404);
  });
});

describe('T10 job emails', () => {
  it('the customer hears that a technician is assigned, once, without names of the company', async () => {
    const user = await createLoginUser(maint);
    const job = await readyOrder({ userId: user.id });
    const offerId = await offered(job.jobId, CO());
    ok(await accept(company.adminClient, company.tenantId, offerId, company.tech.id));
    const mail = await waitForMail(user.email, /technician is assigned/, 1, 45_000);
    expect(JSON.stringify(mail)).not.toContain('Rift Valley Networks');
    const techMail = await waitForMail(company.tech.email, /is assigned to you/, 1, 45_000);
    expect(JSON.stringify(techMail)).not.toContain('+2547');
  }, 120_000);
});
