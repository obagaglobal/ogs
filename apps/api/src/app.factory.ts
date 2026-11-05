import { VersioningType, type INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { API_DEFAULT_VERSION, API_GLOBAL_PREFIX } from './app.constants.js';
import { AppModule } from './app.module.js';
import type { TypedConfigService } from './config/env.js';
import { ConfigService } from '@nestjs/config';

/**
 * Applies application-wide HTTP configuration. Shared by `main.ts` and the
 * end-to-end tests so both exercise the same setup.
 */
export function configureApp(app: NestExpressApplication): void {
  const config = app.get<TypedConfigService>(ConfigService);

  app.disable('x-powered-by');
  app.setGlobalPrefix(API_GLOBAL_PREFIX);
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: API_DEFAULT_VERSION });
  app.enableCors({ origin: config.get('API_CORS_ORIGINS', { infer: true }) });
  app.enableShutdownHooks();
}

export async function createApp(): Promise<INestApplication> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  configureApp(app);
  return app;
}
