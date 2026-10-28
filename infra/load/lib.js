// Shared helpers for the k6 load tests (infra/load/README.md). Plain k6 JavaScript, no npm.
import http from "k6/http";
import { check, fail } from "k6";

export const BASE_URL = (__ENV.BASE_URL || "http://host.docker.internal:4200").replace(/\/$/, "");
export const API = `${BASE_URL}/api/v1`;

/**
 * Signs in once (setup) and returns what every virtual user needs: the access cookie, the CSRF
 * token and the organization id. Sign-in is limited to 10 per minute per address, so the load
 * scripts never sign in per iteration.
 */
export function signIn() {
  const email = __ENV.EMAIL || "perf-owner@example.test";
  const password = __ENV.PASSWORD;
  if (!password) fail("Set PASSWORD (the perf seed's owner password)");
  const res = http.post(`${API}/auth/login`, JSON.stringify({ email, password }), {
    headers: { "Content-Type": "application/json" },
    tags: { name: "login" },
  });
  if (!check(res, { "signed in": (r) => r.status === 200 }))
    fail(`Sign-in failed: ${res.status} ${res.body}`);
  const access = res.cookies.lf_access && res.cookies.lf_access[0].value;
  const csrf = res.cookies.lf_csrf && res.cookies.lf_csrf[0].value;
  const body = res.json();
  const org = __ENV.ORG_ID || body.data.organizations[0].id;
  return { access, csrf, org };
}

export function headers(session, extra) {
  return Object.assign(
    {
      Cookie: `lf_access=${session.access}; lf_csrf=${session.csrf}`,
      "X-Organization-Id": session.org,
      "X-CSRF-Token": session.csrf,
      "Content-Type": "application/json",
    },
    extra || {},
  );
}

export function uuid() {
  // RFC 4122 version 4 from Math.random: fine for Idempotency-Key in a load test.
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
}
