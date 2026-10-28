import { expect, test, type Page } from "@playwright/test";
import {
  api,
  call,
  expectNoHorizontalScroll,
  isPhone,
  primaryOrg,
  releaseOnly,
  runId,
  sessionFor,
  shot,
  toast,
} from "./helpers";

/*
 * Criterion 7: search, filter, inspect and deduplicate. Three "(Sample)" businesses for this run,
 * two of which share a phone in the same place. The directory search and a category filter update
 * the URL and the results (and survive a reload), the count equals the API's total, a row opens
 * its detail, and the duplicate pair is merged in the review queue with a field choice, then the
 * merge is undone exactly.
 */

async function directoryTotal(page: Page, orgId: string, query: string): Promise<number> {
  const res = await call(page, "GET", `/businesses?${query}`, orgId);
  expect(res.ok()).toBe(true);
  return ((await res.json()) as { meta: { total: number } }).meta.total;
}

const plural = (n: number) => `${n} ${n === 1 ? "business" : "businesses"}`;

test.describe("C7 search, filter, inspect and deduplicate", () => {
  releaseOnly();

  test("C7 search and filters in the URL, inspect, merge a duplicate with a field choice, undo", async ({
    browser,
  }, info) => {
    const run = runId();
    const phone = `+44161496${String(Math.floor(Math.random() * 1000)).padStart(4, "0")}`;
    const a = `E2E Dup ${run} (Sample)`;
    const b = `E2E Dup ${run} Ikeja (Sample)`;
    const c = `E2E Florist ${run} (Sample)`;
    const compact = isPhone(info);
    const { context, page } = await sessionFor(browser, info, "owner");
    const main = page.locator("#main");
    try {
      await page.goto("/app");
      const org = await primaryOrg(page);
      const A = await api<{ id: string }>(page, "POST", "/businesses", org.id, {
        name: a,
        phones: [phone],
        location: { locality: "Ikeja", region: "Lagos" },
        categories: ["Bakery"],
      });
      const B = await api<{ id: string }>(page, "POST", "/businesses", org.id, {
        name: b,
        phones: [phone],
        location: { locality: "Ikeja", region: "Lagos" },
        categories: ["Bakery"],
      });
      await api(page, "POST", "/businesses", org.id, {
        name: c,
        location: { locality: "Yaba", region: "Lagos" },
        categories: ["Florist"],
      });

      // 1. Search: the URL and the results follow the search box.
      await page.goto("/app/businesses");
      await expect(page.getByRole("heading", { level: 1, name: "Businesses" })).toBeVisible();
      await page.getByRole("searchbox", { name: "Search businesses" }).fill(run);
      await expect.poll(() => new URL(page.url()).searchParams.get("q")).toBe(run);
      for (const name of [a, b, c])
        await expect(main.getByRole("link", { name, exact: true }).first()).toBeVisible({
          timeout: 30_000,
        });
      const searchTotal = await directoryTotal(page, org.id, `q=${run}`);
      expect(searchTotal).toBe(3);
      await expect(main).toContainText(`${plural(searchTotal)} match`);
      await expectNoHorizontalScroll(page, "directory search");

      // 2. A category filter narrows it; the URL keeps both, and a reload restores them.
      if (compact) {
        await page.getByRole("button", { name: /^Filters/ }).click();
        await page
          .getByRole("dialog")
          .getByRole("button", { name: /^Category/ })
          .click();
      } else {
        await page.getByRole("button", { name: "Category" }).click();
      }
      await page.getByRole("menuitemcheckbox", { name: /^Bakery/ }).click();
      await page.keyboard.press("Escape");
      if (compact) await page.getByRole("button", { name: "Show results" }).click();
      await expect(page).toHaveURL(/category=bakery/);
      await expect(main.getByRole("link", { name: c, exact: true })).toHaveCount(0);
      await expect(main.getByRole("link", { name: a, exact: true }).first()).toBeVisible();
      const filteredTotal = await directoryTotal(page, org.id, `q=${run}&category=bakery`);
      expect(filteredTotal).toBe(2);
      await expect(main).toContainText(`${plural(filteredTotal)} match`);
      await page.reload();
      expect(new URL(page.url()).searchParams.get("q")).toBe(run);
      expect(new URL(page.url()).searchParams.getAll("category")).toEqual(["bakery"]);
      await expect(main.getByRole("link", { name: b, exact: true }).first()).toBeVisible({
        timeout: 30_000,
      });
      await expect(main.getByRole("link", { name: c, exact: true })).toHaveCount(0);
      await expectNoHorizontalScroll(page, "filtered directory");
      await shot(page, info, "c07-filtered");

      // 3. Inspect: the row opens the detail.
      await main.getByRole("link", { name: a, exact: true }).first().click();
      await page.waitForURL((u) => u.pathname === `/app/businesses/${A.id}`);
      await expect(page.getByRole("heading", { level: 1, name: a })).toBeVisible();

      // 4. The pair is a duplicate candidate (corroborated: same phone, same place).
      await api(page, "POST", "/dedup/scan", org.id, { businessIds: [A.id, B.id] });
      let candidateId: string | null = null;
      await expect
        .poll(
          async () => {
            const list = await api<{ id: string; businessIds: string[] }[]>(
              page,
              "GET",
              `/dedup/candidates?businessId=${A.id}&status=pending`,
              org.id,
            );
            candidateId = list.find((x) => x.businessIds.includes(B.id))?.id ?? null;
            return candidateId;
          },
          { timeout: 90_000, intervals: [2_000] },
        )
        .not.toBeNull();

      // 5. Merge from the review queue, keeping the other record's name.
      await page.goto("/app/businesses/duplicates");
      await main.locator(`a[href="/app/businesses/duplicates/${candidateId}"]`).first().click();
      await expect(page.getByTestId("candidate-compare")).toContainText(b);
      await expectNoHorizontalScroll(page, "candidate review");
      await page.getByRole("button", { name: /Merge/ }).first().click();
      const dialog = page.getByTestId("merge-dialog");
      await dialog
        .getByRole("radiogroup", { name: "Surviving record" })
        .getByRole("radio", { name: a })
        .check();
      await dialog
        .getByRole("radiogroup", { name: "Name to keep" })
        .getByRole("radio", { name: b })
        .check();
      await shot(page, info, "c07-merge-dialog");
      await dialog.getByRole("button", { name: /Merge businesses/ }).click();
      await expect(toast(page, "Businesses merged")).toBeVisible();
      await page.waitForURL(
        (url) =>
          url.pathname === `/app/businesses/${A.id}` && url.search.includes("tab=duplicates"),
      );
      await expect(page.getByRole("heading", { level: 1, name: b })).toBeVisible();
      const merged = await api<{ id: string; name: { value: string } }>(
        page,
        "GET",
        `/businesses/${A.id}`,
        org.id,
      );
      expect(merged.name.value).toBe(b);
      expect((await call(page, "GET", `/businesses/${B.id}`, org.id)).status()).toBe(404);
      expect(await directoryTotal(page, org.id, `q=${run}&category=bakery`)).toBe(1);

      // 6. Undo restores both records exactly.
      const history = page.getByRole("list", { name: "Merge history" });
      await history
        .getByRole("button", { name: /Undo merge/ })
        .first()
        .click();
      await page
        .getByRole("alertdialog", { name: "Undo this merge?" })
        .getByRole("button", { name: "Undo merge" })
        .click();
      const force = page.getByRole("alertdialog", {
        name: "These records changed after the merge",
      });
      const undone = toast(page, "Merge undone");
      await expect(force.or(undone).first()).toBeVisible({ timeout: 30_000 });
      if (await force.isVisible()) await force.getByRole("button", { name: "Undo anyway" }).click();
      await expect(undone).toBeVisible();
      expect(
        (await api<{ name: { value: string } }>(page, "GET", `/businesses/${A.id}`, org.id)).name
          .value,
      ).toBe(a);
      expect(
        (await api<{ name: { value: string } }>(page, "GET", `/businesses/${B.id}`, org.id)).name
          .value,
      ).toBe(b);
      expect(await directoryTotal(page, org.id, `q=${run}&category=bakery`)).toBe(2);
      await expectNoHorizontalScroll(page, "after undo");
    } finally {
      await context.close();
    }
  });
});
