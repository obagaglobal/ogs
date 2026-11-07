/**
 * HTTP conventions shared by the API and the web app. Deliberately free of
 * Zod: the public catalogue imports these on first load, and keeping schemas
 * out of that path matters on phones (Phase 6b, Lighthouse).
 */

/** Header carrying the requested workspace: `personal` or a tenant id. */
export const WORKSPACE_HEADER = 'X-OGS-Workspace';
/** Header carrying the session's CSRF token on unsafe requests. */
export const CSRF_HEADER = 'X-CSRF-Token';
/** Header naming the session's active platform elevation (cross-tenant staff access). */
export const ELEVATION_HEADER = 'X-OGS-Elevation';

/** The shape of every API error body (`apiErrorSchema` in auth.ts is the schema). */
export interface ApiErrorBody {
  error: string;
  fields?: string[];
  retryAfterSeconds?: number;
}

/**
 * Zod-free check for an API error body; accepts exactly what `apiErrorSchema`
 * accepts (http.test.ts proves they agree).
 */
export function isApiErrorBody(value: unknown): value is ApiErrorBody {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const body = value as Record<string, unknown>;
  if (typeof body['error'] !== 'string') return false;
  const fields = body['fields'];
  if (
    fields !== undefined &&
    !(Array.isArray(fields) && fields.every((field) => typeof field === 'string'))
  ) {
    return false;
  }
  const retry = body['retryAfterSeconds'];
  return retry === undefined || (typeof retry === 'number' && Number.isInteger(retry));
}
