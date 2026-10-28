import { test, type Page } from "@playwright/test";
import path from "node:path";
import {
  BUSINESS_ID,
  COMPLETED_IMPORT_ID,
  PROCESSING_IMPORT_ID,
  UNKNOWN_BUSINESS_ID,
  UPLOADED_IMPORT_ID,
  mockWorkspaceApi,
} from "./fixtures";

/*
 * Visual review captures for the Phase 2 screens, against the mocked API. Skipped unless
 * E2E_SCREENS_DIR is set; then every project width writes light and dark full-page
 * screenshots there, plus mid-transition frames at 1440px. Not an assertion suite: look at the
 * images. Example:
 *   E2E_SCREENS_DIR=../../tmp/screens PLAYWRIGHT_PORT=3300 pnpm exec playwright test visual-capture
 */

const DIR = process.env.E2E_SCREENS_DIR;

interface Shot {
  name: string;
  url: string;
  /** Interaction before the capture (open a dialog, advance a step). */
  act?: (page: Page) => Promise<void>;
  fullPage?: boolean;
}

const SHOTS: Shot[] = [
  { name: "overview", url: "/app" },
  { name: "directory", url: "/app/businesses" },
  { name: "directory-empty", url: "/app/businesses" },
  {
    name: "directory-selected",
    url: "/app/businesses",
    act: async (page) => {
      await page.getByRole("checkbox", { name: "Select row 1" }).check();
      await page.getByRole("checkbox", { name: "Select row 2" }).check();
    },
    fullPage: false,
  },
  { name: "detail", url: `/app/businesses/${BUSINESS_ID}` },
  { name: "detail-provenance", url: `/app/businesses/${BUSINESS_ID}?tab=provenance` },
  { name: "detail-verification", url: `/app/businesses/${BUSINESS_ID}?tab=verification` },
  { name: "detail-notfound", url: `/app/businesses/${UNKNOWN_BUSINESS_ID}` },
  {
    name: "dialog-correct",
    url: `/app/businesses/${BUSINESS_ID}`,
    act: async (page) => {
      await page.getByRole("button", { name: "Correct phone +234 803 123 4567" }).click();
      await page.getByRole("dialog").waitFor();
      await page.waitForTimeout(400);
    },
    fullPage: false,
  },
  {
    name: "dialog-add",
    url: "/app/businesses?add=1",
    act: async (page) => {
      await page.getByRole("dialog").waitFor();
      await page.waitForTimeout(400);
    },
    fullPage: false,
  },
  { name: "import-upload", url: "/app/businesses/import" },
  { name: "import-map", url: `/app/businesses/import?id=${UPLOADED_IMPORT_ID}` },
  {
    name: "import-review",
    url: `/app/businesses/import?id=${UPLOADED_IMPORT_ID}`,
    act: async (page) => {
      await page.getByRole("button", { name: "Check rows" }).click();
      await page.getByText("Check rows before importing").waitFor();
      await page.waitForTimeout(600);
    },
  },
  { name: "import-progress", url: `/app/businesses/import?id=${PROCESSING_IMPORT_ID}` },
  { name: "import-results", url: `/app/businesses/import?id=${COMPLETED_IMPORT_ID}` },
  { name: "sources", url: "/app/sources" },
];

for (const scheme of ["light", "dark"] as const) {
  test.describe(`capture ${scheme}`, () => {
    test.skip(!DIR, "Set E2E_SCREENS_DIR to capture screenshots.");
    test.use({ colorScheme: scheme, reducedMotion: "reduce" });

    for (const shot of SHOTS) {
      test(shot.name, async ({ page }, info) => {
        await mockWorkspaceApi(page, { empty: shot.name === "directory-empty" });
        await page.goto(shot.url);
        // A modal hides the page from the accessibility tree, so wait for the main region instead.
        await page.locator("#main").waitFor();
        await page.waitForLoadState("networkidle");
        await page.waitForTimeout(500);
        if (shot.act) await shot.act(page);
        const width = info.project.name.replace(/^w/, "");
        await page.screenshot({
          path: path.join(DIR ?? ".", `${shot.name}-${width}-${scheme}.png`),
          fullPage: shot.fullPage ?? true,
        });
      });
    }
  });
}

test.describe("capture mid-transition", () => {
  test.skip(!DIR, "Set E2E_SCREENS_DIR to capture screenshots.");
  test.use({ reducedMotion: "no-preference" });

  test("route transition and dialog entry, mid-flight", async ({ page }, info) => {
    test.skip(info.project.name !== "w1440", "Captured once, at 1440px.");
    await mockWorkspaceApi(page);
    await page.goto("/app/businesses");
    await page.getByRole("link", { name: "Mama Put Kitchen (Sample)" }).first().waitFor();
    await page.waitForLoadState("networkidle");
    // Client navigation: the 400ms fade-and-rise page transition, captured at about 140ms.
    await page.getByRole("link", { name: "Mama Put Kitchen (Sample)" }).first().click();
    await page.waitForURL(/\/app\/businesses\/[a-f0-9]{24}$/);
    await page.waitForTimeout(120);
    await page.screenshot({ path: path.join(DIR ?? ".", "transition-route-1440.png") });
    await page.getByRole("heading", { level: 1, name: "Mama Put Kitchen (Sample)" }).waitFor();
    await page.waitForTimeout(700);
    // Tab change: the underline slides between tabs.
    await page.getByRole("tab", { name: /Provenance/ }).click();
    await page.waitForTimeout(120);
    await page.screenshot({ path: path.join(DIR ?? ".", "transition-tab-1440.png") });
    await page.waitForTimeout(800);
    // Dialog entry: 300ms scale-and-fade on emphasized decelerate, captured at about 90ms.
    await page.getByRole("tab", { name: "Overview" }).click();
    await page.waitForTimeout(600);
    await page.getByRole("button", { name: "Correct details" }).click();
    await page.waitForTimeout(90);
    await page.screenshot({ path: path.join(DIR ?? ".", "transition-dialog-1440.png") });
  });
});
