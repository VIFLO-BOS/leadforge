import { Global, Inject, Module, type OnApplicationShutdown } from "@nestjs/common";
import { Redis } from "ioredis";
import type { ServerEnv } from "@leadforge/contracts";
import { ENV } from "../config/env.module.js";

export const REDIS = Symbol("REDIS");
export const InjectRedis = (): ParameterDecorator => Inject(REDIS);

export function createRedis(url: string, name: string): Redis {
  return new Redis(url, {
    maxRetriesPerRequest: null,
    enableReadyCheck: true,
    lazyConnect: false,
    connectionName: `leadforge-${name}`,
  });
}

class RedisLifecycle implements OnApplicationShutdown {
  constructor(@Inject(REDIS) private readonly redis: Redis) {}
  async onApplicationShutdown(): Promise<void> {
    await this.redis.quit().catch(() => this.redis.disconnect());
  }
}

@Global()
@Module({
  providers: [
    {
      provide: REDIS,
      inject: [ENV],
      useFactory: (env: ServerEnv) => createRedis(env.REDIS_URL, "app"),
    },
    RedisLifecycle,
  ],
  exports: [REDIS],
})
export class RedisModule {}
