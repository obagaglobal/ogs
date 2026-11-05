import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { API_DEFAULT_VERSION, API_GLOBAL_PREFIX } from './app.constants.js';
import { createApp } from './app.factory.js';
import type { TypedConfigService } from './config/env.js';

async function bootstrap(): Promise<void> {
  const app = await createApp();
  const config = app.get<TypedConfigService>(ConfigService);
  const host = config.get('API_HOST', { infer: true });
  const port = config.get('API_PORT', { infer: true });

  await app.listen(port, host);
  Logger.log(
    `API listening on http://${host}:${String(port)}/${API_GLOBAL_PREFIX}/v${API_DEFAULT_VERSION}`,
    'Bootstrap',
  );
}

await bootstrap();
