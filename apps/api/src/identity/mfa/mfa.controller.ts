import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Inject,
  Post,
  Res,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  mfaConfirmRequestSchema,
  mfaStepUpRequestSchema,
  mfaVerifyRequestSchema,
  type CurrentSessionResponse,
  type MfaSetupResponse,
  type MfaStatusResponse,
  type RecoveryCodesResponse,
} from '@ogs/contracts';
import type { Response } from 'express';
import { Auth, Authenticated, RequireRecentMfa } from '../../access/access.decorators.js';
import type { AccessState } from '../../access/access.types.js';
import { parseBody } from '../../access/parse-body.js';
import type { TypedConfigService } from '../../config/env.js';
import { SessionStore } from '../../sessions/session.store.js';
import { setSessionCookie } from '../../sessions/session-cookie.js';
import { MfaService } from './mfa.service.js';

/** /api/v1/auth/mfa — TOTP enrolment, sign-in second step, step-up (Phase 3 plan §3.1). */
@Controller('auth/mfa')
export class MfaController {
  private readonly secureCookie: boolean;

  constructor(
    private readonly mfa: MfaService,
    private readonly sessions: SessionStore,
    @Inject(ConfigService) config: TypedConfigService,
  ) {
    this.secureCookie = config.get('SESSION_COOKIE_SECURE', { infer: true });
  }

  @Get()
  @Authenticated({ allowMfaEnrollment: true })
  @Header('Cache-Control', 'no-store')
  async status(@Auth() auth: AccessState): Promise<MfaStatusResponse> {
    return this.mfa.status(auth.user.id);
  }

  /** Starts enrolment: returns the secret and otpauth:// URI for the authenticator app. */
  @Post('totp/setup')
  @Authenticated({ allowMfaEnrollment: true })
  @Header('Cache-Control', 'no-store')
  async setup(@Auth() auth: AccessState): Promise<MfaSetupResponse> {
    return this.mfa.startSetup(auth.user.id, auth.user.email);
  }

  /**
   * Confirms enrolment with a first code. Every OTHER session is signed out
   * (they were authenticated without the new factor); this one is rotated and
   * counts as freshly verified. Recovery codes are returned once.
   */
  @Post('totp/confirm')
  @Authenticated({ allowMfaEnrollment: true })
  @Header('Cache-Control', 'no-store')
  async confirm(
    @Body() body: unknown,
    @Auth() auth: AccessState,
    @Res({ passthrough: true }) response: Response,
  ): Promise<RecoveryCodesResponse> {
    const { code } = parseBody(mfaConfirmRequestSchema, body);
    const recoveryCodes = await this.mfa.confirmSetup(auth.user.id, code, auth.meta);
    await this.sessions.revokeAll(auth.user.id, auth.sessionToken);
    await this.rotateVerified(auth, response);
    return { recoveryCodes };
  }

  /** Second step of sign-in: a TOTP code or a recovery code. */
  @Post('verify')
  @Authenticated({ allowUnverified: true, allowMfaPending: true })
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'no-store')
  async verify(
    @Body() body: unknown,
    @Auth() auth: AccessState,
    @Res({ passthrough: true }) response: Response,
  ): Promise<CurrentSessionResponse> {
    const proof = parseBody(mfaVerifyRequestSchema, body);
    await this.mfa.verify(auth.user.id, proof, auth.meta);
    const record = await this.rotateVerified(auth, response);
    return {
      user: auth.user,
      session: {
        id: record.id,
        createdAt: new Date(record.createdAt).toISOString(),
        lastSeenAt: new Date(record.lastSeenAt).toISOString(),
        expiresAt: new Date(record.absoluteExpiresAt).toISOString(),
        ip: record.ip,
        userAgent: record.userAgent,
        current: true,
        mfaPending: false,
      },
    };
  }

  /** Re-confirms presence before a sensitive action (step-up). Same cookie. */
  @Post('step-up')
  @Authenticated()
  @HttpCode(HttpStatus.NO_CONTENT)
  async stepUp(@Body() body: unknown, @Auth() auth: AccessState): Promise<void> {
    const { code } = parseBody(mfaStepUpRequestSchema, body);
    await this.mfa.verify(auth.user.id, { code }, auth.meta);
    await this.sessions.update(auth.sessionToken, { stepUpAt: Date.now() });
  }

  @Post('recovery-codes')
  @Authenticated()
  @RequireRecentMfa(15)
  @Header('Cache-Control', 'no-store')
  async regenerate(@Auth() auth: AccessState): Promise<RecoveryCodesResponse> {
    return { recoveryCodes: await this.mfa.regenerateRecoveryCodes(auth.user.id, auth.meta) };
  }

  /** Turns MFA off (refused while a role requires it). */
  @Delete()
  @Authenticated()
  @RequireRecentMfa(15)
  @HttpCode(HttpStatus.NO_CONTENT)
  async disable(@Auth() auth: AccessState): Promise<void> {
    await this.mfa.disable(auth.user.id, auth.meta);
    await this.sessions.update(auth.sessionToken, { mfaLevel: 0, stepUpAt: null });
  }

  /** New cookie value, second factor satisfied, step-up fresh. */
  private async rotateVerified(auth: AccessState, response: Response) {
    const rotated = await this.sessions.rotate(auth.sessionToken, {
      mfaLevel: 1,
      mfaPending: false,
      stepUpAt: Date.now(),
    });
    if (rotated === undefined) {
      throw new Error('session vanished during MFA verification');
    }
    setSessionCookie(response, rotated.token, this.secureCookie);
    return rotated.record;
  }
}
