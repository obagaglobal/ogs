#!/usr/bin/env node
/**
 * Copies the self-hosted font files from the pinned @fontsource packages into
 * public/fonts (stable URLs, so index.html can preload them). Run after
 * upgrading a font package:  pnpm --filter @ogs/web fonts:sync
 * src/test/fonts.test.ts fails if the copies drift from the packages.
 */
import { copyFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const FONT_FILES = [
  ['@fontsource/inter', 'inter-latin-400-normal.woff2'],
  ['@fontsource/inter', 'inter-latin-500-normal.woff2'],
  ['@fontsource/space-grotesk', 'space-grotesk-latin-400-normal.woff2'],
  ['@fontsource/space-grotesk', 'space-grotesk-latin-500-normal.woff2'],
  ['@fontsource/space-grotesk', 'space-grotesk-latin-700-normal.woff2'],
  ['@fontsource/jetbrains-mono', 'jetbrains-mono-latin-400-normal.woff2'],
  ['@fontsource/jetbrains-mono', 'jetbrains-mono-latin-500-normal.woff2'],
];

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(join(here, '..', 'package.json'));
const target = join(here, '..', 'public', 'fonts');

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  mkdirSync(target, { recursive: true });
  for (const [pkg, file] of FONT_FILES) {
    const source = join(dirname(require.resolve(`${pkg}/package.json`)), 'files', file);
    copyFileSync(source, join(target, file));
    console.log(`copied ${file}`);
  }
  // Each family's SIL OFL 1.1 licence travels with the files.
  for (const pkg of new Set(FONT_FILES.map(([name]) => name))) {
    const family = pkg.split('/')[1];
    copyFileSync(
      join(dirname(require.resolve(`${pkg}/package.json`)), 'LICENSE'),
      join(target, `LICENSE-${family}.txt`),
    );
  }
}
