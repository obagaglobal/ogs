import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

/** 256-bit random secret, base64url (43 characters). Used for session ids and email tokens. */
export function newSecret(): string {
  return randomBytes(32).toString('base64url');
}

/** Lower-case hex SHA-256. Only hashes of secrets are ever stored. */
export function sha256Hex(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

/** Constant-time string comparison (different lengths compare unequal without leaking where). */
export function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8');
  const right = Buffer.from(b, 'utf8');
  if (left.length !== right.length) {
    // Still do the work so timing does not reveal the length mismatch early.
    timingSafeEqual(left, left);
    return false;
  }
  return timingSafeEqual(left, right);
}
