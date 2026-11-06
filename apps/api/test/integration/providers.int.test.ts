import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AccessRouteCheck } from '../../src/access/access-route-check.js';
import {
  Client,
  createLoginUser,
  grantRole,
  signIn,
  startStack,
  waitForMail,
  type FixtureUser,
  type Stack,
} from './http-harness.js';
import { connect, createMembership, createTenant, createUser } from './support.js';

/**
 * Phase 5 — providers: D1–D9 of the plan (D10 is the web journey).
 */
const PDF = Buffer.from('%PDF-1.4\n1 0 obj << >> endobj\ntrailer << >>\n%%EOF\n');
const FOREIGN_ID = '01930000-0000-7000-8000-00000000abcd';

let stack: Stack;
let maint: pg.Client;
let platformTenant: string;
let prm: FixtureUser; // provider_relationship_manager: tenant.review/approve + provider.approve
let compliance: FixtureUser; // tenant.review + compliance.review, no approve
let operations: FixtureUser; // tenant.review + ticket.assign, no approve, no compliance
let serviceManager: FixtureUser; // catalogue.manage + ticket.assign

beforeAll(async () => {
  stack = await startStack();
  maint = await connect('maint');
  const existing = await maint.query<{ id: string }>(
    `SELECT id FROM tenant WHERE kind = 'PLATFORM'`,
  );
  platformTenant = existing.rows[0]?.id ?? (await createTenant(maint, { kind: 'PLATFORM' }));
  prm = await createStaff('provider_relationship_manager');
  compliance = await createStaff('compliance');
  operations = await createStaff('operations_manager');
  serviceManager = await createStaff('service_manager');
});

afterAll(async () => {
  await maint.end();
  await stack.close();
});

// ---------------------------------------------------------------- helpers

async function createStaff(roleCode: string): Promise<FixtureUser> {
  const staff = await createLoginUser(maint, { mfa: true });
  const membership = await createMembership(maint, platformTenant, staff.id);
  await grantRole(maint, membership, platformTenant, roleCode);
  return staff;
}

const elevations = new Map<string, Promise<{ client: Client; options: ElevatedOptions }>>();

interface ElevatedOptions {
  workspace: string;
  headers: Record<string, string>;
}

/**
 * An elevated staff session, reused per staff member (and scope): signing in
 * for every call would trip the per-account sign-in rate limit.
 */
async function elevated(staff: FixtureUser, tenantId?: string) {
  const key = `${staff.id}:${tenantId ?? '*'}`;
  let session = elevations.get(key);
  if (session === undefined) {
    session = openElevation(staff, tenantId);
    elevations.set(key, session);
  }
  return session;
}

async function openElevation(
  staff: FixtureUser,
  tenantId?: string,
): Promise<{ client: Client; options: ElevatedOptions }> {
  const client = await signIn(stack.server, maint, staff);
  const response = await client.post(
    '/platform/elevate',
    { reason: 'Provider vetting PRV-2026-17', ...(tenantId === undefined ? {} : { tenantId }) },
    { workspace: platformTenant },
  );
  expect(response.status).toBe(201);
  const { elevationId } = response.body as { elevationId: string };
  const options = { workspace: platformTenant, headers: { 'X-OGS-Elevation': elevationId } };
  return { client, options };
}

async function upload(client: Client, workspace: string, purpose: string) {
  return client.agent
    .post('/api/v1/files')
    .set('X-Forwarded-For', client.ip)
    .set('X-CSRF-Token', client.csrf ?? '')
    .set('X-OGS-Workspace', workspace)
    .field('purpose', purpose)
    .attach('file', PDF, 'evidence.pdf');
}

async function waitClean(fileId: string): Promise<void> {
  const deadline = Date.now() + 15_000;
  for (;;) {
    const result = await maint.query<{ status: string }>(
      'SELECT status FROM file_metadata WHERE id = $1',
      [fileId],
    );
    if (result.rows[0]?.status === 'CLEAN') return;
    if (Date.now() > deadline) throw new Error(`file ${fileId} not scanned`);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

interface ProviderView {
  providerId: string;
  kind: string;
  status: string;
  application: { applicationId: string; status: string; missing: string[] };
  skills: { code: string }[];
  regions: { code: string }[];
  workingHours: { weekday: number; start: string; end: string }[];
  timeOff: { id: string }[];
  documents: { id: string; purpose: string }[];
}

/** A signed-in individual with a complete, submitted application. */
async function submittedIndividual(label = 'Grace Achieng') {
  const user = await createLoginUser(maint);
  const client = await signIn(stack.server, maint, user);
  const applied = await client.post('/providers/me', { displayName: label });
  expect(applied.status).toBe(201);
  const { providerId, applicationId } = applied.body as {
    providerId: string;
    applicationId: string;
  };
  const ws = { workspace: 'provider' };
  expect(
    (await client.patch('/provider/profile', { phone: '+254712345678', homeRegion: 'KE-30' }, ws))
      .status,
  ).toBe(200);
  expect(
    (
      await client.put(
        '/provider/skills',
        { skills: [{ code: 'networking', experience: 'YEARS_3_5' }] },
        ws,
      )
    ).status,
  ).toBe(200);
  expect((await client.put('/provider/regions', { regionCodes: ['KE-30'] }, ws)).status).toBe(200);
  const identity = await upload(client, 'provider', 'provider.identity');
  expect(identity.status).toBe(201);
  expect((await upload(client, 'provider', 'provider.certificate')).status).toBe(201);
  const submitted = await client.post('/provider/application/submit', {}, ws);
  expect(submitted.status).toBe(200);
  expect(submitted.body).toMatchObject({ status: 'PENDING_APPROVAL' });
  return {
    user,
    client,
    providerId,
    applicationId,
    identityFileId: (identity.body as { id: string }).id,
  };
}

/** A signed-in provider-company applicant (with MFA, as admins need it) and a submitted application. */
async function submittedCompany(legalName = 'Rift Valley Networks Ltd') {
  const user = await createLoginUser(maint, { mfa: true });
  const client = await signIn(stack.server, maint, user);
  const registered = await client.post('/providers/companies', { legalName });
  expect(registered.status).toBe(201);
  const { tenantId, providerId, applicationId } = registered.body as {
    tenantId: string;
    providerId: string;
    applicationId: string;
  };
  const ws = { workspace: tenantId };
  const draft = await client.get('/provider', ws);
  expect(draft.status).toBe(200);
  expect((draft.body as ProviderView).application.missing).toEqual(
    expect.arrayContaining(['registrationNumber', 'kraPin', 'companyDocuments', 'skills']),
  );
  expect(
    (
      await client.patch(
        '/provider/business',
        { registrationNumber: 'PVT-2026-7788', kraPin: 'P051234567X' },
        ws,
      )
    ).status,
  ).toBe(200);
  expect(
    (await client.patch('/provider/profile', { phone: '+254722000000', homeRegion: 'KE-30' }, ws))
      .status,
  ).toBe(200);
  expect(
    (
      await client.put(
        '/provider/skills',
        { skills: [{ code: 'cctv', experience: 'OVER_5_YEARS' }] },
        ws,
      )
    ).status,
  ).toBe(200);
  expect((await client.put('/provider/regions', { regionCodes: ['KE-30'] }, ws)).status).toBe(200);
  expect((await upload(client, tenantId, 'provider.company_document')).status).toBe(201);
  const submitted = await client.post('/provider/application/submit', {}, ws);
  expect(submitted.status).toBe(200);
  return { user, client, tenantId, providerId, applicationId };
}

const CHECKLIST = {
  identityChecked: true,
  registrationChecked: true,
  taxChecked: true,
  skillsChecked: true,
  notes: 'Documents verified against KRA iTax',
};

// ---------------------------------------------------------------- eligibility fixtures

interface SeedOptions {
  kind?: 'INDIVIDUAL' | 'COMPANY';
  status?: string;
  applicationStatus?: string;
  tenantStatus?: string;
  accepting?: boolean;
  skills?: [string, string][];
  regions?: string[];
  remote?: boolean;
  home?: string | null;
  /** [weekday 1–7, start minute, end minute] */
  hours?: [number, number, number][];
  timeOff?: [string, string][];
  name?: string;
}

const ALL_WEEK: [number, number, number][] = [1, 2, 3, 4, 5, 6, 7].map((d) => [d, 0, 1440]);

/** Writes a provider directly (as ogs_maint) so eligibility can be tested combinatorially. */
async function seedProvider(options: SeedOptions): Promise<string> {
  const kind = options.kind ?? 'INDIVIDUAL';
  const ownerId = kind === 'INDIVIDUAL' ? await createUser(maint) : null;
  const tenantId =
    kind === 'COMPANY'
      ? await createTenant(maint, {
          kind: 'PROVIDER_COMPANY',
          status: options.tenantStatus ?? 'ACTIVE',
        })
      : null;
  const providerId = randomUUID();
  await maint.query(
    `INSERT INTO provider (id, kind, tenant_id, owner_user_id, display_name, status,
       home_region, remote_ok, accepting_work)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [
      providerId,
      kind,
      tenantId,
      ownerId,
      options.name ?? `Provider ${providerId.slice(0, 8)}`,
      options.status ?? 'ACTIVE',
      options.home === undefined ? 'KE-30' : options.home,
      options.remote ?? false,
      options.accepting ?? true,
    ],
  );
  await maint.query(
    `INSERT INTO provider_application (provider_id, status, applicant_user_id)
     VALUES ($1, $2, $3)`,
    [providerId, options.applicationStatus ?? 'APPROVED', ownerId ?? (await createUser(maint))],
  );
  for (const [code, experience] of options.skills ?? []) {
    await maint.query(
      'INSERT INTO provider_skill (provider_id, skill_code, experience) VALUES ($1, $2, $3)',
      [providerId, code, experience],
    );
  }
  for (const region of options.regions ?? ['KE-30']) {
    await maint.query('INSERT INTO provider_region (provider_id, region_code) VALUES ($1, $2)', [
      providerId,
      region,
    ]);
  }
  for (const [weekday, start, end] of options.hours ?? ALL_WEEK) {
    await maint.query(
      `INSERT INTO provider_working_hours (provider_id, weekday, start_minute, end_minute)
       VALUES ($1, $2, $3, $4)`,
      [providerId, weekday, start, end],
    );
  }
  for (const [startsAt, endsAt] of options.timeOff ?? []) {
    await maint.query(
      'INSERT INTO provider_time_off (provider_id, starts_at, ends_at) VALUES ($1, $2, $3)',
      [providerId, startsAt, endsAt],
    );
  }
  return providerId;
}

/** A fresh skill so each test's eligibility query only sees its own providers. */
async function testSkill(): Promise<string> {
  const code = `t_${randomUUID().replace(/-/g, '').slice(0, 12)}`;
  await maint.query(`INSERT INTO skill (code, name, category) VALUES ($1, $2, 'Test')`, [
    code,
    `Test skill ${code}`,
  ]);
  return code;
}

interface Candidate {
  providerId: string;
  score: number;
  reasons: { factor: string; points: number }[];
}

async function eligible(
  query: Record<string, string>,
  staff: FixtureUser = operations,
): Promise<Candidate[]> {
  const { client, options } = await elevated(staff);
  const response = await client.get(
    `/platform/providers/eligible?${new URLSearchParams(query).toString()}`,
    options,
  );
  expect(response.status, JSON.stringify(response.body)).toBe(200);
  return (response.body as { candidates: Candidate[] }).candidates;
}

// 2026-11-09 is a Monday. Nairobi is UTC+3 all year (no daylight saving).
const MONDAY_NOON = '2026-11-09T09:00:00Z';

// ---------------------------------------------------------------- D1

describe('D1 — eligibility never returns an ineligible provider', () => {
  it('applies every hard filter, and explains the score of the eligible ones', async () => {
    const [a, b] = [await testSkill(), await testSkill()];
    const both: [string, string][] = [
      [a, 'OVER_5_YEARS'],
      [b, 'YEARS_3_5'],
    ];
    const excluded: Record<string, SeedOptions> = {
      'application not approved': {
        status: 'PENDING_APPROVAL',
        applicationStatus: 'SUBMITTED',
        skills: both,
      },
      'approved but provider still pending': { status: 'PENDING_APPROVAL', skills: both },
      rejected: { status: 'REJECTED', applicationStatus: 'REJECTED', skills: both },
      suspended: { status: 'SUSPENDED', skills: both },
      'not accepting work': { accepting: false, skills: both },
      'missing a required skill': { skills: [[a, 'OVER_5_YEARS']] },
      'outside the region': { regions: ['KE-01'], skills: both },
      'remote, but the service is on-site': { regions: ['KE-01'], remote: true, skills: both },
      'company tenant suspended': { kind: 'COMPANY', tenantStatus: 'SUSPENDED', skills: both },
      'company tenant still pending': {
        kind: 'COMPANY',
        tenantStatus: 'PENDING_APPROVAL',
        skills: both,
      },
      'no working hours on Monday': { hours: [[2, 0, 1440]], skills: both },
      'outside Monday hours': { hours: [[1, 13 * 60, 17 * 60]], skills: both },
      'on time off': {
        timeOff: [['2026-11-09T00:00:00+03:00', '2026-11-10T00:00:00+03:00']],
        skills: both,
      },
    };
    const excludedIds = new Map<string, string>();
    for (const [label, options] of Object.entries(excluded)) {
      excludedIds.set(await seedProvider({ ...options, name: label }), label);
    }
    const best = await seedProvider({ name: 'Best individual', skills: both, home: 'KE-30' });
    const company = await seedProvider({
      kind: 'COMPANY',
      name: 'Eligible company',
      skills: [
        [a, 'UNDER_1_YEAR'],
        [b, 'UNDER_1_YEAR'],
      ],
      home: null,
    });

    const found = await eligible({ skills: `${a},${b}`, region: 'KE-30', at: MONDAY_NOON });
    const ids = found.map((candidate) => candidate.providerId);
    for (const id of ids) {
      expect(excludedIds.get(id), 'an excluded provider was returned').toBeUndefined();
    }
    expect(ids).toEqual([best, company]);

    // Plain, explained sum: skills 2×10, experience 3+2, region 20, home 5, available 15.
    const [first, second] = found;
    expect(first?.score).toBe(65);
    expect(first?.reasons.map((reason) => [reason.factor, reason.points])).toEqual([
      ['skills', 20],
      ['experience', 5],
      ['region', 20],
      ['home_region', 5],
      ['availability', 15],
    ]);
    expect(second?.score).toBe(55);

    // Remote providers qualify only when the service can be delivered remotely.
    const remote = [...excludedIds].find(([, label]) => label.startsWith('remote'))?.[0];
    const withRemote = await eligible({
      skills: `${a},${b}`,
      region: 'KE-30',
      at: MONDAY_NOON,
      remote: 'true',
    });
    expect(withRemote.map((candidate) => candidate.providerId)).toEqual(
      expect.arrayContaining([best, company, remote]),
    );
    expect(withRemote).toHaveLength(3);
    expect(
      withRemote.find((candidate) => candidate.providerId === remote)?.reasons[2],
    ).toMatchObject({ factor: 'region', points: 5 });
  });

  it('without a time, availability only scores (it does not filter)', async () => {
    const skill = await testSkill();
    const never = await seedProvider({ skills: [[skill, 'YEARS_1_3']], hours: [] });
    const found = await eligible({ skills: skill, region: 'KE-30' });
    expect(found.map((candidate) => candidate.providerId)).toEqual([never]);
    expect(found[0]?.reasons.at(-1)).toMatchObject({ factor: 'availability', points: 0 });
  });

  it('is staff-only: elevation and ticket.assign are required', async () => {
    const outsider = await createLoginUser(maint);
    const client = await signIn(stack.server, maint, outsider);
    expect(
      (await client.get('/platform/providers/eligible?skills=networking&region=KE-30')).status,
    ).toBe(403);
    const { client: staff, options } = await elevated(prm); // no ticket.assign
    expect(
      (await staff.get('/platform/providers/eligible?skills=networking&region=KE-30', options))
        .status,
    ).toBe(403);
    const { client: ops, options: opsOptions } = await elevated(operations);
    expect(
      (await ops.get('/platform/providers/eligible?skills=Not-A-Code&region=KE-30', opsOptions))
        .status,
    ).toBe(400);
  });
});

// ---------------------------------------------------------------- D2

describe('D2 — application lifecycle for both kinds', () => {
  it('individual: draft → submit → changes requested → resubmit → approved with checklist', async () => {
    const user = await createLoginUser(maint);
    const client = await signIn(stack.server, maint, user);
    expect((await client.post('/providers/me', { displayName: 'Peter Otieno' })).status).toBe(201);
    expect((await client.post('/providers/me', { displayName: 'Again' })).body).toEqual({
      error: 'already_a_provider',
    });
    const workspaces = await client.get('/me/workspaces');
    expect(workspaces.body).toMatchObject({
      provider: { status: 'PENDING_APPROVAL', restricted: true },
    });
    const ws = { workspace: 'provider' };
    const draft = (await client.get('/provider', ws)).body as ProviderView;
    expect(draft.application.status).toBe('DRAFT');
    expect(draft.application.missing).toEqual(
      expect.arrayContaining([
        'phone',
        'homeRegion',
        'skills',
        'regions',
        'identityDocument',
        'skillEvidence',
      ]),
    );
    expect((await client.post('/provider/application/submit', {}, ws)).body).toEqual({
      error: 'application_incomplete',
    });
    // Unknown references are refused.
    expect(
      (
        await client.put(
          '/provider/skills',
          { skills: [{ code: 'no_such_skill', experience: 'YEARS_1_3' }] },
          ws,
        )
      ).body,
    ).toEqual({ error: 'skill_unknown' });
    expect((await client.put('/provider/regions', { regionCodes: ['KE-99'] }, ws)).body).toEqual({
      error: 'region_unknown',
    });
    await client.patch('/provider/profile', { phone: '+254711111111', homeRegion: 'KE-30' }, ws);
    await client.put(
      '/provider/skills',
      { skills: [{ code: 'desktop_support', experience: 'YEARS_1_3' }] },
      ws,
    );
    await client.put('/provider/regions', { regionCodes: ['KE-30', 'KE-13'] }, ws);
    expect((await upload(client, 'provider', 'provider.identity')).status).toBe(201);
    expect((await upload(client, 'provider', 'provider.certificate')).status).toBe(201);
    const submitted = await client.post('/provider/application/submit', {}, ws);
    expect(submitted.status).toBe(200);
    const { applicationId } = (submitted.body as ProviderView).application;

    // Under review: content is frozen.
    expect((await client.put('/provider/regions', { regionCodes: ['KE-30'] }, ws)).body).toEqual({
      error: 'application_locked',
    });

    // The queue lists it with its type; the organisation-only filter hides it.
    const { client: staff, options } = await elevated(prm);
    const queue = await staff.get('/platform/applications?type=individual_provider', options);
    expect(
      (queue.body as { applications: { applicationId: string; type: string }[] }).applications,
    ).toContainEqual(
      expect.objectContaining({ applicationId, type: 'individual_provider', tenantId: null }),
    );
    const organisationsOnly = await staff.get('/platform/applications?type=organisation', options);
    expect(
      (organisationsOnly.body as { applications: { applicationId: string }[] }).applications.some(
        (item) => item.applicationId === applicationId,
      ),
    ).toBe(false);

    expect(
      (
        await staff.post(
          `/platform/provider-applications/${applicationId}/request-changes`,
          { reason: 'Please upload a clearer copy of your ID.' },
          options,
        )
      ).status,
    ).toBe(204);
    await waitForMail(user.email, /needs changes to the provider application/);
    expect((await client.post('/provider/application/submit', {}, ws)).status).toBe(200);

    // Approval needs the checklist.
    expect(
      (await staff.post(`/platform/provider-applications/${applicationId}/approve`, {}, options))
        .status,
    ).toBe(400);
    expect(
      (
        await staff.post(
          `/platform/provider-applications/${applicationId}/approve`,
          { checklist: CHECKLIST },
          options,
        )
      ).status,
    ).toBe(204);
    await waitForMail(user.email, /approved as an OGS provider/);
    const approved = (await client.get('/provider', ws)).body as ProviderView;
    expect(approved).toMatchObject({ status: 'ACTIVE', application: { status: 'APPROVED' } });
    expect((await client.get('/me/workspaces')).body).toMatchObject({
      provider: { status: 'ACTIVE', restricted: false },
    });
    // After approval the provider keeps editing coverage and availability.
    expect(
      (
        await client.put(
          '/provider/working-hours',
          { hours: [{ weekday: 1, start: '08:00', end: '17:00' }] },
          ws,
        )
      ).status,
    ).toBe(200);

    const detail = await staff.get(`/platform/provider-applications/${applicationId}`, options);
    expect(detail.body).toMatchObject({
      verification: { identityChecked: true, skillsChecked: true },
    });
    const audit = await maint.query<{ action: string; metadata: { checklist?: unknown } }>(
      `SELECT action, metadata FROM audit_log WHERE entity_id = $1 ORDER BY occurred_at`,
      [applicationId],
    );
    expect(audit.rows.map((row) => row.action)).toEqual(
      expect.arrayContaining([
        'provider.application_submitted',
        'provider.application_changes_requested',
        'provider.application_approved',
      ]),
    );
    expect(
      audit.rows.find((row) => row.action === 'provider.application_approved')?.metadata,
    ).toMatchObject({ kind: 'INDIVIDUAL', checklist: { identityChecked: true } });
    const history = await maint.query<{ to_status: string }>(
      `SELECT to_status FROM provider_application_event WHERE application_id = $1 ORDER BY occurred_at`,
      [applicationId],
    );
    expect(history.rows.map((row) => row.to_status)).toEqual([
      'DRAFT',
      'SUBMITTED',
      'CHANGES_REQUESTED',
      'SUBMITTED',
      'APPROVED',
    ]);
  });

  it('the approve permission depends on the kind; nobody decides their own application', async () => {
    const individual = await submittedIndividual();
    const company = await submittedCompany();

    // compliance can review but approve neither kind.
    const { client: reviewer, options: reviewOptions } = await elevated(compliance);
    for (const id of [individual.applicationId, company.applicationId]) {
      const response = await reviewer.post(
        `/platform/provider-applications/${id}/approve`,
        { checklist: CHECKLIST },
        reviewOptions,
      );
      expect(response.body).toEqual({ error: 'permission_denied' });
    }

    // A PRM who applied as an individual cannot decide their own application.
    const ownClient = await signIn(stack.server, maint, prm);
    const own = await ownClient.post('/providers/me', { displayName: 'Staff Moonlighting' });
    const ownApplication = (own.body as { applicationId: string }).applicationId;
    await maint.query(`UPDATE provider_application SET status = 'SUBMITTED' WHERE id = $1`, [
      ownApplication,
    ]);
    const { client: staff, options } = await elevated(prm);
    expect(
      (
        await staff.post(
          `/platform/provider-applications/${ownApplication}/approve`,
          { checklist: CHECKLIST },
          options,
        )
      ).body,
    ).toEqual({ error: 'cannot_decide_own_application' });

    // The company: tenant and provider become ACTIVE, admins are emailed.
    expect(
      (
        await staff.post(
          `/platform/provider-applications/${company.applicationId}/approve`,
          { checklist: CHECKLIST },
          options,
        )
      ).status,
    ).toBe(204);
    await waitForMail(company.user.email, /approved as an OGS provider/);
    const tenant = await maint.query<{ status: string }>(
      'SELECT status FROM tenant WHERE id = $1',
      [company.tenantId],
    );
    expect(tenant.rows[0]?.status).toBe('ACTIVE');
    expect(
      (await company.client.get('/provider', { workspace: company.tenantId })).body,
    ).toMatchObject({ kind: 'COMPANY', status: 'ACTIVE' });

    // The individual is rejected: final, with a 24-month retention marker.
    expect(
      (
        await staff.post(
          `/platform/provider-applications/${individual.applicationId}/reject`,
          { reason: 'The identity document does not match the applicant.' },
          options,
        )
      ).status,
    ).toBe(204);
    await waitForMail(individual.user.email, /was not approved/);
    const rejected = await maint.query<{ status: string; months: number }>(
      `SELECT status, round(extract(epoch FROM retain_until - now()) / 86400 / 30.44)::int AS months
         FROM provider WHERE id = $1`,
      [individual.providerId],
    );
    expect(rejected.rows[0]).toEqual({ status: 'REJECTED', months: 24 });
    expect(
      (
        await individual.client.patch(
          '/provider/profile',
          { remoteOk: true },
          { workspace: 'provider' },
        )
      ).body,
    ).toEqual({ error: 'application_locked' });
    expect(
      (
        await staff.post(
          `/platform/provider-applications/${individual.applicationId}/approve`,
          { checklist: CHECKLIST },
          options,
        )
      ).body,
    ).toEqual({ error: 'invalid_transition' });
  });

  it('suspension: out of eligibility, read-only, emailed; reactivation restores it', async () => {
    const individual = await submittedIndividual('Suspended Sam');
    const { client: staff, options } = await elevated(prm);
    await staff.post(
      `/platform/provider-applications/${individual.applicationId}/approve`,
      { checklist: CHECKLIST },
      options,
    );
    await maint.query(
      `INSERT INTO provider_working_hours (provider_id, weekday, start_minute, end_minute)
       SELECT $1, d, 0, 1440 FROM generate_series(1, 7) d`,
      [individual.providerId],
    );
    const skill = await testSkill();
    await maint.query(
      `INSERT INTO provider_skill (provider_id, skill_code, experience) VALUES ($1, $2, 'YEARS_1_3')`,
      [individual.providerId, skill],
    );
    expect((await eligible({ skills: skill, region: 'KE-30' })).map((c) => c.providerId)).toEqual([
      individual.providerId,
    ]);

    const reason = { reason: 'Customer complaint under investigation (CMP-88).' };
    expect(
      (await staff.post(`/platform/providers/${individual.providerId}/suspend`, reason, options))
        .status,
    ).toBe(204);
    await waitForMail(individual.user.email, /suspended as an OGS provider/);
    expect(await eligible({ skills: skill, region: 'KE-30' })).toEqual([]);
    const ws = { workspace: 'provider' };
    expect((await individual.client.get('/provider', ws)).body).toMatchObject({
      status: 'SUSPENDED',
    });
    expect(
      (await individual.client.patch('/provider/profile', { acceptingWork: true }, ws)).body,
    ).toEqual({
      error: 'provider_suspended',
    });
    expect(
      (await staff.post(`/platform/providers/${individual.providerId}/suspend`, reason, options))
        .body,
    ).toEqual({ error: 'invalid_transition' });

    // compliance may not suspend; PRM reactivates.
    const { client: other, options: otherOptions } = await elevated(compliance);
    expect(
      (
        await other.post(
          `/platform/providers/${individual.providerId}/reactivate`,
          reason,
          otherOptions,
        )
      ).body,
    ).toEqual({ error: 'permission_denied' });
    expect(
      (await staff.post(`/platform/providers/${individual.providerId}/reactivate`, reason, options))
        .status,
    ).toBe(204);
    await waitForMail(individual.user.email, /active again as an OGS provider/);
    expect((await eligible({ skills: skill, region: 'KE-30' })).map((c) => c.providerId)).toEqual([
      individual.providerId,
    ]);
    // The provider's own pause switch also takes it out.
    expect(
      (await individual.client.patch('/provider/profile', { acceptingWork: false }, ws)).status,
    ).toBe(200);
    expect(await eligible({ skills: skill, region: 'KE-30' })).toEqual([]);
  });
});

// ---------------------------------------------------------------- D3

describe('D3 — pending providers are inert', () => {
  it('a pending provider company reaches only its application', async () => {
    const user = await createLoginUser(maint, { mfa: true });
    const client = await signIn(stack.server, maint, user);
    const { tenantId } = (
      await client.post('/providers/companies', { legalName: 'Pending Tech Ltd' })
    ).body as { tenantId: string };
    const routes = stack.app
      .get(AccessRouteCheck)
      .routes()
      .filter(
        (route) =>
          (route.rule?.kind === 'permission' && !route.rule.allowRestricted) ||
          (route.rule?.kind === 'authenticated' &&
            route.rule.workspace &&
            !route.rule.allowRestricted),
      );
    expect(routes.length).toBeGreaterThan(10);
    for (const route of routes) {
      const path = route.path.replace(/:[A-Za-z]+/g, FOREIGN_ID);
      const request = client.agent[
        route.method.toLowerCase() as 'get' | 'post' | 'put' | 'patch' | 'delete'
      ](`/api/v1${path}`)
        .set('X-Forwarded-For', client.ip)
        .set('X-OGS-Workspace', tenantId);
      const response =
        route.method === 'GET'
          ? await request
          : await request.set('X-CSRF-Token', client.csrf ?? '').send({});
      expect(response.status, `${route.method} ${route.path}`).toBe(403);
    }
    expect((await client.get('/provider', { workspace: tenantId })).status).toBe(200);
  });

  it('a pending individual’s Provider workspace reaches only its application', async () => {
    const user = await createLoginUser(maint);
    const client = await signIn(stack.server, maint, user);
    await client.post('/providers/me', { displayName: 'Pending Pat' });
    const routes = stack.app
      .get(AccessRouteCheck)
      .routes()
      .filter(
        (route) =>
          (route.rule?.kind === 'permission' && !route.rule.allowRestricted) ||
          (route.rule?.kind === 'authenticated' &&
            route.rule.workspace &&
            !route.rule.allowRestricted),
      );
    for (const route of routes) {
      const path = route.path.replace(/:[A-Za-z]+/g, FOREIGN_ID);
      const response = await client.agent[
        route.method.toLowerCase() as 'get' | 'post' | 'put' | 'patch' | 'delete'
      ](`/api/v1${path}`)
        .set('X-Forwarded-For', client.ip)
        .set('X-OGS-Workspace', 'provider')
        .set('X-CSRF-Token', client.csrf ?? '')
        .send(route.method === 'GET' ? undefined : {});
      expect(response.status, `${route.method} ${route.path}`).toBe(403);
    }
    expect((await client.get('/provider', { workspace: 'provider' })).status).toBe(200);
    // A pending individual cannot change their own status in the database either.
    const app = await connect('app');
    try {
      await app.query('BEGIN');
      await app.query(
        `SELECT set_config('app.user_id', $1, true), set_config('app.actor_kind', 'USER', true)`,
        [user.id],
      );
      await expect(
        app.query(`UPDATE provider SET status = 'ACTIVE' WHERE owner_user_id = $1`, [user.id]),
      ).rejects.toThrow(/platform review/);
    } finally {
      await app.query('ROLLBACK');
      await app.end();
    }
  });
});

// ---------------------------------------------------------------- D4

describe('D4 — KYC documents', () => {
  it('identity documents: owner and entitled, elevated staff only; every staff view audited', async () => {
    const individual = await submittedIndividual('Kyc Kamau');
    await waitClean(individual.identityFileId);

    // The owner can download it (personal or Provider workspace: it is theirs).
    expect(
      (
        await individual.client.get(`/files/${individual.identityFileId}/download`, {
          workspace: 'provider',
        })
      ).status,
    ).toBe(200);

    // Another individual provider, an organisation member and unelevated staff cannot.
    const other = await submittedIndividual('Nosy Neighbour');
    expect(
      (
        await other.client.get(`/files/${individual.identityFileId}/download`, {
          workspace: 'provider',
        })
      ).status,
    ).toBe(404);
    const orgTenant = await createTenant(maint);
    const member = await createLoginUser(maint);
    await grantRole(
      maint,
      await createMembership(maint, orgTenant, member.id),
      orgTenant,
      'org_employee',
    );
    const memberClient = await signIn(stack.server, maint, member);
    expect(
      (
        await memberClient.get(`/files/${individual.identityFileId}/download`, {
          workspace: orgTenant,
        })
      ).status,
    ).toBe(404);
    const unelevated = await signIn(stack.server, maint, prm);
    expect(
      (
        await unelevated.get(`/files/${individual.identityFileId}/download`, {
          workspace: platformTenant,
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await unelevated.get(`/platform/provider-applications/${individual.applicationId}`, {
          workspace: platformTenant,
        })
      ).status,
    ).toBe(403);

    // Elevated staff without provider.approve / compliance.review do not see it at all.
    const { client: ops, options: opsOptions } = await elevated(operations);
    const opsView = await ops.get(
      `/platform/provider-applications/${individual.applicationId}`,
      opsOptions,
    );
    expect(opsView.status).toBe(200);
    const opsDocuments = (opsView.body as { documents: { purpose: string }[] }).documents;
    expect(opsDocuments.map((document) => document.purpose)).toEqual(['provider.certificate']);

    // Compliance and PRM get a link, and each view is audited with the elevation reason.
    for (const staff of [compliance, prm]) {
      const { client, options } = await elevated(staff);
      const view = await client.get(
        `/platform/provider-applications/${individual.applicationId}`,
        options,
      );
      const identity = (
        view.body as { documents: { id: string; purpose: string; downloadUrl: string | null }[] }
      ).documents.find((document) => document.purpose === 'provider.identity');
      expect(identity?.downloadUrl).toEqual(expect.any(String));
    }
    const audited = await maint.query<{ actor_user_id: string; reason: string }>(
      `SELECT actor_user_id, reason FROM audit_log
        WHERE action = 'provider.identity_document_viewed' AND entity_id = $1`,
      [individual.identityFileId],
    );
    expect(audited.rows.map((row) => row.actor_user_id).sort()).toEqual(
      [compliance.id, prm.id].sort(),
    );
    expect(audited.rows.every((row) => row.reason === 'Provider vetting PRV-2026-17')).toBe(true);
  });

  it('identity documents are personal only; company documents need provider.profile.manage', async () => {
    const company = await submittedCompany('Docs Check Ltd');
    expect((await upload(company.client, company.tenantId, 'provider.identity')).body).toEqual({
      error: 'file_owner_not_allowed',
    });
    const technician = await createLoginUser(maint);
    await grantRole(
      maint,
      await createMembership(maint, company.tenantId, technician.id),
      company.tenantId,
      'provider_technician',
    );
    // Pending company → restricted; even so the technician lacks the permission.
    const techClient = await signIn(stack.server, maint, technician);
    expect((await upload(techClient, company.tenantId, 'provider.company_document')).body).toEqual({
      error: 'permission_denied',
    });
  });
});

// ---------------------------------------------------------------- D5–D7

describe('D5–D7 — technicians, isolation, multi-capacity', () => {
  it('D5: a technician acts only in the company workspace and loses access when they leave', async () => {
    const company = await submittedCompany('Technician Test Ltd');
    const { client: staff, options } = await elevated(prm);
    await staff.post(
      `/platform/provider-applications/${company.applicationId}/approve`,
      { checklist: CHECKLIST },
      options,
    );
    const technician = await createLoginUser(maint);
    const membership = await createMembership(maint, company.tenantId, technician.id);
    await grantRole(maint, membership, company.tenantId, 'provider_technician');
    const client = await signIn(stack.server, maint, technician);
    const ws = { workspace: company.tenantId };
    expect((await client.get('/provider', ws)).status).toBe(200);
    expect((await client.patch('/provider/profile', { remoteOk: true }, ws)).body).toEqual({
      error: 'permission_denied',
    });
    // Personal and Provider workspaces never carry company permissions.
    expect((await client.get('/provider')).body).toEqual({ error: 'not_a_provider_workspace' });
    expect((await client.get('/provider', { workspace: 'provider' })).status).toBe(403);
    await maint.query(`UPDATE membership SET status = 'ENDED', ended_at = now() WHERE id = $1`, [
      membership,
    ]);
    expect((await client.get('/provider', ws)).status).toBe(403);
  });

  it('D6: one individual never sees another’s profile, time off or documents; staff scope holds', async () => {
    const alice = await submittedIndividual('Alice Isolation');
    const bob = await submittedIndividual('Bob Isolation');
    const ws = { workspace: 'provider' };
    // Both are under review; put Bob back into changes-requested so he can add time off.
    const { client: staff, options } = await elevated(prm);
    await staff.post(
      `/platform/provider-applications/${bob.applicationId}/request-changes`,
      { reason: 'Please add your availability details.' },
      options,
    );
    const added = await bob.client.post(
      '/provider/time-off',
      { startsAt: '2026-12-24T00:00:00+03:00', endsAt: '2026-12-27T00:00:00+03:00' },
      ws,
    );
    expect(added.status).toBe(201);
    const timeOffId = (added.body as ProviderView).timeOff[0]?.id ?? '';

    const aliceView = (await alice.client.get('/provider', ws)).body as ProviderView;
    expect(aliceView.providerId).toBe(alice.providerId);
    expect(aliceView.documents.map((document) => document.id)).not.toContain(bob.identityFileId);
    await staff.post(
      `/platform/provider-applications/${alice.applicationId}/request-changes`,
      { reason: 'Please confirm your coverage areas.' },
      options,
    );
    expect((await alice.client.delete(`/provider/time-off/${timeOffId}`, ws)).status).toBe(404);
    expect(((await bob.client.get('/provider', ws)).body as ProviderView).timeOff).toHaveLength(1);

    // RLS: in Alice's user context, Bob's rows do not exist.
    const app = await connect('app');
    try {
      await app.query('BEGIN');
      await app.query(
        `SELECT set_config('app.user_id', $1, true), set_config('app.actor_kind', 'USER', true)`,
        [alice.user.id],
      );
      for (const table of ['provider_skill', 'provider_region', 'provider_time_off']) {
        const rows = await app.query<{ n: number }>(
          `SELECT count(*)::int AS n FROM ${table} WHERE provider_id = $1`,
          [bob.providerId],
        );
        expect(rows.rows[0]?.n, table).toBe(0);
      }
      const application = await app.query<{ n: number }>(
        'SELECT count(*)::int AS n FROM provider_application WHERE provider_id = $1',
        [bob.providerId],
      );
      expect(application.rows[0]?.n).toBe(0);
    } finally {
      await app.query('ROLLBACK');
      await app.end();
    }

    // A foreign company workspace header is refused.
    const company = await submittedCompany('Foreign Header Ltd');
    expect((await alice.client.get('/provider', { workspace: company.tenantId })).status).toBe(403);

    // An elevation scoped to another tenant sees neither individuals nor other companies.
    const otherTenant = await createTenant(maint);
    const { client: scoped, options: scopedOptions } = await elevated(prm, otherTenant);
    for (const id of [alice.applicationId, company.applicationId]) {
      expect(
        (await scoped.get(`/platform/provider-applications/${id}`, scopedOptions)).status,
      ).toBe(404);
    }
    expect(
      (
        await scoped.post(
          `/platform/providers/${company.providerId}/suspend`,
          { reason: 'Scoped elevation must not reach this.' },
          scopedOptions,
        )
      ).status,
    ).toBe(404);
    expect((await staff.get(`/platform/provider-applications/${FOREIGN_ID}`, options)).status).toBe(
      404,
    );
  });

  it('D7: an employee, individual provider and technician switches capacities without crossing data', async () => {
    const person = await createLoginUser(maint);
    const organisation = await createTenant(maint);
    await grantRole(
      maint,
      await createMembership(maint, organisation, person.id),
      organisation,
      'org_employee',
    );
    const company = await seedProvider({ kind: 'COMPANY', name: 'Capacity Co' });
    const companyTenant =
      (
        await maint.query<{ tenant_id: string }>('SELECT tenant_id FROM provider WHERE id = $1', [
          company,
        ])
      ).rows[0]?.tenant_id ?? '';
    await grantRole(
      maint,
      await createMembership(maint, companyTenant, person.id),
      companyTenant,
      'provider_technician',
    );
    const client = await signIn(stack.server, maint, person);
    const own = (await client.post('/providers/me', { displayName: 'Multi Capacity' })).body as {
      providerId: string;
    };

    const list = (await client.get('/me/workspaces')).body as {
      workspaces: { tenantId: string }[];
      provider: { providerId: string } | null;
    };
    expect(list.workspaces.map((workspace) => workspace.tenantId)).toEqual(
      expect.arrayContaining([organisation, companyTenant]),
    );
    expect(list.provider?.providerId).toBe(own.providerId);

    const asIndividual = (await client.get('/provider', { workspace: 'provider' }))
      .body as ProviderView;
    const asTechnician = (await client.get('/provider', { workspace: companyTenant }))
      .body as ProviderView;
    expect(asIndividual).toMatchObject({ providerId: own.providerId, kind: 'INDIVIDUAL' });
    expect(asTechnician).toMatchObject({ providerId: company, kind: 'COMPANY' });
    expect((await client.get('/provider', { workspace: organisation })).body).toEqual({
      error: 'not_a_provider_workspace',
    });
    // Editing as an individual never touches the company, and the technician cannot edit it.
    await client.put('/provider/regions', { regionCodes: ['KE-01'] }, { workspace: 'provider' });
    const companyRegions = await maint.query<{ region_code: string }>(
      'SELECT region_code FROM provider_region WHERE provider_id = $1',
      [company],
    );
    expect(companyRegions.rows.map((row) => row.region_code)).toEqual(['KE-30']);
    expect(
      (
        await client.put(
          '/provider/regions',
          { regionCodes: ['KE-01'] },
          { workspace: companyTenant },
        )
      ).status,
    ).toBe(403);
    // The organisation workspace still has the employee's view, nothing more.
    expect((await client.get('/workspace', { workspace: organisation })).body).toMatchObject({
      kind: 'ORGANISATION',
      roles: ['org_employee'],
    });
  });
});

// ---------------------------------------------------------------- D8

describe('D8 — availability is evaluated in Africa/Nairobi', () => {
  it('weekly hours: boundaries, the midnight edge and the end of the year', async () => {
    const skill = await testSkill();
    const weekday = await seedProvider({
      name: 'Monday 08-17',
      skills: [[skill, 'YEARS_1_3']],
      hours: [[1, 8 * 60, 17 * 60]],
    });
    const lateSunday = await seedProvider({
      name: 'Sunday 22-24',
      skills: [[skill, 'YEARS_1_3']],
      hours: [[7, 22 * 60, 1440]],
    });
    const newYear = await seedProvider({
      name: 'Friday 00-02',
      skills: [[skill, 'YEARS_1_3']],
      hours: [[5, 0, 120]],
    });
    const holiday = await seedProvider({
      name: 'Friday 00-02 on holiday',
      skills: [[skill, 'YEARS_1_3']],
      hours: [[5, 0, 120]],
      timeOff: [['2026-12-24T00:00:00+03:00', '2027-01-02T00:00:00+03:00']],
    });
    const at = async (instant: string) =>
      (await eligible({ skills: skill, region: 'KE-30', at: instant }))
        .map((candidate) => candidate.providerId)
        .sort();
    const cases: [string, string[]][] = [
      ['2026-11-09T04:59:00Z', []], // Mon 07:59 Nairobi
      ['2026-11-09T05:00:00Z', [weekday]], // Mon 08:00 (start inclusive)
      ['2026-11-09T13:59:00Z', [weekday]], // Mon 16:59
      ['2026-11-09T14:00:00Z', []], // Mon 17:00 (end exclusive)
      ['2026-11-08T20:59:00Z', [lateSunday]], // Sun 23:59 Nairobi (still Sunday in UTC too)
      ['2026-11-08T21:00:00Z', []], // Mon 00:00 Nairobi, while UTC says Sunday 21:00
      ['2026-11-08T19:30:00Z', [lateSunday]], // Sun 22:30 Nairobi
      ['2026-12-31T21:30:00Z', [newYear]], // Fri 1 Jan 2027 00:30 Nairobi; UTC is Thursday
      ['2027-01-01T23:00:00Z', []], // Sat 2 Jan 02:00 Nairobi
      ['2027-01-07T22:00:00Z', [holiday, newYear].sort()], // Fri 8 Jan 01:00, holiday over
    ];
    for (const [instant, expected] of cases) {
      expect(await at(instant), instant).toEqual(expected);
    }
  });
});

// ---------------------------------------------------------------- D9

describe('D9 — skills and regions taxonomies', () => {
  it('only catalogue managers change skills; deactivating hides without breaking profiles', async () => {
    const code = `d9_${randomUUID().replace(/-/g, '').slice(0, 10)}`;
    const { client: prmClient, options: prmOptions } = await elevated(prm);
    expect(
      (
        await prmClient.post(
          '/platform/skills',
          { code, name: 'Solar inverter repair', category: 'Power' },
          prmOptions,
        )
      ).status,
    ).toBe(403);
    const { client: manager, options } = await elevated(serviceManager);
    expect(
      (
        await manager.post(
          '/platform/skills',
          { code, name: 'Solar inverter repair', category: 'Power' },
          options,
        )
      ).status,
    ).toBe(204);
    expect(
      (
        await manager.post(
          '/platform/skills',
          { code, name: 'Duplicate', category: 'Power' },
          options,
        )
      ).body,
    ).toEqual({ error: 'skill_exists' });

    const user = await createLoginUser(maint);
    const client = await signIn(stack.server, maint, user);
    const listed = async () =>
      ((await client.get('/reference/skills')).body as { skills: { code: string }[] }).skills.map(
        (skill) => skill.code,
      );
    expect(await listed()).toContain(code);
    const regions = (await client.get('/reference/regions')).body as {
      regions: { code: string }[];
    };
    expect(regions.regions).toHaveLength(47);

    await client.post('/providers/me', { displayName: 'Solar Sally' });
    const ws = { workspace: 'provider' };
    expect(
      (await client.put('/provider/skills', { skills: [{ code, experience: 'YEARS_3_5' }] }, ws))
        .status,
    ).toBe(200);

    expect(
      (await manager.patch(`/platform/skills/${code}`, { active: false }, options)).status,
    ).toBe(204);
    expect(await listed()).not.toContain(code);
    const staffList = (await manager.get('/platform/skills', options)).body as {
      skills: { code: string; active: boolean }[];
    };
    expect(staffList.skills.find((skill) => skill.code === code)).toMatchObject({ active: false });
    // Existing profiles keep it; new selections cannot pick it.
    expect(((await client.get('/provider', ws)).body as ProviderView).skills).toEqual([
      expect.objectContaining({ code }),
    ]);
    expect(
      (await client.put('/provider/skills', { skills: [{ code, experience: 'YEARS_3_5' }] }, ws))
        .body,
    ).toEqual({ error: 'skill_unknown' });

    // The database refuses skill writes outside the catalogue job or platform context.
    const app = await connect('app');
    try {
      await app.query('BEGIN');
      await app.query(
        `SELECT set_config('app.user_id', $1, true), set_config('app.actor_kind', 'USER', true)`,
        [user.id],
      );
      await expect(
        app.query(`INSERT INTO skill (code, name, category) VALUES ('rogue_skill', 'x', 'x')`),
      ).rejects.toThrow(/row-level security/);
      await app.query('ROLLBACK');
      await app.query('BEGIN');
      await app.query(
        `SELECT set_config('app.user_id', $1, true), set_config('app.actor_kind', 'USER', true)`,
        [user.id],
      );
      const updated = await app.query(
        `UPDATE skill SET name = 'Hijacked' WHERE code = 'networking'`,
      );
      expect(updated.rowCount).toBe(0);
    } finally {
      await app.query('ROLLBACK');
      await app.end();
    }
    const audit = await maint.query<{ action: string }>(
      `SELECT action FROM audit_log WHERE entity_type = 'skill' AND entity_id = $1 ORDER BY occurred_at`,
      [code],
    );
    expect(audit.rows.map((row) => row.action)).toEqual([
      'catalogue.skill_created',
      'catalogue.skill_updated',
    ]);
  });
});
