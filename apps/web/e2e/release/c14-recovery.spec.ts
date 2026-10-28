import { expect, test } from "@playwright/test";
import {
  api,
  apiAll,
  countIn,
  dataTable,
  expectNoHorizontalScroll,
  fixture,
  primaryOrg,
  releaseOnly,
  runId,
  sessionFor,
  shot,
} from "./helpers";

/*
 * Criterion 14: recover safely from retryable job failures. The fixture server makes the e2e
 * MongoDB reject one bakery's record (a real write failure, not a mock), so a discovery job ends
 * "Completed with warnings": the failed item is listed with its reason, not charged, and its credit
 * released. The fault is removed, "Retry failed items" runs a new round with its own hold, and the
 * item is created and charged exactly once.
 */

const FAULTY = "Ikeja Bakery 2 (Sample)";
/** Its Overture (GERS) id in the seed's catalogue (apps/api/src/scripts/seed-e2e.ts). */
const FAULTY_GERS_ID = "e2e0b000-0000-4000-8000-000000000002";

interface Job {
  status: string;
  round: number;
  retryableItems: number;
  progress: { created: number; failed: number; billable: number };
  credits: { held: number; captured: number; released: number; settled: boolean };
}

test.describe("C14 recover safely from retryable job failures", () => {
  releaseOnly();

  test("C14 a job with a failed item, its notices, then Retry failed items to completion", async ({
    browser,
    request,
  }, info) => {
    const run = runId();
    const jobName = `Release bakeries ${run} (Sample)`;
    const { context, page } = await sessionFor(browser, info, "owner");
    try {
      await page.goto("/app");
      const org = await primaryOrg(page);
      const before = await api<{ balance: number }>(page, "GET", "/credits/balance", org.id);
      await fixture(request, "POST", "/__e2e/faults/businesses", {
        namePattern: "^Ikeja Bakery 2 \\(Sample\\)$",
      });

      // 1. A discovery job for Ikeja bakeries; one record cannot be saved.
      await page.goto("/app/discovery/new");
      await expect(page.getByText("Choose where to search")).toBeVisible();
      await page.getByRole("button", { name: /Continue/ }).click();
      await page.getByLabel("Category", { exact: true }).fill("Bakery");
      await page.getByLabel("Category", { exact: true }).press("Enter");
      await page.getByLabel("City or town").fill("Ikeja");
      await page.getByLabel("Name", { exact: true }).fill(jobName);
      await page.getByRole("button", { name: /Continue/ }).click();
      await page.getByLabel("Maximum records").fill("10");
      await page.getByRole("button", { name: /Continue/ }).click();
      await expect(page.getByTestId("estimate")).toBeVisible({ timeout: 30_000 });
      await page.getByRole("button", { name: /Continue/ }).click();
      await page.getByRole("button", { name: "Create discovery job" }).click();
      await page.waitForURL(/\/app\/discovery\/[a-f0-9]{24}$/);
      const jobId = page.url().split("/").pop()!;
      await expect(page.getByTestId("job-status-line")).toHaveText(
        /^Completed with warnings(:|\.)(?!.*Settling)/,
        { timeout: 180_000 },
      );
      const failedJob = await api<Job>(page, "GET", `/discovery/jobs/${jobId}`, org.id);
      expect(failedJob).toMatchObject({
        status: "completed_with_warnings",
        retryableItems: 1,
        progress: { failed: 1 },
      });
      expect(failedJob.credits.captured).toBe(failedJob.progress.billable);
      expect(failedJob.credits.held).toBe(failedJob.credits.captured + failedJob.credits.released);

      // 2. The failure is explained, not hidden: counts, the issues panel and the failed item.
      await expect(page.getByTestId("job-status")).toHaveText(/Completed with warnings/);
      await expect(countIn(page.getByTestId("job-progress"), "Failed")).toHaveText("1");
      const failedItems = await apiAll<{
        name: string | null;
        outcome: string;
        billable: boolean;
        error: { code: string } | null;
      }>(page, `/discovery/jobs/${jobId}/items?outcome=failed`, org.id);
      expect(failedItems).toEqual([
        expect.objectContaining({
          outcome: "failed",
          billable: false,
          error: expect.objectContaining({ code: "INGEST_FAILED" }),
        }),
      ]);
      await page.goto(`/app/discovery/${jobId}?outcome=failed`);
      const items = dataTable(page, "Discovery job items");
      await expect(items.locator('[data-outcome="failed"]').first()).toBeVisible({
        timeout: 30_000,
      });
      // No business record exists for it: the row names the source record, the reason and the attempts.
      await expect(items).toContainText(FAULTY_GERS_ID);
      await expect(items).toContainText("Not billed");
      await expect(items).toContainText("it is not charged and can be retried");
      await expectNoHorizontalScroll(page, "job with a failed item");
      await shot(page, info, "c14-failed-item");

      // 3. The fault is gone; Retry failed items runs a new round to completion.
      await fixture(request, "DELETE", "/__e2e/faults/businesses");
      await page.getByRole("button", { name: "Retry 1 failed item" }).click();
      await expect(page.getByRole("alertdialog", { name: "Retry 1 failed item?" })).toBeVisible();
      await page
        .getByRole("alertdialog")
        .getByRole("button", { name: "Retry failed items" })
        .click();
      await expect(page.getByTestId("job-status-line")).toHaveText(
        /^Completed(:|\.)(?!.*Settling)/,
        { timeout: 180_000 },
      );
      await expect(page.getByTestId("job-status")).toHaveText(/^Completed$/);
      const done = await api<Job>(page, "GET", `/discovery/jobs/${jobId}`, org.id);
      expect(done).toMatchObject({
        status: "completed",
        round: 1,
        retryableItems: 0,
        progress: { failed: 0 },
      });
      expect(done.progress.created).toBe(failedJob.progress.created + 1);
      expect(done.credits.captured).toBe(failedJob.credits.captured + 1);
      expect(done.credits.held).toBe(failedJob.credits.held + 1);
      await expect(countIn(page.getByTestId("job-progress"), "Failed")).toHaveText("0");
      await expect(page.getByRole("button", { name: /Retry .* failed item/ })).toHaveCount(0);
      const after = await api<{ balance: number }>(page, "GET", "/credits/balance", org.id);
      expect(before.balance - after.balance).toBe(done.credits.captured);
      const found = await api<{ name: string }[]>(
        page,
        "GET",
        `/businesses?q=${encodeURIComponent("Ikeja Bakery 2")}`,
        org.id,
      );
      expect(
        found.filter((b) => b.name === FAULTY),
        "the recovered bakery exists exactly once",
      ).toHaveLength(1);
      await expectNoHorizontalScroll(page, "job after retry");
      await shot(page, info, "c14-retried");
    } finally {
      await fixture(request, "DELETE", "/__e2e/faults/businesses").catch(() => undefined);
      await context.close();
    }
  });
});
