import { HttpStatus } from '@nestjs/common';
import type { z } from 'zod';
import { ApiException } from './api-error.js';

/**
 * Validates a request body against a shared contract schema. On failure the
 * response lists the invalid field paths only, never the submitted values.
 */
export function parseBody<S extends z.ZodType>(schema: S, body: unknown): z.output<S> {
  const result = schema.safeParse(body);
  if (!result.success) {
    const fields = [
      ...new Set(result.error.issues.map((issue) => issue.path.join('.') || '(body)')),
    ];
    throw new ApiException(HttpStatus.BAD_REQUEST, 'invalid_request', { fields });
  }
  return result.data;
}
