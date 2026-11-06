// Zod-free imports only: this module is on the public catalogue's first load.
import { CSRF_HEADER, isApiErrorBody, WORKSPACE_HEADER } from '@ogs/contracts';

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
  readonly method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  readonly body?: unknown;
  /** `personal` or a tenant id (X-OGS-Workspace). */
  readonly workspace?: string;
  /** Extra headers, e.g. X-OGS-Elevation for platform staff. */
  readonly headers?: Record<string, string>;
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
  Object.assign(headers, options.headers);

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
  const body = isApiErrorBody(payload) ? payload : undefined;
  const code = body?.error ?? 'unexpected_error';
  if (code === 'csrf_invalid' && !retried) {
    // The session was rotated elsewhere (e.g. another tab signed in again).
    resetCsrfToken();
    return api<T>(path, options, true);
  }
  throw new ApiError(response.status, code, body?.fields ?? [], body?.retryAfterSeconds);
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
    last_admin: 'An organisation must always keep at least one administrator.',
    cannot_change_own_membership: 'You cannot change your own membership here.',
    application_incomplete: 'Complete the missing details before submitting.',
    application_locked: 'The application cannot be edited while it is under review.',
    invitation_invalid: 'This invitation is no longer valid. Ask for a new one.',
    invitation_email_mismatch:
      'This invitation was sent to a different email address. Sign in with that address.',
    tenant_not_active: 'This organisation is not active right now.',
    already_member: 'This person is already a member.',
    role_in_use: 'Remove this role from every member before deleting it.',
    role_code_taken: 'That role code is already used.',
    department_exists: 'A department with that name already exists.',
    elevation_required: 'Start an elevated session to continue.',
    cannot_decide_own_application: 'You cannot decide an application you submitted yourself.',
    file_too_large: 'That file is too large (10 MB maximum).',
    file_type_not_allowed: 'Upload a PDF, JPEG or PNG file.',
    invalid_request: 'Some fields are not valid. Check the form and try again.',
    slug_taken: 'That web address (slug) is already used.',
    slug_immutable: 'The web address cannot change once the service has been published.',
    stale_version: 'Someone else changed this first. Reload and try again.',
    service_incomplete: 'Complete the missing details before publishing.',
    invalid_transition: 'That change is not possible in the current status.',
    category_unknown: 'That category does not exist.',
    category_too_deep: 'Categories can only be two levels deep.',
    category_has_children: 'A category with sub-categories cannot be moved under another.',
    parent_archived: 'The parent category is archived.',
    skill_unknown: 'One of those skills is not offered.',
    invalid_cursor: 'The results changed. Search again.',
    not_found: 'Not found.',
  };
  return messages[error.code] ?? 'Something went wrong. Please try again.';
}

/** Multipart upload to POST /files (the only multipart route). */
export async function uploadFile<T>(form: FormData, workspace: string): Promise<T> {
  const token = await loadCsrfToken();
  const headers: Record<string, string> = {
    Accept: 'application/json',
    [WORKSPACE_HEADER]: workspace,
  };
  if (token !== undefined) {
    headers[CSRF_HEADER] = token;
  }
  const response = await fetch('/api/v1/files', {
    method: 'POST',
    credentials: 'same-origin',
    headers,
    body: form,
  });
  const payload: unknown = await response.json().catch(() => ({}));
  if (response.ok) {
    return payload as T;
  }
  const body = isApiErrorBody(payload) ? payload : undefined;
  throw new ApiError(
    response.status,
    body ? body.error : response.status === 413 ? 'file_too_large' : 'unexpected_error',
  );
}
