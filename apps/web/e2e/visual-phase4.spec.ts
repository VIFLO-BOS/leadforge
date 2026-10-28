import { test, type Page } from "@playwright/test";
import path from "node:path";
import { BUSINESS_ID, mockWorkspaceApi, type MockOptions } from "./fixtures";
import { ANALYSIS_ID, BATCH_ID, CANDIDATE_ID, RUNNING_ANALYSIS_ID } from "./fixtures-phase4";

/*
 * Visual review captures for the Phase 4 screens against the mocked API: analyses and their
 * detail, the business detail tabs, contact collection, the duplicate queue, review and merge
 * dialog, scoring settings and the data sources page. Skipped unless E2E_SCREENS_DIR is set;
 * light and dark at 240, 375, 768 and 1440. Not assertions: look at the images.
 *   E2E_SCREENS_DIR=<dir> PLAYWRIGHT_PORT=3300 pnpm exec playwright test visual-phase4
 */

const DIR = process.env.E2E_SCREENS_DIR;
const WIDTHS = new Set(["w240", "w375", "w768", "w1440"]);

interface Shot {
  name: string;
  url: string;
  opts?: MockOptions;
  act?: (page: Page) => Promise<void>;
  fullPage?: boolean;
}

const SHOTS: Shot[] = [
  { name: "p4-analysis-list", url: "/app/analysis" },
  { name: "p4-analysis-batch", url: `/app/analysis?batchId=${BATCH_ID}` },
  { name: "p4-analysis-empty", url: "/app/analysis", opts: { empty: true } },
  { name: "p4-analysis-detail", url: `/app/analysis/${ANALYSIS_ID}` },
  { name: "p4-analysis-running", url: `/app/analysis/${RUNNING_ANALYSIS_ID}` },
  { name: "p4-business-overview", url: `/app/businesses/${BUSINESS_ID}` },
  { name: "p4-business-analysis", url: `/app/businesses/${BUSINESS_ID}?tab=analysis` },
  { name: "p4-business-score", url: `/app/businesses/${BUSINESS_ID}?tab=score` },
  { name: "p4-business-opportunities", url: `/app/businesses/${BUSINESS_ID}?tab=opportunities` },
  { name: "p4-business-duplicates", url: `/app/businesses/${BUSINESS_ID}?tab=duplicates` },
  {
    name: "p4-run-analysis-dialog",
    url: `/app/businesses/${BUSINESS_ID}?tab=analysis`,
    act: async (page) => {
      await page
        .getByTestId("analysis-tab")
        .getByRole("button", { name: /Run website analysis/ })
        .click();
      await page.getByRole("alertdialog").waitFor();
      await page.waitForTimeout(400);
    },
    fullPage: false,
  },
  { name: "p4-directory-scores", url: "/app/businesses?sort=fit:desc" },
  {
    name: "p4-bulk-analyze",
    url: "/app/businesses",
    act: async (page) => {
      await page.getByRole("checkbox", { name: "Select row 1" }).check();
      await page.getByRole("checkbox", { name: "Select row 3" }).check();
      await page
        .getByRole("button", { name: /Analyze websites/ })
        .first()
        .click();
      await page
        .getByTestId("bulk-analyze-dialog")
        .getByRole("button", { name: /Analyze websites/ })
        .click();
      await page.getByTestId("bulk-analyze-result").waitFor();
      await page.waitForTimeout(400);
    },
    fullPage: false,
  },
  { name: "p4-duplicates-queue", url: "/app/businesses/duplicates" },
  { name: "p4-duplicates-history", url: "/app/businesses/duplicates?view=history" },
  { name: "p4-candidate-review", url: `/app/businesses/duplicates/${CANDIDATE_ID}` },
  {
    name: "p4-merge-dialog",
    url: `/app/businesses/duplicates/${CANDIDATE_ID}`,
    act: async (page) => {
      await page.getByRole("button", { name: /Merge/ }).first().click();
      await page.getByTestId("merge-dialog").waitFor();
      await page.waitForTimeout(400);
    },
    fullPage: false,
  },
  { name: "p4-scoring-settings", url: "/app/settings?tab=scoring" },
  {
    name: "p4-scoring-invalid",
    url: "/app/settings?tab=scoring",
    act: async (page) => {
      await page.getByLabel("Freshness").fill("5");
      await page.getByTestId("weights-error").waitFor();
    },
  },
  { name: "p4-data-sources", url: "/legal/data-sources" },
];

for (const scheme of ["light", "dark"] as const) {
  test.describe(`phase 4 capture ${scheme}`, () => {
    test.skip(!DIR, "Set E2E_SCREENS_DIR to capture screenshots.");
    test.use({ colorScheme: scheme, reducedMotion: "reduce" });

    for (const shot of SHOTS) {
      test(shot.name, async ({ page }, info) => {
        test.skip(!WIDTHS.has(info.project.name), "Captured at 240, 375, 768 and 1440 only.");
        await mockWorkspaceApi(page, shot.opts);
        await page.goto(shot.url);
        await page.locator("#main").waitFor();
        await page.waitForLoadState("networkidle");
        await page.waitForTimeout(400);
        if (shot.act) await shot.act(page);
        await page.waitForTimeout(300);
        const width = info.project.name.replace(/^w/, "");
        await page.screenshot({
          path: path.join(DIR ?? ".", `${shot.name}-${width}-${scheme}.png`),
          fullPage: shot.fullPage ?? true,
        });
      });
    }
  });
}
