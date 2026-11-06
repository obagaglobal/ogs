import { Module } from '@nestjs/common';
import { CatalogueService } from './catalogue.service.js';
import { EligibilityService } from './eligibility.service.js';
import { PlatformProvidersController } from './platform-providers.controller.js';
import { ProviderReviewService } from './provider-review.service.js';
import { ProviderController } from './provider.controller.js';
import { ProviderService } from './provider.service.js';
import { ReferenceController } from './reference.controller.js';

/** Providers (Phase 5): registration, profile, coverage, availability, review, eligibility. */
@Module({
  controllers: [ProviderController, PlatformProvidersController, ReferenceController],
  providers: [ProviderService, ProviderReviewService, EligibilityService, CatalogueService],
  exports: [ProviderReviewService, EligibilityService],
})
export class ProvidersModule {}
