import { describe, expect, it } from "vitest";
import { parseServerEnv } from "./env.js";

const valid = {
  APP_URL: "http://localhost:3000",
  API_URL: "http://localhost:4000",
  DATABASE_URL: "postgresql://x",
  MONGODB_URI: "mongodb://localhost",
  MONGODB_DB: "db",
  REDIS_URL: "redis://localhost",
  JWT_PRIVATE_KEY: "k",
  JWT_PUBLIC_KEY: "k",
  CSRF_SECRET: "0123456789abcdef0123456789abcdef",
  SMTP_URL: "smtp://localhost:1025",
  MAIL_FROM: "x@y.z",
};

describe("parseServerEnv", () => {
  it("accepts a valid environment and applies defaults", () => {
    const env = parseServerEnv(valid);
    expect(env.NODE_ENV).toBe("development");
    expect(env.API_PORT).toBe(4000);
    expect(env.JWT_ACCESS_TTL_SECONDS).toBe(900);
    expect(env.WORKER_QUEUES).toEqual([]);
  });

  it("parses the worker queue allowlist", () => {
    expect(parseServerEnv({ ...valid, WORKER_QUEUES: "mail, discovery" }).WORKER_QUEUES).toEqual([
      "mail",
      "discovery",
    ]);
  });

  it("rejects a short CSRF secret and names the field", () => {
    expect(() => parseServerEnv({ ...valid, CSRF_SECRET: "short" })).toThrow(/CSRF_SECRET/);
  });

  it("rejects a missing public key with a hint and lets the worker run without the signing key", () => {
    expect(() => parseServerEnv({ ...valid, JWT_PUBLIC_KEY: "" })).toThrow(/gen:keys/);
    // The API refuses to boot without JWT_PRIVATE_KEY (apps/api bootstrap); the worker never signs tokens.
    expect(parseServerEnv({ ...valid, JWT_PRIVATE_KEY: "" }).JWT_PRIVATE_KEY).toBeUndefined();
  });

  it("applies SafeFetch defaults: one request per 2 s per host, 10 per second overall, 10 s deadline", () => {
    const env = parseServerEnv(valid);
    expect(env.SAFE_FETCH_HOST_RPS).toBe(0.5);
    expect(env.SAFE_FETCH_GLOBAL_RPS).toBe(10);
    expect(env.SAFE_FETCH_TIMEOUT_MS).toBe(10_000);
    expect(env.SAFE_FETCH_USER_AGENT).toBeUndefined();
    expect(env.SAFE_FETCH_HOST_OVERRIDES).toBe("");
  });

  it("requires the SafeFetch user agent to start with a product token", () => {
    expect(
      parseServerEnv({ ...valid, SAFE_FETCH_USER_AGENT: "LeadForgeBot/1.0 (+https://x.test/bot)" })
        .SAFE_FETCH_USER_AGENT,
    ).toBe("LeadForgeBot/1.0 (+https://x.test/bot)");
    expect(() => parseServerEnv({ ...valid, SAFE_FETCH_USER_AGENT: "Mozilla" })).toThrow(
      /SAFE_FETCH_USER_AGENT/,
    );
  });

  it("refuses SafeFetch host overrides in production", () => {
    expect(
      parseServerEnv({ ...valid, SAFE_FETCH_HOST_OVERRIDES: "site.test=127.0.0.1:4299" })
        .SAFE_FETCH_HOST_OVERRIDES,
    ).toBe("site.test=127.0.0.1:4299");
    expect(() =>
      parseServerEnv({
        ...valid,
        NODE_ENV: "production",
        SAFE_FETCH_HOST_OVERRIDES: "site.test=127.0.0.1:4299",
      }),
    ).toThrow(/SAFE_FETCH_HOST_OVERRIDES/);
  });

  it("defaults the BullMQ queue prefix and validates it", () => {
    expect(parseServerEnv(valid).QUEUE_PREFIX).toBe("leadforge");
    expect(parseServerEnv({ ...valid, QUEUE_PREFIX: "dev-ada" }).QUEUE_PREFIX).toBe("dev-ada");
    expect(() => parseServerEnv({ ...valid, QUEUE_PREFIX: "has space" })).toThrow(/QUEUE_PREFIX/);
  });

  it("configures the Overture sync with safe defaults", () => {
    const env = parseServerEnv(valid);
    expect(env.OVERTURE_STAC_URL).toBe("https://stac.overturemaps.org/catalog.json");
    expect(env.OVERTURE_SYNC_SCHEDULE).toBeUndefined();
    expect(env.OVERTURE_SYNC_INTERVAL_MS).toBe(24 * 60 * 60 * 1000);
    expect(env.OVERTURE_PAGE_SIZE).toBe(100);
    expect(
      parseServerEnv({ ...valid, OVERTURE_SYNC_SCHEDULE: "true" }).OVERTURE_SYNC_SCHEDULE,
    ).toBe(true);
    expect(
      parseServerEnv({ ...valid, OVERTURE_SYNC_SCHEDULE: "" }).OVERTURE_SYNC_SCHEDULE,
    ).toBeUndefined();
    expect(() => parseServerEnv({ ...valid, OVERTURE_LOCAL_RELEASE: "latest" })).toThrow(
      /OVERTURE_LOCAL_RELEASE/,
    );
  });

  it("refuses local Overture files in production and needs both paths", () => {
    const local = {
      OVERTURE_LOCAL_PLACES_PATH: "C:/data/places.parquet",
      OVERTURE_LOCAL_DIVISIONS_PATH: "C:/data/divisions.parquet",
    };
    expect(parseServerEnv({ ...valid, ...local }).OVERTURE_LOCAL_PLACES_PATH).toBe(
      "C:/data/places.parquet",
    );
    expect(() => parseServerEnv({ ...valid, ...local, NODE_ENV: "production" })).toThrow(
      /OVERTURE_LOCAL_PLACES_PATH: Local Overture files are for development and tests only/,
    );
    expect(() =>
      parseServerEnv({ ...valid, OVERTURE_LOCAL_PLACES_PATH: "C:/data/places.parquet" }),
    ).toThrow(/OVERTURE_LOCAL_DIVISIONS_PATH/);
  });
  it("treats billing as not configured without a Paystack key and validates the key shape (Phase 6)", () => {
    const env = parseServerEnv(valid);
    expect(env.PAYSTACK_SECRET_KEY).toBeUndefined();
    expect(env.PAYSTACK_WEBHOOK_IP_ALLOWLIST).toEqual([]);
    expect(env.PAYSTACK_BASE_URL).toBe("https://api.paystack.co");
    expect(env.BILLING_PENDING_VERIFY_AFTER_MINUTES).toBe(20);
    expect(env.BILLING_PAST_DUE_GRACE_DAYS).toBe(7);
    expect(env.BILLING_FREE_MAX_MEMBERS).toBe(5);
    expect(
      parseServerEnv({ ...valid, PAYSTACK_SECRET_KEY: "" }).PAYSTACK_SECRET_KEY,
    ).toBeUndefined();
    expect(
      parseServerEnv({ ...valid, PAYSTACK_SECRET_KEY: "sk_test_abcdef0123456789" })
        .PAYSTACK_SECRET_KEY,
    ).toBe("sk_test_abcdef0123456789");
    expect(() =>
      parseServerEnv({ ...valid, PAYSTACK_SECRET_KEY: "pk_test_abcdef0123456789" }),
    ).toThrow(/PAYSTACK_SECRET_KEY/);
    expect(
      parseServerEnv({ ...valid, PAYSTACK_WEBHOOK_IP_ALLOWLIST: "52.31.139.75, 52.49.173.169" })
        .PAYSTACK_WEBHOOK_IP_ALLOWLIST,
    ).toEqual(["52.31.139.75", "52.49.173.169"]);
  });

  it("requires secure cookies in production and accepts a hardened production environment (Phase 7)", () => {
    const prod = {
      ...valid,
      NODE_ENV: "production",
      APP_URL: "https://app.example.test",
      API_URL: "https://api.example.test",
    };
    expect(() => parseServerEnv(prod)).toThrow(
      /COOKIE_SECURE: Production serves cookies over HTTPS only/,
    );
    const env = parseServerEnv({ ...prod, COOKIE_SECURE: "true" });
    expect(env.COOKIE_SECURE).toBe(true);
    expect(env.TRUST_PROXY_HOPS).toBe(1);
    expect(env.RATE_LIMIT_PER_MINUTE).toBe(600);
    expect(env.WORKER_METRICS_PORT).toBe(9464);
    expect(env.WORKER_METRICS_HOST).toBe("127.0.0.1");
    expect(env.METRICS_TOKEN).toBeUndefined();
  });

  it("validates the metrics token and refuses an open worker metrics server in production (Phase 7)", () => {
    expect(() => parseServerEnv({ ...valid, METRICS_TOKEN: "short" })).toThrow(/METRICS_TOKEN/);
    expect(parseServerEnv({ ...valid, METRICS_TOKEN: "" }).METRICS_TOKEN).toBeUndefined();
    const prod = {
      ...valid,
      NODE_ENV: "production",
      COOKIE_SECURE: "true",
      WORKER_METRICS_HOST: "0.0.0.0",
    };
    expect(() => parseServerEnv(prod)).toThrow(/METRICS_TOKEN: Set METRICS_TOKEN/);
    expect(parseServerEnv({ ...prod, METRICS_TOKEN: "x".repeat(32) }).WORKER_METRICS_HOST).toBe(
      "0.0.0.0",
    );
    expect(parseServerEnv({ ...prod, WORKER_METRICS_PORT: "0" }).WORKER_METRICS_PORT).toBe(0);
    expect(() => parseServerEnv({ ...valid, TRUST_PROXY_HOPS: "11" })).toThrow(/TRUST_PROXY_HOPS/);
  });

  it("only lets development and tests point Paystack at another origin", () => {
    expect(
      parseServerEnv({ ...valid, PAYSTACK_BASE_URL: "http://127.0.0.1:4299" }).PAYSTACK_BASE_URL,
    ).toBe("http://127.0.0.1:4299");
    expect(() =>
      parseServerEnv({
        ...valid,
        NODE_ENV: "production",
        PAYSTACK_BASE_URL: "http://127.0.0.1:4299",
      }),
    ).toThrow(/PAYSTACK_BASE_URL/);
  });
});
