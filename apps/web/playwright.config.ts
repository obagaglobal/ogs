import { defineConfig, devices } from '@playwright/test';

/**
 * Browser smoke test (Phase 3 plan §5, B5). Runs against the real stack:
 * built API + worker (`pnpm build` first), the Vite dev server, and the Docker
 * services from `pnpm infra:up` (PostgreSQL with `pnpm db:migrate` + `pnpm db:seed`,
 * Redis, Mailpit). Locally, servers that are already running are reused.
 *
 * Run from the repository root: `pnpm test:e2e`.
 */
const ci = process.env['CI'] === 'true';

export default defineConfig({
  testDir: './e2e',
  globalSetup: './e2e/global-setup.ts',
  fullyParallel: false,
  // One browser worker locally, so the full suite fits in a developer PC's
  // memory next to the API, worker and Vite. CI keeps Playwright's default.
  ...(ci ? {} : { workers: 1 }),
  forbidOnly: ci,
  retries: ci ? 1 : 0,
  timeout: 60_000,
  // Phase 6b screenshots: one baseline per platform. CI (Linux) is the
  // reference; missing baselines are written so they can be committed.
  snapshotPathTemplate: '{testDir}/__screenshots__/{testFilePath}/{arg}-{platform}{ext}',
  updateSnapshots: 'missing',
  expect: { toHaveScreenshot: { animations: 'disabled', caret: 'hide' } },
  reporter: ci ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      command: 'pnpm --filter @ogs/api start',
      url: 'http://127.0.0.1:3000/api/v1/health/ready',
      reuseExistingServer: !ci,
      timeout: 60_000,
    },
    {
      command: 'pnpm --filter @ogs/api start:worker',
      wait: { stdout: /Worker started/ },
      reuseExistingServer: !ci,
      timeout: 60_000,
    },
    {
      command: 'pnpm --filter @ogs/web dev',
      url: 'http://localhost:5173',
      reuseExistingServer: !ci,
      timeout: 60_000,
    },
  ],
});
