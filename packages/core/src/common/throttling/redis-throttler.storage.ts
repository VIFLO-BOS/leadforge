import { Inject, Injectable } from "@nestjs/common";
import type { ThrottlerStorage } from "@nestjs/throttler";
import type { ThrottlerStorageRecord } from "@nestjs/throttler/dist/throttler-storage-record.interface.js";
import type { Redis } from "ioredis";
import { REDIS } from "../../redis/redis.module.js";

/**
 * Fixed-window counter with block support, shared across API instances.
 * Keys: lf:throttle:<name>:<tracker> and lf:throttle:block:<name>:<tracker>.
 */
@Injectable()
export class RedisThrottlerStorage implements ThrottlerStorage {
  private static readonly SCRIPT = `
    local hits = redis.call('INCR', KEYS[1])
    if hits == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[1]) end
    local ttl = redis.call('PTTL', KEYS[1])
    local blockTtl = redis.call('PTTL', KEYS[2])
    if hits > tonumber(ARGV[2]) and blockTtl <= 0 and tonumber(ARGV[3]) > 0 then
      redis.call('SET', KEYS[2], '1', 'PX', ARGV[3])
      blockTtl = tonumber(ARGV[3])
    end
    return { hits, ttl, blockTtl }
  `;

  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  async increment(
    key: string,
    ttl: number,
    limit: number,
    blockDuration: number,
    throttlerName: string,
  ): Promise<ThrottlerStorageRecord> {
    const hitKey = `lf:throttle:${throttlerName}:${key}`;
    const blockKey = `lf:throttle:block:${throttlerName}:${key}`;
    const [hits, ttlMs, blockTtlMs] = (await this.redis.eval(
      RedisThrottlerStorage.SCRIPT,
      2,
      hitKey,
      blockKey,
      String(ttl),
      String(limit),
      String(blockDuration),
    )) as [number, number, number];

    return {
      totalHits: hits,
      timeToExpire: Math.max(0, Math.ceil(ttlMs / 1000)),
      isBlocked: blockTtlMs > 0,
      timeToBlockExpire: Math.max(0, Math.ceil(blockTtlMs / 1000)),
    };
  }
}
