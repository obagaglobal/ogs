import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { PALETTE_CLASS, RAW_COLOUR } from '../../../../eslint-rules/no-raw-colours.js';

/**
 * Design system guard (Phase 6b): no raw colour values and no Tailwind palette
 * colours anywhere in apps/web/src except the token file. ESLint covers TS/TSX
 * literals; this test also covers CSS and anything the linter cannot see.
 */
/** Tests run from apps/web (pnpm --filter / vitest root). */
const SRC = join(process.cwd(), 'src');
const ALLOWED = new Set([
  'styles/tokens.css',
  'test/no-raw-colours.test.ts',
  'test/contrast.test.ts',
]);

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path) : [path];
  });
}

describe('no raw colours outside the token file', () => {
  it('every source file uses tokens', () => {
    const offenders: string[] = [];
    for (const path of files(SRC)) {
      const name = relative(SRC, path).replace(/\\/g, '/');
      if (!/\.(tsx?|css)$/.test(name) || ALLOWED.has(name)) continue;
      readFileSync(path, 'utf8')
        .split('\n')
        .forEach((line, index) => {
          if (RAW_COLOUR.test(line) || PALETTE_CLASS.test(line)) {
            offenders.push(`${name}:${String(index + 1)}: ${line.trim()}`);
          }
        });
    }
    expect(offenders).toEqual([]);
  });

  it('the patterns catch what they should and nothing else', () => {
    for (const bad of [
      '#FFF',
      'color: #1a2b3c',
      'rgb(0 0 0)',
      'rgba(0,0,0,.5)',
      'hsl(0 0% 0%)',
      'oklch(0.5 0 0)',
    ]) {
      expect(RAW_COLOUR.test(bad), bad).toBe(true);
    }
    for (const bad of ['bg-emerald-50', 'p-2 text-red-600', 'hover:bg-white', 'border-black']) {
      expect(PALETTE_CLASS.test(bad), bad).toBe(true);
    }
    for (const ok of [
      '/verify-email#token=abc',
      '#content',
      'bg-surface text-ink',
      'text-success',
      'bg-saffron/10',
      'whitespace-nowrap',
    ]) {
      expect(RAW_COLOUR.test(ok) || PALETTE_CLASS.test(ok), ok).toBe(false);
    }
  });
});
