import { createParamDecorator, SetMetadata, type ExecutionContext } from '@nestjs/common';
import type { DbContext } from '../database/index.js';
import type { AccessState, OgsRequest } from './access.types.js';

export const ACCESS_METADATA = 'ogs:access';

export type AccessRule =
  | { readonly kind: 'public' }
  | {
      readonly kind: 'authenticated';
      /** Resolve X-OGS-Workspace for this route (otherwise no workspace is involved). */
      readonly workspace: boolean;
      /** Reachable before the email is verified (decision P3-7). */
      readonly allowUnverified: boolean;
      /** Reachable from a restricted workspace (tenant pending/rejected/suspended). */
      readonly allowRestricted: boolean;
      /** Reachable after the password but before the second factor (MFA prompt, sign-out). */
      readonly allowMfaPending: boolean;
      /** Reachable by a user who must enrol in MFA but has not yet (enrolment, sign-out). */
      readonly allowMfaEnrollment: boolean;
    }
  | { readonly kind: 'permission'; readonly code: string; readonly allowRestricted: boolean }
  /**
   * Platform staff acting across tenants (review §6.3): an active elevation on the
   * session (X-OGS-Elevation) AND the permission in the PLATFORM workspace.
   * The route receives a `platform` DbContext; every unit of work is audited.
   */
  | { readonly kind: 'elevated'; readonly code: string };

export const STEP_UP_METADATA = 'ogs:step-up';
export const MULTIPART_METADATA = 'ogs:multipart';

/**
 * The route takes a multipart/form-data upload instead of JSON. CSRF protection
 * is unchanged: authenticated unsafe requests still need X-CSRF-Token.
 */
export const AcceptsMultipart = () => SetMetadata(MULTIPART_METADATA, true);

export interface StepUpRule {
  /** A TOTP check must have happened within this many minutes. */
  readonly withinMinutes: number;
  /** When false, users without MFA pass (they cannot step up); when true they are refused. */
  readonly strict: boolean;
}

/**
 * Every route must carry exactly one of these (default deny, Phase 3 plan §2.4).
 * The API refuses to start if a route has none (AccessRouteCheck).
 */
export const Public = () => SetMetadata(ACCESS_METADATA, { kind: 'public' } satisfies AccessRule);

export const Authenticated = (
  options: {
    workspace?: boolean;
    allowUnverified?: boolean;
    allowRestricted?: boolean;
    allowMfaPending?: boolean;
    allowMfaEnrollment?: boolean;
  } = {},
) =>
  SetMetadata(ACCESS_METADATA, {
    kind: 'authenticated',
    workspace: options.workspace ?? false,
    allowUnverified: options.allowUnverified ?? false,
    allowRestricted: options.allowRestricted ?? false,
    allowMfaPending: options.allowMfaPending ?? false,
    allowMfaEnrollment: options.allowMfaEnrollment ?? false,
  } satisfies AccessRule);

/** Cross-tenant platform action; requires an active elevation (see AccessRule 'elevated'). */
export const RequireElevation = (code: string) =>
  SetMetadata(ACCESS_METADATA, { kind: 'elevated', code } satisfies AccessRule);

/**
 * Sensitive action: requires a fresh TOTP check (step-up, Phase 3 plan §3.1).
 * Combine with an access rule. 403 `step_up_required` tells the client to call
 * POST /auth/mfa/step-up and retry.
 */
export const RequireRecentMfa = (withinMinutes = 15, options: { strict?: boolean } = {}) =>
  SetMetadata(STEP_UP_METADATA, {
    withinMinutes,
    strict: options.strict ?? true,
  } satisfies StepUpRule);

/** Requires a tenant workspace whose membership roles grant `code`. */
export const RequirePermission = (code: string, options: { allowRestricted?: boolean } = {}) =>
  SetMetadata(ACCESS_METADATA, {
    kind: 'permission',
    code,
    allowRestricted: options.allowRestricted ?? false,
  } satisfies AccessRule);

function state(context: ExecutionContext): AccessState {
  const request = context.switchToHttp().getRequest<OgsRequest>();
  if (request.ogs === undefined) {
    // Only reachable if a handler using @Ctx()/@Auth() is marked @Public().
    throw new Error('Access state missing: route is not authenticated');
  }
  return request.ogs;
}

/** The authenticated caller (session + user). */
export const Auth = createParamDecorator((_data: unknown, context: ExecutionContext) =>
  state(context),
);

/** The DbContext the server granted for this request's workspace. */
export const Ctx = createParamDecorator((_data: unknown, context: ExecutionContext): DbContext => {
  const { workspace } = state(context);
  if (workspace === undefined) {
    throw new Error('Route has no workspace: add @Authenticated({ workspace: true })');
  }
  return workspace.context;
});
