import { describe, expect, it } from 'vitest';
import { apiErrorSchema } from './auth.js';
import { isApiErrorBody } from './http.js';

describe('isApiErrorBody', () => {
  const samples: unknown[] = [
    { error: 'invalid_credentials' },
    { error: 'invalid_request', fields: ['email', 'password'] },
    { error: 'rate_limited', retryAfterSeconds: 30 },
    { error: 'rate_limited', retryAfterSeconds: 1.5 },
    { error: 'invalid_request', fields: ['email', 3] },
    { error: 42 },
    { message: 'nope' },
    ['error'],
    'error',
    null,
    undefined,
    { error: 'x', fields: 'email' },
  ];

  it('agrees with apiErrorSchema on every sample', () => {
    for (const sample of samples) {
      expect(isApiErrorBody(sample), JSON.stringify(sample)).toBe(
        apiErrorSchema.safeParse(sample).success,
      );
    }
  });
});
