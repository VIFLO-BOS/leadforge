import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

/*
 * Live end-to-end for Phase 3: create a discovery job through the wizard, watch it reach a
 * terminal state, see its items and new businesses, check that the balance dropped by exactly
 * the captured amount and that the ledger shows the hold, capture and release, and that a
 * notification arrived.
 *
 * Needs a real API and worker behind the web server with a runnable discovery source (in
 * development: a loaded Overture snapshot or a source's fixture mode). Skipped unless
 * E2E_LIVE=1; runs once, in the 1440px project. It uses whichever source the API reports as
 * runnable; nothing here names a source. Override the search with E2E_LIVE_CATEGORY and
 * E2E_LIVE_LOCALITY, and the sign-in with E2E_LIVE_EMAIL and E2E_LIVE_PASSWORD.
 */

const LIVE = process.env.E2E_LIVE === "1";
const EMAIL = process.env.E2E_LIVE_EMAIL ?? "owner@example.test";
const PASSWORD = process.env.E2E_LIVE_PASSWORD ?? "synthetic-owner-pass-2026";
const CATEGORY = process.env.E2E_LIVE_CATEGORY ?? "Pharmacy";
const LOCALITY = process.env.E2E_LIVE_LOCALITY ?? "Ikeja";

interface Org {
  id: string;
  name: string;
  role: string;
}

async function api<T>(request: APIRequestContext, path: string, orgId: string): Promise<T> {
  const res = await request.get(`/api/v1${path}`, { headers: { "X-Organization-Id": orgId } });
  expect(res.ok(), `${path} answered ${res.status()}`).toBe(true);
  return ((await res.json()) as { data: T }).data;
}

/** The organization the owner can run discovery in with the most credits. */
async function pickOrg(page: Page): Promise<Org> {
  const me = await page.request.get("/api/v1/auth/me");
  const orgs = ((await me.json()) as { data: { organizations: Org[] } }).data.organizations.filter(
    (o) => ["owner", "admin", "researcher"].includes(o.role),
  );
  let best: { org: Org; balance: number } | null = null;
  for (const org of orgs) {
    const b = await api<{ balance: number }>(page.request, "/credits/balance", org.id);
    if (!best || b.balance > best.balance) best = { org, balance: b.balance };
  }
  if (!best) throw new Error("The signed-in user cannot run discovery in any organization");
  return best.org;
}

test.describe("live: discovery job end to end", () => {
  test.skip(!LIVE, "Set E2E_LIVE=1 with the API and worker running to run the live spec.");
  test.setTimeout(300_000);

  test("wizard, terminal state, items, credits, ledger and notification", async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== "w1440", "The live flow runs once, at 1440px.");
    const run = Date.now().toString(36);
    const jobName = `E2E Discovery ${run} (Sample)`;

    // Sign in and choose the workspace.
    await page.goto("/sign-in");
    await page.locator("input[type=email]").fill(EMAIL);
    await page.locator("input[type=password]").fill(PASSWORD);
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.waitForURL(/\/app$/, { timeout: 60_000 });
    const org = await pickOrg(page);
    await page.evaluate((id) => window.localStorage.setItem("lf.activeOrg", id), org.id);
    const before = await api<{ balance: number }>(page.request, "/credits/balance", org.id);
    const unreadBefore = await api<{ unread: number }>(
      page.request,
      "/notifications/unread-count",
      org.id,
    );

    // 1. The wizard.
    await page.goto("/app/discovery/new");
    await expect(page.getByText("Choose where to search")).toBeVisible({ timeout: 30_000 });
    const sources = await api<
      { key: string; name: string; runnable: boolean; statusDetail: string }[]
    >(page.request, "/discovery/sources", org.id);
    const runnable = sources.find((s) => s.runnable);
    expect(
      runnable,
      `No runnable discovery source: ${sources.map((s) => `${s.name}: ${s.statusDetail}`).join(" | ")}`,
    ).toBeTruthy();
    const box = page.getByRole("checkbox", { name: runnable!.name });
    await expect(box).toBeEnabled();
    if (!(await box.isChecked())) await box.check();
    for (const s of sources.filter((x) => !x.runnable)) {
      await expect(page.getByRole("checkbox", { name: s.name })).toBeDisabled();
    }
    await page.getByRole("button", { name: /Continue/ }).click();

    await expect(page.getByText("What to find, and where")).toBeVisible();
    await page.getByLabel("Category", { exact: true }).fill(CATEGORY);
    await page.getByLabel("Category", { exact: true }).press("Enter");
    await page.getByLabel("City or town").fill(LOCALITY);
    await page.getByLabel("Name").fill(jobName);
    await page.getByRole("button", { name: /Continue/ }).click();

    await expect(page.getByText("Set limits")).toBeVisible();
    await page.getByLabel("Maximum records").fill("8");
    await page.getByRole("button", { name: /Continue/ }).click();

    await expect(page.getByText("Check the estimate")).toBeVisible();
    await expect(page.getByTestId("estimate")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId("estimate-blockers")).toHaveCount(0);
    await page.getByRole("button", { name: /Continue/ }).click();
    await expect(page.getByRole("heading", { name: "Review and create" })).toBeVisible();
    await page.getByRole("button", { name: "Create discovery job" }).click();
    await page.waitForURL(/\/app\/discovery\/[a-f0-9]{24}$/, { timeout: 30_000 });
    const jobId = page.url().split("/").pop()!;
    await expect(page.getByRole("heading", { level: 1, name: jobName })).toBeVisible();

    // 2. Watch it to a terminal, settled state (the page polls every 2 seconds).
    await expect(page.getByTestId("job-status-line")).toHaveText(
      /^(Completed|Completed with warnings|Failed|Cancelled)(:|\.)(?!.*Settling)/,
      { timeout: 180_000 },
    );
    await expect(page.getByTestId("job-status")).toHaveText(/Completed/);
    const job = await api<{
      credits: { held: number; captured: number; released: number; settled: boolean };
      progress: { created: number; billable: number };
    }>(page.request, `/discovery/jobs/${jobId}`, org.id);
    expect(job.credits.settled).toBe(true);

    // 3. Items and the businesses they produced.
    const items = page.getByRole("table", { name: "Discovery job items" });
    await expect(items.getByRole("row").nth(1)).toBeVisible({ timeout: 30_000 });
    const businessLink = items.locator('a[href^="/app/businesses/"]').first();
    await expect(businessLink).toBeVisible();
    await businessLink.click();
    await page.waitForURL(/\/app\/businesses\/[a-f0-9]{24}$/);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole("link", { name: "View discovery job" })).toBeVisible();

    // 4. Credits: the balance dropped by exactly the captured amount; the ledger has the entries.
    const after = await api<{ balance: number; held: number }>(
      page.request,
      "/credits/balance",
      org.id,
    );
    expect(before.balance - after.balance).toBe(job.credits.captured);
    expect(job.credits.captured).toBe(job.progress.billable);
    await page.goto(`/app/usage?referenceId=${jobId}`);
    const ledger = page.getByRole("table", { name: "Credit ledger" });
    // One hold, one capture and one release per round; the release is written even when it is 0.
    await expect(ledger.locator('[data-entry-type="hold"]')).toHaveCount(1, { timeout: 30_000 });
    await expect(ledger.locator('[data-entry-type="capture"]')).toHaveCount(1);
    await expect(ledger.locator('[data-entry-type="release"]')).toHaveCount(1);
    await expect(ledger.getByText(`${job.credits.captured} charged from the hold`)).toBeVisible();
    const entries = await api<{ entryType: string; units: number; capturedUnits: number | null }[]>(
      page.request,
      `/credits/ledger?referenceId=${jobId}`,
      org.id,
    );
    const sum = (type: string) =>
      entries
        .filter((e) => e.entryType === type)
        .reduce((n, e) => n + (type === "capture" ? (e.capturedUnits ?? 0) : e.units), 0);
    expect(sum("hold")).toBe(-job.credits.held);
    expect(sum("capture")).toBe(job.credits.captured);
    expect(sum("release")).toBe(job.credits.released);
    await expect(page.getByTestId("credits-available")).toContainText(
      after.balance.toLocaleString(),
    );

    // 5. A notification for the finished job.
    const unreadAfter = await api<{ unread: number }>(
      page.request,
      "/notifications/unread-count",
      org.id,
    );
    expect(unreadAfter.unread).toBeGreaterThan(unreadBefore.unread);
    await page.reload();
    await page.getByRole("button", { name: /^Notifications, \d+ unread/ }).click();
    await expect(
      page.getByTestId("notification-panel").getByText(jobName, { exact: false }).first(),
    ).toBeVisible();
  });
});
