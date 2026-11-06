/**
 * A business-rule failure with the HTTP status and the stable error code the
 * client sees (`{ "error": code }`). Thrown by services, mapped once by
 * DomainErrorFilter. Never put data or secrets in `code`.
 */
export class DomainError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(code);
  }
}

export const notFound = () => new DomainError(404, 'not_found');
export const conflict = (code: string) => new DomainError(409, code);
export const badRequest = (code: string) => new DomainError(400, code);
export const forbiddenRule = (code: string) => new DomainError(403, code);
/** The request is well-formed but cannot be processed as sent (e.g. a reused idempotency key). */
export const unprocessable = (code: string) => new DomainError(422, code);

/**
 * The deferred last-admin trigger (Phase 4, P4-4) fails at COMMIT with this
 * message; there is no structured code on that path, so match the text.
 */
export function isLastAdminViolation(error: unknown): boolean {
  return error instanceof Error && /would have no active (org|provider)_admin/.test(error.message);
}
