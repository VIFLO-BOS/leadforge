import http from "node:http";
import https from "node:https";
import { isIP, type LookupFunction } from "node:net";
import type { TLSSocket } from "node:tls";
import zlib from "node:zlib";
import type { Readable } from "node:stream";
import { checkAddress, checkHostname } from "./ip-policy.js";
import { isAllowed, policyFromFetch, ROBOTS_MAX_BYTES, type RobotsPolicy } from "./robots.js";

/**
 * SafeFetch: the only way LeadForge fetches third-party web pages (worker only; security
 * policy section 5).
 *
 * 1. http and https only, no credentials in the URL, ports 80, 443, 8080 and 8443.
 * 2. Internal host names are refused; every A and AAAA address is checked against the deny
 *    list (private, loopback, link-local and metadata, CGNAT, multicast, reserved, and
 *    IPv6 forms that embed them). Any denied address refuses the host.
 * 3. The connection goes to the address that was checked (IP pinning through a fixed
 *    `lookup`), with the original Host header and TLS SNI, so DNS rebinding cannot swap it.
 * 4. Redirects are followed manually, at most 5, re-running every check on each hop.
 * 5. One deadline (default 10 s) covers connect and read; bodies are streamed and aborted
 *    past the size cap (default 2 MiB, after decompression); only HTML, XHTML, plain text
 *    and JSON are read.
 * 6. robots.txt is fetched and honored per origin (cached 24 hours) for our user agent.
 * 7. A per-host limit (default 1 request per 2 seconds) and a global limit (default 10 per
 *    second) apply to every request, robots.txt and redirects included.
 * No cookies, credentials or client certificates are ever sent; responses are returned to
 * the caller in memory and never stored.
 */

export type SafeFetchErrorCode =
  | "INVALID_URL"
  | "URL_NOT_ALLOWED"
  | "ADDRESS_NOT_ALLOWED"
  | "DNS_FAILED"
  | "CONNECTION_FAILED"
  | "TLS_INVALID"
  | "TIMEOUT"
  | "TOO_LARGE"
  | "CONTENT_TYPE_NOT_ALLOWED"
  | "TOO_MANY_REDIRECTS"
  | "ROBOTS_DISALLOWED"
  | "RATE_LIMITED";

export class SafeFetchError extends Error {
  constructor(
    readonly code: SafeFetchErrorCode,
    message: string,
    readonly url: string,
    /** Low-level reason, e.g. a TLS error code or the denied address range. */
    readonly detail: string | null = null,
  ) {
    super(message);
    this.name = "SafeFetchError";
  }
}

export interface ResolvedAddress {
  address: string;
  family: 4 | 6;
}

/** DNS for SafeFetch and the email checks; stubbed in tests. */
export interface DnsResolver {
  /** A and AAAA records. Throws (with `code`) when the name does not resolve. */
  resolveHost(hostname: string): Promise<ResolvedAddress[]>;
  /** MX records, lowest preference first. Throws (with `code`) on failure. */
  resolveMx(domain: string): Promise<Array<{ exchange: string; priority: number }>>;
}

/** Token bucket: returns 0 when a token was taken, else milliseconds to wait. */
export interface FetchRateLimiter {
  acquire(key: string, limit: { requestsPerSecond: number; burst: number }): Promise<number>;
}

export interface RobotsCache {
  get(origin: string): Promise<RobotsPolicy | null>;
  set(origin: string, policy: RobotsPolicy, ttlMs: number): Promise<void>;
}

export interface SafeFetchConfig {
  userAgent: string;
  timeoutMs: number;
  maxBytes: number;
  maxRedirects: number;
  allowedPorts: readonly number[];
  hostRequestsPerSecond: number;
  globalRequestsPerSecond: number;
  /** Longest a request waits for a rate-limit token before failing with RATE_LIMITED. */
  maxRateWaitMs: number;
  robotsTtlMs: number;
  /**
   * Development and test only (refused in production by the env schema): exact host names
   * served by a local address, for example a local test site. Never consulted for other hosts.
   */
  hostOverrides: ReadonlyMap<string, { address: string; port: number }>;
}

export interface SafeFetchDeps {
  resolver: DnsResolver;
  limiter: FetchRateLimiter;
  robotsCache: RobotsCache;
  /** Test hook: where a pinned address is actually dialed (maps fake public IPs to a local server). */
  dial?: (address: string, port: number) => { address: string; port: number };
  sleep?: (ms: number) => Promise<void>;
}

export const SAFE_FETCH_DEFAULTS = {
  timeoutMs: 10_000,
  maxBytes: 2 * 1024 * 1024,
  maxRedirects: 5,
  allowedPorts: [80, 443, 8080, 8443],
  hostRequestsPerSecond: 0.5,
  globalRequestsPerSecond: 10,
  maxRateWaitMs: 60_000,
  robotsTtlMs: 24 * 60 * 60 * 1000,
} as const;

/** A robots.txt that failed with a server error or a redirect loop is re-fetched after an hour. */
export const ROBOTS_ERROR_TTL_MS = 60 * 60 * 1000;

const PAGE_TYPES = new Set([
  "text/html",
  "application/xhtml+xml",
  "text/plain",
  "application/json",
]);
const KEPT_HEADERS = [
  "server",
  "x-powered-by",
  "x-generator",
  "content-type",
  "content-length",
  "strict-transport-security",
  "location",
];
const REDIRECTS = new Set([301, 302, 303, 307, 308]);
const TLS_CERT_ERRORS = new Set([
  "CERT_HAS_EXPIRED",
  "CERT_NOT_YET_VALID",
  "CERT_REVOKED",
  "CERT_UNTRUSTED",
  "CERT_REJECTED",
  "CERT_SIGNATURE_FAILURE",
  "DEPTH_ZERO_SELF_SIGNED_CERT",
  "SELF_SIGNED_CERT_IN_CHAIN",
  "UNABLE_TO_GET_ISSUER_CERT",
  "UNABLE_TO_GET_ISSUER_CERT_LOCALLY",
  "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
  "ERR_TLS_CERT_ALTNAME_INVALID",
  "HOSTNAME_MISMATCH",
]);

export interface TlsInfo {
  secure: boolean;
  issuer: string | null;
  validTo: string | null;
  protocol: string | null;
}

export interface SafeFetchResponse {
  requestedUrl: string;
  /** URL of the final hop. */
  url: string;
  status: number;
  contentType: string | null;
  /** Decoded text for 2xx responses; empty for other statuses. */
  body: string;
  bytes: number;
  durationMs: number;
  redirects: Array<{ url: string; status: number }>;
  /** The address the final hop connected to. */
  address: string;
  tls: TlsInfo;
  headers: Record<string, string>;
}

export interface FetchOptions {
  /** `robots` skips the robots check and accepts any text type; used for /robots.txt. */
  kind?: "page" | "robots";
}

interface Target {
  url: URL;
  hostname: string;
  port: number;
  address: string;
  family: 4 | 6;
  dialAddress: string;
  dialPort: number;
}

interface HopResult {
  status: number;
  headers: http.IncomingHttpHeaders;
  body: string;
  bytes: number;
  contentType: string | null;
  tls: TlsInfo;
}

export class SafeFetch {
  constructor(
    readonly config: SafeFetchConfig,
    private readonly deps: SafeFetchDeps,
  ) {}

  private sleep(ms: number): Promise<void> {
    return this.deps.sleep ? this.deps.sleep(ms) : new Promise((r) => setTimeout(r, ms));
  }

  /** Steps 1 and 2: URL, port and host policy, DNS resolution and the address deny list. */
  async resolveTarget(raw: string | URL): Promise<Target> {
    let url: URL;
    try {
      url = typeof raw === "string" ? new URL(raw) : new URL(raw.toString());
    } catch {
      throw new SafeFetchError("INVALID_URL", "Not a valid URL", String(raw));
    }
    const href = url.toString();
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      throw new SafeFetchError(
        "URL_NOT_ALLOWED",
        "Only http and https URLs are fetched",
        href,
        url.protocol,
      );
    }
    if (url.username || url.password)
      throw new SafeFetchError("URL_NOT_ALLOWED", "URLs with credentials are not fetched", href);
    const port = url.port ? Number(url.port) : url.protocol === "https:" ? 443 : 80;
    if (!this.config.allowedPorts.includes(port)) {
      throw new SafeFetchError(
        "URL_NOT_ALLOWED",
        `Port ${port} is not allowed`,
        href,
        `port ${port}`,
      );
    }
    const hostname = url.hostname
      .replace(/^\[|\]$/g, "")
      .replace(/\.$/, "")
      .toLowerCase();

    const override = this.config.hostOverrides.get(hostname);
    if (override) {
      return {
        url,
        hostname,
        port,
        address: override.address,
        family: isIP(override.address) === 6 ? 6 : 4,
        dialAddress: override.address,
        dialPort: override.port,
      };
    }

    let addresses: ResolvedAddress[];
    if (isIP(hostname)) {
      addresses = [{ address: hostname, family: isIP(hostname) === 6 ? 6 : 4 }];
    } else {
      const host = checkHostname(hostname);
      if (!host.allowed)
        throw new SafeFetchError("URL_NOT_ALLOWED", "This host is not fetched", href, host.reason);
      try {
        addresses = await this.deps.resolver.resolveHost(hostname);
      } catch (err) {
        const code = (err as { code?: string }).code ?? "DNS_ERROR";
        throw new SafeFetchError(
          "DNS_FAILED",
          `The host name did not resolve (${code})`,
          href,
          code,
        );
      }
      if (addresses.length === 0)
        throw new SafeFetchError(
          "DNS_FAILED",
          "The host name resolves to no address",
          href,
          "ENODATA",
        );
    }
    for (const a of addresses) {
      const verdict = checkAddress(a.address);
      if (!verdict.allowed) {
        throw new SafeFetchError(
          "ADDRESS_NOT_ALLOWED",
          "The host resolves to an address that is not fetched",
          href,
          `${a.address}: ${verdict.reason}`,
        );
      }
    }
    // Pin one checked address: IPv4 first for predictability.
    const pinned = addresses.find((a) => a.family === 4) ?? addresses[0]!;
    const dial = this.deps.dial
      ? this.deps.dial(pinned.address, port)
      : { address: pinned.address, port };
    return {
      url,
      hostname,
      port,
      address: pinned.address,
      family: pinned.family,
      dialAddress: dial.address,
      dialPort: dial.port,
    };
  }

  private async throttle(hostname: string, href: string): Promise<void> {
    const host = hostname.replace(/^www\d{0,3}\./, "");
    const buckets: Array<[string, { requestsPerSecond: number; burst: number }]> = [
      [
        `safe-fetch:host:${host}`,
        { requestsPerSecond: this.config.hostRequestsPerSecond, burst: 1 },
      ],
      [
        "safe-fetch:global",
        {
          requestsPerSecond: this.config.globalRequestsPerSecond,
          burst: Math.max(1, Math.ceil(this.config.globalRequestsPerSecond)),
        },
      ],
    ];
    const deadline = Date.now() + this.config.maxRateWaitMs;
    for (const [key, limit] of buckets) {
      for (;;) {
        const wait = await this.deps.limiter.acquire(key, limit);
        if (wait <= 0) break;
        if (Date.now() + wait > deadline) {
          throw new SafeFetchError(
            "RATE_LIMITED",
            "Rate limit wait too long; try again later",
            href,
            key,
          );
        }
        await this.sleep(wait);
      }
    }
  }

  /** The robots policy for an origin, from the cache or by fetching /robots.txt. */
  async robotsPolicy(url: URL): Promise<RobotsPolicy> {
    const origin = url.origin;
    const cached = await this.deps.robotsCache.get(origin);
    if (cached) return cached;
    let policy: RobotsPolicy;
    let ttl = this.config.robotsTtlMs;
    try {
      const res = await this.fetch(`${origin}/robots.txt`, { kind: "robots" });
      policy = policyFromFetch({ status: res.status, body: res.body, error: null });
      // A server error is retried sooner than a real answer.
      if (res.status >= 500) ttl = Math.min(ttl, ROBOTS_ERROR_TTL_MS);
    } catch (err) {
      // When the host cannot be reached at all, the page cannot be either: report that failure
      // (not a robots refusal) and cache nothing. Policy violations are re-thrown as they are.
      if (
        err instanceof SafeFetchError &&
        err.code !== "TOO_MANY_REDIRECTS" &&
        err.code !== "INVALID_URL"
      )
        throw err;
      policy = policyFromFetch({
        status: null,
        body: null,
        error: err instanceof SafeFetchError ? err.code : "ERROR",
      });
      ttl = Math.min(ttl, ROBOTS_ERROR_TTL_MS);
    }
    await this.deps.robotsCache.set(origin, policy, ttl);
    return policy;
  }

  async allowedByRobots(url: URL): Promise<boolean> {
    return isAllowed(
      await this.robotsPolicy(url),
      this.config.userAgent,
      `${url.pathname}${url.search}`,
    );
  }

  /**
   * Fetches a URL under every rule above. Non-2xx final statuses are returned (with an empty
   * body), not thrown; policy violations, network failures and limits throw SafeFetchError.
   */
  async fetch(rawUrl: string, options: FetchOptions = {}): Promise<SafeFetchResponse> {
    const kind = options.kind ?? "page";
    const started = Date.now();
    const redirects: Array<{ url: string; status: number }> = [];
    let next: string = rawUrl;
    for (let hop = 0; ; hop++) {
      const target = await this.resolveTarget(next);
      const href = target.url.toString();
      if (kind === "page" && !(await this.allowedByRobots(target.url))) {
        throw new SafeFetchError(
          "ROBOTS_DISALLOWED",
          "robots.txt does not allow this page for our crawler",
          href,
        );
      }
      await this.throttle(target.hostname, href);
      const res = await this.request(target, kind);
      const location = typeof res.headers.location === "string" ? res.headers.location : null;
      if (REDIRECTS.has(res.status) && location) {
        if (hop >= this.config.maxRedirects) {
          throw new SafeFetchError(
            "TOO_MANY_REDIRECTS",
            `More than ${this.config.maxRedirects} redirects`,
            href,
          );
        }
        redirects.push({ url: href, status: res.status });
        try {
          next = new URL(location, target.url).toString();
        } catch {
          throw new SafeFetchError(
            "INVALID_URL",
            "Redirect to an invalid URL",
            href,
            location.slice(0, 200),
          );
        }
        continue;
      }
      const headers: Record<string, string> = {};
      for (const name of KEPT_HEADERS) {
        const v = res.headers[name];
        if (typeof v === "string") headers[name] = v.slice(0, 300);
      }
      return {
        requestedUrl: rawUrl,
        url: href,
        status: res.status,
        contentType: res.contentType,
        body: res.body,
        bytes: res.bytes,
        durationMs: Date.now() - started,
        redirects,
        address: target.address,
        tls: res.tls,
        headers,
      };
    }
  }

  /** One HTTP exchange against a pinned address. */
  private request(target: Target, kind: "page" | "robots"): Promise<HopResult> {
    const { url } = target;
    const href = url.toString();
    const secure = url.protocol === "https:";
    const lookup: LookupFunction = (_hostname, opts, callback) => {
      const all = typeof opts === "object" && opts !== null && (opts as { all?: boolean }).all;
      const family = isIP(target.dialAddress) === 6 ? 6 : 4;
      if (all)
        (callback as (err: null, addresses: Array<{ address: string; family: number }>) => void)(
          null,
          [{ address: target.dialAddress, family }],
        );
      else
        (callback as (err: null, address: string, family: number) => void)(
          null,
          target.dialAddress,
          family,
        );
    };
    const options: https.RequestOptions = {
      protocol: url.protocol,
      hostname: isIP(target.hostname) ? target.dialAddress : target.hostname,
      port: target.dialPort,
      path: `${url.pathname}${url.search}`,
      method: "GET",
      agent: false,
      lookup,
      headers: {
        host: url.host,
        "user-agent": this.config.userAgent,
        accept:
          kind === "robots"
            ? "text/plain, */*;q=0.1"
            : "text/html, application/xhtml+xml, text/plain;q=0.8, application/json;q=0.5",
        "accept-language": "en",
        "accept-encoding": "gzip, deflate, br",
        connection: "close",
      },
      maxHeaderSize: 32 * 1024,
      ...(secure
        ? {
            servername: isIP(target.hostname) ? undefined : target.hostname,
            rejectUnauthorized: true,
          }
        : {}),
    };
    const maxBytes =
      kind === "robots" ? Math.min(this.config.maxBytes, ROBOTS_MAX_BYTES) : this.config.maxBytes;

    return new Promise<HopResult>((resolve, reject) => {
      let settled = false;
      const finish = (err: SafeFetchError | null, value?: HopResult) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (err) {
          req.destroy();
          reject(err);
        } else resolve(value!);
      };
      const req = (secure ? https : http).request(options, (res) => {
        const status = res.statusCode ?? 0;
        const tls = tlsInfo(res.socket, secure);
        const contentType =
          typeof res.headers["content-type"] === "string" ? res.headers["content-type"] : null;
        const mediaType = contentType?.split(";")[0]?.trim().toLowerCase() ?? null;
        if (status < 200 || status >= 300) {
          res.resume();
          finish(null, { status, headers: res.headers, body: "", bytes: 0, contentType, tls });
          return;
        }
        // robots.txt is parsed whatever its declared type (RFC 9309); pages must be text types.
        const typeOk = kind === "robots" || (mediaType !== null && PAGE_TYPES.has(mediaType));
        if (!typeOk) {
          res.resume();
          finish(
            new SafeFetchError(
              "CONTENT_TYPE_NOT_ALLOWED",
              `Content type ${mediaType ?? "(none)"} is not read`,
              href,
              mediaType ?? "missing",
            ),
          );
          return;
        }
        const declared = Number(res.headers["content-length"]);
        if (
          kind === "page" &&
          Number.isFinite(declared) &&
          declared > maxBytes &&
          !res.headers["content-encoding"]
        ) {
          finish(
            new SafeFetchError(
              "TOO_LARGE",
              `Response is larger than ${maxBytes} bytes`,
              href,
              `content-length ${declared}`,
            ),
          );
          return;
        }
        let stream: Readable = res;
        const encoding = String(res.headers["content-encoding"] ?? "")
          .toLowerCase()
          .trim();
        if (encoding === "gzip" || encoding === "x-gzip") stream = res.pipe(zlib.createGunzip());
        else if (encoding === "deflate") stream = res.pipe(zlib.createInflate());
        else if (encoding === "br") stream = res.pipe(zlib.createBrotliDecompress());
        const chunks: Buffer[] = [];
        let bytes = 0;
        stream.on("data", (chunk: Buffer) => {
          if (settled) return;
          bytes += chunk.length;
          if (bytes > maxBytes) {
            if (stream !== res) stream.destroy();
            if (kind === "robots") {
              // RFC 9309: parse at least the first 500 KiB; the rest is ignored.
              chunks.push(chunk.subarray(0, chunk.length - (bytes - maxBytes)));
              finish(null, {
                status,
                headers: res.headers,
                body: decode(Buffer.concat(chunks), contentType),
                bytes: maxBytes,
                contentType,
                tls,
              });
              req.destroy();
              return;
            }
            finish(
              new SafeFetchError(
                "TOO_LARGE",
                `Response is larger than ${maxBytes} bytes`,
                href,
                `over ${maxBytes} bytes`,
              ),
            );
            return;
          }
          chunks.push(chunk);
        });
        stream.on("end", () =>
          finish(null, {
            status,
            headers: res.headers,
            body: decode(Buffer.concat(chunks), contentType),
            bytes,
            contentType,
            tls,
          }),
        );
        stream.on("error", (err: NodeJS.ErrnoException) => finish(mapNetworkError(err, href)));
        res.on("error", (err: NodeJS.ErrnoException) => finish(mapNetworkError(err, href)));
      });
      const timer = setTimeout(
        () =>
          finish(
            new SafeFetchError(
              "TIMEOUT",
              `No complete response within ${this.config.timeoutMs} ms`,
              href,
            ),
          ),
        this.config.timeoutMs,
      );
      req.on("error", (err: NodeJS.ErrnoException) => finish(mapNetworkError(err, href)));
      req.end();
    });
  }
}

function tlsInfo(socket: unknown, secure: boolean): TlsInfo {
  if (!secure) return { secure: false, issuer: null, validTo: null, protocol: null };
  const s = socket as TLSSocket | null;
  try {
    const cert = s?.getPeerCertificate?.();
    const issuer = cert?.issuer
      ? [cert.issuer.O, cert.issuer.CN].filter(Boolean).join(" / ") || null
      : null;
    return {
      secure: true,
      issuer: issuer ? String(issuer).slice(0, 200) : null,
      validTo: cert?.valid_to ?? null,
      protocol: s?.getProtocol?.() ?? null,
    };
  } catch {
    return { secure: true, issuer: null, validTo: null, protocol: null };
  }
}

function mapNetworkError(err: NodeJS.ErrnoException, href: string): SafeFetchError {
  if (err instanceof SafeFetchError) return err;
  const code = err.code ?? "ERROR";
  if (TLS_CERT_ERRORS.has(code))
    return new SafeFetchError(
      "TLS_INVALID",
      `The TLS certificate is not valid (${code})`,
      href,
      code,
    );
  return new SafeFetchError("CONNECTION_FAILED", `Connection failed (${code})`, href, code);
}

/** Decodes with the declared charset when the platform knows it, else UTF-8. */
function decode(buf: Buffer, contentType: string | null): string {
  const charset = /charset=["']?([\w-]+)/i.exec(contentType ?? "")?.[1]?.toLowerCase() ?? "utf-8";
  try {
    return new TextDecoder(charset, { fatal: false }).decode(buf);
  } catch {
    return new TextDecoder("utf-8", { fatal: false }).decode(buf);
  }
}

/** Builds the dev and test host override map from `host=address:port,host2=address:port`. */
export function parseHostOverrides(
  value: string | undefined | null,
): Map<string, { address: string; port: number }> {
  const map = new Map<string, { address: string; port: number }>();
  for (const entry of (value ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)) {
    const eq = entry.indexOf("=");
    if (eq <= 0) throw new Error(`Invalid SAFE_FETCH_HOST_OVERRIDES entry: ${entry}`);
    const host = entry.slice(0, eq).trim().toLowerCase();
    const target = entry.slice(eq + 1).trim();
    const m = /^(\[[^\]]+\]|[^:]+):(\d{1,5})$/.exec(target);
    if (!m || !isIP(m[1]!.replace(/^\[|\]$/g, "")))
      throw new Error(`Invalid SAFE_FETCH_HOST_OVERRIDES target: ${target}`);
    map.set(host, { address: m[1]!.replace(/^\[|\]$/g, ""), port: Number(m[2]) });
  }
  return map;
}
