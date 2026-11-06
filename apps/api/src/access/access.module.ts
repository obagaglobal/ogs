import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, DiscoveryModule } from '@nestjs/core';
import { DomainErrorFilter } from '../common/domain-error.filter.js';
import { IdentityErrorFilter } from '../identity/identity-error.filter.js';
import { IdentityModule } from '../identity/identity.module.js';
import { TenancyModule } from '../tenancy/tenancy.module.js';
import { AccessRouteCheck } from './access-route-check.js';
import { AccessGuard } from './access.guard.js';

/**
 * The global access gate. Every route passes AccessGuard, and the API refuses
 * to start if any route lacks an access rule (AccessRouteCheck).
 */
@Module({
  imports: [DiscoveryModule, TenancyModule, IdentityModule],
  providers: [
    { provide: APP_GUARD, useClass: AccessGuard },
    { provide: APP_FILTER, useClass: IdentityErrorFilter },
    { provide: APP_FILTER, useClass: DomainErrorFilter },
    AccessRouteCheck,
  ],
  exports: [AccessRouteCheck],
})
export class AccessModule {}
