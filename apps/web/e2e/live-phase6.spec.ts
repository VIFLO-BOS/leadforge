import { expect, test, type Page } from "@playwright/test";

/*
 * Live end-to-end for Phase 6 and the Phase 5 CRM gaps against a real API and worker. There are
 * no Paystack keys on this machine, so billing must show its honest "not configured" state:
 *   1. Billing: the not-configured banner, every purchase disabled with its reason, no fake price,
 *      the shell banner on other pages; a checkout attempt through the API is refused with
 *      BILLING_NOT_CONFIGURED and nothing is created;
 *   2. Settings → Pipeline stages: rename a stage and move it up with the keyboard, save, check the
 *      server's configuration, then restore the original configuration;
 *   3. Lead details: set a lead's priority and next action from its business page and read them
 *      back from the API.
 * Skipped unless E2E_LIVE=1; runs once, in the 1440px project. Sign-in from E2E_LIVE_EMAIL and
 * E2E_LIVE_PASSWORD (defaults to the seeded owner). Every record it creates is "(Sample)".
 */

const LIVE = process.env.E2E_LIVE === "1";
const EMAIL = process.env.E2E_LIVE_EMAIL ?? "owner@example.test";
const PASSWORD = process.env.E2E_LIVE_PASSWORD ?? "synthetic-owner-pass-2026";

interface Org {
  id: string;
  name: string;
  role: string;
}
interface Stage {
  key: string;
  label: string;
  kind: string;
  order: number;
  archived: boolean;
}
interface Config {
  version: number;
  stages: Stage[];
}

const byOrder = (stages: Stage[]) => [...stages].sort((a, b) => a.order - b.order);

async function csrf(page: Page): Promise<string> {
  const cookies = await page.context().cookies();
  return decodeURIComponent(cookies.find((c) => c.name === "lf_csrf")?.value ?? "");
}

async function call(
  page: Page,
  method: "GET" | "POST" | "PUT" | "PATCH",
  path: string,
  orgId: string,
  body?: unknown,
  extra: Record<string, string> = {},
) {
  const headers: Record<string, string> = { "X-Organization-Id": orgId, ...extra };
  if (method !== "GET") headers["X-CSRF-Token"] = await csrf(page);
  return page.request.fetch(`/api/v1${path}`, { method, headers, data: body });
}

async function api<T>(
  page: Page,
  method: "GET" | "POST" | "PUT" | "PATCH",
  path: string,
  orgId: string,
  body?: unknown,
): Promise<T> {
  const res = await call(page, method, path, orgId, body);
  expect(res.ok(), `${method} ${path} answered ${res.status()}: ${await res.text()}`).toBe(true);
  return ((await res.json()) as { data: T }).data;
}

test.describe("live: Phase 6 end to end", () => {
  test.skip(!LIVE, "Set E2E_LIVE=1 with the API and worker running to run the live spec.");
  test.setTimeout(300_000);

  test("billing not configured, pipeline stages (restored), lead details", async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== "w1440", "The live flow runs once, at 1440px.");
    const run = Date.now().toString(36);
    const main = page.locator("#main");

    await page.goto("/sign-in");
    await page.locator("input[type=email]").fill(EMAIL);
    await page.locator("input[type=password]").fill(PASSWORD);
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.waitForURL(/\/app$/, { timeout: 60_000 });
    const me = (await (await page.request.get("/api/v1/auth/me")).json()) as {
      data: { user: { id: string }; organizations: Org[] };
    };
    const org = me.data.organizations.find((o) => o.role === "owner");
    if (!org) throw new Error("The signed-in user is not an owner of any organization");
    await page.evaluate((id) => window.localStorage.setItem("lf.activeOrg", id), org.id);

    // 1. Billing without a payment provider.
    const overview = await api<{ provider: { configured: boolean }; pricingPublished: boolean }>(
      page,
      "GET",
      "/billing/overview",
      org.id,
    );
    expect(overview.provider.configured, "this live run expects no Paystack key").toBe(false);
    await page.goto("/app/billing");
    await expect(page.getByRole("heading", { level: 1, name: "Billing" })).toBeVisible();
    await expect(main.getByTestId("billing-not-configured")).toContainText(
      "Payments are not set up yet",
    );
    await expect(main.getByTestId("billing-plan-card")).toBeVisible();
    await page.getByRole("tab", { name: "Plans and credits" }).click();
    await expect(main.getByTestId("billing-not-configured")).toBeVisible();
    const buttons = await main.getByRole("button", { name: /^(Choose|Buy) / }).all();
    for (const b of buttons) await expect(b).toBeDisabled();
    if (buttons.length)
      await expect(main.getByTestId("purchase-blocked").first()).toContainText(
        "Payments are not set up yet",
      );
    // No placeholder or zero price is shown as a price.
    await expect(main).not.toContainText(/₦\s?0(\.00)?\b/);
    if (!overview.pricingPublished)
      await expect(main.getByText("Pricing not yet published").first()).toBeVisible();
    // The API refuses a checkout honestly; nothing is created.
    const plans = await api<{ creditPacks: { id: string }[] }>(
      page,
      "GET",
      "/billing/plans",
      org.id,
    );
    if (plans.creditPacks[0]) {
      const res = await call(
        page,
        "POST",
        "/billing/checkout/credits",
        org.id,
        { packId: plans.creditPacks[0].id },
        { "Idempotency-Key": `e2e-live-${run}` },
      );
      expect(res.status()).toBe(422);
      expect(((await res.json()) as { error: { code: string } }).error.code).toBe(
        "BILLING_NOT_CONFIGURED",
      );
    }
    // The shell banner explains it on other pages for owners.
    await page.goto("/app/team");
    await expect(page.getByTestId("billing-banners")).toBeVisible();

    // 2. Pipeline stages: rename and reorder, then restore.
    const original = await api<Config>(page, "GET", "/pipeline/config", org.id);
    const active = byOrder(original.stages).filter((s) => !s.archived);
    const third = active[2];
    if (!third || third.kind !== "open" || active[1]?.kind !== "open")
      throw new Error("Expected at least three open stages");
    const renamed = `${third.label.slice(0, 20)} ${run}`;
    try {
      await page.goto("/app/settings?tab=pipeline");
      await expect(main.getByTestId("pipeline-settings")).toBeVisible();
      const position = byOrder(original.stages).findIndex((s) => s.key === third.key) + 1;
      await main.getByLabel(`Stage ${position} name`).fill(renamed);
      const up = main.getByRole("button", { name: `Move ${renamed} up` });
      await up.focus();
      await page.keyboard.press("Enter");
      await expect(page.getByTestId("stages-announcer")).toHaveText(
        `Moved ${renamed} up to position ${position - 1} of ${original.stages.length}.`,
      );
      await main.getByRole("button", { name: "Save stages" }).click();
      await expect(page.getByText("Pipeline stages saved", { exact: true })).toBeVisible();
      const saved = await api<Config>(page, "GET", "/pipeline/config", org.id);
      expect(saved.version).toBe(original.version + 1);
      const moved = saved.stages.find((s) => s.key === third.key)!;
      expect(moved.label).toBe(renamed);
      expect(moved.order).toBe(third.order - 1);
      await page.goto("/app/pipeline");
      await expect(main.locator(`[data-stage="${third.key}"]`)).toContainText(renamed);
    } finally {
      // Restore the original names, order and archived flags on the current version.
      const current = await api<Config>(page, "GET", "/pipeline/config", org.id);
      if (current.version !== original.version) {
        await api<Config>(page, "PUT", "/pipeline/config", org.id, {
          version: current.version,
          stages: byOrder(original.stages).map((s) => ({
            key: s.key,
            label: s.label,
            archived: s.archived,
          })),
        });
      }
    }
    const restored = await api<Config>(page, "GET", "/pipeline/config", org.id);
    expect(byOrder(restored.stages).map((s) => [s.key, s.label, s.order, s.archived])).toEqual(
      byOrder(original.stages).map((s) => [s.key, s.label, s.order, s.archived]),
    );

    // 3. Lead details from the business page.
    const business = await api<{ id: string }>(page, "POST", "/businesses", org.id, {
      name: `E2E Lead Fields ${run} (Sample)`,
      phones: [`+23481${String(Date.now()).slice(-8)}`],
      location: { locality: "Ikeja", region: "Lagos" },
      categories: ["Retail"],
    });
    const lead = await api<{ id: string; version: number }>(
      page,
      "POST",
      "/pipeline/leads",
      org.id,
      { businessId: business.id },
    );
    await page.goto(`/app/businesses/${business.id}`);
    const panel = main.getByTestId("lead-panel");
    await panel.getByRole("button", { name: "Edit details…" }).click();
    const dialog = page.getByTestId("lead-details-dialog");
    await dialog.getByRole("combobox", { name: /Priority/ }).click();
    await page.getByRole("option", { name: "High priority" }).click();
    await dialog.getByLabel("Next action").fill("2026-12-01T10:00");
    await dialog.getByRole("button", { name: "Save details" }).click();
    await expect(panel.getByTestId("lead-priority")).toHaveText("High priority");
    const after = await api<{ priority: string; nextActionAt: string; version: number }>(
      page,
      "GET",
      `/pipeline/leads/${lead.id}`,
      org.id,
    );
    expect(after.priority).toBe("high");
    expect(new Date(after.nextActionAt).getTime()).toBe(new Date("2026-12-01T10:00").getTime());
    expect(after.version).toBeGreaterThan(lead.version);
  });
});
