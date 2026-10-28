import { expect, test } from "@playwright/test";
import { horizontalOverflow, mockSignedOut } from "./fixtures";

test("pricing degrades to 'Pricing not yet published' when the API is unreachable", async ({
  page,
}) => {
  await page.goto("/pricing");
  await expect(page.getByText("Pricing not yet published").first()).toBeVisible();
});

test("home renders its hero heading", async ({ page }) => {
  await page.goto("/");
  await expect(
    page.getByRole("heading", { level: 1, name: /worth your next conversation/i }),
  ).toBeVisible();
});

test("mobile menu opens and lists primary navigation", async ({ page, viewport }) => {
  test.skip(!viewport || viewport.width >= 768, "menu button only renders below 768px");
  await page.goto("/");
  await page.getByRole("button", { name: "Open menu" }).click();
  await expect(page.getByRole("dialog").getByRole("link", { name: "Pricing" })).toBeVisible();
});

test("dashboard redirects unauthenticated users to sign in", async ({ page }) => {
  // The API is not running during this suite; emulate its 401 envelope for the session probe.
  await mockSignedOut(page);
  await page.goto("/app");
  // The redirect is a client-side router.replace, so wait for the URL commit, not a load event.
  await page.waitForURL(/\/sign-in\?next=%2Fapp/, { waitUntil: "commit" });
  await expect(page.getByRole("heading", { level: 1, name: "Sign in" })).toBeVisible();
});

test("dashboard shows a retryable error state when the API is unreachable", async ({ page }) => {
  await page.goto("/app");
  await expect(
    page.getByRole("alert").filter({ hasText: "Could not load your workspace" }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Try again" })).toBeVisible();
  const o = await horizontalOverflow(page);
  expect(o.scrollWidth).toBeLessThanOrEqual(o.innerWidth);
});

test("the design gallery is not reachable in production builds", async ({ page, viewport }) => {
  test.skip(!viewport || viewport.width !== 1440, "route check runs once");
  const response = await page.goto("/app/_design");
  expect(response?.status()).toBe(404);
  // The gallery's real folder (reached through a dev-only rewrite) is a 404 too.
  const direct = await page.goto("/app/design-gallery");
  expect(direct?.status()).toBe(404);
});
