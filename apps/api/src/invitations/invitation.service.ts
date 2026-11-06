import { Injectable } from '@nestjs/common';
import type { AcceptInvitationResponse, Invitation } from '@ogs/contracts';
import { AuditService, type AuditRequestMeta } from '../audit/audit.service.js';
import { sha256Hex } from '../common/secrets.js';
import { conflict, forbiddenRule, notFound } from '../common/domain-error.js';
import {
  MembershipStatus,
  TenantDb,
  TenantStatus,
  type Db,
  type DbContext,
  type TenantKind,
} from '../database/index.js';
import { OutboxService } from '../events/outbox.service.js';
import { tenantOf } from '../organisations/organisation.service.js';

/** Invitations last 7 days (P4-3). */
export const INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export interface CreateInvitation {
  readonly email: string;
  readonly roleIds: readonly string[];
  readonly departmentId?: string | null | undefined;
}

/**
 * Invitations (Phase 4 plan §2.3, review §7). The token is minted and emailed
 * by the worker (InvitationEmailHandler); the database keeps only its SHA-256.
 * Acceptance is bound to the invited email and single-use.
 */
@Injectable()
export class InvitationService {
  constructor(
    private readonly db: TenantDb,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
  ) {}

  async create(
    ctx: DbContext,
    kind: TenantKind,
    input: CreateInvitation,
    invitedBy: string,
    meta: AuditRequestMeta,
  ): Promise<Invitation> {
    const tenantId = tenantOf(ctx);
    return this.db.run(ctx, async (tx) => {
      await assertRolesUsable(tx, tenantId, kind, input.roleIds);
      if (input.departmentId !== undefined && input.departmentId !== null) {
        await assertDepartmentUsable(tx, tenantId, input.departmentId);
      }
      const existing = await tx.membership.findFirst({
        where: { tenantId, status: MembershipStatus.ACTIVE, user: { email: input.email } },
        select: { id: true },
      });
      if (existing !== null) {
        throw conflict('already_member');
      }
      // Re-inviting replaces the previous pending invitation (its link stops working).
      await tx.invitation.updateMany({
        where: { tenantId, email: input.email, status: 'PENDING' },
        data: { status: 'REVOKED' },
      });
      const invitation = await tx.invitation.create({
        data: {
          tenantId,
          email: input.email,
          roleIds: [...input.roleIds],
          departmentId: input.departmentId ?? null,
          expiresAt: new Date(Date.now() + INVITATION_TTL_MS),
          invitedBy,
        },
        select: {
          id: true,
          email: true,
          roleIds: true,
          status: true,
          expiresAt: true,
          createdAt: true,
        },
      });
      await this.audit.record(tx, {
        action: 'membership.invited',
        tenantId,
        entityType: 'invitation',
        entityId: invitation.id,
        request: meta,
        metadata: { roleIds: [...input.roleIds] },
      });
      await this.outbox.publish(tx, {
        type: 'invitations.created',
        tenantId,
        payload: { invitationId: invitation.id },
      });
      return this.present(tx, invitation);
    });
  }

  async list(ctx: DbContext): Promise<Invitation[]> {
    const tenantId = tenantOf(ctx);
    return this.db.run(ctx, async (tx) => {
      const rows = await tx.invitation.findMany({
        where: { tenantId },
        select: {
          id: true,
          email: true,
          roleIds: true,
          status: true,
          expiresAt: true,
          createdAt: true,
        },
        orderBy: { createdAt: 'desc' },
        take: 200,
      });
      // One transaction is one connection: query sequentially (pg queues concurrent
      // queries on a client and will refuse them in pg 9).
      const presented = [];
      for (const row of rows) {
        presented.push(await this.present(tx, row));
      }
      return presented;
    });
  }

  async revoke(ctx: DbContext, invitationId: string, meta: AuditRequestMeta): Promise<void> {
    const tenantId = tenantOf(ctx);
    await this.db.run(ctx, async (tx) => {
      const changed = await tx.invitation.updateMany({
        where: { id: invitationId, tenantId, status: 'PENDING' },
        data: { status: 'REVOKED' },
      });
      if (changed.count !== 1) {
        throw notFound();
      }
      await this.audit.record(tx, {
        action: 'membership.invitation_revoked',
        tenantId,
        entityType: 'invitation',
        entityId: invitationId,
        request: meta,
      });
    });
  }

  /**
   * Accepts an invitation for the signed-in, verified user. Refused when the
   * account's email differs from the invited one (review §7), when it was
   * used, revoked or expired, or when the tenant is not ACTIVE.
   */
  async accept(
    user: { id: string; email: string },
    token: string,
    meta: AuditRequestMeta,
  ): Promise<AcceptInvitationResponse> {
    const found = await this.db.run({ kind: 'system', job: 'invitations.accept' }, async (tx) =>
      tx.invitation.findUnique({
        where: { tokenHash: sha256Hex(token) },
        select: { id: true, tenantId: true, email: true, status: true, expiresAt: true },
      }),
    );
    if (found?.status !== 'PENDING' || found.expiresAt <= new Date()) {
      throw conflict('invitation_invalid');
    }
    if (found.email.toLowerCase() !== user.email.toLowerCase()) {
      throw forbiddenRule('invitation_email_mismatch');
    }

    return this.db.run(
      { kind: 'system', job: 'invitations.accept', tenantId: found.tenantId },
      async (tx) => {
        const tenant = await tx.tenant.findUnique({
          where: { id: found.tenantId },
          select: { id: true, name: true, kind: true, status: true },
        });
        if (tenant?.status !== TenantStatus.ACTIVE) {
          throw conflict('tenant_not_active');
        }
        const claimed = await tx.invitation.updateMany({
          where: { id: found.id, status: 'PENDING' },
          data: { status: 'ACCEPTED', acceptedBy: user.id, acceptedAt: new Date() },
        });
        if (claimed.count !== 1) {
          throw conflict('invitation_invalid');
        }
        const invitation = await tx.invitation.findUniqueOrThrow({
          where: { id: found.id },
          select: { roleIds: true, departmentId: true },
        });
        const existing = await tx.membership.findUnique({
          where: { tenantId_userId: { tenantId: tenant.id, userId: user.id } },
          select: { id: true, status: true },
        });
        if (existing?.status === MembershipStatus.ACTIVE) {
          throw conflict('already_member');
        }
        const membershipId =
          existing === null
            ? (
                await tx.membership.create({
                  data: {
                    tenantId: tenant.id,
                    userId: user.id,
                    status: MembershipStatus.ACTIVE,
                    joinedAt: new Date(),
                    departmentId: invitation.departmentId,
                  },
                  select: { id: true },
                })
              ).id
            : existing.id;
        if (existing !== null) {
          await tx.membership.update({
            where: { id: existing.id },
            data: {
              status: MembershipStatus.ACTIVE,
              endedAt: null,
              joinedAt: new Date(),
              departmentId: invitation.departmentId,
            },
            select: { id: true },
          });
          await tx.membershipRole.deleteMany({ where: { membershipId } });
        }
        // Roles that were deleted since the invitation are skipped, never resurrected.
        const roles = await tx.role.findMany({
          where: { id: { in: invitation.roleIds }, scope: tenant.kind },
          select: { id: true },
        });
        if (roles.length === 0) {
          throw conflict('invitation_roles_gone');
        }
        await tx.membershipRole.createMany({
          data: roles.map((role) => ({ membershipId, roleId: role.id, tenantId: tenant.id })),
        });
        await this.audit.record(tx, {
          action: 'membership.invitation_accepted',
          tenantId: tenant.id,
          entityType: 'membership',
          entityId: membershipId,
          request: meta,
          metadata: { userId: user.id, invitationId: found.id },
        });
        return { tenantId: tenant.id, tenantName: tenant.name, kind: tenant.kind };
      },
    );
  }

  private async present(
    tx: Db,
    row: {
      id: string;
      email: string;
      roleIds: string[];
      status: Invitation['status'];
      expiresAt: Date;
      createdAt: Date;
    },
  ): Promise<Invitation> {
    const roles = await tx.role.findMany({
      where: { id: { in: row.roleIds } },
      select: { code: true },
    });
    const expired = row.status === 'PENDING' && row.expiresAt <= new Date();
    return {
      id: row.id,
      email: row.email,
      roles: roles.map((role) => role.code).sort(),
      status: expired ? 'REVOKED' : row.status,
      expiresAt: row.expiresAt.toISOString(),
      createdAt: row.createdAt.toISOString(),
    };
  }
}

/** Roles must be visible to the tenant (system or its own custom) and match its kind. */
export async function assertRolesUsable(
  tx: Db,
  tenantId: string,
  kind: TenantKind,
  roleIds: readonly string[],
): Promise<void> {
  const unique = [...new Set(roleIds)];
  const count = await tx.role.count({
    where: {
      id: { in: unique },
      scope: kind,
      OR: [{ tenantId: null }, { tenantId }],
    },
  });
  if (count !== unique.length) {
    throw conflict('role_not_allowed');
  }
}

export async function assertDepartmentUsable(tx: Db, tenantId: string, departmentId: string) {
  const department = await tx.department.findFirst({
    where: { id: departmentId, tenantId, archivedAt: null },
    select: { id: true },
  });
  if (department === null) {
    throw conflict('department_not_usable');
  }
}
