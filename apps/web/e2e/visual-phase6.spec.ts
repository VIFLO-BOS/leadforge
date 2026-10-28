import { test, type Page } from "@playwright/test";
import path from "node:path";
import { BUSINESS_ID, mockWorkspaceApi, type MockOptions } from "./fixtures";
import { BULK_DONE_ID } from "./fixtures-phase5";
import { RETURN_REFS } from "./fixtures-phase6";

/*
 * Visual review captures for the Phase 6 screens against the mocked API: billing (overview, free
 * tier, not configured, test mode, unpublished prices, past due, payments, invoices, the refund and
 * cancel dialogs, a checkout error), the return page states, the shell banners, the member limit,
 * pipeline stages, lead details, the next attempt and named bulk results. Skipped unless
 * E2E_SCREENS_DIR is set; light and dark at 240, 375, 768 and 1440. Not assertions.
 *   E2E_SCREENS_DIR=<dir> PLAYWRIGHT_PORT=3300 pnpm exec playwright test visual-phase6
 */

const DIR = process.env.E2E_SCREENS_DIR;
const WIDTHS = new Set(["w240", "w375", "w768", "w1440"]);
const main = (page: Page) => page.locator("#main");

interface Shot {
  name: string;
  url: string;
  opts?: MockOptions;
  act?: (page: Page) => Promise<void>;
  fullPage?: boolean;
}

const phase = (p: string) => async (page: Page) => {
  await page
    .getByTestId("billing-return")
    .and(page.locator(`[data-phase="${p}"]`))
    .waitFor({ timeout: 15_000 });
};

const SHOTS: Shot[] = [
  { name: "p6-billing", url: "/app/billing", opts: { banners: ["payment_failed"] } },
  { name: "p6-billing-free", url: "/app/billing", opts: { subscription: "none" } },
  {
    name: "p6-billing-past-due",
    url: "/app/billing",
    opts: { subscription: "past_due", banners: ["past_due"] },
  },
  {
    name: "p6-billing-negative",
    url: "/app/billing",
    opts: { negativeBalance: true, banners: ["negative_balance"] },
  },
  { name: "p6-billing-not-configured", url: "/app/billing?tab=plans", opts: { provider: "none" } },
  { name: "p6-billing-plans", url: "/app/billing?tab=plans" },
  { name: "p6-billing-unpublished", url: "/app/billing?tab=plans", opts: { unpublished: true } },
  {
    name: "p6-billing-test-mode",
    url: "/app/billing?tab=plans",
    opts: { provider: "test", unpublished: true },
  },
  {
    name: "p6-billing-checkout-error",
    url: "/app/billing?tab=plans",
    opts: { checkoutError: "PAYMENT_PROVIDER_ERROR" },
    act: async (page) => {
      await main(page).getByRole("button", { name: "Buy 500 credits" }).click();
      await page.getByTestId("checkout-problem").waitFor();
    },
  },
  { name: "p6-billing-payments", url: "/app/billing?tab=payments" },
  { name: "p6-billing-invoices", url: "/app/billing?tab=invoices" },
  { name: "p6-billing-invoices-empty", url: "/app/billing?tab=invoices", opts: { empty: true } },
  { name: "p6-billing-link-expired", url: "/app/billing?downloadError=DOWNLOAD_LINK_EXPIRED" },
  {
    name: "p6-refund-dialog",
    url: "/app/billing?tab=payments",
    act: async (page) => {
      await main(page).getByTestId("refund-button").first().click();
      await page
        .getByRole("alertdialog")
        .getByLabel(/Amount to refund/)
        .fill("5000");
    },
    fullPage: false,
  },
  {
    name: "p6-cancel-dialog",
    url: "/app/billing",
    act: async (page) => {
      await main(page).getByRole("button", { name: "Cancel at period end…" }).click();
      await page.getByRole("alertdialog").waitFor();
    },
    fullPage: false,
  },
  {
    name: "p6-billing-forbidden",
    url: "/app/billing",
    opts: { role: "researcher", banners: ["negative_balance"] },
  },
  { name: "p6-return-confirming", url: `/app/billing/return?reference=${RETURN_REFS.slow}` },
  {
    name: "p6-return-success",
    url: `/app/billing/return?reference=${RETURN_REFS.paid}`,
    act: phase("success"),
  },
  {
    name: "p6-return-failed",
    url: `/app/billing/return?reference=${RETURN_REFS.failed}`,
    act: phase("failed"),
  },
  {
    name: "p6-return-review",
    url: `/app/billing/return?reference=${RETURN_REFS.review}`,
    act: phase("under_review"),
  },
  { name: "p6-return-not-found", url: `/app/billing/return?reference=${RETURN_REFS.unknown}` },
  {
    name: "p6-overview-banners",
    url: "/app",
    opts: { banners: ["negative_balance", "past_due", "payment_failed"] },
  },
  {
    name: "p6-invite-limit",
    url: "/app/team",
    opts: { memberLimit: true },
    act: async (page) => {
      await main(page).getByRole("button", { name: "Invite member" }).click();
      const dialog = page.getByRole("dialog");
      await dialog.getByLabel(/Email/).fill("new.person@example.test");
      await dialog.getByRole("button", { name: "Send invitation" }).click();
      await dialog.getByTestId("member-limit").waitFor();
    },
    fullPage: false,
  },
  { name: "p6-pipeline-stages", url: "/app/settings?tab=pipeline" },
  {
    name: "p6-pipeline-stages-edited",
    url: "/app/settings?tab=pipeline",
    act: async (page) => {
      await main(page).getByRole("button", { name: "Add stage" }).click();
      await main(page).getByRole("button", { name: "Archive Interested" }).click();
    },
  },
  {
    name: "p6-pipeline-stages-conflict",
    url: "/app/settings?tab=pipeline",
    opts: { configConflict: true },
    act: async (page) => {
      await main(page).getByLabel("Stage 1 name").fill("Inbox");
      await main(page).getByRole("button", { name: "Save stages" }).click();
      await page.getByTestId("stages-notice").waitFor();
    },
  },
  { name: "p6-business-lead-panel", url: `/app/businesses/${BUSINESS_ID}` },
  {
    name: "p6-lead-details",
    url: `/app/businesses/${BUSINESS_ID}`,
    act: async (page) => {
      await main(page)
        .getByTestId("lead-panel")
        .getByRole("button", { name: "Edit details…" })
        .click();
      await page.getByTestId("lead-details-dialog").waitFor();
    },
    fullPage: false,
  },
  { name: "p6-pipeline-won-column", url: "/app/pipeline?stage=won" },
  {
    name: "p6-next-attempt",
    url: "/app/outreach",
    act: async (page) => {
      await main(page)
        .getByRole("button", { name: /^Next attempt/ })
        .first()
        .click();
      await page.getByTestId("next-attempt-dialog").waitFor();
    },
    fullPage: false,
  },
  { name: "p6-bulk-names", url: `/app/jobs/bulk/${BULK_DONE_ID}` },
  { name: "p6-overview", url: "/app" },
  { name: "p6-usage", url: "/app/usage" },
];

for (const scheme of ["light", "dark"] as const) {
  test.describe(`phase 6 capture ${scheme}`, () => {
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
        await page.waitForTimeout(400);
        const width = info.project.name.replace(/^w/, "");
        await page.screenshot({
          path: path.join(DIR ?? ".", `${shot.name}-${width}-${scheme}.png`),
          fullPage: shot.fullPage ?? true,
        });
      });
    }
  });
}
