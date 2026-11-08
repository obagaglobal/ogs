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
  customerTicketFiltersSchema,
  openTicketSchema,
  ticketCommentInputSchema,
  ticketVersionReasonSchema,
  ticketVersionSchema,
  type CustomerTicket,
  type CustomerTicketList,
  type FileDownloadResponse,
  type LinkableOrders,
  type TicketCategory,
} from '@ogs/contracts';
import { Auth, Authenticated, Ctx } from '../access/access.decorators.js';
import type { AccessState } from '../access/access.types.js';
import { parseBody } from '../access/parse-body.js';
import type { DbContext } from '../database/index.js';
import { idempotencyKeyFrom } from '../orders/order-support.js';
import { customerOf } from '../orders/order-views.js';
import { CustomerTicketsService } from './customer-tickets.service.js';

/**
 * Customers' tickets (Phase 8 plan §2.3): the personal workspace for
 * individuals, an ACTIVE organisation workspace for organisations. Every
 * response here is built by loadCustomerTicket / the customer list schema:
 * there is no route on this controller that can return internal data.
 */
@Controller('tickets')
export class TicketsController {
  constructor(private readonly tickets: CustomerTicketsService) {}

  @Get('categories')
  @Authenticated({ workspace: true })
  async categories(@Ctx() ctx: DbContext): Promise<{ categories: TicketCategory[] }> {
    return { categories: await this.tickets.categories(ctx) };
  }

  @Get('linkable-orders')
  @Authenticated({ workspace: true })
  @Header('Cache-Control', 'no-store')
  async linkableOrders(@Auth() auth: AccessState): Promise<LinkableOrders> {
    return this.tickets.linkableOrders(customerOf(auth));
  }

  @Post()
  @Authenticated({ workspace: true })
  async open(
    @Body() body: unknown,
    @Headers('idempotency-key') key: unknown,
    @Auth() auth: AccessState,
  ): Promise<CustomerTicket> {
    const idempotencyKey = idempotencyKeyFrom(key);
    const input = parseBody(openTicketSchema, body);
    return this.tickets.open(customerOf(auth), input, idempotencyKey, auth.meta);
  }

  @Get()
  @Authenticated({ workspace: true })
  @Header('Cache-Control', 'no-store')
  async list(
    @Query() query: Record<string, unknown>,
    @Auth() auth: AccessState,
  ): Promise<CustomerTicketList> {
    const parsed = customerTicketFiltersSchema.safeParse(query);
    return this.tickets.list(
      customerOf(auth),
      parsed.success ? parsed.data : customerTicketFiltersSchema.parse({}),
    );
  }

  @Get(':id')
  @Authenticated({ workspace: true })
  @Header('Cache-Control', 'no-store')
  async get(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Auth() auth: AccessState,
  ): Promise<CustomerTicket> {
    return this.tickets.get(customerOf(auth), id);
  }

  @Post(':id/comments')
  @Authenticated({ workspace: true })
  @HttpCode(HttpStatus.OK)
  async comment(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
    @Auth() auth: AccessState,
  ): Promise<CustomerTicket> {
    const input = parseBody(ticketCommentInputSchema, body);
    return this.tickets.comment(customerOf(auth), id, input, auth.meta);
  }

  @Post(':id/reopen')
  @Authenticated({ workspace: true })
  @HttpCode(HttpStatus.OK)
  async reopen(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
    @Auth() auth: AccessState,
  ): Promise<CustomerTicket> {
    const { version, reason } = parseBody(ticketVersionReasonSchema, body);
    return this.tickets.reopen(customerOf(auth), id, version, reason, auth.meta);
  }

  @Post(':id/accept-resolution')
  @Authenticated({ workspace: true })
  @HttpCode(HttpStatus.OK)
  async acceptResolution(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
    @Auth() auth: AccessState,
  ): Promise<CustomerTicket> {
    const { version } = parseBody(ticketVersionSchema, body);
    return this.tickets.acceptResolution(customerOf(auth), id, version, auth.meta);
  }

  @Post(':id/withdraw')
  @Authenticated({ workspace: true })
  @HttpCode(HttpStatus.OK)
  async withdraw(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
    @Auth() auth: AccessState,
  ): Promise<CustomerTicket> {
    const { version, reason } = parseBody(ticketVersionReasonSchema, body);
    return this.tickets.withdraw(customerOf(auth), id, version, reason, auth.meta);
  }

  @Get(':id/attachments/:attachmentId/download')
  @Authenticated({ workspace: true })
  @Header('Cache-Control', 'no-store')
  async download(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('attachmentId', new ParseUUIDPipe()) attachmentId: string,
    @Auth() auth: AccessState,
  ): Promise<FileDownloadResponse> {
    return this.tickets.download(customerOf(auth), id, attachmentId);
  }
}
