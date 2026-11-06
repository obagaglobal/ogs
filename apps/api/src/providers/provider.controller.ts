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
  applyIndividualProviderRequestSchema,
  createTimeOffRequestSchema,
  organisationProfileInputSchema,
  registerProviderCompanyRequestSchema,
  setProviderRegionsRequestSchema,
  setProviderSkillsRequestSchema,
  setWorkingHoursRequestSchema,
  updateProviderProfileRequestSchema,
  type ProviderResponse,
} from '@ogs/contracts';
import { Auth, Authenticated } from '../access/access.decorators.js';
import type { AccessState } from '../access/access.types.js';
import { parseBody } from '../access/parse-body.js';
import { providerSubject } from './provider-subject.js';
import { ProviderService } from './provider.service.js';

/**
 * A provider's own side (Phase 5 plan §2.1–§2.3). The `/provider/*` routes
 * work for both kinds: the workspace header decides which provider (see
 * providerSubject). They allow restricted workspaces because a pending
 * provider edits its application through them; the service refuses changes
 * while the application is under review or the provider is suspended.
 */
@Controller()
export class ProviderController {
  constructor(private readonly providers: ProviderService) {}

  /** Register a provider company: a pending tenant whose applicant is provider_admin. */
  @Post('providers/companies')
  @Authenticated()
  async registerCompany(@Body() body: unknown, @Auth() auth: AccessState) {
    const input = parseBody(registerProviderCompanyRequestSchema, body);
    return this.providers.registerCompany(auth.user.id, input, auth.meta);
  }

  /** Apply as an individual provider from the personal account (one profile per person). */
  @Post('providers/me')
  @Authenticated()
  async applyIndividual(@Body() body: unknown, @Auth() auth: AccessState) {
    const input = parseBody(applyIndividualProviderRequestSchema, body);
    return this.providers.applyIndividual(auth.user.id, input, auth.meta);
  }

  @Get('provider')
  @Authenticated({ workspace: true, allowRestricted: true })
  @Header('Cache-Control', 'no-store')
  async get(@Auth() auth: AccessState): Promise<ProviderResponse> {
    return this.providers.get(providerSubject(auth, 'read'));
  }

  @Patch('provider/profile')
  @Authenticated({ workspace: true, allowRestricted: true })
  async updateProfile(@Body() body: unknown, @Auth() auth: AccessState): Promise<ProviderResponse> {
    const input = parseBody(updateProviderProfileRequestSchema, body);
    return this.providers.updateProfile(providerSubject(auth, 'manage'), input, auth.meta);
  }

  @Put('provider/skills')
  @Authenticated({ workspace: true, allowRestricted: true })
  async setSkills(@Body() body: unknown, @Auth() auth: AccessState): Promise<ProviderResponse> {
    const { skills } = parseBody(setProviderSkillsRequestSchema, body);
    return this.providers.setSkills(providerSubject(auth, 'manage'), skills, auth.meta);
  }

  @Put('provider/regions')
  @Authenticated({ workspace: true, allowRestricted: true })
  async setRegions(@Body() body: unknown, @Auth() auth: AccessState): Promise<ProviderResponse> {
    const { regionCodes } = parseBody(setProviderRegionsRequestSchema, body);
    return this.providers.setRegions(providerSubject(auth, 'manage'), regionCodes, auth.meta);
  }

  @Put('provider/working-hours')
  @Authenticated({ workspace: true, allowRestricted: true })
  async setWorkingHours(
    @Body() body: unknown,
    @Auth() auth: AccessState,
  ): Promise<ProviderResponse> {
    const { hours } = parseBody(setWorkingHoursRequestSchema, body);
    return this.providers.setWorkingHours(providerSubject(auth, 'manage'), hours, auth.meta);
  }

  @Post('provider/time-off')
  @Authenticated({ workspace: true, allowRestricted: true })
  async addTimeOff(@Body() body: unknown, @Auth() auth: AccessState): Promise<ProviderResponse> {
    const input = parseBody(createTimeOffRequestSchema, body);
    return this.providers.addTimeOff(providerSubject(auth, 'manage'), input, auth.meta);
  }

  @Delete('provider/time-off/:id')
  @Authenticated({ workspace: true, allowRestricted: true })
  async removeTimeOff(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Auth() auth: AccessState,
  ): Promise<ProviderResponse> {
    return this.providers.removeTimeOff(providerSubject(auth, 'manage'), id, auth.meta);
  }

  /** Business details of a provider company (registration number, KRA PIN...). */
  @Patch('provider/business')
  @Authenticated({ workspace: true, allowRestricted: true })
  async updateBusiness(
    @Body() body: unknown,
    @Auth() auth: AccessState,
  ): Promise<ProviderResponse> {
    const input = parseBody(organisationProfileInputSchema, body);
    return this.providers.updateBusiness(providerSubject(auth, 'manage'), input, auth.meta);
  }

  @Post('provider/application/submit')
  @Authenticated({ workspace: true, allowRestricted: true })
  @HttpCode(HttpStatus.OK)
  async submit(@Auth() auth: AccessState): Promise<ProviderResponse> {
    return this.providers.submit(providerSubject(auth, 'manage'), auth.meta);
  }
}
