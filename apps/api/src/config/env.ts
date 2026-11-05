import { ConfigService } from '@nestjs/config';
import { parseApiEnv, type ApiEnv } from '@ogs/contracts';

/** Passed to `ConfigModule.forRoot({ validate })`: fails fast on invalid env. */
export function validateEnv(raw: Record<string, unknown>): ApiEnv {
  return parseApiEnv(raw);
}

/** Strongly typed ConfigService: `config.get('API_PORT', { infer: true })` is a number. */
export type TypedConfigService = ConfigService<ApiEnv, true>;
