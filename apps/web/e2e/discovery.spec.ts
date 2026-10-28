import { expect, test, type Page } from "@playwright/test";
import { expectControlsFit, expectDialogFits, expectNoOverflow } from "./assertions";
import { DISCOVERY_ROUTES, RUNNING_JOB_ID, mockWorkspaceApi } from "./fixtures";
import {
  COMPLETED_JOB,
  FAILED_JOB_ID,
  QUEUED_JOB,
  UNKNOWN_JOB_ID,
  WARNINGS_JOB_ID,
} from "./fixtures-discovery";

/*
 * Phase 3 screens against mocked API responses at every project width: discovery jobs, the job
 * wizard, job detail, all jobs, usage and credits, notifications and source switching. Plus the
 * controls-fit and reduced-motion checks for every Phase 3 route.
 */

// Several tests navigate more than once or walk the five-step wizard; loaded machines need time.
test.describe.configure({ timeout: 90_000 });

const narrow = (page: Page) => (page.viewportSize()?.width ?? 0) < 480;
const belowMd = (page: Page) => (page.viewportSize()?.width ?? 0) < 768;

test.describe("controls fit at every width (Phase 3)", () => {
  for (const route of DISCOVERY_ROUTES) {
    test(`${route}`, async ({ page }) => {
      await mockWorkspaceApi(page);
      await page.goto(route);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      await page.waitForLoadState("networkidle");
      await expectControlsFit(page, route);
    });
  }
});

test.describe("motion (Phase 3)", () => {
  for (const mode of ["reduce", "no-preference"] as const) {
    test.describe(`reduced motion: ${mode}`, () => {
      test.use({ reducedMotion: mode });
      for (const route of DISCOVERY_ROUTES) {
        test(`${route} renders without runtime errors`, async ({ page }) => {
          const errors: string[] = [];
          page.on("pageerror", (e) => errors.push(e.message));
          page.on("console", (m) => {
            if (m.type() === "error" && !/Failed to load resource/.test(m.text()))
              errors.push(m.text());
          });
          await mockWorkspaceApi(page);
          await page.goto(route);
          await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
          await page.waitForLoadState("networkidle");
          const opacity = await page
            .getByRole("heading", { level: 1 })
            .first()
            .evaluate((el) => {
              let o = 1;
              for (let n: Element | null = el; n; n = n.parentElement)
                o *= Number(getComputedStyle(n).opacity);
              return o;
            });
          expect(opacity).toBeGreaterThan(0.99);
          await expectNoOverflow(page, route);
          expect(errors, errors.join("\n")).toEqual([]);
        });
      }
    });
  }
});

test.describe("navigation", () => {
  test("Phase 3 destinations are enabled; Scheduled Jobs stays disabled with no route", async ({
    page,
  }) => {
    await mockWorkspaceApi(page);
    await page.goto("/app");
    if ((page.viewportSize()?.width ?? 0) < 1024) {
      await page.getByRole("button", { name: "Open navigation" }).click();
    }
    const nav = page.getByRole("navigation", { name: "Dashboard" }).last();
    await expect(nav.getByRole("link", { name: /Discovery$/ })).toHaveAttribute(
      "href",
      "/app/discovery",
    );
    await expect(nav.getByRole("link", { name: /Discovery Jobs/ })).toHaveAttribute(
      "href",
      "/app/jobs",
    );
    await expect(nav.getByRole("link", { name: /Usage and Credits/ })).toHaveAttribute(
      "href",
      "/app/usage",
    );
    await expect(nav.getByRole("link", { name: /Scheduled Jobs/ })).toHaveCount(0);
    await expect(nav.getByText("Scheduled Jobs")).toBeVisible();
  });
});

test.describe("discovery jobs", () => {
  test("list shows real counts, cards under 480px, and filters survive a reload", async ({
    page,
  }) => {
    await mockWorkspaceApi(page);
    await page.goto("/app/discovery");
    await expect(page.getByRole("heading", { level: 1, name: "Discovery" })).toBeVisible();
    if (narrow(page)) {
      await expect(page.getByRole("list", { name: "Discovery jobs" })).toBeVisible();
    } else {
      await expect(page.getByRole("table", { name: "Discovery jobs" })).toBeVisible();
    }
    await expect(page.getByRole("link", { name: COMPLETED_JOB.name }).first()).toBeVisible();
    await expect(page.getByText("26 new · 1 updated").first()).toBeVisible();
    await page.goto("/app/discovery?status=failed");
    await expect(
      page.getByRole("link", { name: "Supermarkets in Kano (Sample)" }).first(),
    ).toBeVisible();
    await expect(page.getByRole("link", { name: COMPLETED_JOB.name })).toHaveCount(0);
    await page.reload();
    await expect(page).toHaveURL(/status=failed/);
    await expectNoOverflow(page, "discovery list");
  });

  test("an empty workspace offers Create discovery job", async ({ page }) => {
    await mockWorkspaceApi(page, { empty: true });
    await page.goto("/app/discovery");
    await expect(page.getByRole("heading", { name: "No discovery jobs yet" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Create discovery job" }).last()).toHaveAttribute(
      "href",
      "/app/discovery/new",
    );
  });

  test("an analyst sees jobs but cannot create one", async ({ page }) => {
    await mockWorkspaceApi(page, { role: "analyst" });
    await page.goto("/app/discovery");
    await expect(page.getByRole("link", { name: COMPLETED_JOB.name }).first()).toBeVisible();
    await expect(page.getByRole("link", { name: "Create discovery job" })).toHaveCount(0);
    await page.goto("/app/discovery/new");
    await expect(page.getByText("Your role cannot create discovery jobs")).toBeVisible();
  });
});

async function walkToEstimate(page: Page) {
  await page.goto("/app/discovery/new");
  await expect(page.getByText("Choose where to search")).toBeVisible();
  await expect(page.getByRole("checkbox", { name: "Google Places API (New)" })).toBeDisabled();
  await expect(page.getByText(/^Not available: Google's terms/)).toBeVisible();
  await expect(page.getByRole("checkbox", { name: "Overture Maps Places" })).toBeChecked();
  await page.getByRole("button", { name: /Continue/ }).click();
  await expect(page.getByText("What to find, and where")).toBeVisible();
  await page.getByRole("button", { name: /^Pharmacy/ }).click();
  await page.getByLabel("City or town").fill("Ikeja");
  await expect(page.getByLabel("Name")).toHaveValue("Pharmacy in Ikeja");
  await page.getByRole("button", { name: /Continue/ }).click();
  await expect(page.getByText("Set limits")).toBeVisible();
  await expect(page.getByRole("radio", { name: /^High/ })).toBeVisible();
  await page.getByRole("button", { name: /Continue/ }).click();
  await expect(page.getByText("Check the estimate")).toBeVisible();
}

test.describe("discovery wizard", () => {
  test("walks every step, validates, estimates and creates the job", async ({ page }) => {
    await mockWorkspaceApi(page);
    await page.goto("/app/discovery/new?step=target");
    // A deep link cannot skip ahead of an incomplete step... but step 1 is complete here
    // (the runnable source is preselected), so the target step shows with its validation.
    await expect(page).toHaveURL(/step=target/);
    await page.getByRole("button", { name: /Continue/ }).click();
    await expect(page.getByText("Add at least one category or keyword.")).toBeVisible();
    await expectNoOverflow(page, "target with errors");

    await walkToEstimate(page);
    await expect(page.getByTestId("estimate")).toContainText("Credits held");
    await expectNoOverflow(page, "estimate");
    await page.getByRole("button", { name: /Continue/ }).click();
    await expect(page.getByRole("heading", { name: "Review and create" })).toBeVisible();
    await expect(page.getByRole("radio", { name: /Schedule/ })).toBeDisabled();
    await expectNoOverflow(page, "review");
    const create = page.waitForRequest(
      (r) => r.method() === "POST" && new URL(r.url()).pathname === "/api/v1/discovery/jobs",
    );
    await page.getByRole("button", { name: "Create discovery job" }).click();
    const request = await create;
    expect(request.headers()["idempotency-key"]).toMatch(/^wizard-/);
    await page.waitForURL((url) => url.pathname === `/app/discovery/${QUEUED_JOB.id}`);
    await expect(page.getByRole("heading", { level: 1, name: QUEUED_JOB.name })).toBeVisible();
  });

  test("insufficient credits: required versus available, purchase disabled", async ({ page }) => {
    await mockWorkspaceApi(page, { estimate: "insufficient" });
    await walkToEstimate(page);
    const shortfall = page.getByTestId("credits-shortfall");
    await expect(shortfall).toContainText("This job holds 100 credits and 42 are available");
    // Phase 6: owners buy credits on the Billing page.
    await expect(shortfall.getByRole("link", { name: /Buy credits/ })).toHaveAttribute(
      "href",
      "/app/billing?tab=plans#credit-packs",
    );
    await expect(page.getByRole("button", { name: /Continue/ })).toBeDisabled();
    await expectControlsFit(page, "insufficient credits");
  });

  test("blockers prevent creation and explain why", async ({ page }) => {
    await mockWorkspaceApi(page, { estimate: "blocked" });
    await walkToEstimate(page);
    const blockers = page.getByTestId("estimate-blockers");
    await expect(blockers).toContainText("Source disabled · Overture Maps Places");
    await expect(page.getByRole("button", { name: /Continue/ })).toBeDisabled();
    await expectControlsFit(page, "blocked estimate");
  });

  test("a rate-limited create honours Retry-After", async ({ page }) => {
    await mockWorkspaceApi(page, {
      createError: {
        status: 429,
        code: "RATE_LIMITED",
        message: "Too many requests",
        retryAfter: 45,
      },
    });
    await walkToEstimate(page);
    await page.getByRole("button", { name: /Continue/ }).click();
    await page.getByRole("button", { name: "Create discovery job" }).click();
    await expect(page.getByText(/You can try again in (45|44|43) seconds/)).toBeVisible();
    await expect(page.getByRole("button", { name: "Create discovery job" })).toBeDisabled();
  });
});

test.describe("discovery job detail", () => {
  test("a running job shows real counts, no percentage, and a cancel confirmation that fits", async ({
    page,
  }) => {
    await mockWorkspaceApi(page);
    await page.goto(`/app/discovery/${RUNNING_JOB_ID}`);
    await expect(page.getByTestId("job-status")).toContainText("Running");
    const progress = page.getByTestId("job-progress");
    await expect(progress).toContainText("New businesses");
    await expect(progress).toContainText("of at most 100");
    await expect(progress).not.toContainText("%");
    await expect(page.getByTestId("items-attribution")).toContainText("Overture Maps Foundation");
    await expect(page.getByText("Name expired under source terms").first()).toBeVisible();
    await page.getByRole("button", { name: /Cancel job/ }).click();
    await expect(
      page.getByRole("alertdialog", { name: "Cancel this discovery job?" }),
    ).toBeVisible();
    await expectDialogFits(page, "alertdialog");
  });

  test("outcome filter lives in the URL; retry-failed is offered when items failed", async ({
    page,
  }) => {
    await mockWorkspaceApi(page);
    await page.goto(`/app/discovery/${WARNINGS_JOB_ID}?outcome=failed`);
    await expect(page.getByRole("button", { name: "Retry 3 failed items" })).toBeVisible();
    await expect(page.getByText("Could not be saved").first()).toBeVisible();
    await expect(page.getByText("Permanently closed")).toHaveCount(0);
    await expectNoOverflow(page, "filtered items");
  });

  test("a failed job explains why; an unknown id is not found", async ({ page }) => {
    await mockWorkspaceApi(page);
    await page.goto(`/app/discovery/${FAILED_JOB_ID}`);
    await expect(
      page.getByRole("alert").filter({ hasText: "This job failed: Source disabled" }),
    ).toBeVisible();
    await page.goto(`/app/discovery/${UNKNOWN_JOB_ID}`);
    await expect(
      page.getByRole("heading", { level: 1, name: "Discovery job not found" }),
    ).toBeVisible();
  });
});

test.describe("all jobs, usage and sources", () => {
  test("all jobs link to their own pages and never to a missing one", async ({ page }) => {
    await mockWorkspaceApi(page);
    await page.goto("/app/jobs");
    await expect(page.getByRole("heading", { level: 1, name: "Background jobs" })).toBeVisible();
    await expect(page.getByRole("link", { name: COMPLETED_JOB.name }).first()).toHaveAttribute(
      "href",
      `/app/discovery/${COMPLETED_JOB.id}`,
    );
    // Phase 4: analyses link to their own page; nothing says "coming soon" any more.
    await expect(
      page.getByRole("link", { name: "Website analysis: mamaput.example.test" }).first(),
    ).toHaveAttribute("href", "/app/analysis/6add8b76520012303c64a001");
    await expect(page.getByText("Detail page coming soon")).toHaveCount(0);
  });

  test("usage shows the balance and the ledger; owners buy credits on Billing", async ({
    page,
  }) => {
    await mockWorkspaceApi(page);
    await page.goto("/app/usage");
    await expect(page.getByTestId("credits-available")).toContainText("877");
    await expect(page.locator("#main").getByRole("link", { name: /Buy credits/ })).toHaveAttribute(
      "href",
      "/app/billing?tab=plans#credit-packs",
    );
    await expect(page.getByText("27 charged from the hold").first()).toBeVisible();
    await expectNoOverflow(page, "usage");
  });

  test("a sales rep sees the balance but not the ledger", async ({ page }) => {
    await mockWorkspaceApi(page, { role: "sales_rep" });
    await page.goto("/app/usage");
    await expect(page.getByTestId("credits-available")).toContainText("877");
    await expect(page.getByText("The ledger is not available to your role")).toBeVisible();
    await expect(page.getByRole("table", { name: "Credit ledger" })).toHaveCount(0);
  });

  test("switching a source off asks first, and the dialog fits", async ({ page }) => {
    await mockWorkspaceApi(page);
    await page.goto("/app/sources");
    const toggle = page.getByRole("switch", { name: /Enabled in this workspace/ });
    await expect(toggle).toBeChecked();
    await toggle.click();
    await expect(
      page.getByRole("alertdialog", { name: "Switch off Overture Maps Places?" }),
    ).toBeVisible();
    await expectDialogFits(page, "alertdialog");
    await page.getByRole("button", { name: "Switch off" }).click();
    await expect(toggle).not.toBeChecked();
  });

  test("a researcher cannot switch sources", async ({ page }) => {
    await mockWorkspaceApi(page, { role: "researcher" });
    await page.goto("/app/sources");
    await expect(page.getByTestId("source-licensing").first()).toBeVisible();
    await expect(page.getByRole("switch")).toHaveCount(0);
  });
});

test.describe("notifications", () => {
  test("the bell opens the list (full screen under 480px) and marks all read", async ({ page }) => {
    await mockWorkspaceApi(page);
    await page.goto("/app");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    const width = page.viewportSize()?.width ?? 0;
    if (width < 360) {
      await page.getByRole("button", { name: /Account menu/ }).click();
      await page.getByRole("menuitem", { name: "Notifications" }).click();
    } else {
      await page.getByRole("button", { name: "Notifications, 2 unread" }).click();
    }
    const panel = page.getByTestId("notification-panel");
    await expect(panel).toBeVisible();
    await expect(
      panel.getByRole("list", { name: "Notifications" }).getByRole("listitem"),
    ).toHaveCount(3);
    const box = await panel.boundingBox();
    expect(box?.width ?? 0).toBeLessThanOrEqual(width + 1);
    if (narrow(page)) expect(box?.width ?? 0).toBeGreaterThanOrEqual(width - 1);
    const readAll = page.waitForRequest((r) => r.url().endsWith("/notifications/read-all"));
    await panel.getByRole("button", { name: /Mark all read/ }).click();
    await readAll;
    await expectNoOverflow(page, "notifications");
  });

  test("notification preferences save from settings", async ({ page }) => {
    await mockWorkspaceApi(page);
    await page.goto("/app/settings?tab=notifications");
    const email = page.getByRole("switch", { name: /Email when a discovery job fails/ });
    await expect(email).toBeChecked();
    const put = page.waitForRequest(
      (r) => r.method() === "PUT" && r.url().endsWith("/notifications/preferences"),
    );
    await email.click();
    expect((await put).postDataJSON()).toEqual({ emailJobEvents: false });
  });
});

test.describe("overview", () => {
  test("shows discovery and credit figures and links to the wizard", async ({ page }) => {
    await mockWorkspaceApi(page);
    await page.goto("/app");
    await expect(page.getByTestId("recent-discovery")).toContainText(COMPLETED_JOB.name);
    await expect(page.getByRole("link", { name: /Create a discovery job/ })).toHaveAttribute(
      "href",
      "/app/discovery/new",
    );
    if (!belowMd(page) && (page.viewportSize()?.width ?? 0) >= 1024) {
      await expect(page.getByTestId("credits-chip")).toContainText("877");
    }
  });
});
