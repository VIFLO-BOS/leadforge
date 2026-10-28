import { describe, expect, it } from "vitest";
import type { NextFunction, Request, Response } from "express";
import { crossSiteRequestGuard, redactUrl, securityHeaders } from "./http-security.js";

function fakeRes() {
  const headers: Record<string, string> = {};
  const res = {
    statusCode: 200,
    body: undefined as unknown,
    setHeader: (k: string, v: string) => void (headers[k.toLowerCase()] = v),
    getHeader: (k: string) => headers[k.toLowerCase()],
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(body: unknown) {
      this.body = body;
      return this;
    },
  };
  return { res, headers };
}

function run(mw: (req: Request, res: Response, next: NextFunction) => void, req: Partial<Request>) {
  const { res, headers } = fakeRes();
  let nextCalled = false;
  mw(
    { path: "/api/v1/x", method: "GET", headers: {}, ...req } as Request,
    res as unknown as Response,
    () => {
      nextCalled = true;
    },
  );
  return {
    nextCalled,
    status: res.statusCode,
    body: res.body as { error?: { code: string } } | undefined,
    headers,
  };
}

describe("securityHeaders", () => {
  it("sets a strict policy on API responses and HSTS only when asked", () => {
    const r = run(securityHeaders({ hsts: false }), {});
    expect(r.nextCalled).toBe(true);
    expect(r.headers["x-content-type-options"]).toBe("nosniff");
    expect(r.headers["x-frame-options"]).toBe("DENY");
    expect(r.headers["referrer-policy"]).toBe("no-referrer");
    expect(r.headers["content-security-policy"]).toContain("default-src 'none'");
    expect(r.headers["content-security-policy"]).toContain("frame-ancestors 'none'");
    expect(r.headers["cache-control"]).toBe("no-store");
    expect(r.headers["strict-transport-security"]).toBeUndefined();
    expect(run(securityHeaders({ hsts: true }), {}).headers["strict-transport-security"]).toMatch(
      /max-age=31536000/,
    );
  });

  it("leaves the CSP off the HTML documentation pages", () => {
    const r = run(securityHeaders({ hsts: false, htmlPrefixes: ["/api/docs"] }), {
      path: "/api/docs/index.html",
    });
    expect(r.headers["content-security-policy"]).toBeUndefined();
    expect(r.headers["x-frame-options"]).toBe("DENY");
  });
});

describe("crossSiteRequestGuard", () => {
  const guard = crossSiteRequestGuard({
    allowedOrigins: ["https://app.example.test", "https://api.example.test/"],
    exemptPrefixes: ["/api/v1/webhooks/"],
  });

  it("refuses state-changing requests a browser marks cross-site", () => {
    const r = run(guard, {
      method: "POST",
      headers: { "sec-fetch-site": "cross-site", origin: "https://evil.example" },
    });
    expect(r.nextCalled).toBe(false);
    expect(r.status).toBe(403);
    expect(r.body?.error?.code).toBe("CSRF_FAILED");
  });

  it("allows same-origin and same-site browser requests and safe methods", () => {
    for (const site of ["same-origin", "same-site", "none"]) {
      expect(
        run(guard, { method: "POST", headers: { "sec-fetch-site": site } }).nextCalled,
        site,
      ).toBe(true);
    }
    expect(
      run(guard, { method: "GET", headers: { "sec-fetch-site": "cross-site" } }).nextCalled,
    ).toBe(true);
  });

  it("falls back to Origin for browsers without Fetch Metadata", () => {
    expect(run(guard, { method: "POST", headers: { origin: "https://evil.example" } }).status).toBe(
      403,
    );
    expect(run(guard, { method: "DELETE", headers: { origin: "null" } }).status).toBe(403);
    expect(
      run(guard, { method: "POST", headers: { origin: "https://app.example.test" } }).nextCalled,
    ).toBe(true);
    expect(
      run(guard, { method: "POST", headers: { origin: "https://api.example.test" } }).nextCalled,
    ).toBe(true);
  });

  it("lets non-browser clients and exempt webhook paths through", () => {
    expect(run(guard, { method: "POST", headers: {} }).nextCalled).toBe(true);
    expect(
      run(guard, {
        method: "POST",
        path: "/api/v1/webhooks/paystack",
        headers: { "sec-fetch-site": "cross-site" },
      }).nextCalled,
    ).toBe(true);
  });
});

describe("redactUrl", () => {
  it("masks signatures, tokens and personal query values but keeps the route", () => {
    expect(redactUrl("/api/v1/exports/65f0/download?org=abc&expires=123&sig=SECRETSIG")).toBe(
      "/api/v1/exports/65f0/download?org=abc&expires=123&sig=[redacted]",
    );
    expect(redactUrl("/api/v1/invitations/very-secret-token")).toBe(
      "/api/v1/invitations/[redacted]",
    );
    expect(redactUrl("/api/v1/invitations/very-secret-token/accept")).toBe(
      "/api/v1/invitations/[redacted]/accept",
    );
    expect(redactUrl("/api/v1/businesses?q=ngozi%40mail.example&pageSize=50")).toBe(
      "/api/v1/businesses?q=[redacted]&pageSize=50",
    );
    expect(redactUrl("/api/v1/businesses")).toBe("/api/v1/businesses");
    expect(redactUrl(undefined)).toBe("");
  });
});
