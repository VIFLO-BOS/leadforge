import { test, type Page } from "@playwright/test";
import path from "node:path";
import {
  BUSINESS_ID,
  COMPLETED_IMPORT_ID,
  RUNNING_JOB_ID,
  UPLOADED_IMPORT_ID,
  mockWorkspaceApi,
} from "./fixtures";
import { ANALYSIS_ID, RUNNING_ANALYSIS_ID } from "./fixtures-phase4";

/*
 * Visual review captures for the accessibility pass: screens whose markup changed (inline links
 * now underlined, heading levels, settings cards, filter fields, the carousel track) and keyboard
 * focus states (skip link, menu and dialog focus, filter chip, table sort, wizard heading).
 * Skipped unless E2E_SCREENS_DIR is set; light and dark at 375 and 1440. Not assertions.
 *   E2E_SCREENS_DIR=<dir> PLAYWRIGHT_PORT=3300 pnpm exec playwright test visual-a11y
 */

const DIR = process.env.E2E_SCREENS_DIR;
const WIDTHS = new Set(["w375", "w1440"]);

interface Shot {
  name: string;
  url: string;
  mock?: boolean;
  act?: (page: Page) => Promise<void>;
  fullPage?: boolean;
}

async function tabUntil(page: Page, test: () => Promise<boolean>, max = 80) {
  for (let i = 0; i < max && !(await test()); i++) await page.keyboard.press("Tab");
}

const SHOTS: Shot[] = [
  { name: "a11y-overview", url: "/app" },
  { name: "a11y-directory", url: "/app/businesses" },
  { name: "a11y-business-detail", url: `/app/businesses/${BUSINESS_ID}` },
  { name: "a11y-business-score", url: `/app/businesses/${BUSINESS_ID}?tab=score` },
  { name: "a11y-business-opportunities", url: `/app/businesses/${BUSINESS_ID}?tab=opportunities` },
  { name: "a11y-business-duplicates", url: `/app/businesses/${BUSINESS_ID}?tab=duplicates` },
  { name: "a11y-analysis-detail", url: `/app/analysis/${ANALYSIS_ID}` },
  { name: "a11y-analysis-running", url: `/app/analysis/${RUNNING_ANALYSIS_ID}` },
  { name: "a11y-job-detail", url: `/app/discovery/${RUNNING_JOB_ID}` },
  { name: "a11y-import-results", url: `/app/businesses/import?id=${COMPLETED_IMPORT_ID}` },
  {
    name: "a11y-import-review",
    url: `/app/businesses/import?id=${UPLOADED_IMPORT_ID}`,
    act: async (page) => {
      await page.getByRole("button", { name: "Check rows" }).click();
      await page.getByText("Check rows before importing").waitFor();
    },
  },
  { name: "a11y-settings-org", url: "/app/settings" },
  { name: "a11y-settings-security", url: "/app/settings?tab=security" },
  { name: "a11y-team", url: "/app/team" },
  { name: "a11y-usage", url: "/app/usage" },
  { name: "a11y-pricing", url: "/pricing", mock: false },
  { name: "a11y-home", url: "/", mock: false, fullPage: false },
  {
    name: "a11y-focus-skip-link",
    url: "/app",
    fullPage: false,
    act: async (page) => {
      await page.keyboard.press("Tab");
    },
  },
  {
    name: "a11y-focus-account-menu",
    url: "/app",
    fullPage: false,
    act: async (page) => {
      const trigger = page.getByRole("button", { name: /Account menu/ });
      await tabUntil(page, () => trigger.evaluate((el) => el === document.activeElement));
      await page.keyboard.press("Enter");
      await page.getByRole("menu").waitFor();
      await page.keyboard.press("ArrowDown");
    },
  },
  {
    name: "a11y-focus-filter-chip",
    url: "/app/businesses?region=lagos",
    fullPage: false,
    act: async (page) => {
      const search = page.getByRole("searchbox", { name: "Search businesses" });
      await tabUntil(page, () => search.evaluate((el) => el === document.activeElement));
      await page.keyboard.press("Tab");
    },
  },
  {
    name: "a11y-focus-corrections-dialog",
    url: `/app/businesses/${BUSINESS_ID}`,
    fullPage: false,
    act: async (page) => {
      const correct = page.getByRole("button", { name: "Correct details" });
      await tabUntil(page, () => correct.evaluate((el) => el === document.activeElement));
      await page.keyboard.press("Enter");
      await page.getByRole("dialog").waitFor();
      await page.keyboard.press("Tab");
    },
  },
  {
    name: "a11y-focus-carousel",
    url: "/",
    mock: false,
    fullPage: false,
    act: async (page) => {
      const track = page.getByRole("group", { name: /: slides$/ }).first();
      await tabUntil(page, () => track.evaluate((el) => el === document.activeElement), 120);
      await track.scrollIntoViewIfNeeded();
    },
  },
];

for (const scheme of ["light", "dark"] as const) {
  test.describe(`a11y capture ${scheme}`, () => {
    test.skip(!DIR, "Set E2E_SCREENS_DIR to capture screenshots.");
    test.use({ colorScheme: scheme, reducedMotion: "reduce" });

    for (const shot of SHOTS) {
      test(shot.name, async ({ page }, info) => {
        test.skip(!WIDTHS.has(info.project.name), "Captured at 375 and 1440 only.");
        if (shot.mock !== false) await mockWorkspaceApi(page);
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

/** 200% browser zoom at 1280 (a 640 x 360 CSS viewport) and the 768 tablet width: header reflow. */
const ZOOM_PAGES = [
  { name: "a11y-zoom-directory", url: "/app/businesses" },
  { name: "a11y-zoom-detail", url: `/app/businesses/${BUSINESS_ID}` },
  { name: "a11y-zoom-analysis", url: `/app/analysis/${ANALYSIS_ID}` },
];

for (const vp of [
  { label: "640z", viewport: { width: 640, height: 360 }, deviceScaleFactor: 2 },
  { label: "768", viewport: { width: 768, height: 800 }, deviceScaleFactor: 1 },
] as const) {
  test.describe(`a11y capture ${vp.label}`, () => {
    test.skip(!DIR, "Set E2E_SCREENS_DIR to capture screenshots.");
    test.use({
      viewport: vp.viewport,
      deviceScaleFactor: vp.deviceScaleFactor,
      reducedMotion: "reduce",
    });

    for (const shot of ZOOM_PAGES) {
      test(`${shot.name} ${vp.label}`, async ({ page }, info) => {
        test.skip(info.project.name !== "w1440", "Captured once.");
        await mockWorkspaceApi(page);
        await page.goto(shot.url);
        await page.locator("#main").waitFor();
        await page.waitForLoadState("networkidle");
        await page.waitForTimeout(400);
        await page.screenshot({
          path: path.join(DIR ?? ".", `${shot.name}-${vp.label}.png`),
          fullPage: false,
        });
      });
    }
  });
}
