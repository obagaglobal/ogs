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
  acceptOfferSchema,
  assigneeJobFiltersSchema,
  changeTechnicianSchema,
  completionInputSchema,
  declineOfferSchema,
  evidenceFieldsSchema,
  FILE_UPLOAD_MAX_BYTES,
  jobVersionReasonSchema,
  jobVersionSchema,
  workNoteInputSchema,
  type AssigneeJob,
  type AssigneeJobList,
  type AssigneeOffer,
  type FileDownloadResponse,
} from '@ogs/contracts';
import { AcceptsMultipart, Auth, Authenticated } from '../access/access.decorators.js';
import type { AccessState } from '../access/access.types.js';
import { parseBody } from '../access/parse-body.js';
import { badRequest } from '../common/domain-error.js';
import { idempotencyKeyFrom } from '../orders/order-support.js';
import { AssigneeJobsService, type ProgressCommand } from './assignee-jobs.service.js';
import { assigneeOf } from './job-actors.js';

interface UploadedBuffer {
  readonly buffer: Buffer;
  readonly originalname: string;
}

/**
 * Field work (Phase 9 plan §2.6): the Provider workspace, a provider company's
 * workspace, or the PLATFORM workspace without elevation (internal
 * technicians). Every response is parsed through the assignee schemas, which
 * have no money, customer-email or internal-note field for providers.
 * Commands take an Idempotency-Key, so a retry on a weak signal is safe.
 */
@Controller('jobs')
export class JobsController {
  constructor(private readonly jobs: AssigneeJobsService) {}

  @Get()
  @Authenticated({ workspace: true })
  @Header('Cache-Control', 'no-store')
  async list(
    @Query() query: Record<string, unknown>,
    @Auth() auth: AccessState,
  ): Promise<AssigneeJobList> {
    const parsed = assigneeJobFiltersSchema.safeParse(query);
    return this.jobs.list(
      assigneeOf(auth),
      parsed.success ? parsed.data : assigneeJobFiltersSchema.parse({}),
    );
  }

  @Get('offers/:offerId')
  @Authenticated({ workspace: true })
  @Header('Cache-Control', 'no-store')
  async offer(
    @Param('offerId', new ParseUUIDPipe()) offerId: string,
    @Auth() auth: AccessState,
  ): Promise<AssigneeOffer> {
    return this.jobs.offer(assigneeOf(auth), offerId);
  }

  @Post('offers/:offerId/accept')
  @Authenticated({ workspace: true })
  async accept(
    @Param('offerId', new ParseUUIDPipe()) offerId: string,
    @Body() body: unknown,
    @Headers('idempotency-key') key: unknown,
    @Auth() auth: AccessState,
  ): Promise<AssigneeJob> {
    const idempotencyKey = idempotencyKeyFrom(key);
    const { technicianUserId } = parseBody(acceptOfferSchema, body);
    return this.jobs.accept(assigneeOf(auth), offerId, technicianUserId, idempotencyKey, auth.meta);
  }

  @Post('offers/:offerId/decline')
  @Authenticated({ workspace: true })
  @HttpCode(HttpStatus.OK)
  async decline(
    @Param('offerId', new ParseUUIDPipe()) offerId: string,
    @Body() body: unknown,
    @Headers('idempotency-key') key: unknown,
    @Auth() auth: AccessState,
  ): Promise<{ declined: true }> {
    const idempotencyKey = idempotencyKeyFrom(key);
    const input = parseBody(declineOfferSchema, body);
    return this.jobs.decline(assigneeOf(auth), offerId, input, idempotencyKey, auth.meta);
  }

  @Get(':id')
  @Authenticated({ workspace: true })
  @Header('Cache-Control', 'no-store')
  async detail(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Auth() auth: AccessState,
  ): Promise<AssigneeJob> {
    return this.jobs.detail(assigneeOf(auth), id);
  }

  @Post(':id/on-the-way')
  @Authenticated({ workspace: true })
  async onTheWay(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
    @Headers('idempotency-key') key: unknown,
    @Auth() auth: AccessState,
  ): Promise<AssigneeJob> {
    return this.move(id, 'onTheWay', body, key, auth);
  }

  @Post(':id/start')
  @Authenticated({ workspace: true })
  async start(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
    @Headers('idempotency-key') key: unknown,
    @Auth() auth: AccessState,
  ): Promise<AssigneeJob> {
    return this.move(id, 'start', body, key, auth);
  }

  @Post(':id/pause')
  @Authenticated({ workspace: true })
  async pause(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
    @Headers('idempotency-key') key: unknown,
    @Auth() auth: AccessState,
  ): Promise<AssigneeJob> {
    const idempotencyKey = idempotencyKeyFrom(key);
    const { version, reason } = parseBody(jobVersionReasonSchema, body);
    return this.jobs.progress(
      assigneeOf(auth),
      id,
      'pause',
      version,
      reason,
      idempotencyKey,
      auth.meta,
    );
  }

  @Post(':id/resume')
  @Authenticated({ workspace: true })
  async resume(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
    @Headers('idempotency-key') key: unknown,
    @Auth() auth: AccessState,
  ): Promise<AssigneeJob> {
    return this.move(id, 'resume', body, key, auth);
  }

  @Post(':id/notes')
  @Authenticated({ workspace: true })
  async note(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
    @Headers('idempotency-key') key: unknown,
    @Auth() auth: AccessState,
  ): Promise<AssigneeJob> {
    const idempotencyKey = idempotencyKeyFrom(key);
    const input = parseBody(workNoteInputSchema, body);
    return this.jobs.note(assigneeOf(auth), id, input.body, idempotencyKey);
  }

  @Post(':id/photos')
  @Authenticated({ workspace: true })
  @AcceptsMultipart()
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: FILE_UPLOAD_MAX_BYTES, files: 1, fields: 5, parts: 7 },
    }),
  )
  async photo(
    @Param('id', new ParseUUIDPipe()) id: string,
    @UploadedFile() file: UploadedBuffer | undefined,
    @Body() body: unknown,
    @Auth() auth: AccessState,
  ): Promise<AssigneeJob> {
    const { caption } = parseBody(evidenceFieldsSchema, body);
    if (file === undefined) {
      throw badRequest('file_missing');
    }
    const result = await this.jobs.photo(
      assigneeOf(auth),
      id,
      { originalName: file.originalname, bytes: file.buffer },
      caption,
    );
    return result.job;
  }

  @Post(':id/completion')
  @Authenticated({ workspace: true })
  async complete(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
    @Headers('idempotency-key') key: unknown,
    @Auth() auth: AccessState,
  ): Promise<AssigneeJob> {
    const idempotencyKey = idempotencyKeyFrom(key);
    const input = parseBody(completionInputSchema, body);
    return this.jobs.complete(assigneeOf(auth), id, input, idempotencyKey, auth.meta);
  }

  @Post(':id/technician')
  @Authenticated({ workspace: true })
  async technician(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
    @Headers('idempotency-key') key: unknown,
    @Auth() auth: AccessState,
  ): Promise<AssigneeJob> {
    const idempotencyKey = idempotencyKeyFrom(key);
    const input = parseBody(changeTechnicianSchema, body);
    return this.jobs.changeTechnician(assigneeOf(auth), id, input, idempotencyKey, auth.meta);
  }

  @Get(':id/photos/:photoId/download')
  @Authenticated({ workspace: true })
  @Header('Cache-Control', 'no-store')
  async download(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('photoId', new ParseUUIDPipe()) photoId: string,
    @Auth() auth: AccessState,
  ): Promise<FileDownloadResponse> {
    return this.jobs.photoDownload(assigneeOf(auth), id, photoId);
  }

  private async move(
    id: string,
    command: Exclude<ProgressCommand, 'pause'>,
    body: unknown,
    key: unknown,
    auth: AccessState,
  ): Promise<AssigneeJob> {
    const idempotencyKey = idempotencyKeyFrom(key);
    const { version } = parseBody(jobVersionSchema, body);
    return this.jobs.progress(
      assigneeOf(auth),
      id,
      command,
      version,
      null,
      idempotencyKey,
      auth.meta,
    );
  }
}
