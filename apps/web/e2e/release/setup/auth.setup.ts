import { expect, request, test } from "@playwright/test";
import { existsSync, mkdirSync } from "node:fs";
import {
  AUTH_DIR,
  PASSWORD,
  RELEASE,
  seededEmail,
  storageStatePath,
  type ProjectKey,
  type SeededRole,
} from "../helpers";

/*
 * Signs the seeded users in once and stores their sessions, so the criterion specs do not each
 * spend one of the API's 10 sign-ins per minute per address. A stored session that still answers
 * GET /auth/me is reused (a new stack has new signing keys, so its sessions never carry over). The
 * sign-in form itself is proved by criterion 1 (a new account) and by the smoke subset at 240, 768
 * and 1024 px. Stored sessions are only used by tests that never sign out.
 */

const SESSIONS: Array<[SeededRole, ProjectKey]> = [
  ["owner", "w1440"],
  ["rep", "w1440"],
  ["rival", "w1440"],
  ["owner", "w375"],
  ["rep", "w375"],
  ["rival", "w375"],
  ["owner", "smoke"],
];

test("sign in the seeded users", async ({ baseURL }) => {
  test.skip(!RELEASE, "Set E2E_RELEASE=1 with the release stack running (pnpm e2e:release).");
  test.setTimeout(5 * 60_000);
  mkdirSync(AUTH_DIR, { recursive: true });
  for (const [role, key] of SESSIONS) {
    const email = seededEmail(role, key);
    const path = storageStatePath(role, key);
    if (existsSync(path)) {
      const stored = await request.newContext({ baseURL, storageState: path });
      const res = await stored.get("/api/v1/auth/me");
      const ok =
        res.ok() &&
        ((await res.json()) as { data: { user: { email: string } } }).data.user.email === email;
      await stored.dispose();
      if (ok) continue;
    }
    for (let attempt = 1; ; attempt++) {
      const ctx = await request.newContext({ baseURL });
      const res = await ctx.post("/api/v1/auth/login", { data: { email, password: PASSWORD } });
      if (res.status() === 429 && attempt < 4) {
        // The per-address sign-in limit (10 per minute): wait it out rather than fail the run.
        const body = (await res.json()) as {
          error?: { details?: { path: string; message: string }[] };
        };
        const wait = Number(
          body.error?.details?.find((d) => d.path === "retryAfterSeconds")?.message ??
            res.headers()["retry-after"] ??
            60,
        );
        await ctx.dispose();
        await new Promise((r) => setTimeout(r, (Math.min(wait, 90) + 1) * 1000));
        continue;
      }
      expect(res.ok(), `sign-in of ${email} answered ${res.status()}: ${await res.text()}`).toBe(
        true,
      );
      await ctx.storageState({ path });
      await ctx.dispose();
      break;
    }
  }
});
