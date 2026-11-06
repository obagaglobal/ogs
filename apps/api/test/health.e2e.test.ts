import type { Server } from 'node:http';
import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { healthCheckResponseSchema } from '@ogs/contracts';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { configureApp } from '../src/app.factory.js';
import { AppModule } from '../src/app.module.js';
import { AuthzSyncService } from '../src/authz/authz-sync.service.js';

describe('GET /api/v1/health (e2e)', () => {
  let app: INestApplication;
  let server: Server;

  beforeAll(async () => {
    // No database in unit tests: skip the start-up catalogue sync (covered by integration tests).
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(AuthzSyncService)
      .useValue({ onApplicationBootstrap: () => undefined })
      .compile();
    const nestApp = moduleRef.createNestApplication<NestExpressApplication>({ logger: false });
    configureApp(nestApp);
    await nestApp.init();
    app = nestApp;
    server = nestApp.getHttpServer();
  });

  afterAll(async () => {
    await app.close();
  });

  it('responds 200 with a valid health payload without touching PostgreSQL or Redis', async () => {
    const response = await request(server)
      .get('/api/v1/health')
      .expect('Content-Type', /json/)
      .expect(200);

    expect(healthCheckResponseSchema.safeParse(response.body).success).toBe(true);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.headers['x-powered-by']).toBeUndefined();
  });

  it('is only served under /api/v1', async () => {
    await request(server).get('/health').expect(404);
    await request(server).get('/api/health').expect(404);
    await request(server).get('/v1/health').expect(404);
  });
});
