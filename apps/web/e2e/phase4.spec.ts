import { expect, test, type Page } from "@playwright/test";
import { expectControlsFit, expectDialogFits, expectNoOverflow } from "./assertions";
import { BUSINESS_ID, CONFLICT_ID, PHASE4_ROUTES, mockWorkspaceApi } from "./fixtures";
import {
  ANALYSIS_ID,
  BATCH_ID,
  CANDIDATE_ID,
  FAILED_ANALYSIS_ID,
  MARKUP_SNIPPET,
  RUNNING_ANALYSIS_ID,
  UNKNOWN_ANALYSIS_ID,
  UNKNOWN_CANDIDATE_ID,
} from "./fixtures-phase4";

/*
 * Phase 4 screens against mocked API responses at every project width: website analyses and
 * their detail, the business detail tabs (analysis, lead score, opportunities, duplicates),
 * contact collection, directory scores and bulk analysis, duplicate review with merge and undo,
 * and scoring settings. Plus controls-fit and reduced-motion checks for every Phase 4 route.
 */

test.describe.configure({ timeout: 90_000 });

const narrow = (page: Page) => (page.viewportSize()?.width ?? 0) < 480;

test.describe("controls fit at every width (Phase 4)", () => {
  for (const route of PHASE4_ROUTES) {
    test(`${route}`, async ({ page }) => {
      await mockWorkspaceApi(page);
      await page.goto(route);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      await page.waitForLoadState("networkidle");
      await expectControlsFit(page, route);
    });
  }
});

test.describe("motion (Phase 4)", () => {
  for (const mode of ["reduce", "no-preference"] as const) {
    test.describe(`reduced motion: ${mode}`, () => {
      test.use({ reducedMotion: mode });
      for (const route of PHASE4_ROUTES) {
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

test.describe("navigation (Phase 4)", () => {
  test("Website Analysis and Duplicate Review are enabled; Scheduled Jobs stays Soon", async ({
    page,
  }) => {
    await mockWorkspaceApi(page);
    await page.goto("/app/businesses/duplicates");
    await expect(page.getByRole("heading", { level: 1, name: "Duplicate review" })).toBeVisible();
    if ((page.viewportSize()?.width ?? 0) < 1024) {
      await page.getByRole("button", { name: "Open navigation" }).click();
    }
    const nav = page.getByRole("navigation", { name: "Dashboard" }).last();
    await expect(nav.getByRole("link", { name: /Website Analysis/ })).toHaveAttribute(
      "href",
      "/app/analysis",
    );
    const dup = nav.getByRole("link", { name: /Duplicate Review/ });
    await expect(dup).toHaveAttribute("href", "/app/businesses/duplicates");
    await expect(dup).toHaveAttribute("aria-current", "page");
    await expect(nav.getByRole("link", { name: /^Businesses/ })).not.toHaveAttribute(
      "aria-current",
      "page",
    );
    // Billing is enabled for owners from Phase 6; Scheduled Jobs stays "Soon".
    await expect(nav.getByRole("link", { name: "Billing" })).toHaveAttribute(
      "href",
      "/app/billing",
    );
    await expect(nav.getByRole("link", { name: "Scheduled Jobs" })).toHaveCount(0);
  });
});

test.describe("website analyses", () => {
  test("the list shows status, findings and credits; the batch filter lives in the URL", async ({
    page,
  }) => {
    await mockWorkspaceApi(page);
    await page.goto(`/app/analysis?batchId=${BATCH_ID}`);
    await expect(page.getByRole("heading", { level: 1, name: "Website analysis" })).toBeVisible();
    await expect(page.getByTestId("batch-banner")).toContainText(
      "2 analyses: 0 completed, 1 failed, 1 still running",
    );
    if (narrow(page)) {
      await expect(page.getByRole("list", { name: "Website analyses" })).toBeVisible();
    } else {
      await expect(page.getByRole("table", { name: "Website analyses" })).toBeVisible();
    }
    await expect(
      page.getByRole("link", { name: "onitsha-spares.example.test" }).first(),
    ).toBeVisible();
    await expect(page.getByRole("link", { name: "mamaput.example.test" })).toHaveCount(0);
    await page.reload();
    await expect.poll(() => page.url(), { timeout: 30_000 }).toContain(`batchId=${BATCH_ID}`);
    await page.getByRole("button", { name: "Show all analyses" }).click();
    await expect(page.getByRole("link", { name: "mamaput.example.test" }).first()).toBeVisible();
    await expectNoOverflow(page, "analyses");
  });

  test("an empty workspace explains that analyses are requested from businesses", async ({
    page,
  }) => {
    await mockWorkspaceApi(page, { empty: true });
    await page.goto("/app/analysis");
    await expect(page.getByRole("heading", { name: "No website analyses yet" })).toBeVisible();
    await expect(page.getByText(/Analyses are requested from businesses/)).toBeVisible();
    await expect(page.getByRole("link", { name: "Go to businesses" })).toHaveAttribute(
      "href",
      "/app/businesses",
    );
  });

  test("detail shows every detection with evidence as text, and opportunities link to them", async ({
    page,
  }) => {
    await mockWorkspaceApi(page);
    await page.goto(`/app/analysis/${ANALYSIS_ID}`);
    await expect(
      page.getByRole("heading", { level: 1, name: "mamaput.example.test" }),
    ).toBeVisible();
    await expect(page.getByTestId("static-html-note")).toContainText("does not run JavaScript");
    const detections = page.getByRole("list", { name: "Detections" });
    await expect(detections.locator("[data-detection]")).toHaveCount(9);
    const form = detections.locator('[data-detection="no_contact_form"]');
    await expect(form).toContainText("No contact form was detected");
    await expect(form).toContainText("Gap observed");
    await expect(form).toContainText("Confidence 75%");
    // The markup-looking snippet is text: visible as written, and no element was injected.
    await expect(form.getByText(MARKUP_SNIPPET)).toBeVisible();
    expect(await form.locator("img, form, input").count()).toBe(0);
    await expect(page.getByText(/has no /i)).toHaveCount(0);
    const opp = page.getByTestId("analysis-opportunities");
    await expect(opp.getByRole("link", { name: "No contact form was detected" })).toHaveAttribute(
      "href",
      "#detection-no_contact_form",
    );
    await expect(page.getByTestId("analysis-credits")).toContainText("Settled");
    await expect(page.getByTestId("analysis-fetch")).toContainText("HTTP 200");
    await expect(page.getByTestId("analysis-pages")).toContainText("Contact");
    await expectNoOverflow(page, "analysis detail");
  });

  test("a running analysis polls with a live status; a failed one explains why and releases the credit", async ({
    page,
  }) => {
    await mockWorkspaceApi(page);
    await page.goto(`/app/analysis/${RUNNING_ANALYSIS_ID}`);
    await expect(page.getByTestId("analysis-status-line")).toContainText("Running");
    await expect(page.getByText("refreshing every 2 seconds").first()).toBeVisible();
    await expect(page.getByTestId("analysis-live-region")).toBeAttached();
    await page.goto(`/app/analysis/${FAILED_ANALYSIS_ID}`);
    await expect(
      page.getByText(/This analysis failed: The site's robots.txt does not allow/),
    ).toBeVisible();
    await expect(page.getByTestId("analysis-credits")).toContainText("Released");
    await page.goto(`/app/analysis/${UNKNOWN_ANALYSIS_ID}`);
    await expect(
      page.getByRole("heading", { level: 1, name: "Website analysis not found" }),
    ).toBeVisible();
  });
});

test.describe("business detail (Phase 4)", () => {
  test("website analysis tab: summary, detections and a confirmed run that fits", async ({
    page,
  }) => {
    await mockWorkspaceApi(page);
    await page.goto(`/app/businesses/${BUSINESS_ID}?tab=analysis`);
    const tab = page.getByTestId("analysis-tab");
    await expect(tab.getByText("No contact form was detected")).toBeVisible();
    await expect(tab.getByRole("link", { name: /Open full analysis/ })).toHaveAttribute(
      "href",
      `/app/analysis/${ANALYSIS_ID}`,
    );
    await tab.getByRole("button", { name: /Run website analysis/ }).click();
    const dialog = page.getByRole("alertdialog", { name: "Run a website analysis?" });
    await expect(dialog).toContainText("1 credit is held now");
    await expectDialogFits(page, "alertdialog");
    await dialog.getByRole("button", { name: /Run analysis \(1 credit\)/ }).click();
    await expect(page.getByText("Website analysis queued")).toBeVisible();
  });

  test("insufficient credits and a missing website are explained in the dialog", async ({
    page,
  }) => {
    await mockWorkspaceApi(page, {
      analysisError: {
        status: 402,
        code: "INSUFFICIENT_CREDITS",
        message: "This needs 1 credits; 0 available.",
        details: [
          { path: "credits.required", message: "1" },
          { path: "credits.available", message: "0" },
        ],
      },
    });
    await page.goto(`/app/businesses/${BUSINESS_ID}?tab=analysis`);
    await page
      .getByTestId("analysis-tab")
      .getByRole("button", { name: /Run website analysis/ })
      .click();
    const dialog = page.getByRole("alertdialog");
    await dialog.getByRole("button", { name: /Run analysis/ }).click();
    await expect(dialog.getByText("Not enough credits")).toBeVisible();
    await expect(dialog.getByText(/needs 1 credit and 0 are available/)).toBeVisible();
    await expectDialogFits(page, "alertdialog");
  });

  test("lead score tab shows fit and data confidence separately with the breakdown", async ({
    page,
  }) => {
    await mockWorkspaceApi(page);
    await page.goto(`/app/businesses/${BUSINESS_ID}?tab=score`);
    await expect(page.getByTestId("fit-score-value")).toHaveText("64");
    await expect(page.getByTestId("data-confidence-value")).toHaveText("48");
    await expect(page.getByTestId("score-explanation")).toContainText(
      "Score reflects fit with your configured criteria. It is not a prediction of purchase intent.",
    );
    await expect(page.getByText("Category Restaurant is in your ICP").first()).toBeVisible();
    await page.goto(`/app/businesses/${CONFLICT_ID}?tab=score`);
    await expect(page.getByRole("heading", { name: "Not scored yet" })).toBeVisible();
  });

  test("opportunities link to their evidence; duplicates list pairs, merges and absorbed records", async ({
    page,
  }) => {
    await mockWorkspaceApi(page);
    await page.goto(`/app/businesses/${BUSINESS_ID}?tab=opportunities`);
    const opps = page.getByTestId("opportunities-tab");
    await expect(opps.locator("[data-opportunity]")).toHaveCount(4);
    await expect(opps.getByRole("link", { name: "No contact form was detected" })).toHaveAttribute(
      "href",
      `/app/analysis/${ANALYSIS_ID}#detection-no_contact_form`,
    );
    await page.goto(`/app/businesses/${BUSINESS_ID}?tab=duplicates`);
    const dup = page.getByTestId("duplicates-tab");
    await expect(dup.getByText(/Possibly the same as/)).toContainText(
      "Mama Put Kitchens Ikeja (Sample)",
    );
    await expect(dup.getByRole("link", { name: /Review/ }).first()).toHaveAttribute(
      "href",
      `/app/businesses/duplicates/${CANDIDATE_ID}`,
    );
    await expect(dup.getByRole("list", { name: "Merge history" })).toBeVisible();
    await expect(dup.getByRole("list", { name: "Absorbed records" })).toBeVisible();
  });

  test("contacts: mailbox never confirmed, email checks, collection runs and refresh", async ({
    page,
  }) => {
    await mockWorkspaceApi(page);
    await page.goto(`/app/businesses/${BUSINESS_ID}`);
    await expect(page.getByTestId("mailbox-not-confirmed").first()).toHaveText(
      "Mailbox not confirmed",
    );
    await expect(page.getByText("Mail server check inconclusive").first()).toBeVisible();
    await expect(page.getByTestId("contact-collection")).toContainText(
      "2 phones, 1 email, 1 social profile and 1 WhatsApp link found",
    );
    await page.getByRole("button", { name: "Check email hello@mamaput.example.test" }).click();
    await expect(page.getByText("Checking the email address")).toBeVisible();
    // The expired phone offers a real Refresh with its cost explained.
    await page
      .locator('[data-field="phone"][data-state="expired"]')
      .getByRole("button", { name: "Refresh" })
      .click();
    const dialog = page.getByRole("alertdialog", { name: "Refresh this business?" });
    await expect(dialog).toContainText("holds 1 credit");
    await expectDialogFits(page, "alertdialog");
    await dialog.getByRole("button", { name: /Refresh \(1 credit\)/ }).click();
    await expect(page.getByText("Refresh started")).toBeVisible();
  });

  test("an analyst sees analyses and scores but cannot run, refresh or merge", async ({ page }) => {
    await mockWorkspaceApi(page, { role: "analyst" });
    await page.goto(`/app/businesses/${BUSINESS_ID}?tab=analysis`);
    await expect(
      page.getByTestId("analysis-tab").getByText("No contact form was detected"),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: /Run website analysis/ })).toHaveCount(0);
    await page.goto(`/app/businesses/${BUSINESS_ID}`);
    await expect(page.getByRole("button", { name: /Find contacts on website/ })).toHaveCount(0);
    await expect(page.getByTestId("refresh-unavailable").first()).toContainText(
      "owner, administrator or researcher",
    );
    await page.goto(`/app/businesses/duplicates/${CANDIDATE_ID}`);
    await expect(page.getByText("View only")).toBeVisible();
    await expect(page.getByRole("button", { name: /Merge/ })).toHaveCount(0);
  });
});

test.describe("directory (Phase 4)", () => {
  test("fit and data confidence are separate columns, sortable, with a range filter in the URL", async ({
    page,
  }) => {
    await mockWorkspaceApi(page);
    await page.goto("/app/businesses");
    await expect(page.getByRole("heading", { level: 1, name: "Businesses" })).toBeVisible();
    if (narrow(page)) {
      await expect(page.getByTestId("card-scores").first()).toContainText("Fit 64");
    } else {
      const table = page.getByRole("table", { name: "Businesses" });
      await table.getByRole("button", { name: "Fit", exact: true }).click();
      await expect(page).toHaveURL(/sort=fit/);
      await expect(table.getByRole("columnheader", { name: /Data confidence/ })).toBeVisible();
    }
    await page.goto("/app/businesses?fitMin=50&dataConfidenceMin=40");
    if ((page.viewportSize()?.width ?? 0) < 768) {
      // Under 768px applied filters live in the filter sheet; the button counts them.
      await expect(page.getByRole("button", { name: "Filters (2)" })).toBeVisible();
    } else {
      const applied = page.getByRole("group", { name: "Applied filters" });
      await expect(applied.getByText("Fit: at least 50")).toBeVisible();
      await expect(applied.getByText("Data confidence: at least 40")).toBeVisible();
    }
    await expectNoOverflow(page, "directory scores");
  });

  test("bulk Analyze websites confirms the credit estimate and links to the batch", async ({
    page,
  }) => {
    await mockWorkspaceApi(page);
    await page.goto("/app/businesses");
    await page.getByRole("checkbox", { name: "Select row 1" }).check();
    await page.getByRole("checkbox", { name: "Select row 3" }).check();
    await page
      .getByRole("button", { name: /Analyze websites/ })
      .first()
      .click();
    const dialog = page.getByTestId("bulk-analyze-dialog");
    await expect(dialog.getByTestId("bulk-credit-estimate")).toHaveText("2");
    await expectDialogFits(page);
    await dialog.getByRole("button", { name: /Analyze websites/ }).click();
    const result = dialog.getByTestId("bulk-analyze-result");
    await expect(result).toContainText("Started: 1");
    await expect(result).toContainText("Already in progress: 1");
    await expect(result).toContainText("Skipped: 1");
    await expect(result).toContainText("No website on record");
    await expect(dialog.getByRole("link", { name: "View these analyses" })).toHaveAttribute(
      "href",
      `/app/analysis?batchId=${BATCH_ID}`,
    );
  });
});

test.describe("duplicate review", () => {
  test("queue views live in the URL; a pair opens side by side with reasons", async ({ page }) => {
    await mockWorkspaceApi(page);
    await page.goto("/app/businesses/duplicates");
    await expect(page.getByRole("tab", { name: "Pending" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await page.getByRole("tab", { name: "Deferred" }).click();
    await expect(page).toHaveURL(/view=deferred/);
    await expect(
      page.getByText("Yaba Tech Hub Coworking and Innovation Centre (Sample)").first(),
    ).toBeVisible();
    await page.getByRole("tab", { name: "Pending" }).click();
    await page
      .locator("#main")
      .getByRole("link", { name: /^Review/ })
      .first()
      .click();
    await expect
      .poll(() => page.url(), { timeout: 30_000 })
      .toContain(`/app/businesses/duplicates/${CANDIDATE_ID}`);
    await expect(page.getByRole("list", { name: "Reasons" })).toContainText(
      "Both list +234 803 123 4567",
    );
    await expect(page.getByTestId("candidate-compare")).toContainText(
      "Mama Put Kitchens Ikeja (Sample)",
    );
    await expect(page.getByTestId("compare-attribution")).toContainText("Overture Maps Foundation");
    await expectNoOverflow(page, "candidate review");
  });

  test("the merge dialog chooses a survivor and per-field values, fits, and merges", async ({
    page,
  }) => {
    await mockWorkspaceApi(page);
    await page.goto(`/app/businesses/duplicates/${CANDIDATE_ID}`);
    await page.getByRole("button", { name: /Merge/ }).first().click();
    const dialog = page.getByTestId("merge-dialog");
    await expect(dialog.getByRole("radiogroup", { name: "Surviving record" })).toBeVisible();
    await expectDialogFits(page);
    await dialog.getByRole("radio", { name: /Business B/ }).check();
    const request = page.waitForRequest((r) =>
      r.url().includes(`/dedup/candidates/${CANDIDATE_ID}/merge`),
    );
    await dialog.getByRole("button", { name: /Merge businesses/ }).click();
    const body = (await request).postDataJSON() as {
      survivorId: string;
      fields: Record<string, string>;
    };
    expect(Object.keys(body.fields).sort()).toEqual(["location", "name", "website"]);
    await expect(page.getByText("Businesses merged")).toBeVisible();
  });

  test("Not duplicates asks first; an unknown pair is not found", async ({ page }) => {
    await mockWorkspaceApi(page);
    await page.goto(`/app/businesses/duplicates/${CANDIDATE_ID}`);
    await page.getByRole("button", { name: /Not duplicates/ }).click();
    await expect(page.getByRole("alertdialog", { name: "Mark as not duplicates?" })).toBeVisible();
    await expectDialogFits(page, "alertdialog");
    await page.goto(`/app/businesses/duplicates/${UNKNOWN_CANDIDATE_ID}`);
    await expect(
      page.getByRole("heading", { level: 1, name: "Possible duplicate not found" }),
    ).toBeVisible();
  });

  test("undo over later changes explains MERGE_CONFLICT and offers force", async ({ page }) => {
    await mockWorkspaceApi(page, { undoConflict: true });
    await page.goto("/app/businesses/duplicates?view=history");
    const history = page.getByRole("list", { name: "Merge history" });
    await expect(history.getByTestId("undo-not-allowed")).toContainText("within 30 days");
    await history
      .getByRole("button", { name: /Undo merge/ })
      .first()
      .click();
    await page
      .getByRole("alertdialog", { name: "Undo this merge?" })
      .getByRole("button", { name: "Undo merge" })
      .click();
    const force = page.getByRole("alertdialog", { name: "These records changed after the merge" });
    await expect(force).toContainText("discards those later changes");
    await expectDialogFits(page, "alertdialog");
    const request = page.waitForRequest((r) => r.url().includes("/undo"));
    await force.getByRole("button", { name: "Undo anyway" }).click();
    expect((await request).postDataJSON()).toEqual({ force: true });
    await expect(page.getByText("Merge undone")).toBeVisible();
  });
});

test.describe("scoring settings", () => {
  test("weights validate live; a stale version offers a reload", async ({ page }) => {
    await mockWorkspaceApi(page, { scoringConflict: true });
    await page.goto("/app/settings?tab=scoring");
    const settings = page.getByTestId("scoring-settings");
    await expect(settings.getByTestId("weights-total")).toContainText("100 of 100");
    await settings.getByLabel("Freshness").fill("5");
    await expect(settings.getByTestId("weights-error")).toHaveText(
      "Weights must add up to 100 (they add up to 95)",
    );
    await settings.getByLabel("Source reliability").fill("10");
    await expect(settings.getByTestId("weights-total")).toContainText("100 of 100");
    await settings.getByRole("button", { name: /Save and recompute scores/ }).click();
    await expect(settings.getByTestId("scoring-conflict")).toContainText(
      "Someone else changed the scoring profile",
    );
    await expect(settings.getByRole("button", { name: /Reload latest/ })).toBeVisible();
    await expect(settings.getByTestId("recompute-status")).toContainText("Scores are up to date");
    await expectNoOverflow(page, "scoring settings");
  });

  test("a researcher reads the profile but cannot change it", async ({ page }) => {
    await mockWorkspaceApi(page, { role: "researcher" });
    await page.goto("/app/settings?tab=scoring");
    await expect(page.getByText("Read only")).toBeVisible();
    await expect(page.getByLabel("Freshness")).toBeDisabled();
    await expect(page.getByRole("button", { name: /Save and recompute scores/ })).toHaveCount(0);
  });
});
