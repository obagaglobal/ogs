import type { CookieOptions, Request, Response } from 'express';
import { SESSION_ABSOLUTE_TIMEOUT_MS } from './session.store.js';

/**
 * `__Host-` cookies must be Secure, host-only and Path=/ (browsers enforce it),
 * which rules out http://localhost in development. Production always uses the
 * prefixed name (SESSION_COOKIE_SECURE is forced on in production by env validation).
 */
export function sessionCookieName(secure: boolean): string {
  return secure ? '__Host-ogs_session' : 'ogs_session';
}

export function sessionCookieOptions(secure: boolean): CookieOptions {
  return {
    httpOnly: true,
    secure,
    sameSite: 'lax',
    path: '/',
    maxAge: SESSION_ABSOLUTE_TIMEOUT_MS,
  };
}

export function setSessionCookie(response: Response, token: string, secure: boolean): void {
  response.cookie(sessionCookieName(secure), token, sessionCookieOptions(secure));
}

export function clearSessionCookie(response: Response, secure: boolean): void {
  const options: CookieOptions = { ...sessionCookieOptions(secure) };
  delete options.maxAge;
  response.clearCookie(sessionCookieName(secure), options);
}

/** Reads one cookie from the raw header (no cookie-parser dependency needed). */
export function readCookie(request: Request, name: string): string | undefined {
  const header = request.headers.cookie;
  if (header === undefined) {
    return undefined;
  }
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index > 0 && part.slice(0, index).trim() === name) {
      const value = part.slice(index + 1).trim();
      try {
        return decodeURIComponent(value);
      } catch {
        return undefined;
      }
    }
  }
  return undefined;
}
