import { randomUUID } from "node:crypto";
import type { Redis } from "ioredis";

export type ReserveResult =
  | { ok: true; remaining: number; reservationId: string }
  | { ok: false; reason: "interval" | "budget" | "cooldown"; retryAtMs: number; remaining: number };

export interface RateLimiter {
  tryReserve(now?: number): Promise<ReserveResult>;
  remaining(now?: number): Promise<number>;
  penalize(retryAfterMs: number, now?: number): Promise<void>;
}

type Options = {
  budget: number;
  intervalMs: number;
  windowMs: number;
  now?: () => number;
};

/**
 * In-process atomic limiter. Concurrent tryReserve calls are serialized so the
 * budget cannot be exceeded by a race inside one process. Redis limiter uses
 * the same rules in a Lua script.
 */
export class InMemoryRateLimiter implements RateLimiter {
  private chain: Promise<unknown> = Promise.resolve();
  private lastAt = 0;
  private stamps: number[] = [];
  private cooldownUntil = 0;

  constructor(private readonly options: Options) {}

  tryReserve(now = this.options.now?.() ?? Date.now()): Promise<ReserveResult> {
    const run = this.chain.then(() => this.reserveSync(now));
    this.chain = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  async remaining(now = this.options.now?.() ?? Date.now()): Promise<number> {
    this.stamps = this.stamps.filter((stamp) => now - stamp < this.options.windowMs);
    return Math.max(0, this.options.budget - this.stamps.length);
  }

  async penalize(retryAfterMs: number, now = this.options.now?.() ?? Date.now()): Promise<void> {
    this.cooldownUntil = Math.max(this.cooldownUntil, now + retryAfterMs);
  }

  private reserveSync(now: number): ReserveResult {
    if (this.cooldownUntil > now) {
      return { ok: false, reason: "cooldown", retryAtMs: this.cooldownUntil - now, remaining: 0 };
    }
    if (this.lastAt && now - this.lastAt < this.options.intervalMs) {
      return { ok: false, reason: "interval", retryAtMs: this.options.intervalMs - (now - this.lastAt), remaining: 0 };
    }
    this.stamps = this.stamps.filter((stamp) => now - stamp < this.options.windowMs);
    if (this.stamps.length >= this.options.budget) {
      const oldest = this.stamps[0] ?? now;
      return {
        ok: false,
        reason: "budget",
        retryAtMs: Math.max(1, oldest + this.options.windowMs - now),
        remaining: 0,
      };
    }
    this.lastAt = now;
    const reservationId = randomUUID();
    this.stamps.push(now);
    return { ok: true, remaining: this.options.budget - this.stamps.length, reservationId };
  }
}

const RESERVE_LUA = `
local intervalKey = KEYS[1]
local usageKey = KEYS[2]
local cooldownKey = KEYS[3]
local now = tonumber(ARGV[1])
local interval = tonumber(ARGV[2])
local budget = tonumber(ARGV[3])
local windowMs = tonumber(ARGV[4])
local member = ARGV[5]
local cooldown = redis.call('PTTL', cooldownKey)
if cooldown and cooldown > 0 then
  return {0, cooldown, 'cooldown', 0}
end
local reserved = redis.call('SET', intervalKey, tostring(now), 'PX', interval, 'NX')
if not reserved then
  local wait = redis.call('PTTL', intervalKey)
  if (not wait) or wait < 1 then wait = interval end
  return {0, wait, 'interval', 0}
end
redis.call('ZREMRANGEBYSCORE', usageKey, '-inf', now - windowMs)
local count = redis.call('ZCARD', usageKey)
if count >= budget then
  redis.call('DEL', intervalKey)
  local oldest = redis.call('ZRANGE', usageKey, 0, 0, 'WITHSCORES')
  local retry = windowMs
  if oldest[2] then
    retry = tonumber(oldest[2]) + windowMs - now
    if retry < 1 then retry = 1 end
  end
  return {0, retry, 'budget', 0}
end
redis.call('ZADD', usageKey, now, member)
redis.call('PEXPIRE', usageKey, windowMs + 86400000)
return {1, 0, 'ok', budget - count - 1}
`;

export class RedisRateLimiter implements RateLimiter {
  constructor(
    private readonly redis: Redis,
    private readonly options: Options,
    private readonly prefix = "iti:comtrade",
  ) {}

  async tryReserve(now = Date.now()): Promise<ReserveResult> {
    const member = randomUUID();
    const raw = (await this.redis.eval(
      RESERVE_LUA,
      3,
      `${this.prefix}:interval`,
      `${this.prefix}:usage`,
      `${this.prefix}:cooldown`,
      String(now),
      String(this.options.intervalMs),
      String(this.options.budget),
      String(this.options.windowMs),
      member,
    )) as [number, number, string, number];
    const [ok, wait, reason, remaining] = raw;
    if (Number(ok) === 1) return { ok: true, remaining: Number(remaining), reservationId: member };
    const why = reason === "budget" || reason === "cooldown" || reason === "interval" ? reason : "budget";
    return { ok: false, reason: why, retryAtMs: Number(wait), remaining: Number(remaining) };
  }

  async remaining(now = Date.now()): Promise<number> {
    const key = `${this.prefix}:usage`;
    await this.redis.zremrangebyscore(key, "-inf", now - this.options.windowMs);
    const count = await this.redis.zcard(key);
    return Math.max(0, this.options.budget - count);
  }

  async penalize(retryAfterMs: number): Promise<void> {
    await this.redis.set(`${this.prefix}:cooldown`, "1", "PX", Math.max(1, retryAfterMs));
  }

  /** Rebuild the rolling window from PostgreSQL timestamps after Redis data loss. */
  async hydrate(timestamps: Date[], now = Date.now()): Promise<void> {
    const key = `${this.prefix}:usage`;
    const fresh = timestamps.filter((stamp) => now - stamp.getTime() < this.options.windowMs);
    if (!fresh.length) return;
    const args: Array<string | number> = [];
    for (const stamp of fresh) {
      args.push(stamp.getTime(), `hydrate:${stamp.toISOString()}:${randomUUID()}`);
    }
    await this.redis.zadd(key, ...args);
    await this.redis.pexpire(key, this.options.windowMs + 86_400_000);
  }
}
