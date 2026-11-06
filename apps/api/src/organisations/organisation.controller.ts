import { Body, Controller, Get, Header, HttpCode, HttpStatus, Patch, Post } from '@nestjs/common';
import {
  organisationProfileInputSchema,
  registerOrganisationRequestSchema,
  type OrganisationApplicationResponse,
  type RegisterOrganisationResponse,
} from '@ogs/contracts';
import { Auth, Authenticated, Ctx, RequirePermission } from '../access/access.decorators.js';
import type { AccessState } from '../access/access.types.js';
import { parseBody } from '../access/parse-body.js';
import type { DbContext } from '../database/index.js';
import { OrganisationService } from './organisation.service.js';

/**
 * Applying to register an organisation (Phase 4 plan §2.1). Application
 * endpoints allow restricted workspaces: a pending organisation can see and
 * edit its application and nothing else.
 */
@Controller()
export class OrganisationController {
  constructor(private readonly organisations: OrganisationService) {}

  /** Any verified user may apply; they become the pending organisation's admin. */
  @Post('organisations')
  @Authenticated()
  async register(
    @Body() body: unknown,
    @Auth() auth: AccessState,
  ): Promise<RegisterOrganisationResponse> {
    const input = parseBody(registerOrganisationRequestSchema, body);
    return this.organisations.register(auth.user.id, input, auth.meta);
  }

  @Get('organisation/application')
  @RequirePermission('organisation.profile.manage', { allowRestricted: true })
  @Header('Cache-Control', 'no-store')
  async application(@Ctx() ctx: DbContext): Promise<OrganisationApplicationResponse> {
    return this.organisations.application(ctx);
  }

  @Patch('organisation/profile')
  @RequirePermission('organisation.profile.manage', { allowRestricted: true })
  async updateProfile(
    @Body() body: unknown,
    @Ctx() ctx: DbContext,
    @Auth() auth: AccessState,
  ): Promise<OrganisationApplicationResponse> {
    const input = parseBody(organisationProfileInputSchema, body);
    return this.organisations.updateProfile(ctx, input, auth.meta);
  }

  @Post('organisation/application/submit')
  @RequirePermission('organisation.profile.manage', { allowRestricted: true })
  @HttpCode(HttpStatus.OK)
  async submit(
    @Ctx() ctx: DbContext,
    @Auth() auth: AccessState,
  ): Promise<OrganisationApplicationResponse> {
    return this.organisations.submit(ctx, auth.user.id, auth.meta);
  }
}
