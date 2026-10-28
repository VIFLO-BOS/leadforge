import { expect, test, type Page } from "@playwright/test";
import {
  AUTH_ROUTES,
  BUSINESS_ROUTES,
  DISCOVERY_ROUTES,
  MARKETING_ROUTES,
  PHASE4_ROUTES,
  PHASE5_ROUTES,
  PHASE6_ROUTES,
  SHELL_ROUTES,
  STAGE10_ROUTES,
  horizontalOverflow,
  mockMissingInvitation,
  mockWorkspaceApi,
} from "./fixtures";

/*
 * Viewport suite: every marketing, auth, shell, Phase 2 business, Phase 3 discovery, jobs,
 * usage and notification page, and every Phase 4 analysis, scoring and duplicate page, at every
 * project width
 * (240, 320, 375, 768, 1024, 1440) must show its h1 and never scroll sideways.
 */

async function expectNoOverflow(page: Page, where: string) {
  const o = await horizontalOverflow(page);
  expect(
    o.scrollWidth,
    `${where}: scrollWidth ${o.scrollWidth} > innerWidth ${o.innerWidth}`,
  ).toBeLessThanOrEqual(o.innerWidth);
}

for (const route of MARKETING_ROUTES) {
  test(`marketing ${route} has a visible h1 and no horizontal overflow`, async ({ page }) => {
    await page.goto(route);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expectNoOverflow(page, route);
  });
}

for (const route of AUTH_ROUTES) {
  test(`auth ${route} has a visible h1 and no horizontal overflow`, async ({ page }) => {
    await mockMissingInvitation(page);
    await page.goto(route);
    await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible();
    await expectNoOverflow(page, route);
  });
}

test("invite page shows its error state when the invitation cannot be loaded", async ({ page }) => {
  await mockMissingInvitation(page);
  await page.goto("/invite/sample-token");
  await expect(page.getByRole("alert").first()).toBeVisible();
  await expectNoOverflow(page, "/invite/sample-token");
});

for (const route of SHELL_ROUTES) {
  test(`shell ${route} renders with mocked API and no horizontal overflow`, async ({ page }) => {
    await mockWorkspaceApi(page);
    await page.goto(route);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    // Let data-driven sections settle before measuring.
    await page.waitForLoadState("networkidle");
    await expectNoOverflow(page, `${route} (top)`);
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await expectNoOverflow(page, `${route} (bottom)`);
  });
}

for (const route of BUSINESS_ROUTES) {
  test(`business ${route} renders with mocked API and no horizontal overflow`, async ({ page }) => {
    await mockWorkspaceApi(page);
    await page.goto(route);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await page.waitForLoadState("networkidle");
    await expectNoOverflow(page, `${route} (top)`);
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await expectNoOverflow(page, `${route} (bottom)`);
  });
}

for (const route of DISCOVERY_ROUTES) {
  test(`phase 3 ${route} renders with mocked API and no horizontal overflow`, async ({ page }) => {
    await mockWorkspaceApi(page);
    await page.goto(route);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await page.waitForLoadState("networkidle");
    await expectNoOverflow(page, `${route} (top)`);
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await expectNoOverflow(page, `${route} (bottom)`);
  });
}

for (const route of PHASE4_ROUTES) {
  test(`phase 4 ${route} renders with mocked API and no horizontal overflow`, async ({ page }) => {
    await mockWorkspaceApi(page);
    await page.goto(route);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await page.waitForLoadState("networkidle");
    await expectNoOverflow(page, `${route} (top)`);
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await expectNoOverflow(page, `${route} (bottom)`);
  });
}

for (const route of PHASE5_ROUTES) {
  test(`phase 5 ${route} renders with mocked API and no horizontal overflow`, async ({ page }) => {
    await mockWorkspaceApi(page);
    await page.goto(route);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await page.waitForLoadState("networkidle");
    await expectNoOverflow(page, `${route} (top)`);
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await expectNoOverflow(page, `${route} (bottom)`);
  });
}

for (const route of PHASE6_ROUTES) {
  test(`phase 6 ${route} renders with mocked API and no horizontal overflow`, async ({ page }) => {
    await mockWorkspaceApi(page);
    await page.goto(route);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await page.waitForLoadState("networkidle");
    await expectNoOverflow(page, `${route} (top)`);
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await expectNoOverflow(page, `${route} (bottom)`);
  });
}

/** Stage 10: Settings, Organization with the export and the deletion, idle and while a deletion is pending. */
for (const route of STAGE10_ROUTES) {
  for (const variant of ["idle", "pending"] as const) {
    test(`stage 10 ${route} (${variant}) renders with mocked API and no horizontal overflow`, async ({
      page,
    }) => {
      await mockWorkspaceApi(
        page,
        variant === "pending"
          ? { orgDeletion: "pending", orgExport: "running" }
          : { orgExport: "completed" },
      );
      await page.goto(route);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      await page.waitForLoadState("networkidle");
      await expect(page.getByTestId("data-and-deletion")).toBeVisible();
      if (variant === "pending")
        await expect(page.getByTestId("org-deletion-banner")).toBeVisible();
      await expectNoOverflow(page, `${route} ${variant} (top)`);
      await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
      await expectNoOverflow(page, `${route} ${variant} (bottom)`);
    });
  }
}
