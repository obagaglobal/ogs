import type { Server } from 'node:http';
import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { readinessResponseSchema } from '@ogs/contracts';
import request from 'supertest';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { TypedConfigService } from '../../src/config/env.js';
import { createPrismaClient } from '../../src/database/prisma.factory.js';
import { PrismaService } from '../../src/database/prisma.service.js';
import { RedisService } from '../../src/redis/redis.service.js';
import { urls } from './support.js';

/** T11 — GET /api/v1/health/ready against real (and deliberately broken) dependencies. */
describe('GET /api/v1/health/ready (T11)', () => {
  let app: INestApplication | undefined;

  beforeAll(() => {
    // Must be set before AppModule is imported: ConfigModule validates at import time.
    process.env['DATABASE_URL'] = urls().app;
    process.env['REDIS_URL'] = urls().redis;
  });

  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  async function boot(
    redisOverride?: RedisService,
    prismaOverride?: Pick<PrismaService, 'client'>,
  ): Promise<Server> {
    const { AppModule } = await import('../../src/app.module.js');
    const { configureApp } = await import('../../src/app.factory.js');
    let builder = Test.createTestingModule({ imports: [AppModule] });
    if (redisOverride !== undefined) {
      builder = builder.overrideProvider(RedisService).useValue(redisOverride);
    }
    if (prismaOverride !== undefined) {
      builder = builder.overrideProvider(PrismaService).useValue(prismaOverride);
    }
    const moduleRef = await builder.compile();
    const nestApp = moduleRef.createNestApplication<NestExpressApplication>({ logger: false });
    configureApp(nestApp);
    await nestApp.init();
    app = nestApp;
    return nestApp.getHttpServer();
  }

  it('200 when PostgreSQL and Redis are both up', async () => {
    const response = await request(await boot())
      .get('/api/v1/health/ready')
      .expect(200);
    expect(readinessResponseSchema.parse(response.body)).toMatchObject({
      status: 'ready',
      checks: { database: 'up', redis: 'up' },
    });
    expect(response.headers['cache-control']).toBe('no-store');
  });

  it('503 naming Redis when Redis is unreachable, without leaking details', async () => {
    const unreachable = new RedisService({
      get: () => 'redis://:secret-password@127.0.0.1:1/0',
    } as unknown as TypedConfigService);
    const response = await request(await boot(unreachable))
      .get('/api/v1/health/ready')
      .expect(503);
    expect(readinessResponseSchema.parse(response.body)).toMatchObject({
      status: 'not_ready',
      checks: { database: 'up', redis: 'down' },
    });
    expect(JSON.stringify(response.body)).not.toContain('secret-password');
    await unreachable.onApplicationShutdown();
  });

  it('503 naming the database when PostgreSQL is unreachable', async () => {
    const client = createPrismaClient({
      connectionString: 'postgresql://ogs_app:secret-password@127.0.0.1:1/ogs_test',
      maxConnections: 1,
    });
    const response = await request(await boot(undefined, { client }))
      .get('/api/v1/health/ready')
      .expect(503);
    expect(readinessResponseSchema.parse(response.body)).toMatchObject({
      status: 'not_ready',
      checks: { database: 'down', redis: 'up' },
    });
    expect(JSON.stringify(response.body)).not.toContain('secret-password');
    await client.$disconnect();
  });
});
