import { Catch, type ArgumentsHost, type ExceptionFilter } from '@nestjs/common';
import type { ApiError } from '@ogs/contracts';
import type { Response } from 'express';
import { DomainError } from './domain-error.js';

/** Maps DomainError to `{ "error": code }` with its status. Registered globally. */
@Catch(DomainError)
export class DomainErrorFilter implements ExceptionFilter<DomainError> {
  catch(error: DomainError, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    response.setHeader('Cache-Control', 'no-store');
    response.status(error.status).json({ error: error.code } satisfies ApiError);
  }
}
