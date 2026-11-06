import {
  HttpStatus,
  Inject,
  Injectable,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { CSRF_HEADER, ELEVATION_HEADER, WORKSPACE_HEADER } from '@ogs/contracts';
import type { Request, Response } from 'express';
import { safeEqual } from '../common/secrets.js';
import type { TypedConfigService } from '../config/env.js';
import { PermissionService } from '../authz/permission.service.js';
import { TenantDb, TenantKind, UserStatus, type DbContext } from '../database/index.js';
import { MfaService } from '../identity/mfa/mfa.service.js';
import {
  SessionStore,
  SessionStoreUnavailable,
  type SessionRecord,
} from '../sessions/session.store.js';
import { clearSessionCookie, readCookie, sessionCookieName } from '../sessions/session-cookie.js';
import { WorkspaceContextService } from '../tenancy/workspace-context.service.js';
import {
  ACCESS_METADATA,
  STEP_UP_METADATA,
  type AccessRule,
  type StepUpRule,
} from './access.decorators.js';
import type { AccessState, OgsRequest } from './access.types.js';
import { ApiException, forbidden, unauthenticated } from './api-error.js';
import { requestMeta } from './request-meta.js';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

type MutableState = { -readonly [K in keyof AccessState]: AccessState[K] };

/**
 * The single global gate for every request (Phase 3 plan §2.2–§2.5, §3.1–§3.2):
 *
 *  1. Route must declare an access rule (default deny).
 *  2. Unsafe requests with a body must be JSON (cross-site forms cannot send it
 *     without a CORS preflight, which the allow-list blocks).
 *  3. Session from the cookie (else 401) and, for unsafe methods, its CSRF token.
 *  4. User still exists and is active; unverified users only reach routes that allow it.
 *  5. MFA: a session that still owes its second factor, or a user who must enrol
 *     but has not, only reaches the MFA routes. Step-up freshness where required.
 *  6. Workspace from X-OGS-Workspace, resolved and granted by the server.
 *  7. Permission from the membership's roles, loaded fresh for this request.
 *  8. Elevated routes: an unexpired elevation on this session, named by
 *     X-OGS-Elevation, and the permission in the PLATFORM workspace → platform context.
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
    private readonly mfa: MfaService,
    @Inject(ConfigService) config: TypedConfigService,
  ) {
    this.secureCookie = config.get('SESSION_COOKIE_SECURE', { infer: true });
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const targets = [context.getHandler(), context.getClass()];
    const rule = this.reflector.getAllAndOverride<AccessRule | undefined>(ACCESS_METADATA, targets);
    const stepUp = this.reflector.getAllAndOverride<StepUpRule | undefined>(
      STEP_UP_METADATA,
      targets,
    );
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
        select: { id: true, email: true, status: true, deletedAt: true, mfaEnabled: true },
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
    const authenticatedRule = rule.kind === 'authenticated' ? rule : undefined;
    if (
      user.status === UserStatus.PENDING_VERIFICATION &&
      authenticatedRule?.allowUnverified !== true
    ) {
      throw forbidden('email_unverified');
    }

    // 5. MFA --------------------------------------------------------------------
    if (session.mfaPending && authenticatedRule?.allowMfaPending !== true) {
      throw forbidden('mfa_required');
    }
    if (
      !user.mfaEnabled &&
      authenticatedRule?.allowMfaEnrollment !== true &&
      (await this.mfa.isRequired(user.id))
    ) {
      throw forbidden('mfa_enrollment_required');
    }
    if (stepUp !== undefined) {
      this.checkStepUp(stepUp, session, user.mfaEnabled);
    }

    const state: MutableState = {
      sessionToken: token,
      session,
      user: { id: user.id, email: user.email, status: user.status, mfaEnabled: user.mfaEnabled },
      meta,
    };

    // 6–8. Workspace, permission, elevation ------------------------------------
    const needsWorkspace =
      rule.kind === 'permission' ||
      rule.kind === 'elevated' ||
      (authenticatedRule?.workspace ?? false);
    if (needsWorkspace) {
      await this.resolveWorkspace(request, rule, state);
    }

    request.ogs = state;
    return true;
  }

  private async resolveWorkspace(request: Request, rule: AccessRule, state: MutableState) {
    const header = request.get(WORKSPACE_HEADER);
    if (Array.isArray(header)) {
      throw forbidden('workspace_forbidden');
    }
    const resolution = await this.workspaces.resolve(state.user.id, header ?? 'personal');
    if (!resolution.ok) {
      throw forbidden('workspace_forbidden');
    }
    const { workspace, context: dbContext } = resolution;
    const allowRestricted =
      (rule.kind === 'authenticated' || rule.kind === 'permission') && rule.allowRestricted;
    if (workspace.kind !== 'personal' && workspace.restricted && !allowRestricted) {
      throw forbidden('workspace_restricted');
    }
    const granted =
      workspace.kind === 'personal'
        ? new Set<string>()
        : await this.db.run(dbContext, async (tx) =>
            this.permissions.forMembership(tx, workspace.membershipId),
          );

    let effective: DbContext = dbContext;
    if (rule.kind === 'permission' && !granted.has(rule.code)) {
      throw forbidden('permission_denied');
    }
    if (rule.kind === 'elevated') {
      if (workspace.kind !== TenantKind.PLATFORM || !granted.has(rule.code)) {
        throw forbidden('permission_denied');
      }
      effective = this.elevatedContext(request, state);
    }
    state.workspace = { resolved: workspace, context: effective, permissions: granted };
  }

  /** Review §6.3: platform context only with an unexpired elevation named by the client. */
  private elevatedContext(request: Request, state: MutableState): DbContext {
    const elevation = state.session.elevation;
    const presented = request.get(ELEVATION_HEADER);
    if (
      elevation === null ||
      typeof presented !== 'string' ||
      !safeEqual(presented, elevation.id) ||
      elevation.expiresAt <= Date.now()
    ) {
      throw forbidden('elevation_required');
    }
    return {
      kind: 'platform',
      userId: state.user.id,
      reason: elevation.reason,
      ...(elevation.tenantId === null ? {} : { tenantId: elevation.tenantId }),
    };
  }

  private checkStepUp(rule: StepUpRule, session: SessionRecord, mfaEnabled: boolean): void {
    if (!mfaEnabled) {
      if (rule.strict) {
        throw forbidden('mfa_enrollment_required');
      }
      return;
    }
    const fresh =
      session.stepUpAt !== null && Date.now() - session.stepUpAt <= rule.withinMinutes * 60_000;
    if (!fresh) {
      throw forbidden('step_up_required');
    }
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
