import http from "node:http";
import type { AddressInfo } from "node:net";
import { Worker, type Job } from "bullmq";
import { Redis } from "ioredis";
import {
  AnalysisQueueHandler,
  DedupQueueHandler,
  DNS_RESOLVER,
  EnrichmentQueueHandler,
  QueueNames,
  ScoringQueueHandler,
  type DnsResolver,
} from "@leadforge/core";
import { createHarness, type Harness, TEST_QUEUE_PREFIX } from "./harness.js";

/**
 * Phase 4 test support: a local website (no internet) served to SafeFetch through the
 * development host override, fast fetch limits, and in-process BullMQ workers wired with the
 * same handlers as apps/worker.
 */

export type Page = {
  status?: number;
  type?: string;
  body: string;
  headers?: Record<string, string>;
};
export type Site = Record<string, Page>;

export interface LocalSites {
  port: number;
  /** Pages per host name (Host header), so several test sites share one server. */
  sites: Map<string, Site>;
  requests: Array<{ host: string; path: string; userAgent: string | undefined }>;
  close(): Promise<void>;
}

export async function startSites(): Promise<LocalSites> {
  const sites = new Map<string, Site>();
  const requests: LocalSites["requests"] = [];
  const server = http.createServer((req, res) => {
    const host = (req.headers.host ?? "").replace(/:\d+$/, "");
    const path = (req.url ?? "/").split("?")[0]!;
    requests.push({ host, path, userAgent: req.headers["user-agent"] });
    const page = sites.get(host)?.[path];
    if (!page) {
      res.writeHead(404, { "content-type": "text/html" });
      res.end("<h1>Not found</h1>");
      return;
    }
    res.writeHead(page.status ?? 200, {
      "content-type": page.type ?? "text/html; charset=utf-8",
      ...(page.headers ?? {}),
    });
    res.end(page.body);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    port: (server.address() as AddressInfo).port,
    sites,
    requests,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}

/** A port nothing listens on (connections are refused): an unreachable website. */
export async function closedPort(): Promise<number> {
  const s = http.createServer();
  await new Promise<void>((resolve) => s.listen(0, "127.0.0.1", resolve));
  const port = (s.address() as AddressInfo).port;
  await new Promise<void>((resolve) => s.close(() => resolve()));
  return port;
}

export const ALLOW_ALL_ROBOTS: Page = { type: "text/plain", body: "User-agent: *\nAllow: /\n" };

/** Harness whose SafeFetch serves the given test hosts from the local server, with fast limits. */
export function createPhase4Harness(
  overrides: Record<string, string>,
  env: Record<string, string> = {},
): Promise<Harness> {
  return createHarness({
    SAFE_FETCH_HOST_OVERRIDES: Object.entries(overrides)
      .map(([host, target]) => `${host}=${target}`)
      .join(","),
    SAFE_FETCH_HOST_RPS: "100",
    SAFE_FETCH_GLOBAL_RPS: "1000",
    SAFE_FETCH_TIMEOUT_MS: "3000",
    SAFE_FETCH_RETRY_DELAY_MS: "0",
    ...env,
  });
}

/** Stub DNS on the app's resolver (SafeFetch and email MX checks use the same instance). */
export function stubDns(
  h: Harness,
  table: { hosts?: Record<string, string[]>; mx?: Record<string, string[]> },
): void {
  const resolver = h.app.get<DnsResolver>(DNS_RESOLVER, { strict: false });
  resolver.resolveHost = async (hostname: string) => {
    const addresses = table.hosts?.[hostname];
    if (!addresses) throw Object.assign(new Error(`ENOTFOUND ${hostname}`), { code: "ENOTFOUND" });
    return addresses.map((address) => ({
      address,
      family: address.includes(":") ? (6 as const) : (4 as const),
    }));
  };
  resolver.resolveMx = async (domain: string) => {
    const hosts = table.mx?.[domain];
    if (!hosts) throw Object.assign(new Error(`ENOTFOUND ${domain}`), { code: "ENOTFOUND" });
    return hosts.map((exchange, i) => ({ exchange, priority: (i + 1) * 10 }));
  };
}

export interface Workers {
  failures: string[];
  close(): Promise<void>;
}

/** Real BullMQ workers for the Phase 4 queues, wired like apps/worker. */
export function startPhase4Workers(
  h: Harness,
  queues: Array<"analysis" | "enrichment" | "scoring" | "dedup"> = [
    "analysis",
    "enrichment",
    "scoring",
    "dedup",
  ],
): Workers {
  const failures: string[] = [];
  const handlers = {
    analysis: [QueueNames.websiteAnalysis, h.app.get(AnalysisQueueHandler, { strict: false })],
    enrichment: [QueueNames.enrichment, h.app.get(EnrichmentQueueHandler, { strict: false })],
    scoring: [QueueNames.scoring, h.app.get(ScoringQueueHandler, { strict: false })],
    dedup: [QueueNames.dedup, h.app.get(DedupQueueHandler, { strict: false })],
  } as const;
  const workers = queues.map((q) => {
    const [name, handler] = handlers[q];
    const w = new Worker(
      name,
      (job: Job) => (handler as { handle(job: Job): Promise<unknown> }).handle(job),
      {
        connection: new Redis(process.env.REDIS_URL!, { maxRetriesPerRequest: null }),
        prefix: TEST_QUEUE_PREFIX,
        concurrency: 4,
      },
    );
    w.on("failed", (job, err) => failures.push(`${name}:${job?.name}:${err?.message}`));
    return w;
  });
  return { failures, close: async () => void (await Promise.all(workers.map((w) => w.close()))) };
}

/** Polls `fn` until it returns a truthy value. */
export async function waitFor<T>(
  fn: () => Promise<T | null | undefined | false>,
  timeoutMs = 30_000,
  label = "condition",
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let last: unknown;
  for (;;) {
    try {
      const value = await fn();
      if (value) return value;
    } catch (err) {
      last = err;
    }
    if (Date.now() > deadline)
      throw new Error(`Timed out waiting for ${label}${last ? `: ${String(last)}` : ""}`);
    await new Promise((r) => setTimeout(r, 100));
  }
}
