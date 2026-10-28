import { expect, test } from "@playwright/test";
import {
  api,
  apiAll,
  countIn,
  dataTable,
  expectNoHorizontalScroll,
  primaryOrg,
  releaseOnly,
  runId,
  sessionFor,
  shot,
  statValue,
} from "./helpers";

/*
 * Criteria 3, 4 and 5 in one flow, because each needs the one before:
 *   3. a discovery job from an implemented and permitted source: the wizard offers Overture Maps
 *      Places with its attribution and shows Google Places as unavailable; the estimate shows the
 *      exact hold; a double click still creates one job (one Idempotency-Key);
 *   4. the background worker processes it: the job page polls from queued to completed and its
 *      counts equal the API's;
 *   5. the discovered businesses are stored and appear in the directory, each with the Overture
 *      attribution, and the balance dropped by exactly the captured credits.
 * The catalogue is the seed's real Overture fixture records plus "(Sample)" Ikeja pharmacies.
 */

interface DiscoveryJob {
  id: string;
  name: string;
  status: string;
  progress: {
    processed: number;
    created: number;
    updated: number;
    billable: number;
    duplicates: number;
    skipped: number;
    failed: number;
    pagesFetched: number;
    limit: number;
  };
  credits: { held: number; captured: number; released: number; settled: boolean };
}

test.describe("C3 C4 C5 discovery through the worker into the directory", () => {
  releaseOnly();

  test("C3 wizard with a permitted source, C4 worker processing, C5 stored businesses with attribution", async ({
    browser,
  }, info) => {
    const run = runId();
    const jobName = `Release discovery ${run} (Sample)`;
    const { context, page } = await sessionFor(browser, info, "owner");
    try {
      await page.goto("/app");
      const org = await primaryOrg(page);
      const before = await api<{ balance: number; held: number }>(
        page,
        "GET",
        "/credits/balance",
        org.id,
      );

      // ---- C3: the wizard
      await page.goto("/app/discovery/new");
      await expect(page.getByText("Choose where to search")).toBeVisible();
      const overture = page.locator('li[data-source="overture_places"]');
      const google = page.locator('li[data-source="google_places"]');
      await expect(overture).toHaveAttribute("data-runnable", "true");
      await expect(overture).toContainText("Overture Maps Foundation");
      await expect(overture).toContainText(/Licences: .*CDLA/);
      await expect(page.getByRole("checkbox", { name: "Overture Maps Places" })).toBeEnabled();
      await expect(google).toHaveAttribute("data-runnable", "false");
      await expect(page.getByRole("checkbox", { name: /Google Places/ })).toBeDisabled();
      await expect(google.locator("[data-unavailable-reason]")).toContainText(/Google/);
      await expectNoHorizontalScroll(page, "wizard sources");
      await shot(page, info, "c03-sources");
      const box = page.getByRole("checkbox", { name: "Overture Maps Places" });
      if (!(await box.isChecked())) await box.check();
      await page.getByRole("button", { name: /Continue/ }).click();

      await expect(page.getByText("What to find, and where")).toBeVisible();
      await page.getByLabel("Category", { exact: true }).fill("Pharmacy");
      await page.getByLabel("Category", { exact: true }).press("Enter");
      await page.getByLabel("City or town").fill("Ikeja");
      await page.getByLabel("Name", { exact: true }).fill(jobName);
      await expectNoHorizontalScroll(page, "wizard target");
      await page.getByRole("button", { name: /Continue/ }).click();

      await expect(page.getByText("Set limits")).toBeVisible();
      await page.getByLabel("Maximum records").fill("8");
      const estimated = page.waitForResponse(
        (r) =>
          r.request().method() === "POST" && r.url().endsWith("/api/v1/discovery/jobs/estimate"),
      );
      await page.getByRole("button", { name: /Continue/ }).click();

      await expect(page.getByText("Check the estimate")).toBeVisible();
      const estimate = (
        (await (await estimated).json()) as {
          data: { credits: { hold: number; balance: number }; blockers: unknown[] };
        }
      ).data;
      await expect(page.getByTestId("estimate")).toBeVisible();
      await expect(page.getByTestId("estimate-blockers")).toHaveCount(0);
      expect(estimate.credits.hold).toBeGreaterThan(0);
      expect(estimate.credits.hold).toBeLessThanOrEqual(8);
      expect(await statValue(page, "Credits held")).toBe(String(estimate.credits.hold));
      expect(await statValue(page, "Available now")).toBe(before.balance.toLocaleString("en-US"));
      await expectNoHorizontalScroll(page, "wizard estimate");
      await shot(page, info, "c03-estimate");
      await page.getByRole("button", { name: /Continue/ }).click();
      await expect(page.getByRole("heading", { name: "Review and create" })).toBeVisible();

      // A double click sends at most one key: the API creates one job.
      const keys: string[] = [];
      page.on("request", (r) => {
        if (r.method() === "POST" && new URL(r.url()).pathname === "/api/v1/discovery/jobs")
          keys.push(r.headers()["idempotency-key"] ?? "");
      });
      await page.getByRole("button", { name: "Create discovery job" }).dblclick();
      await page.waitForURL(/\/app\/discovery\/[a-f0-9]{24}$/, { timeout: 30_000 });
      const jobId = page.url().split("/").pop()!;
      expect(keys.length).toBeGreaterThanOrEqual(1);
      expect(new Set(keys).size, `idempotency keys sent: ${keys.join(", ")}`).toBe(1);
      const sameName = (
        await apiAll<{ id: string; name: string }>(page, "/discovery/jobs?pageSize=100", org.id)
      ).filter((j) => j.name === jobName);
      expect(sameName.map((j) => j.id)).toEqual([jobId]);
      const created = await api<DiscoveryJob>(page, "GET", `/discovery/jobs/${jobId}`, org.id);
      expect(created.credits.held).toBe(estimate.credits.hold);

      // ---- C4: the worker takes it from queued to completed; the page polls.
      await expect(page.getByRole("heading", { level: 1, name: jobName })).toBeVisible();
      await expect(page.getByTestId("job-status-line")).toHaveText(
        /^(Completed|Completed with warnings)(:|\.)(?!.*Settling)/,
        { timeout: 180_000 },
      );
      await expect(page.getByTestId("job-status")).toHaveText(/Completed/);
      const job = await api<DiscoveryJob>(page, "GET", `/discovery/jobs/${jobId}`, org.id);
      expect(job.credits.settled).toBe(true);
      expect(job.progress.created).toBeGreaterThan(0);
      const progress = page.getByTestId("job-progress");
      const labels: Array<[string, number]> = [
        ["Processed", job.progress.processed],
        ["New businesses", job.progress.created],
        ["Updated", job.progress.updated],
        ["Billable", job.progress.billable],
        ["Duplicates", job.progress.duplicates],
        ["Skipped", job.progress.skipped],
        ["Failed", job.progress.failed],
        ["Pages fetched", job.progress.pagesFetched],
      ];
      for (const [label, value] of labels)
        await expect(countIn(progress, label), label).toHaveText(value.toLocaleString("en-US"));
      const credits = page.getByTestId("job-credits");
      await expect(countIn(credits, "Held")).toHaveText(String(job.credits.held));
      await expect(countIn(credits, "Charged")).toHaveText(String(job.credits.captured));
      await expect(countIn(credits, "Released")).toHaveText(String(job.credits.released));
      expect(job.credits.captured).toBe(job.progress.billable);
      expect(job.credits.held).toBe(job.credits.captured + job.credits.released);
      await expect(page.getByTestId("items-attribution")).toContainText("Overture Maps Foundation");
      await expectNoHorizontalScroll(page, "discovery job page");
      await shot(page, info, "c04-job-completed");

      // ---- C5: stored businesses, in the directory, with attribution; the balance moved exactly.
      const items = dataTable(page, "Discovery job items");
      await expect(items.locator('a[href^="/app/businesses/"]').first()).toBeVisible({
        timeout: 30_000,
      });
      const stored = await apiAll<{ id: string; name: string }>(
        page,
        "/businesses?source=overture_places&pageSize=100",
        org.id,
      );
      expect(stored.length).toBeGreaterThanOrEqual(job.progress.created);
      await page.goto("/app/businesses?source=overture_places");
      await expect(page.getByRole("heading", { level: 1, name: "Businesses" })).toBeVisible();
      const first = stored[0]!;
      await expect(
        page.locator("#main").getByRole("link", { name: first.name }).first(),
      ).toBeVisible({ timeout: 30_000 });
      await expectNoHorizontalScroll(page, "directory filtered to Overture");
      await shot(page, info, "c05-directory");
      await page.locator("#main").getByRole("link", { name: first.name }).first().click();
      await page.waitForURL(/\/app\/businesses\/[a-f0-9]{24}/);
      await expect(page.getByRole("heading", { level: 1, name: first.name })).toBeVisible();
      await expect(page.getByTestId("business-attribution")).toContainText(
        "Overture Maps Foundation",
      );
      await expect(page.getByRole("link", { name: "View discovery job" })).toBeVisible();
      await expectNoHorizontalScroll(page, "discovered business");
      await shot(page, info, "c05-business");
      const after = await api<{ balance: number; held: number }>(
        page,
        "GET",
        "/credits/balance",
        org.id,
      );
      expect(before.balance - after.balance).toBe(job.credits.captured);
    } finally {
      await context.close();
    }
  });
});
