import { expect, test, type Page, type Request } from "@playwright/test";
import { expectControlsFit, expectDialogFits, expectNoOverflow } from "./assertions";
import { STAGE10_ROUTES, mockWorkspaceApi } from "./fixtures";
import { OWNER_PASSWORD } from "./fixtures-stage10";

/*
 * Stage 10 screens against the stateful lifecycle mock (e2e/fixtures-stage10.ts): Settings,
 * Organization, "Data and deletion" (request an organization export, follow its progress, download
 * it through a fresh link; schedule the deletion with the typed name and password, see the banner,
 * cancel it), the banner for other members, and the explanation of ORGANIZATION_PENDING_DELETION
 * where new work is refused. Controls fit and reduced motion run at every width; flows at 375 and
 * 1440.
 */

test.describe.configure({ timeout: 90_000 });

const main = (page: Page) => page.locator("#main");
const FLOW_PROJECTS = new Set(["w375", "w1440"]);
const flowsOnly = () =>
  test.skip(!FLOW_PROJECTS.has(test.info().project.name), "flows run at 375 and 1440");
const NAME = "Sample Logistics Ltd (Sample)";

test.describe("controls fit at every width (Stage 10)", () => {
  for (const route of STAGE10_ROUTES) {
    for (const variant of ["idle", "pending"] as const) {
      test(`${route} (${variant})`, async ({ page }) => {
        await mockWorkspaceApi(
          page,
          variant === "pending"
            ? { orgDeletion: "pending", orgExport: "completed" }
            : { orgExport: "running" },
        );
        await page.goto(route);
        await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
        await page.waitForLoadState("networkidle");
        await expectControlsFit(page, `${route} ${variant}`);
        await expectNoOverflow(page, `${route} ${variant}`);
      });
    }
  }

  test("the delete dialog fits", async ({ page }) => {
    await mockWorkspaceApi(page);
    await page.goto("/app/settings?tab=organization");
    await main(page).getByTestId("org-delete-open").click();
    const dialog = page.getByTestId("delete-org-dialog");
    await expect(dialog).toBeVisible();
    await expectDialogFits(page);
  });
});

test.describe("motion (Stage 10)", () => {
  for (const mode of ["reduce", "no-preference"] as const) {
    test.describe(`reduced motion: ${mode}`, () => {
      test.use({ reducedMotion: mode });
      test("settings and the pending banner render without runtime errors", async ({ page }) => {
        const errors: string[] = [];
        page.on("pageerror", (e) => errors.push(e.message));
        page.on("console", (m) => {
          if (m.type() === "error" && !/Failed to load resource/.test(m.text()))
            errors.push(m.text());
        });
        await mockWorkspaceApi(page, { orgDeletion: "pending", orgExport: "running" });
        await page.goto("/app/settings?tab=organization");
        await expect(page.getByTestId("org-deletion-banner")).toBeVisible();
        await expect(page.getByTestId("org-export")).toHaveAttribute("data-state", "running");
        await page.waitForLoadState("networkidle");
        // The banner and the state swaps are at full opacity once settled (fade 250 ms, none when reduced).
        await expect
          .poll(() =>
            page
              .getByTestId("org-deletion-banner")
              .evaluate((el) => Number(getComputedStyle(el.parentElement!).opacity)),
          )
          .toBe(1);
        expect(errors, errors.join("\n")).toEqual([]);
      });
    });
  }
});

test.describe("organization data export", () => {
  test.beforeEach(flowsOnly);

  test("request, follow the progress, then download through a fresh link", async ({ page }) => {
    const keys: string[] = [];
    page.on("request", (r: Request) => {
      if (r.method() === "POST" && r.url().endsWith("/organizations/current/data-exports"))
        keys.push(r.headers()["idempotency-key"] ?? "");
    });
    await mockWorkspaceApi(page);
    await page.goto("/app/settings?tab=organization");
    const section = page.getByTestId("org-export");
    await expect(section).toHaveAttribute("data-state", "none");
    await section.getByTestId("org-export-request").click();
    await expect(section).toHaveAttribute("data-state", /queued|running/);
    await expect(section.getByRole("progressbar")).toBeVisible();
    await expect(page.getByTestId("org-export-status")).toHaveText(/Ready to download/, {
      timeout: 15_000,
    });
    await expect(page.getByTestId("org-export-announcer")).toHaveText(
      "The organization export is ready to download.",
    );
    expect(keys).toHaveLength(1);
    expect(keys[0]).toMatch(/^org-export-/);
    const download = page.waitForEvent("download");
    await page.getByTestId("org-export-download").click();
    const file = await download;
    expect(file.suggestedFilename()).toMatch(/^leadforge-organization-.*\.zip$/);
  });

  test("a running export is picked up instead of starting another", async ({ page }) => {
    await mockWorkspaceApi(page, { orgExportConflict: true });
    await page.goto("/app/settings?tab=organization");
    await page.getByTestId("org-export-request").click();
    await expect(page.getByTestId("org-export-conflict")).toBeVisible();
    await expect(page.getByTestId("org-export")).toHaveAttribute("data-state", /running|completed/);
  });

  test("a refused download link is explained once and dropped from the URL", async ({ page }) => {
    await mockWorkspaceApi(page, { orgExport: "completed" });
    await page.goto("/app/settings?tab=organization&downloadError=DOWNLOAD_LINK_INVALID");
    await expect(page.getByTestId("org-export-link-problem")).toContainText("not valid for you");
    await expect(page).toHaveURL(/\/app\/settings\?tab=organization$/);
  });

  test("other roles are told who can export and delete", async ({ page }) => {
    await mockWorkspaceApi(page, { role: "researcher" });
    await page.goto("/app/settings?tab=organization");
    await expect(page.getByTestId("org-export-owners-only")).toContainText(
      "Only owners can export",
    );
    await expect(page.getByTestId("org-delete-owners-only")).toContainText(
      "Only owners can delete",
    );
    await expect(main(page).getByTestId("org-export-request")).toHaveCount(0);
    await expect(main(page).getByTestId("org-delete-open")).toHaveCount(0);
  });
});

test.describe("organization deletion", () => {
  test.beforeEach(flowsOnly);

  test("schedule with the typed name and password, see the banner, then cancel", async ({
    page,
  }) => {
    await mockWorkspaceApi(page);
    await page.goto("/app/settings?tab=organization");
    await expect(page.getByTestId("org-deletion-banner")).toHaveCount(0);
    await main(page).getByTestId("org-delete-open").click();
    const dialog = page.getByTestId("delete-org-dialog");
    await expect(dialog.getByTestId("delete-org-kept")).toContainText("invoices");
    // A wrong name stays on the name field; a wrong password on the password field.
    await dialog.getByLabel("Organization name").fill("Sample Logistics");
    await dialog.getByTestId("delete-org-submit").click();
    await expect(dialog.getByLabel("Organization name")).toHaveAttribute("aria-invalid", "true");
    await dialog.getByLabel("Organization name").fill(NAME);
    await dialog.getByLabel("Your current password").fill("not-the-password");
    await dialog.getByTestId("delete-org-submit").click();
    await expect(dialog.getByLabel("Your current password")).toHaveAttribute(
      "aria-invalid",
      "true",
    );
    await expect(dialog.getByLabel("Your current password")).toBeFocused();
    await dialog.getByLabel("Your current password").fill(OWNER_PASSWORD);
    await dialog.getByTestId("delete-org-submit").click();
    await expect(dialog).toBeHidden();
    await expect(page.getByTestId("org-deletion-banner")).toBeVisible();
    await expect(page.getByTestId("org-deletion-pending")).toContainText(
      "Scheduled for deletion on",
    );
    // The "Deletion scheduled" toast sits over the Cancel button on phones and pauses while the
    // pointer rests on it: lift the pointer (as a finger would) and let it go first.
    await page.mouse.move(1, 1);
    await expect(page.locator("[data-sonner-toast]")).toHaveCount(0, { timeout: 20_000 });
    await main(page).getByTestId("org-deletion-cancel").click();
    const confirm = page.getByRole("alertdialog", { name: "Cancel the scheduled deletion?" });
    await confirm.getByRole("button", { name: "Cancel deletion" }).click();
    await expect(page.getByTestId("org-deletion-banner")).toHaveCount(0);
    await expect(page.getByTestId("org-deletion")).toHaveAttribute("data-state", "none");
  });

  test("other members see the banner, can hide it for the session, and cannot cancel", async ({
    page,
  }) => {
    await mockWorkspaceApi(page, { orgDeletion: "pending", role: "sales_rep" });
    await page.goto("/app");
    const banner = page.getByTestId("org-deletion-banner");
    await expect(banner).toContainText("Only an owner can cancel");
    await expect(banner.getByRole("link", { name: /Cancel deletion/ })).toHaveCount(0);
    await banner
      .getByRole("button", { name: "Dismiss: organization scheduled for deletion" })
      .click();
    await expect(banner).toHaveCount(0);
    await page.reload();
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await page.waitForLoadState("networkidle");
    await expect(page.getByTestId("org-deletion-banner")).toHaveCount(0);
  });

  test("owners cannot dismiss the banner and it links to the cancel action", async ({ page }) => {
    await mockWorkspaceApi(page, { orgDeletion: "pending" });
    await page.goto("/app/businesses");
    const banner = page.getByTestId("org-deletion-banner");
    await expect(banner).toBeVisible();
    await expect(banner.getByRole("button", { name: /Dismiss/ })).toHaveCount(0);
    await banner.getByRole("link", { name: /Cancel deletion/ }).click();
    await expect(page).toHaveURL(/\/app\/settings\?tab=organization#data-and-deletion$/);
    await expect(page.getByTestId("org-deletion-cancel")).toBeVisible();
  });

  test("new work refused during the grace period is explained", async ({ page }) => {
    await mockWorkspaceApi(page, { orgDeletion: "pending" });
    await page.goto("/app/team");
    await main(page).getByRole("button", { name: "Invite member" }).click();
    const invite = page.getByRole("dialog");
    await invite.getByLabel(/Email/).fill("new.person@example.test");
    await invite.getByRole("button", { name: "Send invitation" }).click();
    await expect(invite.getByTestId("pending-deletion-block")).toContainText(
      "scheduled for deletion",
    );
    await expect(invite.getByTestId("pending-deletion-block")).toContainText(
      "No invitation was sent.",
    );

    await page.goto("/app/billing?tab=plans");
    await main(page).getByRole("button", { name: "Buy 500 credits" }).click();
    await expect(page.getByTestId("checkout-problem")).toContainText("Purchases are paused");
  });
});
