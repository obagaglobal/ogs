import { z } from 'zod';
import rawCatalogue from './catalogue.json' with { type: 'json' };

const tenantKind = z.enum(['ORGANISATION', 'PROVIDER_COMPANY', 'PLATFORM']);
export type ScopeKind = z.infer<typeof tenantKind>;

const permissionCode = z.string().regex(/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/);

const catalogueSchema = z.object({
  permissions: z
    .array(
      z.object({
        code: permissionCode,
        kinds: z.array(tenantKind).min(1),
        description: z.string().min(1).max(300),
      }),
    )
    .min(1),
  roles: z
    .array(
      z.object({
        code: z.string().regex(/^[a-z][a-z0-9_]*$/),
        scope: tenantKind,
        name: z.string().min(1).max(150),
        description: z.string().max(300),
        /** "*" = every permission allowed for the role's scope. */
        permissions: z.union([z.literal('*'), z.array(permissionCode).min(1)]),
      }),
    )
    .min(1),
});

export interface CataloguePermission {
  readonly code: string;
  readonly kinds: readonly ScopeKind[];
  readonly description: string;
}

export interface CatalogueRole {
  readonly code: string;
  readonly scope: ScopeKind;
  readonly name: string;
  readonly description: string;
  /** Expanded: never "*". */
  readonly permissions: readonly string[];
}

export interface Catalogue {
  readonly permissions: readonly CataloguePermission[];
  readonly roles: readonly CatalogueRole[];
}

/**
 * Parses and cross-checks the catalogue. Throws on any inconsistency, so a bad
 * edit fails unit tests and API start-up instead of reaching the database.
 */
export function parseCatalogue(raw: unknown): Catalogue {
  const parsed = catalogueSchema.parse(raw);
  const byCode = new Map<string, CataloguePermission>();
  for (const permission of parsed.permissions) {
    if (byCode.has(permission.code)) {
      throw new Error(`Duplicate permission ${permission.code}`);
    }
    if (permission.code.startsWith('platform.') && permission.kinds.some((k) => k !== 'PLATFORM')) {
      throw new Error(`${permission.code}: platform.* permissions may only be used in PLATFORM`);
    }
    byCode.set(permission.code, permission);
  }

  const roleKeys = new Set<string>();
  const roles = parsed.roles.map((role): CatalogueRole => {
    if (roleKeys.has(role.code)) {
      throw new Error(`Duplicate role ${role.code}`);
    }
    roleKeys.add(role.code);
    const permissions =
      role.permissions === '*'
        ? parsed.permissions.filter((p) => p.kinds.includes(role.scope)).map((p) => p.code)
        : role.permissions;
    for (const code of permissions) {
      const permission = byCode.get(code);
      if (permission === undefined) {
        throw new Error(`Role ${role.code} references unknown permission ${code}`);
      }
      if (!permission.kinds.includes(role.scope)) {
        throw new Error(`Role ${role.code} (${role.scope}) cannot hold ${code}`);
      }
    }
    if (new Set(permissions).size !== permissions.length) {
      throw new Error(`Role ${role.code} lists a permission twice`);
    }
    return { ...role, permissions };
  });

  return { permissions: parsed.permissions, roles };
}

export const CATALOGUE: Catalogue = parseCatalogue(rawCatalogue);

/** Every permission code, for compile-time-ish checks in decorators and tests. */
export const PERMISSION_CODES: ReadonlySet<string> = new Set(
  CATALOGUE.permissions.map((permission) => permission.code),
);
