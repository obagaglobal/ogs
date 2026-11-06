import {
  Body,
  Controller,
  Get,
  Header,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import {
  billingTermsSchema,
  orderStatusSchema,
  recordPaymentSchema,
  requestStatusSchema,
  saveQuotationDraftSchema,
  versionBodySchema,
  versionReasonBodySchema,
  type BillingResponse,
  type ServiceRequest,
  type ServiceRequestListResponse,
} from '@ogs/contracts';
import { Auth, Ctx, RequireElevation } from '../access/access.decorators.js';
import type { AccessState } from '../access/access.types.js';
import { parseBody } from '../access/parse-body.js';
import { notFound } from '../common/domain-error.js';
import { TenantDb, type DbContext } from '../database/index.js';
import { idempotencyKeyFrom } from './order-support.js';
import { loadRequestView } from './order-views.js';
import { FinanceService, StaffRequestsService } from './staff-orders.service.js';

const SALES = 'platform.quotation.issue';
const FINANCE = 'platform.finance.manage';

/**
 * Staff side of Phase 7 (plan §2.4). Request decisions and quotations need
 * platform.quotation.issue; payments, order cancellation and billing terms need
 * platform.finance.manage. Every route requires an elevation.
 */
@Controller('platform')
export class PlatformOrdersController {
  constructor(
    private readonly staff: StaffRequestsService,
    private readonly finance: FinanceService,
    private readonly db: TenantDb,
  ) {}

  @Get('requests')
  @RequireElevation(SALES)
  @Header('Cache-Control', 'no-store')
  async queue(
    @Query('status') status: unknown,
    @Ctx() ctx: DbContext,
  ): Promise<ServiceRequestListResponse> {
    const parsed = requestStatusSchema.optional().safeParse(status);
    return { requests: await this.staff.queue(ctx, parsed.success ? parsed.data : undefined) };
  }

  @Get('requests/:id')
  @RequireElevation(SALES)
  @Header('Cache-Control', 'no-store')
  async detail(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Ctx() ctx: DbContext,
  ): Promise<ServiceRequest> {
    return this.staff.detail(ctx, id);
  }

  @Post('requests/:id/review')
  @RequireElevation(SALES)
  @HttpCode(HttpStatus.OK)
  async review(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
    @Ctx() ctx: DbContext,
    @Auth() auth: AccessState,
  ): Promise<ServiceRequest> {
    return this.staff.review(ctx, id, parseBody(versionBodySchema, body).version, auth.meta);
  }

  @Post('requests/:id/accept')
  @RequireElevation(SALES)
  @HttpCode(HttpStatus.OK)
  async accept(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
    @Ctx() ctx: DbContext,
    @Auth() auth: AccessState,
  ): Promise<ServiceRequest> {
    return this.staff.accept(ctx, id, parseBody(versionBodySchema, body).version, auth.meta);
  }

  @Post('requests/:id/needs-quotation')
  @RequireElevation(SALES)
  @HttpCode(HttpStatus.OK)
  async needsQuotation(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
    @Ctx() ctx: DbContext,
    @Auth() auth: AccessState,
  ): Promise<ServiceRequest> {
    return this.staff.needsQuotation(
      ctx,
      id,
      parseBody(versionBodySchema, body).version,
      auth.meta,
    );
  }

  @Post('requests/:id/cancel')
  @RequireElevation(SALES)
  @HttpCode(HttpStatus.OK)
  async cancel(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
    @Ctx() ctx: DbContext,
    @Auth() auth: AccessState,
  ): Promise<ServiceRequest> {
    const { version, reason } = parseBody(versionReasonBodySchema, body);
    return this.staff.cancel(ctx, id, version, reason, auth.meta);
  }

  @Put('requests/:id/quotation')
  @RequireElevation(SALES)
  async saveDraft(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
    @Ctx() ctx: DbContext,
    @Auth() auth: AccessState,
  ): Promise<ServiceRequest> {
    return this.staff.saveDraft(ctx, id, parseBody(saveQuotationDraftSchema, body), auth.meta);
  }

  @Post('requests/:id/quotations/:quotationId/issue')
  @RequireElevation(SALES)
  @HttpCode(HttpStatus.OK)
  async issue(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('quotationId', new ParseUUIDPipe()) quotationId: string,
    @Body() body: unknown,
    @Ctx() ctx: DbContext,
    @Auth() auth: AccessState,
  ): Promise<ServiceRequest> {
    return this.staff.issue(
      ctx,
      id,
      quotationId,
      parseBody(versionBodySchema, body).version,
      auth.meta,
    );
  }

  // ------------------------------------------------------------ finance

  @Get('orders')
  @RequireElevation(FINANCE)
  @Header('Cache-Control', 'no-store')
  async orders(@Query('status') status: unknown, @Ctx() ctx: DbContext) {
    const parsed = orderStatusSchema.optional().safeParse(status);
    return { orders: await this.finance.orders(ctx, parsed.success ? parsed.data : undefined) };
  }

  @Get('orders/:id')
  @RequireElevation(FINANCE)
  @Header('Cache-Control', 'no-store')
  async order(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Ctx() ctx: DbContext,
  ): Promise<ServiceRequest> {
    return this.db.run(ctx, async (tx) => {
      const order = await tx.serviceOrder.findUnique({
        where: { id },
        select: { requestId: true },
      });
      if (order === null) {
        throw notFound();
      }
      return loadRequestView(tx, order.requestId);
    });
  }

  @Post('orders/:id/payments')
  @RequireElevation(FINANCE)
  @HttpCode(HttpStatus.OK)
  async recordPayment(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
    @Headers('idempotency-key') key: unknown,
    @Ctx() ctx: DbContext,
    @Auth() auth: AccessState,
  ): Promise<ServiceRequest> {
    const idempotencyKey = idempotencyKeyFrom(key);
    return this.finance.recordPayment(
      ctx,
      id,
      parseBody(recordPaymentSchema, body),
      idempotencyKey,
      auth.meta,
    );
  }

  @Post('orders/:id/cancel')
  @RequireElevation(FINANCE)
  @HttpCode(HttpStatus.OK)
  async cancelOrder(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
    @Ctx() ctx: DbContext,
    @Auth() auth: AccessState,
  ): Promise<ServiceRequest> {
    const { version, reason } = parseBody(versionReasonBodySchema, body);
    return this.finance.cancelOrder(ctx, id, version, reason, auth.meta);
  }

  @Get('organisations/:tenantId/billing')
  @RequireElevation(FINANCE)
  @Header('Cache-Control', 'no-store')
  async billing(
    @Param('tenantId', new ParseUUIDPipe()) tenantId: string,
    @Ctx() ctx: DbContext,
  ): Promise<BillingResponse> {
    return this.finance.billing(ctx, tenantId);
  }

  @Put('organisations/:tenantId/billing')
  @RequireElevation(FINANCE)
  async setBilling(
    @Param('tenantId', new ParseUUIDPipe()) tenantId: string,
    @Body() body: unknown,
    @Ctx() ctx: DbContext,
    @Auth() auth: AccessState,
  ): Promise<BillingResponse> {
    return this.finance.setBilling(ctx, tenantId, parseBody(billingTermsSchema, body), auth.meta);
  }
}
