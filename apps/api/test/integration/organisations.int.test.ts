import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AccessRouteCheck } from '../../src/access/access-route-check.js';
import { CATALOGUE } from '../../src/authz/catalogue.js';
import {
  Client,
  createLoginUser,
  grantRole,
  signIn,
  startStack,
  uniqueEmail,
  waitForMail,
  type FixtureUser,
  type Stack,
} from './http-harness.js';
import { connect, createMembership, createTenant } from './support.js';

const PDF = Buffer.from('%PDF-1.4\n1 0 obj << >> endobj\ntrailer << >>\n%%EOF\n');
const COMPLETE_PROFILE = {
  registrationNumber: 'PVT-2026-1234',
  kraPin: 'P051234567X',
  region: 'Nairobi',
  address: 'Kenyatta Avenue, Nairobi',
  phone: '+254712345678',
  contactEmail: 'office@example.test',
};

const organisationPermissions = new Set(
  CATALOGUE.permissions.filter((p) => p.kinds.includes('ORGANISATION')).map((p) => p.code),
);

let stack: Stack;
let maint: pg.Client;
let platformTenant: string;
let reviewer: FixtureUser;

beforeAll(async () => {
  stack = await startStack();
  maint = await connect('maint');
  const existing = await maint.query<{ id: string }>(
    `SELECT id FROM tenant WHERE kind = 'PLATFORM'`,
  );
  platformTenant = existing.rows[0]?.id ?? (await createTenant(maint, { kind: 'PLATFORM' }));
  reviewer = await createStaff('provider_relationship_manager');
});

afterAll(async () => {
  await maint.end();
  await stack.close();
});

async function createStaff(roleCode: string): Promise<FixtureUser> {
  const staff = await createLoginUser(maint, { mfa: true });
  const membership = await createMembership(maint, platformTenant, staff.id);
  await grantRole(maint, membership, platformTenant, roleCode);
  return staff;
}

/** Signs staff in and opens an elevation; returns options for elevated calls. */
async function elevated(staff: FixtureUser) {
  const client = await signIn(stack.server, maint, staff);
  const response = await client.post(
    '/platform/elevate',
    { reason: 'Organisation application review' },
    { workspace: platformTenant },
  );
  expect(response.status).toBe(201);
  const { elevationId } = response.body as { elevationId: string };
  const options = { workspace: platformTenant, headers: { 'X-OGS-Elevation': elevationId } };
  return { client, options };
}

async function apply(user: FixtureUser, legalName = 'Kilimo Tech Ltd') {
  const client = await signIn(stack.server, maint, user);
  const response = await client.post('/organisations', { legalName });
  expect(response.status).toBe(201);
  const { tenantId, applicationId } = response.body as { tenantId: string; applicationId: string };
  return { client, tenantId, applicationId };
}

async function upload(
  client: Client,
  workspace: string,
  purpose = 'organisation.document',
  bytes = PDF,
) {
  return client.agent
    .post('/api/v1/files')
    .set('X-Forwarded-For', client.ip)
    .set('X-CSRF-Token', client.csrf ?? '')
    .set('X-OGS-Workspace', workspace)
    .field('purpose', purpose)
    .attach('file', bytes, 'certificate.pdf');
}

async function completeAndSubmit(client: Client, tenantId: string) {
  expect(
    (await client.post('/organisation/application/submit', {}, { workspace: tenantId })).body,
  ).toEqual({
    error: 'application_incomplete',
  });
  expect((await upload(client, tenantId)).status).toBe(201);
  const patched = await client.agent
    .patch('/api/v1/organisation/profile')
    .set('X-Forwarded-For', client.ip)
    .set('X-CSRF-Token', client.csrf ?? '')
    .set('X-OGS-Workspace', tenantId)
    .send(COMPLETE_PROFILE);
  expect(patched.status).toBe(200);
  expect((patched.body as { missing: string[] }).missing).toEqual([]);
  const submitted = await client.post(
    '/organisation/application/submit',
    {},
    { workspace: tenantId },
  );
  expect(submitted.status).toBe(200);
  expect(submitted.body).toMatchObject({ status: 'SUBMITTED' });
}

describe('C1 — a pending organisation can reach nothing operational', () => {
  it('every permission route outside the application answers workspace_restricted', async () => {
    const applicant = await createLoginUser(maint);
    const { client, tenantId } = await apply(applicant, 'Pending Holdings Ltd');

    const routes = stack.app
      .get(AccessRouteCheck)
      .routes()
      .filter((route) => route.rule?.kind === 'permission' && !route.rule.allowRestricted);
    expect(routes.length).toBeGreaterThan(10);

    for (const route of routes) {
      const path = route.path.replace(/:[A-Za-z]+/g, '01930000-0000-7000-8000-00000000abcd');
      const request = client.agent[
        route.method.toLowerCase() as 'get' | 'post' | 'put' | 'patch' | 'delete'
      ](`/api/v1${path}`)
        .set('X-Forwarded-For', client.ip)
        .set('X-OGS-Workspace', tenantId);
      const response =
        route.method === 'GET'
          ? await request
          : await request.set('X-CSRF-Token', client.csrf ?? '').send({});
      const label = `${route.method} ${route.path}`;
      const error = (response.body as { error: string }).error;
      expect(response.status, label).toBe(403);
      if (route.rule?.kind === 'permission' && organisationPermissions.has(route.rule.code)) {
        // The applicant is org_admin and holds this permission: only the status gate stops it.
        expect(error, label).toBe('workspace_restricted');
      } else {
        // Platform or provider permissions: refused earlier (permission, MFA or step-up).
        expect(
          ['permission_denied', 'mfa_enrollment_required', 'step_up_required'],
          label,
        ).toContain(error);
      }
    }
    // …while the application itself stays reachable, without MFA (P4-1).
    expect(
      (await client.get('/organisation/application', { workspace: tenantId })).body,
    ).toMatchObject({
      status: 'DRAFT',
      missing: expect.arrayContaining(['documents', 'kraPin']) as unknown,
    });
  });

  it('cannot change its own tenant or application status by any route', async () => {
    const applicant = await createLoginUser(maint);
    const { tenantId } = await apply(applicant);
    const app = await connect('app');
    try {
      await app.query('BEGIN');
      await app.query(
        `SELECT set_config('app.user_id', $1, true), set_config('app.tenant_id', $2, true),
                set_config('app.actor_kind', 'USER', true)`,
        [applicant.id, tenantId],
      );
      await expect(
        app.query(`UPDATE tenant SET status = 'ACTIVE' WHERE id = $1`, [tenantId]),
      ).rejects.toThrow(/platform review/);
    } finally {
      await app.query('ROLLBACK');
      await app.end();
    }
  });
});

describe('C2/C3 — application lifecycle and platform review', () => {
  it('draft → submit → changes requested → resubmit → approved, all audited and emailed', async () => {
    const applicant = await createLoginUser(maint);
    const { client, tenantId, applicationId } = await apply(applicant, 'Mto Logistics Ltd');
    await completeAndSubmit(client, tenantId);
    expect(
      (await client.post('/organisation/application/submit', {}, { workspace: tenantId })).body,
    ).toEqual({
      error: 'invalid_transition',
    });
    const locked = await client.agent
      .patch('/api/v1/organisation/profile')
      .set('X-Forwarded-For', client.ip)
      .set('X-CSRF-Token', client.csrf ?? '')
      .set('X-OGS-Workspace', tenantId)
      .send({ region: 'Mombasa' });
    expect(locked.body).toEqual({ error: 'application_locked' });

    // Without an elevation nothing is visible.
    const plain = await signIn(stack.server, maint, reviewer);
    expect((await plain.get('/platform/applications', { workspace: platformTenant })).body).toEqual(
      {
        error: 'elevation_required',
      },
    );

    const { client: staff, options } = await elevated(reviewer);
    const queue = (await staff.get('/platform/applications', options)).body as {
      applications: { applicationId: string; applicantEmail: string }[];
    };
    expect(queue.applications).toContainEqual(
      expect.objectContaining({ applicationId, applicantEmail: applicant.email }),
    );
    const detail = await staff.get(`/platform/applications/${applicationId}`, options);
    expect(detail.body).toMatchObject({
      profile: { legalName: 'Mto Logistics Ltd' },
      documents: [{}],
    });

    expect(
      (
        await staff.post(
          `/platform/applications/${applicationId}/request-changes`,
          { reason: 'x' },
          options,
        )
      ).body,
    ).toMatchObject({
      error: 'invalid_request',
    });
    expect(
      (
        await staff.post(
          `/platform/applications/${applicationId}/request-changes`,
          { reason: 'Upload the KRA PIN certificate too.' },
          options,
        )
      ).status,
    ).toBe(204);
    const changes = await waitForMail(applicant.email, /needs changes/);
    expect(changes.text).toContain('Upload the KRA PIN certificate too.');

    expect((await upload(client, tenantId)).status).toBe(201);
    expect(
      (await client.post('/organisation/application/submit', {}, { workspace: tenantId })).status,
    ).toBe(200);
    expect(
      (await staff.post(`/platform/applications/${applicationId}/approve`, {}, options)).status,
    ).toBe(204);
    await waitForMail(applicant.email, /is approved on OGS/);

    const view = await client.get('/organisation/application', { workspace: tenantId });
    // The applicant is now admin of an ACTIVE organisation: MFA is mandatory (P4-1).
    expect(view.body).toEqual({ error: 'mfa_enrollment_required' });

    const { rows } = await maint.query<{ to_status: string }>(
      'SELECT to_status FROM organisation_application_event WHERE application_id = $1 ORDER BY occurred_at, id',
      [applicationId],
    );
    expect(rows.map((row) => row.to_status)).toEqual([
      'DRAFT',
      'SUBMITTED',
      'CHANGES_REQUESTED',
      'SUBMITTED',
      'APPROVED',
    ]);
    const tenant = await maint.query<{ status: string }>(
      'SELECT status FROM tenant WHERE id = $1',
      [tenantId],
    );
    expect(tenant.rows[0]?.status).toBe('ACTIVE');
    const audit = await maint.query<{ action: string }>(
      `SELECT action FROM audit_log WHERE tenant_id = $1 ORDER BY occurred_at`,
      [tenantId],
    );
    expect(audit.rows.map((row) => row.action)).toEqual(
      expect.arrayContaining([
        'organisation.registered',
        'organisation.application_submitted',
        'organisation.application_changes_requested',
        'organisation.application_approved',
      ]),
    );
  });

  it('rejection is final, needs a reason, and cannot be self-approved', async () => {
    // A reviewer who applies for their own organisation cannot decide it.
    const { client, tenantId, applicationId } = await apply(reviewer, 'Reviewer Side Ltd');
    await completeAndSubmit(client, tenantId);
    const { client: staff, options } = await elevated(reviewer);
    expect(
      (await staff.post(`/platform/applications/${applicationId}/approve`, {}, options)).body,
    ).toEqual({
      error: 'cannot_decide_own_application',
    });

    const other = await createStaff('provider_relationship_manager');
    const { client: otherStaff, options: otherOptions } = await elevated(other);
    expect(
      (await otherStaff.post(`/platform/applications/${applicationId}/reject`, {}, otherOptions))
        .status,
    ).toBe(400);
    expect(
      (
        await otherStaff.post(
          `/platform/applications/${applicationId}/reject`,
          { reason: 'Business registration could not be verified.' },
          otherOptions,
        )
      ).status,
    ).toBe(204);
    expect(
      (await otherStaff.post(`/platform/applications/${applicationId}/approve`, {}, otherOptions))
        .body,
    ).toEqual({
      error: 'invalid_transition',
    });
    const tenant = await maint.query<{ status: string }>(
      'SELECT status FROM tenant WHERE id = $1',
      [tenantId],
    );
    expect(tenant.rows[0]?.status).toBe('REJECTED');
  });

  it('a reviewer without platform.tenant.approve can read but not decide', async () => {
    const applicant = await createLoginUser(maint);
    const { client, tenantId, applicationId } = await apply(applicant);
    await completeAndSubmit(client, tenantId);
    const compliance = await createStaff('compliance');
    const { client: staff, options } = await elevated(compliance);
    expect((await staff.get(`/platform/applications/${applicationId}`, options)).status).toBe(200);
    expect(
      (await staff.post(`/platform/applications/${applicationId}/approve`, {}, options)).body,
    ).toEqual({
      error: 'permission_denied',
    });
  });

  it('suspension restricts the organisation until reactivated; admins are emailed', async () => {
    const tenantId = await createTenant(maint);
    const admin = await createLoginUser(maint, { mfa: true });
    const membership = await createMembership(maint, tenantId, admin.id);
    await grantRole(maint, membership, tenantId, 'org_admin');
    const member = await signIn(stack.server, maint, admin);
    const { client: staff, options } = await elevated(reviewer);

    expect(
      (
        await staff.post(
          `/platform/tenants/${tenantId}/suspend`,
          { reason: 'Unpaid invoices under review.' },
          options,
        )
      ).status,
    ).toBe(204);
    expect((await member.get('/workspace/members', { workspace: tenantId })).body).toEqual({
      error: 'workspace_restricted',
    });
    await waitForMail(admin.email, /has been suspended/);
    expect(
      (
        await staff.post(
          `/platform/tenants/${tenantId}/suspend`,
          { reason: 'Unpaid invoices under review.' },
          options,
        )
      ).body,
    ).toEqual({
      error: 'invalid_transition',
    });
    expect(
      (
        await staff.post(
          `/platform/tenants/${tenantId}/reactivate`,
          { reason: 'Invoices settled in full.' },
          options,
        )
      ).status,
    ).toBe(204);
    expect((await member.get('/workspace/members', { workspace: tenantId })).status).toBe(200);
  });
});

describe('C9 — file upload over HTTP', () => {
  it('enforces owner, size and quarantine rules; another tenant gets 404', async () => {
    const user = await createLoginUser(maint);
    const client = await signIn(stack.server, maint, user);

    expect((await upload(client, 'personal')).body).toEqual({ error: 'file_owner_not_allowed' });
    const huge = Buffer.concat([PDF, Buffer.alloc(10 * 1024 * 1024)]);
    expect((await upload(client, 'personal', 'provider.document', huge)).status).toBe(413);

    const stored = await upload(client, 'personal', 'provider.document');
    expect(stored.status).toBe(201);
    const fileId = (stored.body as { id: string }).id;

    // The worker scans it shortly; until then it is not downloadable.
    let download = await client.get(`/files/${fileId}/download`, { workspace: 'personal' });
    for (let i = 0; i < 50 && download.status === 409; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      download = await client.get(`/files/${fileId}/download`, { workspace: 'personal' });
    }
    expect(download.status).toBe(200);
    expect((download.body as { expiresInSeconds: number }).expiresInSeconds).toBe(60);

    const stranger = await signIn(stack.server, maint, await createLoginUser(maint));
    expect(
      (await stranger.get(`/files/${fileId}/download`, { workspace: 'personal' })).status,
    ).toBe(404);
  });

  it('a JSON-only route still refuses multipart bodies', async () => {
    const client = await signIn(stack.server, maint, await createLoginUser(maint));
    const response = await client.agent
      .post('/api/v1/organisations')
      .set('X-CSRF-Token', client.csrf ?? '')
      .field('legalName', 'Form Post Ltd');
    expect(response.status).toBe(415);
  });

  it('a pending organisation can only upload application evidence', async () => {
    const { client, tenantId } = await apply(await createLoginUser(maint));
    expect((await upload(client, tenantId, 'ticket.attachment')).body).toEqual({
      error: 'workspace_restricted',
    });
    expect((await upload(client, tenantId)).status).toBe(201);
  });
});

describe('registration input', () => {
  it('validates Kenyan identifiers and phone numbers', async () => {
    const client = await signIn(stack.server, maint, await createLoginUser(maint));
    const response = await client.post('/organisations', {
      legalName: 'Bad Input Ltd',
      kraPin: '12345',
      phone: '0712345678',
      contactEmail: uniqueEmail(),
    });
    expect(response.body).toEqual({ error: 'invalid_request', fields: ['kraPin', 'phone'] });
  });
});
