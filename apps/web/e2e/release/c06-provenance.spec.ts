import { expect, test } from "@playwright/test";
import {
  api,
  expectNoHorizontalScroll,
  primaryOrg,
  releaseOnly,
  runId,
  sessionFor,
  shot,
} from "./helpers";

/*
 * Criterion 6: source provenance and contact verification. A business whose website is the stack's
 * test site: contacts are collected from its own website, the phone found there is verified (and
 * the check is in the verification history), the email is collected but its mailbox is never
 * claimed as confirmed, the observations carry their sources, and a correction is recorded as a
 * team member's edit with its note.
 */

const SITE = "kitchen.lf-e2e.test";
const SITE_PHONE = "+44 20 7946 0555";

test.describe("C6 source provenance and contact verification", () => {
  releaseOnly();

  test("C6 provenance panel, verification history, a correction as a user edit, Mailbox not confirmed", async ({
    browser,
  }, info) => {
    const run = runId();
    const name = `E2E Kitchen ${run} (Sample)`;
    const corrected = `E2E Kitchen ${run} Corrected (Sample)`;
    const { context, page } = await sessionFor(browser, info, "owner");
    try {
      await page.goto("/app");
      const org = await primaryOrg(page);
      const biz = await api<{ id: string }>(page, "POST", "/businesses", org.id, {
        name,
        website: `http://${SITE}`,
        location: { locality: "Ikeja", region: "Lagos" },
        categories: ["Restaurant"],
      });

      // 1. Collect contacts from the business's own website.
      await page.goto(`/app/businesses/${biz.id}`);
      await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
      const collection = page.getByTestId("contact-collection");
      await collection.getByRole("button", { name: /Find contacts on website/ }).click();
      await expect(
        collection
          .locator('[data-run-kind="website_contacts"][data-run-status="completed"]')
          .first(),
      ).toBeVisible({ timeout: 120_000 });

      // 2. The phone found on the business's own site is verified; the email is not claimed confirmed.
      const phone = page.locator('li[data-field="phone"]', { hasText: SITE_PHONE });
      await expect(phone).toBeVisible({ timeout: 30_000 });
      await expect(phone).toHaveAttribute("data-state", "verified");
      const email = page.locator('li[data-field="email"]', { hasText: `hello@${SITE}` });
      await expect(email).toBeVisible();
      await expect(email).not.toHaveAttribute("data-state", "verified");
      await expect(email.getByTestId("mailbox-not-confirmed")).toHaveText("Mailbox not confirmed");
      await expectNoHorizontalScroll(page, "business contacts");
      await shot(page, info, "c06-contacts");

      // 3. Verification history lists the phone check.
      await page.getByRole("tab", { name: "Verification" }).click();
      const events = page.getByRole("list", { name: "Verification events, newest first" });
      await expect(events).toBeVisible({ timeout: 30_000 });
      await expect(events).toContainText(/Phone check/);
      const apiEvents = await api<{ field: string; result: string }[]>(
        page,
        "GET",
        `/businesses/${biz.id}/verification-events`,
        org.id,
      );
      expect(apiEvents.some((e) => e.field === "phone")).toBe(true);
      await expect(events.getByRole("listitem")).toHaveCount(apiEvents.length);
      await shot(page, info, "c06-verification");

      // 4. Provenance shows where each value came from: the manual entry and the website.
      await page.getByRole("tab", { name: /Provenance/ }).click();
      const timeline = page.getByRole("list", { name: "Observations, newest first" });
      await expect(timeline).toBeVisible({ timeout: 30_000 });
      await expect(timeline.locator('[data-observation-source="website"]').first()).toBeVisible();
      await expect(
        timeline
          .locator('[data-observation-source="user_import"], [data-observation-source="user_edit"]')
          .first(),
      ).toBeVisible();

      // 5. A correction is recorded as a team member's edit with the note.
      await page.getByRole("button", { name: "Correct details" }).click();
      const dialog = page.getByRole("dialog", { name: "Correct details" });
      await dialog.getByLabel("Business name").fill(corrected);
      await dialog.getByLabel("Note").fill("Release e2e: confirmed by phone");
      await dialog.getByRole("button", { name: "Save correction" }).click();
      await expect(dialog).toBeHidden({ timeout: 30_000 });
      await expect(page.getByRole("heading", { level: 1, name: corrected })).toBeVisible();
      await page.getByRole("tab", { name: /Provenance/ }).click();
      const edit = timeline.locator('[data-observation-source="user_edit"]').first();
      await expect(edit).toBeVisible({ timeout: 30_000 });
      await expect(edit).toContainText(corrected);
      await expect(edit).toContainText("Release e2e: confirmed by phone");
      await expect(timeline.getByText("Name set by a team member").first()).toBeVisible();
      await expectNoHorizontalScroll(page, "provenance");
      await shot(page, info, "c06-provenance");
      const observations = await api<{ source: string; field: string }[]>(
        page,
        "GET",
        `/businesses/${biz.id}/observations?field=name`,
        org.id,
      );
      expect(observations.some((o) => o.source === "user_edit")).toBe(true);
    } finally {
      await context.close();
    }
  });
});
