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
  // Behind NGINX (Phase 15) set TRUST_PROXY_HOPS so req.ip is the client, not the proxy.
  const proxyHops = config.get('TRUST_PROXY_HOPS', { infer: true });
  if (proxyHops > 0) {
    app.set('trust proxy', proxyHops);
  }
  app.setGlobalPrefix(API_GLOBAL_PREFIX);
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: API_DEFAULT_VERSION });
  // credentials: the SPA sends the session cookie; only allow-listed origins may.
  app.enableCors({ origin: config.get('API_CORS_ORIGINS', { infer: true }), credentials: true });
  app.enableShutdownHooks();
}

export async function createApp(): Promise<INestApplication> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  configureApp(app);
  return app;
}
