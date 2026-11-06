#!/usr/bin/env node
/**
 * Development seed data (idempotent). Runs as ogs_maint (BYPASSRLS) because it
 * creates rows across tenants; the API never uses that role.
 *
 *   Tenant                                       User (role)
 *   PLATFORM          OGS Platform       ACTIVE   admin@ogs.test   (super_admin)
 *   ORGANISATION      Acme Kenya Ltd     ACTIVE   alice@acme.test  (org_admin)
 *   ORGANISATION      Savanna Logistics  PENDING  bob@savanna.test (org_admin, restricted)
 *   PROVIDER_COMPANY  Nairobi Tech Partners ACTIVE tech@ntp.test   (provider_admin)
 *                                                 alice@acme.test  (provider_technician)
 *   (individual provider, Phase 5)                 jane@provider.test (ACTIVE, approved)
 *
 * Every seeded user is ACTIVE (email verified) with the password SEED_USER_PASSWORD
 * from apps/api/.env. alice@acme.test has two workspaces (switcher demo).
 *
 * The permission catalogue (src/authz/catalogue.json) is synced first, the same
 * way the API does at start-up, so roles exist before they are granted.
 */
import { argon2Sync, randomBytes } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import pg from 'pg';

if (existsSync('.env')) {
  process.loadEnvFile('.env');
}
if (process.env.NODE_ENV === 'production') {
  console.error('Refusing to seed: NODE_ENV is production.');
  process.exit(1);
}
const connectionString = process.env.DATABASE_MAINT_URL;
if (!connectionString) {
  console.error('DATABASE_MAINT_URL is not set (see apps/api/.env.example).');
  process.exit(1);
}
const seedPassword = process.env.SEED_USER_PASSWORD ?? '';
if ([...seedPassword].length < 12) {
  console.error('SEED_USER_PASSWORD must be at least 12 characters (see apps/api/.env.example).');
  process.exit(1);
}

const id = (n) => `01930000-0000-7000-8000-${String(n).padStart(12, '0')}`;

const tenants = [
  [id(1), 'PLATFORM', 'ACTIVE', 'OGS Platform', 'ogs-platform'],
  [id(2), 'ORGANISATION', 'ACTIVE', 'Acme Kenya Ltd', 'acme-kenya'],
  [id(3), 'ORGANISATION', 'PENDING_APPROVAL', 'Savanna Logistics', 'savanna-logistics'],
  [id(4), 'PROVIDER_COMPANY', 'ACTIVE', 'Nairobi Tech Partners', 'nairobi-tech-partners'],
];
const users = [
  [id(101), 'admin@ogs.test'],
  [id(102), 'alice@acme.test'],
  [id(103), 'bob@savanna.test'],
  [id(104), 'tech@ntp.test'],
  [id(105), 'jane@provider.test'],
];
// [membership id, tenant, user, role code]
const memberships = [
  [id(201), id(1), id(101), 'super_admin'],
  [id(202), id(2), id(102), 'org_admin'],
  [id(203), id(3), id(103), 'org_admin'],
  [id(204), id(4), id(104), 'provider_admin'],
  [id(205), id(4), id(102), 'provider_technician'],
];

/** Same PHC format and parameters as src/identity/password-hasher.ts. */
function hashPassword(password) {
  const salt = randomBytes(16);
  const tag = argon2Sync('argon2id', {
    message: Buffer.from(password.normalize('NFKC'), 'utf8'),
    nonce: salt,
    memory: 19456,
    passes: 2,
    parallelism: 1,
    tagLength: 32,
  });
  const b64 = (b) => b.toString('base64').replace(/=+$/, '');
  return `$argon2id$v=19$m=19456,t=2,p=1$${b64(salt)}$${b64(tag)}`;
}

function loadCatalogue() {
  const raw = JSON.parse(
    readFileSync(new URL('../src/authz/catalogue.json', import.meta.url), 'utf8'),
  );
  return {
    permissions: raw.permissions,
    roles: raw.roles.map((role) => ({
      ...role,
      permissions:
        role.permissions === '*'
          ? raw.permissions.filter((p) => p.kinds.includes(role.scope)).map((p) => p.code)
          : role.permissions,
    })),
  };
}

async function syncCatalogue(client) {
  const catalogue = loadCatalogue();
  for (const p of catalogue.permissions) {
    await client.query(
      `INSERT INTO permission (code, description, allowed_kinds) VALUES ($1, $2, $3::"TenantKind"[])
       ON CONFLICT (code) DO UPDATE SET description = EXCLUDED.description, allowed_kinds = EXCLUDED.allowed_kinds`,
      [p.code, p.description, p.kinds],
    );
  }
  for (const role of catalogue.roles) {
    const { rows } = await client.query(
      `INSERT INTO role (tenant_id, scope, code, name, description, is_system)
       VALUES (NULL, $1, $2, $3, $4, true)
       ON CONFLICT (tenant_id, code) DO UPDATE SET name = EXCLUDED.name, description = EXCLUDED.description
       RETURNING id`,
      [role.scope, role.code, role.name, role.description],
    );
    for (const code of role.permissions) {
      await client.query(
        `INSERT INTO role_permission (role_id, permission_code) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
        [rows[0].id, code],
      );
    }
  }
  return catalogue.roles.length;
}

const client = new pg.Client({ connectionString, application_name: 'ogs-seed' });
await client.connect();
try {
  await client.query('BEGIN');
  const roleCount = await syncCatalogue(client);
  for (const [tenantId, kind, status, name, slug] of tenants) {
    await client.query(
      `INSERT INTO tenant (id, kind, status, name, slug) VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (id) DO NOTHING`,
      [tenantId, kind, status, name, slug],
    );
  }
  for (const [userId, email] of users) {
    await client.query(
      `INSERT INTO app_user (id, email, status) VALUES ($1, $2, 'ACTIVE')
       ON CONFLICT (id) DO UPDATE SET status = 'ACTIVE'`,
      [userId, email],
    );
    await client.query(
      `INSERT INTO credential (user_id, password_hash) VALUES ($1, $2)
       ON CONFLICT (user_id) DO UPDATE SET password_hash = EXCLUDED.password_hash,
         failed_attempts = 0, locked_until = NULL`,
      [userId, hashPassword(seedPassword)],
    );
  }
  for (const [membershipId, tenantId, userId, roleCode] of memberships) {
    await client.query(
      `INSERT INTO membership (id, tenant_id, user_id, status, joined_at)
       VALUES ($1, $2, $3, 'ACTIVE', now()) ON CONFLICT (id) DO NOTHING`,
      [membershipId, tenantId, userId],
    );
    await client.query(
      `INSERT INTO membership_role (membership_id, role_id, tenant_id)
       SELECT $1, r.id, $2 FROM role r WHERE r.tenant_id IS NULL AND r.code = $3
       ON CONFLICT DO NOTHING`,
      [membershipId, tenantId, roleCode],
    );
  }
  // Phase 4: organisation profiles and applications for the seeded organisations.
  const organisations = [
    [id(301), id(2), 'Acme Kenya Ltd', 'APPROVED', id(102)],
    [id(302), id(3), 'Savanna Logistics Ltd', 'SUBMITTED', id(103)],
  ];
  for (const [applicationId, tenantId, legalName, status, applicant] of organisations) {
    await client.query(
      `INSERT INTO organisation_profile (tenant_id, legal_name, registration_number, kra_pin,
         region, address, phone, contact_email)
       VALUES ($1, $2, 'PVT-2026-0001', 'P051234567X', 'Nairobi', 'Westlands, Nairobi',
         '+254700000000', 'info@example.test')
       ON CONFLICT (tenant_id) DO NOTHING`,
      [tenantId, legalName],
    );
    await client.query(
      `INSERT INTO organisation_application (id, tenant_id, status, applicant_user_id,
         submitted_at, decided_at)
       VALUES ($1, $2, $3::"ApplicationStatus", $4, now(),
         CASE WHEN $3::"ApplicationStatus" = 'APPROVED' THEN now() END)
       ON CONFLICT (id) DO NOTHING`,
      [applicationId, tenantId, status, applicant],
    );
  }
  // Phase 5: NTP is an approved provider company; Jane an approved individual provider.
  // [provider id, kind, tenant, owner, name, application id, applicant, skills, regions, remote]
  const providers = [
    [
      id(401),
      'COMPANY',
      id(4),
      null,
      'Nairobi Tech Partners',
      id(411),
      id(104),
      [
        ['networking', 'OVER_5_YEARS'],
        ['structured_cabling', 'YEARS_3_5'],
        ['cctv', 'YEARS_1_3'],
      ],
      ['KE-30', 'KE-13', 'KE-22'],
      false,
    ],
    [
      id(402),
      'INDIVIDUAL',
      null,
      id(105),
      'Jane Wanjiru',
      id(412),
      id(105),
      [
        ['desktop_support', 'YEARS_3_5'],
        ['microsoft_365', 'YEARS_1_3'],
      ],
      ['KE-30'],
      true,
    ],
  ];
  for (const [
    providerId,
    kind,
    tenantId,
    ownerId,
    name,
    applicationId,
    applicant,
    skills,
    regions,
    remote,
  ] of providers) {
    await client.query(
      `INSERT INTO provider (id, kind, tenant_id, owner_user_id, display_name, status, phone,
         home_region, remote_ok)
       VALUES ($1, $2, $3, $4, $5, 'ACTIVE', '+254700000001', 'KE-30', $6)
       ON CONFLICT (id) DO NOTHING`,
      [providerId, kind, tenantId, ownerId, name, remote],
    );
    await client.query(
      `INSERT INTO provider_application (id, provider_id, status, applicant_user_id,
         submitted_at, decided_at)
       VALUES ($1, $2, 'APPROVED', $3, now(), now()) ON CONFLICT (id) DO NOTHING`,
      [applicationId, providerId, applicant],
    );
    for (const [skillCode, experience] of skills) {
      await client.query(
        `INSERT INTO provider_skill (provider_id, skill_code, experience)
         VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
        [providerId, skillCode, experience],
      );
    }
    for (const regionCode of regions) {
      await client.query(
        `INSERT INTO provider_region (provider_id, region_code) VALUES ($1, $2)
         ON CONFLICT DO NOTHING`,
        [providerId, regionCode],
      );
    }
    // Monday to Friday 08:00-17:00 (Africa/Nairobi), once.
    await client.query(
      `INSERT INTO provider_working_hours (provider_id, weekday, start_minute, end_minute)
       SELECT $1, d, 480, 1020 FROM generate_series(1, 5) AS d
        WHERE NOT EXISTS (SELECT 1 FROM provider_working_hours WHERE provider_id = $1)`,
      [providerId],
    );
  }
  await client.query('COMMIT');
  console.log(
    `Seeded ${roleCount} system roles, ${tenants.length} tenants, ${users.length} users ` +
      `(password: SEED_USER_PASSWORD), ${memberships.length} memberships with roles, 2 providers.`,
  );
} catch (error) {
  await client.query('ROLLBACK');
  throw error;
} finally {
  await client.end();
}
