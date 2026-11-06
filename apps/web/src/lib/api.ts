import { apiErrorSchema, CSRF_HEADER, WORKSPACE_HEADER } from '@ogs/contracts';

/** An API error with the server's stable code (`invalid_credentials`, `mfa_required`, ...). */
export class ApiError extends Error {
  override readonly name = 'ApiError';
  constructor(
    readonly status: number,
    readonly code: string,
    readonly fields: readonly string[] = [],
    readonly retryAfterSeconds?: number,
  ) {
    super(code);
  }
}

export interface RequestOptions {
  readonly method?: 'GET' | 'POST' | 'DELETE';
  readonly body?: unknown;
  /** `personal` or a tenant id (X-OGS-Workspace). */
  readonly workspace?: string;
}

let csrfToken: string | undefined;

/** Call after anything that rotates the session cookie (sign-in, MFA, password change). */
export function resetCsrfToken(): void {
  csrfToken = undefined;
}

async function loadCsrfToken(): Promise<string | undefined> {
  if (csrfToken === undefined) {
    const response = await fetch('/api/v1/auth/csrf', {
      credentials: 'same-origin',
      headers: { Accept: 'application/json' },
    });
    if (response.ok) {
      csrfToken = ((await response.json()) as { csrfToken: string }).csrfToken;
    }
  }
  return csrfToken;
}

/**
 * Same-origin JSON client for the OGS API (the Vite dev server and NGINX proxy
 * /api). Follows the API's rules: JSON bodies, X-CSRF-Token on unsafe requests
 * once signed in, X-OGS-Workspace to pick a workspace.
 */
export async function api<T>(
  path: string,
  options: RequestOptions = {},
  retried = false,
): Promise<T> {
  const method = options.method ?? 'GET';
  const unsafe = method !== 'GET';
  const token = unsafe ? await loadCsrfToken() : undefined;
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (unsafe) {
    headers['Content-Type'] = 'application/json';
  }
  if (token !== undefined) {
    headers[CSRF_HEADER] = token;
  }
  if (options.workspace !== undefined) {
    headers[WORKSPACE_HEADER] = options.workspace;
  }

  const response = await fetch(`/api/v1${path}`, {
    method,
    credentials: 'same-origin',
    headers,
    ...(unsafe ? { body: JSON.stringify(options.body ?? {}) } : {}),
  });

  if (response.status === 204) {
    return undefined as T;
  }
  const payload: unknown = await response.json().catch(() => ({}));
  if (response.ok) {
    return payload as T;
  }
  const parsed = apiErrorSchema.safeParse(payload);
  const code = parsed.success ? parsed.data.error : 'unexpected_error';
  if (code === 'csrf_invalid' && !retried) {
    // The session was rotated elsewhere (e.g. another tab signed in again).
    resetCsrfToken();
    return api<T>(path, options, true);
  }
  throw new ApiError(
    response.status,
    code,
    parsed.success ? (parsed.data.fields ?? []) : [],
    parsed.success ? parsed.data.retryAfterSeconds : undefined,
  );
}

/** Human-readable text for the error codes people can actually hit. */
export function describeError(error: unknown): string {
  if (!(error instanceof ApiError)) {
    return 'Something went wrong. Check your connection and try again.';
  }
  const messages: Record<string, string> = {
    invalid_credentials: 'That email and password do not match.',
    invalid_mfa_code: 'That code is not valid. Codes change every 30 seconds.',
    invalid_or_expired_token: 'This link is invalid or has expired. Request a new one.',
    weak_password_breached: 'This password appears in known data breaches. Choose another.',
    weak_password_contains_email: 'Do not use your email name in your password.',
    weak_password_contains_service_name: 'Do not use the service name in your password.',
    rate_limited: `Too many attempts. Try again in ${String(Math.ceil((error.retryAfterSeconds ?? 60) / 60))} minute(s).`,
    temporarily_unavailable: 'The service is temporarily unavailable. Try again shortly.',
    workspace_forbidden: 'You no longer have access to that workspace.',
    workspace_restricted: 'This workspace is awaiting approval.',
    permission_denied: 'Your role does not allow this.',
    step_up_required: 'Confirm with your authenticator code first.',
  };
  return messages[error.code] ?? 'Something went wrong. Please try again.';
}
