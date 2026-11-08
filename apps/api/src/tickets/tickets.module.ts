import { Module } from '@nestjs/common';
import { IdentityModule } from '../identity/identity.module.js';
import { OrdersModule } from '../orders/orders.module.js';
import { CustomerTicketsService } from './customer-tickets.service.js';
import { PlatformTicketsController } from './platform-tickets.controller.js';
import { StaffTicketsService } from './staff-tickets.service.js';
import { TicketsController } from './tickets.controller.js';

/** Tickets and the helpdesk (Phase 8). */
@Module({
  imports: [IdentityModule, OrdersModule],
  controllers: [TicketsController, PlatformTicketsController],
  providers: [CustomerTicketsService, StaffTicketsService],
})
export class TicketsModule {}
