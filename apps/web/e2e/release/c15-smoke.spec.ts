import { expect, test } from "@playwright/test";
import {
  api,
  expectNoHorizontalScroll,
  openNav,
  PASSWORD,
  primaryOrg,
  releaseOnly,
  runId,
  seededEmail,
  shot,
  signInThroughForm,
} from "./helpers";

/*
 * Criterion 15 (smoke subset): at 240, 768 and 1024 px, sign in through the form, open the
 * directory from the navigation, a business, the pipeline and billing, against the live stack.
 * No page may scroll sideways. The full flow runs at 1440 and 375 (projects release-1440 and
 * release-375), where every step also checks for sideways scrolling.
 */

test.describe("C15 mobile, tablet and desktop (smoke)", () => {
  releaseOnly();

  test("C15 sign-in, directory, business detail, pipeline and billing without sideways scrolling", async ({
    page,
  }, info) => {
    const run = runId();
    const width = info.project.use.viewport?.width ?? 0;

    // Sign-in, through the form at this width.
    await page.goto("/sign-in");
    await expectNoHorizontalScroll(page, `sign-in at ${width}`);
    await signInThroughForm(page, seededEmail("owner", "smoke"), PASSWORD);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expectNoHorizontalScroll(page, `overview at ${width}`);
    const org = await primaryOrg(page);
    const name = `E2E Smoke ${width} ${run} (Sample)`;
    const biz = await api<{ id: string }>(page, "POST", "/businesses", org.id, {
      name,
      phones: [`+44191498${String(width).padStart(4, "0")}`],
      website: "http://clinic.lf-e2e.test",
      location: { locality: "Ikeja", region: "Lagos" },
      categories: ["Clinic"],
    });
    await api(page, "POST", "/pipeline/leads", org.id, { businessId: biz.id });

    // Directory, reached through the navigation (a drawer below 1024 px).
    await openNav(page);
    await page.getByRole("link", { name: "Businesses", exact: true }).first().click();
    await page.waitForURL(/\/app\/businesses$/);
    await expect(page.getByRole("heading", { level: 1, name: "Businesses" })).toBeVisible();
    await expect(page.locator("#main").getByRole("link", { name }).first()).toBeVisible({
      timeout: 30_000,
    });
    await expectNoHorizontalScroll(page, `directory at ${width}`);
    await shot(page, info, "c15-directory");

    // Business detail.
    await page.locator("#main").getByRole("link", { name }).first().click();
    await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
    await expectNoHorizontalScroll(page, `business detail at ${width}`);
    await shot(page, info, "c15-business");

    // Pipeline.
    await page.goto("/app/pipeline");
    await expect(page.getByRole("heading", { level: 1, name: "Lead pipeline" })).toBeVisible();
    await expect(page.locator("#main")).toContainText(name, { timeout: 30_000 });
    await expectNoHorizontalScroll(page, `pipeline at ${width}`);
    await shot(page, info, "c15-pipeline");

    // Billing, both tabs.
    await page.goto("/app/billing");
    await expect(page.getByRole("heading", { level: 1, name: "Billing" })).toBeVisible();
    await expect(page.getByTestId("billing-plan-card")).toBeVisible();
    await expectNoHorizontalScroll(page, `billing at ${width}`);
    await page.getByRole("tab", { name: "Plans and credits" }).click();
    await expect(page.getByTestId("pack-card").first()).toBeVisible();
    await expect(page.locator("#main")).not.toContainText(/₦\s?0(\.00)?\b/);
    await expectNoHorizontalScroll(page, `billing plans at ${width}`);
    await shot(page, info, "c15-billing");
  });
});
