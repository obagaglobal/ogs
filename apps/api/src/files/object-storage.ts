import {
  CreateBucketCommand,
  GetObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { TypedConfigService } from '../config/env.js';

/** Presigned download links live for one minute (Phase 3 plan §3.3). */
export const DOWNLOAD_URL_TTL_SECONDS = 60;

/**
 * Private S3-compatible bucket (ADR-019). Objects are never public and never
 * listed; reads happen only through short-lived presigned URLs issued after an
 * RLS-checked metadata lookup (FileService).
 */
@Injectable()
export class ObjectStorage implements OnModuleInit {
  private readonly logger = new Logger(ObjectStorage.name);
  private readonly client: S3Client;
  private readonly bucket: string;
  private readonly createBucket: boolean;

  constructor(@Inject(ConfigService) config: TypedConfigService) {
    this.bucket = config.get('S3_BUCKET', { infer: true });
    // Production buckets are provisioned (and locked down) by infrastructure code.
    this.createBucket = config.get('NODE_ENV', { infer: true }) !== 'production';
    this.client = new S3Client({
      endpoint: config.get('S3_ENDPOINT', { infer: true }),
      region: config.get('S3_REGION', { infer: true }),
      forcePathStyle: config.get('S3_FORCE_PATH_STYLE', { infer: true }),
      credentials: {
        accessKeyId: config.get('S3_ACCESS_KEY_ID', { infer: true }),
        secretAccessKey: config.get('S3_SECRET_ACCESS_KEY', { infer: true }),
      },
    });
  }

  async onModuleInit(): Promise<void> {
    if (!this.createBucket) {
      return;
    }
    try {
      await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }));
    } catch {
      try {
        await this.client.send(new CreateBucketCommand({ Bucket: this.bucket }));
        this.logger.log(`Created development bucket "${this.bucket}"`);
      } catch (error) {
        // Not fatal at start-up: uploads will fail (and say so) until storage is reachable.
        this.logger.warn(
          `Object storage unavailable (${error instanceof Error ? error.name : 'unknown'})`,
        );
      }
    }
  }

  async put(key: string, body: Buffer, contentType: string): Promise<void> {
    await this.client.send(
      new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: body, ContentType: contentType }),
    );
  }

  async get(key: string): Promise<Buffer> {
    const response = await this.client.send(
      new GetObjectCommand({ Bucket: this.bucket, Key: key }),
    );
    if (response.Body === undefined) {
      throw new Error('empty object');
    }
    return Buffer.from(await response.Body.transformToByteArray());
  }

  /** A one-minute GET link that downloads (never renders inline) under the original name. */
  async downloadUrl(key: string, filename: string, contentType: string): Promise<string> {
    const safeName = filename.replace(/[^\w.\- ]+/g, '_').slice(0, 150) || 'download';
    return getSignedUrl(
      this.client,
      new GetObjectCommand({
        Bucket: this.bucket,
        Key: key,
        ResponseContentDisposition: `attachment; filename="${safeName}"`,
        ResponseContentType: contentType,
      }),
      { expiresIn: DOWNLOAD_URL_TTL_SECONDS },
    );
  }
}
