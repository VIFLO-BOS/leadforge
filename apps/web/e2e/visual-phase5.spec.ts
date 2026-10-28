import { test, type Page } from "@playwright/test";
import path from "node:path";
import { BUSINESS_ID, mockWorkspaceApi, type MockOptions } from "./fixtures";
import {
  BULK_DONE_ID,
  BULK_RUNNING_ID,
  EXPORT_READY_ID,
  EXPORT_RUNNING_ID,
  LIST_ID,
} from "./fixtures-phase5";

/*
 * Visual review captures for the Phase 5 screens against the mocked API: the pipeline (board and
 * the narrow single column), lists, activities, the log-activity dialog and its suppression step,
 * outreach, bulk and export job pages, reports, usage and the overview. Skipped unless
 * E2E_SCREENS_DIR is set; light and dark at 240, 375, 768 and 1440. Not assertions.
 *   E2E_SCREENS_DIR=<dir> PLAYWRIGHT_PORT=3300 pnpm exec playwright test visual-phase5
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
  { name: "p5-pipeline", url: "/app/pipeline" },
  { name: "p5-pipeline-empty", url: "/app/pipeline", opts: { empty: true } },
  {
    name: "p5-pipeline-move-menu",
    url: "/app/pipeline?stage=qualified",
    act: async (page) => {
      await page.getByRole("button", { name: /^Move to… Mama Put Kitchen/ }).click();
      await page.getByRole("menu").waitFor();
      await page.waitForTimeout(300);
    },
    fullPage: false,
  },
  { name: "p5-lists", url: "/app/lists" },
  { name: "p5-list-detail", url: `/app/lists/${LIST_ID}` },
  { name: "p5-business-overview", url: `/app/businesses/${BUSINESS_ID}` },
  { name: "p5-business-activities", url: `/app/businesses/${BUSINESS_ID}?tab=activities` },
  {
    name: "p5-log-activity",
    url: `/app/businesses/${BUSINESS_ID}?tab=activities`,
    act: async (page) => {
      await page
        .getByTestId("activities-tab")
        .getByRole("button", { name: "Log activity" })
        .click();
      const dialog = page.getByTestId("log-activity-dialog");
      await dialog.getByText("Call", { exact: true }).click();
      await page.waitForTimeout(300);
    },
    fullPage: false,
  },
  {
    name: "p5-suppression-override",
    url: `/app/businesses/${BUSINESS_ID}?tab=activities`,
    opts: { contactSuppressed: true },
    act: async (page) => {
      await page
        .getByTestId("activities-tab")
        .getByRole("button", { name: "Log activity" })
        .click();
      const dialog = page.getByTestId("log-activity-dialog");
      await dialog.getByText("Call", { exact: true }).click();
      await dialog.getByRole("button", { name: "Log call" }).click();
      await dialog.getByTestId("suppression-override").waitFor();
      await page.waitForTimeout(300);
    },
    fullPage: false,
  },
  { name: "p5-activities", url: "/app/activities" },
  { name: "p5-outreach", url: "/app/outreach" },
  {
    name: "p5-bulk-preview",
    url: "/app/businesses",
    act: async (page) => {
      await page.getByRole("checkbox", { name: "Select row 1" }).check();
      await page.getByRole("checkbox", { name: "Select row 3" }).check();
      await page.getByRole("button", { name: "Add to list", exact: true }).click();
      const dialog = page.getByTestId("bulk-action-dialog");
      await dialog.getByText("Lagos restaurants (Sample)").click();
      await dialog.getByRole("button", { name: "Preview changes" }).click();
      await dialog.getByTestId("bulk-preview").waitFor();
      await page.waitForTimeout(300);
    },
    fullPage: false,
  },
  { name: "p5-bulk-running", url: `/app/jobs/bulk/${BULK_RUNNING_ID}` },
  { name: "p5-bulk-done", url: `/app/jobs/bulk/${BULK_DONE_ID}` },
  {
    name: "p5-export-dialog",
    url: `/app/lists/${LIST_ID}`,
    act: async (page) => {
      await page.locator("#main").getByRole("button", { name: "Export" }).click();
      await page.getByTestId("export-dialog").waitFor();
      await page.waitForTimeout(300);
    },
    fullPage: false,
  },
  { name: "p5-export-ready", url: `/app/jobs/exports/${EXPORT_READY_ID}` },
  { name: "p5-export-running", url: `/app/jobs/exports/${EXPORT_RUNNING_ID}` },
  { name: "p5-reports", url: "/app/reports" },
  { name: "p5-reports-empty", url: "/app/reports", opts: { empty: true } },
  { name: "p5-usage", url: "/app/usage" },
  { name: "p5-overview", url: "/app" },
];

for (const scheme of ["light", "dark"] as const) {
  test.describe(`phase 5 capture ${scheme}`, () => {
    test.skip(!DIR, "Set E2E_SCREENS_DIR to capture screenshots.");
    test.use({ colorScheme: scheme, reducedMotion: "reduce" });

    for (const shot of SHOTS) {
      test(shot.name, async ({ page }, info) => {
        test.skip(!WIDTHS.has(info.project.name), "Captured at 240, 375, 768 and 1440 only.");
        await mockWorkspaceApi(page, shot.opts);
        await page.goto(shot.url);
        await page.locator("#main").waitFor();
        await page.waitForLoadState("networkidle");
        await page.waitForTimeout(500);
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
