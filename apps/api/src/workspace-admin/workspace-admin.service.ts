import { Injectable } from '@nestjs/common';
import type { Department, Role } from '@ogs/contracts';
import { AuditService, type AuditRequestMeta } from '../audit/audit.service.js';
import { CATALOGUE } from '../authz/catalogue.js';
import { conflict, isLastAdminViolation, notFound } from '../common/domain-error.js';
import {
  MembershipStatus,
  Prisma,
  TenantDb,
  type DbContext,
  type TenantKind,
} from '../database/index.js';
import { assertDepartmentUsable, assertRolesUsable } from '../invitations/invitation.service.js';
import { tenantOf } from '../organisations/organisation.service.js';

const SYSTEM_ROLE_CODES: ReadonlySet<string> = new Set(CATALOGUE.roles.map((role) => role.code));

export interface MemberChange {
  readonly status?: 'ACTIVE' | 'SUSPENDED' | 'ENDED' | undefined;
  readonly departmentId?: string | null | undefined;
}

export interface CreateRoleInput {
  readonly code: string;
  readonly name: string;
  readonly description?: string | null | undefined;
  readonly permissions: readonly string[];
}

export interface RoleInput {
  readonly name?: string | undefined;
  readonly description?: string | null | undefined;
  readonly permissions?: readonly string[] | undefined;
}

/**
 * Members, custom roles and departments of a workspace (Phase 4 plan §2.4).
 * The database guarantees the last ACTIVE admin can never disappear (deferred
 * trigger); this service turns that into a clean 409 `last_admin`.
 */
@Injectable()
export class WorkspaceAdminService {
  constructor(
    private readonly db: TenantDb,
    private readonly audit: AuditService,
  ) {}

  // ------------------------------------------------------------------ members

  async updateMember(
    ctx: DbContext,
    membershipId: string,
    change: MemberChange,
    actorUserId: string,
    meta: AuditRequestMeta,
  ): Promise<void> {
    const tenantId = tenantOf(ctx);
    await this.guardLastAdmin(() =>
      this.db.run(ctx, async (tx) => {
        const member = await tx.membership.findFirst({
          where: { id: membershipId, tenantId },
          select: { id: true, userId: true, status: true, departmentId: true },
        });
        if (member === null) {
          throw notFound();
        }
        if (change.status !== undefined && member.userId === actorUserId) {
          throw conflict('cannot_change_own_membership');
        }
        if (change.status !== undefined && member.status === MembershipStatus.ENDED) {
          throw conflict('membership_ended');
        }
        if (change.departmentId !== undefined && change.departmentId !== null) {
          await assertDepartmentUsable(tx, tenantId, change.departmentId);
        }
        await tx.membership.update({
          where: { id: member.id },
          data: {
            ...(change.status === undefined
              ? {}
              : { status: change.status, endedAt: change.status === 'ENDED' ? new Date() : null }),
            ...(change.departmentId === undefined ? {} : { departmentId: change.departmentId }),
          },
          select: { id: true },
        });
        await this.audit.record(tx, {
          action: 'membership.updated',
          tenantId,
          entityType: 'membership',
          entityId: member.id,
          request: meta,
          metadata: {
            before: { status: member.status, departmentId: member.departmentId },
            after: {
              status: change.status ?? member.status,
              departmentId: change.departmentId ?? member.departmentId,
            },
          },
        });
      }),
    );
  }

  async setMemberRoles(
    ctx: DbContext,
    kind: TenantKind,
    membershipId: string,
    roleIds: readonly string[],
    meta: AuditRequestMeta,
  ): Promise<void> {
    const tenantId = tenantOf(ctx);
    await this.guardLastAdmin(() =>
      this.db.run(ctx, async (tx) => {
        const member = await tx.membership.findFirst({
          where: { id: membershipId, tenantId },
          select: { id: true, roles: { select: { role: { select: { code: true } } } } },
        });
        if (member === null) {
          throw notFound();
        }
        await assertRolesUsable(tx, tenantId, kind, roleIds);
        await tx.membershipRole.deleteMany({ where: { membershipId: member.id } });
        await tx.membershipRole.createMany({
          data: [...new Set(roleIds)].map((roleId) => ({
            membershipId: member.id,
            roleId,
            tenantId,
          })),
        });
        await this.audit.record(tx, {
          action: 'membership.roles_changed',
          tenantId,
          entityType: 'membership',
          entityId: member.id,
          request: meta,
          metadata: {
            before: member.roles.map((grant) => grant.role.code),
            afterRoleIds: [...roleIds],
          },
        });
      }),
    );
  }

  /** The caller leaves the workspace (refused for the last admin). */
  async leave(ctx: DbContext, userId: string, meta: AuditRequestMeta): Promise<void> {
    const tenantId = tenantOf(ctx);
    await this.guardLastAdmin(() =>
      this.db.run(ctx, async (tx) => {
        const changed = await tx.membership.updateMany({
          where: { tenantId, userId, status: { not: MembershipStatus.ENDED } },
          data: { status: MembershipStatus.ENDED, endedAt: new Date() },
        });
        if (changed.count !== 1) {
          throw notFound();
        }
        await this.audit.record(tx, {
          action: 'membership.left',
          tenantId,
          entityType: 'user',
          entityId: userId,
          request: meta,
        });
      }),
    );
  }

  // ------------------------------------------------------------------ roles

  permissionsFor(kind: TenantKind) {
    return CATALOGUE.permissions
      .filter((permission) => permission.kinds.includes(kind))
      .map(({ code, description }) => ({ code, description }));
  }

  async roles(ctx: DbContext, kind: TenantKind): Promise<Role[]> {
    const tenantId = tenantOf(ctx);
    const rows = await this.db.run(ctx, async (tx) =>
      tx.role.findMany({
        where: { scope: kind, OR: [{ tenantId: null }, { tenantId }] },
        select: {
          id: true,
          code: true,
          name: true,
          description: true,
          isSystem: true,
          permissions: { select: { permissionCode: true }, orderBy: { permissionCode: 'asc' } },
        },
        orderBy: [{ isSystem: 'desc' }, { name: 'asc' }],
      }),
    );
    return rows.map(({ permissions, ...role }) => ({
      ...role,
      permissions: permissions.map((grant) => grant.permissionCode),
    }));
  }

  async createRole(
    ctx: DbContext,
    kind: TenantKind,
    input: CreateRoleInput,
    meta: AuditRequestMeta,
  ): Promise<Role> {
    const tenantId = tenantOf(ctx);
    if (SYSTEM_ROLE_CODES.has(input.code)) {
      throw conflict('role_code_taken');
    }
    this.assertPermissionsAllowed(kind, input.permissions);
    try {
      return await this.db.run(ctx, async (tx) => {
        const role = await tx.role.create({
          data: {
            tenantId,
            scope: kind,
            code: input.code,
            name: input.name,
            description: input.description ?? null,
            isSystem: false,
          },
          select: { id: true },
        });
        await tx.rolePermission.createMany({
          data: [...new Set(input.permissions)].map((permissionCode) => ({
            roleId: role.id,
            permissionCode,
          })),
        });
        await this.audit.record(tx, {
          action: 'role.created',
          tenantId,
          entityType: 'role',
          entityId: role.id,
          request: meta,
          metadata: { code: input.code, permissions: [...input.permissions] },
        });
        return this.roleById(tx, role.id);
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw conflict('role_code_taken');
      }
      throw error;
    }
  }

  async updateRole(
    ctx: DbContext,
    kind: TenantKind,
    roleId: string,
    input: RoleInput,
    meta: AuditRequestMeta,
  ) {
    const tenantId = tenantOf(ctx);
    if (input.permissions !== undefined) {
      this.assertPermissionsAllowed(kind, input.permissions);
    }
    return this.db.run(ctx, async (tx) => {
      await this.customRole(tx, tenantId, roleId);
      await tx.role.update({
        where: { id: roleId },
        data: {
          ...(input.name === undefined ? {} : { name: input.name }),
          ...(input.description === undefined ? {} : { description: input.description }),
          version: { increment: 1 },
        },
        select: { id: true },
      });
      if (input.permissions !== undefined) {
        await tx.rolePermission.deleteMany({ where: { roleId } });
        await tx.rolePermission.createMany({
          data: [...new Set(input.permissions)].map((permissionCode) => ({
            roleId,
            permissionCode,
          })),
        });
      }
      await this.audit.record(tx, {
        action: 'role.updated',
        tenantId,
        entityType: 'role',
        entityId: roleId,
        request: meta,
        metadata: { permissions: input.permissions === undefined ? null : [...input.permissions] },
      });
      return this.roleById(tx, roleId);
    });
  }

  async deleteRole(ctx: DbContext, roleId: string, meta: AuditRequestMeta): Promise<void> {
    const tenantId = tenantOf(ctx);
    await this.db.run(ctx, async (tx) => {
      await this.customRole(tx, tenantId, roleId);
      if ((await tx.membershipRole.count({ where: { roleId } })) > 0) {
        throw conflict('role_in_use');
      }
      await tx.rolePermission.deleteMany({ where: { roleId } });
      await tx.role.delete({ where: { id: roleId }, select: { id: true } });
      await this.audit.record(tx, {
        action: 'role.deleted',
        tenantId,
        entityType: 'role',
        entityId: roleId,
        request: meta,
      });
    });
  }

  // ------------------------------------------------------------------ departments

  async departments(ctx: DbContext): Promise<Department[]> {
    const tenantId = tenantOf(ctx);
    const rows = await this.db.run(ctx, async (tx) =>
      tx.department.findMany({
        where: { tenantId },
        select: {
          id: true,
          name: true,
          archivedAt: true,
          _count: { select: { memberships: { where: { status: MembershipStatus.ACTIVE } } } },
        },
        orderBy: { name: 'asc' },
      }),
    );
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      archived: row.archivedAt !== null,
      memberCount: row._count.memberships,
    }));
  }

  async createDepartment(
    ctx: DbContext,
    name: string,
    meta: AuditRequestMeta,
  ): Promise<Department> {
    const tenantId = tenantOf(ctx);
    try {
      return await this.db.run(ctx, async (tx) => {
        const department = await tx.department.create({
          data: { tenantId, name },
          select: { id: true, name: true },
        });
        await this.audit.record(tx, {
          action: 'department.created',
          tenantId,
          entityType: 'department',
          entityId: department.id,
          request: meta,
        });
        return { ...department, archived: false, memberCount: 0 };
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw conflict('department_exists');
      }
      throw error;
    }
  }

  async updateDepartment(
    ctx: DbContext,
    departmentId: string,
    change: { name?: string | undefined; archived?: boolean | undefined },
    meta: AuditRequestMeta,
  ): Promise<void> {
    const tenantId = tenantOf(ctx);
    try {
      await this.db.run(ctx, async (tx) => {
        const changed = await tx.department.updateMany({
          where: { id: departmentId, tenantId },
          data: {
            ...(change.name === undefined ? {} : { name: change.name }),
            ...(change.archived === undefined
              ? {}
              : { archivedAt: change.archived ? new Date() : null }),
            version: { increment: 1 },
          },
        });
        if (changed.count !== 1) {
          throw notFound();
        }
        await this.audit.record(tx, {
          action: 'department.updated',
          tenantId,
          entityType: 'department',
          entityId: departmentId,
          request: meta,
          metadata: { name: change.name ?? null, archived: change.archived ?? null },
        });
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw conflict('department_exists');
      }
      throw error;
    }
  }

  // ------------------------------------------------------------------ helpers

  private assertPermissionsAllowed(kind: TenantKind, codes: readonly string[]): void {
    const allowed = new Set(this.permissionsFor(kind).map((permission) => permission.code));
    if (codes.some((code) => !allowed.has(code))) {
      throw conflict('permission_not_allowed');
    }
  }

  private async customRole(tx: Prisma.TransactionClient, tenantId: string, roleId: string) {
    const role = await tx.role.findFirst({
      where: { id: roleId, OR: [{ tenantId }, { tenantId: null }] },
      select: { isSystem: true },
    });
    if (role === null) {
      throw notFound();
    }
    if (role.isSystem) {
      throw conflict('system_role_immutable');
    }
  }

  private async roleById(tx: Prisma.TransactionClient, roleId: string): Promise<Role> {
    const role = await tx.role.findUniqueOrThrow({
      where: { id: roleId },
      select: {
        id: true,
        code: true,
        name: true,
        description: true,
        isSystem: true,
        permissions: { select: { permissionCode: true }, orderBy: { permissionCode: 'asc' } },
      },
    });
    const { permissions, ...rest } = role;
    return { ...rest, permissions: permissions.map((grant) => grant.permissionCode) };
  }

  /** The deferred last-admin trigger fails at COMMIT; surface it as 409 `last_admin`. */
  private async guardLastAdmin<T>(work: () => Promise<T>): Promise<T> {
    try {
      return await work();
    } catch (error) {
      if (isLastAdminViolation(error)) {
        throw conflict('last_admin');
      }
      throw error;
    }
  }
}
