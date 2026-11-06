import { randomInt } from 'node:crypto';
import { sha256Hex } from '../../common/secrets.js';

/** Unambiguous lower-case alphabet (no 0/o, 1/l/i). 31 symbols × 10 = ~49 bits per code. */
const ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';
export const RECOVERY_CODE_COUNT = 10;

/** Ten single-use codes shaped `xxxxx-xxxxx`, shown to the user once. */
export function newRecoveryCodes(count = RECOVERY_CODE_COUNT): string[] {
  return Array.from({ length: count }, () => {
    const chars = Array.from({ length: 10 }, () => ALPHABET.charAt(randomInt(ALPHABET.length)));
    return `${chars.slice(0, 5).join('')}-${chars.slice(5).join('')}`;
  });
}

/** Normalises what a person typed (case, spaces, missing dash) before hashing. */
export function hashRecoveryCode(input: string): string {
  const compact = input.toLowerCase().replace(/[^a-z0-9]/g, '');
  return sha256Hex(`${compact.slice(0, 5)}-${compact.slice(5)}`);
}
