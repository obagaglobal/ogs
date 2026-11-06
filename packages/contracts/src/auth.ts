import { z } from 'zod';

/**
 * Identity request/response contracts (Phase 3A). The API validates every body
 * with these schemas; the web app uses the same schemas for its forms.
 */

/** Trimmed, lower-cased, at most 254 characters (RFC 5321 path limit). */
export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .max(254)
  .pipe(z.email({ error: 'Enter a valid email address' }));

export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_LENGTH = 128;

/**
 * A NEW password (OWASP ASVS 2.1): 12–128 Unicode code points, any characters,
 * no composition rules. The breached-password check runs on the server.
 */
export const newPasswordSchema = z
  .string()
  .refine((value) => Array.from(value).length >= PASSWORD_MIN_LENGTH, {
    error: `Use at least ${String(PASSWORD_MIN_LENGTH)} characters`,
  })
  .refine((value) => Array.from(value).length <= PASSWORD_MAX_LENGTH, {
    error: `Use at most ${String(PASSWORD_MAX_LENGTH)} characters`,
  });

/** An EXISTING password at sign-in: never re-validated beyond a sane size limit. */
export const currentPasswordSchema = z.string().min(1).max(1024);

/** 256-bit random token, base64url without padding. */
export const emailTokenSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/, { error: 'Invalid token' });

export const registerRequestSchema = z.object({ email: emailSchema, password: newPasswordSchema });
export const loginRequestSchema = z.object({ email: emailSchema, password: currentPasswordSchema });
export const verifyEmailRequestSchema = z.object({ token: emailTokenSchema });
export const forgotPasswordRequestSchema = z.object({ email: emailSchema });
export const resetPasswordRequestSchema = z.object({
  token: emailTokenSchema,
  password: newPasswordSchema,
});
export const changePasswordRequestSchema = z.object({
  currentPassword: currentPasswordSchema,
  newPassword: newPasswordSchema,
});

export type RegisterRequest = z.infer<typeof registerRequestSchema>;
export type LoginRequest = z.infer<typeof loginRequestSchema>;
export type VerifyEmailRequest = z.infer<typeof verifyEmailRequestSchema>;
export type ForgotPasswordRequest = z.infer<typeof forgotPasswordRequestSchema>;
export type ResetPasswordRequest = z.infer<typeof resetPasswordRequestSchema>;
export type ChangePasswordRequest = z.infer<typeof changePasswordRequestSchema>;

export const userStatusSchema = z.enum([
  'PENDING_VERIFICATION',
  'ACTIVE',
  'SUSPENDED',
  'DEACTIVATED',
]);

export const sessionSummarySchema = z.object({
  /** Public session id (not the cookie secret). */
  id: z.uuid(),
  createdAt: z.iso.datetime(),
  lastSeenAt: z.iso.datetime(),
  expiresAt: z.iso.datetime(),
  ip: z.string().nullable(),
  userAgent: z.string().nullable(),
  current: z.boolean(),
});

export const currentSessionResponseSchema = z.object({
  user: z.object({ id: z.uuid(), email: z.email(), status: userStatusSchema }),
  session: sessionSummarySchema,
});

export const sessionListResponseSchema = z.object({ sessions: z.array(sessionSummarySchema) });
export const csrfResponseSchema = z.object({ csrfToken: z.string().min(32) });

export type SessionSummary = z.infer<typeof sessionSummarySchema>;
export type CurrentSessionResponse = z.infer<typeof currentSessionResponseSchema>;
export type SessionListResponse = z.infer<typeof sessionListResponseSchema>;
export type CsrfResponse = z.infer<typeof csrfResponseSchema>;

export const tenantKindSchema = z.enum(['ORGANISATION', 'PROVIDER_COMPANY', 'PLATFORM']);
export const tenantStatusSchema = z.enum([
  'PENDING_APPROVAL',
  'ACTIVE',
  'REJECTED',
  'SUSPENDED',
  'CLOSED',
]);

export const workspaceSummarySchema = z.object({
  tenantId: z.uuid(),
  kind: tenantKindSchema,
  name: z.string(),
  status: tenantStatusSchema,
  restricted: z.boolean(),
});
export const workspaceListResponseSchema = z.object({
  workspaces: z.array(workspaceSummarySchema),
});

/** `GET /api/v1/workspace`: the workspace the request is acting in. */
export const currentWorkspaceResponseSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('personal') }),
  z.object({
    kind: tenantKindSchema,
    tenantId: z.uuid(),
    name: z.string(),
    status: tenantStatusSchema,
    restricted: z.boolean(),
    membershipId: z.uuid(),
    roles: z.array(z.string()),
    permissions: z.array(z.string()),
  }),
]);

export const memberSchema = z.object({
  membershipId: z.uuid(),
  userId: z.uuid(),
  email: z.email(),
  status: z.enum(['INVITED', 'ACTIVE', 'SUSPENDED', 'ENDED']),
  roles: z.array(z.string()),
  joinedAt: z.iso.datetime().nullable(),
});
export const memberListResponseSchema = z.object({ members: z.array(memberSchema) });

export type WorkspaceSummary = z.infer<typeof workspaceSummarySchema>;
export type WorkspaceListResponse = z.infer<typeof workspaceListResponseSchema>;
export type CurrentWorkspaceResponse = z.infer<typeof currentWorkspaceResponseSchema>;
export type Member = z.infer<typeof memberSchema>;
export type MemberListResponse = z.infer<typeof memberListResponseSchema>;

/** Every API error body: a stable machine-readable code. */
export const apiErrorSchema = z.object({
  error: z.string(),
  /** Field paths only (never values) for `invalid_request`. */
  fields: z.array(z.string()).optional(),
  retryAfterSeconds: z.number().int().optional(),
});
export type ApiError = z.infer<typeof apiErrorSchema>;

/** Header carrying the requested workspace: `personal` or a tenant id. */
export const WORKSPACE_HEADER = 'X-OGS-Workspace';
/** Header carrying the session's CSRF token on unsafe requests. */
export const CSRF_HEADER = 'X-CSRF-Token';
