import { expect, test } from "@playwright/test";

const ROUTES = [
  "/",
  "/product",
  "/pricing",
  "/about",
  "/contact",
  "/sign-in",
  "/sign-up",
  "/legal/privacy",
];

for (const route of ROUTES) {
  test(`${route} has no horizontal overflow and a visible heading`, async ({ page }) => {
    await page.goto(route);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();

    const overflow = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      innerWidth: window.innerWidth,
    }));
    expect(
      overflow.scrollWidth,
      `scrollWidth ${overflow.scrollWidth} > innerWidth ${overflow.innerWidth}`,
    ).toBeLessThanOrEqual(overflow.innerWidth);
  });
}

test("pricing degrades to 'Pricing not yet published' when the API is unreachable", async ({
  page,
}) => {
  await page.goto("/pricing");
  await expect(page.getByText("Pricing not yet published")).toBeVisible();
});

test("home renders its hero under reduced motion", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  const hero = page.getByRole("heading", { level: 1, name: /worth your next conversation/i });
  await expect(hero).toBeVisible();
  const opacity = await hero.evaluate((el) => getComputedStyle(el.parentElement ?? el).opacity);
  expect(Number(opacity)).toBe(1);
});

test("mobile menu opens and lists primary navigation", async ({ page, viewport }) => {
  test.skip(!viewport || viewport.width >= 768, "menu button only renders below 768px");
  await page.goto("/");
  await page.getByRole("button", { name: "Open menu" }).click();
  await expect(page.getByRole("link", { name: "Pricing" }).first()).toBeVisible();
});

test("dashboard redirects unauthenticated users to sign in", async ({ page }) => {
  // The API is not running during this suite; emulate its 401 envelope for the session probe.
  await page.route("**/api/v1/auth/me", (route) =>
    route.fulfill({
      status: 401,
      contentType: "application/json",
      body: JSON.stringify({
        error: { code: "UNAUTHENTICATED", message: "Sign in required", requestId: "e2e" },
      }),
    }),
  );
  await page.goto("/app");
  await page.waitForURL(/\/sign-in\?next=%2Fapp/);
  await expect(page.getByRole("heading", { level: 1, name: "Sign in" })).toBeVisible();
});

test("dashboard shows a retryable error state when the API is unreachable", async ({ page }) => {
  await page.goto("/app");
  await expect(
    page.getByRole("alert").filter({ hasText: "Could not load your workspace" }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Try again" })).toBeVisible();
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth <= window.innerWidth,
  );
  expect(overflow).toBe(true);
});
