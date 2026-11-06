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
 *   Catalogue (Phase 6): 8 categories, 17 published services, one draft, one retired.
 *   Billing (Phase 7): Acme Kenya Ltd is postpaid (30 days); others prepay.
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
  // Phase 6: the service catalogue. Prices in minor units (cents), excluding VAT.
  // [id, slug, name, icon, position, parent id]
  const categories = [
    [id(501), 'networks', 'Networks & Wi-Fi', 'network', 1, null],
    [id(502), 'wifi', 'Wi-Fi', 'wifi', 1, id(501)],
    [id(503), 'structured-cabling', 'Structured cabling', 'network', 2, id(501)],
    [id(504), 'security-systems', 'CCTV & access control', 'cctv', 2, null],
    [id(505), 'computers-printers', 'Computers & printers', 'laptop', 3, null],
    [id(506), 'cloud-productivity', 'Cloud & productivity', 'cloud', 4, null],
    [id(507), 'servers-backup', 'Servers, backup & recovery', 'server', 5, null],
    [id(508), 'business-systems', 'POS & telephony', 'store', 6, null],
  ];
  for (const [categoryId, slug, name, icon, position, parentId] of categories) {
    await client.query(
      `INSERT INTO service_category (id, slug, name, icon, position, parent_id)
       VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (id) DO NOTHING`,
      [categoryId, slug, name, icon, position, parentId],
    );
  }
  const S = (n, category, slug, name, summary, price, skills, extra = {}) => ({
    id: id(n),
    category: id(category),
    slug,
    name,
    summary,
    price,
    skills,
    status: extra.status ?? 'PUBLISHED',
    audience: extra.audience ?? 'ALL',
    delivery: extra.delivery ?? 'ON_SITE',
    inclusions: extra.inclusions ?? [],
    duration: extra.duration ?? null,
  });
  // price: [model, amount minor | null, unit | null, min quantity]
  const services = [
    S(
      601,
      502,
      'wifi-site-survey',
      'Wi-Fi site survey',
      'Find the dead spots and plan access points before you buy.',
      ['FIXED', 850000, null, 1],
      [['wifi', 'YEARS_1_3']],
      {
        inclusions: [
          'Signal heat map of your premises',
          'Access point placement plan',
          'Written report',
        ],
        duration: 'Half a day',
      },
    ),
    S(
      602,
      502,
      'home-wifi-setup',
      'Home Wi-Fi setup',
      'Router set-up, secure password and coverage check for your home.',
      ['FIXED', 350000, null, 1],
      [['wifi', 'UNDER_1_YEAR']],
      {
        audience: 'INDIVIDUALS',
        inclusions: ['Router configuration', 'WPA3/WPA2 security', 'Coverage check in every room'],
        duration: '1–2 hours',
      },
    ),
    S(
      603,
      502,
      'office-wifi-installation',
      'Office Wi-Fi installation',
      'Business-grade Wi-Fi with guest network and central management.',
      ['FROM', 4500000, null, 1],
      [
        ['wifi', 'YEARS_3_5'],
        ['networking', 'YEARS_3_5'],
      ],
      {
        audience: 'ORGANISATIONS',
        inclusions: [
          'Access points mounted and configured',
          'Separate guest network',
          'Handover documentation',
        ],
      },
    ),
    S(
      604,
      501,
      'network-troubleshooting',
      'Network troubleshooting',
      'Slow or dropping network? A technician finds and fixes the cause.',
      ['PER_UNIT', 250000, 'HOUR', 2],
      [['networking', 'YEARS_1_3']],
      { delivery: 'BOTH', inclusions: ['Diagnosis', 'Fix or written recommendation'] },
    ),
    S(
      605,
      503,
      'structured-cabling-per-point',
      'Structured cabling (per point)',
      'Cat6 data points terminated, labelled and tested.',
      ['PER_UNIT', 250000, 'POINT', 10],
      [['structured_cabling', 'YEARS_1_3']],
      {
        audience: 'ORGANISATIONS',
        inclusions: [
          'Cat6 cable up to 30 m per point',
          'Faceplate and patch panel termination',
          'Test report',
        ],
      },
    ),
    S(
      606,
      504,
      'cctv-installation',
      'CCTV installation',
      'Cameras, recorder and phone viewing, installed and configured.',
      ['FROM', 2500000, null, 1],
      [['cctv', 'YEARS_1_3']],
      { inclusions: ['Camera mounting and cabling', 'Recorder set-up', 'Mobile app viewing'] },
    ),
    S(
      607,
      504,
      'cctv-maintenance-visit',
      'CCTV maintenance visit',
      'Cleaning, focus, recording check and firmware updates.',
      ['PER_UNIT', 400000, 'VISIT', 1],
      [['cctv', 'UNDER_1_YEAR']],
    ),
    S(
      608,
      504,
      'access-control-installation',
      'Access control installation',
      'Card or biometric door access for offices and gates.',
      ['QUOTE', null, null, 1],
      [['access_control', 'YEARS_3_5']],
      { audience: 'ORGANISATIONS' },
    ),
    S(
      609,
      505,
      'laptop-repair-diagnosis',
      'Laptop repair diagnosis',
      'Find out what is wrong and what the repair will cost.',
      ['FIXED', 150000, null, 1],
      [['hardware_repair', 'YEARS_1_3']],
      { inclusions: ['Hardware and software diagnosis', 'Written repair quotation'] },
    ),
    S(
      610,
      505,
      'printer-repair',
      'Printer repair',
      'Paper jams, print quality and connectivity problems fixed.',
      ['FIXED', 250000, null, 1],
      [['printer_repair', 'YEARS_1_3']],
    ),
    S(
      611,
      505,
      'desktop-support-per-device',
      'Desktop support (per device)',
      'Monthly-style health check and fixes for your office computers.',
      ['PER_UNIT', 120000, 'DEVICE', 5],
      [['desktop_support', 'YEARS_1_3']],
      { audience: 'ORGANISATIONS', delivery: 'BOTH' },
    ),
    S(
      612,
      506,
      'microsoft-365-setup',
      'Microsoft 365 setup',
      'Email, Teams and OneDrive set up for your staff, with security defaults.',
      ['PER_UNIT', 100000, 'USER', 5],
      [['microsoft_365', 'YEARS_1_3']],
      {
        audience: 'ORGANISATIONS',
        delivery: 'REMOTE',
        inclusions: [
          'Domain and email set-up',
          'User accounts and licences',
          'Multi-factor authentication',
        ],
      },
    ),
    S(
      613,
      506,
      'google-workspace-migration',
      'Google Workspace migration',
      'Move mail and files to Google Workspace with no lost messages.',
      ['QUOTE', null, null, 1],
      [['google_workspace', 'YEARS_3_5']],
      { audience: 'ORGANISATIONS', delivery: 'REMOTE' },
    ),
    S(
      614,
      507,
      'data-recovery',
      'Data recovery',
      'Recover files from failed disks, phones and memory cards.',
      ['FROM', 500000, null, 1],
      [['data_recovery', 'YEARS_3_5']],
      { delivery: 'BOTH' },
    ),
    S(
      615,
      507,
      'server-setup',
      'Server setup',
      'Windows or Linux server installed, secured and backed up.',
      ['QUOTE', null, null, 1],
      [
        ['windows_server', 'YEARS_3_5'],
        ['linux_administration', 'YEARS_1_3'],
      ],
      { audience: 'ORGANISATIONS', delivery: 'BOTH' },
    ),
    S(
      616,
      508,
      'pos-installation',
      'POS system installation',
      'Till, receipt printer and scanner installed and connected to M-Pesa.',
      ['FIXED', 1200000, null, 1],
      [['pos_systems', 'YEARS_1_3']],
      { audience: 'ORGANISATIONS' },
    ),
    S(
      617,
      508,
      'voip-phone-setup',
      'VoIP phone setup',
      'Office desk phones and extensions over your internet line.',
      ['PER_UNIT', 300000, 'DEVICE', 3],
      [['telephony_voip', 'YEARS_1_3']],
      { audience: 'ORGANISATIONS', delivery: 'BOTH' },
    ),
    S(
      618,
      505,
      'smart-home-automation',
      'Smart home automation',
      'Draft: not visible to the public until published.',
      ['FIXED', 2000000, null, 1],
      [['networking', 'YEARS_1_3']],
      { status: 'DRAFT' },
    ),
    S(
      619,
      501,
      'dial-up-modem-setup',
      'Dial-up modem setup',
      'Retired: hidden from the public catalogue.',
      ['FIXED', 100000, null, 1],
      [['networking', 'UNDER_1_YEAR']],
      { status: 'RETIRED' },
    ),
  ];
  for (const s of services) {
    await client.query(
      `INSERT INTO service (id, category_id, slug, name, summary, description, inclusions,
         typical_duration, audience, delivery_mode, status, published_at, retired_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::"ServiceAudience", $10::"DeliveryMode",
         $11::"ServiceStatus",
         CASE WHEN $11::"ServiceStatus" <> 'DRAFT' THEN now() END,
         CASE WHEN $11::"ServiceStatus" = 'RETIRED' THEN now() END)
       ON CONFLICT (id) DO NOTHING`,
      [
        s.id,
        s.category,
        s.slug,
        s.name,
        s.summary,
        `${s.summary}\n\nPrices exclude VAT.`,
        s.inclusions,
        s.duration,
        s.audience,
        s.delivery,
        s.status,
      ],
    );
    const [model, amount, unit, minQuantity] = s.price;
    await client.query(
      `INSERT INTO service_price (service_id, model, amount_minor, unit, min_quantity)
       SELECT $1, $2::"PriceModel", $3, $4::"PriceUnit", $5
        WHERE NOT EXISTS (SELECT 1 FROM service_price WHERE service_id = $1)`,
      [s.id, model, amount, unit, minQuantity],
    );
    for (const [skill, minExperience] of s.skills) {
      await client.query(
        `INSERT INTO service_skill (service_id, skill_code, min_experience)
         VALUES ($1, $2, $3::"ExperienceBand") ON CONFLICT DO NOTHING`,
        [s.id, skill, minExperience],
      );
    }
  }
  // Phase 7: Acme is a postpaid organisation (30 days); everyone else prepays.
  await client.query(
    `INSERT INTO organisation_billing (tenant_id, payment_terms, net_days)
     VALUES ($1, 'POSTPAID', 30) ON CONFLICT (tenant_id) DO NOTHING`,
    [id(2)],
  );
  await client.query('COMMIT');
  console.log(
    `Seeded ${roleCount} system roles, ${tenants.length} tenants, ${users.length} users ` +
      `(password: SEED_USER_PASSWORD), ${memberships.length} memberships with roles, 2 providers, ${categories.length} categories, ${services.length} services.`,
  );
} catch (error) {
  await client.query('ROLLBACK');
  throw error;
} finally {
  await client.end();
}
