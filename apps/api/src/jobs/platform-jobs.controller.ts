import {
  Body,
  Controller,
  Get,
  Header,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import {
  dispatchTicketSchema,
  jobBriefInputSchema,
  jobVersionReasonSchema,
  jobVersionSchema,
  sendOfferSchema,
  staffJobFiltersSchema,
  type FileDownloadResponse,
  type JobCandidates,
  type StaffJob,
  type StaffJobQueue,
  type StaffJobSummary,
} from '@ogs/contracts';
import { Auth, RequireElevation } from '../access/access.decorators.js';
import type { AccessState } from '../access/access.types.js';
import { parseBody } from '../access/parse-body.js';
import { staffOf } from './job-actors.js';
import { StaffJobsService } from './staff-jobs.service.js';

/** Dispatch (ADR-035): operations, service and ICT support managers. */
const DISPATCH = 'ticket.assign';
/** Seeing a job's status from a ticket or an order page. */
const READ = 'ticket.read';
/** P9-7: confirming on the customer's behalf (audited). */
const CONFIRM = 'ticket.confirm_completion';

/**
 * The dispatch desk (Phase 9 plan §2.6). Every route needs an elevation in
 * the PLATFORM workspace; the service checks each command's own permission.
 */
@Controller('platform')
export class PlatformJobsController {
  constructor(private readonly jobs: StaffJobsService) {}

  @Get('jobs')
  @RequireElevation(DISPATCH)
  @Header('Cache-Control', 'no-store')
  async queue(
    @Query() query: Record<string, unknown>,
    @Auth() auth: AccessState,
  ): Promise<StaffJobQueue> {
    const parsed = staffJobFiltersSchema.safeParse(query);
    return this.jobs.queue(
      staffOf(auth),
      parsed.success ? parsed.data : staffJobFiltersSchema.parse({}),
    );
  }

  @Get('orders/:id/job')
  @RequireElevation(READ)
  @Header('Cache-Control', 'no-store')
  async forOrder(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Auth() auth: AccessState,
  ): Promise<{ job: StaffJobSummary | null }> {
    return this.jobs.bySource(staffOf(auth), 'ORDER', id);
  }

  @Get('tickets/:id/job')
  @RequireElevation(READ)
  @Header('Cache-Control', 'no-store')
  async forTicket(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Auth() auth: AccessState,
  ): Promise<{ job: StaffJobSummary | null }> {
    return this.jobs.bySource(staffOf(auth), 'TICKET', id);
  }

  @Post('tickets/:id/jobs')
  @RequireElevation(DISPATCH)
  async dispatchTicket(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
    @Auth() auth: AccessState,
  ): Promise<StaffJob> {
    const input = parseBody(dispatchTicketSchema, body);
    return this.jobs.dispatchTicket(staffOf(auth), id, input, auth.meta);
  }

  @Get('jobs/:id')
  @RequireElevation(DISPATCH)
  @Header('Cache-Control', 'no-store')
  async detail(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Auth() auth: AccessState,
  ): Promise<StaffJob> {
    return this.jobs.detail(staffOf(auth), id);
  }

  @Get('jobs/:id/candidates')
  @RequireElevation(DISPATCH)
  @Header('Cache-Control', 'no-store')
  async candidates(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Auth() auth: AccessState,
  ): Promise<JobCandidates> {
    return this.jobs.candidates(staffOf(auth), id);
  }

  @Patch('jobs/:id/brief')
  @RequireElevation(DISPATCH)
  async brief(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
    @Auth() auth: AccessState,
  ): Promise<StaffJob> {
    const input = parseBody(jobBriefInputSchema, body);
    return this.jobs.editBrief(staffOf(auth), id, input, auth.meta);
  }

  @Post('jobs/:id/offers')
  @RequireElevation(DISPATCH)
  async offer(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
    @Auth() auth: AccessState,
  ): Promise<StaffJob> {
    const input = parseBody(sendOfferSchema, body);
    return this.jobs.offer(staffOf(auth), id, input, auth.meta);
  }

  @Post('jobs/:id/offers/:offerId/withdraw')
  @RequireElevation(DISPATCH)
  async withdraw(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('offerId', new ParseUUIDPipe()) offerId: string,
    @Body() body: unknown,
    @Auth() auth: AccessState,
  ): Promise<StaffJob> {
    const { version } = parseBody(jobVersionSchema, body);
    return this.jobs.withdraw(staffOf(auth), id, offerId, version, auth.meta);
  }

  @Post('jobs/:id/reassign')
  @RequireElevation(DISPATCH)
  async reassign(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
    @Auth() auth: AccessState,
  ): Promise<StaffJob> {
    const { version, reason } = parseBody(jobVersionReasonSchema, body);
    return this.jobs.reassign(staffOf(auth), id, version, reason, auth.meta);
  }

  @Post('jobs/:id/cancel')
  @RequireElevation(DISPATCH)
  async cancel(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
    @Auth() auth: AccessState,
  ): Promise<StaffJob> {
    const { version, reason } = parseBody(jobVersionReasonSchema, body);
    return this.jobs.cancel(staffOf(auth), id, version, reason, auth.meta);
  }

  @Post('jobs/:id/confirm')
  @RequireElevation(CONFIRM)
  async confirm(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
    @Auth() auth: AccessState,
  ): Promise<StaffJob> {
    const { version, reason } = parseBody(jobVersionReasonSchema, body);
    return this.jobs.confirm(staffOf(auth), id, version, reason, auth.meta);
  }

  @Get('jobs/:id/photos/:photoId/download')
  @RequireElevation(READ)
  @Header('Cache-Control', 'no-store')
  async photo(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('photoId', new ParseUUIDPipe()) photoId: string,
    @Auth() auth: AccessState,
  ): Promise<FileDownloadResponse> {
    return this.jobs.photo(staffOf(auth), id, photoId);
  }
}
