import { inject } from 'vitest';

// Runs before every integration test file (vitest setupFiles). Process env wins
// over apps/api/.env in ConfigModule, so the app under test always talks to the
// test database, a run-unique Redis prefix and Mailpit.
const urls = inject('integration');

Object.assign(process.env, {
  NODE_ENV: 'test',
  DATABASE_URL: urls.app,
  REDIS_URL: urls.redis,
  QUEUE_PREFIX: urls.queuePrefix,
  SMTP_URL: urls.smtp,
  EMAIL_FROM: 'OGS Tests <no-reply@ogs.test>',
  APP_PUBLIC_URL: 'http://localhost:5173',
  // Tests vary X-Forwarded-For per client so per-IP rate limits apply per test client.
  TRUST_PROXY_HOPS: '1',
  OUTBOX_POLL_INTERVAL_MS: '100',
});
