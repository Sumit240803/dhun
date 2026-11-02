// Rate limiting.
//
// A fixed-window counter behind a store interface. The in-memory store is
// correct for a single instance, which is what runs today; the Redis store slots
// in behind the same interface the moment there is more than one, and nothing
// upstream changes.
//
// Limits are layered deliberately. An IP limit stops a scripted flood; a device
// limit stops one handset farming accounts behind a shared NAT; a user limit
// stops a stolen token being drained. Each catches what the others miss.

import { NextFunction, Request, Response } from 'express';
import { config } from '../config/index.js';
import { RateLimitedError } from '../infra/errors.js';
import { recordEvent } from '../infra/eventLog.js';
import { logger } from '../infra/logger.js';

export interface RateLimitHit {
  count: number;
  resetAt: number;
}

export interface RateLimitStore {
  hit(key: string, windowMs: number): Promise<RateLimitHit>;
  /** Give a hit back — used when only failed attempts should count. */
  release(key: string): Promise<void>;
  /** Drop every counter. Tests only — production windows expire on their own. */
  clear?(): Promise<void>;
}

class MemoryStore implements RateLimitStore {
  private buckets = new Map<string, RateLimitHit>();

  constructor() {
    // Sweeps expired buckets so a long-running process cannot grow unbounded on
    // one-off keys. unref() so it never holds the process open.
    const timer = setInterval(() => {
      const now = Date.now();
      for (const [key, bucket] of this.buckets) {
        if (bucket.resetAt <= now) this.buckets.delete(key);
      }
    }, 60_000);
    timer.unref?.();
  }

  async hit(key: string, windowMs: number): Promise<RateLimitHit> {
    const now = Date.now();
    const existing = this.buckets.get(key);

    if (!existing || existing.resetAt <= now) {
      const fresh = { count: 1, resetAt: now + windowMs };
      this.buckets.set(key, fresh);
      return fresh;
    }

    existing.count += 1;
    return existing;
  }

  async release(key: string): Promise<void> {
    const bucket = this.buckets.get(key);
    if (bucket && bucket.count > 0) bucket.count -= 1;
  }

  async clear(): Promise<void> {
    this.buckets.clear();
  }
}

/** The slice of ioredis this store uses, so a test can hand it any client. */
export interface RedisLike {
  eval(script: string, numKeys: number, ...args: (string | number)[]): Promise<unknown>;
  scan(
    cursor: string,
    matchToken: 'MATCH',
    pattern: string,
    countToken: 'COUNT',
    count: number,
  ): Promise<[string, string[]]>;
  del(...keys: string[]): Promise<number>;
}

const HIT = `
local c = redis.call('INCR', KEYS[1])
if c == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[1]) end
local t = redis.call('PTTL', KEYS[1])
if t < 0 then
  redis.call('PEXPIRE', KEYS[1], ARGV[1])
  t = tonumber(ARGV[1])
end
return {c, t}`;

const RELEASE = `
local c = tonumber(redis.call('GET', KEYS[1]) or '0')
if c > 0 then redis.call('DECR', KEYS[1]) end
return c`;

/**
 * Counters in Redis (build-plan M21 slice 6), so a limit holds across every
 * API instance behind the load balancer and survives a deploy. With the
 * in-memory store, two instances double every limit and a restart forgives
 * every attacker.
 *
 * One atomic script per hit: INCR and the expiry together, so a crash between
 * them can never leave a counter that never expires (a permanent lockout).
 *
 * FAILS OPEN to a per-process memory store when Redis does not answer. A
 * limiter that turns a Redis blip into a total API outage does more harm than
 * a minute of per-instance limits — and readiness already takes an instance
 * with no Redis out of rotation.
 */
export class RedisRateLimitStore implements RateLimitStore {
  private readonly fallback = new MemoryStore();
  private lastWarnAt = 0;

  constructor(
    private readonly client: RedisLike,
    private readonly prefix = 'rl:',
  ) {}

  private warn(err: unknown): void {
    if (Date.now() - this.lastWarnAt < 60_000) return;
    this.lastWarnAt = Date.now();
    logger.warn('rate limit store unreachable; limiting per process', {
      reason: err instanceof Error ? err.message : String(err),
    });
  }

  async hit(key: string, windowMs: number): Promise<RateLimitHit> {
    try {
      const [count, ttl] = (await this.client.eval(HIT, 1, this.prefix + key, windowMs)) as [number, number];
      return { count: Number(count), resetAt: Date.now() + Number(ttl) };
    } catch (err) {
      this.warn(err);
      return this.fallback.hit(key, windowMs);
    }
  }

  async release(key: string): Promise<void> {
    try {
      await this.client.eval(RELEASE, 1, this.prefix + key);
    } catch (err) {
      this.warn(err);
      await this.fallback.release(key);
    }
  }

  /** Tests only: drops this store's keys, by prefix, never the whole database. */
  async clear(): Promise<void> {
    let cursor = '0';
    do {
      const [next, keys] = await this.client.scan(cursor, 'MATCH', `${this.prefix}*`, 'COUNT', 500);
      if (keys.length) await this.client.del(...keys);
      cursor = next;
    } while (cursor !== '0');
    await this.fallback.clear();
  }
}

let store: RateLimitStore = new MemoryStore();

/** Chosen at startup from RATE_LIMIT_STORE (server.ts). */
export function setRateLimitStore(next: RateLimitStore): void {
  store = next;
}

/**
 * Clears every counter.
 *
 * For tests only. A suite makes hundreds of calls from one address in seconds,
 * which is exactly the traffic the global limit exists to stop — so the limits
 * are reset between cases rather than loosened to accommodate the test runner.
 */
export async function resetRateLimits(): Promise<void> {
  await store.clear?.();
}

export type RateLimitSubject = 'ip' | 'user' | 'device' | 'ip+user';

export interface RateLimitOptions {
  /** Namespace, so two rules never share a bucket. */
  scope: string;
  limit: number;
  windowMs: number;
  by?: RateLimitSubject;
  /** Pull an extra discriminator out of the request — e.g. the phone number on OTP. */
  keyFrom?: (req: Request) => string | undefined;
  /** Skip counting successful requests; only failures burn budget. */
  failuresOnly?: boolean;
}

function subjectFor(req: Request, by: RateLimitSubject): string {
  // req.ip is only trustworthy because app.set('trust proxy') is configured.
  const ip = req.ip ?? 'unknown-ip';
  switch (by) {
    case 'user':
      return req.userId ?? `anon:${ip}`;
    case 'device':
      return (
        (typeof req.body?.device?.deviceId === 'string' ? req.body.device.deviceId : undefined) ??
        req.header('X-Device-Id') ??
        `noDevice:${ip}`
      );
    case 'ip+user':
      return `${ip}|${req.userId ?? 'anon'}`;
    case 'ip':
    default:
      return ip;
  }
}

export function rateLimit(options: RateLimitOptions) {
  const { scope, limit, windowMs, by = 'ip', keyFrom, failuresOnly = false } = options;

  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const extra = keyFrom?.(req);
      const key = `${scope}:${subjectFor(req, by)}${extra ? `:${extra}` : ''}`;

      const { count, resetAt } = await store.hit(key, windowMs);
      const remaining = Math.max(0, limit - count);
      const retryAfter = Math.max(1, Math.ceil((resetAt - Date.now()) / 1000));

      res.setHeader('RateLimit-Limit', String(limit));
      res.setHeader('RateLimit-Remaining', String(remaining));
      res.setHeader('RateLimit-Reset', String(retryAfter));

      if (count > limit) {
        res.setHeader('Retry-After', String(retryAfter));
        logger.warn('rate limited', { scope, subject: by, count, limit });
        // Only the first overrun in a window is kept: a client hammering an
        // endpoint would otherwise fill the log with the limiter's own output.
        if (count === limit + 1) {
          recordEvent({
            level: 'warn',
            kind: 'security',
            event: 'security.rate_limited',
            code: 'RATE_LIMITED',
            message: `${scope} limit of ${limit} exceeded`,
            meta: { scope, subject: by, limit, window_ms: windowMs },
          });
        }
        throw new RateLimitedError(retryAfter, scope);
      }

      // Give the hit back when the request turns out to have succeeded, so a
      // legitimate user signing in repeatedly never exhausts a budget that exists
      // to stop guessing.
      if (failuresOnly) {
        res.on('finish', () => {
          if (res.statusCode < 400) void store.release(key).catch(() => undefined);
        });
      }

      next();
    } catch (err) {
      next(err);
    }
  };
}

/**
 * Baseline ceiling for every request.
 *
 * Generous on purpose — it is a flood stop, not a business rule. The tight limits
 * live on the endpoints that can actually be abused.
 */
export const globalRateLimit = () =>
  rateLimit({ scope: 'global', limit: config.globalRateLimitPerMinute, windowMs: 60_000, by: 'ip' });
