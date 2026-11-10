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
} from '@nestjs/common';
import {
  jobVersionReasonSchema,
  jobVersionSchema,
  type CustomerJobProgress,
  type FileDownloadResponse,
} from '@ogs/contracts';
import { Auth, Authenticated } from '../access/access.decorators.js';
import type { AccessState } from '../access/access.types.js';
import { parseBody } from '../access/parse-body.js';
import { idempotencyKeyFrom } from '../orders/order-support.js';
import { customerOf } from '../orders/order-views.js';
import { CustomerJobsService } from './customer-jobs.service.js';

/**
 * The customer's live job tracker (Phase 9 plan §2.9) on request (order) and
 * ticket pages. Responses use customerJobProgressSchema only: no brief, notes,
 * offers, reasons, provider names or phone numbers.
 */
@Controller()
export class CustomerJobsController {
  constructor(private readonly jobs: CustomerJobsService) {}

  @Get('requests/:id/progress')
  @Authenticated({ workspace: true })
  @Header('Cache-Control', 'no-store')
  async request(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Auth() auth: AccessState,
  ): Promise<CustomerJobProgress> {
    return this.jobs.forRequest(customerOf(auth), id);
  }

  @Post('requests/:id/job/confirm')
  @Authenticated({ workspace: true })
  @HttpCode(HttpStatus.OK)
  async confirm(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
    @Headers('idempotency-key') key: unknown,
    @Auth() auth: AccessState,
  ): Promise<CustomerJobProgress> {
    const idempotencyKey = idempotencyKeyFrom(key);
    const { version } = parseBody(jobVersionSchema, body);
    return this.jobs.confirm(customerOf(auth), id, version, idempotencyKey, auth.meta);
  }

  @Post('requests/:id/job/report-problem')
  @Authenticated({ workspace: true })
  @HttpCode(HttpStatus.OK)
  async reportProblem(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
    @Headers('idempotency-key') key: unknown,
    @Auth() auth: AccessState,
  ): Promise<CustomerJobProgress> {
    const idempotencyKey = idempotencyKeyFrom(key);
    const { version, reason } = parseBody(jobVersionReasonSchema, body);
    return this.jobs.reportProblem(
      customerOf(auth),
      id,
      version,
      reason,
      idempotencyKey,
      auth.meta,
    );
  }

  @Get('requests/:id/job/photos/:photoId/download')
  @Authenticated({ workspace: true })
  @Header('Cache-Control', 'no-store')
  async requestPhoto(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('photoId', new ParseUUIDPipe()) photoId: string,
    @Auth() auth: AccessState,
  ): Promise<FileDownloadResponse> {
    return this.jobs.photo(customerOf(auth), { kind: 'REQUEST', id }, photoId);
  }

  @Get('tickets/:id/progress')
  @Authenticated({ workspace: true })
  @Header('Cache-Control', 'no-store')
  async ticket(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Auth() auth: AccessState,
  ): Promise<CustomerJobProgress> {
    return this.jobs.forTicket(customerOf(auth), id);
  }

  @Get('tickets/:id/job/photos/:photoId/download')
  @Authenticated({ workspace: true })
  @Header('Cache-Control', 'no-store')
  async ticketPhoto(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('photoId', new ParseUUIDPipe()) photoId: string,
    @Auth() auth: AccessState,
  ): Promise<FileDownloadResponse> {
    return this.jobs.photo(customerOf(auth), { kind: 'TICKET', id }, photoId);
  }
}
