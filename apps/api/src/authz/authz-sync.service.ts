import { Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import { TenantDb, type Db } from '../database/index.js';
import { CATALOGUE, type Catalogue } from './catalogue.js';

/** Arbitrary constant: serialises concurrent syncs from several API instances. */
const SYNC_LOCK_KEY = 0x4f47_5301;

export interface SyncResult {
  readonly permissions: number;
  readonly roles: number;
  readonly grantsAdded: number;
  readonly grantsRemoved: number;
}

/**
 * Makes the database match catalogue.json (review §8: "roles are seeded bundles").
 *
 * Runs at API start-up in a `system` context with job `authz.sync`, the only
 * context RLS lets write system roles and permissions. Idempotent and
 * transactional; concurrent instances serialise on an advisory transaction lock.
 * Permissions removed from the catalogue are reported, not deleted (they may be
 * referenced by custom roles).
 */
@Injectable()
export class AuthzSyncService implements OnApplicationBootstrap {
  private readonly logger = new Logger(AuthzSyncService.name);

  constructor(private readonly db: TenantDb) {}

  async onApplicationBootstrap(): Promise<void> {
    const result = await this.sync();
    this.logger.log(
      `Authorisation catalogue synced: ${String(result.permissions)} permissions, ` +
        `${String(result.roles)} system roles, +${String(result.grantsAdded)}/-${String(result.grantsRemoved)} grants`,
    );
  }

  async sync(catalogue: Catalogue = CATALOGUE): Promise<SyncResult> {
    return this.db.run({ kind: 'system', job: 'authz.sync' }, async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(${SYNC_LOCK_KEY})`;

      for (const permission of catalogue.permissions) {
        await tx.permission.upsert({
          where: { code: permission.code },
          create: {
            code: permission.code,
            description: permission.description,
            allowedKinds: [...permission.kinds],
          },
          update: { description: permission.description, allowedKinds: [...permission.kinds] },
        });
      }
      await this.reportUnknownPermissions(tx, catalogue);

      let grantsAdded = 0;
      let grantsRemoved = 0;
      for (const role of catalogue.roles) {
        const [row] = await tx.$queryRaw<{ id: string }[]>`
          INSERT INTO role (tenant_id, scope, code, name, description, is_system)
          VALUES (NULL, ${role.scope}::"TenantKind", ${role.code}, ${role.name}, ${role.description}, true)
          ON CONFLICT (tenant_id, code) DO UPDATE
             SET name = EXCLUDED.name, description = EXCLUDED.description, scope = EXCLUDED.scope
          RETURNING id`;
        if (row === undefined) {
          throw new Error(`Could not upsert system role ${role.code}`);
        }

        const current = await tx.rolePermission.findMany({
          where: { roleId: row.id },
          select: { permissionCode: true },
        });
        const have = new Set(current.map((grant) => grant.permissionCode));
        const want = new Set(role.permissions);

        const toRemove = [...have].filter((code) => !want.has(code));
        if (toRemove.length > 0) {
          const removed = await tx.rolePermission.deleteMany({
            where: { roleId: row.id, permissionCode: { in: toRemove } },
          });
          grantsRemoved += removed.count;
        }
        const toAdd = [...want].filter((code) => !have.has(code));
        if (toAdd.length > 0) {
          const added = await tx.rolePermission.createMany({
            data: toAdd.map((permissionCode) => ({ roleId: row.id, permissionCode })),
            skipDuplicates: true,
          });
          grantsAdded += added.count;
        }
      }

      return {
        permissions: catalogue.permissions.length,
        roles: catalogue.roles.length,
        grantsAdded,
        grantsRemoved,
      };
    });
  }

  private async reportUnknownPermissions(tx: Db, catalogue: Catalogue): Promise<void> {
    const known = catalogue.permissions.map((permission) => permission.code);
    const stale = await tx.permission.findMany({
      where: { code: { notIn: known } },
      select: { code: true },
    });
    if (stale.length > 0) {
      this.logger.warn(
        `Permissions in the database but not in the catalogue (left in place): ${stale
          .map((p) => p.code)
          .join(', ')}`,
      );
    }
  }
}
