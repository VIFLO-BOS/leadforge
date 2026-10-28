import { expect, test, type Page, type Route } from "@playwright/test";
import { BUSINESS_ID, ME, UPLOADED_IMPORT_ID, mockWorkspaceApi } from "./fixtures";
import { UPLOADED_IMPORT } from "./fixtures-businesses";
import { CANDIDATE_ID } from "./fixtures-phase4";
import { BULK_DONE_ID, EXPORT_READY_ID, LIST_ID } from "./fixtures-phase5";
import {
  expectEscapeRestores,
  expectFocusTrapped,
  expectFocusVisible,
  expectFocusWithin,
  focusInfo,
  pressKey,
  replaceValue,
  tabSequence,
  tabTo,
} from "./keyboard-helpers";

/*
 * Keyboard-only flows (PRODUCT_REQUIREMENTS section 10: keyboard-only traversal of every dashboard
 * page). No mouse anywhere: every step is Tab, Shift+Tab, arrows, Enter, Space or Escape. Each Tab
 * stop must show a visible focus indicator; dialogs, sheets and popovers must take focus, trap it
 * where modal, close on Escape and give focus back to their trigger.
 *
 * Runs at 1440 (rail, popovers, table) and 375 (drawer, sheets, cards); other projects skip.
 * Dashboard routes for the generic traversal check come from KEYBOARD_ROUTES below; add new
 * pages there.
 */

const PROJECTS = new Set(["w375", "w1440"]);

test.describe.configure({ timeout: 120_000 });
test.beforeEach(() => {
  test.skip(!PROJECTS.has(test.info().project.name), "keyboard flows run at 375 and 1440");
});

const wide = (page: Page) => (page.viewportSize()?.width ?? 0) >= 1024;
const main = (page: Page) => page.locator("#main");

function json(route: Route, status: number, body: unknown) {
  return route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
}

/** Every page of each layout starts with a skip link that moves the Tab sequence into #main. */
const SKIP_LINK_ROUTES = [
  { path: "/", mock: false },
  { path: "/legal/privacy", mock: false },
  { path: "/sign-in", mock: false },
  { path: "/app", mock: true },
  { path: "/app/businesses", mock: true },
  { path: "/this-page-does-not-exist", mock: false },
] as const;

/**
 * Dashboard pages that must be traversable end to end by keyboard: every Tab stop shows a focus
 * indicator and the sequence moves banner -> navigation -> main without jumping back. Later
 * phases add their routes here.
 */
export const KEYBOARD_ROUTES = [
  "/app",
  "/app/businesses",
  `/app/businesses/${BUSINESS_ID}`,
  "/app/businesses/import",
  "/app/businesses/duplicates",
  `/app/businesses/duplicates/${CANDIDATE_ID}`,
  "/app/discovery",
  "/app/discovery/new",
  "/app/jobs",
  "/app/usage",
  "/app/analysis",
  "/app/sources",
  "/app/team",
  "/app/settings",
  "/app/settings?tab=scoring",
  "/app/pipeline",
  "/app/lists",
  `/app/lists/${LIST_ID}`,
  "/app/activities",
  "/app/outreach",
  "/app/reports",
  `/app/jobs/bulk/${BULK_DONE_ID}`,
  `/app/jobs/exports/${EXPORT_READY_ID}`,
  `/app/businesses/${BUSINESS_ID}?tab=activities`,
  "/app/billing",
  "/app/billing?tab=plans",
  "/app/billing?tab=payments",
  "/app/billing?tab=invoices",
  "/app/billing/return?reference=lf-e2e-paid",
  "/app/settings?tab=pipeline",
  "/app/settings?tab=organization",
] as const;

test.describe("skip link", () => {
  for (const r of SKIP_LINK_ROUTES) {
    test(`skip link on ${r.path}`, async ({ page }) => {
      if (r.mock) await mockWorkspaceApi(page);
      await page.goto(r.path);
      await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible();
      await page.keyboard.press("Tab");
      const skip = page.getByRole("link", { name: "Skip to content" });
      await expect(skip).toBeFocused();
      await expect(skip).toBeInViewport();
      await expectFocusVisible(page, "skip link");
      await page.keyboard.press("Enter");
      await page.keyboard.press("Tab");
      const inMain = await page.evaluate(() => Boolean(document.activeElement?.closest("#main")));
      const info = await focusInfo(page);
      expect(
        inMain,
        `after the skip link, Tab went to <${info.tag}> "${info.name}" outside #main`,
      ).toBe(true);
    });
  }
});

test.describe("sign in", () => {
  test("signs in with the keyboard only", async ({ page }) => {
    let signedIn = false;
    await mockWorkspaceApi(page);
    await page.route("**/api/v1/auth/me", (route) =>
      signedIn
        ? route.fallback()
        : json(route, 401, {
            error: { code: "UNAUTHENTICATED", message: "Sign in required", requestId: "e2e" },
          }),
    );
    await page.route("**/api/v1/auth/login", (route) => {
      signedIn = true;
      return json(route, 200, { data: { user: ME.user } });
    });
    await page.goto("/sign-in");
    await expect(page.getByRole("heading", { level: 1, name: "Sign in" })).toBeVisible();
    // Submitting empty shows linked errors and keeps focus usable.
    await tabTo(page, page.getByRole("button", { name: "Sign in", exact: true }));
    await page.keyboard.press("Enter");
    const email = page.getByLabel("Email");
    await expect(email).toHaveAttribute("aria-invalid", "true");
    const described = await email.getAttribute("aria-describedby");
    expect(described).toBeTruthy();
    await expect(page.locator(`#${described}`)).not.toBeEmpty();

    await tabTo(page, email, { reverse: true });
    await page.keyboard.type("owner@example.test");
    await page.keyboard.press("Tab");
    await expect(page.locator("#si-password")).toBeFocused();
    await page.keyboard.type("synthetic-owner-pass-2026");
    await page.keyboard.press("Enter");
    await page.waitForURL(/\/app$/);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  });
});

test.describe("dashboard shell", () => {
  test("tab order runs banner, navigation, main with a visible focus at every stop", async ({
    page,
  }) => {
    await mockWorkspaceApi(page);
    await page.goto("/app");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await page.waitForLoadState("networkidle");
    const seq = await tabSequence(page, wide(page) ? 40 : 20);
    const order = ["skip", "header", "nav", "main"];
    let last = 0;
    for (const [i, stop] of seq.entries()) {
      expect(stop.ok, `stop ${i + 1} <${stop.tag}> "${stop.name}": ${stop.why}`).toBe(true);
      const idx = order.indexOf(stop.landmark);
      if (idx < 0) continue;
      expect(
        idx,
        `stop ${i + 1} "${stop.name}" in ${stop.landmark} after ${order[last]}`,
      ).toBeGreaterThanOrEqual(last);
      last = idx;
    }
    expect(
      seq.some((s) => s.landmark === "main"),
      "Tab reaches the main content",
    ).toBe(true);
  });

  test("navigation drawer (narrow) traps focus, closes on Escape and restores focus", async ({
    page,
  }) => {
    test.skip(wide(page), "the drawer is a modal sheet below 1024px");
    await mockWorkspaceApi(page);
    await page.goto("/app");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    const trigger = page.getByRole("button", { name: "Open navigation" });
    await tabTo(page, trigger);
    await page.keyboard.press("Enter");
    const drawer = page.getByRole("dialog", { name: "Navigation" });
    await expect(drawer).toBeVisible();
    await expectFocusWithin(drawer);
    await expectFocusTrapped(page, drawer, 30);
    await expectEscapeRestores(page, drawer, trigger);
    // Navigate with the keyboard: open, Tab to a destination, Enter.
    await page.keyboard.press("Enter");
    await expect(drawer).toBeVisible();
    await tabTo(page, drawer.getByRole("link", { name: /^Businesses/ }));
    await page.keyboard.press("Enter");
    await page.waitForURL(/\/app\/businesses$/);
    await expect(drawer).toBeHidden();
  });

  test("navigation rail (wide) collapses and still navigates", async ({ page }) => {
    test.skip(!wide(page), "the rail exists from 1024px");
    await mockWorkspaceApi(page);
    await page.goto("/app");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    const toggle = page.getByRole("button", { name: "Collapse navigation" });
    await tabTo(page, toggle);
    await page.keyboard.press("Enter");
    const expand = page.getByRole("button", { name: "Expand navigation" });
    await expect(expand).toHaveAttribute("aria-expanded", "false");
    await expect(expand).toBeFocused();
    const nav = page.getByRole("navigation", { name: "Dashboard" });
    await tabTo(page, nav.getByRole("link", { name: "Businesses", exact: true }));
    await page.keyboard.press("Enter");
    await page.waitForURL(/\/app\/businesses$/);
  });

  test("org switcher and account menu: arrows, Escape, focus back to the trigger", async ({
    page,
  }) => {
    await mockWorkspaceApi(page);
    await page.goto("/app");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    for (const name of [/Switch organization/, /Account menu/]) {
      const trigger = page.getByRole("button", { name });
      await tabTo(page, trigger);
      await page.keyboard.press("Enter");
      const menu = page.getByRole("menu");
      await expect(menu).toBeVisible();
      await expectFocusWithin(menu);
      await page.keyboard.press("ArrowDown");
      await expectFocusWithin(menu);
      await expectFocusVisible(page, "menu item");
      await expectEscapeRestores(page, menu, trigger);
    }
  });

  test("notifications open from the bell, take focus, close on Escape", async ({ page }) => {
    await mockWorkspaceApi(page);
    await page.goto("/app");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    const bell = page.getByRole("button", { name: /^Notifications, 2 unread/ });
    await tabTo(page, bell);
    await page.keyboard.press("Enter");
    const panel = page.getByTestId("notification-panel");
    await expect(panel).toBeVisible();
    await expectFocusWithin(page.locator("[role=dialog]").filter({ has: panel }));
    if (!((page.viewportSize()?.width ?? 0) >= 480)) {
      await expectFocusTrapped(page, page.getByRole("dialog", { name: "Notifications" }), 10);
    }
    await tabTo(page, panel.getByRole("button", { name: /Mark all read/ }));
    await expectEscapeRestores(page, panel, bell);
  });

  test("page search: type, arrow to a destination, Enter", async ({ page }) => {
    test.skip((page.viewportSize()?.width ?? 0) < 768, "the search field shows from 768px");
    await mockWorkspaceApi(page);
    await page.goto("/app");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    const search = page.getByRole("combobox", { name: "Search pages and settings" });
    await tabTo(page, search);
    await page.keyboard.type("usage");
    await expect(page.getByRole("listbox", { name: "Destinations" })).toBeVisible();
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Enter");
    await page.waitForURL(/\/app\/usage/);
  });
});

test.describe("business directory", () => {
  test("search, filter chip, sort, select, bulk action, pagination", async ({ page }) => {
    await mockWorkspaceApi(page);
    await page.goto("/app/businesses");
    await expect(
      main(page).getByRole("link", { name: "Mama Put Kitchen (Sample)" }).first(),
    ).toBeVisible();

    // Search.
    const search = page.getByRole("searchbox", { name: "Search businesses" });
    await tabTo(page, search);
    await page.keyboard.type("mama");
    await expect(page).toHaveURL(/q=mama/);

    // Filter: a chip menu from 768px, a modal sheet of fields below.
    if ((page.viewportSize()?.width ?? 0) >= 768) {
      const chip = page.getByRole("button", { name: "Region", exact: true });
      await tabTo(page, chip);
      await page.keyboard.press("Enter");
      const menu = page.getByRole("menu", { name: "Region" });
      await expect(menu).toBeVisible();
      await expectFocusWithin(menu);
      await page.keyboard.press("ArrowDown");
      await page.keyboard.press("Space");
      await expect(page).toHaveURL(/region=/);
      await page.keyboard.press("Escape");
      await expect(menu).toBeHidden();
      await expect(page.getByRole("button", { name: /^Region:/ })).toBeFocused();
    } else {
      const open = page.getByRole("button", { name: /^Filters/ });
      await tabTo(page, open);
      await page.keyboard.press("Enter");
      const sheet = page.getByRole("dialog");
      await expect(sheet).toBeVisible();
      await expectFocusWithin(sheet);
      await expectFocusTrapped(page, sheet, 15);
      await expectEscapeRestores(page, sheet, open);
    }

    // Sort (the table from 480px; cards below have no column headers).
    if ((page.viewportSize()?.width ?? 0) >= 480) {
      const sort = page
        .getByRole("table", { name: "Businesses" })
        .getByRole("button", { name: "Fit", exact: true });
      await tabTo(page, sort, { max: 120 });
      await page.keyboard.press("Enter");
      await expect(page).toHaveURL(/sort=fit/);
      await expect(sort).toBeFocused();
    }

    // Row selection and a bulk action with a typed-phrase confirmation.
    const row = page.getByRole("checkbox", { name: "Select row 1" });
    await tabTo(page, row, { max: 120 });
    await page.keyboard.press("Space");
    await expect(row).toBeChecked();
    await expect(page.getByRole("region", { name: "Bulk actions" })).toContainText("1 selected");
    const suppress = page.getByRole("button", { name: "Suppress", exact: true });
    await tabTo(page, suppress, { reverse: true });
    await page.keyboard.press("Enter");
    const confirm = page.getByRole("alertdialog");
    await expect(confirm).toBeVisible();
    await expectFocusWithin(confirm);
    await expectFocusTrapped(page, confirm);
    await expectEscapeRestores(page, confirm, suppress);

    // Pagination.
    const nextPage = page.getByRole("button", { name: "Next", exact: true });
    await tabTo(page, nextPage, { max: 160 });
    const request = page.waitForRequest(
      (r) => r.url().includes("/api/v1/businesses?") && r.url().includes("cursor="),
    );
    await page.keyboard.press("Enter");
    await request;
    await expect(page.getByRole("button", { name: "Previous", exact: true })).toBeEnabled();
  });
});

test.describe("business detail", () => {
  test("tabs move with arrow keys; the corrections dialog traps and restores focus", async ({
    page,
  }) => {
    await mockWorkspaceApi(page);
    await page.goto(`/app/businesses/${BUSINESS_ID}`);
    await expect(
      page.getByRole("heading", { level: 1, name: "Mama Put Kitchen (Sample)" }),
    ).toBeVisible();

    const overview = page.getByRole("tab", { name: "Overview" });
    await tabTo(page, overview, { max: 60 });
    await page.keyboard.press("ArrowRight");
    const provenance = page.getByRole("tab", { name: /Provenance/ });
    await expect(provenance).toBeFocused();
    await expect(provenance).toHaveAttribute("aria-selected", "true");
    await expect(page).toHaveURL(/tab=provenance/);
    await expectFocusVisible(page, "tab");
    await page.keyboard.press("Home");
    await expect(overview).toBeFocused();
    await expect(overview).toHaveAttribute("aria-selected", "true");

    const correct = page.getByRole("button", { name: "Correct details" });
    await tabTo(page, correct, { reverse: true, max: 60 });
    await page.keyboard.press("Enter");
    const dialog = page.getByRole("dialog", { name: "Correct details" });
    await expect(dialog).toBeVisible();
    await expectFocusWithin(dialog);
    await expectFocusTrapped(page, dialog, 20);
    await expectEscapeRestores(page, dialog, correct);
  });
});

test.describe("CSV import wizard", () => {
  test("choose a file, map a column, check rows, with focus following each step", async ({
    page,
  }) => {
    await mockWorkspaceApi(page);
    await page.route("**/api/v1/imports", (route) =>
      route.request().method() === "POST"
        ? json(route, 201, { data: UPLOADED_IMPORT })
        : route.fallback(),
    );
    await page.goto("/app/businesses/import");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    const choose = page.getByRole("button", { name: "Choose a CSV file" });
    await tabTo(page, choose);
    const chooser = page.waitForEvent("filechooser", { timeout: 20_000 });
    await page.keyboard.press("Enter");
    await (
      await chooser
    ).setFiles({
      name: "businesses.csv",
      mimeType: "text/csv",
      buffer: Buffer.from("Business Name,Phone\nMama Put (Sample),08031234567\n"),
    });
    await page.waitForURL((url) => url.searchParams.get("id") === UPLOADED_IMPORT_ID);
    const mapping = page.getByRole("heading", { name: "Map columns to business fields" });
    await expect(mapping).toBeFocused();

    const select = page.getByRole("combobox", { name: /Import “Phone” as/ });
    await tabTo(page, select, { max: 60 });
    await page.keyboard.press("Enter");
    const listbox = page.getByRole("listbox");
    await expect(listbox).toBeVisible();
    await expectFocusWithin(listbox);
    await expectEscapeRestores(page, listbox, select);

    await tabTo(page, page.getByRole("button", { name: "Check rows" }), { max: 80 });
    await page.keyboard.press("Enter");
    await expect(page.getByRole("heading", { name: "Check rows before importing" })).toBeFocused();
    const attest = page.getByRole("checkbox").first();
    await tabTo(page, attest, { max: 80 });
  });
});

test.describe("discovery wizard", () => {
  test("walks to the review step with the keyboard; focus moves to each step's heading", async ({
    page,
  }) => {
    await mockWorkspaceApi(page);
    await page.goto("/app/discovery/new");
    await expect(page.getByText("Choose where to search")).toBeVisible();
    const cont = page.getByRole("button", { name: /Continue/ });

    await tabTo(page, cont, { max: 60 });
    await page.keyboard.press("Enter");
    await expect(page.getByRole("heading", { name: "What to find, and where" })).toBeFocused();

    // Continue without a category: the error is announced and focus goes to the field.
    await tabTo(page, cont, { max: 80 });
    await page.keyboard.press("Enter");
    await expect(page.getByText("Add at least one category or keyword.")).toBeVisible();
    const category = page.getByLabel("Category");
    await expect(category).toBeFocused();
    await expect(category).toHaveAttribute("aria-invalid", "true");
    await page.keyboard.type("Pharmacy");
    await page.keyboard.press("Enter");
    await expect(page.getByRole("list", { name: "Categories to search" })).toContainText(
      "Pharmacy",
    );
    await tabTo(page, page.getByLabel("City or town"), { max: 40 });
    await page.keyboard.type("Ikeja");

    await tabTo(page, cont, { max: 80 });
    await page.keyboard.press("Enter");
    await expect(page.getByRole("heading", { name: "Set limits" })).toBeFocused();
    await tabTo(page, page.getByRole("radio", { checked: true }).first(), { max: 40 });
    await tabTo(page, cont, { max: 80 });
    await page.keyboard.press("Enter");
    await expect(page.getByRole("heading", { name: "Check the estimate" })).toBeFocused();
    await expect(page.getByTestId("estimate")).toContainText("Credits held");
    await tabTo(page, cont, { max: 80 });
    await page.keyboard.press("Enter");
    await expect(page.getByRole("heading", { name: "Review and create" })).toBeFocused();
    await tabTo(page, page.getByRole("button", { name: "Create discovery job" }), { max: 80 });
  });
});

test.describe("duplicate review", () => {
  test("the merge dialog: focus, radios with arrows, trap, Escape, then merge", async ({
    page,
  }) => {
    await mockWorkspaceApi(page);
    await page.goto(`/app/businesses/duplicates/${CANDIDATE_ID}`);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    const open = page.getByRole("button", { name: /^Merge/ });
    await tabTo(page, open, { max: 60 });
    await page.keyboard.press("Enter");
    const dialog = page.getByTestId("merge-dialog");
    await expect(dialog).toBeVisible();
    await expectFocusWithin(dialog);
    await expectFocusTrapped(page, dialog, 15);
    await expectEscapeRestores(page, dialog, open);

    await page.keyboard.press("Enter");
    await expect(dialog).toBeVisible();
    const group = dialog.getByRole("radiogroup", { name: "Surviving record" });
    await tabTo(page, group.getByRole("radio", { checked: true }), { max: 20 });
    await pressKey(page, "ArrowDown");
    await expect(group.getByRole("radio", { name: /Business B/ })).toBeChecked();
    await expect(group.getByRole("radio", { name: /Business B/ })).toBeFocused();
    await tabTo(page, dialog.getByRole("button", { name: /Merge businesses/ }), { max: 40 });
    await page.keyboard.press("Enter");
    await expect(page.getByText("Businesses merged")).toBeVisible();
  });
});

test.describe("scoring settings", () => {
  test("weights by keyboard: the total error is linked to the fields, then save", async ({
    page,
  }) => {
    await mockWorkspaceApi(page);
    await page.goto("/app/settings?tab=scoring");
    const settings = page.getByTestId("scoring-settings");
    await expect(settings.getByTestId("weights-total")).toContainText("100 of 100");
    const freshness = settings.getByLabel("Freshness");
    await tabTo(page, freshness, { max: 60 });
    await replaceValue(page, "5");
    const error = settings.getByTestId("weights-error");
    await expect(error).toHaveText("Weights must add up to 100 (they add up to 95)");
    const errorId = await error.getAttribute("id");
    expect(await freshness.getAttribute("aria-describedby")).toContain(errorId);

    await tabTo(page, settings.getByLabel("Source reliability"), { max: 20 });
    await replaceValue(page, "10");
    await expect(settings.getByTestId("weights-total")).toContainText("100 of 100");
    const save = settings.getByRole("button", { name: /Save and recompute scores/ });
    await tabTo(page, save, { max: 60 });
    const patch = page.waitForRequest(
      (r) => r.method() === "PATCH" && r.url().endsWith("/scoring/profile"),
    );
    await page.keyboard.press("Enter");
    await patch;
  });
});

test.describe("pipeline", () => {
  test("moves a card with ] and [, focus follows the card, and each move is announced", async ({
    page,
  }) => {
    await mockWorkspaceApi(page);
    // On narrow screens one stage shows at a time; Mama Put is in Qualified.
    await page.goto("/app/pipeline?stage=qualified");
    await expect(page.getByRole("heading", { level: 1, name: "Lead pipeline" })).toBeVisible();
    const forward = page.getByRole("button", {
      name: "Move Mama Put Kitchen (Sample) forward to Contacted",
    });
    await tabTo(page, forward, { max: 120 });
    await page.keyboard.press("]");
    await expect(page.getByTestId("pipeline-announcer")).toHaveText(
      "Moved Mama Put Kitchen (Sample) to Contacted.",
    );
    // The card remounted in the Contacted column and focus is on its forward button there.
    const next = page.getByRole("button", {
      name: "Move Mama Put Kitchen (Sample) forward to Interested",
    });
    await expect(next).toBeFocused();
    await expectFocusVisible(page, "moved card");
    await page.keyboard.press("[");
    await expect(page.getByTestId("pipeline-announcer")).toHaveText(
      "Moved Mama Put Kitchen (Sample) to Qualified.",
    );
    await expect(
      page.getByRole("button", { name: "Move Mama Put Kitchen (Sample) back to New" }),
    ).toBeFocused();
  });

  test("the Move to… menu: arrows, Enter, and focus returns to the moved card", async ({
    page,
  }) => {
    await mockWorkspaceApi(page);
    await page.goto("/app/pipeline");
    const menuButton = page.getByRole("button", { name: /^Move to… Onitsha Spare Parts/ });
    await tabTo(page, menuButton, { max: 120 });
    await page.keyboard.press("Enter");
    const menu = page.getByRole("menu");
    await expect(menu).toBeVisible();
    await expect(menu.getByRole("menuitemradio").first()).toBeFocused();
    await pressKey(page, "ArrowDown");
    await pressKey(page, "ArrowDown");
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("pipeline-announcer")).toHaveText(
      "Moved Onitsha Spare Parts (Sample) to Contacted.",
    );
    await expect(
      page.getByRole("button", {
        name: /^Move to… Onitsha Spare Parts \(Sample\), now in Contacted/,
      }),
    ).toBeFocused();
  });
});

test.describe("log activity", () => {
  test("the dialog traps focus, focuses the first invalid field and restores focus on Escape", async ({
    page,
  }) => {
    await mockWorkspaceApi(page);
    await page.goto(`/app/businesses/${BUSINESS_ID}?tab=activities`);
    const open = page.getByTestId("activities-tab").getByRole("button", { name: "Log activity" });
    await tabTo(page, open, { max: 80 });
    await page.keyboard.press("Enter");
    const dialog = page.getByTestId("log-activity-dialog");
    await expect(dialog).toBeVisible();
    await expectFocusWithin(dialog);
    await expectFocusTrapped(page, dialog, 20);
    await tabTo(page, dialog.getByRole("button", { name: "Log note" }), { max: 30 });
    await page.keyboard.press("Enter");
    await expect(dialog.getByRole("textbox", { name: "Note" })).toBeFocused();
    await expectEscapeRestores(page, dialog, open);
  });
});

test.describe("bulk operation", () => {
  test("select rows, Add to list, preview and confirm with the keyboard", async ({ page }) => {
    await mockWorkspaceApi(page);
    await page.goto("/app/businesses");
    await expect(
      main(page).getByRole("link", { name: "Mama Put Kitchen (Sample)" }).first(),
    ).toBeVisible();
    const row = page.getByRole("checkbox", { name: "Select row 1" });
    await tabTo(page, row, { max: 120 });
    await page.keyboard.press("Space");
    const add = page.getByRole("button", { name: "Add to list", exact: true });
    await tabTo(page, add, { max: 120, reverse: true });
    await page.keyboard.press("Enter");
    const dialog = page.getByTestId("bulk-action-dialog");
    await expect(dialog).toBeVisible();
    await tabTo(page, dialog.getByRole("radio").first(), { max: 20 });
    await page.keyboard.press("Space");
    await tabTo(page, dialog.getByRole("button", { name: "Preview changes" }), { max: 20 });
    await page.keyboard.press("Enter");
    await expect(dialog.getByTestId("bulk-preview")).toBeVisible();
    await tabTo(page, dialog.getByRole("button", { name: "Continue" }), { max: 20 });
    await page.keyboard.press("Enter");
    const confirm = page.getByRole("alertdialog");
    await expect(confirm.getByRole("button", { name: "Cancel" })).toBeFocused();
    await tabTo(page, confirm.getByRole("button", { name: /^Add 1/ }), { max: 5 });
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/app\/jobs\/bulk\//);
  });
});

test.describe("billing", () => {
  test("the refund dialog traps focus, starts on Cancel and restores focus on Escape", async ({
    page,
  }) => {
    await mockWorkspaceApi(page);
    await page.goto("/app/billing?tab=payments");
    const refund = main(page).getByTestId("refund-button").first();
    await tabTo(page, refund, { max: 120 });
    await page.keyboard.press("Enter");
    const dialog = page.getByRole("alertdialog");
    await expect(dialog.getByRole("button", { name: "Cancel" })).toBeFocused();
    await expectFocusTrapped(page, dialog, 10);
    await expectEscapeRestores(page, dialog, refund);
  });

  test("tabs move with arrows; cancel at period end is a confirmation that restores focus", async ({
    page,
  }) => {
    await mockWorkspaceApi(page);
    await page.goto("/app/billing");
    const overview = page.getByRole("tab", { name: "Overview" });
    await tabTo(page, overview, { max: 80 });
    await pressKey(page, "ArrowRight");
    await expect(page.getByRole("tab", { name: "Plans and credits" })).toBeFocused();
    await pressKey(page, "ArrowLeft");
    await expect(overview).toBeFocused();
    const cancel = main(page).getByRole("button", { name: "Cancel at period end…" });
    await tabTo(page, cancel, { max: 40 });
    await page.keyboard.press("Enter");
    const dialog = page.getByRole("alertdialog");
    await expect(dialog.getByRole("button", { name: "Keep the plan" })).toBeFocused();
    await expectFocusTrapped(page, dialog, 6);
    await expectEscapeRestores(page, dialog, cancel);
  });
});

test.describe("pipeline stages", () => {
  test("Move up and Move down keep focus on the moved stage and announce its position", async ({
    page,
  }) => {
    await mockWorkspaceApi(page);
    await page.goto("/app/settings?tab=pipeline");
    const down = main(page).getByRole("button", { name: "Move Qualified down" });
    await tabTo(page, down, { max: 80 });
    await page.keyboard.press("Enter");
    await expect(main(page).getByRole("button", { name: "Move Qualified down" })).toBeFocused();
    await expect(page.getByTestId("stages-announcer")).toHaveText(
      "Moved Qualified down to position 3 of 7.",
    );
    await expect(main(page).getByLabel("Stage 3 name")).toHaveValue("Qualified");
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("stages-announcer")).toHaveText(
      "Moved Qualified down to position 4 of 7.",
    );
    await tabTo(page, main(page).getByRole("button", { name: "Save stages" }), { max: 60 });
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("stages-announcer")).toHaveText("Pipeline stages saved.");
  });
});

test.describe("lead details and next attempt", () => {
  test("the lead details dialog traps focus and restores it on Escape", async ({ page }) => {
    await mockWorkspaceApi(page);
    await page.goto(`/app/businesses/${BUSINESS_ID}`);
    const edit = main(page)
      .getByTestId("lead-panel")
      .getByRole("button", { name: "Edit details…" });
    await tabTo(page, edit, { max: 120 });
    await page.keyboard.press("Enter");
    const dialog = page.getByTestId("lead-details-dialog");
    await expectFocusWithin(dialog);
    await expectFocusTrapped(page, dialog, 10);
    await expectEscapeRestores(page, dialog, edit);
  });

  test("the next-attempt dialog traps focus and restores it on Escape", async ({ page }) => {
    await mockWorkspaceApi(page);
    await page.goto("/app/outreach");
    const open = main(page)
      .getByRole("button", { name: /^Next attempt/ })
      .first();
    await tabTo(page, open, { max: 120 });
    await page.keyboard.press("Enter");
    const dialog = page.getByTestId("next-attempt-dialog");
    await expectFocusWithin(dialog);
    await expectFocusTrapped(page, dialog, 8);
    await expectEscapeRestores(page, dialog, open);
  });
});

test.describe("data and deletion", () => {
  test("the delete dialog takes focus, focuses the first invalid field, traps focus and restores it on Escape", async ({
    page,
  }) => {
    await mockWorkspaceApi(page);
    await page.goto("/app/settings?tab=organization");
    const open = main(page).getByTestId("org-delete-open");
    await tabTo(page, open, { max: 120 });
    await page.keyboard.press("Enter");
    const dialog = page.getByTestId("delete-org-dialog");
    await expectFocusWithin(dialog);
    await tabTo(page, dialog.getByTestId("delete-org-submit"), { max: 12 });
    await page.keyboard.press("Enter");
    await expect(dialog.getByLabel("Organization name")).toBeFocused();
    await expect(dialog.getByLabel("Organization name")).toHaveAttribute("aria-invalid", "true");
    await expectFocusTrapped(page, dialog, 10);
    await expectEscapeRestores(page, dialog, open);
  });

  test("the cancel-deletion confirmation starts on its safe action, traps focus and restores it on Escape", async ({
    page,
  }) => {
    await mockWorkspaceApi(page, { orgDeletion: "pending" });
    await page.goto("/app/settings?tab=organization");
    const cancel = main(page).getByTestId("org-deletion-cancel");
    await tabTo(page, cancel, { max: 120 });
    await page.keyboard.press("Enter");
    const dialog = page.getByRole("alertdialog", { name: "Cancel the scheduled deletion?" });
    await expect(dialog.getByRole("button", { name: "Keep it scheduled" })).toBeFocused();
    await expectFocusTrapped(page, dialog, 6);
    await expectEscapeRestores(page, dialog, cancel);
  });
});

test.describe("every dashboard page is keyboard traversable", () => {
  for (const route of KEYBOARD_ROUTES) {
    test(`${route}`, async ({ page }) => {
      await mockWorkspaceApi(page);
      await page.goto(route);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      await page.waitForLoadState("networkidle");
      // No positive tabindex anywhere: Tab order follows the DOM, which follows the layout.
      const positive = await page
        .locator("[tabindex]")
        .evaluateAll((els) =>
          els
            .filter((e) => Number(e.getAttribute("tabindex")) > 0)
            .map((e) => e.outerHTML.slice(0, 80)),
        );
      expect(positive).toEqual([]);
      // Walk into main and through it: every stop visible, none stuck on <body>.
      await page.locator("#main").evaluate((el) => {
        el.setAttribute("tabindex", "-1");
        el.focus();
        el.removeAttribute("tabindex");
      });
      const seq = await tabSequence(page, 40);
      for (const [i, stop] of seq.entries()) {
        expect(stop.ok, `${route} stop ${i + 1} <${stop.tag}> "${stop.name}": ${stop.why}`).toBe(
          true,
        );
      }
    });
  }
});

test.describe("dark theme: popup highlights stay visible", () => {
  test.use({ colorScheme: "dark" });

  test("menus, filter menu and select listbox show the highlighted item", async ({ page }) => {
    await mockWorkspaceApi(page);
    await page.goto("/app");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    const account = page.getByRole("button", { name: /Account menu/ });
    await tabTo(page, account);
    await page.keyboard.press("Enter");
    await expectFocusWithin(page.getByRole("menu"));
    await page.keyboard.press("ArrowDown");
    await expectFocusVisible(page, "dark account menu item");
    await page.keyboard.press("Escape");

    await page.goto(`/app/businesses/import?id=${UPLOADED_IMPORT_ID}`);
    const select = page.getByRole("combobox", { name: /Import “Phone” as/ });
    await tabTo(page, select, { max: 80 });
    await page.keyboard.press("Enter");
    await expectFocusWithin(page.getByRole("listbox"));
    await page.keyboard.press("ArrowDown");
    await expectFocusVisible(page, "dark select option");
    await page.keyboard.press("Escape");

    if ((page.viewportSize()?.width ?? 0) >= 768) {
      await page.goto("/app/businesses");
      const chip = page.getByRole("button", { name: "Region", exact: true });
      await tabTo(page, chip, { max: 60 });
      await page.keyboard.press("Enter");
      await expectFocusWithin(page.getByRole("menu", { name: "Region" }));
      await page.keyboard.press("ArrowDown");
      await expectFocusVisible(page, "dark filter menu item");
    }
  });
});
