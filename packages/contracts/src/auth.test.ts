import { describe, expect, it } from 'vitest';
import { emailSchema, emailTokenSchema, newPasswordSchema, registerRequestSchema } from './auth.js';

describe('auth contracts', () => {
  it('normalises email addresses', () => {
    expect(emailSchema.parse('  Alice@Example.COM ')).toBe('alice@example.com');
    expect(emailSchema.safeParse('not-an-email').success).toBe(false);
  });

  it('counts password length in code points, not UTF-16 units', () => {
    expect(newPasswordSchema.safeParse('😀'.repeat(12)).success).toBe(true);
    expect(newPasswordSchema.safeParse('😀'.repeat(6)).success).toBe(false); // 12 UTF-16 units
    expect(newPasswordSchema.safeParse('a'.repeat(129)).success).toBe(false);
  });

  it('allows any characters, with no composition rules', () => {
    expect(newPasswordSchema.safeParse('all lower case words here').success).toBe(true);
  });

  it('accepts only 43-character base64url tokens', () => {
    expect(emailTokenSchema.safeParse('A'.repeat(43)).success).toBe(true);
    expect(emailTokenSchema.safeParse('A'.repeat(42)).success).toBe(false);
    expect(emailTokenSchema.safeParse(`${'A'.repeat(42)}=`).success).toBe(false);
  });

  it('rejects unknown shapes', () => {
    expect(registerRequestSchema.safeParse({ email: 'a@b.co' }).success).toBe(false);
  });
});
