import {
  Body,
  Controller,
  Get,
  Header,
  Param,
  ParseUUIDPipe,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  FILE_UPLOAD_MAX_BYTES,
  type FileDownloadResponse,
  type FileUploadResponse,
} from '@ogs/contracts';
import { z } from 'zod';
import { AcceptsMultipart, Auth, Authenticated, Ctx } from '../access/access.decorators.js';
import type { AccessState } from '../access/access.types.js';
import { parseBody } from '../access/parse-body.js';
import { badRequest, forbiddenRule } from '../common/domain-error.js';
import type { DbContext } from '../database/index.js';
import { FILE_PURPOSES, isFilePurpose } from './file-purposes.js';
import { FileService } from './file.service.js';

const uploadFieldsSchema = z.object({ purpose: z.string().min(1).max(50) });

interface UploadedBuffer {
  readonly buffer: Buffer;
  readonly originalname: string;
}

/**
 * Uploads and downloads (Phase 4 plan §2.1, first consumer: organisation
 * documents). The workspace in X-OGS-Workspace (or personal) owns the file;
 * purposes decide owners, size, types and the permission needed.
 */
@Controller('files')
export class FilesController {
  constructor(private readonly files: FileService) {}

  @Post()
  @Authenticated({ workspace: true, allowRestricted: true })
  @AcceptsMultipart()
  @UseInterceptors(
    FileInterceptor('file', {
      // No storage/dest given: multer keeps the file in memory, never on disk.
      limits: { fileSize: FILE_UPLOAD_MAX_BYTES, files: 1, fields: 5, parts: 7 },
    }),
  )
  async upload(
    @UploadedFile() file: UploadedBuffer | undefined,
    @Body() body: unknown,
    @Ctx() ctx: DbContext,
    @Auth() auth: AccessState,
  ): Promise<FileUploadResponse> {
    const { purpose } = parseBody(uploadFieldsSchema, body);
    if (file === undefined) {
      throw badRequest('file_missing');
    }
    // A pending organisation may only upload the evidence for its application.
    const resolved = auth.workspace?.resolved;
    if (
      resolved !== undefined &&
      resolved.kind !== 'personal' &&
      resolved.restricted &&
      purpose !== 'organisation.document'
    ) {
      throw forbiddenRule('workspace_restricted');
    }
    if (isFilePurpose(purpose)) {
      const required: string | undefined = (FILE_PURPOSES[purpose] as { permission?: string })
        .permission;
      // The permission applies to tenant-owned uploads; personal uploads fall through to
      // the purpose's owner rule (e.g. organisation documents are never personal).
      const inTenant = resolved !== undefined && resolved.kind !== 'personal';
      if (required !== undefined && inTenant && !auth.workspace?.permissions.has(required)) {
        throw forbiddenRule('permission_denied');
      }
    }
    return this.files.upload(ctx, {
      purpose,
      originalName: file.originalname,
      bytes: file.buffer,
    });
  }

  @Get(':id/download')
  @Authenticated({ workspace: true, allowRestricted: true })
  @Header('Cache-Control', 'no-store')
  async download(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Ctx() ctx: DbContext,
  ): Promise<FileDownloadResponse> {
    return this.files.downloadUrl(ctx, id);
  }
}
