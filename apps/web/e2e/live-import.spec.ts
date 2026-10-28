import { expect, test } from "@playwright/test";

/*
 * Live end-to-end (docs/IMPLEMENTATION_PLAN.md Phase 2): import a CSV, see the rows, open the
 * detail, correct a field, and provenance shows the `user_edit` observation.
 *
 * Needs a real API and worker behind the web server, so it is skipped unless E2E_LIVE=1. It runs
 * once (in the 1440px project). Sign-in defaults to the seeded development owner; override with
 * E2E_LIVE_EMAIL and E2E_LIVE_PASSWORD. Business names are unique per run and labelled
 * "(Sample)", so repeated runs never merge into each other or into real data.
 */

const LIVE = process.env.E2E_LIVE === "1";
const EMAIL = process.env.E2E_LIVE_EMAIL ?? "owner@example.test";
const PASSWORD = process.env.E2E_LIVE_PASSWORD ?? "synthetic-owner-pass-2026";

function randomDigits(n: number): string {
  return Array.from({ length: n }, () => Math.floor(Math.random() * 10)).join("");
}

test.describe("live: CSV import to correction provenance", () => {
  test.skip(!LIVE, "Set E2E_LIVE=1 with the API and worker running to run the live spec.");
  test.setTimeout(180_000);

  test("import, browse, open, correct, see the user_edit observation", async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== "w1440", "The live flow runs once, at 1440px.");

    const run = `${Date.now().toString(36)}${randomDigits(3)}`;
    const first = `E2E Bakery ${run} (Sample)`;
    const second = `E2E Pharmacy ${run} (Sample)`;
    const corrected = `E2E Bakery ${run} Corrected (Sample)`;
    const csv = [
      "Business Name,Phone,Email,City,State,Category",
      `${first},0803 ${randomDigits(3)} ${randomDigits(4)},hello@bakery-${run}.example.test,Ikeja,Lagos,Bakery`,
      `${second},0812 ${randomDigits(3)} ${randomDigits(4)},,Yaba,Lagos,Pharmacy`,
      `E2E Broken ${run} (Sample),12345,not-an-email,Lekki,Lagos,Clinic`,
    ].join("\n");

    // Sign in.
    await page.goto("/sign-in");
    await page.locator("input[type=email]").fill(EMAIL);
    await page.locator("input[type=password]").fill(PASSWORD);
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.waitForURL(/\/app$/, { timeout: 60_000 });

    // 1. Upload.
    await page.goto("/app/businesses/import");
    await expect(page.getByRole("heading", { name: "Import businesses" })).toBeVisible();
    await page.locator("input[type=file]").setInputFiles({
      name: `e2e-${run}.csv`,
      mimeType: "text/csv",
      buffer: Buffer.from(csv, "utf8"),
    });

    // 2. Mapping: the API suggests one from the headers; the name column is required.
    await expect(page.getByText("Map columns to business fields")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(/Business name comes from “Business Name”/)).toBeVisible();
    await page.getByRole("button", { name: "Check rows" }).click();

    // 3. Review and commit.
    await expect(page.getByText("Check rows before importing")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole("table", { name: "Rows checked before import" })).toBeVisible();
    await page
      .getByLabel("I confirm we have a lawful basis to import and process this data")
      .check();
    await page.getByRole("button", { name: "Import 3 rows" }).click();

    // 4. Progress is polled until the worker finishes; then the results.
    await expect(page.getByText("Import results")).toBeVisible({ timeout: 120_000 });
    await expect(page.getByText("Imported with 1 failed row")).toBeVisible();
    const failed = page.getByRole("table", { name: "Failed rows" });
    await expect(failed).toBeVisible();
    await expect(failed.getByText("Invalid phone").first()).toBeVisible();

    // 5. The imported rows in the directory, filtered to this import.
    await page.getByRole("link", { name: "View imported businesses" }).click();
    await page.waitForURL(/\/app\/businesses\?importId=/);
    const table = page.getByRole("table", { name: "Businesses" });
    await expect(table.getByRole("link", { name: first })).toBeVisible({ timeout: 30_000 });
    await expect(table.getByRole("link", { name: second })).toBeVisible();

    // 6. Open the detail.
    await table.getByRole("link", { name: first }).click();
    await expect(page.getByRole("heading", { level: 1, name: first })).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.getByText(`hello@bakery-${run}.example.test`)).toBeVisible();

    // 7. Correct the name (one PATCH; the response replaces the cached detail).
    await page.getByRole("button", { name: "Correct details" }).click();
    const dialog = page.getByRole("dialog", { name: "Correct details" });
    await expect(dialog).toBeVisible();
    await dialog.getByLabel("Business name").fill(corrected);
    await dialog.getByLabel("Note").fill("E2E: confirmed by phone");
    await dialog.getByRole("button", { name: "Save correction" }).click();
    await expect(dialog).toBeHidden({ timeout: 30_000 });
    await expect(page.getByRole("heading", { level: 1, name: corrected })).toBeVisible();

    // 8. Provenance shows the user_edit observation with the raw and normalized values.
    await page.getByRole("tab", { name: /Provenance/ }).click();
    const timeline = page.getByRole("list", { name: "Observations, newest first" });
    await expect(timeline).toBeVisible({ timeout: 30_000 });
    const edit = timeline.locator('[data-observation-source="user_edit"]').first();
    await expect(edit).toBeVisible();
    await expect(edit).toContainText(corrected);
    await expect(edit).toContainText("E2E: confirmed by phone");
    await expect(timeline.getByText("Name set by a team member").first()).toBeVisible();
    await expect(timeline.getByText("Manual entry or correction").first()).toBeVisible();
  });
});
