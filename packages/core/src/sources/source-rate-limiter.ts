import { Inject, Injectable } from "@nestjs/common";
import type { Redis } from "ioredis";
import { REDIS } from "../redis/redis.module.js";

/**
 * Token bucket per source in Redis, shared by every worker process (provider quotas are per
 * LeadForge project, not per organization). `acquire` takes a token and returns 0, or returns
 * how many milliseconds to wait before one is available; the caller delays the job instead of
 * sleeping. Time comes from the Redis server so workers agree on it.
 */
@Injectable()
export class SourceRateLimiter {
  private static readonly SCRIPT = `
    local t = redis.call('TIME')
    local now = tonumber(t[1]) * 1000 + math.floor(tonumber(t[2]) / 1000)
    local rate = tonumber(ARGV[1]) / 1000
    local burst = tonumber(ARGV[2])
    local state = redis.call('HMGET', KEYS[1], 'tokens', 'ts')
    local tokens = tonumber(state[1])
    local ts = tonumber(state[2])
    if tokens == nil then tokens = burst end
    if ts == nil then ts = now end
    tokens = math.min(burst, tokens + math.max(0, now - ts) * rate)
    local wait = 0
    if tokens >= 1 then
      tokens = tokens - 1
    else
      wait = math.ceil((1 - tokens) / rate)
    end
    redis.call('HSET', KEYS[1], 'tokens', tostring(tokens), 'ts', tostring(now))
    redis.call('PEXPIRE', KEYS[1], math.ceil(burst / rate) + 1000)
    return wait
  `;

  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  static key(source: string): string {
    return `lf:ratelimit:source:${source}`;
  }

  async acquire(
    source: string,
    limit: { requestsPerSecond: number; burst: number },
  ): Promise<number> {
    const wait = (await this.redis.eval(
      SourceRateLimiter.SCRIPT,
      1,
      SourceRateLimiter.key(source),
      String(limit.requestsPerSecond),
      String(Math.max(1, limit.burst)),
    )) as number;
    return Math.max(0, Number(wait) || 0);
  }
}
