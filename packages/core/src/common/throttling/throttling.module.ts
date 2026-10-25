import { Module } from "@nestjs/common";
import { ThrottlerModule } from "@nestjs/throttler";
import type { Redis } from "ioredis";
import { RedisThrottlerStorage } from "./redis-throttler.storage.js";
import { REDIS, RedisModule } from "../../redis/redis.module.js";

/** Default budget: 600 requests per minute per user or IP. Routes tighten this with @Throttle. */
@Module({
  imports: [
    ThrottlerModule.forRootAsync({
      imports: [RedisModule],
      inject: [REDIS],
      useFactory: (redis: Redis) => ({
        storage: new RedisThrottlerStorage(redis),
        throttlers: [
          { name: "default", limit: 600, ttl: 60_000 },
          { name: "auth", limit: 10, ttl: 60_000 },
          { name: "contact", limit: 3, ttl: 60 * 60_000 },
        ],
      }),
    }),
  ],
  exports: [ThrottlerModule],
})
export class ThrottlingModule {}
