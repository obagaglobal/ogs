import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { FONT_FILES } from '../../scripts/sync-fonts.mjs';

/**
 * The self-hosted fonts in public/fonts are byte-identical to the pinned
 * @fontsource packages (run `pnpm --filter @ogs/web fonts:sync` after an
 * upgrade), and every one is declared in fonts.css and nothing else is fetched.
 */
/** Tests run from apps/web (pnpm --filter / vitest root). */
const WEB = process.cwd();
const require = createRequire(join(WEB, 'package.json'));

describe('self-hosted fonts', () => {
  it.each(FONT_FILES)('%s %s matches the package', (pkg, file) => {
    const packaged = readFileSync(
      join(dirname(require.resolve(`${pkg}/package.json`)), 'files', file),
    );
    const shipped = readFileSync(join(WEB, 'public', 'fonts', file));
    expect(shipped.equals(packaged)).toBe(true);
  });

  it('fonts.css declares exactly the shipped files, latin woff2 with swap', () => {
    const css = readFileSync(join(WEB, 'src', 'styles', 'fonts.css'), 'utf8');
    const urls = [...css.matchAll(/url\('\/fonts\/([^']+)'\)/g)].map((m) => m[1]).sort();
    expect(urls).toEqual(FONT_FILES.map(([, file]) => file).sort());
    expect(css.match(/font-display:\s*swap;/g)).toHaveLength(FONT_FILES.length);
    expect(css).not.toMatch(/googleapis|gstatic/);
  });

  it('index.html preloads the two most important files', () => {
    const html = readFileSync(join(WEB, 'index.html'), 'utf8');
    const preloads = [...html.matchAll(/rel="preload"\s+href="\/fonts\/([^"]+)"/g)].map(
      (m) => m[1],
    );
    expect(preloads).toEqual([
      'inter-latin-400-normal.woff2',
      'space-grotesk-latin-700-normal.woff2',
    ]);
  });
});
