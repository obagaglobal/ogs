import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import {
  approveProviderRequestSchema,
  createSkillRequestSchema,
  reasonRequestSchema,
  regionCodeSchema,
  skillCodeSchema,
  updateSkillRequestSchema,
  type EligibilityResponse,
  type PlatformProviderApplicationResponse,
  type SkillListResponse,
} from '@ogs/contracts';
import { z } from 'zod';
import { Auth, Ctx, RequireElevation } from '../access/access.decorators.js';
import type { AccessState } from '../access/access.types.js';
import { parseBody } from '../access/parse-body.js';
import { badRequest } from '../common/domain-error.js';
import type { DbContext } from '../database/index.js';
import { CatalogueService } from './catalogue.service.js';
import { EligibilityService } from './eligibility.service.js';
import { ProviderReviewService } from './provider-review.service.js';

const eligibilityQuerySchema = z.object({
  skills: z
    .string()
    .transform((value) =>
      value
        .split(',')
        .map((code) => code.trim())
        .filter((code) => code !== ''),
    )
    .pipe(z.array(skillCodeSchema).min(1).max(20)),
  region: regionCodeSchema,
  at: z.iso.datetime({ offset: true }).optional(),
  remote: z.enum(['true', 'false']).optional(),
});

function permissionsOf(auth: AccessState): ReadonlySet<string> {
  return auth.workspace?.permissions ?? new Set<string>();
}

/**
 * Staff side of providers (Phase 5 plan §2.2, §2.4, §2.5, §2.3 taxonomy).
 * Every route needs an active platform elevation. Decisions and suspensions
 * open with platform.tenant.review; the service then requires the approve
 * permission of the provider's kind (tenant.approve for companies,
 * provider.approve for individuals).
 */
@Controller('platform')
export class PlatformProvidersController {
  constructor(
    private readonly review: ProviderReviewService,
    private readonly eligibility: EligibilityService,
    private readonly catalogue: CatalogueService,
  ) {}

  @Get('provider-applications/:id')
  @RequireElevation('platform.tenant.review')
  @Header('Cache-Control', 'no-store')
  async detail(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Ctx() ctx: DbContext,
    @Auth() auth: AccessState,
  ): Promise<PlatformProviderApplicationResponse> {
    return this.review.detail(ctx, permissionsOf(auth), id, auth.meta);
  }

  @Post('provider-applications/:id/approve')
  @RequireElevation('platform.tenant.review')
  @HttpCode(HttpStatus.NO_CONTENT)
  async approve(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
    @Ctx() ctx: DbContext,
    @Auth() auth: AccessState,
  ): Promise<void> {
    const { checklist } = parseBody(approveProviderRequestSchema, body);
    await this.review.decide(
      ctx,
      permissionsOf(auth),
      id,
      'APPROVED',
      { reason: checklist.notes ?? null, checklist },
      auth.meta,
    );
  }

  @Post('provider-applications/:id/reject')
  @RequireElevation('platform.tenant.review')
  @HttpCode(HttpStatus.NO_CONTENT)
  async reject(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
    @Ctx() ctx: DbContext,
    @Auth() auth: AccessState,
  ): Promise<void> {
    const { reason } = parseBody(reasonRequestSchema, body);
    await this.review.decide(ctx, permissionsOf(auth), id, 'REJECTED', { reason }, auth.meta);
  }

  @Post('provider-applications/:id/request-changes')
  @RequireElevation('platform.tenant.review')
  @HttpCode(HttpStatus.NO_CONTENT)
  async requestChanges(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
    @Ctx() ctx: DbContext,
    @Auth() auth: AccessState,
  ): Promise<void> {
    const { reason } = parseBody(reasonRequestSchema, body);
    await this.review.decide(
      ctx,
      permissionsOf(auth),
      id,
      'CHANGES_REQUESTED',
      { reason },
      auth.meta,
    );
  }

  @Post('providers/:id/suspend')
  @RequireElevation('platform.tenant.review')
  @HttpCode(HttpStatus.NO_CONTENT)
  async suspend(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
    @Ctx() ctx: DbContext,
    @Auth() auth: AccessState,
  ): Promise<void> {
    const { reason } = parseBody(reasonRequestSchema, body);
    await this.review.setStatus(ctx, permissionsOf(auth), id, 'SUSPENDED', reason, auth.meta);
  }

  @Post('providers/:id/reactivate')
  @RequireElevation('platform.tenant.review')
  @HttpCode(HttpStatus.NO_CONTENT)
  async reactivate(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
    @Ctx() ctx: DbContext,
    @Auth() auth: AccessState,
  ): Promise<void> {
    const { reason } = parseBody(reasonRequestSchema, body);
    await this.review.setStatus(ctx, permissionsOf(auth), id, 'ACTIVE', reason, auth.meta);
  }

  /** Staff-only preview of dispatch eligibility (Phase 9 uses the same service). */
  @Get('providers/eligible')
  @RequireElevation('ticket.assign')
  @Header('Cache-Control', 'no-store')
  async eligible(@Query() query: unknown, @Ctx() ctx: DbContext): Promise<EligibilityResponse> {
    const parsed = eligibilityQuerySchema.safeParse(query);
    if (!parsed.success) {
      throw badRequest('invalid_request');
    }
    const { skills, region, at, remote } = parsed.data;
    const candidates = await this.eligibility.find(ctx, {
      skillCodes: skills,
      regionCode: region,
      ...(at === undefined ? {} : { at: new Date(at) }),
      remoteAllowed: remote === 'true',
    });
    return { candidates };
  }

  @Get('skills')
  @RequireElevation('platform.catalogue.manage')
  @Header('Cache-Control', 'no-store')
  async skills(@Ctx() ctx: DbContext): Promise<SkillListResponse> {
    return this.catalogue.skills(ctx, true);
  }

  @Post('skills')
  @RequireElevation('platform.catalogue.manage')
  @HttpCode(HttpStatus.NO_CONTENT)
  async createSkill(
    @Body() body: unknown,
    @Ctx() ctx: DbContext,
    @Auth() auth: AccessState,
  ): Promise<void> {
    await this.catalogue.createSkill(ctx, parseBody(createSkillRequestSchema, body), auth.meta);
  }

  @Patch('skills/:code')
  @RequireElevation('platform.catalogue.manage')
  @HttpCode(HttpStatus.NO_CONTENT)
  async updateSkill(
    @Param('code') code: string,
    @Body() body: unknown,
    @Ctx() ctx: DbContext,
    @Auth() auth: AccessState,
  ): Promise<void> {
    if (!skillCodeSchema.safeParse(code).success) {
      throw badRequest('invalid_request');
    }
    await this.catalogue.updateSkill(
      ctx,
      code,
      parseBody(updateSkillRequestSchema, body),
      auth.meta,
    );
  }
}
