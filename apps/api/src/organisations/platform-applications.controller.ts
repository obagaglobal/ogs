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
  applicationTypeSchema,
  approveRequestSchema,
  reasonRequestSchema,
  type ApplicationQueueResponse,
  type PlatformApplicationResponse,
} from '@ogs/contracts';
import { Auth, Ctx, RequireElevation } from '../access/access.decorators.js';
import type { AccessState } from '../access/access.types.js';
import { parseBody } from '../access/parse-body.js';
import type { DbContext } from '../database/index.js';
import { ProviderReviewService } from '../providers/provider-review.service.js';
import { OrganisationReviewService } from './organisation-review.service.js';

/**
 * Staff review of organisation applications (Phase 4 plan §2.2). Every route
 * needs an active platform elevation (step-up + reason), so every read and
 * decision is audited with that reason.
 */
@Controller('platform')
export class PlatformApplicationsController {
  constructor(
    private readonly review: OrganisationReviewService,
    private readonly providerReview: ProviderReviewService,
  ) {}

  @Get('applications')
  @RequireElevation('platform.tenant.review')
  @Header('Cache-Control', 'no-store')
  async queue(
    @Ctx() ctx: DbContext,
    @Query('status') status: unknown,
    @Query('type') type: unknown,
  ): Promise<ApplicationQueueResponse> {
    const parsed = applicationStatusSchema.safeParse(status ?? 'SUBMITTED');
    const wanted = parsed.success ? parsed.data : 'SUBMITTED';
    // Phase 5: one queue for organisations and both kinds of provider, filterable by type.
    const kind = type === undefined ? undefined : applicationTypeSchema.safeParse(type);
    if (kind !== undefined && !kind.success) {
      return { applications: [] };
    }
    const only = kind?.data;
    const organisations =
      only === undefined || only === 'organisation'
        ? (await this.review.queue(ctx, wanted)).applications
        : [];
    const providers =
      only === 'organisation'
        ? []
        : await this.providerReview.queue(
            ctx,
            wanted,
            only === undefined ? undefined : only === 'provider_company' ? 'COMPANY' : 'INDIVIDUAL',
          );
    const applications = [...organisations, ...providers].sort((a, b) =>
      (a.submittedAt ?? '').localeCompare(b.submittedAt ?? ''),
    );
    return { applications };
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
