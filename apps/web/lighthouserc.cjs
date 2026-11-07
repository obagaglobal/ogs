/**
 * Lighthouse CI (Phase 6b): the public catalogue on a mid-range phone
 * (Lighthouse's default mobile emulation: Moto G Power, slow 4G, 4× CPU).
 * Targets: performance ≥ 85, accessibility ≥ 95. Needs the API on :3000 and a
 * production build (`pnpm --filter @ogs/web build`); `vite preview` serves it.
 *
 * Run: `pnpm --filter @ogs/web lighthouse`. Reports: apps/web/lighthouse-report.
 */
module.exports = {
  ci: {
    collect: {
      url: ['http://localhost:4173/services'],
      startServerCommand: 'pnpm exec vite preview',
      startServerReadyPattern: 'Local',
      numberOfRuns: 3,
      settings: {
        chromeFlags: '--headless=new --no-sandbox',
      },
    },
    assert: {
      assertions: {
        'categories:performance': ['error', { minScore: 0.85, aggregationMethod: 'median-run' }],
        'categories:accessibility': ['error', { minScore: 0.95, aggregationMethod: 'median-run' }],
      },
    },
    upload: {
      target: 'filesystem',
      outputDir: './lighthouse-report',
    },
  },
};
