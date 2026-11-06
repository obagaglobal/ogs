import type { Request } from 'express';
import { describe, expect, it } from 'vitest';
import { readCookie, sessionCookieName, sessionCookieOptions } from './session-cookie.js';

describe('session cookie (A7)', () => {
  it('production: __Host- prefix, Secure, HttpOnly, SameSite=Lax, Path=/, no Domain', () => {
    expect(sessionCookieName(true)).toBe('__Host-ogs_session');
    const options = sessionCookieOptions(true);
    expect(options).toMatchObject({ httpOnly: true, secure: true, sameSite: 'lax', path: '/' });
    expect(options).not.toHaveProperty('domain');
  });

  it('local http development: no prefix, not Secure, otherwise identical', () => {
    expect(sessionCookieName(false)).toBe('ogs_session');
    expect(sessionCookieOptions(false)).toMatchObject({
      httpOnly: true,
      secure: false,
      sameSite: 'lax',
    });
  });

  it('reads one cookie from the header and ignores look-alikes', () => {
    const request = { headers: { cookie: 'x_ogs_session=bad; ogs_session=good%2Bvalue; other=1' } };
    expect(readCookie(request as unknown as Request, 'ogs_session')).toBe('good+value');
    expect(readCookie({ headers: {} } as unknown as Request, 'ogs_session')).toBeUndefined();
  });
});
