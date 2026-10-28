import { randomUUID } from "node:crypto";
import type { NextFunction, Request, Response } from "express";

/**
 * HTTP hardening for the API process (docs/SECURITY_AND_DATA_COLLECTION.md section 4).
 *
 * The API serves JSON, CSV, ZIP and PDF downloads, never HTML pages (Swagger UI aside, which is
 * off in production), so the policy is as strict as a browser allows: nothing may be framed,
 * sniffed, embedded or executed from an API response.
 */
export interface SecurityHeaderOptions {
  /** Adds Strict-Transport-Security (production behind HTTPS). */
  hsts: boolean;
  /** Path prefixes that serve HTML (the non-production Swagger UI) and need a looser CSP. */
  htmlPrefixes?: string[];
}

const STRICT_CSP =
  "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'";

export function securityHeaders(options: SecurityHeaderOptions) {
  const htmlPrefixes = options.htmlPrefixes ?? [];
  return (req: Request, res: Response, next: NextFunction): void => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
    res.setHeader("Cross-Origin-Resource-Policy", "same-site");
    res.setHeader("X-DNS-Prefetch-Control", "off");
    res.setHeader("X-Permitted-Cross-Domain-Policies", "none");
    if (!htmlPrefixes.some((p) => req.path.startsWith(p)))
      res.setHeader("Content-Security-Policy", STRICT_CSP);
    if (options.hsts)
      res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
    // API answers are per user and per organization: never cached by a browser or a shared
    // cache unless a handler opts in by setting its own Cache-Control (for example licence texts).
    res.setHeader("Cache-Control", "no-store");
    next();
  };
}

const REQUEST_ID = /^[\w.-]{8,128}$/;

/**
 * Gives every request its X-Request-Id before anything else runs (the client's, when it is a
 * plain token, or a new UUID), so errors raised before routing (body parsing, cross-site
 * refusal) carry the same id the request log line and support see.
 */
export function assignRequestId() {
  return (req: Request, res: Response, next: NextFunction): void => {
    const header = req.headers["x-request-id"];
    const id = typeof header === "string" && REQUEST_ID.test(header) ? header : randomUUID();
    req.headers["x-request-id"] = id;
    res.setHeader("X-Request-Id", id);
    next();
  };
}

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

export interface CrossSiteOptions {
  /** Origins allowed to send state-changing requests (the web app, the API itself). */
  allowedOrigins: string[];
  /** Path prefixes exempt from the check (server-to-server webhooks, which carry no browser headers). */
  exemptPrefixes?: string[];
}

/**
 * Refuses state-changing requests a browser marks as cross-site, before any route runs.
 *
 * The session-bound X-CSRF-Token (CsrfGuard) protects signed-in requests. This covers the rest:
 * public POSTs such as login, registration and password reset (login CSRF would sign a victim
 * into an attacker's account) and any request a form on another site could make. Browsers send
 * `Sec-Fetch-Site` on every request (Fetch Metadata); older ones send `Origin` on POST. Clients
 * that send neither (curl, server-to-server, tests) are not browsers and cannot be forged by a
 * third-party page, so they pass.
 */
export function crossSiteRequestGuard(options: CrossSiteOptions) {
  const allowed = new Set(
    options.allowedOrigins.map(originOf).filter((o): o is string => o !== null),
  );
  const exempt = options.exemptPrefixes ?? [];
  return (req: Request, res: Response, next: NextFunction): void => {
    if (SAFE_METHODS.has(req.method) || exempt.some((p) => req.path.startsWith(p))) return next();
    const site = header(req, "sec-fetch-site");
    const origin = header(req, "origin");
    const crossSite =
      site !== undefined
        ? site === "cross-site"
        : origin !== undefined && (origin === "null" || !allowed.has(originOf(origin) ?? ""));
    if (!crossSite) return next();
    res.status(403).json({
      error: {
        code: "CSRF_FAILED",
        message: "Cross-site request refused",
        requestId: String(
          (req as { id?: unknown }).id ?? res.getHeader("X-Request-Id") ?? "unknown",
        ),
      },
    });
  };
}

function header(req: Request, name: string): string | undefined {
  const v = req.headers[name];
  return Array.isArray(v) ? v[0] : v;
}

function originOf(url: string): string | null {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

/** Query parameters whose values are credentials or personal data and never belong in logs. */
const SECRET_QUERY_KEYS = new Set([
  "token",
  "sig",
  "signature",
  "reference",
  "trxref",
  "email",
  "q",
  "address",
  "code",
]);

/**
 * A request URL safe to log: secret or personal query values are replaced, and the invitation
 * token in `/invitations/<token>` is masked. Used by the HTTP logger and the error filter.
 */
export function redactUrl(url: string | undefined): string {
  if (!url) return "";
  const [path = "", query] = url.split("?", 2) as [string, string | undefined];
  const safePath = path.replace(/(\/invitations\/)[^/]+/, "$1[redacted]");
  if (query === undefined) return safePath;
  const params = new URLSearchParams(query);
  for (const key of [...params.keys()])
    if (SECRET_QUERY_KEYS.has(key.toLowerCase())) params.set(key, "[redacted]");
  const rebuilt = params.toString().replace(/%5Bredacted%5D/g, "[redacted]");
  return rebuilt ? `${safePath}?${rebuilt}` : safePath;
}
