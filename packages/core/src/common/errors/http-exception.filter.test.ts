import { describe, expect, it } from "vitest";
import type { ArgumentsHost } from "@nestjs/common";
import { ThrottlerException } from "@nestjs/throttler";
import type { Logger } from "nestjs-pino";
import { RETRY_AFTER_DETAIL_PATH, type ApiErrorBody } from "@leadforge/contracts";
import { AppError, wholeRetrySeconds } from "./app.error.js";
import { AppExceptionFilter } from "./http-exception.filter.js";
import { ThrottledException } from "../throttling/tracked-throttler.guard.js";

/** Runs the filter on one exception and returns the status, headers and body it wrote. */
function run(exception: unknown): {
  status: number;
  headers: Record<string, string>;
  body: ApiErrorBody;
} {
  const out = {
    status: 0,
    headers: {} as Record<string, string>,
    body: null as unknown as ApiErrorBody,
  };
  const res = {
    setHeader: (name: string, value: string) => void (out.headers[name.toLowerCase()] = value),
    status(code: number) {
      out.status = code;
      return this;
    },
    json: (body: ApiErrorBody) => void (out.body = body),
  };
  const req = { headers: {}, originalUrl: "/api/v1/x", method: "GET" };
  const host = {
    switchToHttp: () => ({ getResponse: () => res, getRequest: () => req }),
  } as unknown as ArgumentsHost;
  new AppExceptionFilter({ error: () => undefined } as unknown as Logger).catch(exception, host);
  return out;
}

describe("429 retry time (Stage 9)", () => {
  it("sends a known wait in Retry-After and the retryAfterSeconds detail", () => {
    const locked = run(
      AppError.rateLimited(
        "Too many failed sign-in attempts for this account. Try again in 9 minutes.",
        540,
      ),
    );
    expect(locked.status).toBe(429);
    expect(locked.headers["retry-after"]).toBe("540");
    expect(locked.body.error).toMatchObject({
      code: "RATE_LIMITED",
      details: [{ path: RETRY_AFTER_DETAIL_PATH, message: "540" }],
    });

    const throttled = run(new ThrottledException("ThrottlerException: Too Many Requests", 3599));
    expect(throttled.status).toBe(429);
    expect(throttled.headers["retry-after"]).toBe("3599");
    expect(throttled.body.error).toMatchObject({
      code: "RATE_LIMITED",
      message: "Too many requests. Try again shortly",
      details: [{ path: RETRY_AFTER_DETAIL_PATH, message: "3599" }],
    });
  });

  it("keeps a nominal minute and no detail when the wait is unknown", () => {
    for (const exception of [
      new AppError("RATE_LIMITED", "Verification email limit reached. Try again in an hour."),
      new ThrottlerException(),
    ]) {
      const res = run(exception);
      expect(res.status).toBe(429);
      expect(res.headers["retry-after"]).toBe("60");
      expect(res.body.error.details).toBeUndefined();
    }
    // Other statuses never get the header.
    expect(run(new AppError("FORBIDDEN")).headers["retry-after"]).toBeUndefined();
  });

  it("rounds waits up to whole seconds, at least one", () => {
    expect(wholeRetrySeconds(0)).toBe(1);
    expect(wholeRetrySeconds(0.2)).toBe(1);
    expect(wholeRetrySeconds(59.01)).toBe(60);
    expect(wholeRetrySeconds(Number.NaN)).toBe(1);
    expect(AppError.rateLimited("x", 12.5).retryAfterSeconds).toBe(13);
  });
});
