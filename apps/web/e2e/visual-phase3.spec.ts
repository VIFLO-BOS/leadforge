import { test, type Page } from "@playwright/test";
import path from "node:path";
import { mockWorkspaceApi, type MockOptions } from "./fixtures";
import { RUNNING_JOB_ID, WARNINGS_JOB_ID } from "./fixtures-discovery";

/*
 * Visual review captures for the Phase 3 screens against the mocked API: the wizard steps, a job
 * mid-run, the job and usage lists, notifications and sources. Skipped unless E2E_SCREENS_DIR is
 * set; captures light and dark at 240, 375, 768 and 1440. Not assertions: look at the images.
 *   E2E_SCREENS_DIR=<dir> PLAYWRIGHT_PORT=3300 pnpm exec playwright test visual-phase3
 */

const DIR = process.env.E2E_SCREENS_DIR;
const WIDTHS = new Set(["w240", "w375", "w768", "w1440"]);

async function toTarget(page: Page) {
  await page.getByRole("checkbox", { name: "Overture Maps Places" }).waitFor();
  await page.getByRole("button", { name: /Continue/ }).click();
  await page.getByText("What to find, and where").waitFor();
}

async function fillTarget(page: Page) {
  await toTarget(page);
  await page.getByRole("button", { name: /^Pharmacy/ }).click();
  await page.getByLabel("City or town").fill("Ikeja");
}

async function toLimits(page: Page) {
  await fillTarget(page);
  await page.getByRole("button", { name: /Continue/ }).click();
  await page.getByText("Set limits").waitFor();
}

async function toEstimate(page: Page) {
  await toLimits(page);
  await page.getByRole("button", { name: /Continue/ }).click();
  await page.getByText("Check the estimate").waitFor();
  await page.getByTestId("estimate").or(page.getByTestId("credits-shortfall")).first().waitFor();
}

async function toReview(page: Page) {
  await toEstimate(page);
  await page.getByRole("button", { name: /Continue/ }).click();
  await page.getByRole("heading", { name: "Review and create" }).waitFor();
}

interface Shot {
  name: string;
  url: string;
  opts?: MockOptions;
  act?: (page: Page) => Promise<void>;
  fullPage?: boolean;
}

const SHOTS: Shot[] = [
  { name: "p3-overview", url: "/app" },
  { name: "p3-discovery-list", url: "/app/discovery" },
  { name: "p3-discovery-empty", url: "/app/discovery", opts: { empty: true } },
  { name: "p3-wizard-1-source", url: "/app/discovery/new" },
  { name: "p3-wizard-2-target", url: "/app/discovery/new", act: fillTarget },
  {
    name: "p3-wizard-2-errors",
    url: "/app/discovery/new",
    act: async (page) => {
      await toTarget(page);
      await page.getByRole("button", { name: /Continue/ }).click();
      await page.getByText("Add at least one category or keyword.").waitFor();
    },
  },
  { name: "p3-wizard-3-limits", url: "/app/discovery/new", act: toLimits },
  { name: "p3-wizard-4-estimate", url: "/app/discovery/new", act: toEstimate },
  {
    name: "p3-wizard-4-insufficient",
    url: "/app/discovery/new",
    opts: { estimate: "insufficient" },
    act: toEstimate,
  },
  {
    name: "p3-wizard-4-blocked",
    url: "/app/discovery/new",
    opts: { estimate: "blocked" },
    act: toEstimate,
  },
  { name: "p3-wizard-5-review", url: "/app/discovery/new", act: toReview },
  { name: "p3-job-running", url: `/app/discovery/${RUNNING_JOB_ID}` },
  { name: "p3-job-warnings", url: `/app/discovery/${WARNINGS_JOB_ID}` },
  {
    name: "p3-job-cancel-dialog",
    url: `/app/discovery/${RUNNING_JOB_ID}`,
    act: async (page) => {
      await page.getByRole("button", { name: /Cancel job/ }).click();
      await page.getByRole("alertdialog").waitFor();
      await page.waitForTimeout(400);
    },
    fullPage: false,
  },
  { name: "p3-jobs", url: "/app/jobs" },
  { name: "p3-usage", url: "/app/usage" },
  {
    name: "p3-notifications",
    url: "/app",
    act: async (page) => {
      const width = page.viewportSize()?.width ?? 0;
      if (width < 360) {
        await page.getByRole("button", { name: /Account menu/ }).click();
        await page.getByRole("menuitem", { name: "Notifications" }).click();
      } else {
        await page.getByRole("button", { name: /^Notifications/ }).click();
      }
      await page.getByTestId("notification-panel").getByRole("list").waitFor();
      await page.waitForTimeout(400);
    },
    fullPage: false,
  },
  { name: "p3-sources", url: "/app/sources" },
  { name: "p3-settings-notifications", url: "/app/settings?tab=notifications" },
];

for (const scheme of ["light", "dark"] as const) {
  test.describe(`phase 3 capture ${scheme}`, () => {
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
