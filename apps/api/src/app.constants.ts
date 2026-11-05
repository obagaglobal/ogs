import { readFileSync } from 'node:fs';

interface PackageManifest {
  readonly version: string;
}

// Resolves to apps/api/package.json from both src/ (tests) and dist/ (runtime).
const manifest = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
) as PackageManifest;

export const APP_SERVICE_NAME = 'ogs-api';
export const APP_VERSION: string = manifest.version;
export const API_GLOBAL_PREFIX = 'api';
