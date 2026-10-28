import { expect, test } from "@playwright/test";
import {
  api,
  apiAll,
  expectNoHorizontalScroll,
  me,
  primaryOrg,
  releaseOnly,
  runId,
  selectAllRows,
  sessionFor,
  shot,
  toast,
} from "./helpers";

/*
 * Criterion 9: save and manage qualified leads. Three "(Sample)" businesses for this run: a lead
 * list is created and filled from a directory search, a lead is assigned from its business page,
 * moved one stage with the keyboard on the board, a call is logged against it, and the three are
 * added to a second list in bulk (preview, typed confirmation, progress to completion). Every step
 * is read back from the API.
 */

test.describe("C9 save and manage qualified leads", () => {
  releaseOnly();

  test("C9 list, assign, keyboard stage move, log an activity, bulk add to a list with progress", async ({
    browser,
  }, info) => {
    const run = runId();
    const { context, page } = await sessionFor(browser, info, "owner");
    const main = page.locator("#main");
    try {
      await page.goto("/app");
      const org = await primaryOrg(page);
      const self = await me(page);
      const names = [
        `E2E Bakery ${run} (Sample)`,
        `E2E Florist ${run} (Sample)`,
        `E2E Pharmacy ${run} (Sample)`,
      ];
      const ids: string[] = [];
      for (const [i, name] of names.entries()) {
        const b = await api<{ id: string }>(page, "POST", "/businesses", org.id, {
          name,
          phones: [`+44113496${String((Date.now() + i) % 1000).padStart(4, "0")}`],
          location: { locality: "Ikeja", region: "Lagos" },
          categories: ["Retail"],
        });
        ids.push(b.id);
      }

      // 1. A list, filled from a directory search.
      const listName = `E2E list ${run} (Sample)`;
      await page.goto("/app/lists");
      await main.getByRole("button", { name: "New list" }).first().click();
      const form = page.getByTestId("list-form-dialog");
      await form.getByLabel("Name").fill(listName);
      await form.getByRole("button", { name: "Create list" }).click();
      await expect(toast(page, `List “${listName}” created`)).toBeVisible();
      await main.getByRole("link", { name: listName }).click();
      await expect(page.getByRole("heading", { level: 1, name: listName })).toBeVisible();
      await main.getByRole("button", { name: "Add businesses" }).first().click();
      const add = page.getByTestId("add-businesses-dialog");
      await add.getByRole("searchbox").fill(run);
      for (const name of names) await add.getByLabel(name).check({ timeout: 20_000 });
      await add.getByRole("button", { name: /Add 3 to list/ }).click();
      await expect(toast(page, `Added 3 businesses to “${listName}”`)).toBeVisible();
      await expect(page.getByTestId("list-meta")).toContainText("3 businesses");
      await expectNoHorizontalScroll(page, "list detail");
      await shot(page, info, "c09-list");
      const listId = page.url().split("/").pop()!.split("?")[0]!;
      const items = await apiAll<{ businessId: string }>(page, `/lists/${listId}/items`, org.id);
      expect(items.map((i) => i.businessId).sort()).toEqual([...ids].sort());

      // 2. Assign a lead from its business page (it joins the pipeline with that owner).
      await page.goto(`/app/businesses/${ids[0]}`);
      const panel = page.getByTestId("lead-panel");
      await panel.getByRole("button", { name: "Add and assign…" }).click();
      const assign = page.getByTestId("assign-dialog");
      await assign.getByText(/\(you\)/).click();
      await assign.getByRole("button", { name: "Add to pipeline" }).click();
      await expect(panel.getByTestId("lead-owner")).toHaveText("You", { timeout: 20_000 });
      await expect(panel.getByTestId("lead-stage")).toContainText("New");

      // 3. Move it one stage with the keyboard on the board; focus follows the card.
      await page.goto(`/app/pipeline?assignedToUserId=${self.user.id}`);
      const forward = page.getByRole("button", { name: `Move ${names[0]} forward to Qualified` });
      await forward.focus();
      await page.keyboard.press("]");
      await expect(page.getByTestId("pipeline-announcer")).toHaveText(
        `Moved ${names[0]} to Qualified.`,
        { timeout: 20_000 },
      );
      await expect(
        page.getByRole("button", { name: `Move ${names[0]} forward to Contacted` }),
      ).toBeFocused();
      const leads = await api<{ stageKey: string; assignedToUserId: string | null }[]>(
        page,
        "GET",
        `/pipeline/leads?businessId=${ids[0]}`,
        org.id,
      );
      expect(leads[0]).toMatchObject({ stageKey: "qualified", assignedToUserId: self.user.id });
      await expectNoHorizontalScroll(page, "pipeline");
      await shot(page, info, "c09-pipeline");

      // 4. Log a call on the business; it shows in the timeline and the API.
      await page.goto(`/app/businesses/${ids[0]}?tab=activities`);
      const tab = page.getByTestId("activities-tab");
      await tab.getByRole("button", { name: "Log activity" }).click();
      const log = page.getByTestId("log-activity-dialog");
      await log.getByText("Call", { exact: true }).click();
      await log.getByRole("combobox", { name: "Outcome" }).click();
      await page.getByRole("option", { name: "Connected" }).click();
      await log.getByLabel("Notes (optional)").fill("Release e2e call (Sample).");
      await log.getByRole("button", { name: "Log call" }).click();
      await expect(toast(page, "Call logged")).toBeVisible();
      await expect(tab.getByTestId("activity-timeline")).toContainText("Call · Connected");
      const activities = await api<{ type: string; outcome: string | null }[]>(
        page,
        "GET",
        `/activities?businessId=${ids[0]}`,
        org.id,
      );
      expect(activities.some((a) => a.type === "call" && a.outcome === "connected")).toBe(true);

      // 5. Bulk add the three to a new list: preview, confirm, progress to completion.
      const bulkList = `E2E bulk list ${run} (Sample)`;
      await page.goto(`/app/businesses?q=${encodeURIComponent(run)}`);
      await expect(main.getByRole("link", { name: names[2] }).first()).toBeVisible({
        timeout: 30_000,
      });
      await selectAllRows(page);
      await page.getByRole("button", { name: "Add to list", exact: true }).click();
      const bulk = page.getByTestId("bulk-action-dialog");
      await bulk.getByText("New list", { exact: true }).click();
      await bulk.getByLabel("New list name").fill(bulkList);
      await bulk.getByRole("button", { name: "Preview changes" }).click();
      await expect(bulk.getByTestId("bulk-preview")).toContainText("3 businesses match");
      await expect(bulk.getByTestId("bulk-will-change")).toContainText("3");
      await bulk.getByRole("button", { name: "Continue" }).click();
      await page
        .getByRole("alertdialog")
        .getByRole("button", { name: /^Add (to list )?3/ })
        .click();
      await page.waitForURL(/\/app\/jobs\/bulk\//);
      await expect(page.getByTestId("bulk-status")).toHaveText(/Completed/, { timeout: 120_000 });
      await expect(page.getByTestId("bulk-counts")).toContainText("3");
      for (const name of names) await expect(main.getByText(name).first()).toBeVisible();
      await expectNoHorizontalScroll(page, "bulk job");
      await shot(page, info, "c09-bulk");
      const lists = await api<{ id: string; name: string; itemCount: number }[]>(
        page,
        "GET",
        `/lists?q=${encodeURIComponent(`E2E bulk list ${run}`)}`,
        org.id,
      );
      expect(lists.find((l) => l.name === bulkList)?.itemCount).toBe(3);
    } finally {
      await context.close();
    }
  });
});
