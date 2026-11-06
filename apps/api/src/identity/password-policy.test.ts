import { describe, expect, it } from 'vitest';
import { PasswordPolicy } from './password-policy.js';

describe('PasswordPolicy', () => {
  const policy = new PasswordPolicy();

  it('loads the bundled breached list', () => {
    expect(policy.size).toBeGreaterThan(1000);
  });

  it('rejects breached passwords case-insensitively', () => {
    expect(policy.check('password1234', 'x@example.com')).toBe('breached');
    expect(policy.check('PASSWORD1234', 'x@example.com')).toBe('breached');
  });

  it('rejects passwords containing the email local part', () => {
    expect(policy.check('my name is wanjiku!', 'wanjiku@example.com')).toBe('contains_email');
  });

  it('rejects the service name', () => {
    expect(policy.check('ObagaGlobal-2026!', 'x@example.com')).toBe('contains_service_name');
  });

  it('accepts a long unremarkable passphrase', () => {
    expect(policy.check('tea plantation sunrise kericho', 'x@example.com')).toBeUndefined();
  });
});
