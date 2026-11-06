import { Controller, Get, Header } from '@nestjs/common';
import type { RegionListResponse, SkillListResponse } from '@ogs/contracts';
import { Auth, Authenticated } from '../access/access.decorators.js';
import type { AccessState } from '../access/access.types.js';
import { CatalogueService } from './catalogue.service.js';

/** Reference data for pickers (active skills, regions): any signed-in person. */
@Controller('reference')
export class ReferenceController {
  constructor(private readonly catalogue: CatalogueService) {}

  @Get('skills')
  @Authenticated()
  @Header('Cache-Control', 'private, max-age=300')
  async skills(@Auth() auth: AccessState): Promise<SkillListResponse> {
    return this.catalogue.skills({ kind: 'user', userId: auth.user.id }, false);
  }

  @Get('regions')
  @Authenticated()
  @Header('Cache-Control', 'private, max-age=300')
  async regions(@Auth() auth: AccessState): Promise<RegionListResponse> {
    return this.catalogue.regions({ kind: 'user', userId: auth.user.id });
  }
}
