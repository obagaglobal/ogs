import { describe, expect, it } from 'vitest';
import { DEVELOPMENT_MFA_KEY, parseApiEnv } from './env.js';

const required = {
  DATABASE_URL: 'postgresql://ogs_app:pass@localhost:5432/ogs',
  REDIS_URL: 'redis://:pass@localhost:6379/0',
  MFA_ENCRYPTION_KEYS: 'k2:BwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwc=',
  S3_ACCESS_KEY_ID: 'minio-user',
  S3_SECRET_ACCESS_KEY: 'minio-password',
};

describe('parseApiEnv', () => {
  it('applies defaults when only the required variables are set', () => {
    expect(parseApiEnv(required)).toEqual({
      ...required,
      NODE_ENV: 'development',
      API_HOST: '127.0.0.1',
      API_PORT: 3000,
      API_CORS_ORIGINS: ['http://localhost:5173'],
      DATABASE_POOL_MAX: 10,
      QUEUE_PREFIX: 'ogs',
      OUTBOX_POLL_INTERVAL_MS: 1000,
      OUTBOX_BATCH_SIZE: 100,
      APP_PUBLIC_URL: 'http://localhost:5173',
      SESSION_COOKIE_SECURE: false,
      TRUST_PROXY_HOPS: 0,
      SMTP_URL: 'smtp://127.0.0.1:1025',
      EMAIL_FROM: 'OGS <no-reply@ogs.test>',
      S3_ENDPOINT: 'http://127.0.0.1:8333',
      S3_REGION: 'us-east-1',
      S3_BUCKET: 'ogs-files',
      S3_FORCE_PATH_STYLE: true,
    });
  });

  it('requires DATABASE_URL and REDIS_URL', () => {
    expect(() => parseApiEnv({})).toThrow(/DATABASE_URL[\s\S]*REDIS_URL/);
  });

  it('coerces the port and splits CORS origins', () => {
    const env = parseApiEnv({
      ...required,
      API_PORT: '4000',
      API_CORS_ORIGINS: 'http://localhost:5173, https://app.example.com',
    });
    expect(env.API_PORT).toBe(4000);
    expect(env.API_CORS_ORIGINS).toEqual(['http://localhost:5173', 'https://app.example.com']);
  });

  it('rejects an out-of-range port', () => {
    expect(() => parseApiEnv({ ...required, API_PORT: '70000' })).toThrow(/API_PORT/);
  });

  it('rejects a non-PostgreSQL DATABASE_URL', () => {
    expect(() => parseApiEnv({ ...required, DATABASE_URL: 'mysql://localhost/db' })).toThrow(
      /DATABASE_URL/,
    );
  });

  it('rejects an unsafe queue prefix', () => {
    expect(() => parseApiEnv({ ...required, QUEUE_PREFIX: 'Bad Prefix!' })).toThrow(/QUEUE_PREFIX/);
  });

  it('secures the session cookie by default in production and refuses to disable it', () => {
    const production = {
      ...required,
      NODE_ENV: 'production',
      APP_PUBLIC_URL: 'https://ogs.example',
    };
    expect(parseApiEnv(production).SESSION_COOKIE_SECURE).toBe(true);
    expect(() => parseApiEnv({ ...production, SESSION_COOKIE_SECURE: 'false' })).toThrow(
      /SESSION_COOKIE_SECURE/,
    );
    expect(() => parseApiEnv({ ...production, APP_PUBLIC_URL: 'http://ogs.example' })).toThrow(
      /APP_PUBLIC_URL/,
    );
  });

  it('refuses the committed development MFA key in production', () => {
    const production = {
      ...required,
      NODE_ENV: 'production',
      APP_PUBLIC_URL: 'https://ogs.example',
      MFA_ENCRYPTION_KEYS: `k1:${DEVELOPMENT_MFA_KEY}`,
    };
    expect(() => parseApiEnv(production)).toThrow(/MFA_ENCRYPTION_KEYS/);
    expect(() => parseApiEnv({ ...required, MFA_ENCRYPTION_KEYS: 'k1:short' })).toThrow(
      /MFA_ENCRYPTION_KEYS/,
    );
  });

  it('never echoes values in the error message', () => {
    const secret = 'postgresql-but-malformed-secret-value';
    try {
      parseApiEnv({ ...required, DATABASE_URL: secret });
      expect.unreachable();
    } catch (error) {
      expect(String(error)).not.toContain(secret);
    }
  });
});
