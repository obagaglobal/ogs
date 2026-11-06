import { createHash } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import { fileTypeFromBuffer } from 'file-type';
import { z } from 'zod';
import { TenantDb } from '../database/index.js';
import type { EventEnvelope, EventHandler } from '../events/event.types.js';
import { FILE_PURPOSES, isFilePurpose } from './file-purposes.js';
import { ObjectStorage } from './object-storage.js';

export type ScanVerdict =
  { readonly clean: true } | { readonly clean: false; readonly reason: string };

export interface ScanSubject {
  readonly bytes: Buffer;
  readonly purpose: string;
  readonly declaredMime: string;
  readonly sha256: string;
}

/**
 * Plug point for malware scanning (Phase 3 plan §3.3). ClamAV (Phase 15/16)
 * implements this same interface; nothing else changes.
 */
export abstract class FileScanner {
  abstract scan(subject: ScanSubject): Promise<ScanVerdict>;
}

/**
 * Phase 3 scanner: integrity and type re-check only. The stored bytes must hash
 * to the recorded SHA-256, still sniff as an allowed type, and fit the limit.
 */
@Injectable()
export class BasicFileScanner extends FileScanner {
  async scan(subject: ScanSubject): Promise<ScanVerdict> {
    if (createHash('sha256').update(subject.bytes).digest('hex') !== subject.sha256) {
      return { clean: false, reason: 'integrity_mismatch' };
    }
    if (!isFilePurpose(subject.purpose)) {
      return { clean: false, reason: 'unknown_purpose' };
    }
    const purpose: { maxBytes: number; allowedTypes: readonly string[] } =
      FILE_PURPOSES[subject.purpose];
    const detected = await fileTypeFromBuffer(subject.bytes);
    if (detected?.mime !== subject.declaredMime || !purpose.allowedTypes.includes(detected.mime)) {
      return { clean: false, reason: 'type_mismatch' };
    }
    if (subject.bytes.length > purpose.maxBytes) {
      return { clean: false, reason: 'too_large' };
    }
    return { clean: true };
  }
}

const payloadSchema = z.object({ fileId: z.uuid() });

/** Worker: scans each uploaded file once and releases (CLEAN) or rejects it. Idempotent. */
@Injectable()
export class FileScanHandler implements EventHandler {
  readonly type = 'files.uploaded';
  private readonly logger = new Logger(FileScanHandler.name);

  constructor(
    private readonly db: TenantDb,
    private readonly storage: ObjectStorage,
    private readonly scanner: FileScanner,
  ) {}

  async handle(envelope: EventEnvelope): Promise<void> {
    const { fileId } = payloadSchema.parse(envelope.payload);
    const ctx = { kind: 'system', job: 'files.scan' } as const;
    const file = await this.db.run(ctx, async (tx) =>
      tx.fileMetadata.findUnique({
        where: { id: fileId },
        select: { storageKey: true, purpose: true, mimeType: true, sha256: true, status: true },
      }),
    );
    if (file?.status !== 'QUARANTINED') {
      return; // Already scanned (redelivery) or gone.
    }
    const verdict = await this.scanner.scan({
      bytes: await this.storage.get(file.storageKey),
      purpose: file.purpose,
      declaredMime: file.mimeType,
      sha256: file.sha256,
    });
    await this.db.run(ctx, async (tx) =>
      tx.fileMetadata.updateMany({
        where: { id: fileId, status: 'QUARANTINED' },
        data: verdict.clean
          ? { status: 'CLEAN', scannedAt: new Date() }
          : { status: 'REJECTED', statusReason: verdict.reason, scannedAt: new Date() },
      }),
    );
    this.logger.log(
      `File ${fileId} ${verdict.clean ? 'released' : `rejected (${verdict.reason})`}`,
    );
  }
}
