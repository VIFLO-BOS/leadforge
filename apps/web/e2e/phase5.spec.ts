import { expect, test, type Page } from "@playwright/test";
import { expectControlsFit, expectDialogFits, expectNoOverflow } from "./assertions";
import { BUSINESS_ID, PHASE5_ROUTES, mockWorkspaceApi } from "./fixtures";
import {
  BULK_DONE_ID,
  EMPTY_LIST_ID,
  EXPORT_EXPIRED_ID,
  EXPORT_READY_ID,
  LIST_ID,
  OWNER_ID,
  UNKNOWN_LIST_ID,
} from "./fixtures-phase5";

/*
 * Phase 5 screens against the stateful mocked API: the pipeline (board and narrow single column,
 * keyboard moves, version conflicts, assignment), lead lists, business CRM panels and the
 * activity log with the suppression override, activities, outreach, bulk operations, async
 * exports with the download, reports, usage, overview and notification settings. Controls-fit and
 * reduced-motion checks run for every Phase 5 route at every width; flows run at 375 and 1440.
 */

test.describe.configure({ timeout: 90_000 });

const width = (page: Page) => page.viewportSize()?.width ?? 0;
const main = (page: Page) => page.locator("#main");
const FLOW_PROJECTS = new Set(["w375", "w1440"]);
const flowsOnly = () =>
  test.skip(!FLOW_PROJECTS.has(test.info().project.name), "flows run at 375 and 1440");

test.describe("controls fit at every width (Phase 5)", () => {
  for (const route of PHASE5_ROUTES) {
    test(`${route}`, async ({ page }) => {
      await mockWorkspaceApi(page);
      await page.goto(route);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      await page.waitForLoadState("networkidle");
      await expectControlsFit(page, route);
      await expectNoOverflow(page, route);
    });
  }
});

test.describe("motion (Phase 5)", () => {
  for (const mode of ["reduce", "no-preference"] as const) {
    test.describe(`reduced motion: ${mode}`, () => {
      test.use({ reducedMotion: mode });
      for (const route of PHASE5_ROUTES) {
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
          expect(errors, errors.join("\n")).toEqual([]);
        });
      }
    });
  }
});

test.describe("navigation (Phase 5)", () => {
  test("Lead Lists, Reports, Lead Pipeline, Activities and Outreach Records are enabled", async ({
    page,
  }) => {
    flowsOnly();
    await mockWorkspaceApi(page);
    await page.goto("/app/pipeline");
    await expect(page.getByRole("heading", { level: 1, name: "Lead pipeline" })).toBeVisible();
    if (width(page) < 1024) await page.getByRole("button", { name: "Open navigation" }).click();
    const nav = page.getByRole("navigation", { name: "Dashboard" }).last();
    for (const [name, href] of [
      ["Lead Lists", "/app/lists"],
      ["Reports", "/app/reports"],
      ["Lead Pipeline", "/app/pipeline"],
      ["Activities", "/app/activities"],
      ["Outreach Records", "/app/outreach"],
    ] as const) {
      await expect(nav.getByRole("link", { name })).toHaveAttribute("href", href);
    }
    await expect(nav.getByRole("link", { name: /Lead Pipeline/ })).toHaveAttribute(
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

test.describe("pipeline", () => {
  test("board columns with counts on wide screens; one stage at a time on narrow ones", async ({
    page,
  }) => {
    await mockWorkspaceApi(page);
    await page.goto("/app/pipeline");
    await expect(page.getByRole("heading", { level: 1, name: "Lead pipeline" })).toBeVisible();
    if (width(page) >= 768) {
      const board = page.getByRole("region", { name: "Pipeline board" });
      await expect(board.getByRole("region", { name: /^New/ })).toContainText("2");
      await expect(board.getByRole("heading", { name: "Mama Put Kitchen (Sample)" })).toBeVisible();
      await expect(board.getByRole("region")).toHaveCount(7);
    } else {
      const select = page.getByRole("combobox", { name: "Stage" });
      await expect(select).toContainText("New · 2");
      await expect(
        main(page).getByRole("heading", { name: "Onitsha Spare Parts (Sample)" }),
      ).toBeVisible();
      await select.click();
      await page.getByRole("option", { name: /Qualified/ }).click();
      await expect(page).toHaveURL(/stage=qualified/);
      await expect(
        main(page).getByRole("heading", { name: "Mama Put Kitchen (Sample)" }),
      ).toBeVisible();
      await expect(
        main(page).getByRole("heading", { name: "Onitsha Spare Parts (Sample)" }),
      ).toHaveCount(0);
    }
    await expectNoOverflow(page, "pipeline");
  });

  test("Show more loads the next page of a column", async ({ page }) => {
    flowsOnly();
    await mockWorkspaceApi(page);
    await page.goto("/app/pipeline?stage=new");
    const column = width(page) >= 768 ? page.getByRole("region", { name: /^New/ }) : main(page);
    await expect(
      column.getByRole("heading", { name: "Onitsha Spare Parts (Sample)" }),
    ).toBeVisible();
    await expect(column.getByText("Name expired under source terms")).toHaveCount(0);
    await column.getByRole("button", { name: /Show 1 more/ }).click();
    await expect(column.getByText("Name expired under source terms")).toBeVisible();
  });

  test("notification links filter by owner (?assignedToUserId=)", async ({ page }) => {
    flowsOnly();
    await mockWorkspaceApi(page);
    await page.goto(`/app/pipeline?assignedToUserId=${OWNER_ID}`);
    // Applied filters are chips from 768px and a "Filters (n)" sheet button below.
    if (width(page) >= 768) await expect(page.getByText("Owner: You").first()).toBeVisible();
    else await expect(page.getByRole("button", { name: "Filters (1)" })).toBeVisible();
    await expect(main(page).getByText(/3 leads match/)).toBeVisible();
    await expect(
      main(page).getByRole("heading", { name: "Onitsha Spare Parts (Sample)" }),
    ).toHaveCount(0);
  });

  test("a version conflict is read again and retried once", async ({ page }) => {
    flowsOnly();
    await mockWorkspaceApi(page, { moveConflict: "retry" });
    await page.goto("/app/pipeline?stage=qualified");
    const forward = page.getByRole("button", {
      name: "Move Mama Put Kitchen (Sample) forward to Contacted",
    });
    await forward.focus();
    await page.keyboard.press("]");
    await expect(page.getByTestId("pipeline-announcer")).toHaveText(
      /Moved Mama Put Kitchen \(Sample\) to Contacted\. It had changed since it loaded/,
    );
  });

  test("when someone else moved the lead first, it explains instead of moving again", async ({
    page,
  }) => {
    flowsOnly();
    await mockWorkspaceApi(page, { moveConflict: "moved" });
    await page.goto("/app/pipeline?stage=qualified");
    await page.getByRole("button", { name: "Move Mama Put Kitchen (Sample) back to New" }).click();
    await expect(page.getByText("This lead changed")).toBeVisible();
    await expect(page.getByTestId("pipeline-announcer")).toHaveText(
      "Mama Put Kitchen (Sample) was moved to Contacted by someone else, so it was not moved again.",
    );
  });

  test("assign a lead from its card", async ({ page }) => {
    flowsOnly();
    await mockWorkspaceApi(page);
    await page.goto("/app/pipeline?stage=new");
    await page
      .getByRole("button", { name: "More actions for Onitsha Spare Parts (Sample)" })
      .click();
    await page.getByRole("menuitem", { name: /Assign/ }).click();
    const dialog = page.getByTestId("assign-dialog");
    await expectDialogFits(page);
    await dialog.getByText("Tunde Sales (Sample)").click();
    await dialog.getByRole("button", { name: "Save owner" }).click();
    await expect(
      page.getByText("Assigned Onitsha Spare Parts (Sample) to Tunde Sales (Sample)"),
    ).toBeVisible();
    const card = main(page).locator("article").filter({ hasText: "Onitsha Spare Parts (Sample)" });
    await expect(card.getByTestId("card-owner")).toContainText("Tunde Sales (Sample)");
  });
});

test.describe("lead lists", () => {
  test.beforeEach(flowsOnly);

  test("create a list, open it, and see it empty", async ({ page }) => {
    await mockWorkspaceApi(page);
    await page.goto("/app/lists");
    await expect(
      main(page).getByRole("link", { name: "Lagos restaurants (Sample)" }),
    ).toBeVisible();
    await main(page).getByRole("button", { name: "New list" }).click();
    const dialog = page.getByTestId("list-form-dialog");
    await dialog.getByLabel("Name").fill("Lagos restaurants (Sample)");
    await dialog.getByRole("button", { name: "Create list" }).click();
    await expect(dialog.getByText(/already exists/)).toBeVisible();
    await dialog.getByLabel("Name").fill("Ikeja pharmacies (Sample)");
    await dialog.getByRole("button", { name: "Create list" }).click();
    await expect(page.getByText("List “Ikeja pharmacies (Sample)” created")).toBeVisible();
    await main(page).getByRole("link", { name: "Ikeja pharmacies (Sample)" }).click();
    await expect(
      page.getByRole("heading", { level: 1, name: "Ikeja pharmacies (Sample)" }),
    ).toBeVisible();
    await expect(page.getByRole("heading", { name: "This list is empty" })).toBeVisible();
  });

  test("a list shows each business with its pipeline stage; remove one", async ({ page }) => {
    await mockWorkspaceApi(page);
    await page.goto(`/app/lists/${LIST_ID}`);
    await expect(
      page.getByRole("heading", { level: 1, name: "Lagos restaurants (Sample)" }),
    ).toBeVisible();
    await expect(page.getByTestId("list-meta")).toContainText("3 businesses");
    await expect(main(page).getByText("Qualified").first()).toBeVisible();
    await main(page)
      .getByRole("button", { name: "Remove Onitsha Spare Parts (Sample) from the list" })
      .click();
    const confirm = page.getByRole("alertdialog");
    await expectDialogFits(page, "alertdialog");
    await confirm.getByRole("button", { name: "Remove from list" }).click();
    await expect(
      page.getByText("Removed 1 business from “Lagos restaurants (Sample)”"),
    ).toBeVisible();
    await expect(page.getByTestId("list-meta")).toContainText("2 businesses");
  });

  test("add businesses from a directory search", async ({ page }) => {
    await mockWorkspaceApi(page);
    await page.goto(`/app/lists/${EMPTY_LIST_ID}`);
    await main(page).getByRole("button", { name: "Add businesses" }).first().click();
    const dialog = page.getByTestId("add-businesses-dialog");
    await expectDialogFits(page);
    await dialog.getByLabel("Onitsha Spare Parts (Sample)").check();
    await dialog.getByRole("button", { name: /Add 1 to list/ }).click();
    await expect(page.getByText(/Added 1 business to “Abuja clinics \(Sample\)”/)).toBeVisible();
  });

  test("an unknown list says so", async ({ page }) => {
    await mockWorkspaceApi(page);
    await page.goto(`/app/lists/${UNKNOWN_LIST_ID}`);
    await expect(page.getByRole("heading", { name: "We could not find this list" })).toBeVisible();
  });
});

test.describe("business CRM", () => {
  test.beforeEach(flowsOnly);

  test("the pipeline card shows stage and owner and moves the lead", async ({ page }) => {
    await mockWorkspaceApi(page);
    await page.goto(`/app/businesses/${BUSINESS_ID}`);
    const panel = page.getByTestId("lead-panel");
    await expect(panel.getByTestId("lead-stage")).toContainText("Qualified");
    await expect(panel.getByTestId("lead-owner")).toHaveText("You");
    await panel.getByRole("button", { name: "Forward to Contacted" }).click();
    await expect(panel.getByTestId("lead-stage")).toContainText("Contacted");
    await expect(page.getByTestId("business-lists")).toContainText("Lagos restaurants (Sample)");
  });

  test("add to list from the business page", async ({ page }) => {
    await mockWorkspaceApi(page);
    await page.goto(`/app/businesses/${BUSINESS_ID}`);
    await main(page).getByRole("button", { name: "Add to list" }).first().click();
    const dialog = page.getByTestId("add-to-list-dialog");
    await expect(dialog.getByText(/Already on this list/)).toBeVisible();
    await dialog.getByText("Abuja clinics (Sample)").click();
    await dialog.getByRole("button", { name: "Add to list" }).click();
    await expect(page.getByText("Added 1 business to “Abuja clinics (Sample)”")).toBeVisible();
  });

  test("activities tab: timeline, outreach and logging a call", async ({ page }) => {
    await mockWorkspaceApi(page);
    await page.goto(`/app/businesses/${BUSINESS_ID}?tab=activities`);
    const tab = page.getByTestId("activities-tab");
    const timeline = tab.getByTestId("activity-timeline");
    await expect(timeline).toContainText("Call · Connected");
    await expect(timeline).toContainText("Moved from New to Qualified");
    await expect(timeline).toContainText("Assigned to you");
    await expect(page.getByTestId("outreach-panel")).toContainText("2 attempts");
    await tab.getByRole("button", { name: "Log activity" }).click();
    const dialog = page.getByTestId("log-activity-dialog");
    await expectDialogFits(page);
    await dialog.getByText("Call", { exact: true }).click();
    await dialog.getByRole("combobox", { name: "Outcome" }).click();
    await page.getByRole("option", { name: "No answer" }).click();
    await dialog.getByRole("button", { name: "Use +234 803 123 4567" }).click();
    await dialog.getByRole("button", { name: "Log call" }).click();
    await expect(page.getByText("Call logged")).toBeVisible();
    await expect(timeline).toContainText("Call · No answer");
  });

  test("contact with a suppressed business needs an audited reason", async ({ page }) => {
    await mockWorkspaceApi(page, { contactSuppressed: true });
    await page.goto(`/app/businesses/${BUSINESS_ID}?tab=activities`);
    await page.getByTestId("activities-tab").getByRole("button", { name: "Log activity" }).click();
    const dialog = page.getByTestId("log-activity-dialog");
    await dialog.getByText("WhatsApp message", { exact: true }).click();
    await dialog.getByRole("button", { name: "Log WhatsApp message" }).click();
    const step = dialog.getByTestId("suppression-override");
    await expect(
      step.getByRole("heading", { name: "Log contact with a suppressed business?" }),
    ).toBeFocused();
    await expect(step).toContainText("written to the audit log");
    await dialog
      .getByLabel(/Reason for logging this contact/)
      .fill("They messaged us first asking for a quote.");
    await dialog.getByRole("button", { name: "Log with override" }).click();
    await expect(page.getByText("WhatsApp message logged")).toBeVisible();
  });
});

test.describe("activities and outreach pages", () => {
  test.beforeEach(flowsOnly);

  test("activity filters live in the URL; edit an activity", async ({ page }) => {
    await mockWorkspaceApi(page);
    await page.goto("/app/activities?type=call");
    if (width(page) >= 768) {
      await expect(
        page.getByRole("group", { name: "Applied filters" }).getByText("Type: Call"),
      ).toBeVisible();
    } else {
      await expect(page.getByRole("button", { name: "Filters (1)" })).toBeVisible();
    }
    await expect(main(page).getByText("Moved from New to Qualified")).toHaveCount(0);
    await main(page)
      .getByRole("button", { name: /^Actions for Call/ })
      .first()
      .click();
    await page.getByRole("menuitem", { name: "Edit" }).click();
    const dialog = page.getByRole("dialog", { name: "Edit call" });
    await dialog.getByLabel("Notes").fill("Called back; they want a menu (Sample).");
    await dialog.getByRole("button", { name: "Save changes" }).click();
    await expect(page.getByText("Call updated")).toBeVisible();
  });

  test("outreach records: status per channel, change a status", async ({ page }) => {
    await mockWorkspaceApi(page);
    await page.goto("/app/outreach");
    await expect(main(page).getByText("In progress").first()).toBeVisible();
    await main(page)
      .getByRole("button", { name: /^Status: change the status of Calls outreach/ })
      .first()
      .click();
    await page.getByRole("menuitemradio", { name: "No response" }).click();
    await expect(page.getByText("Status set to No response")).toBeVisible();
  });
});

test.describe("bulk operations", () => {
  test.beforeEach(flowsOnly);

  test("select, assign, preview, confirm, then follow progress to the results", async ({
    page,
  }) => {
    await mockWorkspaceApi(page);
    await page.goto("/app/businesses");
    await expect(
      main(page).getByRole("link", { name: "Mama Put Kitchen (Sample)" }).first(),
    ).toBeVisible();
    await page.getByRole("checkbox", { name: "Select row 1" }).check();
    await page.getByRole("checkbox", { name: "Select row 3" }).check();
    await page.getByRole("button", { name: "Lead actions" }).click();
    await page.getByRole("menuitem", { name: "Assign…" }).click();
    const dialog = page.getByTestId("bulk-action-dialog");
    await expectDialogFits(page);
    await dialog.getByText("Tunde Sales (Sample)").click();
    const preview = page.waitForRequest((r) => r.url().endsWith("/bulk-operations/preview"));
    await dialog.getByRole("button", { name: "Preview changes" }).click();
    await preview;
    await expect(dialog.getByTestId("bulk-will-change")).toHaveText("1 will change");
    await dialog.getByRole("button", { name: "Continue" }).click();
    const confirm = page.getByRole("alertdialog", { name: "Assign 2 businesses?" });
    const create = page.waitForRequest(
      (r) => r.method() === "POST" && r.url().endsWith("/bulk-operations"),
    );
    await confirm.getByRole("button", { name: "Assign 2" }).click();
    expect((await create).headers()["idempotency-key"]).toMatch(/^bulk-/);
    await expect(page).toHaveURL(/\/app\/jobs\/bulk\//);
    await expect(
      page.getByRole("heading", { level: 1, name: "Assign to Tunde Sales (Sample)" }),
    ).toBeVisible();
    await expect(page.getByTestId("bulk-status")).toHaveText(/Completed/, { timeout: 15_000 });
    await expect(
      main(page).getByText("Not assigned to you").or(main(page).getByText("Suppressed")).first(),
    ).toBeVisible();
  });

  test("a finished operation with errors lists each business's result", async ({ page }) => {
    await mockWorkspaceApi(page);
    await page.goto(`/app/jobs/bulk/${BULK_DONE_ID}`);
    await expect(page.getByTestId("bulk-status")).toHaveText(/Completed with errors/);
    await expect(page.getByText("Some businesses failed")).toBeVisible();
    await expect(page.getByTestId("bulk-counts")).toContainText("21");
    await expect(
      main(page).getByText("Unexpected error while saving the lead (Sample)."),
    ).toBeVisible();
  });
});

test.describe("async exports", () => {
  test.beforeEach(flowsOnly);

  test("export a list, wait for the ZIP, then download it", async ({ page }) => {
    await mockWorkspaceApi(page);
    await page.goto(`/app/lists/${LIST_ID}`);
    await main(page).getByRole("button", { name: "Export" }).click();
    const dialog = page.getByTestId("export-dialog");
    await expect(dialog).toContainText("ATTRIBUTION.txt");
    await expectDialogFits(page);
    await dialog.getByRole("button", { name: "Create export" }).click();
    await expect(page).toHaveURL(/\/app\/jobs\/exports\//);
    await expect(page.getByTestId("export-status")).toHaveText(/Ready to download/, {
      timeout: 15_000,
    });
    await expect(page.getByTestId("export-file")).toContainText("CDLA-Permissive-2.0");
    const download = page.waitForEvent("download");
    await page.getByTestId("export-download").click();
    const file = await download;
    expect(file.suggestedFilename()).toMatch(/\.zip$/);
    expect(file.url()).toContain("/api/v1/exports/");
  });

  test("an expired export explains and offers to run it again", async ({ page }) => {
    await mockWorkspaceApi(page);
    await page.goto(`/app/jobs/exports/${EXPORT_EXPIRED_ID}`);
    await expect(page.getByText("This export has expired")).toBeVisible();
    await expect(page.getByRole("button", { name: "Download ZIP" })).toHaveCount(0);
  });

  test("a refused download link is explained", async ({ page }) => {
    await mockWorkspaceApi(page, { downloadError: "DOWNLOAD_LINK_EXPIRED" });
    await page.goto(`/app/jobs/exports/${EXPORT_READY_ID}`);
    await page.getByRole("button", { name: "Download ZIP" }).click();
    await expect(page.getByTestId("download-problem")).toContainText("expired");
  });
});

test.describe("reports, usage, overview and settings", () => {
  test.beforeEach(flowsOnly);

  test("reports: separate quality histograms, table views and the period in the URL", async ({
    page,
  }) => {
    await mockWorkspaceApi(page);
    await page.goto("/app/reports");
    await expect(page.getByTestId("chart-fit")).toBeVisible();
    await expect(page.getByTestId("chart-confidence")).toBeVisible();
    await page.getByTestId("chart-fit").getByRole("radio", { name: /Table/ }).click();
    await expect(
      page.getByTestId("chart-fit").getByRole("table", { name: "Fit score distribution" }),
    ).toBeVisible();
    await page
      .getByRole("radiogroup", { name: "Period" })
      .getByRole("radio", { name: /All time/ })
      .click();
    await expect(page).toHaveURL(/period=all/);
    await expect(page.getByTestId("report-jobs")).toContainText("the last 90 days");
    await expectNoOverflow(page, "reports");
  });

  test("reports in an empty workspace say there is nothing yet", async ({ page }) => {
    await mockWorkspaceApi(page, { empty: true });
    await page.goto("/app/reports");
    await expect(page.getByText("No scored businesses in this period yet.").first()).toBeVisible();
    await expect(page.getByText("No leads in the pipeline yet.")).toBeVisible();
  });

  test("usage: totals and daily charts from the rollup", async ({ page }) => {
    await mockWorkspaceApi(page);
    await page.goto("/app/usage?period=7d");
    const usage = page.getByTestId("usage-over-time");
    await expect(usage.getByTestId("usage-totals")).toContainText("47");
    await expect(usage.getByRole("heading", { name: "Credits used per day" })).toBeVisible();
    // Ledger rows name what they belong to (referenceName), linked to the job.
    await expect(
      main(page).getByRole("link", { name: "Bakeries in Yaba, Lagos (Sample)" }).first(),
    ).toBeVisible();
    await expect(page).toHaveURL(/period=7d/);
  });

  test("overview: pipeline, jobs, recent activity and lead quality", async ({ page }) => {
    await mockWorkspaceApi(page);
    await page.goto("/app");
    await expect(page.getByTestId("overview-pipeline")).toContainText("Open leads");
    await expect(page.getByTestId("overview-jobs")).toContainText("Export of list");
    await expect(page.getByTestId("overview-activity")).toContainText("Call · Connected");
    await expect(page.getByTestId("overview-quality")).toContainText("never added together");
  });

  test("assignment emails can be switched off", async ({ page }) => {
    await mockWorkspaceApi(page);
    await page.goto("/app/settings?tab=notifications");
    const toggle = page.getByRole("switch", { name: /Email when a lead is assigned to you/ });
    await expect(toggle).toBeChecked();
    const put = page.waitForRequest(
      (r) => r.method() === "PUT" && r.url().endsWith("/notifications/preferences"),
    );
    await toggle.click();
    expect((await put).postDataJSON()).toEqual({ emailAssignments: false });
  });

  test("background jobs link exports and bulk operations to their pages", async ({ page }) => {
    await mockWorkspaceApi(page);
    await page.goto("/app/jobs?kind=export&kind=bulk");
    await expect(
      main(page)
        .getByRole("link", { name: /Export of list/ })
        .first(),
    ).toHaveAttribute("href", `/app/jobs/exports/${EXPORT_READY_ID}`);
    await expect(
      main(page)
        .getByRole("link", { name: /Assign 24 businesses/ })
        .first(),
    ).toHaveAttribute("href", `/app/jobs/bulk/${BULK_DONE_ID}`);
  });
});
