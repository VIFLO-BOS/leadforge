import { Module } from "@nestjs/common";
import { ThrottlerModule } from "@nestjs/throttler";
import type { Redis } from "ioredis";
import type { ServerEnv } from "@leadforge/contracts";
import { ENV } from "../../config/env.module.js";
import { RedisThrottlerStorage } from "./redis-throttler.storage.js";
import { REDIS, RedisModule } from "../../redis/redis.module.js";

/**
 * One global throttler (RATE_LIMIT_PER_MINUTE, default 600 requests per minute per user or IP). Routes that need a
 * tighter budget override it with @Throttle(THROTTLE_*). Only a single named throttler
 * is configured on purpose: every configured throttler applies to every route, so a
 * global "3 per hour" entry would throttle the whole API.
 */
export const THROTTLE_AUTH = { default: { limit: 10, ttl: 60_000 } } as const;
export const THROTTLE_AUTH_RELAXED = { default: { limit: 30, ttl: 60_000 } } as const;
export const THROTTLE_CONTACT = { default: { limit: 3, ttl: 60 * 60_000 } } as const;
/** Synchronous exports: 10 per hour per user. */
export const THROTTLE_EXPORTS = { default: { limit: 10, ttl: 60 * 60_000 } } as const;
/** CSV uploads: 30 per hour per user. */
export const THROTTLE_IMPORT_UPLOADS = { default: { limit: 30, ttl: 60 * 60_000 } } as const;

@Module({
  imports: [
    ThrottlerModule.forRootAsync({
      imports: [RedisModule],
      inject: [REDIS, ENV],
      useFactory: (redis: Redis, env: ServerEnv) => ({
        storage: new RedisThrottlerStorage(redis),
        throttlers: [{ name: "default", limit: env.RATE_LIMIT_PER_MINUTE, ttl: 60_000 }],
      }),
    }),
  ],
  exports: [ThrottlingModule],
})
export class ThrottlingModule {}
