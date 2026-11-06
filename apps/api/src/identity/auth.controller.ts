import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  changePasswordRequestSchema,
  forgotPasswordRequestSchema,
  loginRequestSchema,
  registerRequestSchema,
  resetPasswordRequestSchema,
  verifyEmailRequestSchema,
  type CsrfResponse,
  type CurrentSessionResponse,
  type SessionListResponse,
  type SessionSummary,
} from '@ogs/contracts';
import type { Response } from 'express';
import { Auth, Authenticated, Public, RequireRecentMfa } from '../access/access.decorators.js';
import type { AccessState, OgsRequest } from '../access/access.types.js';
import { ApiException } from '../access/api-error.js';
import { parseBody } from '../access/parse-body.js';
import { requestMeta } from '../access/request-meta.js';
import type { TypedConfigService } from '../config/env.js';
import { SessionStore, type SessionRecord } from '../sessions/session.store.js';
import { clearSessionCookie, setSessionCookie } from '../sessions/session-cookie.js';
import { IdentityService } from './identity.service.js';

function summary(record: SessionRecord, current: boolean): SessionSummary {
  return {
    id: record.id,
    createdAt: new Date(record.createdAt).toISOString(),
    lastSeenAt: new Date(record.lastSeenAt).toISOString(),
    expiresAt: new Date(record.absoluteExpiresAt).toISOString(),
    ip: record.ip,
    userAgent: record.userAgent,
    current,
    mfaPending: record.mfaPending,
  };
}

/** /api/v1/auth — accounts, sign-in and sessions (Phase 3 plan §2.1–§2.3). */
@Controller('auth')
export class AuthController {
  private readonly secureCookie: boolean;

  constructor(
    private readonly identity: IdentityService,
    private readonly sessions: SessionStore,
    @Inject(ConfigService) config: TypedConfigService,
  ) {
    this.secureCookie = config.get('SESSION_COOKIE_SECURE', { infer: true });
  }

  /** 202 whether or not the email is new (no account enumeration). */
  @Post('register')
  @Public()
  @HttpCode(HttpStatus.ACCEPTED)
  async register(@Body() body: unknown, @Req() request: OgsRequest): Promise<void> {
    const { email, password } = parseBody(registerRequestSchema, body);
    await this.identity.register(email, password, requestMeta(request));
  }

  @Post('verify-email')
  @Public()
  @HttpCode(HttpStatus.NO_CONTENT)
  async verifyEmail(@Body() body: unknown, @Req() request: OgsRequest): Promise<void> {
    const { token } = parseBody(verifyEmailRequestSchema, body);
    await this.identity.verifyEmail(token, requestMeta(request));
  }

  @Post('resend-verification')
  @Authenticated({ allowUnverified: true, allowMfaEnrollment: true })
  @HttpCode(HttpStatus.ACCEPTED)
  async resendVerification(@Auth() auth: AccessState): Promise<void> {
    await this.identity.resendVerification(auth.user.id, auth.meta);
  }

  @Post('login')
  @Public()
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'no-store')
  async login(
    @Body() body: unknown,
    @Req() request: OgsRequest,
    @Res({ passthrough: true }) response: Response,
  ): Promise<CurrentSessionResponse> {
    const { email, password } = parseBody(loginRequestSchema, body);
    const meta = requestMeta(request);
    const { userId, mfaEnabled } = await this.identity.login(email, password, meta);
    // A brand-new session on every sign-in: any pre-existing cookie is ignored (no fixation).
    // With MFA the session starts "pending": only POST /auth/mfa/verify and sign-out work.
    const { token, record } = await this.sessions.create(userId, meta, { mfaPending: mfaEnabled });
    setSessionCookie(response, token, this.secureCookie);
    const { status } = await this.identity.profileOf(userId);
    return {
      user: { id: userId, email, status, mfaEnabled },
      session: summary(record, true),
    };
  }

  @Post('logout')
  @Authenticated({ allowUnverified: true, allowMfaPending: true, allowMfaEnrollment: true })
  @HttpCode(HttpStatus.NO_CONTENT)
  async logout(@Auth() auth: AccessState, @Res({ passthrough: true }) response: Response) {
    await this.sessions.revoke(auth.sessionToken);
    clearSessionCookie(response, this.secureCookie);
    await this.identity.recordLogout(auth.user.id, auth.meta);
  }

  /** 202 whether or not the account exists. */
  @Post('password/forgot')
  @Public()
  @HttpCode(HttpStatus.ACCEPTED)
  async forgotPassword(@Body() body: unknown, @Req() request: OgsRequest): Promise<void> {
    const { email } = parseBody(forgotPasswordRequestSchema, body);
    await this.identity.forgotPassword(email, requestMeta(request));
  }

  @Post('password/reset')
  @Public()
  @HttpCode(HttpStatus.NO_CONTENT)
  async resetPassword(@Body() body: unknown, @Req() request: OgsRequest): Promise<void> {
    const { token, password } = parseBody(resetPasswordRequestSchema, body);
    await this.identity.resetPassword(token, password, requestMeta(request));
  }

  /**
   * Changes the password, signs out every other session and rotates this one.
   * Users with MFA must have stepped up within 15 minutes.
   */
  @Post('password/change')
  @Authenticated({ allowUnverified: true })
  @RequireRecentMfa(15, { strict: false })
  @HttpCode(HttpStatus.NO_CONTENT)
  async changePassword(
    @Body() body: unknown,
    @Auth() auth: AccessState,
    @Res({ passthrough: true }) response: Response,
  ): Promise<void> {
    const { currentPassword, newPassword } = parseBody(changePasswordRequestSchema, body);
    await this.identity.changePassword(
      auth.user.id,
      currentPassword,
      newPassword,
      auth.sessionToken,
      auth.meta,
    );
    const rotated = await this.sessions.rotate(auth.sessionToken);
    if (rotated !== undefined) {
      setSessionCookie(response, rotated.token, this.secureCookie);
    }
  }

  /** The CSRF token to send as X-CSRF-Token on every unsafe request. */
  @Get('csrf')
  @Authenticated({ allowUnverified: true, allowMfaPending: true, allowMfaEnrollment: true })
  @Header('Cache-Control', 'no-store')
  csrf(@Auth() auth: AccessState): CsrfResponse {
    return { csrfToken: auth.session.csrfToken };
  }

  @Get('session')
  @Authenticated({ allowUnverified: true, allowMfaPending: true, allowMfaEnrollment: true })
  @Header('Cache-Control', 'no-store')
  session(@Auth() auth: AccessState): CurrentSessionResponse {
    return { user: auth.user, session: summary(auth.session, true) };
  }

  @Get('sessions')
  @Authenticated({ allowUnverified: true, allowMfaEnrollment: true })
  @Header('Cache-Control', 'no-store')
  async listSessions(@Auth() auth: AccessState): Promise<SessionListResponse> {
    const sessions = await this.sessions.list(auth.user.id);
    return {
      sessions: sessions.map((session) => summary(session, session.id === auth.session.id)),
    };
  }

  @Delete('sessions/:id')
  @Authenticated({ allowUnverified: true, allowMfaEnrollment: true })
  @HttpCode(HttpStatus.NO_CONTENT)
  async revokeSession(@Param('id') id: string, @Auth() auth: AccessState): Promise<void> {
    // Not found and "someone else's" look the same.
    if (!(await this.sessions.revokeById(auth.user.id, id))) {
      throw new ApiException(HttpStatus.NOT_FOUND, 'not_found');
    }
    await this.identity.recordSessionRevoked(auth.user.id, auth.meta, 'user_revoked_one');
  }

  @Post('sessions/revoke-others')
  @Authenticated({ allowUnverified: true, allowMfaEnrollment: true })
  @HttpCode(HttpStatus.NO_CONTENT)
  async revokeOthers(@Auth() auth: AccessState): Promise<void> {
    await this.sessions.revokeAll(auth.user.id, auth.sessionToken);
    await this.identity.recordSessionRevoked(auth.user.id, auth.meta, 'user_revoked_others');
  }
}
