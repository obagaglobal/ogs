import { randomUUID } from 'node:crypto';
import {
  publicCategoryResponseSchema,
  publicServiceDetailSchema,
  publicServiceListResponseSchema,
  type PublicServiceListResponse,
  type StaffService,
} from '@ogs/contracts';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AccessRouteCheck } from '../../src/access/access-route-check.js';
import { RATE_LIMITS, RateLimiter } from '../../src/identity/rate-limiter.js';
import {
  Client,
  createLoginUser,
  grantRole,
  signIn,
  startStack,
  type FixtureUser,
  type Stack,
} from './http-harness.js';
import { attempt, connect, createMembership, createTenant, createUser } from './support.js';

/**
 * Phase 6 — the service catalogue: E1–E8 of the plan (E9 is the web journey).
 */
let stack: Stack;
let maint: pg.Client;
let platformTenant: string;
let manager: FixtureUser; // service_manager: platform.catalogue.manage + ticket.assign
let operations: FixtureUser; // operations_manager: no catalogue permission

const token = () => `t${randomUUID().replace(/-/g, '').slice(0, 10)}`;

beforeAll(async () => {
  stack = await startStack({ worker: false });
  maint = await connect('maint');
  const existing = await maint.query<{ id: string }>(
    `SELECT id FROM tenant WHERE kind = 'PLATFORM'`,
  );
  platformTenant = existing.rows[0]?.id ?? (await createTenant(maint, { kind: 'PLATFORM' }));
  manager = await createStaff('service_manager');
  operations = await createStaff('operations_manager');
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

interface Elevated {
  client: Client;
  options: { workspace: string; headers: Record<string, string> };
}
const elevations = new Map<string, Promise<Elevated>>();

/** One elevated session per staff member (signing in per call trips the sign-in limit). */
async function elevated(staff: FixtureUser): Promise<Elevated> {
  let session = elevations.get(staff.id);
  if (session === undefined) {
    session = (async () => {
      const client = await signIn(stack.server, maint, staff);
      const response = await client.post(
        '/platform/elevate',
        { reason: 'Catalogue maintenance CAT-2026-06' },
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

/** A signed-out visitor (its own IP, so rate limits never collide between tests). */
const visitor = () => new Client(stack.server);

async function insertCategory(
  slug: string,
  options: { parentId?: string | null; status?: string; name?: string } = {},
): Promise<string> {
  const result = await maint.query<{ id: string }>(
    `INSERT INTO service_category (slug, name, parent_id, status)
     VALUES ($1, $2, $3, $4::"CatalogueStatus") RETURNING id`,
    [
      slug,
      options.name ?? `Category ${slug}`,
      options.parentId ?? null,
      options.status ?? 'ACTIVE',
    ],
  );
  return result.rows[0]?.id ?? '';
}

interface ServiceSeed {
  slug: string;
  categoryId: string;
  name?: string;
  status?: 'DRAFT' | 'PUBLISHED' | 'RETIRED';
  description?: string;
  audience?: string;
  delivery?: string;
  price?: [string, number | null, string | null, number];
  skills?: [string, string][];
  channels?: [boolean, boolean, boolean];
}

/** Writes a service directly (as ogs_maint) for combinatorial visibility tests. */
async function insertService(seed: ServiceSeed): Promise<string> {
  const status = seed.status ?? 'PUBLISHED';
  const [ogs, individual, company] = seed.channels ?? [true, true, true];
  const result = await maint.query<{ id: string }>(
    `INSERT INTO service (slug, category_id, name, summary, description, audience, delivery_mode,
       status, published_at, retired_at, channel_ogs, channel_individual, channel_company)
     VALUES ($1, $2, $3, 'Summary', $4, $5::"ServiceAudience", $6::"DeliveryMode",
       $7::"ServiceStatus",
       CASE WHEN $7::"ServiceStatus" <> 'DRAFT' THEN now() END,
       CASE WHEN $7::"ServiceStatus" = 'RETIRED' THEN now() END, $8, $9, $10)
     RETURNING id`,
    [
      seed.slug,
      seed.categoryId,
      seed.name ?? `Service ${seed.slug}`,
      seed.description ?? 'Description',
      seed.audience ?? 'ALL',
      seed.delivery ?? 'ON_SITE',
      status,
      ogs,
      individual,
      company,
    ],
  );
  const id = result.rows[0]?.id ?? '';
  const [model, amount, unit, min] = seed.price ?? ['FIXED', 100_000, null, 1];
  await maint.query(
    `INSERT INTO service_price (service_id, model, amount_minor, unit, min_quantity)
     VALUES ($1, $2::"PriceModel", $3, $4::"PriceUnit", $5)`,
    [id, model, amount, unit, min],
  );
  for (const [skill, minimum] of seed.skills ?? []) {
    await maint.query(
      `INSERT INTO service_skill (service_id, skill_code, min_experience)
       VALUES ($1, $2, $3::"ExperienceBand")`,
      [id, skill, minimum],
    );
  }
  return id;
}

/** Runs SQL as ogs_app in the anonymous context: every identity setting empty (P6-1). */
async function asAnonymous<T>(work: (app: pg.Client) => Promise<T>): Promise<T> {
  const app = await connect('app');
  try {
    await app.query('BEGIN');
    await app.query(
      `SELECT set_config('app.user_id', '', true), set_config('app.tenant_id', '', true),
              set_config('app.is_platform', 'false', true), set_config('app.actor_kind', '', true),
              set_config('app.job', '', true)`,
    );
    return await work(app);
  } finally {
    await app.query('ROLLBACK');
    await app.end();
  }
}

async function searchAll(
  client: Client,
  query: Record<string, string>,
  limit = 50,
): Promise<PublicServiceListResponse['services']> {
  const found: PublicServiceListResponse['services'] = [];
  let cursor: string | null = null;
  do {
    const params = new URLSearchParams({ ...query, limit: String(limit) });
    if (cursor !== null) params.set('cursor', cursor);
    const response = await client.get(`/catalogue/services?${params.toString()}`);
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    const body = publicServiceListResponseSchema.parse(response.body);
    found.push(...body.services);
    cursor = body.nextCursor;
  } while (cursor !== null);
  return found;
}

// ---------------------------------------------------------------- E1 / E2

describe('E1 — anonymous visitors see only published services in active categories', () => {
  it('every service status × category state, through HTTP and through RLS', async () => {
    const t = token();
    const activeTop = await insertCategory(`${t}-top`);
    const activeChild = await insertCategory(`${t}-child`, { parentId: activeTop });
    const archivedChild = await insertCategory(`${t}-gone-child`, { parentId: activeTop });
    await maint.query(`UPDATE service_category SET status = 'ARCHIVED' WHERE id = $1`, [
      archivedChild,
    ]);
    const archivedTop = await insertCategory(`${t}-gone-top`);
    const orphanedChild = await insertCategory(`${t}-orphan`, { parentId: archivedTop });
    // Archiving a parent archives its children (the database keeps the tree consistent).
    await maint.query(`UPDATE service_category SET status = 'ARCHIVED' WHERE id = $1`, [
      archivedTop,
    ]);
    const orphanStatus = await maint.query<{ status: string }>(
      'SELECT status FROM service_category WHERE id = $1',
      [orphanedChild],
    );
    expect(orphanStatus.rows[0]?.status).toBe('ARCHIVED');
    await expect(
      maint.query(`UPDATE service_category SET status = 'ACTIVE' WHERE id = $1`, [orphanedChild]),
    ).rejects.toThrow(/archived parent/);

    const categories: [string, string, boolean][] = [
      ['top', activeTop, true],
      ['child', activeChild, true],
      ['gone-child', archivedChild, false],
      ['gone-top', archivedTop, false],
      ['orphan', orphanedChild, false],
    ];
    const expected = new Map<string, boolean>();
    for (const [label, categoryId, categoryVisible] of categories) {
      for (const status of ['DRAFT', 'PUBLISHED', 'RETIRED'] as const) {
        const slug = `${t}-${label}-${status.toLowerCase()}`;
        await insertService({ slug, categoryId, status, name: `${t} ${label} ${status}` });
        expected.set(slug, categoryVisible && status === 'PUBLISHED');
      }
    }
    const visible = [...expected]
      .filter(([, shown]) => shown)
      .map(([slug]) => slug)
      .sort();
    expect(visible).toEqual([`${t}-child-published`, `${t}-top-published`]);

    // HTTP: search, detail, sitemap.
    const anonymous = visitor();
    const listed = (await searchAll(anonymous, { q: t })).map((service) => service.slug).sort();
    expect(listed).toEqual(visible);
    for (const [slug, shown] of expected) {
      const response = await anonymous.get(`/catalogue/services/${slug}`);
      expect(response.status, slug).toBe(shown ? 200 : 404);
      if (shown) {
        // Strict public schema: any internal field would make this throw.
        publicServiceDetailSchema.parse(response.body);
      }
    }
    const sitemap = await anonymous.get('/catalogue/sitemap.xml');
    expect(sitemap.headers['content-type']).toMatch(/application\/xml/);
    for (const [slug, shown] of expected) {
      expect(sitemap.text.includes(`/services/${slug}<`), slug).toBe(shown);
    }
    // Categories: active ones visible, archived ones 404.
    for (const [label, , shown] of categories) {
      const response = await anonymous.get(`/catalogue/categories/${t}-${label}`);
      expect(response.status, label).toBe(shown ? 200 : 404);
      if (shown) publicCategoryResponseSchema.parse(response.body);
    }
    const parentView = publicCategoryResponseSchema.parse(
      (await anonymous.get(`/catalogue/categories/${t}-top`)).body,
    );
    expect(parentView.category.children.map((child) => child.slug)).toEqual([`${t}-child`]);
    expect(parentView.category.serviceCount).toBe(2);

    // RLS: the same answer straight from the database in the anonymous context.
    const fromDb = await asAnonymous(async (app) => {
      const services = await app.query<{ slug: string }>(
        `SELECT slug FROM service WHERE slug LIKE $1 ORDER BY slug`,
        [`${t}-%`],
      );
      const prices = await app.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM service_price p JOIN service s ON s.id = p.service_id
          WHERE s.slug LIKE $1`,
        [`${t}-%`],
      );
      const skills = await app.query<{ n: number }>(`SELECT count(*)::int AS n FROM service_skill`);
      return {
        services: services.rows.map((row) => row.slug),
        prices: prices.rows[0]?.n,
        skills: skills.rows[0]?.n,
      };
    });
    expect(fromDb.services).toEqual(visible);
    expect(fromDb.prices).toBe(visible.length);
    expect(fromDb.skills).toBe(0);
  });
});

describe('E2 — the anonymous context sees nothing outside the public catalogue', () => {
  it('zero rows in every other table, and no writes anywhere', async () => {
    await createUser(maint); // at least one row exists in app_user
    const tables = await maint.query<{ table: string }>(`
      SELECT c.relname AS table FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relname <> '_prisma_migrations'
       ORDER BY 1`);
    const publicTables = new Set(['service', 'service_category', 'service_price']);
    const counts = await asAnonymous(async (app) => {
      const result: Record<string, number> = {};
      for (const { table } of tables.rows) {
        if (!publicTables.has(table)) {
          const rows = await app.query<{ n: number }>(`SELECT count(*)::int AS n FROM "${table}"`);
          result[table] = rows.rows[0]?.n ?? -1;
        }
      }
      return result;
    });
    expect(Object.keys(counts).length).toBeGreaterThan(30);
    expect(Object.entries(counts).filter(([, n]) => n !== 0)).toEqual([]);

    // The public tables only ever expose published / active rows.
    const leaks = await asAnonymous(async (app) =>
      app.query<{ n: number }>(`
        SELECT (SELECT count(*) FROM service WHERE status <> 'PUBLISHED')
             + (SELECT count(*) FROM service_category WHERE status <> 'ACTIVE') AS n`),
    );
    expect(Number(leaks.rows[0]?.n)).toBe(0);

    const category = await insertCategory(`${token()}-ro`);
    const writes = await asAnonymous(async (app) => [
      await attempt(app, `INSERT INTO service_category (slug, name) VALUES ('x-anon', 'Anon')`),
      await attempt(app, `UPDATE service_category SET name = 'Hijacked' WHERE id = $1`, [category]),
      await attempt(
        app,
        `INSERT INTO service (slug, category_id, name) VALUES ('x-anon', $1, 'Anon')`,
        [category],
      ),
      await attempt(app, `INSERT INTO audit_log (action) VALUES ('anon.write')`),
      await attempt(app, `INSERT INTO outbox_event (type, payload) VALUES ('anon.write', '{}')`),
    ]);
    for (const result of writes.slice(0, 1).concat(writes.slice(2))) {
      expect(result).toHaveProperty('error');
    }
    // An UPDATE that RLS hides affects zero rows rather than erroring.
    expect(writes[1]).toMatchObject({ rowCount: 0 });
  });
});

// ---------------------------------------------------------------- E3

describe('E3 — money is integer minor units, and prices are append-only', () => {
  it('the database refuses malformed prices and any change to a recorded one', async () => {
    const category = await insertCategory(`${token()}-money`);
    const service = await insertService({ slug: `${token()}-money`, categoryId: category });
    const bad: [string, unknown[]][] = [
      [
        `INSERT INTO service_price (service_id, model, amount_minor) VALUES ($1, 'FIXED', -1)`,
        [service],
      ],
      [
        `INSERT INTO service_price (service_id, model, amount_minor, currency) VALUES ($1, 'FIXED', 100, 'USD')`,
        [service],
      ],
      [`INSERT INTO service_price (service_id, model) VALUES ($1, 'FIXED')`, [service]],
      [
        `INSERT INTO service_price (service_id, model, amount_minor) VALUES ($1, 'QUOTE', 100)`,
        [service],
      ],
      [
        `INSERT INTO service_price (service_id, model, amount_minor) VALUES ($1, 'PER_UNIT', 100)`,
        [service],
      ],
      [
        `INSERT INTO service_price (service_id, model, amount_minor, unit) VALUES ($1, 'FIXED', 100, 'HOUR')`,
        [service],
      ],
      [
        `INSERT INTO service_price (service_id, model, amount_minor, min_quantity) VALUES ($1, 'FIXED', 100, 3)`,
        [service],
      ],
      [
        `INSERT INTO service_price (service_id, model, amount_minor) VALUES ($1, 'FIXED', 1000000000001)`,
        [service],
      ],
    ];
    await maint.query('BEGIN');
    try {
      for (const [sql, params] of bad) {
        expect(await attempt(maint, sql, params), sql).toHaveProperty('error');
      }
    } finally {
      await maint.query('ROLLBACK');
    }
    // Append-only: even the maintenance role cannot rewrite history.
    await expect(
      maint.query(`UPDATE service_price SET amount_minor = 1 WHERE service_id = $1`, [service]),
    ).rejects.toThrow();
    await expect(
      maint.query(`DELETE FROM service_price WHERE service_id = $1`, [service]),
    ).rejects.toThrow();
  });

  it('every pricing model round-trips exactly through the API, with server-built labels', async () => {
    const { client, options } = await elevated(manager);
    const t = token();
    await insertCategory(`${t}-pc`);
    const created = await client.post(
      '/platform/catalogue/services',
      { slug: `${t}-prices`, name: `${t} pricing probe`, categorySlug: `${t}-pc` },
      options,
    );
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const id = (created.body as StaffService).id;
    const cases: [Record<string, unknown>, string, number | null][] = [
      [{ model: 'FIXED', amountMinor: 350_050 }, 'KES 3,500.50', 406_058],
      [{ model: 'FROM', amountMinor: 1_500_000 }, 'From KES 15,000', 1_740_000],
      [
        { model: 'PER_UNIT', amountMinor: 120_000, unit: 'DEVICE', minQuantity: 5 },
        'KES 1,200 per device (min. 5 devices)',
        139_200,
      ],
      [{ model: 'QUOTE' }, 'Price on quotation', null],
    ];
    for (const [body, label, vat] of cases) {
      const response = await client.post(
        `/platform/catalogue/services/${id}/prices`,
        body,
        options,
      );
      expect(response.status, JSON.stringify(response.body)).toBe(201);
      const service = response.body as StaffService;
      expect(service.price).toMatchObject({
        model: body['model'],
        amountMinor: body['amountMinor'] ?? null,
        label,
        vatInclusiveMinor: vat,
      });
    }
    const history = await client.get(`/platform/catalogue/services/${id}`, options);
    expect((history.body as StaffService).priceHistory.map((price) => price.model)).toEqual([
      'QUOTE',
      'PER_UNIT',
      'FROM',
      'FIXED',
    ]);
    // Floats and strings never become money.
    for (const amountMinor of [12.5, '1000', -5]) {
      expect(
        (
          await client.post(
            `/platform/catalogue/services/${id}/prices`,
            { model: 'FIXED', amountMinor },
            options,
          )
        ).status,
      ).toBe(400);
    }
  });
});

// ---------------------------------------------------------------- E4

describe('E4 — search, filters and pagination', () => {
  it('ranks name matches first, matches brand terms, and filters correctly', async () => {
    const t = token();
    const parent = await insertCategory(`${t}-parent`);
    const child = await insertCategory(`${t}-kid`, { parentId: parent });
    const other = await insertCategory(`${t}-other`);
    await insertService({
      slug: `${t}-desc`,
      categoryId: parent,
      name: `${t} Alpha`,
      description: `Uses zq${t}fibre splicing`,
    });
    await insertService({
      slug: `${t}-name`,
      categoryId: child,
      name: `${t} zq${t}fibre service`,
      audience: 'ORGANISATIONS',
      delivery: 'REMOTE',
      price: ['PER_UNIT', 200_000, 'HOUR', 1],
    });
    await insertService({
      slug: `${t}-mpesa`,
      categoryId: other,
      name: `${t} M-Pesa till setup`,
      audience: 'INDIVIDUALS',
      price: ['QUOTE', null, null, 1],
    });
    await insertService({
      slug: `${t}-cheap`,
      categoryId: other,
      name: `${t} Cheap fix`,
      price: ['FIXED', 50_000, null, 1],
    });
    await insertService({
      slug: `${t}-from`,
      categoryId: other,
      name: `${t} From job`,
      price: ['FROM', 900_000, null, 1],
    });

    const client = visitor();
    const slugs = async (query: Record<string, string>) =>
      (await searchAll(client, query)).map((service) => service.slug);

    expect(await slugs({ q: `zq${t}fibre` })).toEqual([`${t}-name`, `${t}-desc`]);
    expect(await slugs({ q: `M-Pesa ${t}` })).toEqual([`${t}-mpesa`]);
    // Category includes its sub-categories.
    expect((await slugs({ q: t, category: `${t}-parent` })).sort()).toEqual([
      `${t}-desc`,
      `${t}-name`,
    ]);
    expect(await slugs({ q: t, category: `${t}-kid` })).toEqual([`${t}-name`]);
    expect(await slugs({ q: t, model: 'QUOTE' })).toEqual([`${t}-mpesa`]);
    expect(await slugs({ q: t, audience: 'ORGANISATIONS' })).toEqual([`${t}-name`]);
    expect(await slugs({ q: t, delivery: 'REMOTE' })).toEqual([`${t}-name`]);
    // Price range: fixed and per-unit prices only (FROM and QUOTE are not comparable).
    expect((await slugs({ q: t, maxPrice: '200000' })).sort()).toEqual(
      [`${t}-cheap`, `${t}-desc`, `${t}-name`].sort(),
    );
    expect(await slugs({ q: t, minPrice: '150000', maxPrice: '250000' })).toEqual([`${t}-name`]);
    expect(await slugs({ q: t, model: 'FIXED', audience: 'INDIVIDUALS' })).toEqual([]);
    // Stop words alone do not empty the catalogue or fail.
    expect((await client.get('/catalogue/services?q=the')).status).toBe(200);
  });

  it('keyset pages have no duplicates or gaps, even while the catalogue changes', async () => {
    const t = token();
    const category = await insertCategory(`${t}-pages`);
    const ids: Record<string, string> = {};
    for (const letter of ['a', 'b', 'c', 'd', 'e', 'f', 'g']) {
      ids[letter] = await insertService({
        slug: `${t}-${letter}`,
        categoryId: category,
        name: `${t} ${letter}`,
      });
    }
    const client = visitor();
    const query = { category: `${t}-pages`, limit: '3' };
    const first = publicServiceListResponseSchema.parse(
      (await client.get(`/catalogue/services?${new URLSearchParams(query).toString()}`)).body,
    );
    expect(first.services.map((s) => s.slug)).toEqual([`${t}-a`, `${t}-b`, `${t}-c`]);
    // Between pages: retire one not yet seen, publish a new one late in the order.
    await maint.query(`UPDATE service SET status = 'RETIRED', retired_at = now() WHERE id = $1`, [
      ids['e'],
    ]);
    await insertService({ slug: `${t}-h`, categoryId: category, name: `${t} h` });
    const seen = [...first.services.map((s) => s.slug)];
    let cursor = first.nextCursor;
    while (cursor !== null) {
      const page = publicServiceListResponseSchema.parse(
        (
          await client.get(
            `/catalogue/services?${new URLSearchParams({ ...query, cursor }).toString()}`,
          )
        ).body,
      );
      seen.push(...page.services.map((s) => s.slug));
      cursor = page.nextCursor;
    }
    expect(seen).toEqual([`${t}-a`, `${t}-b`, `${t}-c`, `${t}-d`, `${t}-f`, `${t}-g`, `${t}-h`]);
    expect(new Set(seen).size).toBe(seen.length);

    // Tampered, foreign or oversized requests are refused.
    const tampered = Buffer.from(JSON.stringify({ k1: '0', k2: '', id: 'nope', h: 'x' })).toString(
      'base64url',
    );
    for (const bad of [
      `cursor=${tampered}`,
      'cursor=%%%',
      `category=${t}-pages&cursor=${first.nextCursor ?? ''}&model=FIXED`,
      'limit=51',
      `q=${'x'.repeat(101)}`,
    ]) {
      const response = await client.get(`/catalogue/services?category=${t}-pages&${bad}`);
      expect(response.status, bad).toBe(400);
    }
  });
});

// ---------------------------------------------------------------- E5 / E6

describe('E5 — catalogue management', () => {
  it('only platform.catalogue.manage under elevation reaches the staff routes', async () => {
    const routes = stack.app
      .get(AccessRouteCheck)
      .routes()
      .filter((route) => route.path.startsWith('/platform/catalogue'));
    expect(routes.length).toBeGreaterThanOrEqual(11);
    const { client: ops, options: opsOptions } = await elevated(operations);
    const orgTenant = await createTenant(maint);
    const orgAdmin = await createLoginUser(maint, { mfa: true });
    await grantRole(
      maint,
      await createMembership(maint, orgTenant, orgAdmin.id),
      orgTenant,
      'org_admin',
    );
    const org = await signIn(stack.server, maint, orgAdmin);
    const anonymous = visitor();
    for (const route of routes) {
      expect(route.rule).toEqual({ kind: 'elevated', code: 'platform.catalogue.manage' });
      const path = `/api/v1${route.path.replace(/:[A-Za-z]+/g, '01930000-0000-7000-8000-00000000abcd')}`;
      const method = route.method.toLowerCase() as 'get' | 'post' | 'put' | 'patch';
      const asOps = await ops.agent[method](path)
        .set('X-Forwarded-For', ops.ip)
        .set('X-CSRF-Token', ops.csrf ?? '')
        .set('X-OGS-Workspace', opsOptions.workspace)
        .set('X-OGS-Elevation', opsOptions.headers['X-OGS-Elevation'] ?? '')
        .send(route.method === 'GET' ? undefined : {});
      expect(asOps.status, `ops ${route.method} ${route.path}`).toBe(403);
      const asOrg = await org.agent[method](path)
        .set('X-Forwarded-For', org.ip)
        .set('X-CSRF-Token', org.csrf ?? '')
        .set('X-OGS-Workspace', orgTenant)
        .send(route.method === 'GET' ? undefined : {});
      expect(asOrg.status, `org ${route.method} ${route.path}`).toBe(403);
      const asAnon = await anonymous.agent[method](path).send(
        route.method === 'GET' ? undefined : {},
      );
      expect(asAnon.status, `anon ${route.method} ${route.path}`).toBe(401);
    }
  });

  it('draft → publish checks → publish, with optimistic concurrency and audit', async () => {
    const { client, options } = await elevated(manager);
    const t = token();
    await insertCategory(`${t}-power`);
    const draft = (
      await client.post(
        '/platform/catalogue/services',
        { slug: `${t}-svc`, name: `${t} UPS installation`, categorySlug: `${t}-power` },
        options,
      )
    ).body as StaffService;
    expect(draft).toMatchObject({ status: 'DRAFT', version: 0 });
    expect(draft.missing).toEqual(['summary', 'description', 'price', 'skills']);
    expect(
      (
        await client.post(
          `/platform/catalogue/services/${draft.id}/publish`,
          { version: 0 },
          options,
        )
      ).body,
    ).toEqual({ error: 'service_incomplete' });
    // The draft is invisible to the public.
    expect((await visitor().get(`/catalogue/services/${t}-svc`)).status).toBe(404);

    const edited = await client.patch(
      `/platform/catalogue/services/${draft.id}`,
      {
        version: 0,
        summary: 'Backup power for servers and networks.',
        description: 'We size, install and test your UPS.',
      },
      options,
    );
    expect(edited.status).toBe(200);
    // A second editor with the old version loses (409), and nothing changes.
    expect(
      (
        await client.patch(
          `/platform/catalogue/services/${draft.id}`,
          { version: 0, name: 'Lost update' },
          options,
        )
      ).body,
    ).toEqual({ error: 'stale_version' });
    await client.post(
      `/platform/catalogue/services/${draft.id}/prices`,
      { model: 'FIXED', amountMinor: 1_800_000 },
      options,
    );
    expect(
      (
        await client.put(
          `/platform/catalogue/services/${draft.id}/skills`,
          { skills: [{ code: 'no_such_skill', minExperience: 'YEARS_1_3' }] },
          options,
        )
      ).body,
    ).toEqual({ error: 'skill_unknown' });
    const withSkills = (
      await client.put(
        `/platform/catalogue/services/${draft.id}/skills`,
        { skills: [{ code: 'networking', minExperience: 'YEARS_1_3' }] },
        options,
      )
    ).body as StaffService;
    expect(withSkills.missing).toEqual([]);
    const published = await client.post(
      `/platform/catalogue/services/${draft.id}/publish`,
      { version: withSkills.version },
      options,
    );
    expect(published.status, JSON.stringify(published.body)).toBe(200);
    expect(published.body).toMatchObject({ status: 'PUBLISHED' });

    const detail = publicServiceDetailSchema.parse(
      (await visitor().get(`/catalogue/services/${t}-svc`)).body,
    );
    expect(detail).toMatchObject({ name: `${t} UPS installation`, price: { label: 'KES 18,000' } });

    const audit = await maint.query<{ action: string }>(
      `SELECT action FROM audit_log WHERE entity_type = 'service' AND entity_id = $1 ORDER BY occurred_at`,
      [draft.id],
    );
    expect(audit.rows.map((row) => row.action)).toEqual([
      'catalogue.service_created',
      'catalogue.service_updated',
      'catalogue.price_set',
      'catalogue.skills_set',
      'catalogue.service_published',
    ]);
  });
});

describe('E6 — retiring and archiving hide at once; slugs are stable', () => {
  it('retire hides publicly but not from staff; published slugs never change or repeat', async () => {
    const { client, options } = await elevated(manager);
    const t = token();
    const category = (
      await client.post(
        '/platform/catalogue/categories',
        { slug: `${t}-cat`, name: `${t} Category`, icon: 'wrench' },
        options,
      )
    ).body as { id: string };
    const service = await insertService({
      slug: `${t}-live`,
      categoryId: category.id,
      name: `${t} live`,
    });
    const anonymous = visitor();
    expect((await anonymous.get(`/catalogue/services/${t}-live`)).status).toBe(200);

    const current = (await client.get(`/platform/catalogue/services/${service}`, options))
      .body as StaffService;
    expect(
      (
        await client.patch(
          `/platform/catalogue/services/${service}`,
          { version: current.version, slug: `${t}-renamed` },
          options,
        )
      ).body,
    ).toEqual({ error: 'slug_immutable' });
    expect(
      (
        await client.post(
          '/platform/catalogue/services',
          { slug: `${t}-live`, name: 'Duplicate', categorySlug: `${t}-cat` },
          options,
        )
      ).body,
    ).toEqual({ error: 'slug_taken' });

    const retired = await client.post(
      `/platform/catalogue/services/${service}/retire`,
      { version: current.version },
      options,
    );
    expect(retired.body).toMatchObject({ status: 'RETIRED' });
    expect((await anonymous.get(`/catalogue/services/${t}-live`)).status).toBe(404);
    expect(await searchAll(anonymous, { q: t })).toEqual([]);
    expect((await client.get(`/platform/catalogue/services/${service}`, options)).status).toBe(200);
    // Restore to draft, then publish again: the slug is still fixed.
    const restored = (
      await client.post(
        `/platform/catalogue/services/${service}/restore`,
        { version: (retired.body as StaffService).version },
        options,
      )
    ).body as StaffService;
    expect(restored.status).toBe('DRAFT');
    expect(
      (
        await client.patch(
          `/platform/catalogue/services/${service}`,
          { version: restored.version, slug: `${t}-renamed` },
          options,
        )
      ).body,
    ).toEqual({ error: 'slug_immutable' });

    // Archiving a category hides its published services.
    const second = await insertService({
      slug: `${t}-other`,
      categoryId: category.id,
      name: `${t} other`,
    });
    expect((await anonymous.get(`/catalogue/services/${t}-other`)).status).toBe(200);
    const categories = (await client.get('/platform/catalogue/categories', options)).body as {
      categories: { id: string; version: number }[];
    };
    const version = categories.categories.find((row) => row.id === category.id)?.version ?? 0;
    expect(
      (
        await client.patch(
          `/platform/catalogue/categories/${category.id}`,
          { version, status: 'ARCHIVED' },
          options,
        )
      ).status,
    ).toBe(204);
    expect((await anonymous.get(`/catalogue/services/${t}-other`)).status).toBe(404);
    expect((await anonymous.get(`/catalogue/categories/${t}-cat`)).status).toBe(404);
    expect((await client.get(`/platform/catalogue/services/${second}`, options)).status).toBe(200);
    // A third level is refused by the database.
    await insertCategory(`${t}-l1`);
    const child = (
      await client.post(
        '/platform/catalogue/categories',
        { slug: `${t}-l2`, name: 'Level two', parentSlug: `${t}-l1` },
        options,
      )
    ).body as { id: string };
    expect(child.id).toBeDefined();
    expect(
      (
        await client.post(
          '/platform/catalogue/categories',
          { slug: `${t}-l3`, name: 'Level three', parentSlug: `${t}-l2` },
          options,
        )
      ).body,
    ).toEqual({ error: 'category_too_deep' });
  });
});

// ---------------------------------------------------------------- E7

describe('E7 — eligibility by service', () => {
  it('uses the service skills, minimum experience, remote delivery and channels', async () => {
    const t = token();
    await maint.query(`INSERT INTO skill (code, name, category) VALUES ($1, $1, 'Test')`, [
      `${t}_skill`,
    ]);
    const skill = `${t}_skill`;
    const seedProvider = async (
      kind: 'INDIVIDUAL' | 'COMPANY',
      experience: string,
      regions: string[],
      remote: boolean,
    ) => {
      const owner = kind === 'INDIVIDUAL' ? await createUser(maint) : null;
      const tenant =
        kind === 'COMPANY' ? await createTenant(maint, { kind: 'PROVIDER_COMPANY' }) : null;
      const providerId = randomUUID();
      await maint.query(
        `INSERT INTO provider (id, kind, tenant_id, owner_user_id, display_name, status, home_region, remote_ok)
         VALUES ($1, $2, $3, $4, $5, 'ACTIVE', 'KE-30', $6)`,
        [providerId, kind, tenant, owner, `${t} ${kind} ${experience}`, remote],
      );
      await maint.query(
        `INSERT INTO provider_application (provider_id, status, applicant_user_id) VALUES ($1, 'APPROVED', $2)`,
        [providerId, owner ?? (await createUser(maint))],
      );
      await maint.query(
        `INSERT INTO provider_skill (provider_id, skill_code, experience) VALUES ($1, $2, $3::"ExperienceBand")`,
        [providerId, skill, experience],
      );
      for (const region of regions) {
        await maint.query(
          `INSERT INTO provider_region (provider_id, region_code) VALUES ($1, $2)`,
          [providerId, region],
        );
      }
      return providerId;
    };
    const junior = await seedProvider('INDIVIDUAL', 'YEARS_1_3', ['KE-30'], false);
    const senior = await seedProvider('INDIVIDUAL', 'OVER_5_YEARS', ['KE-30'], false);
    const company = await seedProvider('COMPANY', 'YEARS_3_5', ['KE-30'], false);
    const remoteOnly = await seedProvider('INDIVIDUAL', 'OVER_5_YEARS', ['KE-01'], true);

    const category = await insertCategory(`${t}-elig`);
    const onSite = await insertService({
      slug: `${t}-onsite`,
      categoryId: category,
      skills: [[skill, 'UNDER_1_YEAR']],
    });
    const seniorOnly = await insertService({
      slug: `${t}-senior`,
      categoryId: category,
      skills: [[skill, 'YEARS_3_5']],
    });
    const remote = await insertService({
      slug: `${t}-remote`,
      categoryId: category,
      delivery: 'REMOTE',
      skills: [[skill, 'UNDER_1_YEAR']],
    });
    const individualsOnly = await insertService({
      slug: `${t}-ind`,
      categoryId: category,
      skills: [[skill, 'UNDER_1_YEAR']],
      channels: [true, true, false],
    });

    const { client, options } = await elevated(manager); // service_manager has ticket.assign
    const eligible = async (query: string) => {
      const response = await client.get(
        `/platform/providers/eligible?${query}&region=KE-30`,
        options,
      );
      expect(response.status, JSON.stringify(response.body)).toBe(200);
      return (response.body as { candidates: { providerId: string }[] }).candidates
        .map((candidate) => candidate.providerId)
        .sort();
    };
    const bySkill = await eligible(`skills=${skill}`);
    expect(await eligible(`service=${onSite}`)).toEqual(bySkill);
    expect(bySkill).toEqual([junior, senior, company].sort());
    expect(await eligible(`service=${seniorOnly}`)).toEqual([senior, company].sort());
    expect(await eligible(`service=${remote}`)).toEqual(
      [junior, senior, company, remoteOnly].sort(),
    );
    expect(await eligible(`service=${individualsOnly}`)).toEqual([junior, senior].sort());
    // Exactly one of skills / service.
    const both = await client.get(
      `/platform/providers/eligible?service=${onSite}&skills=${skill}&region=KE-30`,
      options,
    );
    expect(both.status).toBe(400);
  });
});

// ---------------------------------------------------------------- E8

describe('E8 — abuse resistance', () => {
  it('public reads are cacheable, and rate-limited per IP with a retry time', async () => {
    // The limiter counts in fixed one-minute windows. Pin its clock 10 s into a
    // window far from the real one, so the burst below can never straddle a
    // boundary (and no earlier run's counters can share the window).
    const { limit, windowSeconds } = RATE_LIMITS.cataloguePerIp;
    const windowMs = windowSeconds * 1000;
    const pinned = (Math.floor(Date.now() / windowMs) + 1_000) * windowMs + 10_000;
    const restore = stack.app.get(RateLimiter).useClock(() => pinned);
    try {
      const client = visitor();
      const first = await client.get('/catalogue/categories');
      expect(first.status).toBe(200);
      expect(first.headers['cache-control']).toBe('public, no-cache');
      // Revalidation is cheap: an unchanged answer is a 304 with no body.
      const etag = first.headers['etag'];
      expect(etag).toEqual(expect.any(String));
      const revalidated = await client.agent
        .get('/api/v1/catalogue/categories')
        .set('X-Forwarded-For', client.ip)
        .set('If-None-Match', String(etag));
      expect(revalidated.status).toBe(304);
      // Both reads above counted; the rest of the window's allowance succeeds…
      let remaining = limit - 2;
      while (remaining > 0) {
        const batch = Math.min(10, remaining);
        const responses = await Promise.all(
          Array.from({ length: batch }, async () => client.get('/catalogue/categories')),
        );
        expect(responses.map((response) => response.status)).toEqual(Array(batch).fill(200));
        remaining -= batch;
      }
      // …and the next one is refused, with the exact time left in the window.
      const refused = await client.get('/catalogue/categories');
      expect(refused.status).toBe(429);
      expect(refused.body).toEqual({
        error: 'rate_limited',
        retryAfterSeconds: windowSeconds - 10,
      });
      // Another visitor (another IP) is unaffected.
      expect((await visitor().get('/catalogue/categories')).status).toBe(200);
    } finally {
      restore();
    }
  });

  it('malformed slugs never reach the database', async () => {
    const client = visitor();
    for (const slug of ['UPPER', 'a--b', "x' OR 1=1", 'x'.repeat(101)]) {
      expect(
        (await client.get(`/catalogue/services/${encodeURIComponent(slug)}`)).status,
        slug,
      ).toBe(404);
    }
  });
});
