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
    }
  | { readonly kind: 'permission'; readonly code: string; readonly allowRestricted: boolean };

/**
 * Every route must carry exactly one of these (default deny, Phase 3 plan §2.4).
 * The API refuses to start if a route has none (AccessRouteCheck).
 */
export const Public = () => SetMetadata(ACCESS_METADATA, { kind: 'public' } satisfies AccessRule);

export const Authenticated = (
  options: { workspace?: boolean; allowUnverified?: boolean; allowRestricted?: boolean } = {},
) =>
  SetMetadata(ACCESS_METADATA, {
    kind: 'authenticated',
    workspace: options.workspace ?? false,
    allowUnverified: options.allowUnverified ?? false,
    allowRestricted: options.allowRestricted ?? false,
  } satisfies AccessRule);

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
