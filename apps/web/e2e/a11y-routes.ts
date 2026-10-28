import { expect, type Page, type Route } from "@playwright/test";
import {
  AUTH_ROUTES,
  BUSINESS_ID,
  BUSINESS_ROUTES,
  DISCOVERY_ROUTES,
  MARKETING_ROUTES,
  PHASE4_ROUTES,
  PHASE5_ROUTES,
  PHASE6_ROUTES,
  RUNNING_JOB_ID,
  SHELL_ROUTES,
  STAGE10_ROUTES,
  UPLOADED_IMPORT_ID,
  errorBody,
  mockMissingInvitation,
  mockWorkspaceApi,
  type MockOptions,
} from "./fixtures";
import { CANDIDATE_ID } from "./fixtures-phase4";
import { BULK_DONE_ID, EXPORT_READY_ID, LIST_ID } from "./fixtures-phase5";
import { RETURN_REFS } from "./fixtures-phase6";

/*
 * Every page and state the accessibility suites visit. The axe spec (a11y.spec.ts) runs each
 * scenario at 375 and 1440 in light and dark; the semantics spec checks headings and landmarks on
 * the same list.
 *
 * Adding a screen: append its route list to ROUTE_GROUPS (plain routes need nothing else), and add
 * a scenario to STATE_SCENARIOS for every dialog, sheet, popover, wizard step, empty or error state
 * that only appears after an interaction or with a different fixture.
 */

export type ApiMode =
  /** No mocks: the rewrite points at an unreachable API, as for marketing pages. */
  | "unreachable"
  /** The invitation lookup answers 404 (auth pages), nothing else is mocked. */
  | "auth"
  /** mockWorkspaceApi with these options. */
  | { workspace: MockOptions };

export interface A11yScenario {
  /** Unique, short, stable: used in test titles (for --grep chunking) and report file names. */
  name: string;
  path: string;
  api: ApiMode;
  /** Endpoints that fail, registered after the workspace mocks so they take precedence. */
  fail?: {
    method?: string;
    path: RegExp | string;
    status: number;
    code: string;
    message: string;
  }[];
  /** Reaches the state after the page loaded (opens a dialog, walks a wizard...). */
  act?: (page: Page) => Promise<void>;
  /** Restrict to viewport widths where the state exists (a drawer below 1024px...). */
  when?: (width: number) => boolean;
  /** The state has no h1 of its own (for example the API-unreachable shell); default true. */
  hasH1?: boolean;
}

const WS: ApiMode = { workspace: {} };

/** Plain route lists, grouped so suites can be chunked by group name. */
export const ROUTE_GROUPS: Record<string, { routes: readonly string[]; api: ApiMode }> = {
  marketing: { routes: MARKETING_ROUTES, api: "unreachable" },
  auth: { routes: AUTH_ROUTES, api: "auth" },
  shell: { routes: SHELL_ROUTES, api: WS },
  businesses: { routes: BUSINESS_ROUTES, api: WS },
  discovery: { routes: DISCOVERY_ROUTES, api: WS },
  phase4: { routes: PHASE4_ROUTES, api: WS },
  phase5: { routes: PHASE5_ROUTES, api: WS },
  phase6: { routes: PHASE6_ROUTES, api: WS },
  stage10: { routes: STAGE10_ROUTES, api: { workspace: { orgExport: "completed" } } },
};

function main(page: Page) {
  return page.locator("#main");
}

async function openNavIfNarrow(page: Page) {
  if ((page.viewportSize()?.width ?? 0) < 1024) {
    await page.getByRole("button", { name: "Open navigation" }).click();
    await expect(page.getByRole("dialog", { name: "Navigation" })).toBeVisible();
  }
}

async function selectTwoRows(page: Page) {
  await expect(
    main(page).getByRole("link", { name: "Mama Put Kitchen (Sample)" }).first(),
  ).toBeVisible();
  await page.getByRole("checkbox", { name: "Select row 1" }).check();
  await page.getByRole("checkbox", { name: "Select row 3" }).check();
}

/** Opens the first card's More actions menu on the pipeline (the board or the narrow column). */
async function openCardMenu(page: Page) {
  const card = main(page)
    .locator("article")
    .filter({ hasText: "Mama Put Kitchen (Sample)" })
    .first();
  await expect(card).toBeVisible();
  return card;
}

/** Opens a bulk action from the directory for two selected rows. */
async function startBulk(page: Page, action: "Add to list" | "Assign…") {
  await selectTwoRows(page);
  if (action === "Add to list") {
    await page.getByRole("button", { name: "Add to list", exact: true }).click();
  } else {
    await page.getByRole("button", { name: "Lead actions" }).click();
    await page.getByRole("menuitem", { name: action }).click();
  }
  await expect(page.getByTestId("bulk-action-dialog")).toBeVisible();
}

export async function walkWizardToEstimate(page: Page) {
  await expect(page.getByText("Choose where to search")).toBeVisible();
  await page.getByRole("button", { name: /Continue/ }).click();
  await expect(page.getByText("What to find, and where")).toBeVisible();
  await page.getByRole("button", { name: /^Pharmacy/ }).click();
  await page.getByLabel("City or town").fill("Ikeja");
  await page.getByRole("button", { name: /Continue/ }).click();
  await expect(page.getByText("Set limits")).toBeVisible();
  await page.getByRole("button", { name: /Continue/ }).click();
  await expect(page.getByText("Check the estimate")).toBeVisible();
}

/** Interaction states, empty states, error states and role variants. */
export const STATE_SCENARIOS: A11yScenario[] = [
  // Marketing and auth.
  {
    name: "marketing-mobile-menu",
    path: "/",
    api: "unreachable",
    when: (w) => w < 768,
    act: async (page) => {
      await page.getByRole("button", { name: "Open menu" }).click();
      await expect(page.getByRole("dialog")).toBeVisible();
    },
  },
  {
    name: "contact-form-errors",
    path: "/contact",
    api: "unreachable",
    act: async (page) => {
      await main(page).locator("form").getByRole("button", { name: /Send/ }).click();
      await expect(main(page).locator("[aria-invalid=true]").first()).toBeVisible();
    },
  },
  {
    name: "sign-in-errors",
    path: "/sign-in",
    api: "auth",
    act: async (page) => {
      await page.getByRole("button", { name: "Sign in", exact: true }).click();
      await expect(main(page).locator("[aria-invalid=true]").first()).toBeVisible();
    },
  },
  {
    name: "sign-up-errors",
    path: "/sign-up",
    api: "auth",
    act: async (page) => {
      await main(page)
        .locator("form")
        .getByRole("button", { name: /Create account/ })
        .click();
      await expect(main(page).locator("[aria-invalid=true]").first()).toBeVisible();
    },
  },
  {
    name: "forgot-password-errors",
    path: "/forgot-password",
    api: "auth",
    act: async (page) => {
      await main(page).locator("form").getByRole("button").last().click();
      await expect(main(page).locator("[aria-invalid=true]").first()).toBeVisible();
    },
  },

  // Shell.
  { name: "shell-api-unreachable", path: "/app", api: "unreachable" },
  { name: "overview-empty", path: "/app", api: { workspace: { empty: true } } },
  {
    name: "shell-nav-drawer",
    path: "/app",
    api: WS,
    when: (w) => w < 1024,
    act: openNavIfNarrow,
  },
  {
    name: "shell-rail",
    path: "/app/businesses",
    api: WS,
    when: (w) => w >= 1024,
    act: async (page) => {
      await page.getByRole("button", { name: "Collapse navigation" }).click();
      await expect(page.getByRole("button", { name: "Expand navigation" })).toBeVisible();
    },
  },
  {
    name: "shell-user-menu",
    path: "/app",
    api: WS,
    act: async (page) => {
      await page.getByRole("button", { name: /Account menu/ }).click();
      await expect(page.getByRole("menu")).toBeVisible();
    },
  },
  {
    name: "shell-org-switcher",
    path: "/app",
    api: WS,
    act: async (page) => {
      await page.getByRole("button", { name: /Switch organization/ }).click();
      await expect(page.getByRole("menu")).toBeVisible();
    },
  },
  {
    name: "shell-theme-menu",
    path: "/app",
    api: WS,
    when: (w) => w >= 480,
    act: async (page) => {
      await page.getByRole("button", { name: "Change theme" }).click();
      await expect(page.getByRole("menu")).toBeVisible();
    },
  },
  {
    name: "shell-notifications",
    path: "/app",
    api: WS,
    act: async (page) => {
      await page.getByRole("button", { name: /^Notifications/ }).click();
      await expect(page.getByTestId("notification-panel")).toBeVisible();
    },
  },
  {
    name: "shell-page-search",
    path: "/app",
    api: WS,
    when: (w) => w >= 768,
    act: async (page) => {
      await page.getByRole("combobox", { name: "Search pages and settings" }).fill("set");
      await expect(page.getByRole("listbox", { name: "Destinations" })).toBeVisible();
    },
  },
  {
    name: "team-invite-dialog",
    path: "/app/team",
    api: WS,
    act: async (page) => {
      await main(page)
        .getByRole("button", { name: /Invite member/ })
        .first()
        .click();
      const dialog = page.getByRole("dialog", { name: "Invite a team member" });
      await expect(dialog).toBeVisible();
      await dialog
        .getByRole("button", { name: /Send invitation|Invite/ })
        .last()
        .click();
      await expect(dialog.locator("[aria-invalid=true]").first()).toBeVisible();
    },
  },
  {
    name: "team-error",
    path: "/app/team",
    api: WS,
    fail: [
      {
        path: /^\/organizations\/current\/members$/,
        status: 500,
        code: "INTERNAL",
        message: "Something went wrong",
      },
    ],
  },

  // Businesses.
  { name: "businesses-empty", path: "/app/businesses", api: { workspace: { empty: true } } },
  {
    name: "businesses-error",
    path: "/app/businesses",
    api: WS,
    fail: [
      { path: /^\/businesses$/, status: 500, code: "INTERNAL", message: "Something went wrong" },
    ],
  },
  { name: "businesses-analyst", path: "/app/businesses", api: { workspace: { role: "analyst" } } },
  {
    name: "businesses-add-dialog-errors",
    path: "/app/businesses",
    api: WS,
    act: async (page) => {
      await main(page).getByRole("button", { name: "Add business" }).first().click();
      const dialog = page.getByRole("dialog", { name: "Add a business" });
      await expect(dialog).toBeVisible();
      await dialog.getByRole("button", { name: "Add business" }).click();
      await expect(dialog.getByRole("alert").first()).toBeVisible();
    },
  },
  {
    name: "businesses-filter-open",
    path: "/app/businesses",
    api: WS,
    act: async (page) => {
      await expect(
        main(page).getByRole("link", { name: "Mama Put Kitchen (Sample)" }).first(),
      ).toBeVisible();
      if ((page.viewportSize()?.width ?? 0) < 768) {
        await page.getByRole("button", { name: /^Filters/ }).click();
        await expect(page.getByRole("dialog")).toBeVisible();
      } else {
        await page.getByRole("button", { name: "Region" }).click();
        await expect(page.getByRole("menu")).toBeVisible();
      }
    },
  },
  { name: "businesses-selected", path: "/app/businesses", api: WS, act: selectTwoRows },
  {
    name: "businesses-bulk-analyze",
    path: "/app/businesses",
    api: WS,
    act: async (page) => {
      await selectTwoRows(page);
      await page
        .getByRole("button", { name: /Analyze websites/ })
        .first()
        .click();
      await expect(page.getByTestId("bulk-analyze-dialog")).toBeVisible();
    },
  },
  {
    name: "businesses-bulk-suppress",
    path: "/app/businesses",
    api: WS,
    act: async (page) => {
      await selectTwoRows(page);
      await page.getByRole("button", { name: "Suppress", exact: true }).click();
      await expect(page.getByRole("alertdialog")).toBeVisible();
    },
  },
  {
    name: "business-corrections-errors",
    path: `/app/businesses/${BUSINESS_ID}`,
    api: WS,
    act: async (page) => {
      await page.getByRole("button", { name: "Correct details" }).click();
      const dialog = page.getByRole("dialog", { name: "Correct details" });
      await expect(dialog).toBeVisible();
      await dialog.getByLabel("Business name").fill("");
      await dialog.getByRole("button", { name: "Save correction" }).click();
      await expect(dialog.getByRole("alert").first()).toBeVisible();
    },
  },
  {
    name: "business-run-analysis",
    path: `/app/businesses/${BUSINESS_ID}?tab=analysis`,
    api: WS,
    act: async (page) => {
      await page
        .getByTestId("analysis-tab")
        .getByRole("button", { name: /Run website analysis/ })
        .click();
      await expect(
        page.getByRole("alertdialog", { name: "Run a website analysis?" }),
      ).toBeVisible();
    },
  },
  {
    name: "business-detail-error",
    path: `/app/businesses/${BUSINESS_ID}`,
    api: WS,
    fail: [
      {
        path: `/businesses/${BUSINESS_ID}`,
        status: 500,
        code: "INTERNAL",
        message: "Something went wrong",
      },
    ],
  },
  {
    name: "import-mapping-error",
    path: `/app/businesses/import?id=${UPLOADED_IMPORT_ID}`,
    api: WS,
    act: async (page) => {
      await page.getByRole("combobox", { name: /Import “Business Name” as/ }).click();
      await page.getByRole("option", { name: "Don't import" }).click();
      await page.getByRole("button", { name: "Check rows" }).click();
      await expect(page.getByText("Fix the mapping to continue")).toBeVisible();
    },
  },
  {
    name: "import-review",
    path: `/app/businesses/import?id=${UPLOADED_IMPORT_ID}`,
    api: WS,
    act: async (page) => {
      await page.getByRole("button", { name: "Check rows" }).click();
      await expect(page.getByText("Check rows before importing")).toBeVisible();
    },
  },

  // Discovery, jobs, usage.
  { name: "discovery-empty", path: "/app/discovery", api: { workspace: { empty: true } } },
  {
    name: "discovery-error",
    path: "/app/discovery",
    api: WS,
    fail: [
      {
        path: /^\/discovery\/jobs$/,
        status: 500,
        code: "INTERNAL",
        message: "Something went wrong",
      },
    ],
  },
  {
    name: "wizard-target-errors",
    path: "/app/discovery/new?step=target",
    api: WS,
    act: async (page) => {
      await page.getByRole("button", { name: /Continue/ }).click();
      await expect(page.getByText("Add at least one category or keyword.")).toBeVisible();
    },
  },
  {
    name: "wizard-limits",
    path: "/app/discovery/new",
    api: WS,
    act: async (page) => {
      await walkWizardToEstimate(page);
    },
  },
  {
    name: "wizard-review",
    path: "/app/discovery/new",
    api: WS,
    act: async (page) => {
      await walkWizardToEstimate(page);
      await page.getByRole("button", { name: /Continue/ }).click();
      await expect(page.getByRole("heading", { name: "Review and create" })).toBeVisible();
    },
  },
  {
    name: "wizard-insufficient",
    path: "/app/discovery/new",
    api: { workspace: { estimate: "insufficient" } },
    act: walkWizardToEstimate,
  },
  {
    name: "wizard-blocked",
    path: "/app/discovery/new",
    api: { workspace: { estimate: "blocked" } },
    act: walkWizardToEstimate,
  },
  {
    name: "discovery-cancel-dialog",
    path: `/app/discovery/${RUNNING_JOB_ID}`,
    api: WS,
    act: async (page) => {
      await page.getByRole("button", { name: /Cancel job/ }).click();
      await expect(
        page.getByRole("alertdialog", { name: "Cancel this discovery job?" }),
      ).toBeVisible();
    },
  },
  { name: "jobs-empty", path: "/app/jobs", api: { workspace: { empty: true } } },
  {
    name: "jobs-error",
    path: "/app/jobs",
    api: WS,
    fail: [{ path: /^\/jobs$/, status: 500, code: "INTERNAL", message: "Something went wrong" }],
  },
  { name: "usage-empty", path: "/app/usage", api: { workspace: { empty: true } } },
  { name: "usage-sales-rep", path: "/app/usage", api: { workspace: { role: "sales_rep" } } },
  {
    name: "sources-switch-off",
    path: "/app/sources",
    api: WS,
    act: async (page) => {
      await page.getByRole("switch", { name: /Enabled in this workspace/ }).click();
      await expect(page.getByRole("alertdialog")).toBeVisible();
    },
  },
  {
    name: "sources-error",
    path: "/app/sources",
    api: WS,
    fail: [{ path: /^\/sources$/, status: 500, code: "INTERNAL", message: "Something went wrong" }],
  },

  // Analysis, duplicates, scoring.
  { name: "analysis-empty", path: "/app/analysis", api: { workspace: { empty: true } } },
  {
    name: "analysis-error",
    path: "/app/analysis",
    api: WS,
    fail: [
      {
        path: /^\/analysis\/websites$/,
        status: 500,
        code: "INTERNAL",
        message: "Something went wrong",
      },
    ],
  },
  {
    name: "duplicates-empty",
    path: "/app/businesses/duplicates",
    api: { workspace: { empty: true } },
  },
  {
    name: "duplicates-merge-dialog",
    path: `/app/businesses/duplicates/${CANDIDATE_ID}`,
    api: WS,
    act: async (page) => {
      await page.getByRole("button", { name: /Merge/ }).first().click();
      await expect(page.getByTestId("merge-dialog")).toBeVisible();
    },
  },
  {
    name: "duplicates-undo-conflict",
    path: "/app/businesses/duplicates?view=history",
    api: { workspace: { undoConflict: true } },
    act: async (page) => {
      const history = page.getByRole("list", { name: "Merge history" });
      await history
        .getByRole("button", { name: /Undo merge/ })
        .first()
        .click();
      await page
        .getByRole("alertdialog", { name: "Undo this merge?" })
        .getByRole("button", { name: "Undo merge" })
        .click();
      await expect(
        page.getByRole("alertdialog", { name: "These records changed after the merge" }),
      ).toBeVisible();
    },
  },
  {
    name: "scoring-weights-error",
    path: "/app/settings?tab=scoring",
    api: WS,
    act: async (page) => {
      const settings = page.getByTestId("scoring-settings");
      await settings.getByLabel("Freshness").fill("5");
      await expect(settings.getByTestId("weights-error")).toBeVisible();
    },
  },
  {
    name: "scoring-conflict",
    path: "/app/settings?tab=scoring",
    api: { workspace: { scoringConflict: true } },
    act: async (page) => {
      const settings = page.getByTestId("scoring-settings");
      await settings.getByLabel("Freshness").fill("5");
      await settings.getByLabel("Source reliability").fill("10");
      await settings.getByRole("button", { name: /Save and recompute scores/ }).click();
      await expect(settings.getByTestId("scoring-conflict")).toBeVisible();
    },
  },
  {
    name: "scoring-researcher",
    path: "/app/settings?tab=scoring",
    api: { workspace: { role: "researcher" } },
  },

  // Phase 5: pipeline, lists, activities, outreach, reports, bulk operations, exports.
  { name: "pipeline-empty", path: "/app/pipeline", api: { workspace: { empty: true } } },
  {
    name: "pipeline-error",
    path: "/app/pipeline",
    api: WS,
    fail: [
      {
        path: /^\/pipeline\/board$/,
        status: 500,
        code: "INTERNAL",
        message: "Something went wrong",
      },
    ],
  },
  { name: "pipeline-sales-rep", path: "/app/pipeline", api: { workspace: { role: "sales_rep" } } },
  {
    name: "pipeline-move-menu",
    path: "/app/pipeline?stage=qualified",
    api: WS,
    act: async (page) => {
      const card = await openCardMenu(page);
      await card.getByRole("button", { name: /^Move to…/ }).click();
      await expect(page.getByRole("menu")).toBeVisible();
    },
  },
  {
    name: "pipeline-assign-dialog",
    path: "/app/pipeline?stage=qualified",
    api: WS,
    act: async (page) => {
      const card = await openCardMenu(page);
      await card.getByRole("button", { name: /More actions for/ }).click();
      await page.getByRole("menuitem", { name: /Assign/ }).click();
      await expect(page.getByTestId("assign-dialog")).toBeVisible();
    },
  },
  { name: "lists-empty", path: "/app/lists", api: { workspace: { empty: true } } },
  {
    name: "lists-error",
    path: "/app/lists",
    api: WS,
    fail: [{ path: /^\/lists$/, status: 500, code: "INTERNAL", message: "Something went wrong" }],
  },
  {
    name: "lists-new-dialog-errors",
    path: "/app/lists",
    api: WS,
    act: async (page) => {
      await main(page).getByRole("button", { name: "New list" }).first().click();
      const dialog = page.getByTestId("list-form-dialog");
      await expect(dialog).toBeVisible();
      await dialog.getByRole("button", { name: "Create list" }).click();
      await expect(dialog.locator("[aria-invalid=true]").first()).toBeVisible();
    },
  },
  {
    name: "list-add-businesses",
    path: `/app/lists/${LIST_ID}`,
    api: WS,
    act: async (page) => {
      await main(page).getByRole("button", { name: "Add businesses" }).click();
      await expect(page.getByTestId("add-businesses-dialog")).toBeVisible();
      await expect(page.getByRole("checkbox").first()).toBeVisible();
    },
  },
  {
    name: "list-remove-confirm",
    path: `/app/lists/${LIST_ID}`,
    api: WS,
    act: async (page) => {
      await main(page)
        .getByRole("button", { name: /^Remove .* from the list$/ })
        .first()
        .click();
      await expect(page.getByRole("alertdialog")).toBeVisible();
    },
  },
  { name: "activities-empty", path: "/app/activities", api: { workspace: { empty: true } } },
  {
    name: "activities-error",
    path: "/app/activities",
    api: WS,
    fail: [
      { path: /^\/activities$/, status: 500, code: "INTERNAL", message: "Something went wrong" },
    ],
  },
  {
    name: "activities-edit-dialog",
    path: "/app/activities",
    api: WS,
    act: async (page) => {
      await main(page)
        .getByRole("button", { name: /^Actions for Call/ })
        .first()
        .click();
      await page.getByRole("menuitem", { name: "Edit" }).click();
      await expect(page.getByRole("dialog", { name: "Edit call" })).toBeVisible();
    },
  },
  {
    name: "activities-date-filter",
    path: "/app/activities",
    api: WS,
    when: (w) => w >= 768,
    act: async (page) => {
      await main(page).getByRole("button", { name: "Date" }).click();
      await expect(page.getByLabel("From")).toBeVisible();
    },
  },
  { name: "outreach-empty", path: "/app/outreach", api: { workspace: { empty: true } } },
  {
    name: "outreach-error",
    path: "/app/outreach",
    api: WS,
    fail: [
      { path: /^\/outreach$/, status: 500, code: "INTERNAL", message: "Something went wrong" },
    ],
  },
  {
    name: "outreach-attempt-dialog",
    path: "/app/outreach",
    api: WS,
    act: async (page) => {
      await main(page)
        .getByRole("button", { name: /^Log attempt/ })
        .first()
        .click();
      await expect(page.getByTestId("log-activity-dialog")).toBeVisible();
    },
  },
  { name: "reports-empty", path: "/app/reports", api: { workspace: { empty: true } } },
  {
    name: "reports-error",
    path: "/app/reports",
    api: WS,
    fail: [
      {
        path: /^\/reports\/quality-distribution$/,
        status: 500,
        code: "INTERNAL",
        message: "Something went wrong",
      },
    ],
  },
  {
    name: "reports-table-view",
    path: "/app/reports",
    api: WS,
    act: async (page) => {
      const fit = page.getByTestId("chart-fit");
      await fit.getByRole("radio", { name: /Table/ }).click();
      await expect(fit.getByRole("table")).toBeVisible();
    },
  },
  {
    name: "bulk-preview",
    path: "/app/businesses",
    api: WS,
    act: async (page) => {
      await startBulk(page, "Assign…");
      const dialog = page.getByTestId("bulk-action-dialog");
      await dialog.getByText("Tunde Sales (Sample)").click();
      await dialog.getByRole("button", { name: "Preview changes" }).click();
      await expect(page.getByTestId("bulk-preview")).toBeVisible();
    },
  },
  {
    name: "bulk-confirm",
    path: "/app/businesses",
    api: WS,
    act: async (page) => {
      await startBulk(page, "Add to list");
      const dialog = page.getByTestId("bulk-action-dialog");
      await dialog.getByText("Lagos restaurants (Sample)").click();
      await dialog.getByRole("button", { name: "Preview changes" }).click();
      await dialog.getByRole("button", { name: "Continue" }).click();
      await expect(page.getByRole("alertdialog")).toBeVisible();
    },
  },
  {
    name: "bulk-over-cap",
    path: "/app/businesses",
    api: { workspace: { bulkOverCap: true } },
    act: async (page) => {
      await main(page)
        .getByRole("button", { name: /Act on all results/ })
        .click();
      await page.getByRole("menuitem", { name: /Move to stage/ }).click();
      const dialog = page.getByTestId("bulk-action-dialog");
      await dialog.getByRole("combobox", { name: "Stage" }).click();
      await page.getByRole("option", { name: "Contacted" }).click();
      await dialog.getByRole("button", { name: "Preview changes" }).click();
      await expect(dialog.getByText("Too many businesses for one operation")).toBeVisible();
    },
  },
  {
    name: "export-dialog",
    path: "/app/businesses",
    api: WS,
    act: async (page) => {
      await main(page).getByRole("button", { name: "Export", exact: true }).click();
      await expect(page.getByTestId("export-dialog")).toBeVisible();
    },
  },
  {
    name: "export-too-large",
    path: "/app/businesses",
    api: { workspace: { exportTooLarge: true } },
    act: async (page) => {
      await main(page).getByRole("button", { name: "Export", exact: true }).click();
      await page
        .getByTestId("export-dialog")
        .getByRole("button", { name: "Create export" })
        .click();
      await expect(page.getByText("Too many rows for one export")).toBeVisible();
    },
  },
  {
    name: "export-download-expired",
    path: `/app/jobs/exports/${EXPORT_READY_ID}`,
    api: { workspace: { downloadError: "EXPORT_EXPIRED" } },
    act: async (page) => {
      await page.getByRole("button", { name: "Download ZIP" }).click();
      await expect(page.getByTestId("download-problem")).toBeVisible();
    },
  },
  {
    name: "business-log-activity",
    path: `/app/businesses/${BUSINESS_ID}?tab=activities`,
    api: WS,
    act: async (page) => {
      await page
        .getByTestId("activities-tab")
        .getByRole("button", { name: "Log activity" })
        .click();
      const dialog = page.getByTestId("log-activity-dialog");
      await expect(dialog).toBeVisible();
      await dialog.getByRole("button", { name: "Log note" }).click();
      await expect(dialog.locator("[aria-invalid=true]").first()).toBeVisible();
    },
  },
  {
    name: "business-suppression-override",
    path: `/app/businesses/${BUSINESS_ID}?tab=activities`,
    api: { workspace: { contactSuppressed: true } },
    act: async (page) => {
      await page
        .getByTestId("activities-tab")
        .getByRole("button", { name: "Log activity" })
        .click();
      const dialog = page.getByTestId("log-activity-dialog");
      await dialog.getByText("Call", { exact: true }).click();
      await dialog.getByRole("button", { name: "Log call" }).click();
      await expect(dialog.getByTestId("suppression-override")).toBeVisible();
    },
  },
  {
    name: "business-add-to-list",
    path: `/app/businesses/${BUSINESS_ID}`,
    api: WS,
    act: async (page) => {
      await main(page).getByRole("button", { name: "Add to list" }).first().click();
      await expect(page.getByTestId("add-to-list-dialog")).toBeVisible();
    },
  },

  // Phase 6: billing.
  { name: "billing-free-tier", path: "/app/billing", api: { workspace: { subscription: "none" } } },
  {
    name: "billing-test-mode",
    path: "/app/billing?tab=plans",
    api: { workspace: { provider: "test", unpublished: true } },
  },
  {
    name: "billing-not-configured",
    path: "/app/billing?tab=plans",
    api: { workspace: { provider: "none" } },
  },
  {
    name: "billing-not-configured-overview",
    path: "/app/billing",
    api: { workspace: { provider: "none" } },
  },
  {
    name: "billing-pricing-unpublished",
    path: "/app/billing?tab=plans",
    api: { workspace: { unpublished: true } },
  },
  {
    name: "billing-past-due",
    path: "/app/billing",
    api: { workspace: { subscription: "past_due", banners: ["past_due"] } },
  },
  {
    name: "billing-unlinked",
    path: "/app/billing",
    api: { workspace: { subscription: "unlinked" } },
  },
  // Stage 9: an incomplete subscription checkout that can be resumed on Paystack's page.
  {
    name: "billing-pending-resumable",
    path: "/app/billing",
    api: { workspace: { subscription: "none", provider: "test", pendingCheckout: "resumable" } },
  },
  {
    name: "billing-negative-balance",
    path: "/app/billing",
    api: { workspace: { negativeBalance: true, banners: ["negative_balance"] } },
  },
  {
    name: "billing-payments-empty",
    path: "/app/billing?tab=payments",
    api: { workspace: { empty: true } },
  },
  {
    name: "billing-invoices-empty",
    path: "/app/billing?tab=invoices",
    api: { workspace: { empty: true } },
  },
  { name: "billing-forbidden", path: "/app/billing", api: { workspace: { role: "researcher" } } },
  {
    name: "billing-return-forbidden",
    path: `/app/billing/return?reference=${RETURN_REFS.paid}`,
    api: { workspace: { role: "sales_rep" } },
  },
  {
    name: "billing-overview-error",
    path: "/app/billing",
    api: WS,
    fail: [
      {
        path: "/billing/overview",
        status: 500,
        code: "INTERNAL_ERROR",
        message: "Something went wrong",
      },
    ],
  },
  {
    name: "billing-plans-error",
    path: "/app/billing?tab=plans",
    api: WS,
    fail: [
      {
        path: "/billing/plans",
        status: 500,
        code: "INTERNAL_ERROR",
        message: "Something went wrong",
      },
    ],
  },
  {
    name: "billing-cancel-dialog",
    path: "/app/billing",
    api: WS,
    act: async (page) => {
      await main(page).getByRole("button", { name: "Cancel at period end…" }).click();
      await expect(page.getByRole("alertdialog")).toBeVisible();
    },
  },
  {
    name: "billing-resume-dialog",
    path: "/app/billing",
    api: { workspace: { subscription: "cancelling" } },
    act: async (page) => {
      await main(page).getByRole("button", { name: "Resume renewal…" }).click();
      await expect(page.getByRole("alertdialog")).toBeVisible();
    },
  },
  {
    name: "billing-refund-dialog",
    path: "/app/billing?tab=payments",
    api: WS,
    act: async (page) => {
      await main(page).getByTestId("refund-button").first().click();
      await expect(page.getByRole("alertdialog")).toBeVisible();
    },
  },
  {
    name: "billing-refund-invalid",
    path: "/app/billing?tab=payments",
    api: WS,
    act: async (page) => {
      await main(page).getByTestId("refund-button").first().click();
      const dialog = page.getByRole("alertdialog");
      await dialog.getByLabel(/Amount to refund/).fill("999999");
      await expect(dialog.locator("[aria-invalid=true]").first()).toBeVisible();
    },
  },
  {
    name: "billing-checkout-error",
    path: "/app/billing?tab=plans",
    api: { workspace: { checkoutError: "PAYMENT_PROVIDER_ERROR" } },
    act: async (page) => {
      await main(page).getByRole("button", { name: "Buy 500 credits" }).click();
      await expect(page.getByTestId("checkout-problem")).toBeVisible();
    },
  },
  {
    name: "billing-invoice-link-expired",
    path: "/app/billing?downloadError=DOWNLOAD_LINK_EXPIRED",
    api: WS,
    act: async (page) => {
      await expect(page.getByTestId("invoice-link-problem")).toBeVisible();
    },
  },
  {
    name: "billing-return-confirming",
    path: `/app/billing/return?reference=${RETURN_REFS.slow}`,
    api: WS,
    act: async (page) => {
      await expect(page.getByTestId("billing-return")).toHaveAttribute("data-phase", "confirming");
    },
  },
  {
    name: "billing-return-failed",
    path: `/app/billing/return?reference=${RETURN_REFS.failed}`,
    api: WS,
    act: async (page) => {
      await expect(page.getByTestId("billing-return")).toHaveAttribute("data-phase", "failed", {
        timeout: 15_000,
      });
    },
  },
  {
    name: "billing-return-review",
    path: `/app/billing/return?reference=${RETURN_REFS.review}`,
    api: WS,
    act: async (page) => {
      await expect(page.getByTestId("billing-return")).toHaveAttribute(
        "data-phase",
        "under_review",
        { timeout: 15_000 },
      );
    },
  },
  {
    name: "billing-return-not-found",
    path: `/app/billing/return?reference=${RETURN_REFS.unknown}`,
    api: WS,
  },
  { name: "billing-return-missing", path: "/app/billing/return", api: WS },
  {
    name: "billing-banners-owner",
    path: "/app",
    api: { workspace: { banners: ["negative_balance", "past_due", "payment_failed"] } },
    act: async (page) => {
      await expect(page.getByTestId("billing-banners")).toBeVisible();
    },
  },
  {
    name: "billing-banners-researcher",
    path: "/app/businesses",
    api: { workspace: { role: "researcher", banners: ["negative_balance"] } },
    act: async (page) => {
      await expect(page.getByTestId("billing-banners")).toBeVisible();
    },
  },
  {
    name: "invite-member-limit",
    path: "/app/team",
    api: { workspace: { memberLimit: true } },
    act: async (page) => {
      await main(page).getByRole("button", { name: "Invite member" }).click();
      const dialog = page.getByRole("dialog");
      await dialog.getByLabel(/Email/).fill("new.person@example.test");
      await dialog.getByRole("button", { name: "Send invitation" }).click();
      await expect(dialog.getByTestId("member-limit")).toBeVisible();
    },
  },
  {
    name: "discovery-billing-blockers",
    path: "/app/discovery/new",
    api: { workspace: { estimate: "billing" } },
    act: async (page) => {
      await walkWizardToEstimate(page);
      await expect(page.getByTestId("billing-block").first()).toBeVisible();
    },
  },
  {
    name: "sign-in-account-paused",
    path: "/sign-in",
    api: "auth",
    fail: [
      {
        method: "POST",
        path: "/auth/login",
        status: 429,
        code: "RATE_LIMITED",
        message: "Too many failed sign-in attempts for this account. Try again in 15 minutes.",
      },
    ],
    act: async (page) => {
      await page.getByLabel("Email").fill("owner@example.test");
      await page.locator("#si-password").fill("wrong-password-1");
      await page.getByRole("button", { name: "Sign in", exact: true }).click();
      await expect(page.getByTestId("sign-in-error")).toBeVisible();
    },
  },

  // Stage 8: every role reads every list; reps start on "My lists" and can clear it.
  { name: "lists-sales-rep", path: "/app/lists", api: { workspace: { role: "sales_rep" } } },
  {
    name: "lists-sales-rep-all",
    path: "/app/lists?owner=all",
    api: { workspace: { role: "sales_rep" } },
  },

  // Phase 6 follow-ups: pipeline stages, lead details, outreach next attempt.
  {
    name: "pipeline-stages-read-only",
    path: "/app/settings?tab=pipeline",
    api: { workspace: { role: "analyst" } },
  },
  {
    name: "pipeline-stages-edited",
    path: "/app/settings?tab=pipeline",
    api: WS,
    act: async (page) => {
      await main(page).getByRole("button", { name: "Add stage" }).click();
      await main(page).getByRole("button", { name: "Archive Interested" }).click();
      await expect(main(page).getByText("New, not saved")).toBeVisible();
    },
  },
  {
    name: "pipeline-stages-invalid",
    path: "/app/settings?tab=pipeline",
    api: WS,
    act: async (page) => {
      await main(page).getByLabel("Stage 1 name").fill("");
      await expect(main(page).locator("[aria-invalid=true]").first()).toBeVisible();
    },
  },
  {
    name: "pipeline-stages-conflict",
    path: "/app/settings?tab=pipeline",
    api: { workspace: { configConflict: true } },
    act: async (page) => {
      await main(page).getByLabel("Stage 1 name").fill("Inbox");
      await main(page).getByRole("button", { name: "Save stages" }).click();
      await expect(page.getByTestId("stages-notice")).toBeVisible();
    },
  },
  {
    name: "pipeline-stages-not-empty",
    path: "/app/settings?tab=pipeline",
    api: WS,
    act: async (page) => {
      await main(page).getByRole("button", { name: "Archive Contacted" }).click();
      await main(page).getByRole("button", { name: "Save stages" }).click();
      await expect(page.getByTestId("stages-notice")).toBeVisible();
    },
  },
  {
    name: "lead-details-dialog",
    path: `/app/businesses/${BUSINESS_ID}`,
    api: WS,
    act: async (page) => {
      await main(page)
        .getByTestId("lead-panel")
        .getByRole("button", { name: "Edit details…" })
        .click();
      await expect(page.getByTestId("lead-details-dialog")).toBeVisible();
    },
  },
  {
    name: "lead-details-conflict",
    path: `/app/businesses/${BUSINESS_ID}`,
    api: { workspace: { leadConflict: true } },
    act: async (page) => {
      await main(page)
        .getByTestId("lead-panel")
        .getByRole("button", { name: "Edit details…" })
        .click();
      const dialog = page.getByTestId("lead-details-dialog");
      await dialog.getByLabel("Next action").fill("2026-11-02T10:30");
      await dialog.getByRole("button", { name: "Save details" }).click();
      await expect(dialog.getByTestId("lead-changed")).toBeVisible();
    },
  },
  {
    name: "pipeline-card-menu-details",
    path: "/app/pipeline?stage=won",
    api: WS,
    act: async (page) => {
      await main(page).getByTestId("card-follow-up").first().click();
      await expect(page.getByTestId("lead-details-dialog")).toBeVisible();
    },
  },
  {
    name: "outreach-next-attempt",
    path: "/app/outreach",
    api: WS,
    act: async (page) => {
      await main(page)
        .getByRole("button", { name: /^Next attempt/ })
        .first()
        .click();
      await expect(page.getByTestId("next-attempt-dialog")).toBeVisible();
    },
  },

  // Stage 10: organization data export and the deletion workflow (Settings, Organization).
  {
    name: "org-deletion-banner-owner",
    path: "/app",
    api: { workspace: { orgDeletion: "pending" } },
    act: async (page) => {
      await expect(page.getByTestId("org-deletion-banner")).toBeVisible();
    },
  },
  {
    name: "org-deletion-banner-member",
    path: "/app/businesses",
    api: { workspace: { orgDeletion: "pending", role: "researcher" } },
    act: async (page) => {
      await expect(page.getByTestId("org-deletion-banner")).toHaveAttribute(
        "data-audience",
        "member",
      );
    },
  },
  {
    name: "org-settings-pending-owner",
    path: "/app/settings?tab=organization",
    api: { workspace: { orgDeletion: "pending", orgExport: "completed" } },
    act: async (page) => {
      await expect(page.getByTestId("org-deletion-pending")).toBeVisible();
    },
  },
  {
    name: "org-settings-pending-member",
    path: "/app/settings?tab=organization",
    api: { workspace: { orgDeletion: "pending", role: "analyst" } },
    act: async (page) => {
      await expect(page.getByTestId("org-export-owners-only")).toBeVisible();
      await expect(page.getByTestId("org-deletion-pending")).toBeVisible();
    },
  },
  {
    name: "org-settings-admin",
    path: "/app/settings?tab=organization",
    api: { workspace: { role: "admin" } },
    act: async (page) => {
      await expect(page.getByTestId("org-delete-owners-only")).toBeVisible();
    },
  },
  {
    name: "org-export-none",
    path: "/app/settings?tab=organization",
    api: WS,
    act: async (page) => {
      await expect(page.getByTestId("org-export")).toHaveAttribute("data-state", "none");
    },
  },
  {
    name: "org-export-running",
    path: "/app/settings?tab=organization",
    api: { workspace: { orgExport: "running" } },
    act: async (page) => {
      await expect(page.getByTestId("org-export")).toHaveAttribute("data-state", "running");
    },
  },
  {
    name: "org-export-failed",
    path: "/app/settings?tab=organization",
    api: { workspace: { orgExport: "failed" } },
    act: async (page) => {
      await expect(page.getByTestId("org-export-failed")).toBeVisible();
    },
  },
  {
    name: "org-export-expired",
    path: "/app/settings?tab=organization",
    api: { workspace: { orgExport: "expired" } },
    act: async (page) => {
      await expect(page.getByTestId("org-export-expired")).toBeVisible();
    },
  },
  {
    name: "org-export-conflict",
    path: "/app/settings?tab=organization",
    api: { workspace: { orgExportConflict: true } },
    act: async (page) => {
      await main(page).getByTestId("org-export-request").click();
      await expect(page.getByTestId("org-export-conflict")).toBeVisible();
    },
  },
  {
    name: "org-export-link-expired",
    path: "/app/settings?tab=organization&downloadError=DOWNLOAD_LINK_EXPIRED",
    api: { workspace: { orgExport: "completed" } },
    act: async (page) => {
      await expect(page.getByTestId("org-export-link-problem")).toBeVisible();
    },
  },
  {
    name: "org-export-list-error",
    path: "/app/settings?tab=organization",
    api: WS,
    fail: [
      {
        path: "/organizations/current/data-exports",
        status: 500,
        code: "INTERNAL_ERROR",
        message: "Something went wrong",
      },
    ],
    act: async (page) => {
      await expect(page.getByTestId("org-export")).toHaveAttribute("data-state", "error");
    },
  },
  {
    name: "org-delete-dialog",
    path: "/app/settings?tab=organization",
    api: WS,
    act: async (page) => {
      await main(page).getByTestId("org-delete-open").click();
      await expect(page.getByTestId("delete-org-dialog")).toBeVisible();
    },
  },
  {
    name: "org-delete-dialog-invalid",
    path: "/app/settings?tab=organization",
    api: WS,
    act: async (page) => {
      await main(page).getByTestId("org-delete-open").click();
      const dialog = page.getByTestId("delete-org-dialog");
      await dialog.getByTestId("delete-org-submit").click();
      await expect(dialog.locator("[aria-invalid=true]").first()).toBeVisible();
    },
  },
  {
    name: "org-delete-dialog-wrong-password",
    path: "/app/settings?tab=organization",
    api: WS,
    act: async (page) => {
      await main(page).getByTestId("org-delete-open").click();
      const dialog = page.getByTestId("delete-org-dialog");
      await dialog.getByLabel("Organization name").fill("Sample Logistics Ltd (Sample)");
      await dialog.getByLabel("Your current password").fill("not-the-password");
      await dialog.getByTestId("delete-org-submit").click();
      await expect(dialog.getByLabel("Your current password")).toHaveAttribute(
        "aria-invalid",
        "true",
      );
    },
  },
  {
    name: "org-delete-dialog-rate-limited",
    path: "/app/settings?tab=organization",
    api: { workspace: { orgDeletionError: "rate" } },
    act: async (page) => {
      await main(page).getByTestId("org-delete-open").click();
      const dialog = page.getByTestId("delete-org-dialog");
      await dialog.getByLabel("Organization name").fill("Sample Logistics Ltd (Sample)");
      await dialog.getByLabel("Your current password").fill("synthetic-owner-pass-2026");
      await dialog.getByTestId("delete-org-submit").click();
      await expect(dialog.getByTestId("delete-org-rate-limited")).toBeVisible();
    },
  },
  {
    name: "org-cancel-deletion-confirm",
    path: "/app/settings?tab=organization",
    api: { workspace: { orgDeletion: "pending" } },
    act: async (page) => {
      await main(page).getByTestId("org-deletion-cancel").click();
      await expect(
        page.getByRole("alertdialog", { name: "Cancel the scheduled deletion?" }),
      ).toBeVisible();
    },
  },
  {
    name: "pending-deletion-invite",
    path: "/app/team",
    api: { workspace: { orgDeletion: "pending" } },
    act: async (page) => {
      await main(page).getByRole("button", { name: "Invite member" }).click();
      const dialog = page.getByRole("dialog");
      await dialog.getByLabel(/Email/).fill("new.person@example.test");
      await dialog.getByRole("button", { name: "Send invitation" }).click();
      await expect(dialog.getByTestId("pending-deletion-block")).toBeVisible();
    },
  },
  {
    name: "pending-deletion-checkout",
    path: "/app/billing?tab=plans",
    api: { workspace: { orgDeletion: "pending" } },
    act: async (page) => {
      await main(page).getByRole("button", { name: "Buy 500 credits" }).click();
      await expect(page.getByTestId("checkout-problem")).toBeVisible();
    },
  },
  {
    name: "pending-deletion-discovery",
    path: "/app/discovery/new",
    api: { workspace: { orgDeletion: "pending" } },
    act: async (page) => {
      await walkWizardToEstimate(page);
      await page.getByRole("button", { name: /Continue/ }).click();
      await expect(page.getByRole("heading", { name: "Review and create" })).toBeVisible();
      await page.getByRole("button", { name: /Create discovery job/ }).click();
      await expect(page.getByTestId("pending-deletion-block")).toBeVisible();
    },
  },
];

/** Every plain route as a scenario, then every state. */
export function allScenarios(): (A11yScenario & { group: string })[] {
  const plain = Object.entries(ROUTE_GROUPS).flatMap(([group, { routes, api }]) =>
    routes.map((path) => ({ group, name: `${group} ${path}`, path, api })),
  );
  return [...plain, ...STATE_SCENARIOS.map((s) => ({ ...s, group: "states" }))];
}

/** A RegExp, or a string for an exact path (after /api/v1). */
export function matchesPath(pattern: RegExp | string, path: string): boolean {
  return typeof pattern === "string" ? pattern === path : pattern.test(path);
}

function json(route: Route, status: number, body: unknown) {
  return route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
}

/** Installs the scenario's API mocks and failures. */
export async function prepareApi(page: Page, s: A11yScenario): Promise<void> {
  if (s.api === "auth") await mockMissingInvitation(page);
  else if (s.api !== "unreachable") await mockWorkspaceApi(page, s.api.workspace);
  if (s.fail?.length) {
    const fails = s.fail;
    await page.route("**/api/v1/**", (route) => {
      const url = new URL(route.request().url());
      const path = url.pathname.replace(/^\/api\/v1/, "");
      const method = route.request().method();
      const f = fails.find((x) => matchesPath(x.path, path) && (x.method ?? "GET") === method);
      if (!f) return route.fallback();
      return json(route, f.status, errorBody(f.code, f.message));
    });
  }
}

/** Opens the scenario: mocks, navigation, first paint, then its interaction. */
export async function openScenario(page: Page, s: A11yScenario): Promise<void> {
  await prepareApi(page, s);
  await page.goto(s.path);
  // First paint can wait on retried requests (the API-unreachable shell retries /auth/me once
  // with a backoff), which takes several seconds on a loaded machine.
  if (s.hasH1 === false) {
    await expect(page.locator("#main")).toBeVisible({ timeout: 15_000 });
  } else {
    await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible({ timeout: 15_000 });
  }
  await page.waitForLoadState("networkidle").catch(() => undefined);
  if (s.act) await s.act(page);
}

/**
 * Dashboard pages and their primary data request, for the loading / empty / error / success audit
 * (a11y-states.spec.ts). Later phases add their pages here.
 */
export interface StateAudit {
  path: string;
  /** The page's primary data request (path after /api/v1, GET): a RegExp or an exact path. */
  endpoint: RegExp | string;
  /**
   * Methods of the primary request(s); default GET. The billing return page's first request is
   * POST …/verify, then GETs of the payment, so its audit holds and fails both.
   */
  methods?: readonly string[];
  /** Empty-state heading with the `empty` fixture; omitted for single-resource pages. */
  empty?: string;
  /** Body for the endpoint in the empty test, when the `empty` fixture does not cover it. */
  emptyBody?: unknown;
}

export const STATE_AUDIT: StateAudit[] = [
  { path: "/app", endpoint: /^\/reports\/overview$/, empty: "No businesses yet" },
  { path: "/app/businesses", endpoint: /^\/businesses$/, empty: "No businesses yet" },
  { path: `/app/businesses/${BUSINESS_ID}`, endpoint: `/businesses/${BUSINESS_ID}` },
  {
    path: "/app/businesses/import",
    endpoint: /^\/imports$/,
    empty: "No imports yet",
    emptyBody: { data: [], meta: { nextCursor: null, pageSize: 10 } },
  },
  {
    path: "/app/businesses/duplicates",
    endpoint: /^\/dedup\/candidates$/,
    empty: "Nothing to review",
  },
  {
    path: `/app/businesses/duplicates/${CANDIDATE_ID}`,
    endpoint: `/dedup/candidates/${CANDIDATE_ID}`,
  },
  { path: "/app/discovery", endpoint: /^\/discovery\/jobs$/, empty: "No discovery jobs yet" },
  { path: "/app/discovery/new", endpoint: /^\/discovery\/sources$/ },
  { path: `/app/discovery/${RUNNING_JOB_ID}`, endpoint: `/discovery/jobs/${RUNNING_JOB_ID}` },
  { path: "/app/jobs", endpoint: /^\/jobs$/, empty: "No background jobs yet" },
  { path: "/app/usage", endpoint: /^\/credits\/ledger$/, empty: "No credit activity yet" },
  { path: "/app/analysis", endpoint: /^\/analysis\/websites$/, empty: "No website analyses yet" },
  { path: "/app/sources", endpoint: /^\/sources$/ },
  { path: "/app/team", endpoint: /^\/organizations\/current\/members$/ },
  { path: "/app/settings", endpoint: /^\/organizations\/current$/ },
  { path: "/app/settings?tab=security", endpoint: /^\/auth\/sessions$/ },
  { path: "/app/settings?tab=notifications", endpoint: /^\/notifications\/preferences$/ },
  { path: "/app/settings?tab=scoring", endpoint: /^\/scoring\/profile$/ },
  { path: "/app/pipeline", endpoint: /^\/pipeline\/board$/, empty: "No leads in the pipeline yet" },
  { path: "/app/lists", endpoint: /^\/lists$/, empty: "No lead lists yet" },
  { path: `/app/lists/${LIST_ID}`, endpoint: `/lists/${LIST_ID}` },
  { path: "/app/activities", endpoint: /^\/activities$/, empty: "No activity yet" },
  { path: "/app/outreach", endpoint: /^\/outreach$/, empty: "No outreach yet" },
  { path: "/app/reports", endpoint: /^\/reports\/quality-distribution$/ },
  { path: `/app/jobs/bulk/${BULK_DONE_ID}`, endpoint: `/bulk-operations/${BULK_DONE_ID}` },
  { path: `/app/jobs/exports/${EXPORT_READY_ID}`, endpoint: `/exports/${EXPORT_READY_ID}` },
  {
    path: `/app/businesses/${BUSINESS_ID}?tab=activities`,
    endpoint: /^\/activities$/,
    empty: "No activity yet",
  },
  { path: "/app/billing", endpoint: /^\/billing\/overview$/ },
  { path: "/app/billing?tab=plans", endpoint: /^\/billing\/plans$/ },
  {
    path: "/app/billing?tab=payments",
    endpoint: /^\/billing\/payments$/,
    empty: "No payments yet",
  },
  {
    path: "/app/billing?tab=invoices",
    endpoint: /^\/billing\/invoices$/,
    empty: "No invoices yet",
  },
  {
    path: `/app/billing/return?reference=${RETURN_REFS.paid}`,
    endpoint: /^\/billing\/payments\/lf-e2e-paid(\/verify)?$/,
    methods: ["GET", "POST"],
  },
  { path: "/app/settings?tab=pipeline", endpoint: /^\/pipeline\/config$/ },
  // Stage 10: the organization data exports in Settings, Organization ("Data and deletion").
  { path: "/app/settings?tab=organization", endpoint: /^\/organizations\/current\/data-exports$/ },
];
