import { describe, expect, it } from 'vitest';
import rawCatalogue from './catalogue.json' with { type: 'json' };
import { CATALOGUE, parseCatalogue } from './catalogue.js';

describe('authorisation catalogue', () => {
  it('parses and every role only holds permissions allowed for its scope', () => {
    for (const role of CATALOGUE.roles) {
      for (const code of role.permissions) {
        const permission = CATALOGUE.permissions.find((p) => p.code === code);
        expect(permission?.kinds, `${role.code} → ${code}`).toContain(role.scope);
      }
    }
  });

  it('no organisation or provider role holds a platform.* permission', () => {
    const offenders = CATALOGUE.roles
      .filter((role) => role.scope !== 'PLATFORM')
      .flatMap((role) => role.permissions.filter((code) => code.startsWith('platform.')));
    expect(offenders).toEqual([]);
  });

  it('expands "*" to every permission of the scope', () => {
    const orgAdmin = CATALOGUE.roles.find((role) => role.code === 'org_admin');
    const orgPermissions = CATALOGUE.permissions.filter((p) => p.kinds.includes('ORGANISATION'));
    expect(orgAdmin?.permissions).toHaveLength(orgPermissions.length);
  });

  it('seeds every role named in review §8 and spec §4.6', () => {
    expect(CATALOGUE.roles.map((role) => role.code).sort()).toEqual(
      [
        'compliance',
        'customer_support_officer',
        'field_engineer',
        'finance',
        'helpdesk',
        'ict_support_manager',
        'operations_manager',
        'org_admin',
        'org_employee',
        'provider_admin',
        'provider_relationship_manager',
        'provider_technician',
        'service_manager',
        'super_admin',
        'technician',
      ].sort(),
    );
  });

  it('rejects a role holding a permission outside its scope', () => {
    const bad = structuredClone(rawCatalogue) as {
      roles: { code: string; permissions: unknown }[];
    };
    const employee = bad.roles.find((role) => role.code === 'org_employee');
    if (employee === undefined) {
      throw new Error('fixture');
    }
    employee.permissions = ['workspace.read', 'platform.settings.manage'];
    expect(() => parseCatalogue(bad)).toThrow(/cannot hold platform\.settings\.manage/);
  });

  it('rejects a platform.* permission usable outside PLATFORM', () => {
    const bad = structuredClone(rawCatalogue) as {
      permissions: { code: string; kinds: string[] }[];
    };
    const permission = bad.permissions.find((p) => p.code === 'platform.settings.manage');
    if (permission === undefined) {
      throw new Error('fixture');
    }
    permission.kinds = ['PLATFORM', 'ORGANISATION'];
    expect(() => parseCatalogue(bad)).toThrow(/may only be used in PLATFORM/);
  });
});

describe('docs/architecture/permissions.md', () => {
  it('documents every permission and role in the catalogue (regenerate with docs:permissions)', async () => {
    const { readFile } = await import('node:fs/promises');
    const doc = await readFile(
      new URL('../../../../docs/architecture/permissions.md', import.meta.url),
      'utf8',
    );
    for (const permission of CATALOGUE.permissions) {
      expect(doc, permission.code).toContain(`\`${permission.code}\``);
    }
    for (const role of CATALOGUE.roles) {
      expect(doc, role.code).toContain(`\`${role.code}\``);
    }
  });
});
