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

  it("rejects missing JWT keys with a hint", () => {
    expect(() => parseServerEnv({ ...valid, JWT_PRIVATE_KEY: "" })).toThrow(/gen:keys/);
  });
});
