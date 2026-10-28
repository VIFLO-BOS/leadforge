import { expect, test, type Page } from "@playwright/test";
import { STATE_AUDIT, matchesPath, type StateAudit } from "./a11y-routes";
import { errorBody, mockWorkspaceApi } from "./fixtures";

/*
 * Every dashboard page in STATE_AUDIT shows all four states:
 * - loading: a busy placeholder in #main while its primary request is in flight;
 * - empty: an explanatory empty state (list pages, with the empty fixture);
 * - error: an alert with the request ID and a retry that requests the data again;
 * - success: the page heading with no alert.
 * Runs at 1440 and 375.
 */

const PROJECTS = new Set(["w375", "w1440"]);
test.use({ reducedMotion: "reduce" });
test.describe.configure({ timeout: 90_000 });
test.beforeEach(() => {
  test.skip(!PROJECTS.has(test.info().project.name), "state audit runs at 375 and 1440");
});

const apiPath = (url: string) => new URL(url).pathname.replace(/^\/api\/v1/, "");

/** Registers a handler for the audited endpoint, on top of the workspace mocks. */
async function onEndpoint(page: Page, a: StateAudit, handle: "delay" | "fail") {
  let calls = 0;
  await page.route("**/api/v1/**", async (route) => {
    const req = route.request();
    if (
      !(a.methods ?? ["GET"]).includes(req.method()) ||
      !matchesPath(a.endpoint, apiPath(req.url()))
    )
      return route.fallback();
    calls++;
    if (handle === "delay") {
      await new Promise((r) => setTimeout(r, 3_000));
      return route.fallback();
    }
    return route.fulfill({
      status: 500,
      contentType: "application/json",
      body: JSON.stringify(errorBody("INTERNAL", "Something went wrong")),
    });
  });
  return () => calls;
}

for (const a of STATE_AUDIT) {
  test.describe(`states ${a.path}`, () => {
    test("loading", async ({ page }) => {
      await mockWorkspaceApi(page);
      await onEndpoint(page, a, "delay");
      await page.goto(a.path);
      await expect(page.locator("#main [aria-busy=true]").first()).toBeAttached({
        timeout: 15_000,
      });
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible({ timeout: 20_000 });
    });

    test("error with request ID and retry", async ({ page }) => {
      await mockWorkspaceApi(page);
      const calls = await onEndpoint(page, a, "fail");
      await page.goto(a.path);
      const alert = page.locator("#main [role=alert]").filter({ hasText: "Request ID" }).first();
      await expect(alert).toBeVisible({ timeout: 20_000 });
      await expect(alert).toContainText("e2e");
      const retry = alert.getByRole("button");
      await expect(retry).toBeVisible();
      const before = calls();
      await retry.focus();
      await page.keyboard.press("Enter");
      await expect.poll(calls, { timeout: 10_000 }).toBeGreaterThan(before);
    });

    if (a.empty) {
      test("empty", async ({ page }) => {
        await mockWorkspaceApi(page, { empty: true });
        if (a.emptyBody !== undefined) {
          await page.route("**/api/v1/**", (route) =>
            route.request().method() === "GET" &&
            matchesPath(a.endpoint, apiPath(route.request().url()))
              ? route.fulfill({
                  status: 200,
                  contentType: "application/json",
                  body: JSON.stringify(a.emptyBody),
                })
              : route.fallback(),
          );
        }
        await page.goto(a.path);
        await expect(page.locator("#main").getByRole("heading", { name: a.empty })).toBeVisible();
      });
    }

    test("success", async ({ page }) => {
      await mockWorkspaceApi(page);
      await page.goto(a.path);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      await page.waitForLoadState("networkidle");
      await expect(
        page.locator("#main [role=alert]").filter({ hasText: "Request ID" }),
      ).toHaveCount(0);
    });
  });
}
