import { Controller, Get, Header, HttpStatus, Param, ParseUUIDPipe } from '@nestjs/common';
import type {
  CurrentWorkspaceResponse,
  Member,
  MemberListResponse,
  WorkspaceListResponse,
} from '@ogs/contracts';
import { Auth, Authenticated, Ctx, RequirePermission } from '../access/access.decorators.js';
import type { AccessState } from '../access/access.types.js';
import { ApiException } from '../access/api-error.js';
import { PermissionService } from '../authz/permission.service.js';
import { TenantDb, type DbContext } from '../database/index.js';
import { WorkspaceContextService } from './workspace-context.service.js';

const memberSelect = {
  id: true,
  userId: true,
  status: true,
  joinedAt: true,
  user: { select: { email: true } },
  roles: { select: { role: { select: { code: true } } }, orderBy: { role: { code: 'asc' } } },
} as const;

/** /api/v1/me — the signed-in user's own view. */
@Controller('me')
export class MeController {
  constructor(private readonly workspaces: WorkspaceContextService) {}

  /** Workspace switcher (review §7). The personal workspace is always available. */
  @Get('workspaces')
  @Authenticated()
  @Header('Cache-Control', 'no-store')
  async workspacesOfUser(@Auth() auth: AccessState): Promise<WorkspaceListResponse> {
    return { workspaces: await this.workspaces.listWorkspaces(auth.user.id) };
  }
}

/** /api/v1/workspace — the workspace selected by X-OGS-Workspace. */
@Controller('workspace')
export class WorkspaceController {
  constructor(
    private readonly db: TenantDb,
    private readonly permissions: PermissionService,
  ) {}

  /** Reachable from restricted workspaces so a pending tenant can see its status. */
  @Get()
  @Authenticated({ workspace: true, allowRestricted: true })
  @Header('Cache-Control', 'no-store')
  async current(
    @Auth() auth: AccessState,
    @Ctx() ctx: DbContext,
  ): Promise<CurrentWorkspaceResponse> {
    const workspace = auth.workspace?.resolved;
    if (workspace === undefined || workspace.kind === 'personal') {
      return { kind: 'personal' };
    }
    const roles = await this.db.run(ctx, async (tx) =>
      this.permissions.rolesForMembership(tx, workspace.membershipId),
    );
    return {
      kind: workspace.kind,
      tenantId: workspace.tenantId,
      name: workspace.tenantName,
      status: workspace.tenantStatus,
      restricted: workspace.restricted,
      membershipId: workspace.membershipId,
      roles,
      permissions: [...(auth.workspace?.permissions ?? [])].sort(),
    };
  }

  @Get('members')
  @RequirePermission('membership.read')
  @Header('Cache-Control', 'no-store')
  async members(@Ctx() ctx: DbContext): Promise<MemberListResponse> {
    // RLS also shows the caller their own memberships in OTHER tenants (personal
    // view), so scoping to the current tenant here is required, not cosmetic.
    const tenantId = ctx.kind === 'workspace' ? ctx.tenantId : undefined;
    if (tenantId === undefined) {
      throw new ApiException(HttpStatus.FORBIDDEN, 'permission_denied');
    }
    const rows = await this.db.run(ctx, async (tx) =>
      tx.membership.findMany({
        where: { tenantId },
        select: memberSelect,
        orderBy: { createdAt: 'asc' },
      }),
    );
    return { members: rows.map(toMember) };
  }

  /** Another tenant's membership id is indistinguishable from a missing one (404). */
  @Get('members/:membershipId')
  @RequirePermission('membership.read')
  @Header('Cache-Control', 'no-store')
  async member(
    @Param('membershipId', new ParseUUIDPipe()) membershipId: string,
    @Ctx() ctx: DbContext,
  ): Promise<Member> {
    if (ctx.kind !== 'workspace') {
      throw new ApiException(HttpStatus.NOT_FOUND, 'not_found');
    }
    const tenantId = ctx.tenantId;
    const row = await this.db.run(ctx, async (tx) =>
      tx.membership.findFirst({ where: { id: membershipId, tenantId }, select: memberSelect }),
    );
    if (row === null) {
      throw new ApiException(HttpStatus.NOT_FOUND, 'not_found');
    }
    return toMember(row);
  }
}

interface MemberRow {
  id: string;
  userId: string;
  status: Member['status'];
  joinedAt: Date | null;
  user: { email: string };
  roles: { role: { code: string } }[];
}

function toMember(row: MemberRow): Member {
  return {
    membershipId: row.id,
    userId: row.userId,
    email: row.user.email,
    status: row.status,
    roles: row.roles.map((grant) => grant.role.code),
    joinedAt: row.joinedAt?.toISOString() ?? null,
  };
}
