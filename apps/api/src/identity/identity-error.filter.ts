import { Catch, HttpStatus, type ArgumentsHost, type ExceptionFilter } from '@nestjs/common';
import type { ApiError } from '@ogs/contracts';
import type { Response } from 'express';
import { SessionStoreUnavailable } from '../sessions/session.store.js';
import {
  InvalidCredentialsError,
  InvalidTokenError,
  WeakPasswordError,
} from './identity.service.js';
import { RateLimitExceeded, RateLimiterUnavailable } from './rate-limiter.js';

type IdentityError =
  | WeakPasswordError
  | InvalidTokenError
  | InvalidCredentialsError
  | RateLimitExceeded
  | RateLimiterUnavailable
  | SessionStoreUnavailable;

/**
 * Maps identity domain errors to HTTP. Registered globally so the same mapping
 * applies in controllers and in the access guard. Bodies carry codes only.
 */
@Catch(
  WeakPasswordError,
  InvalidTokenError,
  InvalidCredentialsError,
  RateLimitExceeded,
  RateLimiterUnavailable,
  SessionStoreUnavailable,
)
export class IdentityErrorFilter implements ExceptionFilter<IdentityError> {
  catch(error: IdentityError, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    const [status, body] = this.map(error);
    if (error instanceof RateLimitExceeded) {
      response.setHeader('Retry-After', String(error.retryAfterSeconds));
    }
    response.setHeader('Cache-Control', 'no-store');
    response.status(status).json(body);
  }

  private map(error: IdentityError): [HttpStatus, ApiError] {
    if (error instanceof WeakPasswordError) {
      return [HttpStatus.BAD_REQUEST, { error: `weak_password_${error.reason}` }];
    }
    if (error instanceof InvalidTokenError) {
      return [HttpStatus.BAD_REQUEST, { error: 'invalid_or_expired_token' }];
    }
    if (error instanceof InvalidCredentialsError) {
      return [HttpStatus.UNAUTHORIZED, { error: 'invalid_credentials' }];
    }
    if (error instanceof RateLimitExceeded) {
      return [
        HttpStatus.TOO_MANY_REQUESTS,
        { error: 'rate_limited', retryAfterSeconds: error.retryAfterSeconds },
      ];
    }
    return [HttpStatus.SERVICE_UNAVAILABLE, { error: 'temporarily_unavailable' }];
  }
}
