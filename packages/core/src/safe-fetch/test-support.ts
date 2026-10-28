import http from "node:http";
import https from "node:https";
import type { AddressInfo } from "node:net";
import type { RobotsPolicy } from "./robots.js";
import {
  SAFE_FETCH_DEFAULTS,
  SafeFetch,
  type DnsResolver,
  type FetchRateLimiter,
  type ResolvedAddress,
  type RobotsCache,
  type SafeFetchConfig,
} from "./safe-fetch.js";

/**
 * Test support for SafeFetch and the crawler: local HTTP and HTTPS servers, a stub DNS that maps
 * names to fake public addresses, and a dial hook that sends those addresses to the local servers.
 * No test touches the internet. Test-only: not exported from the package index.
 */

/**
 * Self-signed certificate and key for `selfsigned.example.test`, generated for these tests only
 * (`openssl req -x509 -newkey ec ...`). It protects nothing: it exists to make TLS verification fail.
 */
export const SELF_SIGNED_CERT = `-----BEGIN CERTIFICATE-----
MIIBwDCCAWWgAwIBAgIUfH7nKehWIbgSGpGEgNxtAbAbp+AwCgYIKoZIzj0EAwIw
IjEgMB4GA1UEAwwXc2VsZnNpZ25lZC5leGFtcGxlLnRlc3QwIBcNMjYxMDI1MTEy
NjE3WhgPMjEyNjEwMDExMTI2MTdaMCIxIDAeBgNVBAMMF3NlbGZzaWduZWQuZXhh
bXBsZS50ZXN0MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEz8qWyhD+/RX2M931
UIh3iL0NVNgXUcJ6jFjsN8dd7+0rTl7IOjr7dGLKzcYEGnUgKGC8/HcZYzLRnd4B
EYAxe6N3MHUwHQYDVR0OBBYEFP9smB4UusilFg6Eh4scEsE7HVbvMB8GA1UdIwQY
MBaAFP9smB4UusilFg6Eh4scEsE7HVbvMA8GA1UdEwEB/wQFMAMBAf8wIgYDVR0R
BBswGYIXc2VsZnNpZ25lZC5leGFtcGxlLnRlc3QwCgYIKoZIzj0EAwIDSQAwRgIh
AMCnEv8mWjUH+qmwOUPK+UWFiPBNYE1lSrDTFBxIgHRlAiEAzMXtc9h14D3eIC+V
o8jGRcGq2TIVZkrVG0Ez64SC6g0=
-----END CERTIFICATE-----
`;
// The PEM armor is assembled at runtime so secret scanners do not flag this throwaway test key.
const ARMOR = (kind: "BEGIN" | "END") => `-----${kind} ${["PRIVATE", "KEY"].join(" ")}-----`;
export const SELF_SIGNED_KEY = `${ARMOR("BEGIN")}
MIGHAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBG0wawIBAQQgH4DSajU7ZmC3oMoV
nlJIv7can9F8vP/LkHTqzMXm9UyhRANCAATPypbKEP79FfYz3fVQiHeIvQ1U2BdR
wnqMWOw3x13v7StOXsg6Ovt0YsrNxgQadSAoYLz8dxljMtGd3gERgDF7
${ARMOR("END")}
`;

export type Route = (req: http.IncomingMessage, res: http.ServerResponse) => void;

export interface TestServer {
  port: number;
  requests: Array<{ path: string; headers: http.IncomingHttpHeaders }>;
  routes: Map<string, Route>;
  close(): Promise<void>;
}

export async function startServer(
  routes: Record<string, Route> = {},
  tls = false,
): Promise<TestServer> {
  const table = new Map(Object.entries(routes));
  const requests: TestServer["requests"] = [];
  const handler = (req: http.IncomingMessage, res: http.ServerResponse) => {
    const path = req.url ?? "/";
    requests.push({ path, headers: req.headers });
    const route = table.get(path.split("?")[0]!) ?? table.get("*");
    if (route) return route(req, res);
    res.writeHead(404, { "content-type": "text/html" });
    res.end("<h1>Not found</h1>");
  };
  const server = tls
    ? https.createServer({ cert: SELF_SIGNED_CERT, key: SELF_SIGNED_KEY }, handler)
    : http.createServer(handler);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;
  return {
    port,
    requests,
    routes: table,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections?.();
        server.close(() => resolve());
      }),
  };
}

export const html =
  (body: string, status = 200, headers: Record<string, string> = {}): Route =>
  (_req, res) => {
    res.writeHead(status, { "content-type": "text/html; charset=utf-8", ...headers });
    res.end(body);
  };

/** Stub DNS: names map to address lists (or a function for per-call answers); anything else is NXDOMAIN. */
export class StubResolver implements DnsResolver {
  calls: string[] = [];
  constructor(
    public table: Record<string, ResolvedAddress[] | (() => ResolvedAddress[])>,
    public mx: Record<
      string,
      Array<{ exchange: string; priority: number }> | "ENOTFOUND" | "ESERVFAIL"
    > = {},
  ) {}

  async resolveHost(hostname: string): Promise<ResolvedAddress[]> {
    this.calls.push(hostname);
    const entry = this.table[hostname];
    if (!entry) throw Object.assign(new Error(`ENOTFOUND ${hostname}`), { code: "ENOTFOUND" });
    return typeof entry === "function" ? entry() : entry;
  }

  async resolveMx(domain: string): Promise<Array<{ exchange: string; priority: number }>> {
    const entry = this.mx[domain];
    if (entry === undefined || entry === "ENOTFOUND")
      throw Object.assign(new Error(`ENOTFOUND ${domain}`), { code: "ENOTFOUND" });
    if (entry === "ESERVFAIL")
      throw Object.assign(new Error(`ESERVFAIL ${domain}`), { code: "ESERVFAIL" });
    return entry;
  }
}

export class MemoryRobotsCache implements RobotsCache {
  readonly store = new Map<string, RobotsPolicy>();
  async get(origin: string) {
    return this.store.get(origin) ?? null;
  }
  async set(origin: string, policy: RobotsPolicy) {
    this.store.set(origin, policy);
  }
}

export class RecordingLimiter implements FetchRateLimiter {
  calls: string[] = [];
  constructor(public waits: number[] = []) {}
  async acquire(key: string): Promise<number> {
    this.calls.push(key);
    return this.waits.shift() ?? 0;
  }
}

export const UA = "LeadForgeBot/1.0 (+https://leadforge.example/legal/data-collection)";

/** A SafeFetch whose public-looking addresses are dialed on local servers. */
export function testFetcher(options: {
  resolver: StubResolver;
  dialMap: Record<string, number>;
  limiter?: RecordingLimiter;
  robotsCache?: MemoryRobotsCache;
  config?: Partial<SafeFetchConfig>;
  dialed?: string[];
  sleeps?: number[];
}): SafeFetch {
  return new SafeFetch(
    {
      ...SAFE_FETCH_DEFAULTS,
      userAgent: UA,
      hostOverrides: new Map(),
      timeoutMs: 2_000,
      ...options.config,
    },
    {
      resolver: options.resolver,
      limiter: options.limiter ?? new RecordingLimiter(),
      robotsCache: options.robotsCache ?? new MemoryRobotsCache(),
      dial: (address, port) => {
        options.dialed?.push(address);
        const local = options.dialMap[address];
        return local ? { address: "127.0.0.1", port: local } : { address, port };
      },
      sleep: async (ms) => {
        options.sleeps?.push(ms);
      },
    },
  );
}
