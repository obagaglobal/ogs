import { Module } from '@nestjs/common';
import { AccessModule } from './access/access.module.js';
import { AuthzModule } from './authz/authz.module.js';
import { CoreModule } from './core.module.js';
import { FilesHttpModule } from './files/files-http.module.js';
import { HealthModule } from './health/health.module.js';
import { IdentityModule } from './identity/identity.module.js';
import { InvitationsModule } from './invitations/invitations.module.js';
import { OrdersModule } from './orders/orders.module.js';
import { CatalogueModule } from './catalogue/catalogue.module.js';
import { ProvidersModule } from './providers/providers.module.js';
import { OrganisationsModule } from './organisations/organisations.module.js';
import { PlatformModule } from './platform/platform.module.js';
import { SessionsModule } from './sessions/sessions.module.js';
import { TenancyModule } from './tenancy/tenancy.module.js';
import { TicketsModule } from './tickets/tickets.module.js';
import { WorkspaceAdminModule } from './workspace-admin/workspace-admin.module.js';

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
    PlatformModule,
    FilesHttpModule,
    OrganisationsModule,
    ProvidersModule,
    CatalogueModule,
    OrdersModule,
    TicketsModule,
    InvitationsModule,
    WorkspaceAdminModule,
  ],
})
export class AppModule {}
