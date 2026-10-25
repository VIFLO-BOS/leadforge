import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { API, createHarness, type Harness } from "./harness.js";

let h: Harness;

beforeAll(async () => {
  h = await createHarness();
});
afterAll(async () => h?.close());
beforeEach(async () => h.resetState());

describe("health", () => {
  it("reports liveness and readiness with per-dependency checks", async () => {
    await h.agent().get(`${API}/health/live`).expect(200);
    const ready = await h.agent().get(`${API}/health/ready`).expect(200);
    expect(ready.body.data.status).toBe("ok");
    expect(ready.body.data.checks.postgres.status).toBe("up");
    expect(ready.body.data.checks.mongo.status).toBe("up");
    expect(ready.body.data.checks.redis.status).toBe("up");
  });
});

describe("public endpoints", () => {
  it("returns plans with pricingPublished=false when none are configured", async () => {
    const res = await h.agent().get(`${API}/public/plans`).expect(200);
    expect(res.body.data.plans).toEqual([]);
    expect(res.body.data.pricingPublished).toBe(false);
  });

  it("stores contact submissions, drops honeypot hits, and rate limits", async () => {
    const payload = {
      name: "Ngozi",
      email: "ngozi@example.test",
      message: "I would like a demo of LeadForge please.",
    };
    await h.agent().post(`${API}/public/contact`).send(payload).expect(202);
    await h
      .agent()
      .post(`${API}/public/contact`)
      .send({ ...payload, website: "http://spam.example" })
      .expect(400); // max(0) fails validation
    expect(await h.prisma.contactSubmission.count()).toBe(1);

    await h.agent().post(`${API}/public/contact`).send(payload).expect(202);
    await h.agent().post(`${API}/public/contact`).send(payload).expect(202);
    const limited = await h.agent().post(`${API}/public/contact`).send(payload).expect(429);
    expect(limited.body.error.code).toBe("RATE_LIMITED");
    expect(limited.headers["retry-after"]).toBeTruthy();
  });

  it("never exposes stack traces: unknown routes map to NOT_FOUND envelope", async () => {
    const res = await h.agent().get(`${API}/does-not-exist`).expect(404);
    expect(res.body.error.code).toBe("NOT_FOUND");
    expect(res.body.error.requestId).toBeTruthy();
    expect(JSON.stringify(res.body)).not.toMatch(/at .*\.js/);
  });
});

describe("login throttling", () => {
  it("blocks after ten attempts per minute from one client", async () => {
    const agent = h.agent();
    let lastStatus = 0;
    for (let i = 0; i < 11; i++) {
      const res = await agent
        .post(`${API}/auth/login`)
        .send({ email: "nobody@example.test", password: "whatever-pass-1" });
      lastStatus = res.status;
    }
    expect(lastStatus).toBe(429);
  });
});
