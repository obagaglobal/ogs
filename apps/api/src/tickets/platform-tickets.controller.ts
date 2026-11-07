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
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  assignTicketSchema,
  FILE_UPLOAD_MAX_BYTES,
  linkOrderSchema,
  resolveTicketSchema,
  staffOpenTicketSchema,
  staffSubmitRequestSchema,
  staffTicketFiltersSchema,
  ticketCategoryInputSchema,
  ticketCommentInputSchema,
  ticketPriorityInputSchema,
  ticketVersionReasonSchema,
  ticketVersionSchema,
  triageTicketSchema,
  type CustomerLookup,
  type FileDownloadResponse,
  type FileUploadResponse,
  type LinkableOrders,
  type OrganisationMembers,
  type ServiceRequest,
  type StaffTicket,
  type StaffTicketQueue,
} from '@ogs/contracts';
import { z } from 'zod';
import { AcceptsMultipart, Auth, RequireElevation } from '../access/access.decorators.js';
import type { AccessState } from '../access/access.types.js';
import { parseBody } from '../access/parse-body.js';
import { badRequest } from '../common/domain-error.js';
import { TenantDb } from '../database/index.js';
import { CustomerRequestsService } from '../orders/customer-requests.service.js';
import { idempotencyKeyFrom } from '../orders/order-support.js';
import { lookupCustomers, organisationMembers, resolveOnBehalf } from './on-behalf.js';
import { StaffTicketsService, type Staff } from './staff-tickets.service.js';

const READ = 'ticket.read';
const WORK = 'ticket.comment';
const NOTE = 'ticket.internal_note';
const CREATE = 'ticket.create';
const ON_BEHALF = 'platform.request.on_behalf';

const uploadFieldsSchema = z.object({ internal: z.enum(['true', 'false']).default('false') });

interface UploadedBuffer {
  readonly buffer: Buffer;
  readonly originalname: string;
}

function staffOf(auth: AccessState): Staff {
  const workspace = auth.workspace;
  if (workspace === undefined) {
    throw new Error('elevated route without a workspace');
  }
  return { ctx: workspace.context, userId: auth.user.id, permissions: workspace.permissions };
}

/**
 * The helpdesk (Phase 8 plan §2.4). Every route requires an elevation; the
 * route names one permission and the service checks the command's own one
 * from the transition table (e.g. internal notes need ticket.internal_note).
 */
@Controller('platform')
export class PlatformTicketsController {
  constructor(
    private readonly tickets: StaffTicketsService,
    private readonly requests: CustomerRequestsService,
    private readonly db: TenantDb,
  ) {}

  @Get('tickets')
  @RequireElevation(READ)
  @Header('Cache-Control', 'no-store')
  async queue(
    @Query() query: Record<string, unknown>,
    @Auth() auth: AccessState,
  ): Promise<StaffTicketQueue> {
    const parsed = staffTicketFiltersSchema.safeParse(query);
    return this.tickets.queue(
      staffOf(auth),
      parsed.success ? parsed.data : staffTicketFiltersSchema.parse({}),
    );
  }

  @Get('ticket-assignees')
  @RequireElevation(READ)
  @Header('Cache-Control', 'no-store')
  async assignees(
    @Auth() auth: AccessState,
  ): Promise<{ assignees: { id: string; email: string }[] }> {
    return this.tickets.assignees(staffOf(auth));
  }

  @Get('customers')
  @RequireElevation(CREATE)
  @Header('Cache-Control', 'no-store')
  async customers(@Query('q') q: unknown, @Auth() auth: AccessState): Promise<CustomerLookup> {
    const query = typeof q === 'string' ? q.slice(0, 200) : '';
    return this.db.run(staffOf(auth).ctx, async (tx) => lookupCustomers(tx, query));
  }

  @Get('customers/:tenantId/members')
  @RequireElevation(CREATE)
  @Header('Cache-Control', 'no-store')
  async members(
    @Param('tenantId', new ParseUUIDPipe()) tenantId: string,
    @Auth() auth: AccessState,
  ): Promise<OrganisationMembers> {
    return this.db.run(staffOf(auth).ctx, async (tx) => organisationMembers(tx, tenantId));
  }

  @Post('tickets')
  @RequireElevation(CREATE)
  async open(
    @Body() body: unknown,
    @Headers('idempotency-key') key: unknown,
    @Auth() auth: AccessState,
  ): Promise<StaffTicket> {
    const idempotencyKey = idempotencyKeyFrom(key);
    const input = parseBody(staffOpenTicketSchema, body);
    return this.tickets.openOnBehalf(staffOf(auth), input, idempotencyKey, auth.meta);
  }

  /** A service request entered for a customer (P8-7, ADR-047). */
  @Post('requests')
  @RequireElevation(ON_BEHALF)
  async submitRequest(
    @Body() body: unknown,
    @Headers('idempotency-key') key: unknown,
    @Auth() auth: AccessState,
  ): Promise<ServiceRequest> {
    const idempotencyKey = idempotencyKeyFrom(key);
    const input = parseBody(staffSubmitRequestSchema, body);
    const staff = staffOf(auth);
    const customer = await this.db.run(staff.ctx, async (tx) =>
      resolveOnBehalf(tx, input.customer),
    );
    return this.requests.submitOnBehalf(
      staff.ctx,
      {
        customerTenantId: customer.customerTenantId,
        customerUserId: customer.customerUserId,
        createdBy: customer.requesterUserId,
      },
      input.request,
      idempotencyKey,
      auth.meta,
    );
  }

  @Get('tickets/:id')
  @RequireElevation(READ)
  @Header('Cache-Control', 'no-store')
  async detail(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Auth() auth: AccessState,
  ): Promise<StaffTicket> {
    return this.tickets.detail(staffOf(auth), id);
  }

  @Get('tickets/:id/linkable-orders')
  @RequireElevation(READ)
  @Header('Cache-Control', 'no-store')
  async linkableOrders(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Auth() auth: AccessState,
  ): Promise<LinkableOrders> {
    return this.tickets.linkableOrders(staffOf(auth), id);
  }

  @Post('tickets/:id/triage')
  @RequireElevation(WORK)
  @HttpCode(HttpStatus.OK)
  async triage(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
    @Auth() auth: AccessState,
  ): Promise<StaffTicket> {
    const { version, priority, categoryCode } = parseBody(triageTicketSchema, body);
    return this.tickets.status(staffOf(auth), id, 'triage', version, auth.meta, {
      priority,
      categoryCode,
    });
  }

  @Post('tickets/:id/start')
  @RequireElevation(WORK)
  @HttpCode(HttpStatus.OK)
  async start(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
    @Auth() auth: AccessState,
  ): Promise<StaffTicket> {
    const { version } = parseBody(ticketVersionSchema, body);
    return this.tickets.status(staffOf(auth), id, 'start', version, auth.meta);
  }

  @Post('tickets/:id/await-customer')
  @RequireElevation(WORK)
  @HttpCode(HttpStatus.OK)
  async awaitCustomer(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
    @Auth() auth: AccessState,
  ): Promise<StaffTicket> {
    const { version } = parseBody(ticketVersionSchema, body);
    return this.tickets.status(staffOf(auth), id, 'awaitCustomer', version, auth.meta);
  }

  @Post('tickets/:id/hold')
  @RequireElevation(WORK)
  @HttpCode(HttpStatus.OK)
  async hold(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
    @Auth() auth: AccessState,
  ): Promise<StaffTicket> {
    const { version, reason } = parseBody(ticketVersionReasonSchema, body);
    return this.tickets.status(staffOf(auth), id, 'hold', version, auth.meta, { reason });
  }

  @Post('tickets/:id/resume')
  @RequireElevation(WORK)
  @HttpCode(HttpStatus.OK)
  async resume(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
    @Auth() auth: AccessState,
  ): Promise<StaffTicket> {
    const { version } = parseBody(ticketVersionSchema, body);
    return this.tickets.status(staffOf(auth), id, 'resume', version, auth.meta);
  }

  @Post('tickets/:id/resolve')
  @RequireElevation(WORK)
  @HttpCode(HttpStatus.OK)
  async resolve(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
    @Auth() auth: AccessState,
  ): Promise<StaffTicket> {
    const { version, resolution } = parseBody(resolveTicketSchema, body);
    return this.tickets.status(staffOf(auth), id, 'resolve', version, auth.meta, { resolution });
  }

  @Post('tickets/:id/reopen')
  @RequireElevation(WORK)
  @HttpCode(HttpStatus.OK)
  async reopen(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
    @Auth() auth: AccessState,
  ): Promise<StaffTicket> {
    const { version } = parseBody(ticketVersionSchema, body);
    return this.tickets.status(staffOf(auth), id, 'staffReopen', version, auth.meta);
  }

  @Post('tickets/:id/priority')
  @RequireElevation(WORK)
  @HttpCode(HttpStatus.OK)
  async priority(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
    @Auth() auth: AccessState,
  ): Promise<StaffTicket> {
    const { version, priority, reason } = parseBody(ticketPriorityInputSchema, body);
    return this.tickets.setPriority(staffOf(auth), id, version, priority, reason, auth.meta);
  }

  @Post('tickets/:id/category')
  @RequireElevation(WORK)
  @HttpCode(HttpStatus.OK)
  async category(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
    @Auth() auth: AccessState,
  ): Promise<StaffTicket> {
    const { version, categoryCode } = parseBody(ticketCategoryInputSchema, body);
    return this.tickets.setCategory(staffOf(auth), id, version, categoryCode, auth.meta);
  }

  @Post('tickets/:id/link-order')
  @RequireElevation(WORK)
  @HttpCode(HttpStatus.OK)
  async linkOrder(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
    @Auth() auth: AccessState,
  ): Promise<StaffTicket> {
    const { version, serviceOrderId } = parseBody(linkOrderSchema, body);
    return this.tickets.linkOrder(staffOf(auth), id, version, serviceOrderId, auth.meta);
  }

  @Post('tickets/:id/take')
  @RequireElevation(WORK)
  @HttpCode(HttpStatus.OK)
  async take(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
    @Auth() auth: AccessState,
  ): Promise<StaffTicket> {
    const { version } = parseBody(ticketVersionSchema, body);
    return this.tickets.take(staffOf(auth), id, version, auth.meta);
  }

  @Post('tickets/:id/assign')
  @RequireElevation('ticket.assign')
  @HttpCode(HttpStatus.OK)
  async assign(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
    @Auth() auth: AccessState,
  ): Promise<StaffTicket> {
    const { version, assigneeUserId } = parseBody(assignTicketSchema, body);
    return this.tickets.assign(staffOf(auth), id, version, assigneeUserId, auth.meta);
  }

  @Post('tickets/:id/comments')
  @RequireElevation(WORK)
  @HttpCode(HttpStatus.OK)
  async comment(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
    @Auth() auth: AccessState,
  ): Promise<StaffTicket> {
    const { body: text, attachmentIds } = parseBody(ticketCommentInputSchema, body);
    return this.tickets.comment(staffOf(auth), id, text, attachmentIds, auth.meta);
  }

  @Post('tickets/:id/notes')
  @RequireElevation(NOTE)
  @HttpCode(HttpStatus.OK)
  async note(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
    @Auth() auth: AccessState,
  ): Promise<StaffTicket> {
    const { body: text, attachmentIds } = parseBody(ticketCommentInputSchema, body);
    return this.tickets.note(staffOf(auth), id, text, attachmentIds, auth.meta);
  }

  /** Upload for a reply (internal=false) or an internal note (internal=true). */
  @Post('tickets/:id/files')
  @RequireElevation(WORK)
  @AcceptsMultipart()
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: FILE_UPLOAD_MAX_BYTES, files: 1, fields: 5, parts: 7 },
    }),
  )
  async upload(
    @Param('id', new ParseUUIDPipe()) id: string,
    @UploadedFile() file: UploadedBuffer | undefined,
    @Body() body: unknown,
    @Auth() auth: AccessState,
  ): Promise<FileUploadResponse> {
    const { internal } = parseBody(uploadFieldsSchema, body);
    if (file === undefined) {
      throw badRequest('file_missing');
    }
    return this.tickets.upload(staffOf(auth), id, internal === 'true', {
      purpose: 'ticket.attachment',
      originalName: file.originalname,
      bytes: file.buffer,
    });
  }

  @Get('tickets/:id/attachments/:attachmentId/download')
  @RequireElevation(READ)
  @Header('Cache-Control', 'no-store')
  async download(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('attachmentId', new ParseUUIDPipe()) attachmentId: string,
    @Auth() auth: AccessState,
  ): Promise<FileDownloadResponse> {
    return this.tickets.download(staffOf(auth), id, attachmentId);
  }
}
