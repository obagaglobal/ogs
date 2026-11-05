import { z } from 'zod';

/**
 * Environment contract for `apps/api`.
 *
 * DATABASE_URL and REDIS_URL are optional in Phase 1 because no code connects
 * to PostgreSQL or Redis yet. Make them required in the phase that introduces
 * the first data access.
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
  DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }).optional(),
  REDIS_URL: z.url({ protocol: /^rediss?$/ }).optional(),
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
