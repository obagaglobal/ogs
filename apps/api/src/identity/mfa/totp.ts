import { createHmac, randomBytes } from 'node:crypto';

/**
 * RFC 6238 TOTP (Phase 3 plan §3.1, decision P3-5): HMAC-SHA1, 6 digits,
 * 30-second steps, ±1 step of clock drift. About 30 lines, so no dependency;
 * verified against the RFC test vectors in totp.test.ts.
 */
export const TOTP_PERIOD_SECONDS = 30;
export const TOTP_DIGITS = 6;
const SECRET_BYTES = 20;
const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function newTotpSecret(): Buffer {
  return randomBytes(SECRET_BYTES);
}

export function base32Encode(bytes: Buffer): string {
  let bits = 0;
  let value = 0;
  let output = '';
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32.charAt((value >>> (bits - 5)) & 31);
      bits -= 5;
    }
  }
  if (bits > 0) {
    output += BASE32.charAt((value << (5 - bits)) & 31);
  }
  return output;
}

export function base32Decode(text: string): Buffer {
  const clean = text.toUpperCase().replace(/=+$/, '');
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (const char of clean) {
    const index = BASE32.indexOf(char);
    if (index === -1) {
      throw new Error('invalid base32');
    }
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

export function stepAt(unixSeconds: number): number {
  return Math.floor(unixSeconds / TOTP_PERIOD_SECONDS);
}

/** The code for one time step (`digits` defaults to 6; the RFC vectors use 8). */
export function totpCode(secret: Buffer, step: number, digits = TOTP_DIGITS): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const hmac = createHmac('sha1', secret).update(counter).digest();
  const offset = (hmac[hmac.length - 1] ?? 0) & 0x0f;
  const binary = hmac.readUInt32BE(offset) & 0x7fffffff;
  return String(binary % 10 ** digits).padStart(digits, '0');
}

/**
 * Checks a code against the current step ±1. Returns the matching step, or
 * undefined. Steps at or below `lastUsedStep` are refused, so a code (or an
 * older one) can never be replayed.
 */
export function verifyTotp(
  secret: Buffer,
  code: string,
  nowSeconds: number,
  lastUsedStep: number,
): number | undefined {
  if (!/^\d{6}$/.test(code)) {
    return undefined;
  }
  const current = stepAt(nowSeconds);
  let matched: number | undefined;
  // Check every candidate (no early return), so timing does not reveal which matched.
  for (const step of [current - 1, current, current + 1]) {
    if (step > lastUsedStep && totpCode(secret, step) === code) {
      matched ??= step;
    }
  }
  return matched;
}

export function otpauthUri(secret: Buffer, accountName: string, issuer = 'OGS'): string {
  const label = encodeURIComponent(`${issuer}:${accountName}`);
  const params = new URLSearchParams({
    secret: base32Encode(secret),
    issuer,
    algorithm: 'SHA1',
    digits: String(TOTP_DIGITS),
    period: String(TOTP_PERIOD_SECONDS),
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}
