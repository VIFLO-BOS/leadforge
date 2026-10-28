import { expect, test } from "@playwright/test";
import { expectControlsFit, expectDialogFits, expectNoOverflow } from "./assertions";
import {
  BUSINESS_ID,
  BUSINESS_ROUTES,
  COMPLETED_IMPORT_ID,
  UNKNOWN_BUSINESS_ID,
  UPLOADED_IMPORT_ID,
  mockWorkspaceApi,
} from "./fixtures";

/*
 * Behaviour of the Phase 2 screens against mocked API responses: responsive structure, URL
 * filter state, permission gating, the not-found state, provenance, the import steps and
 * dialogs that must fit at every width. Runs at every project width.
 */

test.describe("controls fit at every width", () => {
  for (const route of BUSINESS_ROUTES) {
    test(`${route}`, async ({ page }) => {
      await mockWorkspaceApi(page);
      await page.goto(route);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      await page.waitForLoadState("networkidle");
      await expectControlsFit(page, route);
    });
  }
});

test.describe("directory", () => {
  test("rows are cards under 480px and a table above", async ({ page, viewport }) => {
    await mockWorkspaceApi(page);
    await page.goto("/app/businesses");
    await expect(page.getByRole("heading", { level: 1, name: "Businesses" })).toBeVisible();
    if ((viewport?.width ?? 0) < 480) {
      await expect(page.getByRole("list", { name: "Businesses" })).toBeVisible();
      await expect(page.getByRole("table", { name: "Businesses" })).toHaveCount(0);
    } else {
      await expect(page.getByRole("table", { name: "Businesses" })).toBeVisible();
    }
    await expect(page.getByRole("link", { name: "Mama Put Kitchen (Sample)" })).toBeVisible();
    // Field states are icon plus text, the WhatsApp tri-state is explicit.
    await expect(page.getByText("WhatsApp confirmed").first()).toBeVisible();
    await expect(page.getByText("WhatsApp team-asserted").first()).toBeVisible();
    await expect(page.getByText("48 businesses in total")).toBeVisible();
    await expectNoOverflow(page, "directory");
  });

  test("filters live in the URL and survive a reload", async ({ page, viewport }) => {
    await mockWorkspaceApi(page);
    await page.goto("/app/businesses");
    await expect(page.getByRole("link", { name: "Mama Put Kitchen (Sample)" })).toBeVisible();
    const compact = (viewport?.width ?? 0) < 768;
    if (compact) {
      await page.getByRole("button", { name: /^Filters/ }).click();
      await page
        .getByRole("dialog")
        .getByRole("button", { name: /^Region/ })
        .click();
    } else {
      await page.getByRole("button", { name: "Region" }).click();
    }
    await page.getByRole("menuitemcheckbox", { name: /Lagos/ }).click();
    await page.keyboard.press("Escape");
    await expect(page).toHaveURL(/region=lagos/);
    if (compact) await page.getByRole("button", { name: "Show results" }).click();
    await expect(
      page.getByRole("group", { name: "Applied filters" }).getByText("Region: Lagos"),
    ).toHaveCount(compact ? 0 : 1);

    await page.reload();
    await expect(page).toHaveURL(/region=lagos/);
    if (compact) {
      await expect(page.getByRole("button", { name: "Filters (1)" })).toBeVisible();
    } else {
      await expect(
        page.getByRole("group", { name: "Applied filters" }).getByText("Region: Lagos"),
      ).toBeVisible();
    }
    await expectNoOverflow(page, "filtered directory");
  });

  test("an empty workspace offers import and add", async ({ page }) => {
    await mockWorkspaceApi(page, { empty: true });
    await page.goto("/app/businesses");
    await expect(page.getByRole("heading", { name: "No businesses yet" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Import CSV" }).first()).toBeVisible();
    await expectNoOverflow(page, "empty directory");
  });

  test("a read-only analyst can export but not edit", async ({ page }) => {
    await mockWorkspaceApi(page, { role: "analyst" });
    await page.goto("/app/businesses");
    await expect(page.getByRole("link", { name: "Mama Put Kitchen (Sample)" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Export", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Add business" })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Import CSV" })).toHaveCount(0);
  });

  test("a sales representative exports only the leads assigned to them", async ({ page }) => {
    await mockWorkspaceApi(page, { role: "sales_rep" });
    await page.goto("/app/businesses");
    await expect(page.getByRole("link", { name: "Mama Put Kitchen (Sample)" })).toBeVisible();
    await page.getByRole("button", { name: "Export", exact: true }).click();
    await expect(page.getByText("Only your assigned leads are exported")).toBeVisible();
  });

  test("the add business dialog fits the viewport", async ({ page }) => {
    await mockWorkspaceApi(page);
    await page.goto("/app/businesses?add=1");
    await expect(page.getByRole("dialog", { name: "Add a business" })).toBeVisible();
    await expectDialogFits(page);
    // Contracts validation runs before any request.
    await page.getByRole("button", { name: "Add business" }).last().click();
    await expect(page.getByRole("dialog").getByRole("alert").first()).toBeVisible();
  });
});

test.describe("business detail", () => {
  test("contacts show states, conflicts, WhatsApp and expired values", async ({ page }) => {
    await mockWorkspaceApi(page);
    await page.goto(`/app/businesses/${BUSINESS_ID}`);
    await expect(
      page.getByRole("heading", { level: 1, name: "Mama Put Kitchen (Sample)" }),
    ).toBeVisible();
    await expect(page.getByText("Sources disagree. Other observed values:")).toBeVisible();
    await expect(page.getByText("https://mamaput-kitchen.example.test")).toBeVisible();
    await expect(page.locator('[data-whatsapp="confirmed"]').first()).toBeVisible();
    await expect(page.locator('[data-whatsapp="user_asserted"]').first()).toBeVisible();
    await expect(page.getByText(/Hidden: the source's retention period ended/)).toBeVisible();
    // Phase 4 tabs and the Phase 5 Activities tab are enabled; nothing is left as "Soon".
    await expect(page.getByRole("tab", { name: /Website analysis/ })).toBeEnabled();
    await expect(page.getByRole("tab", { name: /Activities/ })).toBeEnabled();
    await expectNoOverflow(page, "detail");
  });

  test("provenance lists the user_edit observation with raw and normalized values", async ({
    page,
  }) => {
    await mockWorkspaceApi(page);
    await page.goto(`/app/businesses/${BUSINESS_ID}?tab=provenance`);
    const timeline = page.getByRole("list", { name: "Observations, newest first" });
    await expect(timeline).toBeVisible();
    const edit = timeline.locator('[data-observation-source="user_edit"]').first();
    await expect(edit).toContainText("+2348098765432");
    await expect(edit).toContainText("0809 876 5432");
    await expect(edit).toContainText("Called and confirmed the new line");
    await expectNoOverflow(page, "provenance");
  });

  test("the corrections dialog fits and validates with the contracts schema", async ({ page }) => {
    await mockWorkspaceApi(page);
    await page.goto(`/app/businesses/${BUSINESS_ID}`);
    await page.getByRole("button", { name: "Correct details" }).click();
    const dialog = page.getByRole("dialog", { name: "Correct details" });
    await expect(dialog).toBeVisible();
    await expectDialogFits(page);
    await dialog.getByLabel("Business name").fill("");
    await dialog.getByRole("button", { name: "Save correction" }).click();
    await expect(dialog.getByRole("alert").first()).toBeVisible();
  });

  test("an unknown or other-organization id shows a not-found state", async ({ page }) => {
    await mockWorkspaceApi(page);
    await page.goto(`/app/businesses/${UNKNOWN_BUSINESS_ID}`);
    await expect(page.getByRole("heading", { level: 1, name: "Business not found" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Back to businesses" })).toBeVisible();
    await expectNoOverflow(page, "not found");
  });
});

test.describe("CSV import", () => {
  test("mapping requires a name column, then the rows are checked", async ({ page }) => {
    await mockWorkspaceApi(page);
    await page.goto(`/app/businesses/import?id=${UPLOADED_IMPORT_ID}`);
    await expect(page.getByText("Map columns to business fields")).toBeVisible();
    await expect(page.getByText(/Business name comes from “Business Name”/)).toBeVisible();

    // Unmap the name column: continuing is blocked with the schema's message.
    await page.getByRole("combobox", { name: /Import “Business Name” as/ }).click();
    await page.getByRole("option", { name: "Don't import" }).click();
    await page.getByRole("button", { name: "Check rows" }).click();
    await expect(page.getByText("Fix the mapping to continue")).toBeVisible();
    await expectNoOverflow(page, "mapping with error");

    await page.getByRole("combobox", { name: /Import “Business Name” as/ }).click();
    await page.getByRole("option", { name: /Business name/ }).click();
    await page.getByRole("button", { name: "Check rows" }).click();
    await expect(page.getByText("Check rows before importing")).toBeVisible();
    await expect(page.getByText("Spreadsheet formula").first()).toBeVisible();
    await expect(page.getByRole("button", { name: "Import 120 rows" })).toBeDisabled();
    await expectNoOverflow(page, "review");
  });

  test("results show counts and the failed rows", async ({ page }) => {
    await mockWorkspaceApi(page);
    await page.goto(`/app/businesses/import?id=${COMPLETED_IMPORT_ID}`);
    await expect(page.getByText("Imported with 5 failed rows")).toBeVisible();
    await expect(page.getByText("Row numbers match the spreadsheet")).toBeVisible();
    await expect(page.getByText("Invalid phone").first()).toBeVisible();
    await expectNoOverflow(page, "results");
  });

  test("client-side checks refuse a workbook before uploading", async ({ page }) => {
    await mockWorkspaceApi(page);
    await page.goto("/app/businesses/import");
    await page.locator("input[type=file]").setInputFiles({
      name: "businesses.xlsx",
      mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      buffer: Buffer.from("PK"),
    });
    await expect(page.getByRole("alert").filter({ hasText: "is not a CSV" })).toBeVisible();
  });
});

test.describe("motion", () => {
  for (const mode of ["reduce", "no-preference"] as const) {
    test.describe(`reduced motion: ${mode}`, () => {
      test.use({ reducedMotion: mode });
      for (const route of BUSINESS_ROUTES) {
        test(`${route} renders without runtime errors`, async ({ page }) => {
          const errors: string[] = [];
          page.on("pageerror", (e) => errors.push(e.message));
          page.on("console", (m) => {
            // Mocked 404s (the not-found route) are expected network noise, not app errors.
            if (m.type() === "error" && !/Failed to load resource/.test(m.text()))
              errors.push(m.text());
          });
          await mockWorkspaceApi(page);
          await page.goto(route);
          await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
          await page.waitForLoadState("networkidle");
          // Content reached its final, visible state.
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
