import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { ACCESS_COOKIE, CSRF_COOKIE, CSRF_HEADER, REFRESH_COOKIE } from "@leadforge/contracts";
import {
  API,
  createHarness,
  csrfFrom,
  registerUser,
  verifyEmail,
  type Harness,
} from "./harness.js";

let h: Harness;

beforeAll(async () => {
  h = await createHarness();
});
afterAll(async () => h?.close());
beforeEach(async () => h.resetState());

describe("registration and login", () => {
  it("registers, sets auth cookies and returns the user with an owner membership", async () => {
    const agent = h.agent();
    const res = await agent
      .post(`${API}/auth/register`)
      .send({
        email: "ada@example.test",
        password: "Str0ng-Passw0rd-Example!",
        name: "Ada",
        organizationName: "Ada Labs",
        country: "NG",
      })
      .expect(201);
    const cookies = res.headers["set-cookie"] as unknown as string[];
    expect(cookies.some((c) => c.startsWith(`${ACCESS_COOKIE}=`) && /HttpOnly/i.test(c))).toBe(
      true,
    );
    expect(
      cookies.some((c) => c.startsWith(`${REFRESH_COOKIE}=`) && c.includes("Path=/api/v1/auth")),
    ).toBe(true);
    expect(cookies.some((c) => c.startsWith(`${CSRF_COOKIE}=`) && !/HttpOnly/i.test(c))).toBe(true);
    expect(res.body.data.user.email).toBe("ada@example.test");
    expect(res.body.data.user.emailVerifiedAt).toBeNull();
    expect(res.body.data.organizations).toHaveLength(1);
    expect(res.body.data.organizations[0].role).toBe("owner");

    const me = await agent.get(`${API}/auth/me`).expect(200);
    expect(me.body.data.user.id).toBe(res.body.data.user.id);
  });

  it("rejects weak and common passwords with field-level details", async () => {
    const res = await h
      .agent()
      .post(`${API}/auth/register`)
      .send({
        email: "weak@example.test",
        password: "password123",
        name: "W",
        organizationName: "W Org",
      })
      .expect(400);
    expect(res.body.error.code).toBe("VALIDATION_FAILED");
    expect(res.body.error.details[0].path).toBe("password");
    expect(res.body.error.requestId).toBeTruthy();
  });

  it("returns a generic conflict for duplicate emails", async () => {
    await registerUser(h.agent(), { email: "dup@example.test" });
    const res = await h
      .agent()
      .post(`${API}/auth/register`)
      .send({
        email: "dup@example.test",
        password: "Str0ng-Passw0rd-Example!",
        name: "D",
        organizationName: "D Org",
      })
      .expect(409);
    expect(res.body.error.code).toBe("CONFLICT");
  });

  it("rejects wrong passwords without revealing whether the account exists", async () => {
    await registerUser(h.agent(), { email: "login@example.test" });
    const bad = await h
      .agent()
      .post(`${API}/auth/login`)
      .send({ email: "login@example.test", password: "wrong-password-1" })
      .expect(401);
    const missing = await h
      .agent()
      .post(`${API}/auth/login`)
      .send({ email: "nobody@example.test", password: "wrong-password-1" })
      .expect(401);
    expect(bad.body.error.code).toBe("INVALID_CREDENTIALS");
    expect(missing.body.error.message).toBe(bad.body.error.message);
  });

  it("requires authentication for /auth/me", async () => {
    const res = await h.agent().get(`${API}/auth/me`).expect(401);
    expect(res.body.error.code).toBe("UNAUTHENTICATED");
  });
});

describe("email verification", () => {
  it("verifies via the token sent in the queued email and updates the session claim", async () => {
    const agent = h.agent();
    const me = await registerUser(agent, { email: "verify@example.test" });
    const orgId = me.organizations[0]!.id;

    const blocked = await agent
      .get(`${API}/organizations/current`)
      .set("X-Organization-Id", orgId)
      .expect(403);
    expect(blocked.body.error.code).toBe("EMAIL_NOT_VERIFIED");

    await verifyEmail(h, agent, "verify@example.test");

    const after = await agent.get(`${API}/auth/me`).expect(200);
    expect(after.body.data.user.emailVerifiedAt).not.toBeNull();
    await agent.get(`${API}/organizations/current`).set("X-Organization-Id", orgId).expect(200);
  });

  it("rejects an unknown or reused verification token", async () => {
    const agent = h.agent();
    await registerUser(agent, { email: "reuse@example.test" });
    const token = await h.tokenFromMail("reuse@example.test", "/verify-email");
    await agent
      .post(`${API}/auth/verify-email`)
      .set(CSRF_HEADER, csrfFrom(agent))
      .send({ token })
      .expect(200);
    const again = await agent
      .post(`${API}/auth/verify-email`)
      .set(CSRF_HEADER, csrfFrom(agent))
      .send({ token })
      .expect(400);
    expect(again.body.error.code).toBe("INVALID_TOKEN");
  });
});

describe("CSRF", () => {
  it("rejects cookie-authenticated mutations without the CSRF header", async () => {
    const agent = h.agent();
    await registerUser(agent, { email: "csrf@example.test" });
    const res = await agent.post(`${API}/auth/logout`).expect(403);
    expect(res.body.error.code).toBe("CSRF_FAILED");
  });

  it("rejects a CSRF token from a different session", async () => {
    const a = h.agent();
    const b = h.agent();
    await registerUser(a, { email: "csrf-a@example.test" });
    await registerUser(b, { email: "csrf-b@example.test" });
    const res = await a.post(`${API}/auth/logout`).set(CSRF_HEADER, csrfFrom(b)).expect(403);
    expect(res.body.error.code).toBe("CSRF_FAILED");
  });

  it("accepts mutations with the matching CSRF header", async () => {
    const agent = h.agent();
    await registerUser(agent, { email: "csrf-ok@example.test" });
    await agent.post(`${API}/auth/logout`).set(CSRF_HEADER, csrfFrom(agent)).expect(204);
    await agent.get(`${API}/auth/me`).expect(401);
  });
});

describe("refresh token rotation", () => {
  function refreshCookie(agent: ReturnType<Harness["agent"]>): string {
    const jar = (
      agent as unknown as {
        jar: { getCookies: (o: object) => Array<{ name: string; value: string }> };
      }
    ).jar;
    const c = jar
      .getCookies({ domain: "127.0.0.1", path: "/api/v1/auth", secure: false, script: false })
      .find((x) => x.name === REFRESH_COOKIE);
    if (!c) throw new Error("no refresh cookie");
    return c.value;
  }

  it("rotates on refresh and revokes the whole family when an old token is replayed", async () => {
    const agent = h.agent();
    await registerUser(agent, { email: "rotate@example.test" });
    const first = refreshCookie(agent);

    await agent.post(`${API}/auth/refresh`).expect(200);
    const second = refreshCookie(agent);
    expect(second).not.toBe(first);
    await agent.get(`${API}/auth/me`).expect(200);

    // Replay the first (now revoked) token from a fresh client.
    const attacker = h.agent();
    const replay = await attacker
      .post(`${API}/auth/refresh`)
      .set("Cookie", `${REFRESH_COOKIE}=${first}`)
      .expect(401);
    expect(replay.body.error.code).toBe("UNAUTHENTICATED");

    // The legitimate client's current refresh token is now dead too.
    await agent.post(`${API}/auth/refresh`).expect(401);
  });
});

describe("password reset", () => {
  it("resets with the emailed token, revokes sessions, and rejects the token afterwards", async () => {
    const agent = h.agent();
    await registerUser(agent, { email: "reset@example.test", password: "Original-Passw0rd-123!" });
    await h
      .agent()
      .post(`${API}/auth/forgot-password`)
      .send({ email: "reset@example.test" })
      .expect(202);
    await h
      .agent()
      .post(`${API}/auth/forgot-password`)
      .send({ email: "ghost@example.test" })
      .expect(202);

    const token = await h.tokenFromMail("reset@example.test", "/reset-password");
    await h
      .agent()
      .post(`${API}/auth/reset-password`)
      .send({ token, password: "Brand-New-Passw0rd-456!" })
      .expect(200);

    await agent.get(`${API}/auth/me`).expect(200); // access token still valid until expiry
    await agent.post(`${API}/auth/refresh`).expect(401); // but the session is revoked

    await h
      .agent()
      .post(`${API}/auth/login`)
      .send({ email: "reset@example.test", password: "Original-Passw0rd-123!" })
      .expect(401);
    await h
      .agent()
      .post(`${API}/auth/login`)
      .send({ email: "reset@example.test", password: "Brand-New-Passw0rd-456!" })
      .expect(200);

    const reused = await h
      .agent()
      .post(`${API}/auth/reset-password`)
      .send({ token, password: "Another-Passw0rd-789!" })
      .expect(400);
    expect(reused.body.error.code).toBe("INVALID_TOKEN");
  });
});

describe("sessions", () => {
  it("lists active sessions and revokes one", async () => {
    const agent = h.agent();
    const me = await registerUser(agent, { email: "sessions@example.test" });
    const other = h.agent();
    await other
      .post(`${API}/auth/login`)
      .send({ email: me.user.email, password: "Str0ng-Passw0rd-Example!" })
      .expect(200);

    const list = await agent.get(`${API}/auth/sessions`).expect(200);
    expect(list.body.data).toHaveLength(2);
    const current = list.body.data.find((s: { current: boolean }) => s.current);
    const foreign = list.body.data.find((s: { current: boolean }) => !s.current);
    expect(current).toBeTruthy();

    await agent
      .delete(`${API}/auth/sessions/${foreign.id}`)
      .set(CSRF_HEADER, csrfFrom(agent))
      .expect(204);
    await other.post(`${API}/auth/refresh`).expect(401);
  });
});
