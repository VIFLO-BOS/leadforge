import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RETRY_AFTER_DETAIL_PATH } from "@leadforge/contracts";
import { ApiError, apiFetch } from "@/lib/api";
import { signInErrorMessage } from "@/lib/errors";
import { SIGNED_OUT_EVENT, resetSessionState, safeReturnPath, signInUrl } from "@/lib/session";
import { SessionWatcher } from "@/components/session-watcher";
import { setLocation } from "./phase3-helpers";

type Reply = { status: number; body?: unknown };

/** A fetch stub that answers from per-path queues and records every call in order. */
function stubFetch(routes: Record<string, Reply[] | ((n: number) => Reply)>) {
  const calls: string[] = [];
  const counts: Record<string, number> = {};
  const fn = vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const path = new URL(String(input), "http://localhost").pathname.replace(/^\/api\/v1/, "");
    calls.push(`${(init.method ?? "GET").toUpperCase()} ${path}`);
    counts[path] = (counts[path] ?? 0) + 1;
    const r = routes[path];
    const reply: Reply =
      typeof r === "function"
        ? r(counts[path]!)
        : (r?.[Math.min(counts[path]! - 1, (r?.length ?? 1) - 1)] ?? {
            status: 404,
            body: { error: { code: "NOT_FOUND", message: "x", requestId: "t" } },
          });
    return new Response(reply.body === undefined ? null : JSON.stringify(reply.body), {
      status: reply.status,
      headers: { "content-type": "application/json" },
    });
  });
  vi.stubGlobal("fetch", fn);
  return { fn, calls };
}

const unauth = {
  status: 401,
  body: { error: { code: "UNAUTHENTICATED", message: "Sign in required", requestId: "t" } },
};
const expired = {
  status: 401,
  body: { error: { code: "TOKEN_EXPIRED", message: "Expired", requestId: "t" } },
};
const ok = (data: unknown) => ({ status: 200, body: { data } });

let signedOut = 0;
const onSignedOut = () => {
  signedOut += 1;
};

beforeEach(() => {
  resetSessionState();
  signedOut = 0;
  window.addEventListener(SIGNED_OUT_EVENT, onSignedOut);
});
afterEach(() => {
  window.removeEventListener(SIGNED_OUT_EVENT, onSignedOut);
  vi.unstubAllGlobals();
});

describe("401 handling: refresh once, then signed out", () => {
  it("an expired token is refreshed once and the request repeated once", async () => {
    const api = stubFetch({
      "/credits/balance": [expired, ok({ balance: 5 })],
      "/auth/refresh": [ok({ refreshed: true })],
    });
    await expect(apiFetch<{ balance: number }>("/credits/balance")).resolves.toEqual({
      balance: 5,
    });
    expect(api.calls).toEqual([
      "GET /credits/balance",
      "POST /auth/refresh",
      "GET /credits/balance",
    ]);
    expect(signedOut).toBe(0);
  });

  it("a 401 that survives the refresh means signed out, signalled once, with no loop", async () => {
    const api = stubFetch({ "/credits/balance": () => unauth, "/auth/refresh": [unauth] });
    await expect(apiFetch("/credits/balance")).rejects.toMatchObject({
      code: "UNAUTHENTICATED",
      status: 401,
    });
    expect(api.calls).toEqual(["GET /credits/balance", "POST /auth/refresh"]);
    expect(signedOut).toBe(1);
    // Later 401s neither refresh again nor signal again (revoked sessions fail at once).
    await expect(apiFetch("/credits/balance")).rejects.toBeInstanceOf(ApiError);
    await expect(apiFetch("/credits/balance")).rejects.toBeInstanceOf(ApiError);
    expect(api.calls.filter((c) => c === "POST /auth/refresh")).toHaveLength(1);
    expect(signedOut).toBe(1);
  });

  it("a refresh that succeeds but whose retry is still 401 signs out without refreshing again", async () => {
    const api = stubFetch({ "/auth/me": () => unauth, "/auth/refresh": [ok({ refreshed: true })] });
    await expect(apiFetch("/auth/me", { noOrg: true })).rejects.toMatchObject({ status: 401 });
    expect(api.calls).toEqual(["GET /auth/me", "POST /auth/refresh", "GET /auth/me"]);
    expect(signedOut).toBe(1);
  });

  it("concurrent 401s share one refresh", async () => {
    const api = stubFetch({
      "/a": [unauth, ok(1)],
      "/b": [unauth, ok(2)],
      "/c": [unauth, ok(3)],
      "/auth/refresh": [ok({ refreshed: true })],
    });
    await expect(Promise.all([apiFetch("/a"), apiFetch("/b"), apiFetch("/c")])).resolves.toEqual([
      1, 2, 3,
    ]);
    expect(api.calls.filter((c) => c === "POST /auth/refresh")).toHaveLength(1);
  });

  it("auth endpoints never trigger a refresh", async () => {
    const api = stubFetch({
      "/auth/login": [
        {
          status: 401,
          body: { error: { code: "INVALID_CREDENTIALS", message: "No", requestId: "t" } },
        },
      ],
    });
    await expect(apiFetch("/auth/login", { method: "POST", body: {} })).rejects.toMatchObject({
      code: "INVALID_CREDENTIALS",
    });
    expect(api.calls).toEqual(["POST /auth/login"]);
    expect(signedOut).toBe(0);
  });

  it("a refresh the server cannot check (5xx) keeps the session and reports the 401", async () => {
    const api = stubFetch({ "/x": () => unauth, "/auth/refresh": [{ status: 503 }] });
    await expect(apiFetch("/x")).rejects.toMatchObject({ status: 401 });
    expect(api.calls).toEqual(["GET /x", "POST /auth/refresh"]);
    expect(signedOut).toBe(0);
  });

  it("a successful sign-in clears the signed-out latch", async () => {
    const api = stubFetch({
      "/x": [unauth, unauth, expired, ok("fine")],
      "/auth/refresh": [unauth, ok({ refreshed: true })],
      "/auth/login": [ok({ user: {} })],
    });
    await expect(apiFetch("/x")).rejects.toBeInstanceOf(ApiError);
    expect(signedOut).toBe(1);
    await apiFetch("/auth/login", { method: "POST", body: {} });
    await expect(apiFetch("/x")).rejects.toBeInstanceOf(ApiError);
    await expect(apiFetch("/x")).resolves.toBe("fine");
    expect(api.calls.filter((c) => c === "POST /auth/refresh")).toHaveLength(2);
  });
});

describe("signed-out navigation", () => {
  it("clears client state and replaces the page with sign-in and a same-origin return path", async () => {
    setLocation("/app/pipeline?stage=won");
    window.localStorage.setItem("lf.activeOrg", "org-1");
    window.sessionStorage.setItem("lf.discoveryDraft.org-1", "{}");
    const navigate = vi.fn();
    const client = new QueryClient();
    client.setQueryData(["org", "org-1", "credits"], { balance: 1 });
    render(
      <QueryClientProvider client={client}>
        <SessionWatcher navigate={navigate} />
      </QueryClientProvider>,
    );
    act(() => {
      window.dispatchEvent(new Event(SIGNED_OUT_EVENT));
    });
    expect(navigate).toHaveBeenCalledWith("/sign-in?next=%2Fapp%2Fpipeline%3Fstage%3Dwon");
    expect(client.getQueryData(["org", "org-1", "credits"])).toBeUndefined();
    expect(window.localStorage.getItem("lf.activeOrg")).toBeNull();
    expect(window.sessionStorage.getItem("lf.discoveryDraft.org-1")).toBeNull();
  });

  it("does not navigate away from pages outside the dashboard", () => {
    setLocation("/invite/abc");
    const navigate = vi.fn();
    render(
      <QueryClientProvider client={new QueryClient()}>
        <SessionWatcher navigate={navigate} />
      </QueryClientProvider>,
    );
    act(() => {
      window.dispatchEvent(new Event(SIGNED_OUT_EVENT));
    });
    expect(navigate).not.toHaveBeenCalled();
  });

  it("return paths stay on this origin", () => {
    expect(safeReturnPath("/app/billing?tab=plans")).toBe("/app/billing?tab=plans");
    expect(safeReturnPath("//evil.example")).toBeNull();
    expect(safeReturnPath("/\\evil.example")).toBeNull();
    expect(safeReturnPath("/\t/evil.example")).toBeNull();
    expect(safeReturnPath("https://evil.example/app")).toBeNull();
    expect(safeReturnPath("/sign-in?next=/app")).toBeNull();
    expect(safeReturnPath(null)).toBeNull();
    expect(signInUrl("/app")).toBe("/sign-in?next=%2Fapp");
    expect(signInUrl("//evil.example")).toBe("/sign-in");
  });
});

describe("sign-in rate limits", () => {
  it("explains the per-account pause with the wait from the payload", () => {
    const err = new ApiError({
      code: "RATE_LIMITED",
      status: 429,
      message: "Too many failed sign-in attempts for this account. Try again in 15 minutes.",
      retryAfter: 60,
    });
    const m = signInErrorMessage(err);
    expect(m.title).toBe("Sign-in is paused for this account");
    expect(m.message).toContain("even with the right password");
    expect(m.message).toContain("Try again in 15 minutes.");
  });

  it("prefers the retryAfterSeconds detail, and falls back to Retry-After for the per-address limit", () => {
    const detail = new ApiError({
      code: "RATE_LIMITED",
      status: 429,
      message: "Too many failed sign-in attempts for this account. Try again in 15 minutes.",
      details: [{ path: RETRY_AFTER_DETAIL_PATH, message: "540" }],
      retryAfter: 540,
    });
    // The detail carries the real remaining lock (9 minutes), not the full 15.
    expect(signInErrorMessage(detail).message).toContain("Try again in 9 minutes.");
    const perIpDetail = new ApiError({
      code: "RATE_LIMITED",
      status: 429,
      message: "Too many requests. Try again shortly",
      details: [{ path: "retryAfterSeconds", message: "37" }],
      retryAfter: 37,
    });
    expect(signInErrorMessage(perIpDetail).message).toBe(
      "Too many attempts from this network. Try again in 37 seconds.",
    );
    const perIp = new ApiError({
      code: "RATE_LIMITED",
      status: 429,
      message: "Too many requests. Try again shortly",
      retryAfter: 45,
    });
    expect(signInErrorMessage(perIp)).toEqual({
      title: "Too many sign-in attempts",
      message: "Too many attempts from this network. Try again in 45 seconds.",
    });
  });
});
