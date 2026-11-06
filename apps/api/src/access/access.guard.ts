import {
  HttpStatus,
  Inject,
  Injectable,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { CSRF_HEADER, WORKSPACE_HEADER } from '@ogs/contracts';
import type { Response } from 'express';
import { safeEqual } from '../common/secrets.js';
import type { TypedConfigService } from '../config/env.js';
import { PermissionService } from '../authz/permission.service.js';
import { TenantDb, UserStatus } from '../database/index.js';
import { SessionStore, SessionStoreUnavailable } from '../sessions/session.store.js';
import { clearSessionCookie, readCookie, sessionCookieName } from '../sessions/session-cookie.js';
import { WorkspaceContextService } from '../tenancy/workspace-context.service.js';
import { ACCESS_METADATA, type AccessRule } from './access.decorators.js';
import type { AccessState, OgsRequest } from './access.types.js';
import { ApiException, forbidden, unauthenticated } from './api-error.js';
import { requestMeta } from './request-meta.js';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * The single global gate for every request (Phase 3 plan §2.2–§2.5). In order:
 *
 *  1. Route must declare an access rule (default deny).
 *  2. Unsafe requests with a body must be `Content-Type: application/json`:
 *     cross-site HTML forms cannot send that without a CORS preflight, which the
 *     allow-list blocks.
 *  3. Session from the cookie (else 401) and, for unsafe methods, the CSRF token.
 *  4. User still exists and is active; unverified users only reach routes that allow it.
 *  5. Workspace from X-OGS-Workspace, resolved and granted by the server.
 *  6. Permission from the membership's roles, loaded fresh for this request.
 */
@Injectable()
export class AccessGuard implements CanActivate {
  private readonly secureCookie: boolean;

  constructor(
    private readonly reflector: Reflector,
    private readonly sessions: SessionStore,
    private readonly db: TenantDb,
    private readonly workspaces: WorkspaceContextService,
    private readonly permissions: PermissionService,
    @Inject(ConfigService) config: TypedConfigService,
  ) {
    this.secureCookie = config.get('SESSION_COOKIE_SECURE', { infer: true });
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const rule = this.reflector.getAllAndOverride<AccessRule | undefined>(ACCESS_METADATA, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (rule === undefined) {
      throw forbidden('access_rule_missing');
    }
    const request = context.switchToHttp().getRequest<OgsRequest>();
    const response = context.switchToHttp().getResponse<Response>();
    const meta = requestMeta(request);
    response.setHeader('X-Request-Id', meta.requestId);
    const unsafe = !SAFE_METHODS.has(request.method);

    // req.is() is null for a request without a body (e.g. DELETE): nothing a
    // cross-site form could have sent. A body of any other type is refused.
    if (unsafe && request.is('application/json') === false) {
      throw new ApiException(HttpStatus.UNSUPPORTED_MEDIA_TYPE, 'json_required');
    }
    if (rule.kind === 'public') {
      return true;
    }

    // 3. Session and CSRF ------------------------------------------------------
    const token = readCookie(request, sessionCookieName(this.secureCookie));
    const session = token === undefined ? undefined : await this.loadSession(token);
    if (token === undefined || session === undefined) {
      if (token !== undefined) {
        clearSessionCookie(response, this.secureCookie);
      }
      throw unauthenticated();
    }
    if (unsafe) {
      const presented = request.get(CSRF_HEADER);
      if (typeof presented !== 'string' || !safeEqual(presented, session.csrfToken)) {
        throw forbidden('csrf_invalid');
      }
    }

    // 4. User -----------------------------------------------------------------
    const user = await this.db.run({ kind: 'user', userId: session.userId }, async (tx) =>
      tx.appUser.findUnique({
        where: { id: session.userId },
        select: { id: true, email: true, status: true, deletedAt: true },
      }),
    );
    const disabled =
      user?.deletedAt !== null ||
      user.status === UserStatus.SUSPENDED ||
      user.status === UserStatus.DEACTIVATED;
    if (user === null || disabled) {
      // Deleted or disabled since sign-in: end every session of that account now.
      await this.sessions.revokeAll(session.userId);
      clearSessionCookie(response, this.secureCookie);
      throw unauthenticated();
    }
    const allowUnverified = rule.kind === 'authenticated' && rule.allowUnverified;
    if (user.status === UserStatus.PENDING_VERIFICATION && !allowUnverified) {
      throw forbidden('email_unverified');
    }

    const state: { -readonly [K in keyof AccessState]: AccessState[K] } = {
      sessionToken: token,
      session,
      user: { id: user.id, email: user.email, status: user.status },
      meta,
    };

    // 5–6. Workspace and permission -------------------------------------------
    const needsWorkspace = rule.kind === 'permission' || rule.workspace;
    if (needsWorkspace) {
      const header = request.get(WORKSPACE_HEADER);
      if (Array.isArray(header)) {
        throw forbidden('workspace_forbidden');
      }
      const resolution = await this.workspaces.resolve(user.id, header ?? 'personal');
      if (!resolution.ok) {
        throw forbidden('workspace_forbidden');
      }
      const { workspace, context: dbContext } = resolution;
      if (workspace.kind !== 'personal' && workspace.restricted && !rule.allowRestricted) {
        throw forbidden('workspace_restricted');
      }
      const granted =
        workspace.kind === 'personal'
          ? new Set<string>()
          : await this.db.run(dbContext, async (tx) =>
              this.permissions.forMembership(tx, workspace.membershipId),
            );
      if (rule.kind === 'permission' && !granted.has(rule.code)) {
        throw forbidden('permission_denied');
      }
      state.workspace = { resolved: workspace, context: dbContext, permissions: granted };
    }

    request.ogs = state;
    return true;
  }

  private async loadSession(token: string) {
    try {
      return await this.sessions.get(token);
    } catch (error) {
      if (error instanceof SessionStoreUnavailable) {
        throw new ApiException(HttpStatus.SERVICE_UNAVAILABLE, 'session_store_unavailable');
      }
      throw error;
    }
  }
}
