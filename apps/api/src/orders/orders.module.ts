import { Module } from '@nestjs/common';
import { CustomerRequestsService } from './customer-requests.service.js';
import { PlatformOrdersController } from './platform-orders.controller.js';
import { RequestsController } from './requests.controller.js';
import { FinanceService, StaffRequestsService } from './staff-orders.service.js';

/** Service requests, quotations, orders and manual payments (Phase 7). */
@Module({
  controllers: [RequestsController, PlatformOrdersController],
  providers: [CustomerRequestsService, StaffRequestsService, FinanceService],
})
export class OrdersModule {}
