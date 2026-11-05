#!/usr/bin/env node
/**
 * Creates local .env files from their committed .env.example templates.
 *
 * Safe by design: an existing .env file is NEVER overwritten.
 * Usage: pnpm setup:env
 */
import { copyFileSync, existsSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const locations = ['.', 'apps/api', 'apps/web'];

for (const location of locations) {
  const example = join(root, location, '.env.example');
  const target = join(root, location, '.env');
  const label = relative(root, target) || '.env';

  if (!existsSync(example)) {
    console.warn(`skip     ${label} (no .env.example found)`);
  } else if (existsSync(target)) {
    console.log(`exists   ${label} (left unchanged)`);
  } else {
    copyFileSync(example, target);
    console.log(`created  ${label}`);
  }
}

console.log('\nReview the generated files and replace placeholder credentials before use.');
