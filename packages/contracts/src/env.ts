import { z } from 'zod';

/**
 * Environment contract for `apps/api` (API and worker processes).
 *
 * DATABASE_URL must use the runtime role `ogs_app` (RLS enforced, no bypass).
 * Migration (DATABASE_MIGRATION_URL) and maintenance (DATABASE_MAINT_URL)
 * credentials are deliberately NOT part of this schema: the running API never
 * reads them.
 */
export const apiEnvSchema = z.object({
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
