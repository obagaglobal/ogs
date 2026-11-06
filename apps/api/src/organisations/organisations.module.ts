import { Module } from '@nestjs/common';
import { OrganisationReviewService } from './organisation-review.service.js';
import { OrganisationController } from './organisation.controller.js';
import { OrganisationService } from './organisation.service.js';
import { PlatformApplicationsController } from './platform-applications.controller.js';

/** Organisation applications and their platform review (Phase 4). */
@Module({
  controllers: [OrganisationController, PlatformApplicationsController],
  providers: [OrganisationService, OrganisationReviewService],
})
export class OrganisationsModule {}
