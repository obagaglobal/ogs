/**
 * Phase 9 plan §2.9: the technician screens must stay small on mobile data.
 * After `vite build`, fails if the jobs route chunk (assignee-pages-*.js) is
 * over its gzip budget. Run by `pnpm build`, so CI enforces it.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';

const BUDGETS = [{ prefix: 'assignee-pages-', maxGzipBytes: 60 * 1024 }];
const dir = new URL('../dist/assets/', import.meta.url);
const files = readdirSync(dir);
let failed = false;

for (const { prefix, maxGzipBytes } of BUDGETS) {
  const chunk = files.find((name) => name.startsWith(prefix) && name.endsWith('.js'));
  if (chunk === undefined) {
    console.error(`chunk budget: no ${prefix}*.js in dist/assets`);
    failed = true;
    continue;
  }
  const size = gzipSync(readFileSync(new URL(chunk, dir))).length;
  const line = `${chunk}: ${(size / 1024).toFixed(1)} KB gzip (budget ${String(maxGzipBytes / 1024)} KB)`;
  if (size > maxGzipBytes) {
    console.error(`chunk budget exceeded: ${line}`);
    failed = true;
  } else {
    console.log(`chunk budget ok: ${line}`);
  }
}

if (failed) {
  process.exit(1);
}
