import { Injectable } from '@nestjs/common';
import type { Db } from '../database/index.js';

/**
 * Effective permissions of a membership: the union of its roles' permissions.
 *
 * Loaded on every request that needs them, inside the request's own workspace
 * transaction, so a role change or removal takes effect on the next request.
 * (Phase 3 plan §2.4 mentioned a per-session cache; correctness first, see the
 * plan's implementation notes.)
 */
@Injectable()
export class PermissionService {
  async forMembership(db: Db, membershipId: string): Promise<ReadonlySet<string>> {
    const grants = await db.rolePermission.findMany({
      where: { role: { memberships: { some: { membershipId } } } },
      select: { permissionCode: true },
      distinct: ['permissionCode'],
    });
    return new Set(grants.map((grant) => grant.permissionCode));
  }

  async rolesForMembership(db: Db, membershipId: string): Promise<string[]> {
    const roles = await db.membershipRole.findMany({
      where: { membershipId },
      select: { role: { select: { code: true } } },
      orderBy: { role: { code: 'asc' } },
    });
    return roles.map((grant) => grant.role.code);
  }
}
