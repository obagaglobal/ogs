import { randomUUID } from 'node:crypto';
import { Injectable, type OnModuleInit } from '@nestjs/common';
import type { Redis } from 'ioredis';
import { z } from 'zod';
import { withTimeout } from '../common/with-timeout.js';
import { newSecret, sha256Hex } from '../common/secrets.js';
import { RedisService } from '../redis/redis.service.js';

/** Decision P3-6. */
export const SESSION_IDLE_TIMEOUT_MS = 30 * 60 * 1000;
export const SESSION_ABSOLUTE_TIMEOUT_MS = 12 * 60 * 60 * 1000;
/** lastSeenAt / idle TTL are refreshed at most this often, to keep Redis writes cheap. */
const TOUCH_INTERVAL_MS = 60 * 1000;
const REDIS_TIMEOUT_MS = 1_000;

const sessionRecordSchema = z.object({
  /** Public id, safe to show and to use in URLs (never the cookie secret). */
  id: z.uuid(),
  userId: z.uuid(),
  createdAt: z.number(),
  lastSeenAt: z.number(),
  absoluteExpiresAt: z.number(),
  ip: z.string().nullable(),
  userAgent: z.string().nullable(),
  csrfToken: z.string(),
  /** 0 = password only. Raised by MFA in Phase 3B. */
  mfaLevel: z.number().int().min(0),
  /** Password accepted, second factor still owed: only MFA routes are reachable. */
  mfaPending: z.boolean().default(false),
  /** Last successful TOTP check (ms): drives step-up for sensitive actions. */
  stepUpAt: z.number().nullable(),
  /** Active platform elevation (review §6.3): cross-tenant access for a reason, briefly. */
  elevation: z
    .object({
      id: z.uuid(),
      reason: z.string(),
      tenantId: z.uuid().nullable(),
      expiresAt: z.number(),
    })
    .nullable()
    .default(null),
});

export type SessionRecord = z.infer<typeof sessionRecordSchema>;

export type SessionChanges = Partial<
  Pick<SessionRecord, 'mfaLevel' | 'mfaPending' | 'stepUpAt' | 'elevation'>
>;

export interface SessionMeta {
  readonly ip: string | null;
  readonly userAgent: string | null;
}

export interface NewSession {
  /** The cookie value. Shown once, never stored. */
  readonly token: string;
  readonly record: SessionRecord;
}

export class SessionStoreUnavailable extends Error {
  override readonly name = 'SessionStoreUnavailable';
}

/**
 * Server-side sessions in Redis (ADR-011, Phase 3 plan §2.2).
 *
 *   {prefix}:sess:{sha256(token)}   JSON record, TTL = time left before idle or absolute expiry
 *   {prefix}:user-sess:{userId}     set of token hashes, for "my sessions" and revoke-all
 *
 * Only token hashes are stored, so a Redis dump does not contain usable cookies.
 */
@Injectable()
export class SessionStore implements OnModuleInit {
  private redis: Redis | undefined;

  constructor(private readonly redisService: RedisService) {}

  onModuleInit(): void {
    this.redis = this.redisService.createAppConnection('sessions');
  }

  async create(
    userId: string,
    meta: SessionMeta,
    options: { mfaPending?: boolean } = {},
  ): Promise<NewSession> {
    const now = Date.now();
    const record: SessionRecord = {
      id: randomUUID(),
      userId,
      createdAt: now,
      lastSeenAt: now,
      absoluteExpiresAt: now + SESSION_ABSOLUTE_TIMEOUT_MS,
      ip: meta.ip,
      userAgent: meta.userAgent === null ? null : meta.userAgent.slice(0, 500),
      csrfToken: newSecret(),
      mfaLevel: 0,
      mfaPending: options.mfaPending ?? false,
      stepUpAt: null,
      elevation: null,
    };
    const token = newSecret();
    await this.write(sha256Hex(token), record, true);
    return { token, record };
  }

  /** The live session for a cookie value, refreshing its idle timer; undefined when absent or expired. */
  async get(token: string): Promise<SessionRecord | undefined> {
    const hash = sha256Hex(token);
    const raw = await this.call((redis) => redis.get(this.sessionKey(hash)));
    if (raw === null) {
      return undefined;
    }
    const parsed = sessionRecordSchema.safeParse(JSON.parse(raw));
    if (!parsed.success) {
      await this.remove(hash, undefined);
      return undefined;
    }
    const record = parsed.data;
    const now = Date.now();
    if (now >= record.absoluteExpiresAt || now - record.lastSeenAt >= SESSION_IDLE_TIMEOUT_MS) {
      await this.remove(hash, record.userId);
      return undefined;
    }
    if (now - record.lastSeenAt >= TOUCH_INTERVAL_MS) {
      const touched = { ...record, lastSeenAt: now };
      await this.write(hash, touched, false);
      return touched;
    }
    return record;
  }

  /**
   * Issues a new cookie value for the same session and kills the old one
   * (session fixation defence: on login, MFA and password change).
   */
  async rotate(token: string, changes: SessionChanges = {}) {
    const current = await this.get(token);
    if (current === undefined) {
      return undefined;
    }
    const record: SessionRecord = { ...current, ...changes, csrfToken: newSecret() };
    const next = newSecret();
    await this.write(sha256Hex(next), record, true);
    await this.remove(sha256Hex(token), current.userId);
    return { token: next, record };
  }

  /** Changes a live session in place (same cookie). Returns the updated record. */
  async update(token: string, changes: SessionChanges): Promise<SessionRecord | undefined> {
    const current = await this.get(token);
    if (current === undefined) {
      return undefined;
    }
    const record: SessionRecord = { ...current, ...changes };
    await this.write(sha256Hex(token), record, false);
    return record;
  }

  async revoke(token: string): Promise<void> {
    const record = await this.get(token);
    await this.remove(sha256Hex(token), record?.userId);
  }

  async list(userId: string): Promise<(SessionRecord & { hash: string })[]> {
    const hashes = await this.call((redis) => redis.smembers(this.userKey(userId)));
    if (hashes.length === 0) {
      return [];
    }
    const values = await this.call((redis) => redis.mget(hashes.map((h) => this.sessionKey(h))));
    const live: (SessionRecord & { hash: string })[] = [];
    const stale: string[] = [];
    const now = Date.now();
    values.forEach((raw, index) => {
      const hash = hashes[index];
      if (hash === undefined) {
        return;
      }
      const parsed = raw === null ? undefined : sessionRecordSchema.safeParse(JSON.parse(raw));
      if (
        parsed?.success === true &&
        parsed.data.userId === userId &&
        now < parsed.data.absoluteExpiresAt &&
        now - parsed.data.lastSeenAt < SESSION_IDLE_TIMEOUT_MS
      ) {
        live.push({ ...parsed.data, hash });
      } else {
        stale.push(hash);
      }
    });
    if (stale.length > 0) {
      await this.call((redis) => redis.srem(this.userKey(userId), ...stale));
    }
    return live.sort((a, b) => b.lastSeenAt - a.lastSeenAt);
  }

  /** Revokes one of the user's sessions by its public id. Returns false if not theirs. */
  async revokeById(userId: string, sessionId: string): Promise<boolean> {
    const target = (await this.list(userId)).find((session) => session.id === sessionId);
    if (target === undefined) {
      return false;
    }
    await this.remove(target.hash, userId);
    return true;
  }

  /** Revokes every session of the user, optionally keeping the one with this cookie value. */
  async revokeAll(userId: string, exceptToken?: string): Promise<number> {
    const keep = exceptToken === undefined ? undefined : sha256Hex(exceptToken);
    const sessions = await this.list(userId);
    let revoked = 0;
    for (const session of sessions) {
      if (session.hash !== keep) {
        await this.remove(session.hash, userId);
        revoked += 1;
      }
    }
    return revoked;
  }

  private async write(hash: string, record: SessionRecord, index: boolean): Promise<void> {
    const ttl = Math.min(SESSION_IDLE_TIMEOUT_MS, record.absoluteExpiresAt - Date.now());
    if (ttl <= 0) {
      return;
    }
    await this.call(async (redis) => {
      const tx = redis.multi().set(this.sessionKey(hash), JSON.stringify(record), 'PX', ttl);
      if (index) {
        tx.sadd(this.userKey(record.userId), hash).pexpire(
          this.userKey(record.userId),
          SESSION_ABSOLUTE_TIMEOUT_MS,
        );
      }
      await tx.exec();
    });
  }

  private async remove(hash: string, userId: string | undefined): Promise<void> {
    await this.call(async (redis) => {
      const tx = redis.multi().del(this.sessionKey(hash));
      if (userId !== undefined) {
        tx.srem(this.userKey(userId), hash);
      }
      await tx.exec();
    });
  }

  private async call<T>(work: (redis: Redis) => Promise<T>): Promise<T> {
    this.redis ??= this.redisService.createAppConnection('sessions');
    try {
      return await withTimeout(work(this.redis), REDIS_TIMEOUT_MS);
    } catch (error) {
      throw new SessionStoreUnavailable(error instanceof Error ? error.name : 'unknown');
    }
  }

  private sessionKey(hash: string): string {
    return `${this.redisService.keyPrefix}:sess:${hash}`;
  }

  private userKey(userId: string): string {
    return `${this.redisService.keyPrefix}:user-sess:${userId}`;
  }
}
