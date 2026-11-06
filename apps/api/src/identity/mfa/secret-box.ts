import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const IV_BYTES = 12;
const TAG_BYTES = 16;

export interface SealedSecret {
  readonly keyId: string;
  /** base64(iv | tag | ciphertext) */
  readonly sealed: string;
}

export class SecretBoxError extends Error {
  override readonly name = 'SecretBoxError';
}

/**
 * AES-256-GCM sealing of small secrets (TOTP seeds) with a keyring.
 * MFA_ENCRYPTION_KEYS = "id:base64key,id:base64key": the first key seals new
 * secrets, every key can open old ones, so keys rotate without re-enrolment.
 * The key id is bound as additional authenticated data.
 */
export class SecretBox {
  private readonly keys: ReadonlyMap<string, Buffer>;
  private readonly activeId: string;

  constructor(keyring: string) {
    const entries = keyring.split(',').map((entry) => {
      const [id, material] = entry.split(':');
      const key = Buffer.from(material ?? '', 'base64');
      if (id === undefined || id === '' || key.length !== 32) {
        throw new SecretBoxError('MFA_ENCRYPTION_KEYS: every entry must be id:base64-32-byte-key');
      }
      return [id, key] as const;
    });
    const first = entries[0];
    if (first === undefined) {
      throw new SecretBoxError('MFA_ENCRYPTION_KEYS is empty');
    }
    this.keys = new Map(entries);
    this.activeId = first[0];
  }

  seal(plaintext: Buffer): SealedSecret {
    const key = this.keys.get(this.activeId);
    if (key === undefined) {
      throw new SecretBoxError('active key missing');
    }
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv('aes-256-gcm', key, iv).setAAD(Buffer.from(this.activeId));
    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    return {
      keyId: this.activeId,
      sealed: Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString('base64'),
    };
  }

  open(secret: SealedSecret): Buffer {
    const key = this.keys.get(secret.keyId);
    if (key === undefined) {
      throw new SecretBoxError(`unknown key id ${secret.keyId}`);
    }
    const data = Buffer.from(secret.sealed, 'base64');
    const decipher = createDecipheriv('aes-256-gcm', key, data.subarray(0, IV_BYTES))
      .setAAD(Buffer.from(secret.keyId))
      .setAuthTag(data.subarray(IV_BYTES, IV_BYTES + TAG_BYTES));
    try {
      return Buffer.concat([
        decipher.update(data.subarray(IV_BYTES + TAG_BYTES)),
        decipher.final(),
      ]);
    } catch {
      throw new SecretBoxError('sealed secret failed authentication');
    }
  }

  /** True when a secret was sealed with an older key and should be re-sealed. */
  isStale(secret: SealedSecret): boolean {
    return secret.keyId !== this.activeId;
  }
}
