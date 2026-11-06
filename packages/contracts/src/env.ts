import { z } from 'zod';

/**
 * Environment contract for `apps/api` (API and worker processes).
 *
 * DATABASE_URL must use the runtime role `ogs_app` (RLS enforced, no bypass).
 * Migration (DATABASE_MIGRATION_URL) and maintenance (DATABASE_MAINT_URL)
 * credentials are deliberately NOT part of this schema: the running API never
 * reads them.
 */
const booleanFlag = z.enum(['true', 'false']).transform((value) => value === 'true');

/** The MFA key committed in apps/api/.env.example. Refused in production. */
export const DEVELOPMENT_MFA_KEY = 'hAwZXbLijmH0YL6YG3aH7cqE0CxKxdsAmx/Suo6hn7Y=';

export const apiEnvSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    API_HOST: z.string().min(1).default('127.0.0.1'),
    API_PORT: z.coerce.number().int().min(1).max(65535).default(3000),
    API_CORS_ORIGINS: z
      .string()
      .default('http://localhost:5173')
      .transform((value) =>
        value
          .split(',')
          .map((origin) => origin.trim())
          .filter((origin) => origin.length > 0),
      )
      .pipe(z.array(z.url())),
    DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
    /** Maximum connections in this process's PostgreSQL pool. */
    DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(100).default(10),
    REDIS_URL: z.url({ protocol: /^rediss?$/ }),
    /** Prefix for every BullMQ key, so environments sharing a Redis never collide. */
    QUEUE_PREFIX: z
      .string()
      .regex(/^[a-z0-9][a-z0-9_-]*$/)
      .default('ogs'),
    OUTBOX_POLL_INTERVAL_MS: z.coerce.number().int().min(50).max(60_000).default(1000),
    OUTBOX_BATCH_SIZE: z.coerce.number().int().min(1).max(1000).default(100),
    /** Public base URL of the web app, used in email links. */
    APP_PUBLIC_URL: z.url({ protocol: /^https?$/ }).default('http://localhost:5173'),
    /**
     * Mark the session cookie Secure and use the __Host- prefix. Defaults to true in
     * production and false elsewhere (browsers ignore Secure cookies on http://localhost).
     */
    SESSION_COOKIE_SECURE: booleanFlag.optional(),
    /** Number of reverse proxies in front of the API whose X-Forwarded-For is trusted. */
    TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(5).default(0),
    /** Worker only: SMTP server for outbound email (Mailpit in development). */
    SMTP_URL: z.url({ protocol: /^smtps?$/ }).default('smtp://127.0.0.1:1025'),
    EMAIL_FROM: z.string().min(3).max(200).default('OGS <no-reply@ogs.test>'),
    /**
     * Keys that seal TOTP secrets (AES-256-GCM): `id:base64key[,id:base64key...]`.
     * The FIRST key encrypts new secrets; the others only decrypt (rotation).
     */
    MFA_ENCRYPTION_KEYS: z
      .string()
      .regex(/^[a-z0-9]{1,16}:[A-Za-z0-9+/]{43}=(,[a-z0-9]{1,16}:[A-Za-z0-9+/]{43}=)*$/, {
        error: 'expected id:base64-32-byte-key[,...]',
      }),
    /** S3-compatible object storage for files (SeaweedFS in development, ADR-019). */
    S3_ENDPOINT: z.url({ protocol: /^https?$/ }).default('http://127.0.0.1:8333'),
    S3_REGION: z.string().min(1).default('us-east-1'),
    S3_BUCKET: z
      .string()
      .regex(/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/)
      .default('ogs-files'),
    S3_ACCESS_KEY_ID: z.string().min(3),
    S3_SECRET_ACCESS_KEY: z.string().min(8),
    /** MinIO and most self-hosted S3 need path-style URLs. */
    S3_FORCE_PATH_STYLE: booleanFlag.default(true),
  })
  .transform((env) => ({
    ...env,
    SESSION_COOKIE_SECURE: env.SESSION_COOKIE_SECURE ?? env.NODE_ENV === 'production',
  }))
  .superRefine((env, ctx) => {
    if (env.NODE_ENV === 'production' && !env.SESSION_COOKIE_SECURE) {
      ctx.addIssue({
        code: 'custom',
        path: ['SESSION_COOKIE_SECURE'],
        message: 'must be true in production',
      });
    }
    if (env.NODE_ENV === 'production' && env.MFA_ENCRYPTION_KEYS.includes(DEVELOPMENT_MFA_KEY)) {
      ctx.addIssue({
        code: 'custom',
        path: ['MFA_ENCRYPTION_KEYS'],
        message: 'the development key from .env.example must never be used in production',
      });
    }
    if (env.NODE_ENV === 'production' && env.APP_PUBLIC_URL.startsWith('http://')) {
      ctx.addIssue({
        code: 'custom',
        path: ['APP_PUBLIC_URL'],
        message: 'must be https in production',
      });
    }
  });

export type ApiEnv = z.infer<typeof apiEnvSchema>;

/**
 * Validates a raw environment object. Throws an error listing every invalid
 * variable by name. Values are never included, so secrets cannot leak into logs.
 */
export function parseApiEnv(raw: Record<string, unknown>): ApiEnv {
  const result = apiEnvSchema.safeParse(raw);
  if (!result.success) {
    const details = result.error.issues
      .map((issue) => `  - ${issue.path.join('.') || '(root)'}: invalid value`)
      .join('\n');
    throw new Error(`Invalid API environment configuration:\n${details}`);
  }
  return result.data;
}
