import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { call, csrfToken, primaryOrg, releaseOnly, sessionFor } from "./helpers";

/*
 * Criterion 16: critical security, tenant-isolation, billing and workflow tests pass. The backend
 * proves it route by route (apps/api/test, CI `integration` job); this spec checks the same
 * guarantees from the browser against the built web app and API, and that this release suite is
 * itself wired into CI:
 *   - signed out, the workspace redirects to sign-in and the API answers 401;
 *   - a state-changing call without the CSRF token, or from another site, is refused;
 *   - the Paystack webhook refuses a body without a valid signature;
 *   - the web and the API send their security headers;
 *   - .github/workflows/ci.yml runs `pnpm e2e:release` (criteria 1 to 16 on every pull request).
 * Tenant isolation through the UI is criterion 2; billing and workflows are criteria 3 to 14.
 */

test.describe("C16 critical security checks through the browser, and the suite in CI", () => {
  releaseOnly();

  test("C16 signed-out redirects, CSRF and cross-site refusals, webhook signatures, security headers", async ({
    browser,
    request,
  }, info) => {
    // 1. Signed out: the workspace sends you to sign in with a safe return path; the API says 401.
    const anonymous = await browser.newContext({ ...info.project.use });
    try {
      const page = await anonymous.newPage();
      await page.goto("/app/businesses?q=x");
      await page.waitForURL(/\/sign-in\?/);
      expect(new URL(page.url()).searchParams.get("next")).toBe("/app/businesses?q=x");
      expect((await page.request.get("/api/v1/auth/me")).status()).toBe(401);
      expect((await page.request.get("/api/v1/businesses")).status()).toBe(401);
    } finally {
      await anonymous.close();
    }

    const { context, page } = await sessionFor(browser, info, "owner");
    try {
      await page.goto("/app");
      const org = await primaryOrg(page);
      const body = {
        name: "E2E CSRF probe (Sample)",
        location: { locality: "Ikeja", region: "Lagos" },
        categories: ["Retail"],
      };

      // 2. CSRF: the double-submit token is required, and cross-site requests are refused.
      const noToken = await page.request.fetch("/api/v1/businesses", {
        method: "POST",
        headers: { "X-Organization-Id": org.id },
        data: body,
      });
      expect(noToken.status()).toBe(403);
      expect(((await noToken.json()) as { error: { code: string } }).error.code).toBe(
        "CSRF_FAILED",
      );
      const crossSite = await page.request.fetch("/api/v1/businesses", {
        method: "POST",
        headers: {
          "X-Organization-Id": org.id,
          "X-CSRF-Token": await csrfToken(page),
          Origin: "https://attacker.example",
          "Sec-Fetch-Site": "cross-site",
        },
        data: body,
      });
      expect(crossSite.status()).toBe(403);
      expect(((await crossSite.json()) as { error: { code: string } }).error.code).toBe(
        "CSRF_FAILED",
      );
      const probes = await call(
        page,
        "GET",
        `/businesses?q=${encodeURIComponent("E2E CSRF probe")}`,
        org.id,
      );
      expect(((await probes.json()) as { data: unknown[] }).data).toHaveLength(0);

      // 3. The webhook refuses an unsigned or wrongly signed body.
      const event = JSON.stringify({
        event: "charge.success",
        data: {
          reference: "lf-forged-reference",
          amount: 500000,
          currency: "NGN",
          status: "success",
        },
      });
      const unsigned = await request.post("/api/v1/webhooks/paystack", {
        headers: { "content-type": "application/json" },
        data: event,
      });
      expect([400, 401, 403]).toContain(unsigned.status());
      const forged = await request.post("/api/v1/webhooks/paystack", {
        headers: { "content-type": "application/json", "x-paystack-signature": "0".repeat(128) },
        data: event,
      });
      expect([400, 401, 403]).toContain(forged.status());

      // 4. Security headers on the web app and the API.
      const html = await page.request.get("/app");
      expect(html.headers()["x-frame-options"]).toBe("DENY");
      expect(html.headers()["x-content-type-options"]).toBe("nosniff");
      expect(html.headers()["content-security-policy"]).toContain("frame-ancestors 'none'");
      const meResponse = await page.request.get("/api/v1/auth/me");
      expect(meResponse.headers()["cache-control"]).toContain("no-store");
      expect(meResponse.headers()["x-content-type-options"]).toBe("nosniff");
    } finally {
      await context.close();
    }
  });

  test("C16 the release suite runs in CI on pull requests to main and nightly", async () => {
    const workflow = readFileSync(resolve(process.cwd(), "../../.github/workflows/ci.yml"), "utf8");
    const job = workflow.slice(workflow.indexOf("e2e-release:"));
    expect(job, "an e2e-release job").toContain("pnpm e2e:release");
    expect(workflow).toMatch(/schedule:[\s\S]{0,160}- cron:/);
    expect(job).toContain("actions/upload-artifact");
  });
});
