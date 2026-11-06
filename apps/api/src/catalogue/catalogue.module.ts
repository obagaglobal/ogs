import { Module } from '@nestjs/common';
import { IdentityModule } from '../identity/identity.module.js';
import { CatalogueAdminService } from './catalogue-admin.service.js';
import { CataloguePublicController } from './catalogue-public.controller.js';
import { CataloguePublicService } from './catalogue-public.service.js';
import { PlatformCatalogueController } from './platform-catalogue.controller.js';

/** The service catalogue (Phase 6): public browsing and staff management. */
@Module({
  imports: [IdentityModule],
  controllers: [CataloguePublicController, PlatformCatalogueController],
  providers: [CataloguePublicService, CatalogueAdminService],
  exports: [CataloguePublicService],
})
export class CatalogueModule {}
