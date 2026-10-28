import { expect, test, type Page, type Request } from "@playwright/test";
import { EXPIRED_NAME_LABEL } from "@leadforge/contracts";
import { expectControlsFit, expectDialogFits, expectNoOverflow } from "./assertions";
import { BUSINESS_ID, ME, PHASE6_ROUTES, errorBody, mockWorkspaceApi } from "./fixtures";
import { BULK_DONE_ID } from "./fixtures-phase5";
import { INVOICE_2_ID, RESUME_CHECKOUT_URL, RETURN_REFS } from "./fixtures-phase6";

/*
 * Phase 6 screens against the stateful billing mock (e2e/fixtures-phase6.ts) and the Phase 5 mock's
 * pipeline config and lead edits: the billing overview, plans and packs (published, unpublished,
 * not configured, test mode), checkout with a fresh Idempotency-Key, the Paystack return page in
 * every final state plus the 60-second "still confirming" state (Playwright's clock), cancel and
 * resume, the card page, invoices and refunds (owner only), the shell banners by role, the member
 * limit, billing blockers in discovery, pipeline stages, lead details, the next attempt, 401 →
 * signed out and the per-account sign-in limit. Controls-fit and reduced-motion run for every
 * Phase 6 route at every width; flows run at 375 and 1440.
 */

test.describe.configure({ timeout: 90_000 });

const width = (page: Page) => page.viewportSize()?.width ?? 0;
const main = (page: Page) => page.locator("#main");
const FLOW_PROJECTS = new Set(["w375", "w1440"]);
const flowsOnly = () =>
  test.skip(!FLOW_PROJECTS.has(test.info().project.name), "flows run at 375 and 1440");

test.describe("controls fit at every width (Phase 6)", () => {
  for (const route of PHASE6_ROUTES) {
    test(`${route}`, async ({ page }) => {
      await mockWorkspaceApi(page, { banners: ["payment_failed"] });
      await page.goto(route);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      await page.waitForLoadState("networkidle");
      await expectControlsFit(page, route);
      await expectNoOverflow(page, route);
    });
  }
});

test.describe("motion (Phase 6)", () => {
  for (const mode of ["reduce", "no-preference"] as const) {
    test.describe(`reduced motion: ${mode}`, () => {
      test.use({ reducedMotion: mode });
      for (const route of PHASE6_ROUTES) {
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
          expect(errors, errors.join("\n")).toEqual([]);
        });
      }
    });
  }
});

test.describe("billing overview and navigation", () => {
  test.beforeEach(flowsOnly);

  test("owners see the plan, its renewal, limits with their source, credits and the latest payment", async ({
    page,
  }) => {
    await mockWorkspaceApi(page);
    await page.goto("/app/billing");
    await expect(page.getByRole("heading", { level: 1, name: "Billing" })).toBeVisible();
    const plan = page.getByTestId("billing-plan-card");
    await expect(plan.getByTestId("plan-name")).toHaveText("Growth (Sample)");
    await expect(plan.getByTestId("subscription-status")).toContainText("Active");
    await expect(plan.getByTestId("subscription-renews")).toHaveText(/2026/);
    await expect(plan).toContainText("₦25,000.00 per month");
    const limits = page.getByTestId("billing-limits-card");
    await expect(limits.getByTestId("members-meter")).toContainText("5 of 10");
    await expect(limits).toContainText("Set for this workspace");
    await expect(limits).toContainText("From your plan");
    await expect(page.getByTestId("billing-balance")).toContainText("877");
    await expect(page.getByTestId("billing-latest-payment")).toContainText("Paid");
    if (width(page) < 1024) await page.getByRole("button", { name: "Open navigation" }).click();
    const nav = page.getByRole("navigation", { name: "Dashboard" }).last();
    await expect(nav.getByRole("link", { name: "Billing" })).toHaveAttribute(
      "aria-current",
      "page",
    );
  });

  test("other roles do not see Billing in the navigation and get the permission state", async ({
    page,
  }) => {
    await mockWorkspaceApi(page, { role: "researcher" });
    await page.goto("/app/billing");
    await expect(page.getByTestId("billing-forbidden")).toContainText(
      "Billing is managed by owners and administrators",
    );
    if (width(page) < 1024) await page.getByRole("button", { name: "Open navigation" }).click();
    const nav = page.getByRole("navigation", { name: "Dashboard" }).last();
    await expect(nav.getByRole("link", { name: "Usage and Credits" })).toBeVisible();
    await expect(nav.getByText("Billing", { exact: true })).toHaveCount(0);
  });

  test("the overview has a Subscription tile for owners and none for other roles", async ({
    page,
  }) => {
    await mockWorkspaceApi(page);
    await page.goto("/app");
    await expect(page.getByTestId("subscription-tile")).toContainText("Growth (Sample)");
    await expect(page.getByTestId("subscription-tile")).toContainText("Active");
    await mockWorkspaceApi(page, { role: "analyst" });
    await page.goto("/app");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await page.waitForLoadState("networkidle");
    await expect(page.getByTestId("subscription-tile")).toHaveCount(0);
  });

  test("Usage links owners to the credit packs", async ({ page }) => {
    await mockWorkspaceApi(page);
    await page.goto("/app/usage");
    await main(page)
      .getByRole("link", { name: /Buy credits/ })
      .click();
    await expect(page).toHaveURL(/\/app\/billing\?tab=plans#credit-packs$/);
    await expect(page.getByRole("heading", { name: "Credit packs" })).toBeFocused();
  });
});

test.describe("plans and checkout", () => {
  test.beforeEach(flowsOnly);

  test("pricing not published: no price is shown and buying is off with the reason", async ({
    page,
  }) => {
    await mockWorkspaceApi(page, { unpublished: true });
    await page.goto("/app/billing?tab=plans");
    await expect(page.getByTestId("pricing-not-published")).toBeVisible();
    await expect(main(page)).not.toContainText(/₦\s?0(\.00)?\b/);
    const buy = main(page).getByRole("button", { name: "Buy 500 credits" });
    await expect(buy).toBeDisabled();
    await expect(main(page).getByTestId("purchase-blocked").first()).toContainText(
      "not been published",
    );
  });

  test("not configured: an honest state, every purchase disabled, and no duplicate shell banner", async ({
    page,
  }) => {
    await mockWorkspaceApi(page, { provider: "none", banners: ["not_configured"] });
    await page.goto("/app/billing?tab=plans");
    await expect(main(page).getByTestId("billing-not-configured")).toBeVisible();
    for (const b of await main(page)
      .getByRole("button", { name: /^(Choose|Buy) / })
      .all())
      await expect(b).toBeDisabled();
    await expect(page.getByTestId("billing-banners")).toHaveCount(0);
    await page.goto("/app/team");
    await expect(page.getByTestId("billing-banners")).toContainText("Payments are not set up");
  });

  test("a purchase sends a fresh Idempotency-Key per click, goes to Paystack and confirms on return", async ({
    page,
  }) => {
    await mockWorkspaceApi(page);
    await page.goto("/app/billing?tab=plans");
    const checkout = page.waitForRequest(
      (r) => r.method() === "POST" && r.url().endsWith("/billing/checkout/credits"),
    );
    const verifies: Request[] = [];
    page.on("request", (r) => {
      if (r.method() === "POST" && r.url().includes("/verify")) verifies.push(r);
    });
    await main(page).getByRole("button", { name: "Buy 2,000 credits" }).click();
    expect((await checkout).headers()["idempotency-key"]).toMatch(/^checkout-[A-Za-z0-9-]{8,}$/);
    // The mock "pays" at once and returns the browser to the return page, as Paystack does.
    await expect(page).toHaveURL(/\/app\/billing\/return\?trxref=lf-e2e-new&reference=lf-e2e-new/);
    const ret = page.getByTestId("billing-return");
    // Pending until the mock's second poll (about 4 s); a slow first paint may only see success.
    await expect(ret).toHaveAttribute("data-phase", /^(confirming|success)$/, { timeout: 15_000 });
    await expect(ret).toHaveAttribute("data-phase", "success", { timeout: 15_000 });
    await expect(page.getByTestId("return-announcer")).toHaveText("Payment confirmed.");
    await expect(page.getByTestId("return-message")).toContainText("2,000 credits were added");
    expect(verifies).toHaveLength(1);
  });

  test("a pending subscription checkout offers Resume checkout until its link lapses", async ({
    page,
  }) => {
    flowsOnly();
    await page.route(`${RESUME_CHECKOUT_URL}**`, (route) =>
      route.fulfill({
        status: 200,
        contentType: "text/html",
        body: "<!doctype html><title>Paystack (Sample)</title><p>Hosted checkout (Sample)</p>",
      }),
    );
    await mockWorkspaceApi(page, {
      subscription: "none",
      provider: "test",
      pendingCheckout: "resumable",
    });
    await page.goto("/app/billing");
    const banner = page.getByTestId("billing-pending-checkout");
    await expect(banner).toContainText("checkout is waiting for payment");
    await expect(banner).toContainText("Resume it to finish paying");
    await expectControlsFit(page, "pending checkout, resumable");
    await banner.getByRole("button", { name: "Resume checkout" }).click();
    await expect(page).toHaveURL(RESUME_CHECKOUT_URL);
  });

  test("a lapsed or missing resume link keeps the start-again path", async ({ page }) => {
    flowsOnly();
    for (const pendingCheckout of ["expired", "plain"] as const) {
      await mockWorkspaceApi(page, { subscription: "none", provider: "test", pendingCheckout });
      await page.goto("/app/billing");
      const banner = page.getByTestId("billing-pending-checkout");
      await expect(banner).toContainText("choose the plan again to start a new checkout");
      await expect(banner.getByRole("button", { name: "Resume checkout" })).toHaveCount(0);
      await page.unrouteAll({ behavior: "ignoreErrors" });
    }
  });

  test("checkout errors are explained and nothing is charged", async ({ page }) => {
    await mockWorkspaceApi(page, { checkoutError: "PAYMENT_PROVIDER_ERROR" });
    await page.goto("/app/billing?tab=plans");
    const keys: string[] = [];
    page.on("request", (r) => {
      if (r.method() === "POST" && r.url().includes("/billing/checkout/"))
        keys.push(r.headers()["idempotency-key"] ?? "");
    });
    await main(page).getByRole("button", { name: "Buy 500 credits" }).click();
    const problem = page.getByTestId("checkout-problem");
    await expect(problem).toContainText("Paystack could not start the checkout");
    await expect(problem).toContainText("Nothing was charged");
    await main(page).getByRole("button", { name: "Buy 500 credits" }).click();
    await expect.poll(() => keys.length).toBe(2);
    expect(keys[0]).not.toBe(keys[1]);
    await expect(page).toHaveURL(/tab=plans/);
  });
});

test.describe("return page", () => {
  test.beforeEach(flowsOnly);

  for (const [ref, phase, title] of [
    [RETURN_REFS.failed, "failed", "Payment failed"],
    [RETURN_REFS.abandoned, "abandoned", "Checkout not completed"],
    [RETURN_REFS.reversed, "reversed", "Payment reversed"],
    [RETURN_REFS.review, "under_review", "Payment under review"],
  ] as const) {
    test(`${phase}: shown once Paystack's state is known, never as success`, async ({ page }) => {
      await mockWorkspaceApi(page);
      await page.goto(`/app/billing/return?reference=${ref}`);
      await expect(page.getByTestId("billing-return")).toHaveAttribute("data-phase", phase, {
        timeout: 15_000,
      });
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(title);
      await expect(page.getByText("Payment confirmed")).toHaveCount(0);
      await expectControlsFit(page, `return ${phase}`);
    });
  }

  test("slow: after about a minute it stops polling and says it is still confirming", async ({
    page,
  }) => {
    await page.clock.install();
    await mockWorkspaceApi(page);
    const gets: string[] = [];
    page.on("request", (r) => {
      if (r.method() === "GET" && r.url().endsWith(`/billing/payments/${RETURN_REFS.slow}`))
        gets.push(r.url());
    });
    await page.goto(`/app/billing/return?reference=${RETURN_REFS.slow}`);
    await expect(page.getByTestId("billing-return")).toHaveAttribute("data-phase", "confirming");
    for (let i = 0; i < 31; i++) {
      await page.clock.runFor(2_000);
      await page.waitForTimeout(20);
    }
    await expect(page.getByTestId("billing-return")).toHaveAttribute("data-phase", "slow");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Still confirming");
    await expect(page.getByTestId("return-announcer")).toContainText(
      "Still confirming. We will notify you",
    );
    const stopped = gets.length;
    expect(stopped).toBeGreaterThan(10);
    await page.clock.runFor(20_000);
    await page.waitForTimeout(300);
    expect(gets.length).toBe(stopped);
    await page.getByTestId("check-again").click();
    await expect.poll(() => gets.length).toBe(stopped + 1);
  });

  test("an unknown reference and a missing one say so", async ({ page }) => {
    await mockWorkspaceApi(page);
    await page.goto(`/app/billing/return?reference=${RETURN_REFS.unknown}`);
    await expect(main(page).getByText("We could not find this payment")).toBeVisible();
    await page.goto("/app/billing/return");
    await expect(main(page).getByRole("heading", { name: "No payment reference" })).toBeVisible();
  });
});

test.describe("subscription, invoices and refunds", () => {
  test.beforeEach(flowsOnly);

  test("cancel at period end and resume, each confirmed", async ({ page }) => {
    await mockWorkspaceApi(page);
    await page.goto("/app/billing");
    await main(page).getByRole("button", { name: "Cancel at period end…" }).click();
    const dialog = page.getByRole("alertdialog", { name: "Cancel at the end of the period?" });
    await expect(dialog).toContainText("stays active until");
    await expectDialogFits(page, "alertdialog");
    await dialog.getByRole("button", { name: "Cancel at period end" }).click();
    await expect(page.getByTestId("subscription-ends")).toBeVisible();
    await main(page).getByRole("button", { name: "Resume renewal…" }).click();
    await page.getByRole("alertdialog").getByRole("button", { name: "Resume renewal" }).click();
    await expect(page.getByTestId("subscription-renews")).toBeVisible();
  });

  test("Update card opens Paystack's card page", async ({ page }) => {
    await mockWorkspaceApi(page);
    await page.goto("/app/billing");
    await main(page).getByRole("button", { name: "Update card" }).click();
    await expect(page).toHaveURL(/card=paystack-sample/);
  });

  test("an unlinked subscription explains why cancel and the card page wait", async ({ page }) => {
    await mockWorkspaceApi(page, { subscription: "unlinked" });
    await page.goto("/app/billing");
    await expect(page.getByTestId("subscription-linking")).toBeVisible();
    await expect(main(page).getByRole("button", { name: "Cancel at period end…" })).toBeDisabled();
  });

  test("invoices download through a fresh same-origin link", async ({ page }) => {
    await mockWorkspaceApi(page);
    await page.goto("/app/billing?tab=invoices");
    const link = page.waitForRequest((r) =>
      r.url().endsWith(`/billing/invoices/${INVOICE_2_ID}/download-url`),
    );
    const download = page.waitForEvent("download");
    await main(page).getByTestId("invoice-download").first().click();
    await link;
    const file = await download;
    expect(file.url()).toContain(`/api/v1/billing/invoices/${INVOICE_2_ID}/download?`);
    expect(new URL(file.url()).origin).toBe(new URL(page.url()).origin);
    expect(file.suggestedFilename()).toBe("LF-2026-000002.pdf");
  });

  test("a failed invoice link lands on Billing with an explanation, and the parameter is dropped", async ({
    page,
  }) => {
    await mockWorkspaceApi(page);
    await page.goto("/app/billing?downloadError=DOWNLOAD_LINK_INVALID");
    await expect(page.getByTestId("invoice-link-problem")).toContainText("not valid for you");
    await expect(page).toHaveURL(/\/app\/billing\?tab=invoices$/);
    await expect(page.getByRole("tab", { name: "Invoices" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });

  test("owners refund after reading the consequences; administrators cannot", async ({ page }) => {
    await mockWorkspaceApi(page, { role: "admin" });
    await page.goto("/app/billing?tab=payments");
    await expect(
      main(page).getByText("Refunds are issued by owners of the workspace."),
    ).toBeVisible();
    await expect(main(page).getByTestId("refund-button")).toHaveCount(0);
    await expect(main(page).getByTestId("under-review").first()).toBeVisible();

    await mockWorkspaceApi(page);
    await page.goto("/app/billing?tab=payments");
    await main(page).getByTestId("refund-button").first().click();
    const dialog = page.getByRole("alertdialog");
    await expect(dialog.getByTestId("refund-consequences")).toContainText("may go below zero");
    await expectDialogFits(page, "alertdialog");
    await dialog.getByLabel("Reason").fill("Bought twice by mistake (Sample)");
    const refund = page.waitForRequest((r) => r.method() === "POST" && /\/refund$/.test(r.url()));
    await dialog.getByRole("button", { name: /^Refund ₦/ }).click();
    expect((await refund).postDataJSON()).toEqual({ reason: "Bought twice by mistake (Sample)" });
    await expect(page.getByText("Refund requested")).toBeVisible();
    await expect(main(page).getByText("Refund pending").first()).toBeVisible();
  });
});

test.describe("banners, member limit and billing blockers", () => {
  test.beforeEach(flowsOnly);

  test("a researcher sees the negative balance (not dismissible), never manager-only banners", async ({
    page,
  }) => {
    await mockWorkspaceApi(page, {
      role: "researcher",
      banners: ["negative_balance", "payment_failed", "past_due"],
      leakBanners: true,
    });
    await page.goto("/app/businesses");
    const banners = page.getByTestId("billing-banners");
    await expect(banners).toContainText("Credit balance below zero");
    await expect(banners).not.toContainText("A payment failed");
    await expect(banners).not.toContainText("Subscription payment overdue");
    await expect(banners.getByRole("button", { name: /Dismiss/ })).toHaveCount(0);
    await expect(banners.getByRole("link")).toHaveCount(0);
  });

  test("owners dismiss a failed-payment banner for the session; past due stays", async ({
    page,
  }) => {
    await mockWorkspaceApi(page, { banners: ["past_due", "payment_failed"] });
    await page.goto("/app");
    const banners = page.getByTestId("billing-banners");
    await banners.getByRole("button", { name: "Dismiss: A payment failed" }).click();
    await expect(banners).not.toContainText("A payment failed");
    await expect(banners).toContainText("Subscription payment overdue");
    await page.goto("/app/lists");
    await expect(page.getByTestId("billing-banners")).toContainText("Subscription payment overdue");
    await expect(page.getByTestId("billing-banners")).not.toContainText("A payment failed");
  });

  test("the invite dialog shows the member limit with a link to the plans", async ({ page }) => {
    await mockWorkspaceApi(page, { memberLimit: true });
    await page.goto("/app/team");
    await main(page).getByRole("button", { name: "Invite member" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel(/Email/).fill("new.person@example.test");
    await dialog.getByRole("button", { name: "Send invitation" }).click();
    const limit = dialog.getByTestId("member-limit");
    await expect(limit).toContainText("Member limit reached: 5 on this plan");
    await expect(limit.getByRole("link", { name: "See plans" })).toHaveAttribute(
      "href",
      "/app/billing?tab=plans",
    );
  });

  test("discovery explains plan and negative-balance blockers", async ({ page }) => {
    await mockWorkspaceApi(page, { estimate: "billing" });
    await page.goto("/app/discovery/new");
    await expect(page.getByText("Choose where to search")).toBeVisible();
    await page.getByRole("button", { name: /Continue/ }).click();
    await page.getByRole("button", { name: /^Pharmacy/ }).click();
    await page.getByLabel("City or town").fill("Ikeja");
    await page.getByRole("button", { name: /Continue/ }).click();
    await page.getByRole("button", { name: /Continue/ }).click();
    const blocks = page.getByTestId("billing-block");
    await expect(blocks).toHaveCount(2);
    await expect(blocks.first()).toContainText("Not included in the workspace's plan");
    await expect(blocks.last()).toContainText("Credit balance below zero");
    await expect(blocks.last().getByRole("link", { name: /Buy credits/ })).toHaveAttribute(
      "href",
      "/app/billing?tab=plans#credit-packs",
    );
    await expect(page.getByRole("button", { name: /Continue/ })).toBeDisabled();
  });

  test("a website analysis refused by the plan explains it inside the dialog", async ({ page }) => {
    await mockWorkspaceApi(page, {
      analysisError: {
        status: 402,
        code: "ENTITLEMENT_REQUIRED",
        message: "Your plan does not include website analysis.",
        details: [{ path: "entitlement", message: "website_analysis_enabled" }],
      },
    });
    await page.goto(`/app/businesses/${BUSINESS_ID}?tab=analysis`);
    await page
      .getByTestId("analysis-tab")
      .getByRole("button", { name: /Run website analysis/ })
      .click();
    const dialog = page.getByRole("alertdialog");
    await dialog.getByRole("button", { name: "Run analysis (1 credit)" }).click();
    await expect(dialog.getByTestId("billing-block")).toContainText("website analysis");
    await expect(dialog.getByRole("button", { name: "Run analysis (1 credit)" })).toBeDisabled();
  });
});

test.describe("pipeline stages, lead details and outreach", () => {
  test.beforeEach(flowsOnly);

  test("rename and reorder stages, save, and see the board use them; restore afterwards", async ({
    page,
  }) => {
    await mockWorkspaceApi(page);
    await page.goto("/app/settings?tab=pipeline");
    await main(page).getByLabel("Stage 3 name").fill("Called");
    await main(page).getByRole("button", { name: "Move Called up" }).click();
    await expect(page.getByTestId("stages-announcer")).toHaveText(
      "Moved Called up to position 2 of 7.",
    );
    const put = page.waitForRequest(
      (r) => r.method() === "PUT" && r.url().endsWith("/pipeline/config"),
    );
    await main(page).getByRole("button", { name: "Save stages" }).click();
    const body = (await put).postDataJSON() as {
      version: number;
      stages: { key?: string; label: string }[];
    };
    expect(body.version).toBe(1);
    expect(body.stages.slice(0, 3).map((s) => s.label)).toEqual(["New", "Called", "Qualified"]);
    await expect(page.getByText("Pipeline stages saved", { exact: true })).toBeVisible();
    await page.goto("/app/pipeline");
    if (width(page) >= 768) {
      await expect(
        main(page).locator('[data-stage="contacted"]').getByRole("heading").first(),
      ).toContainText("Called");
      const order = await main(page)
        .locator("[data-stage]")
        .evaluateAll((els) => els.map((el) => el.getAttribute("data-stage")));
      expect(order.slice(0, 3)).toEqual(["new", "contacted", "qualified"]);
    } else {
      await expect(main(page).getByRole("combobox", { name: "Stage" })).toBeVisible();
    }
  });

  test("a stale version reloads and explains; a stage with leads cannot be archived", async ({
    page,
  }) => {
    await mockWorkspaceApi(page, { configConflict: true });
    await page.goto("/app/settings?tab=pipeline");
    await main(page).getByLabel("Stage 1 name").fill("Inbox");
    await main(page).getByRole("button", { name: "Save stages" }).click();
    await expect(page.getByTestId("stages-notice")).toContainText(
      "Someone else changed the stages",
    );
    await expect(main(page).getByLabel("Stage 1 name")).toHaveValue("Fresh leads");
    await main(page).getByRole("button", { name: "Archive Contacted" }).click();
    await main(page).getByRole("button", { name: "Save stages" }).click();
    await expect(page.getByTestId("stages-notice")).toContainText("Contacted still holds leads");
  });

  test("edit a lead's priority and next action from the business page", async ({ page }) => {
    await mockWorkspaceApi(page);
    await page.goto(`/app/businesses/${BUSINESS_ID}`);
    const panel = main(page).getByTestId("lead-panel");
    await panel.getByRole("button", { name: "Edit details…" }).click();
    const dialog = page.getByTestId("lead-details-dialog");
    await expectDialogFits(page);
    await dialog.getByRole("combobox", { name: /Priority/ }).click();
    await page.getByRole("option", { name: "Low priority" }).click();
    await dialog.getByLabel("Next action").fill("2026-11-02T10:30");
    const patch = page.waitForRequest(
      (r) => r.method() === "PATCH" && /\/pipeline\/leads\/[a-f0-9]{24}$/.test(r.url()),
    );
    await dialog.getByRole("button", { name: "Save details" }).click();
    expect((await patch).postDataJSON()).toMatchObject({ priority: "low", version: 3 });
    await expect(panel.getByTestId("lead-priority")).toHaveText("Low priority");
    await expect(panel.getByTestId("lead-next-action")).toContainText("2026");
  });

  test("moving a lead to Won offers recording its value; recording it is optional", async ({
    page,
  }) => {
    await mockWorkspaceApi(page);
    await page.goto(`/app/businesses/${BUSINESS_ID}`);
    const panel = main(page).getByTestId("lead-panel");
    await panel.getByRole("button", { name: /Move to…/ }).click();
    await page.getByRole("menuitemradio", { name: "Won" }).click();
    await expect(panel.getByTestId("lead-stage")).toContainText("Won");
    const followUp = panel.getByTestId("lead-follow-up");
    await expect(followUp).toBeVisible();
    await followUp.getByRole("button", { name: "Record won value…" }).click();
    const dialog = page.getByTestId("lead-details-dialog");
    await expect(dialog.getByLabel("Won value")).toBeFocused();
    await dialog.getByLabel("Won value").fill("250000");
    const patch = page.waitForRequest((r) => r.method() === "PATCH");
    await dialog.getByRole("button", { name: "Save details" }).click();
    expect((await patch).postDataJSON()).toMatchObject({
      wonValueMinor: 25000000,
      currency: "NGN",
    });
    await expect(panel.getByTestId("lead-won-value")).toHaveText("₦250,000.00");
    await expect(panel.getByTestId("lead-follow-up")).toHaveCount(0);
  });

  test("plan the next outreach attempt", async ({ page }) => {
    await mockWorkspaceApi(page);
    await page.goto("/app/outreach");
    await main(page)
      .getByRole("button", { name: /^Next attempt/ })
      .first()
      .click();
    const dialog = page.getByTestId("next-attempt-dialog");
    await dialog.getByLabel("Next attempt").fill("2026-11-03T09:00");
    const patch = page.waitForRequest(
      (r) => r.method() === "PATCH" && /\/outreach\//.test(r.url()),
    );
    await dialog.getByRole("button", { name: "Save" }).click();
    const sent = (await patch).postDataJSON() as { nextAttemptAt: string; version: number };
    expect(typeof sent.version).toBe("number");
    expect(sent.nextAttemptAt).toMatch(/^2026-11-0[23]T/);
    await expect(page.getByText("Next attempt planned")).toBeVisible();
  });

  test("bulk results name each business, the expired label, and the id for businesses outside the workspace", async ({
    page,
  }) => {
    await mockWorkspaceApi(page);
    await page.goto(`/app/jobs/bulk/${BULK_DONE_ID}`);
    const names = main(page).getByTestId("bulk-item-business");
    await expect(names.first()).toHaveText("Mama Put Kitchen (Sample)");
    await expect(names.filter({ hasText: EXPIRED_NAME_LABEL })).toHaveCount(1);
    await expect(names.last()).toHaveText(/^Business …[0-9a-f]{6}$/);
  });
});

test.describe("session", () => {
  test.beforeEach(flowsOnly);

  test("a 401 that survives the refresh signs out once and returns to sign-in with the page", async ({
    page,
  }) => {
    await mockWorkspaceApi(page);
    let revoked = false;
    let refreshes = 0;
    await page.route("**/api/v1/**", (route) => {
      const path = new URL(route.request().url()).pathname.replace(/^\/api\/v1/, "");
      if (path === "/auth/refresh") {
        refreshes += 1;
        return route.fulfill({
          status: 401,
          contentType: "application/json",
          body: JSON.stringify(errorBody("UNAUTHENTICATED", "Revoked")),
        });
      }
      if (revoked && path !== "/auth/login") {
        return route.fulfill({
          status: 401,
          contentType: "application/json",
          body: JSON.stringify(errorBody("UNAUTHENTICATED", "Revoked")),
        });
      }
      return route.fallback();
    });
    await page.goto("/app/lists?q=lag");
    await expect(page.getByRole("heading", { level: 1, name: "Lead lists" })).toBeVisible();
    revoked = true;
    await main(page)
      .getByRole("searchbox", { name: /Search lists/ })
      .fill("lagos");
    await page.waitForURL(/\/sign-in\?next=/);
    expect(decodeURIComponent(new URL(page.url()).searchParams.get("next") ?? "")).toMatch(
      /^\/app\/lists\?q=lag/,
    );
    await page.waitForTimeout(1_000);
    expect(refreshes).toBe(1);
    await expect(page.getByRole("heading", { level: 1, name: "Sign in" })).toBeVisible();
  });

  test("the per-account sign-in limit is explained with its wait", async ({ page }) => {
    // Stage 9: the real remaining lock comes as Retry-After and the retryAfterSeconds detail.
    const body = errorBody(
      "RATE_LIMITED",
      "Too many failed sign-in attempts for this account. Try again in 9 minutes.",
    ) as {
      error: Record<string, unknown>;
    };
    body.error.details = [{ path: "retryAfterSeconds", message: "512" }];
    await page.route("**/api/v1/auth/login", (route) =>
      route.fulfill({
        status: 429,
        contentType: "application/json",
        headers: { "retry-after": "512" },
        body: JSON.stringify(body),
      }),
    );
    await page.goto("/sign-in");
    await page.getByLabel("Email").fill(ME.user.email);
    await page.locator("#si-password").fill("not-the-password");
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    const error = page.getByTestId("sign-in-error");
    await expect(error).toContainText("Sign-in is paused for this account");
    await expect(error).toContainText("Try again in 9 minutes.");
  });
});
