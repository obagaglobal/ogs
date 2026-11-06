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
  Query,
} from '@nestjs/common';
import {
  requestStatusSchema,
  submitServiceRequestSchema,
  versionBodySchema,
  versionReasonBodySchema,
  type ServiceRequest,
  type ServiceRequestListResponse,
} from '@ogs/contracts';
import { Auth, Authenticated } from '../access/access.decorators.js';
import type { AccessState } from '../access/access.types.js';
import { parseBody } from '../access/parse-body.js';
import { CustomerRequestsService } from './customer-requests.service.js';
import { idempotencyKeyFrom } from './order-support.js';
import { customerOf } from './order-views.js';

/**
 * Customers' requests (Phase 7 plan §2.3): the personal workspace for
 * individuals, an ACTIVE organisation workspace for organisations. Restricted
 * workspaces are refused by the access guard.
 */
@Controller('requests')
export class RequestsController {
  constructor(private readonly requests: CustomerRequestsService) {}

  @Post()
  @Authenticated({ workspace: true })
  async submit(
    @Body() body: unknown,
    @Headers('idempotency-key') key: unknown,
    @Auth() auth: AccessState,
  ): Promise<ServiceRequest> {
    const idempotencyKey = idempotencyKeyFrom(key);
    const input = parseBody(submitServiceRequestSchema, body);
    return this.requests.submit(customerOf(auth), input, idempotencyKey, auth.meta);
  }

  @Get()
  @Authenticated({ workspace: true })
  @Header('Cache-Control', 'no-store')
  async list(
    @Query('status') status: unknown,
    @Auth() auth: AccessState,
  ): Promise<ServiceRequestListResponse> {
    const parsed = requestStatusSchema.optional().safeParse(status);
    return {
      requests: await this.requests.list(
        customerOf(auth),
        parsed.success ? parsed.data : undefined,
      ),
    };
  }

  @Get(':id')
  @Authenticated({ workspace: true })
  @Header('Cache-Control', 'no-store')
  async get(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Auth() auth: AccessState,
  ): Promise<ServiceRequest> {
    return this.requests.get(customerOf(auth), id);
  }

  @Post(':id/cancel')
  @Authenticated({ workspace: true })
  @HttpCode(HttpStatus.OK)
  async cancel(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
    @Auth() auth: AccessState,
  ): Promise<ServiceRequest> {
    const { version, reason } = parseBody(versionReasonBodySchema, body);
    return this.requests.cancel(customerOf(auth), id, version, reason, auth.meta);
  }

  @Post(':id/quotations/:quotationId/accept')
  @Authenticated({ workspace: true })
  @HttpCode(HttpStatus.OK)
  async acceptQuotation(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('quotationId', new ParseUUIDPipe()) quotationId: string,
    @Body() body: unknown,
    @Headers('idempotency-key') key: unknown,
    @Auth() auth: AccessState,
  ): Promise<ServiceRequest> {
    const idempotencyKey = idempotencyKeyFrom(key);
    const { version } = parseBody(versionBodySchema, body);
    return this.requests.acceptQuotation(
      customerOf(auth),
      id,
      quotationId,
      version,
      idempotencyKey,
      auth.meta,
    );
  }

  @Post(':id/quotations/:quotationId/reject')
  @Authenticated({ workspace: true })
  @HttpCode(HttpStatus.OK)
  async rejectQuotation(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('quotationId', new ParseUUIDPipe()) quotationId: string,
    @Body() body: unknown,
    @Auth() auth: AccessState,
  ): Promise<ServiceRequest> {
    const { version, reason } = parseBody(versionReasonBodySchema, body);
    return this.requests.rejectQuotation(
      customerOf(auth),
      id,
      quotationId,
      version,
      reason,
      auth.meta,
    );
  }

  @Post(':id/order/cancel')
  @Authenticated({ workspace: true })
  @HttpCode(HttpStatus.OK)
  async cancelOrder(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
    @Auth() auth: AccessState,
  ): Promise<ServiceRequest> {
    const { version, reason } = parseBody(versionReasonBodySchema, body);
    return this.requests.cancelOrder(customerOf(auth), id, version, reason, auth.meta);
  }
}
