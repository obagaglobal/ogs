import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Redis } from 'ioredis';
import { withTimeout } from '../common/with-timeout.js';
import type { TypedConfigService } from '../config/env.js';
import { RedisService } from '../redis/redis.service.js';
import { sha256Hex } from '../common/secrets.js';

export interface RateLimitRule {
  readonly limit: number;
  readonly windowSeconds: number;
}

/** Phase 3 plan §2.3. Keys are hashed, so no email or IP is stored in Redis in clear. */
export const RATE_LIMITS = {
  loginPerIp: { limit: 30, windowSeconds: 15 * 60 },
  loginPerAccount: { limit: 10, windowSeconds: 15 * 60 },
  registerPerIp: { limit: 10, windowSeconds: 60 * 60 },
  forgotPerIp: { limit: 10, windowSeconds: 60 * 60 },
  forgotPerAccount: { limit: 3, windowSeconds: 60 * 60 },
  tokenPerIp: { limit: 30, windowSeconds: 60 * 60 },
  resendPerAccount: { limit: 5, windowSeconds: 60 * 60 },
  /** TOTP and recovery-code attempts (a 6-digit code must not be guessable by volume). */
  mfaPerAccount: { limit: 10, windowSeconds: 15 * 60 },
  /** Public catalogue reads (Phase 6, E8): generous for people, a ceiling for scrapers. */
  cataloguePerIp: { limit: 240, windowSeconds: 60 },
  /** New support tickets per person (Phase 8 plan §2.3, review §11 ticket spam). */
  ticketsPerUser: { limit: 10, windowSeconds: 60 * 60 },
  /** Ticket replies per person. */
  ticketCommentsPerUser: { limit: 60, windowSeconds: 60 * 60 },
  /** Field-work commands per assignee (Phase 9 plan §2.6): status, notes, reports. */
  jobCommandsPerUser: { limit: 120, windowSeconds: 60 * 60 },
  /** Photo uploads per job (Phase 9 plan §2.6). */
  jobPhotosPerJob: { limit: 60, windowSeconds: 60 * 60 },
} as const satisfies Record<string, RateLimitRule>;

export type RateLimitName = keyof typeof RATE_LIMITS;

export class RateLimitExceeded extends Error {
  override readonly name = 'RateLimitExceeded';
  constructor(readonly retryAfterSeconds: number) {
    super('rate limit exceeded');
  }
}

/** Redis unreachable: authentication endpoints fail closed (plan §2.3). */
export class RateLimiterUnavailable extends Error {
  override readonly name = 'RateLimiterUnavailable';
}

const REDIS_TIMEOUT_MS = 1_000;

/**
 * Fixed-window counters in Redis (INCR + EXPIRE in one MULTI). Simple, cheap and
 * good enough for abuse control; precise fairness is not a goal.
 */
@Injectable()
export class RateLimiter implements OnModuleInit {
  private redis: Redis | undefined;
  private readonly prefix: string;
  /** Milliseconds since the epoch. Replaceable so tests can pin the fixed window. */
  private clock: () => number = Date.now;

  constructor(
    private readonly redisService: RedisService,
    @Inject(ConfigService) config: TypedConfigService,
  ) {
    this.prefix = `${config.get('QUEUE_PREFIX', { infer: true })}:rl`;
  }

  onModuleInit(): void {
    this.redis = this.redisService.createAppConnection('rate-limit');
  }

  /**
   * Test seam: run the limiter on a controlled clock (e.g. a fixed instant, so a
   * burst of requests cannot straddle a window boundary). Returns a restore function.
   */
  useClock(clock: () => number): () => void {
    this.clock = clock;
    return () => {
      this.clock = Date.now;
    };
  }

  /** Counts one attempt; throws RateLimitExceeded when over the limit. */
  async consume(name: RateLimitName, subject: string): Promise<void> {
    const rule: RateLimitRule = RATE_LIMITS[name];
    const now = this.clock();
    const window = Math.floor(now / 1000 / rule.windowSeconds);
    const key = `${this.prefix}:${name}:${sha256Hex(subject)}:${String(window)}`;
    const redis = this.connection();

    let count: number;
    try {
      const results = await withTimeout(
        redis.multi().incr(key).expire(key, rule.windowSeconds).exec(),
        REDIS_TIMEOUT_MS,
      );
      const [failure, value] = results?.[0] ?? [new Error('no reply'), null];
      if (failure !== null || typeof value !== 'number') {
        throw new Error('unexpected Redis reply');
      }
      count = value;
    } catch {
      throw new RateLimiterUnavailable('rate limiter unavailable');
    }

    if (count > rule.limit) {
      const windowEnds = (window + 1) * rule.windowSeconds;
      throw new RateLimitExceeded(Math.max(1, windowEnds - Math.floor(now / 1000)));
    }
  }

  private connection(): Redis {
    this.redis ??= this.redisService.createAppConnection('rate-limit');
    return this.redis;
  }
}
