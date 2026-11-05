#!/usr/bin/env node
/**
 * Development seed data (idempotent). Runs as ogs_maint (BYPASSRLS) because it
 * creates rows across tenants; the API never uses that role.
 *
 *   PLATFORM          OGS Platform               ACTIVE   admin@ogs.test
 *   ORGANISATION      Acme Kenya Ltd             ACTIVE   alice@acme.test
 *   ORGANISATION      Savanna Logistics          PENDING  bob@savanna.test
 *   PROVIDER_COMPANY  Nairobi Tech Partners      ACTIVE   tech@ntp.test, alice@acme.test
 *
 * alice@acme.test belongs to two tenants, to exercise the workspace switcher.
 */
import { existsSync } from 'node:fs';
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
];
const memberships = [
  [id(201), id(1), id(101)],
  [id(202), id(2), id(102)],
  [id(203), id(3), id(103)],
  [id(204), id(4), id(104)],
  [id(205), id(4), id(102)],
];

const client = new pg.Client({ connectionString, application_name: 'ogs-seed' });
await client.connect();
try {
  await client.query('BEGIN');
  for (const [tenantId, kind, status, name, slug] of tenants) {
    await client.query(
      `INSERT INTO tenant (id, kind, status, name, slug) VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (id) DO NOTHING`,
      [tenantId, kind, status, name, slug],
    );
  }
  for (const [userId, email] of users) {
    await client.query(
      `INSERT INTO app_user (id, email, status) VALUES ($1, $2, 'ACTIVE') ON CONFLICT (id) DO NOTHING`,
      [userId, email],
    );
  }
  for (const [membershipId, tenantId, userId] of memberships) {
    await client.query(
      `INSERT INTO membership (id, tenant_id, user_id, status, joined_at)
       VALUES ($1, $2, $3, 'ACTIVE', now()) ON CONFLICT (id) DO NOTHING`,
      [membershipId, tenantId, userId],
    );
  }
  await client.query('COMMIT');
  console.log(
    `Seeded ${tenants.length} tenants, ${users.length} users, ${memberships.length} memberships.`,
  );
} catch (error) {
  await client.query('ROLLBACK');
  throw error;
} finally {
  await client.end();
}
