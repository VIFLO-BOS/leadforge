import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type TestAgent from "supertest/lib/agent.js";
import { ACCESS_COOKIE, CSRF_HEADER } from "@leadforge/contracts";
import {
  API,
  createHarness,
  csrfFrom,
  orgHeaders,
  registerUser,
  verifyEmail,
  type Harness,
} from "./harness.js";
import { createOwner } from "./fixtures.js";
import { createApp } from "../src/bootstrap.js";

/**
 * Phase 7 security review fixes (docs/SECURITY_AND_DATA_COLLECTION.md section 13): response
 * headers, cross-site request refusal, client address handling behind proxies, per-account
 * sign-in throttling, immediate access-token revocation, body parser errors and the metrics
 * endpoint's access rule.
 */

let h: Harness;
beforeAll(async () => {
  h = await createHarness();
});
afterAll(async () => h?.close());
beforeEach(async () => h.resetState());

function accessToken(agent: TestAgent): string {
  const jar = (
    agent as unknown as { jar: { getCookies(o: object): Array<{ name: string; value: string }> } }
  ).jar;
  const c = jar
    .getCookies({ domain: "127.0.0.1", path: "/", secure: false, script: false })
    .find((x) => x.name === ACCESS_COOKIE);
  if (!c) throw new Error("No access cookie");
  return c.value;
}

describe("response headers and CORS", () => {
  it("sends hardening headers on every API response, success or error", async () => {
    for (const res of [
      await h.agent().get(`${API}/health/live`),
      await h.agent().get(`${API}/does-not-exist`),
    ]) {
      expect(res.headers["x-content-type-options"]).toBe("nosniff");
      expect(res.headers["x-frame-options"]).toBe("DENY");
      expect(res.headers["referrer-policy"]).toBe("no-referrer");
      expect(res.headers["content-security-policy"]).toContain("default-src 'none'");
      expect(res.headers["cache-control"]).toBe("no-store");
      expect(res.headers["x-powered-by"]).toBeUndefined();
    }
    // Public licence texts keep their own caching.
    const licences = await h.agent().get(`${API}/public/data-licenses`).expect(200);
    expect(licences.headers["cache-control"]).toBe("public, max-age=3600");
  });

  it("answers CORS only for the web app's origin", async () => {
    const ok = await h
      .agent()
      .options(`${API}/auth/login`)
      .set("Origin", "http://localhost:3000")
      .set("Access-Control-Request-Method", "POST");
    expect(ok.headers["access-control-allow-origin"]).toBe("http://localhost:3000");
    expect(ok.headers["access-control-allow-credentials"]).toBe("true");
    const evil = await h
      .agent()
      .options(`${API}/auth/login`)
      .set("Origin", "https://evil.example")
      .set("Access-Control-Request-Method", "POST");
    expect(evil.headers["access-control-allow-origin"]).toBeUndefined();
  });
});

describe("cross-site requests", () => {
  const login = { email: "nobody@example.test", password: "whatever-pass-1" };

  it("refuses a cross-site sign-in (login CSRF) and any cross-site state change before routing", async () => {
    for (const headers of [
      { "Sec-Fetch-Site": "cross-site", Origin: "https://evil.example" },
      { Origin: "https://evil.example" },
      { Origin: "null" },
    ]) {
      const res = await h.agent().post(`${API}/auth/login`).set(headers).send(login);
      expect(res.status, JSON.stringify(headers)).toBe(403);
      expect(res.body.error.code).toBe("CSRF_FAILED");
    }
    // An HTML form on another site (urlencoded) is refused the same way.
    const form = await h
      .agent()
      .post(`${API}/auth/register`)
      .set("Sec-Fetch-Site", "cross-site")
      .type("form")
      .send("email=a%40b.test");
    expect(form.status).toBe(403);
    // The web app's own requests and non-browser clients are unaffected.
    expect(
      (
        await h
          .agent()
          .post(`${API}/auth/login`)
          .set("Sec-Fetch-Site", "same-origin")
          .set("Origin", "http://localhost:3000")
          .send(login)
      ).status,
    ).toBe(401);
    expect((await h.agent().post(`${API}/auth/login`).send(login)).status).toBe(401);
    // Reads stay possible (CORS still decides what another origin may see).
    expect(
      (await h.agent().get(`${API}/health/live`).set("Sec-Fetch-Site", "cross-site")).status,
    ).toBe(200);
  });

  it("does not apply to the payment webhook (server to server, signature-checked)", async () => {
    const res = await h
      .agent()
      .post(`${API}/webhooks/paystack`)
      .set("Sec-Fetch-Site", "cross-site")
      .send({ event: "charge.success" });
    expect(res.body.error?.code).not.toBe("CSRF_FAILED");
  });
});

describe("client address behind proxies", () => {
  it("ignores client-supplied X-Forwarded-For entries, so rotating them does not bypass per-IP limits", async () => {
    let last = 0;
    for (let i = 0; i < 11; i++) {
      // The client forges a new left-most address each time; the proxy (one trusted hop) appends the real one.
      const res = await h
        .agent()
        .post(`${API}/auth/login`)
        .set("X-Forwarded-For", `203.0.113.${i + 1}, 198.51.100.7`)
        .send({ email: `rotate-${i}@example.test`, password: "whatever-pass-1" });
      last = res.status;
    }
    expect(last).toBe(429);
  });
});

describe("per-account sign-in throttling", () => {
  it("locks one account after 10 failures from any mix of addresses, without affecting other accounts", async () => {
    const agent = h.agent();
    await registerUser(agent, { email: "target@example.test", password: "Corr3ct-Horse-Battery" });
    for (let i = 0; i < 10; i++) {
      const res = await h
        .agent()
        .post(`${API}/auth/login`)
        .set("X-Forwarded-For", `198.51.100.${i + 1}`)
        .send({ email: "TARGET@example.test", password: `wrong-password-${i}` });
      expect(res.status, `attempt ${i}`).toBe(401);
    }
    // Even the right password is refused while the account is throttled, from a fresh address.
    const locked = await h
      .agent()
      .post(`${API}/auth/login`)
      .set("X-Forwarded-For", "192.0.2.200")
      .send({ email: "target@example.test", password: "Corr3ct-Horse-Battery" });
    expect(locked.status).toBe(429);
    expect(locked.body.error.code).toBe("RATE_LIMITED");
    // Another account from the same address signs in normally.
    await registerUser(h.agent(), {
      email: "other@example.test",
      password: "Corr3ct-Horse-Battery",
    });
    await h
      .agent()
      .post(`${API}/auth/login`)
      .set("X-Forwarded-For", "192.0.2.200")
      .send({ email: "other@example.test", password: "Corr3ct-Horse-Battery" })
      .expect(200);
  });

  it("answers unknown and known emails the same way", async () => {
    await registerUser(h.agent(), {
      email: "known@example.test",
      password: "Corr3ct-Horse-Battery",
    });
    const unknown = await h
      .agent()
      .post(`${API}/auth/login`)
      .send({ email: "unknown@example.test", password: "Corr3ct-Horse-Battery" });
    const wrong = await h
      .agent()
      .post(`${API}/auth/login`)
      .send({ email: "known@example.test", password: "Wrong-Horse-Battery1" });
    expect(unknown.status).toBe(401);
    expect(wrong.status).toBe(401);
    expect(unknown.body.error.code).toBe(wrong.body.error.code);
    expect(unknown.body.error.message).toBe(wrong.body.error.message);
  });
});

describe("real retry time on 429s (Stage 9)", () => {
  const PASSWORD = "Corr3ct-Horse-Battery";
  const LOCK_SECONDS = 15 * 60;
  type Res = {
    headers: Record<string, string>;
    body: {
      error: {
        code: string;
        message: string;
        details?: Array<{ path: string; message: string }>;
        requestId: string;
      };
    };
  };

  /** Ten wrong passwords for one email, each from its own address so the per-IP limit never applies. */
  async function failTenTimes(email: string, subnet: number): Promise<void> {
    for (let i = 0; i < 10; i++) {
      const res = await h
        .agent()
        .post(`${API}/auth/login`)
        .set("X-Forwarded-For", `198.51.${subnet}.${i + 1}`)
        .send({ email, password: `wrong-password-${i}` });
      expect(res.status, `${email} attempt ${i}`).toBe(401);
    }
  }
  const signIn = (email: string, ip: string) =>
    h
      .agent()
      .post(`${API}/auth/login`)
      .set("X-Forwarded-For", ip)
      .send({ email, password: PASSWORD });
  /** Retry-After and details.retryAfterSeconds must agree; returns the seconds. */
  function retrySeconds(res: Res): number {
    const header = Number(res.headers["retry-after"]);
    expect(
      Number.isInteger(header) && header > 0,
      `Retry-After ${res.headers["retry-after"]}`,
    ).toBe(true);
    expect(res.body.error.details).toEqual([
      { path: "retryAfterSeconds", message: String(header) },
    ]);
    return header;
  }

  it("sends the time left on the per-account sign-in lock, in Retry-After and details.retryAfterSeconds", async () => {
    await registerUser(h.agent(), { email: "locked@example.test", password: PASSWORD });
    await failTenTimes("locked@example.test", 100);
    const locked = (await signIn("locked@example.test", "192.0.2.10").expect(
      429,
    )) as unknown as Res;
    const seconds = retrySeconds(locked);
    expect(seconds).toBeGreaterThan(LOCK_SECONDS - 60);
    expect(seconds).toBeLessThanOrEqual(LOCK_SECONDS);
    expect(locked.body.error.code).toBe("RATE_LIMITED");
    expect(locked.body.error.message).toBe(
      "Too many failed sign-in attempts for this account. Try again in 15 minutes.",
    );

    // Later in the window the wait follows the lock (not a fixed 60 seconds or 15 minutes).
    const keys = await h.redis.keys("lf:login-failures:*");
    expect(keys).toHaveLength(1);
    await h.redis.expire(keys[0]!, 125);
    const later = (await signIn("locked@example.test", "192.0.2.11").expect(429)) as unknown as Res;
    expect(retrySeconds(later)).toBeGreaterThanOrEqual(123);
    expect(retrySeconds(later)).toBeLessThanOrEqual(125);
    expect(later.body.error.message).toBe(
      "Too many failed sign-in attempts for this account. Try again in 3 minutes.",
    );
    await h.redis.expire(keys[0]!, 20);
    const last = (await signIn("locked@example.test", "192.0.2.12").expect(429)) as unknown as Res;
    expect(retrySeconds(last)).toBeLessThanOrEqual(20);
    expect(last.body.error.message).toBe(
      "Too many failed sign-in attempts for this account. Try again in 1 minute.",
    );

    // A counter left without an expiry (an older version stopped between INCR and EXPIRE) gets a full window, not a permanent lock.
    await h.redis.persist(keys[0]!);
    const repaired = (await signIn("locked@example.test", "192.0.2.13").expect(
      429,
    )) as unknown as Res;
    expect(retrySeconds(repaired)).toBe(LOCK_SECONDS);
    expect(await h.redis.ttl(keys[0]!)).toBeGreaterThan(LOCK_SECONDS - 60);

    // When the lock lifts, the right password works again.
    await h.redis.del(keys[0]!);
    await signIn("locked@example.test", "192.0.2.14").expect(200);
  });

  it("answers a locked unknown email with the same 429 shape and timing as a locked account", async () => {
    await registerUser(h.agent(), { email: "known-lock@example.test", password: PASSWORD });
    await failTenTimes("known-lock@example.test", 101);
    await failTenTimes("nobody-lock@example.test", 102);
    const known = (await signIn("known-lock@example.test", "192.0.2.20").expect(
      429,
    )) as unknown as Res;
    const unknown = (await signIn("nobody-lock@example.test", "192.0.2.21").expect(
      429,
    )) as unknown as Res;
    expect(Object.keys(unknown.body.error).sort()).toEqual(Object.keys(known.body.error).sort());
    expect(unknown.body.error.code).toBe(known.body.error.code);
    expect(unknown.body.error.message).toBe(known.body.error.message);
    const [k, u] = [retrySeconds(known), retrySeconds(unknown)];
    for (const s of [k, u]) {
      expect(s).toBeGreaterThan(LOCK_SECONDS - 60);
      expect(s).toBeLessThanOrEqual(LOCK_SECONDS);
    }
    // Both windows run from their own first failure, a few seconds apart; nothing else differs.
    expect(Math.abs(k - u)).toBeLessThanOrEqual(30);
    expect(unknown.headers["content-type"]).toBe(known.headers["content-type"]);
  });

  it("sends the throttler's real block time on per-IP limits", async () => {
    // Public contact form: 3 per hour per IP, so the block lasts most of an hour, not a minute.
    const payload = {
      name: "Ngozi",
      email: "ngozi@example.test",
      message: "I would like a demo of LeadForge please.",
    };
    for (let i = 0; i < 3; i++)
      await h
        .agent()
        .post(`${API}/public/contact`)
        .set("X-Forwarded-For", "203.0.113.50")
        .send(payload)
        .expect(202);
    const contact = (await h
      .agent()
      .post(`${API}/public/contact`)
      .set("X-Forwarded-For", "203.0.113.50")
      .send(payload)
      .expect(429)) as unknown as Res;
    const contactWait = retrySeconds(contact);
    expect(contactWait).toBeGreaterThan(3600 - 60);
    expect(contactWait).toBeLessThanOrEqual(3600);
    expect(contact.body.error).toMatchObject({
      code: "RATE_LIMITED",
      message: "Too many requests. Try again shortly",
    });

    // Sign-in route: 10 per minute per IP (different emails, so the per-account lock is not involved).
    for (let i = 0; i < 10; i++) {
      await h
        .agent()
        .post(`${API}/auth/login`)
        .set("X-Forwarded-For", "203.0.113.60")
        .send({ email: `ip-${i}@example.test`, password: PASSWORD })
        .expect(401);
    }
    const perIp = (await h
      .agent()
      .post(`${API}/auth/login`)
      .set("X-Forwarded-For", "203.0.113.60")
      .send({ email: "ip-x@example.test", password: PASSWORD })
      .expect(429)) as unknown as Res;
    expect(retrySeconds(perIp)).toBeLessThanOrEqual(60);
    expect(perIp.body.error.message).toBe("Too many requests. Try again shortly");
  });
});

describe("immediate session revocation", () => {
  it("refuses a signed-out session's access token at once, not when it expires", async () => {
    const owner = await createOwner(h, "revoke@example.test", "Revoke Org");
    const token = accessToken(owner.agent);
    const bearer = { Authorization: `Bearer ${token}` };
    await h.agent().get(`${API}/auth/me`).set(bearer).expect(200);
    await owner.agent
      .post(`${API}/auth/logout`)
      .set(CSRF_HEADER, csrfFrom(owner.agent))
      .expect(204);
    const after = await h.agent().get(`${API}/auth/me`).set(bearer);
    expect(after.status).toBe(401);
    expect(after.body.error.code).toBe("UNAUTHENTICATED");
    // A revoked token on a public route is treated as anonymous, not as the user.
    await h.agent().get(`${API}/public/plans`).set(bearer).expect(200);
  });

  it("signing out another device and resetting the password cut off those devices' access tokens", async () => {
    const email = "devices@example.test";
    const laptop = h.agent();
    await registerUser(laptop, { email, password: "Corr3ct-Horse-Battery" });
    await verifyEmail(h, laptop, email);
    const phone = h.agent();
    await phone
      .post(`${API}/auth/login`)
      .send({ email, password: "Corr3ct-Horse-Battery" })
      .expect(200);
    const tablet = h.agent();
    await tablet
      .post(`${API}/auth/login`)
      .send({ email, password: "Corr3ct-Horse-Battery" })
      .expect(200);
    const phoneToken = { Authorization: `Bearer ${accessToken(phone)}` };
    const tabletToken = { Authorization: `Bearer ${accessToken(tablet)}` };

    const sessions = await laptop.get(`${API}/auth/sessions`).expect(200);
    const phoneSession = (
      sessions.body.data as Array<{ id: string; current: boolean; createdAt: string }>
    )
      .filter((s) => !s.current)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0]!;
    await laptop
      .delete(`${API}/auth/sessions/${phoneSession.id}`)
      .set(CSRF_HEADER, csrfFrom(laptop))
      .expect(204);
    expect((await h.agent().get(`${API}/auth/me`).set(phoneToken)).status).toBe(401);
    await h.agent().get(`${API}/auth/me`).set(tabletToken).expect(200);

    await h.agent().post(`${API}/auth/forgot-password`).send({ email }).expect(202);
    const resetToken = await h.tokenFromMail(email, "/reset-password");
    await h
      .agent()
      .post(`${API}/auth/reset-password`)
      .send({ token: resetToken, password: "N3w-Horse-Battery-Staple" })
      .expect(200);
    expect((await h.agent().get(`${API}/auth/me`).set(tabletToken)).status).toBe(401);
    expect((await laptop.get(`${API}/auth/me`)).status).toBe(401);
  });
});

describe("request body errors", () => {
  it("maps malformed and oversized JSON to the error envelope without internals", async () => {
    const owner = await createOwner(h, "bodies@example.test", "Bodies Org");
    const bad = await owner.agent
      .post(`${API}/lists`)
      .set(orgHeaders(owner.agent, owner.orgId))
      .set("Content-Type", "application/json")
      .send('{"name": ');
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe("VALIDATION_FAILED");
    expect(JSON.stringify(bad.body)).not.toMatch(
      /at .*\.js|node_modules|SyntaxError|Unexpected|position/,
    );
    expect(bad.body.error.message).toBe("The request body is not valid JSON");
    // Errors raised before routing still carry the request id the response header names.
    expect(bad.body.error.requestId).not.toBe("unknown");
    expect(bad.headers["x-request-id"]).toBe(bad.body.error.requestId);
    const unknownRoute = await h
      .agent()
      .get(`${API}/no-such-route?q=private-search-text`)
      .expect(404);
    expect(unknownRoute.body.error.message).not.toContain("private-search-text");
    const huge = await owner.agent
      .post(`${API}/lists`)
      .set(orgHeaders(owner.agent, owner.orgId))
      .set("Content-Type", "application/json")
      .send(JSON.stringify({ name: "x", description: "y".repeat(2 * 1024 * 1024) }));
    expect(huge.status).toBe(413);
    expect(huge.body.error.code).toBe("PAYLOAD_TOO_LARGE");
  });
});

describe("signing key", () => {
  it("refuses to boot the API without JWT_PRIVATE_KEY (only the worker may run without it)", async () => {
    await expect(createApp({ ...process.env, JWT_PRIVATE_KEY: "" })).rejects.toThrow(
      /JWT_PRIVATE_KEY: Required by the API/,
    );
  });
});

describe("metrics endpoint", () => {
  it("serves Prometheus text to loopback callers outside production, outside the /api prefix", async () => {
    await h.agent().get(`${API}/health/live`).expect(200);
    const res = await h.agent().get("/metrics").expect(200);
    expect(res.headers["content-type"]).toMatch(/text\/plain/);
    expect(res.text).toMatch(/leadforge_http_requests_total\{[^}]*route="\/api\/v1\/health\/live"/);
    expect(res.text).toContain("leadforge_queue_jobs{");
    expect(res.text).toContain("leadforge_billing_payments_stuck");
    expect(res.text).toContain("leadforge_credits_negative_balances");
    expect(res.text).toContain("leadforge_jobs_unsettled{");
    expect(res.text).toContain("leadforge_overture_sync_last_success_timestamp_seconds");
    expect(res.text).toMatch(/service="api"/);
    // Never through the versioned API path the web app proxies.
    expect((await h.agent().get(`${API}/metrics`)).status).toBe(404);
  });

  it("requires the bearer token when METRICS_TOKEN is set", async () => {
    const token = "metrics-token-for-tests-0123456789";
    const other = await createHarness({ METRICS_TOKEN: token });
    try {
      expect((await other.agent().get("/metrics")).status).toBe(404);
      expect(
        (
          await other
            .agent()
            .get("/metrics")
            .set("Authorization", "Bearer wrong-token-wrong-token-xx")
        ).status,
      ).toBe(404);
      const ok = await other
        .agent()
        .get("/metrics")
        .set("Authorization", `Bearer ${token}`)
        .expect(200);
      expect(ok.text).toContain("leadforge_http_request_duration_seconds");
    } finally {
      await other.close();
    }
  });
});
