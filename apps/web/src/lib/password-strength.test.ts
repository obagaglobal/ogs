import { estimateStrength } from './password-strength';

describe('estimateStrength (F-1)', () => {
  it.each([
    ['', 0],
    ['short', 0],
    ['password1234', 1],
    ['qwertyuiop12', 1],
    ['aaaaaaaaaaaaaaaa', 1],
    ['abcdefghijklmnop', 1],
    ['Kenya2026Kenya2026', 1],
  ])('rates %j as weak (score ≤ %i)', (password, max) => {
    expect(estimateStrength(password).score).toBeLessThanOrEqual(max);
  });

  it.each([
    'tea plantation sunrise kericho',
    'correct horse battery staple',
    'Mangoes ripen slowly in Mombasa',
    'zebra-crossing-at-7pm-near-the-kiosk',
  ])('rates the passphrase %j as good or strong', (password) => {
    expect(estimateStrength(password).score).toBeGreaterThanOrEqual(3);
  });

  it('explains what is wrong while weak, and says nothing once good', () => {
    expect(estimateStrength('password12345678').hint).toMatch(/common words/);
    expect(estimateStrength('ab').hint).toMatch(/12 characters/);
    expect(estimateStrength('tea plantation sunrise kericho').hint).toBeUndefined();
  });

  it('counts Unicode characters, not UTF-16 units', () => {
    expect(estimateStrength('😀😀😀😀😀😀').score).toBe(0);
  });
});
