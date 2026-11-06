import { argon2, randomBytes, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const argon2Async = promisify(argon2);

export interface Argon2Params {
  /** Memory in KiB. */
  readonly memoryKiB: number;
  readonly passes: number;
  readonly parallelism: number;
}

/** OWASP Password Storage Cheat Sheet baseline for Argon2id (19 MiB, t=2, p=1). */
export const DEFAULT_ARGON2_PARAMS: Argon2Params = { memoryKiB: 19_456, passes: 2, parallelism: 1 };

const SALT_BYTES = 16;
const TAG_BYTES = 32;
const PHC_PATTERN =
  /^\$argon2id\$v=19\$m=(\d+),t=(\d+),p=(\d+)\$([A-Za-z0-9+/]+)\$([A-Za-z0-9+/]+)$/;

const b64 = (buffer: Buffer): string => buffer.toString('base64').replace(/=+$/, '');
const fromB64 = (value: string): Buffer => Buffer.from(value, 'base64');

interface ParsedHash {
  readonly params: Argon2Params;
  readonly salt: Buffer;
  readonly tag: Buffer;
}

function parse(encoded: string): ParsedHash | undefined {
  const match = PHC_PATTERN.exec(encoded);
  if (match === null) {
    return undefined;
  }
  const [, m, t, p, salt, tag] = match;
  if (
    m === undefined ||
    t === undefined ||
    p === undefined ||
    salt === undefined ||
    tag === undefined
  ) {
    return undefined;
  }
  return {
    params: { memoryKiB: Number(m), passes: Number(t), parallelism: Number(p) },
    salt: fromB64(salt),
    tag: fromB64(tag),
  };
}

async function derive(password: string, salt: Buffer, params: Argon2Params, tagLength: number) {
  return argon2Async('argon2id', {
    message: Buffer.from(password.normalize('NFKC'), 'utf8'),
    nonce: salt,
    memory: params.memoryKiB,
    passes: params.passes,
    parallelism: params.parallelism,
    tagLength,
  });
}

/**
 * Argon2id password hashing with Node's built-in implementation (Phase 3 plan
 * §2.1). Hashes are PHC strings, so the parameters travel with each hash and can
 * be raised later: `needsRehash` tells the login flow to upgrade old hashes.
 * Passwords are NFKC-normalised first (ASVS 2.1: Unicode passwords).
 */
export class PasswordHasher {
  constructor(private readonly params: Argon2Params = DEFAULT_ARGON2_PARAMS) {}

  async hash(password: string): Promise<string> {
    const salt = randomBytes(SALT_BYTES);
    const tag = await derive(password, salt, this.params, TAG_BYTES);
    const { memoryKiB, passes, parallelism } = this.params;
    return `$argon2id$v=19$m=${String(memoryKiB)},t=${String(passes)},p=${String(parallelism)}$${b64(salt)}$${b64(tag)}`;
  }

  /** Constant-time comparison. A malformed hash never matches (and never throws). */
  async verify(encoded: string, password: string): Promise<boolean> {
    const parsed = parse(encoded);
    if (parsed === undefined || parsed.tag.length === 0) {
      return false;
    }
    const candidate = await derive(password, parsed.salt, parsed.params, parsed.tag.length);
    return candidate.length === parsed.tag.length && timingSafeEqual(candidate, parsed.tag);
  }

  needsRehash(encoded: string): boolean {
    const parsed = parse(encoded);
    if (parsed === undefined) {
      return true;
    }
    const { memoryKiB, passes, parallelism } = parsed.params;
    return (
      memoryKiB < this.params.memoryKiB ||
      passes < this.params.passes ||
      parallelism !== this.params.parallelism ||
      parsed.tag.length !== TAG_BYTES
    );
  }
}
