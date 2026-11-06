import { argon2Sync } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { PasswordHasher } from './password-hasher.js';

// Cheap parameters keep the unit tests fast; production uses DEFAULT_ARGON2_PARAMS.
const fast = new PasswordHasher({ memoryKiB: 1024, passes: 1, parallelism: 1 });

describe('PasswordHasher (A3)', () => {
  it('node:crypto Argon2id matches the RFC 9106 §5.3 test vector', () => {
    const tag = argon2Sync('argon2id', {
      message: Buffer.alloc(32, 0x01),
      nonce: Buffer.alloc(16, 0x02),
      secret: Buffer.alloc(8, 0x03),
      associatedData: Buffer.alloc(12, 0x04),
      memory: 32,
      passes: 3,
      parallelism: 4,
      tagLength: 32,
    });
    expect(tag.toString('hex')).toBe(
      '0d640df58d78766c08c037a34a8b53c9d01ef0452d75b65eb52520e96b01e659',
    );
  });

  it('produces a PHC string with the parameters and verifies it', async () => {
    const hash = await fast.hash('correct horse battery staple');
    expect(hash).toMatch(
      /^\$argon2id\$v=19\$m=1024,t=1,p=1\$[A-Za-z0-9+/]{22}\$[A-Za-z0-9+/]{43}$/,
    );
    expect(await fast.verify(hash, 'correct horse battery staple')).toBe(true);
    expect(await fast.verify(hash, 'correct horse battery stapl')).toBe(false);
  });

  it('salts every hash', async () => {
    expect(await fast.hash('same password here')).not.toBe(await fast.hash('same password here'));
  });

  it('normalises Unicode (NFKC) so visually identical passwords match', async () => {
    const composed = 'café au lait daily';
    const decomposed = 'café au lait daily';
    expect(await fast.verify(await fast.hash(composed), decomposed)).toBe(true);
  });

  it('never matches (or throws on) a malformed hash', async () => {
    expect(await fast.verify('not-a-hash', 'anything')).toBe(false);
    expect(await fast.verify('$argon2id$v=19$m=1,t=1,p=1$$', 'anything')).toBe(false);
  });

  it('asks for a rehash when stored parameters are weaker than current ones', async () => {
    const strong = new PasswordHasher({ memoryKiB: 2048, passes: 2, parallelism: 1 });
    const old = await fast.hash('upgrade me please');
    expect(strong.needsRehash(old)).toBe(true);
    expect(strong.needsRehash(await strong.hash('upgrade me please'))).toBe(false);
    expect(strong.needsRehash('garbage')).toBe(true);
  });
});
