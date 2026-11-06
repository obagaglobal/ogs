import { describe, expect, it } from 'vitest';
import { initialsOf } from './initials';

describe('initialsOf', () => {
  it('takes the first letters of the first two words', () => {
    expect(initialsOf('Wanjiru Kamau')).toBe('WK');
    expect(initialsOf('amina.otieno@example.co.ke')).toBe('AO');
    expect(initialsOf('Zawadi')).toBe('Z');
  });

  it('falls back to a question mark', () => {
    expect(initialsOf('')).toBe('?');
    expect(initialsOf('123')).toBe('?');
  });
});
