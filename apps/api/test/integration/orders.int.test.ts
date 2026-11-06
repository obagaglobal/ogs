import { randomUUID } from 'node:crypto';
import type { ServiceRequest } from '@ogs/contracts';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { QuotationExpiryService } from '../../src/orders/quotation-expiry.service.js';
import { ORDER_TRANSITIONS, REQUEST_TRANSITIONS } from '../../src/orders/transitions.js';
import {
  Client,
  createLoginUser,
  grantRole,
  mailsTo,
  signIn,
  startStack,
  waitForMail,
  maintAsPlatform,
  type FixtureUser,
  type Stack,
} from './http-harness.js';
import { attempt, connect, createMembership, createTenant } from './support.js';

/**
 * Phase 7 — requests, quotations, orders and payments: F1–F9 of the plan.
 */
let stack: Stack;
let maint: pg.Client;
let platformTenant: string;
let sales: FixtureUser; // service_manager: platform.quotation.issue
let finance: FixtureUser; // finance: platform.finance.manage

interface Catalogue {
  fixed: string;
  fixedPriceId: string;
  /** Its catalogue price is changed by F3; nothing else may depend on it. */
  snapshot: string;
  snapshotPriceId: string;
  perUnit: string;
  quoteOnly: string;
  orgOnly: string;
  retired: string;
}
let cat: Catalogue;

interface Org {
  tenantId: string;
  admin: FixtureUser;
  employee: FixtureUser;
  adminClient: Client;
  employeeClient: Client;
}

const t = () => randomUUID().replace(/-/g, '').slice(0, 10);

beforeAll(async () => {
  stack = await startStack();
  maint = await connect('maint');
  const existing = await maint.query<{ id: string }>(
    `SELECT id FROM tenant WHERE kind = 'PLATFORM'`,
  );
  platformTenant = existing.rows[0]?.id ?? (await createTenant(maint, { kind: 'PLATFORM' }));
  sales = await createStaff('service_manager');
  finance = await createStaff('finance');
  cat = await createCatalogue();
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

async function createCatalogue(): Promise<Catalogue> {
  const k = t();
  const category = await maint.query<{ id: string }>(
    `INSERT INTO service_category (slug, name) VALUES ($1, 'Orders test') RETURNING id`,
    [`orders-${k}`],
  );
  const categoryId = category.rows[0]?.id ?? '';
  const service = async (
    slug: string,
    price: [string, number | null, string | null, number],
    options: { audience?: string; status?: string } = {},
  ) => {
    const status = options.status ?? 'PUBLISHED';
    const row = await maint.query<{ id: string }>(
      `INSERT INTO service (slug, category_id, name, summary, description, audience, status, published_at, retired_at)
       VALUES ($1, $2, $3, 'Summary', 'Description', $4::"ServiceAudience", $5::"ServiceStatus",
         CASE WHEN $5::"ServiceStatus" <> 'DRAFT' THEN now() END,
         CASE WHEN $5::"ServiceStatus" = 'RETIRED' THEN now() END) RETURNING id`,
      [`${slug}-${k}`, categoryId, `Service ${slug}`, options.audience ?? 'ALL', status],
    );
    const id = row.rows[0]?.id ?? '';
    const [model, amount, unit, min] = price;
    const priceRow = await maint.query<{ id: string }>(
      `INSERT INTO service_price (service_id, model, amount_minor, unit, min_quantity)
       VALUES ($1, $2::"PriceModel", $3, $4::"PriceUnit", $5) RETURNING id`,
      [id, model, amount, unit, min],
    );
    return { slug: `${slug}-${k}`, id, priceId: priceRow.rows[0]?.id ?? '' };
  };
  const fixed = await service('fixed', ['FIXED', 350_000, null, 1]);
  const snapshot = await service('snapshot', ['FIXED', 350_000, null, 1]);
  return {
    fixed: fixed.slug,
    fixedPriceId: fixed.priceId,
    snapshot: snapshot.slug,
    snapshotPriceId: snapshot.priceId,
    perUnit: (await service('per-unit', ['PER_UNIT', 120_000, 'DEVICE', 5])).slug,
    quoteOnly: (await service('quote', ['QUOTE', null, null, 1])).slug,
    orgOnly: (await service('org-only', ['FIXED', 900_000, null, 1], { audience: 'ORGANISATIONS' }))
      .slug,
    retired: (await service('retired', ['FIXED', 100_000, null, 1], { status: 'RETIRED' })).slug,
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
        { reason: 'Order desk ORD-OPS-2026' },
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

const requestBody = (serviceSlug: string, extra: Record<string, unknown> = {}) => ({
  serviceSlug,
  county: 'KE-30',
  address: 'Ngong Road, Nairobi',
  contactPhone: '+254712345678',
  ...extra,
});

async function submit(
  client: Client,
  body: Record<string, unknown>,
  workspace = 'personal',
  key: string = randomUUID(),
) {
  return client.post('/requests', body, { workspace, headers: { 'Idempotency-Key': key } });
}

async function submitted(
  client: Client,
  slug: string,
  workspace = 'personal',
): Promise<ServiceRequest> {
  const response = await submit(client, requestBody(slug), workspace);
  expect(response.status, JSON.stringify(response.body)).toBe(201);
  return response.body as ServiceRequest;
}

async function staffCall(path: string, body: unknown, staff: FixtureUser = sales) {
  const { client, options } = await elevated(staff);
  return client.post(path, body, options);
}

async function staffView(id: string): Promise<ServiceRequest> {
  const { client, options } = await elevated(sales);
  return (await client.get(`/platform/requests/${id}`, options)).body as ServiceRequest;
}

/** Quotation path up to an issued quotation; returns the request and quotation. */
async function issuedQuotation(
  client: Client,
  workspace = 'personal',
  lines = [{ description: 'Survey and cabling', quantity: 2, unitAmountMinor: 1_000_050 }],
) {
  const request = await submitted(client, cat.quoteOnly, workspace);
  await staffCall(`/platform/requests/${request.id}/review`, { version: request.version });
  const reviewed = await staffView(request.id);
  await staffCall(`/platform/requests/${request.id}/needs-quotation`, {
    version: reviewed.version,
  });
  const { client: s, options } = await elevated(sales);
  const draft = (
    await s.put(`/platform/requests/${request.id}/quotation`, { lines, validDays: 14 }, options)
  ).body as ServiceRequest;
  const quotation = draft.quotations[0];
  const issued = await staffCall(
    `/platform/requests/${request.id}/quotations/${quotation?.id ?? ''}/issue`,
    {
      version: quotation?.version,
    },
  );
  expect(issued.status, JSON.stringify(issued.body)).toBe(200);
  const view = issued.body as ServiceRequest;
  return { request: view, quotation: view.quotations[0] };
}

let counter = 0;
/** Writes a request straight into any state (as ogs_maint) for the transition table. */
async function requestInState(owner: string, status: string): Promise<string> {
  counter += 1;
  const number = `REQ-2099-${String(900_000 + counter + Math.floor(Math.random() * 90_000)).slice(-6)}`;
  const row = await maint.query<{ id: string }>(
    `INSERT INTO service_request (number, customer_user_id, created_by, service_id, service_price_id, service_name,
       price_model, unit_amount_minor, county, address, contact_phone, status, cancel_reason)
     SELECT $1, $2, $2, s.service_id, s.id, 'Fixture', 'FIXED', 350000, 'KE-30', 'Fixture road', '+254700000000',
            $3::"RequestStatus", CASE WHEN $3 = 'CANCELLED' THEN 'Fixture' END
       FROM service_price s WHERE s.id = $4 RETURNING id`,
    [number, owner, status, cat.fixedPriceId],
  );
  return row.rows[0]?.id ?? '';
}

async function quotationFor(
  requestId: string,
  status: string,
  expiresInMs = 86_400_000,
): Promise<string> {
  counter += 1;
  const number = `QUO-2099-${String(900_000 + counter + Math.floor(Math.random() * 90_000)).slice(-6)}`;
  const row = await maint.query<{ id: string }>(
    `INSERT INTO quotation (number, request_id, revision, status, subtotal_minor, vat_minor, total_minor,
       issued_at, expires_at, created_by)
     SELECT $1, $2, coalesce(max(revision), 0) + 1, $3::"QuotationStatus", 100000, 16000, 116000,
            CASE WHEN $3 <> 'DRAFT' THEN now() END,
            CASE WHEN $3 <> 'DRAFT' THEN now() + ($4 || ' milliseconds')::interval END, $5
       FROM quotation WHERE request_id = $2 RETURNING id`,
    [number, requestId, status, String(expiresInMs), sales.id],
  );
  const id = row.rows[0]?.id ?? '';
  if (status === 'DRAFT') {
    await maint.query(
      `INSERT INTO quotation_line (quotation_id, position, description, quantity, unit_amount_minor, net_minor, vat_minor, total_minor)
       VALUES ($1, 1, 'Line', 1, 100000, 100000, 16000, 116000)`,
      [id],
    );
  }
  return id;
}

async function historyCount(requestId: string): Promise<number> {
  const rows = await maint.query<{ n: number }>(
    'SELECT count(*)::int AS n FROM service_request_event WHERE request_id = $1',
    [requestId],
  );
  return rows.rows[0]?.n ?? -1;
}

async function statusOf(requestId: string): Promise<string> {
  const rows = await maint.query<{ status: string }>(
    'SELECT status FROM service_request WHERE id = $1',
    [requestId],
  );
  return rows.rows[0]?.status ?? '';
}

// ---------------------------------------------------------------- F1

describe('F1 — every transition, allowed and refused, writes exactly one history row', () => {
  const STATES = [
    'SUBMITTED',
    'UNDER_REVIEW',
    'AWAITING_QUOTATION',
    'QUOTATION_ISSUED',
    'ORDERED',
    'CANCELLED',
  ];

  it('request commands × request states', async () => {
    const { user, client } = await person();
    const results: string[] = [];
    for (const state of STATES) {
      for (const command of Object.keys(
        REQUEST_TRANSITIONS,
      ) as (keyof typeof REQUEST_TRANSITIONS)[]) {
        const transition = REQUEST_TRANSITIONS[command];
        const allowed = (transition.from as readonly string[]).includes(state);
        const id = await requestInState(user.id, state);
        const quotation =
          command === 'issueQuotation'
            ? await quotationFor(id, 'DRAFT')
            : command === 'expireQuotation'
              ? await quotationFor(id, 'ISSUED', -1_000)
              : ['acceptQuotation', 'rejectQuotation'].includes(command)
                ? await quotationFor(id, 'ISSUED')
                : '';
        const before = await historyCount(id);
        let status = 0;
        switch (command) {
          case 'review':
          case 'accept':
            status = (await staffCall(`/platform/requests/${id}/${command}`, { version: 0 }))
              .status;
            break;
          case 'needsQuotation':
            status = (await staffCall(`/platform/requests/${id}/needs-quotation`, { version: 0 }))
              .status;
            break;
          case 'staffCancel':
            status = (
              await staffCall(`/platform/requests/${id}/cancel`, {
                version: 0,
                reason: 'Staff cancel',
              })
            ).status;
            break;
          case 'issueQuotation':
            status = (
              await staffCall(`/platform/requests/${id}/quotations/${quotation}/issue`, {
                version: 0,
              })
            ).status;
            break;
          case 'acceptQuotation':
            status = (
              await client.post(
                `/requests/${id}/quotations/${quotation}/accept`,
                { version: 0 },
                { workspace: 'personal', headers: { 'Idempotency-Key': randomUUID() } },
              )
            ).status;
            break;
          case 'rejectQuotation':
            status = (
              await client.post(
                `/requests/${id}/quotations/${quotation}/reject`,
                { version: 0, reason: 'Too costly' },
                { workspace: 'personal' },
              )
            ).status;
            break;
          case 'cancel':
            status = (
              await client.post(
                `/requests/${id}/cancel`,
                { version: 0, reason: 'Changed my mind' },
                { workspace: 'personal' },
              )
            ).status;
            break;
          case 'expireQuotation':
            await stack.worker.get(QuotationExpiryService).expire(quotation);
            status = (await statusOf(id)) === transition.to && state !== transition.to ? 200 : 409;
            break;
        }
        const after = await historyCount(id);
        const label = `${command} from ${state}`;
        if (allowed) {
          if (status !== 200 || after !== before + 1 || (await statusOf(id)) !== transition.to) {
            results.push(
              `${label}: expected success, got ${String(status)}, history +${String(after - before)}`,
            );
          }
        } else if (
          (status !== 409 && status !== 403) ||
          after !== before ||
          (await statusOf(id)) !== state
        ) {
          results.push(
            `${label}: expected refusal, got ${String(status)}, history +${String(after - before)}`,
          );
        }
      }
    }
    expect(results).toEqual([]);
  }, 240_000);

  it('order commands × order states', async () => {
    const { user, client } = await person();
    const results: string[] = [];
    for (const state of ['AWAITING_PAYMENT', 'PAID', 'READY_FOR_ASSIGNMENT', 'CANCELLED']) {
      for (const command of ['cancel', 'staffCancel', 'completePayment'] as const) {
        const requestId = await requestInState(user.id, 'ORDERED');
        counter += 1;
        const paid = state === 'PAID' || state === 'READY_FOR_ASSIGNMENT' ? 406_000 : 0;
        const order = (await maintAsPlatform(
          maint,
          `INSERT INTO service_order (number, request_id, customer_user_id, payment_terms, subtotal_minor, vat_minor,
             total_minor, paid_minor, status, cancel_reason)
           VALUES ($1, $2, $3, 'PREPAY', 350000, 56000, 406000, $4, $5::"OrderStatus",
             CASE WHEN $5 = 'CANCELLED' THEN 'Fixture' END) RETURNING id`,
          [
            `ORD-2099-${String(100_000 + counter + Math.floor(Math.random() * 800_000)).slice(-6)}`,
            requestId,
            user.id,
            paid,
            state,
          ],
        )) as { rows: { id: string }[] };
        const orderId = order.rows[0]?.id ?? '';
        const events = async () =>
          (
            await maint.query<{ n: number }>(
              'SELECT count(*)::int AS n FROM service_order_event WHERE order_id = $1',
              [orderId],
            )
          ).rows[0]?.n ?? -1;
        const before = await events();
        let status: number;
        if (command === 'cancel') {
          status = (
            await client.post(
              `/requests/${requestId}/order/cancel`,
              { version: 0, reason: 'No longer needed' },
              { workspace: 'personal' },
            )
          ).status;
        } else if (command === 'staffCancel') {
          status = (
            await staffCall(
              `/platform/orders/${orderId}/cancel`,
              { version: 0, reason: 'Customer asked us' },
              finance,
            )
          ).status;
        } else {
          const { client: f, options } = await elevated(finance);
          status = (
            await f.post(
              `/platform/orders/${orderId}/payments`,
              { amountMinor: 406_000, method: 'BANK_TRANSFER', reference: `F1-${t()}` },
              { ...options, headers: { ...options.headers, 'Idempotency-Key': randomUUID() } },
            )
          ).status;
        }
        const allowed = (ORDER_TRANSITIONS[command].from as readonly string[]).includes(state);
        // A full payment moves AWAITING_PAYMENT → PAID → READY_FOR_ASSIGNMENT: two rows.
        const expectedRows = allowed ? (command === 'completePayment' ? 2 : 1) : 0;
        const label = `${command} from ${state}`;
        if (
          (allowed ? status !== 200 : status !== 409) ||
          (await events()) !== before + expectedRows
        ) {
          results.push(
            `${label}: status ${String(status)}, rows +${String((await events()) - before)}`,
          );
        }
      }
    }
    expect(results).toEqual([]);
  }, 120_000);

  it('every successful change also writes an audit row and an outbox event', async () => {
    const { client } = await person();
    const request = await submitted(client, cat.fixed);
    const audit = await maint.query<{ action: string }>(
      `SELECT action FROM audit_log WHERE entity_id = $1 ORDER BY occurred_at`,
      [request.id],
    );
    expect(audit.rows.map((row) => row.action)).toEqual(['request.submitted']);
    const outbox = await maint.query<{ type: string }>(
      `SELECT type FROM outbox_event WHERE payload->>'requestId' = $1`,
      [request.id],
    );
    expect(outbox.rows.map((row) => row.type)).toEqual(['orders.request_submitted']);
  });
});

// ---------------------------------------------------------------- F2

describe('F2 — idempotent submission and acceptance', () => {
  it('same key + body → same answer, one row; different body → 422; no key → 422', async () => {
    const { user, client } = await person();
    const key = randomUUID();
    const first = await submit(client, requestBody(cat.fixed), 'personal', key);
    const second = await submit(client, requestBody(cat.fixed), 'personal', key);
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect((second.body as ServiceRequest).id).toBe((first.body as ServiceRequest).id);
    expect(
      (
        await submit(
          client,
          requestBody(cat.fixed, { address: 'Another road, Nairobi' }),
          'personal',
          key,
        )
      ).body,
    ).toEqual({
      error: 'idempotency_key_reused',
    });
    expect(
      (await client.post('/requests', requestBody(cat.fixed), { workspace: 'personal' })).body,
    ).toEqual({
      error: 'idempotency_key_required',
    });
    const rows = await maint.query<{ n: number }>(
      'SELECT count(*)::int AS n FROM service_request WHERE created_by = $1',
      [user.id],
    );
    expect(rows.rows[0]?.n).toBe(1);
  });

  it('two parallel submissions with one key create one request', async () => {
    const { user, client } = await person();
    const key = randomUUID();
    const [a, b] = await Promise.all([
      submit(client, requestBody(cat.fixed), 'personal', key),
      submit(client, requestBody(cat.fixed), 'personal', key),
    ]);
    expect([a.status, b.status]).toEqual([201, 201]);
    expect((a.body as ServiceRequest).id).toBe((b.body as ServiceRequest).id);
    const rows = await maint.query<{ n: number }>(
      'SELECT count(*)::int AS n FROM service_request WHERE created_by = $1',
      [user.id],
    );
    expect(rows.rows[0]?.n).toBe(1);
  });

  it('keys are scoped per workspace and per user', async () => {
    const org = await createOrg();
    const key = randomUUID();
    const inOrg = await submit(org.adminClient, requestBody(cat.fixed), org.tenantId, key);
    const personal = await submit(org.adminClient, requestBody(cat.fixed), 'personal', key);
    const other = await submit(org.employeeClient, requestBody(cat.fixed), org.tenantId, key);
    const ids = [inOrg, personal, other].map((response) => (response.body as ServiceRequest).id);
    expect(new Set(ids).size).toBe(3);
  });
});

// ---------------------------------------------------------------- F3

describe('F3 — price integrity', () => {
  it('keeps the price snapshot, ignores client prices, refuses what cannot be ordered', async () => {
    const { client } = await person();
    const request = (
      await submit(client, requestBody(cat.snapshot, { unitAmountMinor: 1, price: 1 }))
    ).body as ServiceRequest;
    expect(request.price).toMatchObject({
      model: 'FIXED',
      unitAmountMinor: 350_000,
      label: 'KES 3,500',
    });
    // The catalogue price changes afterwards; the request and its order do not.
    await maint.query(
      `INSERT INTO service_price (service_id, model, amount_minor) SELECT service_id, 'FIXED', 999900 FROM service_price WHERE id = $1`,
      [cat.snapshotPriceId],
    );
    await staffCall(`/platform/requests/${request.id}/review`, { version: 0 });
    const accepted = (await staffCall(`/platform/requests/${request.id}/accept`, { version: 1 }))
      .body as ServiceRequest;
    expect(accepted.order).toMatchObject({
      subtotalMinor: 350_000,
      vatMinor: 56_000,
      totalMinor: 406_000,
      status: 'AWAITING_PAYMENT',
    });

    expect((await submit(client, requestBody(cat.retired))).body).toEqual({
      error: 'service_unavailable',
    });
    expect((await submit(client, requestBody('no-such-service'))).body).toEqual({
      error: 'service_unavailable',
    });
    expect((await submit(client, requestBody(cat.orgOnly))).body).toEqual({
      error: 'audience_mismatch',
    });
    expect((await submit(client, requestBody(cat.perUnit, { quantity: 4 }))).body).toEqual({
      error: 'below_minimum_quantity',
    });
    const perUnit = (await submit(client, requestBody(cat.perUnit, { quantity: 6 })))
      .body as ServiceRequest;
    expect(perUnit.quantity).toBe(6);
    // Quotation-only services can never be accepted at a catalogue price.
    const quote = await submitted(client, cat.quoteOnly);
    await staffCall(`/platform/requests/${quote.id}/review`, { version: 0 });
    expect((await staffCall(`/platform/requests/${quote.id}/accept`, { version: 1 })).body).toEqual(
      { error: 'quotation_required' },
    );
  });
});

// ---------------------------------------------------------------- F4

describe('F4 — quotations', () => {
  it('draft is invisible, issue, revise (supersede), accept → order with the quotation totals', async () => {
    const { client } = await person();
    const request = await submitted(client, cat.quoteOnly);
    await staffCall(`/platform/requests/${request.id}/review`, { version: 0 });
    await staffCall(`/platform/requests/${request.id}/needs-quotation`, { version: 1 });
    const { client: s, options } = await elevated(sales);
    const draft = (
      await s.put(
        `/platform/requests/${request.id}/quotation`,
        {
          lines: [
            { description: 'Fusion splicing', quantity: 3, unitAmountMinor: 333 },
            { description: 'Travel', quantity: 1, unitAmountMinor: 250_000 },
          ],
        },
        options,
      )
    ).body as ServiceRequest;
    expect(draft.quotations[0]).toMatchObject({
      status: 'DRAFT',
      subtotalMinor: 250_999,
      vatMinor: 160 + 40_000,
      totalMinor: 250_999 + 40_160,
    });
    // The customer never sees drafts.
    expect(
      (
        (await client.get(`/requests/${request.id}`, { workspace: 'personal' }))
          .body as ServiceRequest
      ).quotations,
    ).toEqual([]);

    const first = draft.quotations[0];
    await staffCall(`/platform/requests/${request.id}/quotations/${first?.id ?? ''}/issue`, {
      version: first?.version,
    });
    const revised = (
      await s.put(
        `/platform/requests/${request.id}/quotation`,
        { lines: [{ description: 'Revised splicing', quantity: 1, unitAmountMinor: 200_000 }] },
        options,
      )
    ).body as ServiceRequest;
    const second = revised.quotations.find((q) => q.status === 'DRAFT');
    expect(second?.revision).toBe(2);
    await staffCall(`/platform/requests/${request.id}/quotations/${second?.id ?? ''}/issue`, {
      version: second?.version,
    });

    const view = (await client.get(`/requests/${request.id}`, { workspace: 'personal' }))
      .body as ServiceRequest;
    expect(view.quotations.map((q) => [q.revision, q.status])).toEqual([
      [2, 'ISSUED'],
      [1, 'SUPERSEDED'],
    ]);
    const accept = (quotationId: string, version: number) =>
      client.post(
        `/requests/${request.id}/quotations/${quotationId}/accept`,
        { version },
        { workspace: 'personal', headers: { 'Idempotency-Key': randomUUID() } },
      );
    expect((await accept(first?.id ?? '', 2)).body).toEqual({ error: 'invalid_transition' });
    const accepted = (await accept(second?.id ?? '', 1)).body as ServiceRequest;
    expect(accepted.status).toBe('ORDERED');
    expect(accepted.order).toMatchObject({
      subtotalMinor: 200_000,
      vatMinor: 32_000,
      totalMinor: 232_000,
      paymentTerms: 'PREPAY',
    });
  });

  it('rejection sends the request back for a revised quotation (P7-3)', async () => {
    const { client } = await person();
    const { request, quotation } = await issuedQuotation(client);
    const rejected = await client.post(
      `/requests/${request.id}/quotations/${quotation?.id ?? ''}/reject`,
      { version: quotation?.version, reason: 'Too expensive for us' },
      { workspace: 'personal' },
    );
    expect((rejected.body as ServiceRequest).status).toBe('AWAITING_QUOTATION');
    expect((rejected.body as ServiceRequest).quotations[0]).toMatchObject({
      status: 'REJECTED',
      decisionReason: 'Too expensive for us',
    });
  });

  it('expiry happens exactly once; a late acceptance is refused', async () => {
    const { user, client } = await person();
    const requestId = await requestInState(user.id, 'QUOTATION_ISSUED');
    const quotationId = await quotationFor(requestId, 'ISSUED', 1_500);
    await new Promise((resolve) => setTimeout(resolve, 1_700));
    // Expired by the clock, not yet by the job: acceptance is refused anyway.
    const late = await client.post(
      `/requests/${requestId}/quotations/${quotationId}/accept`,
      { version: 0 },
      { workspace: 'personal', headers: { 'Idempotency-Key': randomUUID() } },
    );
    expect(late.body).toEqual({ error: 'quotation_expired' });
    const expiry = stack.worker.get(QuotationExpiryService);
    const results = await Promise.all([
      expiry.expire(quotationId),
      expiry.expire(quotationId),
      expiry.sweep(),
    ]);
    expect(results.filter((value) => value === true || value === 1)).toHaveLength(1);
    expect(await expiry.expire(quotationId)).toBe(false);
    expect(await statusOf(requestId)).toBe('AWAITING_QUOTATION');
    const events = await maint.query<{ command: string }>(
      'SELECT command FROM service_request_event WHERE request_id = $1',
      [requestId],
    );
    expect(events.rows.map((row) => row.command)).toEqual(['expireQuotation']);
    await waitForMail(user.email, /has expired/, 1, 45_000);
  });

  it('issued quotations and their lines are immutable in the database', async () => {
    const { client } = await person();
    const { quotation } = await issuedQuotation(client);
    await expect(
      maint.query(
        'UPDATE quotation SET total_minor = 1, subtotal_minor = 1, vat_minor = 0 WHERE id = $1',
        [quotation?.id],
      ),
    ).rejects.toThrow(/immutable/);
    await expect(
      maint.query(
        `INSERT INTO quotation_line (quotation_id, position, description, quantity, unit_amount_minor, net_minor, vat_minor, total_minor) VALUES ($1, 9, 'x', 1, 1, 1, 0, 1)`,
        [quotation?.id],
      ),
    ).rejects.toThrow(/draft/);
  });
});

// ---------------------------------------------------------------- F5 / F6

describe('F5 — payments', () => {
  async function prepaidOrder() {
    const { user, client } = await person();
    const request = await submitted(client, cat.fixed);
    await staffCall(`/platform/requests/${request.id}/review`, { version: 0 });
    const accepted = (await staffCall(`/platform/requests/${request.id}/accept`, { version: 1 }))
      .body as ServiceRequest;
    return { user, client, request: accepted, orderId: accepted.order?.id ?? '' };
  }
  const pay = async (orderId: string, amountMinor: number, reference: string, staff = finance) => {
    const { client, options } = await elevated(staff);
    return client.post(
      `/platform/orders/${orderId}/payments`,
      { amountMinor, method: 'MPESA_PAYBILL', reference },
      { ...options, headers: { ...options.headers, 'Idempotency-Key': randomUUID() } },
    );
  };

  it('finance only; partial then full; overpayment and duplicate references refused', async () => {
    const { user, request, orderId } = await prepaidOrder();
    expect((await pay(orderId, 100_000, `SM-${t()}`, sales)).status).toBe(403);
    const ref = `P1-${t()}`;
    const partial = (await pay(orderId, 100_000, ref)).body as ServiceRequest;
    expect(partial.order).toMatchObject({ status: 'AWAITING_PAYMENT', paidMinor: 100_000 });
    expect((await pay(orderId, 1, ref)).body).toEqual({ error: 'duplicate_reference' });
    expect((await pay(orderId, 306_001, `P2-${t()}`)).body).toEqual({ error: 'overpayment' });
    const full = (await pay(orderId, 306_000, `P3-${t()}`)).body as ServiceRequest;
    expect(full.order).toMatchObject({ status: 'READY_FOR_ASSIGNMENT', paidMinor: 406_000 });
    expect(full.order?.history.map((h) => h.toStatus)).toEqual([
      'AWAITING_PAYMENT',
      'PAID',
      'READY_FOR_ASSIGNMENT',
    ]);
    await expect(
      maint.query('UPDATE payment SET amount_minor = 1 WHERE order_id = $1', [orderId]),
    ).rejects.toThrow();
    await waitForMail(
      user.email,
      new RegExp(`Order ${request.order?.number ?? ''} is confirmed`),
      1,
      45_000,
    );
  });

  it('concurrent payments never exceed the total', async () => {
    const { orderId } = await prepaidOrder();
    const results = await Promise.all([
      pay(orderId, 250_000, `C1-${t()}`),
      pay(orderId, 250_000, `C2-${t()}`),
    ]);
    expect(results.map((response) => response.status).sort()).toEqual([200, 409]);
    const paid = await maint.query<{ paid: string }>(
      'SELECT paid_minor::text AS paid FROM service_order WHERE id = $1',
      [orderId],
    );
    expect(paid.rows[0]?.paid).toBe('250000');
  });
});

describe('F6 — payment terms', () => {
  it('postpaid organisations skip payment; terms are copied onto each order', async () => {
    const org = await createOrg();
    const { client: f, options } = await elevated(finance);
    expect(
      (
        await f.put(
          `/platform/organisations/${org.tenantId}/billing`,
          { paymentTerms: 'POSTPAID', netDays: 30 },
          options,
        )
      ).status,
    ).toBe(200);
    const { request, quotation } = await issuedQuotation(org.employeeClient, org.tenantId);
    // Employees may not accept quotations (quotation.accept): the admin does.
    expect(
      (
        await org.employeeClient.post(
          `/requests/${request.id}/quotations/${quotation?.id ?? ''}/accept`,
          { version: quotation?.version },
          { workspace: org.tenantId, headers: { 'Idempotency-Key': randomUUID() } },
        )
      ).body,
    ).toEqual({ error: 'permission_denied' });
    const accepted = (
      await org.adminClient.post(
        `/requests/${request.id}/quotations/${quotation?.id ?? ''}/accept`,
        { version: quotation?.version },
        { workspace: org.tenantId, headers: { 'Idempotency-Key': randomUUID() } },
      )
    ).body as ServiceRequest;
    expect(accepted.order).toMatchObject({
      status: 'READY_FOR_ASSIGNMENT',
      paymentTerms: 'POSTPAID',
      netDays: 30,
    });
    await f.put(
      `/platform/organisations/${org.tenantId}/billing`,
      { paymentTerms: 'PREPAY', netDays: null },
      options,
    );
    const after = (
      await org.adminClient.get(`/requests/${request.id}`, { workspace: org.tenantId })
    ).body as ServiceRequest;
    expect(after.order).toMatchObject({ paymentTerms: 'POSTPAID', status: 'READY_FOR_ASSIGNMENT' });
  });

  it('a customer cannot forge an order or its terms in the database', async () => {
    const { user, client } = await person();
    const { request, quotation } = await issuedQuotation(client);
    const app = await connect('app');
    try {
      await app.query('BEGIN');
      await app.query(
        `SELECT set_config('app.user_id', $1, true), set_config('app.actor_kind', 'USER', true)`,
        [user.id],
      );
      const forged = await attempt(
        app,
        `INSERT INTO service_order (number, request_id, quotation_id, customer_user_id, payment_terms, subtotal_minor, vat_minor, total_minor, status)
         VALUES ('ORD-2099-999999', $1, $2, $3, 'PREPAY', 1, 0, 1, 'AWAITING_PAYMENT')`,
        [request.id, quotation?.id, user.id],
      );
      expect(forged).toHaveProperty('error');
      const accepted = await attempt(
        app,
        `UPDATE service_request SET status = 'ORDERED' WHERE id = $1 AND false`,
        [request.id],
      );
      expect(accepted).toMatchObject({ rowCount: 0 });
      const skipped = await attempt(
        app,
        `UPDATE service_request SET status = 'UNDER_REVIEW' WHERE id = $1`,
        [request.id],
      );
      expect(skipped).toHaveProperty('error');
    } finally {
      await app.query('ROLLBACK');
      await app.end();
    }
  });
});

// ---------------------------------------------------------------- F7 / F8

describe('F7 — isolation', () => {
  it('organisations, people, members and other workspaces never see each other', async () => {
    const orgA = await createOrg();
    const orgB = await createOrg();
    const byEmployee = await submitted(orgA.employeeClient, cat.fixed, orgA.tenantId);
    const otherEmployee = await createLoginUser(maint);
    await grantRole(
      maint,
      await createMembership(maint, orgA.tenantId, otherEmployee.id),
      orgA.tenantId,
      'org_employee',
    );
    const otherClient = await signIn(stack.server, maint, otherEmployee);
    const someone = await person();
    const personal = await submitted(someone.client, cat.fixed);

    // Admin sees the organisation's requests; another employee only their own.
    expect(
      (await orgA.adminClient.get(`/requests/${byEmployee.id}`, { workspace: orgA.tenantId }))
        .status,
    ).toBe(200);
    expect(
      (await otherClient.get(`/requests/${byEmployee.id}`, { workspace: orgA.tenantId })).status,
    ).toBe(404);
    const otherList = (await otherClient.get('/requests', { workspace: orgA.tenantId })).body as {
      requests: unknown[];
    };
    expect(otherList.requests).toEqual([]);
    // Another organisation: 404 by id, 403 by naming the foreign workspace.
    expect(
      (await orgB.adminClient.get(`/requests/${byEmployee.id}`, { workspace: orgB.tenantId }))
        .status,
    ).toBe(404);
    expect(
      (await orgB.adminClient.get(`/requests/${byEmployee.id}`, { workspace: orgA.tenantId }))
        .status,
    ).toBe(403);
    // A person's request: not from anyone else, and not even from their own organisation workspace.
    expect(
      (await orgA.adminClient.get(`/requests/${personal.id}`, { workspace: 'personal' })).status,
    ).toBe(404);
    const mine = await submitted(orgA.employeeClient, cat.fixed, 'personal');
    expect(
      (await orgA.employeeClient.get(`/requests/${mine.id}`, { workspace: orgA.tenantId })).status,
    ).toBe(404);
    expect(
      (await orgA.adminClient.get(`/requests/${mine.id}`, { workspace: orgA.tenantId })).status,
    ).toBe(404);
    // Provider and platform workspaces are not customers; anonymous callers get nothing.
    const { client: staff, options } = await elevated(sales);
    expect((await staff.get('/requests', { workspace: options.workspace })).body).toEqual({
      error: 'not_a_customer_workspace',
    });
    expect((await new Client(stack.server).get(`/requests/${personal.id}`)).status).toBe(401);
    // Staff without the right permission are refused.
    const { client: f, options: fo } = await elevated(finance);
    expect((await f.get('/platform/requests', fo)).status).toBe(403);
  });
});

describe('F8 — concurrency', () => {
  it('two staff deciding the same request: one wins', async () => {
    const { client } = await person();
    const request = await submitted(client, cat.fixed);
    const results = await Promise.all([
      staffCall(`/platform/requests/${request.id}/review`, { version: 0 }),
      staffCall(`/platform/requests/${request.id}/review`, { version: 0 }),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(await historyCount(request.id)).toBe(2); // submit + one review
  });

  it('a double acceptance creates exactly one order', async () => {
    const org = await createOrg();
    const second = await createLoginUser(maint, { mfa: true });
    await grantRole(
      maint,
      await createMembership(maint, org.tenantId, second.id),
      org.tenantId,
      'org_admin',
    );
    const secondClient = await signIn(stack.server, maint, second);
    const { request, quotation } = await issuedQuotation(org.employeeClient, org.tenantId);
    const accept = (client: Client) =>
      client.post(
        `/requests/${request.id}/quotations/${quotation?.id ?? ''}/accept`,
        { version: quotation?.version },
        { workspace: org.tenantId, headers: { 'Idempotency-Key': randomUUID() } },
      );
    const results = await Promise.all([accept(org.adminClient), accept(secondClient)]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    const orders = await maint.query<{ n: number }>(
      'SELECT count(*)::int AS n FROM service_order WHERE request_id = $1',
      [request.id],
    );
    expect(orders.rows[0]?.n).toBe(1);
  });
});

// ---------------------------------------------------------------- F9

describe('F9 — notifications', () => {
  it('each customer email is sent once, to the right people', async () => {
    const org = await createOrg();
    const { request } = await issuedQuotation(org.employeeClient, org.tenantId);
    await waitForMail(
      org.employee.email,
      new RegExp(`We received your request ${request.number}`),
      1,
      45_000,
    );
    await waitForMail(org.employee.email, /Quotation QUO-/, 1, 45_000);
    await waitForMail(org.admin.email, /Quotation QUO-/, 1, 45_000);
    // The admin is not told about the submission (only the requester is).
    expect(
      (await mailsTo(org.admin.email)).filter((m) => m.Subject.includes('We received')),
    ).toHaveLength(0);
    // Once each, even though the worker may retry.
    await new Promise((resolve) => setTimeout(resolve, 1_000));
    expect(
      (await mailsTo(org.employee.email)).filter((m) => m.Subject.includes('Quotation QUO-')),
    ).toHaveLength(1);
  });
});
