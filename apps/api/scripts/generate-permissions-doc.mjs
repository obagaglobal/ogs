#!/usr/bin/env node
/**
 * Regenerates docs/architecture/permissions.md from src/authz/catalogue.json.
 * Run after editing the catalogue: `pnpm --filter @ogs/api docs:permissions`.
 * A unit test fails if the document and the catalogue disagree.
 */
import { readFileSync, writeFileSync } from 'node:fs';

const catalogue = JSON.parse(
  readFileSync(new URL('../src/authz/catalogue.json', import.meta.url), 'utf8'),
);
const target = new URL('../../../docs/architecture/permissions.md', import.meta.url);

const KIND = { ORGANISATION: 'Org', PROVIDER_COMPANY: 'Provider co.', PLATFORM: 'Platform' };
const roles = catalogue.roles.map((role) => ({
  ...role,
  permissions:
    role.permissions === '*'
      ? catalogue.permissions.filter((p) => p.kinds.includes(role.scope)).map((p) => p.code)
      : role.permissions,
}));

const lines = [
  '# Permissions and system roles',
  '',
  '> Generated from `apps/api/src/authz/catalogue.json` by `pnpm --filter @ogs/api docs:permissions`. Do not edit by hand.',
  '',
  'Permissions are platform-defined `resource.action` codes (review §8). Each may only be used in the tenant kinds listed; a database trigger and the catalogue loader both enforce that an organisation or provider role never holds a `platform.*` permission. Organisations may build custom roles from the permissions allowed for their kind (Phase 4).',
  '',
  'Endpoints declare `@RequirePermission(code)`. Scoping rules such as "own", "department" or "assigned" are applied by each endpoint on top of the permission.',
  '',
  '## Permissions',
  '',
  '| Code | Usable in | Meaning |',
  '| --- | --- | --- |',
  ...catalogue.permissions.map(
    (p) => `| \`${p.code}\` | ${p.kinds.map((k) => KIND[k]).join(', ')} | ${p.description} |`,
  ),
  '',
  '## System roles',
  '',
  '| Role | Kind | Description | Permissions |',
  '| --- | --- | --- | --- |',
  ...roles.map(
    (r) =>
      `| \`${r.code}\` (${r.name}) | ${KIND[r.scope]} | ${r.description} | ${r.permissions.map((c) => `\`${c}\``).join(', ')} |`,
  ),
  '',
];
writeFileSync(target, lines.join('\n'));
console.log(`Wrote ${catalogue.permissions.length} permissions and ${roles.length} roles.`);
