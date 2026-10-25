import { Inject, Injectable } from "@nestjs/common";
import type { Redis } from "ioredis";
import type { HealthResponse } from "@leadforge/contracts";
import { PrismaService } from "@leadforge/db-postgres";
import { MongoService } from "@leadforge/db-mongo";
import { REDIS } from "../redis/redis.module.js";

type Check = HealthResponse["checks"][string];

@Injectable()
export class HealthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mongo: MongoService,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  live(): HealthResponse {
    return { status: "ok", checks: {}, version: version(), timestamp: new Date().toISOString() };
  }

  async ready(): Promise<HealthResponse> {
    const [postgres, mongo, redis] = await Promise.all([
      this.timed(() => this.prisma.ping()),
      this.timed(() => this.mongo.ping()),
      this.timed(async () => {
        const pong = await this.redis.ping();
        if (pong !== "PONG") throw new Error(`unexpected ping response ${pong}`);
      }),
    ]);
    const checks = { postgres, mongo, redis };
    const degraded = Object.values(checks).some((c) => c.status === "down");
    return {
      status: degraded ? "degraded" : "ok",
      checks,
      version: version(),
      timestamp: new Date().toISOString(),
    };
  }

  private async timed(fn: () => Promise<void>): Promise<Check> {
    const started = performance.now();
    try {
      await Promise.race([
        fn(),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("timeout after 3000ms")), 3000),
        ),
      ]);
      return { status: "up", latencyMs: Math.round(performance.now() - started) };
    } catch (err) {
      return {
        status: "down",
        latencyMs: Math.round(performance.now() - started),
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }
}

function version(): string {
  return process.env.APP_VERSION ?? process.env.npm_package_version ?? "0.1.0";
}
