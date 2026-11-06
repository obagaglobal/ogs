import { describe, expect, it } from 'vitest';
import { hashRecoveryCode, newRecoveryCodes } from './recovery-codes.js';
import { SecretBox, SecretBoxError } from './secret-box.js';
import { base32Encode, otpauthUri, stepAt, totpCode, verifyTotp } from './totp.js';

// RFC 6238 Appendix B, SHA1, 8 digits, secret "12345678901234567890".
const RFC_SECRET = Buffer.from('12345678901234567890', 'ascii');
const RFC_VECTORS: [number, string][] = [
  [59, '94287082'],
  [1111111109, '07081804'],
  [1111111111, '14050471'],
  [1234567890, '89005924'],
  [2000000000, '69279037'],
  [20000000000, '65353130'],
];

describe('TOTP (B1)', () => {
  it.each(RFC_VECTORS)('matches RFC 6238 at T=%i', (time, expected) => {
    expect(totpCode(RFC_SECRET, stepAt(time), 8)).toBe(expected);
  });

  it('accepts the current step and ±1 step of drift, nothing further', () => {
    const now = 1_800_000_000;
    const at = (offset: number) => totpCode(RFC_SECRET, stepAt(now) + offset);
    expect(verifyTotp(RFC_SECRET, at(0), now, 0)).toBe(stepAt(now));
    expect(verifyTotp(RFC_SECRET, at(-1), now, 0)).toBe(stepAt(now) - 1);
    expect(verifyTotp(RFC_SECRET, at(1), now, 0)).toBe(stepAt(now) + 1);
    expect(verifyTotp(RFC_SECRET, at(2), now, 0)).toBeUndefined();
    expect(verifyTotp(RFC_SECRET, at(-2), now, 0)).toBeUndefined();
  });

  it('refuses a replayed code (step already used)', () => {
    const now = 1_800_000_000;
    const code = totpCode(RFC_SECRET, stepAt(now));
    const used = verifyTotp(RFC_SECRET, code, now, 0);
    expect(used).toBeDefined();
    expect(verifyTotp(RFC_SECRET, code, now, used ?? 0)).toBeUndefined();
  });

  it('refuses malformed codes', () => {
    expect(verifyTotp(RFC_SECRET, '12345', 0, 0)).toBeUndefined();
    expect(verifyTotp(RFC_SECRET, 'abcdef', 0, 0)).toBeUndefined();
  });

  it('encodes base32 (RFC 4648) and builds an otpauth URI', () => {
    expect(base32Encode(Buffer.from('foobar'))).toBe('MZXW6YTBOI');
    expect(otpauthUri(RFC_SECRET, 'a@b.co')).toBe(
      'otpauth://totp/OGS%3Aa%40b.co?secret=GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ&issuer=OGS&algorithm=SHA1&digits=6&period=30',
    );
  });
});

describe('SecretBox', () => {
  const k1 = `k1:${Buffer.alloc(32, 1).toString('base64')}`;
  const k2 = `k2:${Buffer.alloc(32, 2).toString('base64')}`;

  it('round-trips and rotates: old secrets open with the new keyring', () => {
    const old = new SecretBox(k1).seal(Buffer.from('seed'));
    const rotated = new SecretBox(`${k2},${k1}`);
    expect(rotated.open(old).toString()).toBe('seed');
    expect(rotated.isStale(old)).toBe(true);
    expect(rotated.seal(Buffer.from('x')).keyId).toBe('k2');
  });

  it('detects tampering and refuses unknown keys', () => {
    const box = new SecretBox(k1);
    const sealed = box.seal(Buffer.from('seed'));
    const bytes = Buffer.from(sealed.sealed, 'base64');
    bytes[bytes.length - 1] = (bytes[bytes.length - 1] ?? 0) ^ 1;
    expect(() => box.open({ ...sealed, sealed: bytes.toString('base64') })).toThrow(SecretBoxError);
    expect(() => new SecretBox(k2).open(sealed)).toThrow(SecretBoxError);
  });
});

describe('recovery codes', () => {
  it('are ten distinct xxxxx-xxxxx codes; hashing tolerates case and spacing', () => {
    const codes = newRecoveryCodes();
    expect(new Set(codes).size).toBe(10);
    for (const code of codes) {
      expect(code).toMatch(/^[a-z2-9]{5}-[a-z2-9]{5}$/);
    }
    const [first] = codes;
    expect(hashRecoveryCode(` ${(first ?? '').toUpperCase().replace('-', ' ')} `)).toBe(
      hashRecoveryCode(first ?? ''),
    );
  });
});
