import { HttpException, HttpStatus } from '@nestjs/common';
import type { ApiError } from '@ogs/contracts';

/** An HTTP error with a stable machine-readable code (`{ "error": "..." }`). */
export class ApiException extends HttpException {
  constructor(status: HttpStatus, error: string, extra: Omit<ApiError, 'error'> = {}) {
    super({ error, ...extra } satisfies ApiError, status);
  }
}

export const unauthenticated = () => new ApiException(HttpStatus.UNAUTHORIZED, 'unauthenticated');
export const forbidden = (error: string) => new ApiException(HttpStatus.FORBIDDEN, error);
