import { promises as dns } from "node:dns";
import { Inject, Injectable, Module } from "@nestjs/common";
import type { Redis } from "ioredis";
import type { ServerEnv } from "@leadforge/contracts";
import { ENV } from "../config/env.module.js";
import { REDIS } from "../redis/redis.module.js";
import { SourceRateLimiter } from "../sources/source-rate-limiter.js";
import type { RobotsPolicy } from "./robots.js";
import {
  parseHostOverrides,
  SAFE_FETCH_DEFAULTS,
  SafeFetch,
  type DnsResolver,
  type ResolvedAddress,
  type RobotsCache,
} from "./safe-fetch.js";
import { SiteCrawler } from "./site-crawler.js";

export const DNS_RESOLVER = Symbol("DNS_RESOLVER");

/**
 * DNS through c-ares (`dns.Resolver`), not the OS resolver: A and AAAA are both asked, and a
 * name that resolves to nothing fails. Methods are instance properties so tests can stub them.
 */
@Injectable()
export class NodeDnsResolver implements DnsResolver {
  private readonly resolver = new dns.Resolver({ timeout: 5_000, tries: 2 });

  resolveHost = async (hostname: string): Promise<ResolvedAddress[]> => {
    const [v4, v6] = await Promise.allSettled([
      this.resolver.resolve4(hostname),
      this.resolver.resolve6(hostname),
    ]);
    const out: ResolvedAddress[] = [];
    if (v4.status === "fulfilled") for (const a of v4.value) out.push({ address: a, family: 4 });
    if (v6.status === "fulfilled") for (const a of v6.value) out.push({ address: a, family: 6 });
    if (out.length === 0) {
      const reason =
        v4.status === "rejected" ? v4.reason : v6.status === "rejected" ? v6.reason : null;
      const err = new Error(`No addresses for ${hostname}`) as Error & { code?: string };
      err.code = (reason as { code?: string } | null)?.code ?? "ENODATA";
      throw err;
    }
    return out;
  };

  resolveMx = async (domain: string): Promise<Array<{ exchange: string; priority: number }>> =>
    this.resolver.resolveMx(domain);
}

/** robots.txt policies per origin in Redis (shared by every worker process). */
@Injectable()
export class RedisRobotsCache implements RobotsCache {
  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  private key(origin: string): string {
    return `lf:robots:${origin}`;
  }

  async get(origin: string): Promise<RobotsPolicy | null> {
    const raw = await this.redis.get(this.key(origin)).catch(() => null);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as RobotsPolicy;
    } catch {
      return null;
    }
  }

  async set(origin: string, policy: RobotsPolicy, ttlMs: number): Promise<void> {
    await this.redis
      .set(this.key(origin), JSON.stringify(policy), "PX", Math.max(1_000, ttlMs))
      .catch(() => undefined);
  }
}

export function safeFetchUserAgent(env: ServerEnv): string {
  return (
    env.SAFE_FETCH_USER_AGENT ??
    `LeadForgeBot/1.0 (+${env.APP_URL.replace(/\/$/, "")}/legal/data-collection)`
  );
}

/**
 * SafeFetch and the site crawler for the worker (website analysis and enrichment) and the DNS
 * resolver used by email checks. The API never fetches third-party pages.
 */
@Module({
  providers: [
    { provide: DNS_RESOLVER, useClass: NodeDnsResolver },
    RedisRobotsCache,
    SourceRateLimiter,
    {
      provide: SafeFetch,
      inject: [ENV, DNS_RESOLVER, SourceRateLimiter, RedisRobotsCache],
      useFactory: (
        env: ServerEnv,
        resolver: DnsResolver,
        limiter: SourceRateLimiter,
        robotsCache: RedisRobotsCache,
      ) =>
        new SafeFetch(
          {
            ...SAFE_FETCH_DEFAULTS,
            userAgent: safeFetchUserAgent(env),
            timeoutMs: env.SAFE_FETCH_TIMEOUT_MS,
            hostRequestsPerSecond: env.SAFE_FETCH_HOST_RPS,
            globalRequestsPerSecond: env.SAFE_FETCH_GLOBAL_RPS,
            hostOverrides:
              env.NODE_ENV === "production"
                ? new Map()
                : parseHostOverrides(env.SAFE_FETCH_HOST_OVERRIDES),
          },
          { resolver, limiter, robotsCache },
        ),
    },
    {
      provide: SiteCrawler,
      inject: [SafeFetch],
      useFactory: (fetcher: SafeFetch) => new SiteCrawler(fetcher),
    },
  ],
  exports: [SafeFetch, SiteCrawler, DNS_RESOLVER],
})
export class SafeFetchModule {}
