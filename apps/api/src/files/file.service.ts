import { createHash, randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { fileTypeFromBuffer } from 'file-type';
import { DomainError } from '../common/domain-error.js';
import { TenantDb, type Db, type DbContext } from '../database/index.js';
import { OutboxService } from '../events/outbox.service.js';
import { FILE_PURPOSES, isFilePurpose } from './file-purposes.js';
import { ObjectStorage } from './object-storage.js';

export type FileRejection =
  'unknown_purpose' | 'owner_not_allowed' | 'empty_file' | 'too_large' | 'type_not_allowed';

export class FileRejectedError extends DomainError {
  constructor(readonly reason: FileRejection) {
    super(400, `file_${reason}`);
  }
}
export class FileNotFoundError extends DomainError {
  constructor() {
    super(404, 'not_found');
  }
}
/** The file exists but is still quarantined (or was rejected by the scanner). */
export class FileNotAvailableError extends DomainError {
  constructor(readonly fileStatus: 'QUARANTINED' | 'REJECTED') {
    super(409, fileStatus === 'QUARANTINED' ? 'file_not_scanned_yet' : 'file_rejected');
  }
}

export interface UploadInput {
  readonly purpose: string;
  readonly originalName: string;
  readonly bytes: Buffer;
}

export interface StoredFile {
  readonly id: string;
  readonly mimeType: string;
  readonly sizeBytes: number;
  readonly status: 'QUARANTINED';
}

export interface Download {
  readonly url: string;
  readonly expiresInSeconds: number;
}

/**
 * Private file storage (ADR-019, Phase 3 plan §3.3).
 *
 * Upload: purpose → size limit → type sniffed from magic bytes → object stored
 * under a random key → metadata QUARANTINED + `files.uploaded` event in one
 * transaction. The worker's scanner then marks it CLEAN or REJECTED.
 * Download: metadata lookup under the caller's RLS context (another tenant's
 * file is simply not found) → only CLEAN files → 60-second presigned URL.
 */
@Injectable()
export class FileService {
  constructor(
    private readonly db: TenantDb,
    private readonly storage: ObjectStorage,
    private readonly outbox: OutboxService,
  ) {}

  async upload(ctx: DbContext, input: UploadInput): Promise<StoredFile> {
    return this.store(ctx, ownerOf(ctx), input);
  }

  /**
   * Elevated staff upload a file that belongs to someone else (Phase 8): a
   * public ticket reply's file belongs to the ticket's customer, an internal
   * note's file to the PLATFORM tenant. Only from a `platform` context.
   */
  async uploadAs(
    ctx: DbContext,
    owner: { readonly kind: 'tenant' | 'user'; readonly id: string },
    input: UploadInput,
  ): Promise<StoredFile> {
    if (ctx.kind !== 'platform') {
      throw new FileRejectedError('owner_not_allowed');
    }
    return this.store(ctx, { ...owner, uploader: ctx.userId }, input);
  }

  /**
   * Photo evidence of field work (Phase 9 plan §2.6): the job's assignee uploads
   * a `job.evidence` file OWNED BY THE JOB'S CUSTOMER, and `link` records it on
   * the job in the SAME transaction. RLS (file_metadata_insert_job_evidence)
   * admits the row only for the holder of an ACTIVE assignment of that
   * customer's job, and the job_evidence trigger re-checks owner and uploader.
   */
  async uploadJobEvidence(
    ctx: DbContext,
    customer: { readonly tenantId: string | null; readonly userId: string | null },
    input: Omit<UploadInput, 'purpose'>,
    link: (tx: Db, fileId: string) => Promise<void>,
  ): Promise<StoredFile> {
    const uploader = ownerOf(ctx)?.uploader;
    const owner =
      customer.tenantId !== null
        ? { kind: 'tenant' as const, id: customer.tenantId }
        : customer.userId !== null
          ? { kind: 'user' as const, id: customer.userId }
          : undefined;
    if (uploader === undefined || owner === undefined) {
      throw new FileRejectedError('owner_not_allowed');
    }
    return this.store(
      ctx,
      { ...owner, uploader },
      { ...input, purpose: 'job.evidence' },
      { link, anyOwner: true },
    );
  }

  private async store(
    ctx: DbContext,
    owner: { kind: 'tenant' | 'user'; id: string; uploader: string } | undefined,
    input: UploadInput,
    options: { link?: (tx: Db, fileId: string) => Promise<void>; anyOwner?: boolean } = {},
  ): Promise<StoredFile> {
    if (!isFilePurpose(input.purpose)) {
      throw new FileRejectedError('unknown_purpose');
    }
    const purpose: {
      owners: readonly string[];
      maxBytes: number;
      allowedTypes: readonly string[];
    } = FILE_PURPOSES[input.purpose];
    if (
      owner === undefined ||
      (options.anyOwner !== true && !purpose.owners.includes(owner.kind))
    ) {
      throw new FileRejectedError('owner_not_allowed');
    }
    if (input.bytes.length === 0) {
      throw new FileRejectedError('empty_file');
    }
    if (input.bytes.length > purpose.maxBytes) {
      throw new FileRejectedError('too_large');
    }
    const detected = await fileTypeFromBuffer(input.bytes);
    if (detected === undefined || !purpose.allowedTypes.includes(detected.mime)) {
      throw new FileRejectedError('type_not_allowed');
    }

    const id = randomUUID();
    const storageKey = `files/${id}`;
    await this.storage.put(storageKey, input.bytes, detected.mime);

    // A file owned by someone else (evidence: the customer) is published without a
    // tenant: the outbox insert policy allows only the current tenant or none.
    const eventTenant = owner.kind === 'tenant' && options.anyOwner !== true ? owner.id : null;
    await this.db.run(ctx, async (tx) => {
      await tx.fileMetadata.createMany({
        data: [
          {
            id,
            tenantId: owner.kind === 'tenant' ? owner.id : null,
            ownerUserId: owner.kind === 'user' ? owner.id : null,
            purpose: input.purpose,
            originalName: input.originalName.slice(0, 255),
            mimeType: detected.mime,
            sizeBytes: input.bytes.length,
            sha256: createHash('sha256').update(input.bytes).digest('hex'),
            storageKey,
            uploadedBy: owner.uploader,
          },
        ],
      });
      if (options.link !== undefined) {
        await options.link(tx, id);
      }
      await this.outbox.publish(tx, {
        type: 'files.uploaded',
        tenantId: eventTenant,
        payload: { fileId: id },
      });
    });
    return { id, mimeType: detected.mime, sizeBytes: input.bytes.length, status: 'QUARANTINED' };
  }

  /**
   * A download link for a job photo (Phase 9). The caller has already found the
   * job_evidence row under its own RLS; the file row is read under the same
   * context (file_metadata_select_job_evidence), so access ends with the assignment.
   */
  async evidenceDownloadUrl(ctx: DbContext, fileId: string): Promise<Download> {
    const file = await this.db.run(ctx, async (tx) =>
      tx.fileMetadata.findFirst({
        where: { id: fileId, purpose: 'job.evidence' },
        select: { storageKey: true, originalName: true, mimeType: true, status: true },
      }),
    );
    if (file === null) {
      throw new FileNotFoundError();
    }
    if (file.status !== 'CLEAN') {
      throw new FileNotAvailableError(file.status);
    }
    return {
      url: await this.storage.downloadUrl(file.storageKey, file.originalName, file.mimeType),
      expiresInSeconds: 60,
    };
  }

  async downloadUrl(ctx: DbContext, fileId: string): Promise<Download> {
    const owner = ownerOf(ctx);
    const file = await this.db.run(ctx, async (tx) =>
      tx.fileMetadata.findFirst({
        // RLS already hides other tenants' files; also scope to the acting owner,
        // because RLS shows a user their personal files from any workspace.
        where: {
          id: fileId,
          // Job photos are reached only through the jobs API (who may see them
          // depends on the job, not on who owns the file).
          purpose: { not: 'job.evidence' },
          ...(owner?.kind === 'tenant' ? { tenantId: owner.id } : {}),
          ...(owner?.kind === 'user' ? { ownerUserId: owner.id } : {}),
        },
        select: { storageKey: true, originalName: true, mimeType: true, status: true },
      }),
    );
    if (file === null) {
      throw new FileNotFoundError();
    }
    if (file.status !== 'CLEAN') {
      throw new FileNotAvailableError(file.status);
    }
    return {
      url: await this.storage.downloadUrl(file.storageKey, file.originalName, file.mimeType),
      expiresInSeconds: 60,
    };
  }
}

function ownerOf(ctx: DbContext) {
  switch (ctx.kind) {
    case 'workspace':
      return { kind: 'tenant' as const, id: ctx.tenantId, uploader: ctx.userId };
    case 'user':
    case 'provider':
      // The Provider workspace is the person themself: their files are user-owned.
      return { kind: 'user' as const, id: ctx.userId, uploader: ctx.userId };
    default:
      // Platform and system contexts do not upload in Phase 3.
      return undefined;
  }
}
