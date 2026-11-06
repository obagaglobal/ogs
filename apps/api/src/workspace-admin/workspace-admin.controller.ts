import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
} from '@nestjs/common';
import {
  createDepartmentRequestSchema,
  createRoleRequestSchema,
  setMemberRolesRequestSchema,
  updateDepartmentRequestSchema,
  updateMemberRequestSchema,
  updateRoleRequestSchema,
  type Department,
  type DepartmentListResponse,
  type PermissionListResponse,
  type Role,
  type RoleListResponse,
} from '@ogs/contracts';
import { Auth, Authenticated, Ctx, RequirePermission } from '../access/access.decorators.js';
import type { AccessState } from '../access/access.types.js';
import { parseBody } from '../access/parse-body.js';
import type { DbContext } from '../database/index.js';
import { tenantKindOf } from '../invitations/invitations.controller.js';
import { WorkspaceAdminService } from './workspace-admin.service.js';

/** /api/v1/workspace — members, roles and departments (Phase 4 plan §2.4). */
@Controller('workspace')
export class WorkspaceAdminController {
  constructor(private readonly admin: WorkspaceAdminService) {}

  @Patch('members/:id')
  @RequirePermission('membership.manage')
  @HttpCode(HttpStatus.NO_CONTENT)
  async updateMember(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
    @Ctx() ctx: DbContext,
    @Auth() auth: AccessState,
  ): Promise<void> {
    const change = parseBody(updateMemberRequestSchema, body);
    await this.admin.updateMember(ctx, id, change, auth.user.id, auth.meta);
  }

  @Put('members/:id/roles')
  @RequirePermission('role.manage')
  @HttpCode(HttpStatus.NO_CONTENT)
  async setRoles(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
    @Ctx() ctx: DbContext,
    @Auth() auth: AccessState,
  ): Promise<void> {
    const { roleIds } = parseBody(setMemberRolesRequestSchema, body);
    await this.admin.setMemberRoles(ctx, tenantKindOf(auth), id, roleIds, auth.meta);
  }

  /** Leave this workspace (the last admin cannot). */
  @Post('leave')
  @Authenticated({ workspace: true })
  @HttpCode(HttpStatus.NO_CONTENT)
  async leave(@Ctx() ctx: DbContext, @Auth() auth: AccessState): Promise<void> {
    await this.admin.leave(ctx, auth.user.id, auth.meta);
  }

  @Get('roles')
  @RequirePermission('role.read')
  @Header('Cache-Control', 'no-store')
  async roles(@Ctx() ctx: DbContext, @Auth() auth: AccessState): Promise<RoleListResponse> {
    return { roles: await this.admin.roles(ctx, tenantKindOf(auth)) };
  }

  /** Permissions a custom role in this kind of workspace may hold. */
  @Get('permissions')
  @RequirePermission('role.read')
  permissions(@Auth() auth: AccessState): PermissionListResponse {
    return { permissions: this.admin.permissionsFor(tenantKindOf(auth)) };
  }

  @Post('roles')
  @RequirePermission('role.manage')
  async createRole(
    @Body() body: unknown,
    @Ctx() ctx: DbContext,
    @Auth() auth: AccessState,
  ): Promise<Role> {
    const input = parseBody(createRoleRequestSchema, body);
    return this.admin.createRole(ctx, tenantKindOf(auth), input, auth.meta);
  }

  @Patch('roles/:id')
  @RequirePermission('role.manage')
  async updateRole(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
    @Ctx() ctx: DbContext,
    @Auth() auth: AccessState,
  ): Promise<Role> {
    const input = parseBody(updateRoleRequestSchema, body);
    return this.admin.updateRole(ctx, tenantKindOf(auth), id, input, auth.meta);
  }

  @Delete('roles/:id')
  @RequirePermission('role.manage')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteRole(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Ctx() ctx: DbContext,
    @Auth() auth: AccessState,
  ): Promise<void> {
    await this.admin.deleteRole(ctx, id, auth.meta);
  }

  @Get('departments')
  @RequirePermission('membership.read')
  @Header('Cache-Control', 'no-store')
  async departments(@Ctx() ctx: DbContext): Promise<DepartmentListResponse> {
    return { departments: await this.admin.departments(ctx) };
  }

  @Post('departments')
  @RequirePermission('department.manage')
  async createDepartment(
    @Body() body: unknown,
    @Ctx() ctx: DbContext,
    @Auth() auth: AccessState,
  ): Promise<Department> {
    const { name } = parseBody(createDepartmentRequestSchema, body);
    return this.admin.createDepartment(ctx, name, auth.meta);
  }

  @Patch('departments/:id')
  @RequirePermission('department.manage')
  @HttpCode(HttpStatus.NO_CONTENT)
  async updateDepartment(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
    @Ctx() ctx: DbContext,
    @Auth() auth: AccessState,
  ): Promise<void> {
    const change = parseBody(updateDepartmentRequestSchema, body);
    await this.admin.updateDepartment(ctx, id, change, auth.meta);
  }
}
