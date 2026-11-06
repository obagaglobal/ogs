import { Module } from '@nestjs/common';
import { AccessModule } from './access/access.module.js';
import { AuthzModule } from './authz/authz.module.js';
import { CoreModule } from './core.module.js';
import { HealthModule } from './health/health.module.js';
import { IdentityModule } from './identity/identity.module.js';
import { SessionsModule } from './sessions/sessions.module.js';
import { TenancyModule } from './tenancy/tenancy.module.js';

/** The HTTP API. */
@Module({
  imports: [
    CoreModule,
    AuthzModule,
    SessionsModule,
    AccessModule,
    HealthModule,
    IdentityModule,
    TenancyModule,
  ],
})
export class AppModule {}
