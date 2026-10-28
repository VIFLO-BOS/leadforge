/*
 * Session lifecycle in the browser (Phase 7 follow-up). The access token lives 15 minutes in an
 * httpOnly cookie; when it expires (or the browser drops the cookie) the API answers 401. The
 * client then asks POST /auth/refresh once, shared by every request that failed at the same time,
 * and repeats each failed request at most once. A 401 that survives that refresh means the
 * session is gone (signed out elsewhere, revoked, password reset): the client signals "signed out"
 * once, and the dashboard clears its state and goes to sign-in with a same-origin return path.
 */

/** Window event fired once when a 401 survives the refresh attempt. */
export const SIGNED_OUT_EVENT = "lf:signed-out";

/** Auth endpoints that never trigger a refresh (they establish or end the session themselves). */
const NO_REFRESH_PATHS = new Set([
  "/auth/refresh",
  "/auth/login",
  "/auth/register",
  "/auth/logout",
  "/auth/forgot-password",
  "/auth/reset-password",
  "/auth/verify-email",
]);

/** Paths whose success starts a new session, which clears the signed-out latch. */
const SESSION_START_PATHS = new Set(["/auth/login", "/auth/register"]);

export function refreshesOn401(path: string): boolean {
  return !NO_REFRESH_PATHS.has(path.split("?")[0] ?? path);
}

export function startsSession(path: string): boolean {
  return SESSION_START_PATHS.has(path.split("?")[0] ?? path);
}

export type RefreshOutcome =
  /** New cookies were set: repeat the request once. */
  | "refreshed"
  /** The refresh token is missing, expired or revoked: the session is over. */
  | "signed_out"
  /** The refresh could not be checked (network, 5xx, rate limit): keep the session, report the error. */
  | "unavailable";

interface SessionState {
  inFlight: Promise<RefreshOutcome> | null;
  /** Latched after the first signed-out signal, so later 401s neither refresh nor signal again. */
  signedOut: boolean;
}

const state: SessionState = { inFlight: null, signedOut: false };

/** Test hook: forget the latch and any refresh in flight. */
export function resetSessionState(): void {
  state.inFlight = null;
  state.signedOut = false;
}

export function isSignedOutLatched(): boolean {
  return state.signedOut;
}

/**
 * One refresh for every caller that hit a 401 at the same time. `doRefresh` performs the request
 * (injected so the module has no fetch of its own and tests can count calls).
 */
export function refreshOnce(doRefresh: () => Promise<Response>): Promise<RefreshOutcome> {
  if (state.signedOut) return Promise.resolve("signed_out");
  if (state.inFlight) return state.inFlight;
  const run = (async (): Promise<RefreshOutcome> => {
    try {
      const res = await doRefresh();
      if (res.ok) return "refreshed";
      if (res.status >= 500 || res.status === 429) return "unavailable";
      return "signed_out";
    } catch {
      return "unavailable";
    }
  })();
  state.inFlight = run;
  void run.finally(() => {
    if (state.inFlight === run) state.inFlight = null;
  });
  return run;
}

/** Signals "signed out" once per session; later calls are ignored until a new sign-in. */
export function notifySignedOut(): void {
  if (state.signedOut) return;
  state.signedOut = true;
  if (typeof window !== "undefined") window.dispatchEvent(new Event(SIGNED_OUT_EVENT));
}

/** A successful sign-in or sign-up starts a new session. */
export function noteSessionStarted(): void {
  state.signedOut = false;
}

const AUTH_PAGES = ["/sign-in", "/sign-up", "/forgot-password", "/reset-password", "/verify-email"];

/**
 * A return path that is safe to navigate to after sign-in: a same-origin path (with its query),
 * never a protocol-relative or backslash trick (`//evil`, `/\evil`), never an auth page.
 * Returns null when the value is not safe.
 */
export function safeReturnPath(
  value: string | null | undefined,
  origin = "http://localhost",
): string | null {
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.includes("\\"))
    return null;
  // Control characters (tab, newline) are stripped by URL parsing and can smuggle "//".
  for (let i = 0; i < value.length; i++) {
    const c = value.charCodeAt(i);
    if (c < 0x20 || c === 0x7f) return null;
  }
  try {
    const base = new URL(origin);
    const url = new URL(value, base);
    if (url.origin !== base.origin) return null;
    if (AUTH_PAGES.some((p) => url.pathname === p || url.pathname.startsWith(`${p}/`))) return null;
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return null;
  }
}

/** `/sign-in?next=<path>` for the current page (or plain `/sign-in` when the path is not safe). */
export function signInUrl(returnTo: string | null | undefined, origin?: string): string {
  const safe = safeReturnPath(returnTo, origin);
  return safe ? `/sign-in?next=${encodeURIComponent(safe)}` : "/sign-in";
}
