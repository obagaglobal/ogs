import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import {
  applicationStatusSchema,
  approveRequestSchema,
  reasonRequestSchema,
  type ApplicationQueueResponse,
  type PlatformApplicationResponse,
} from '@ogs/contracts';
import { Auth, Ctx, RequireElevation } from '../access/access.decorators.js';
import type { AccessState } from '../access/access.types.js';
import { parseBody } from '../access/parse-body.js';
import type { DbContext } from '../database/index.js';
import { OrganisationReviewService } from './organisation-review.service.js';

/**
 * Staff review of organisation applications (Phase 4 plan §2.2). Every route
 * needs an active platform elevation (step-up + reason), so every read and
 * decision is audited with that reason.
 */
@Controller('platform')
export class PlatformApplicationsController {
  constructor(private readonly review: OrganisationReviewService) {}

  @Get('applications')
  @RequireElevation('platform.tenant.review')
  @Header('Cache-Control', 'no-store')
  async queue(
    @Ctx() ctx: DbContext,
    @Query('status') status: unknown,
  ): Promise<ApplicationQueueResponse> {
    const parsed = applicationStatusSchema.safeParse(status ?? 'SUBMITTED');
    return this.review.queue(ctx, parsed.success ? parsed.data : 'SUBMITTED');
  }

  @Get('applications/:id')
  @RequireElevation('platform.tenant.review')
  @Header('Cache-Control', 'no-store')
  async detail(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Ctx() ctx: DbContext,
  ): Promise<PlatformApplicationResponse> {
    return this.review.detail(ctx, id);
  }

  @Post('applications/:id/approve')
  @RequireElevation('platform.tenant.approve')
  @HttpCode(HttpStatus.NO_CONTENT)
  async approve(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
    @Ctx() ctx: DbContext,
    @Auth() auth: AccessState,
  ): Promise<void> {
    const { note } = parseBody(approveRequestSchema, body);
    await this.review.decide(ctx, id, 'APPROVED', note ?? null, auth.meta);
  }

  @Post('applications/:id/reject')
  @RequireElevation('platform.tenant.approve')
  @HttpCode(HttpStatus.NO_CONTENT)
  async reject(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
    @Ctx() ctx: DbContext,
    @Auth() auth: AccessState,
  ): Promise<void> {
    const { reason } = parseBody(reasonRequestSchema, body);
    await this.review.decide(ctx, id, 'REJECTED', reason, auth.meta);
  }

  @Post('applications/:id/request-changes')
  @RequireElevation('platform.tenant.approve')
  @HttpCode(HttpStatus.NO_CONTENT)
  async requestChanges(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
    @Ctx() ctx: DbContext,
    @Auth() auth: AccessState,
  ): Promise<void> {
    const { reason } = parseBody(reasonRequestSchema, body);
    await this.review.decide(ctx, id, 'CHANGES_REQUESTED', reason, auth.meta);
  }

  @Post('tenants/:id/suspend')
  @RequireElevation('platform.tenant.approve')
  @HttpCode(HttpStatus.NO_CONTENT)
  async suspend(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
    @Ctx() ctx: DbContext,
    @Auth() auth: AccessState,
  ): Promise<void> {
    const { reason } = parseBody(reasonRequestSchema, body);
    await this.review.setTenantStatus(ctx, id, 'SUSPENDED', reason, auth.meta);
  }

  @Post('tenants/:id/reactivate')
  @RequireElevation('platform.tenant.approve')
  @HttpCode(HttpStatus.NO_CONTENT)
  async reactivate(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
    @Ctx() ctx: DbContext,
    @Auth() auth: AccessState,
  ): Promise<void> {
    const { reason } = parseBody(reasonRequestSchema, body);
    await this.review.setTenantStatus(ctx, id, 'ACTIVE', reason, auth.meta);
  }
}
