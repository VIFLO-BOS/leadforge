import { expect, test } from "@playwright/test";
import {
  api,
  call,
  expectNoHorizontalScroll,
  primaryOrg,
  releaseOnly,
  runId,
  sessionFor,
  shot,
} from "./helpers";

/*
 * Criterion 2: a properly isolated workspace. Two people in two organizations (the seeded owner
 * and the rival owner of this project): neither sees the other's businesses in the directory, a
 * pasted detail URL of the other workspace shows the not-found state, the API refuses the other
 * organization's header, and the organization switcher lists only the person's own organizations.
 */

test.describe("C2 properly isolated workspace", () => {
  releaseOnly();

  test("C2 two organizations: directory, foreign URLs, API header and the organization switcher", async ({
    browser,
  }, info) => {
    const run = runId();
    const owner = await sessionFor(browser, info, "owner");
    const rival = await sessionFor(browser, info, "rival");
    try {
      await owner.page.goto("/app");
      await rival.page.goto("/app");
      const ownerOrg = await primaryOrg(owner.page);
      const rivalOrg = await primaryOrg(rival.page);
      expect(ownerOrg.id).not.toBe(rivalOrg.id);

      // Each side writes something only it may see.
      const ownerName = `Owner Only Bakery ${run} (Sample)`;
      const ownerBiz = await api<{ id: string }>(owner.page, "POST", "/businesses", ownerOrg.id, {
        name: ownerName,
        phones: ["+442079460700"],
        location: { locality: "Ikeja", region: "Lagos" },
        categories: ["Bakery"],
      });
      const rivalBiz = (
        await api<{ id: string; name: string }[]>(
          rival.page,
          "GET",
          `/businesses?q=${encodeURIComponent("Rival Secret")}`,
          rivalOrg.id,
        )
      )[0];
      expect(rivalBiz, "the seed gives the rival organization one business").toBeTruthy();
      const rivalList = await api<{ id: string }>(rival.page, "POST", "/lists", rivalOrg.id, {
        name: `Rival list ${run} (Sample)`,
      });

      // 1. The directory never shows the other organization's rows.
      await owner.page.goto(`/app/businesses?q=${encodeURIComponent("Rival Secret")}`);
      await expect(owner.page.getByRole("heading", { level: 1, name: "Businesses" })).toBeVisible();
      await expect(owner.page.locator("#main")).toContainText(
        /No businesses match|No businesses yet|0 businesses/,
      );
      await expect(
        owner.page.locator("#main").getByRole("link", { name: /Rival Secret Pharmacy/ }),
      ).toHaveCount(0);
      await expectNoHorizontalScroll(owner.page, "owner directory search");
      await rival.page.goto(`/app/businesses?q=${encodeURIComponent(ownerName)}`);
      await expect(rival.page.locator("#main")).toContainText(
        /No businesses match|No businesses yet|0 businesses/,
      );
      await expect(rival.page.locator("#main").getByRole("link", { name: ownerName })).toHaveCount(
        0,
      );

      // 2. Pasted foreign detail URLs show the not-found state.
      await owner.page.goto(`/app/businesses/${rivalBiz!.id}`);
      await expect(
        owner.page.getByRole("heading", { level: 1, name: "Business not found" }),
      ).toBeVisible();
      await expect(owner.page.getByText("We could not find this business")).toBeVisible();
      await expect(owner.page.locator("#main")).not.toContainText("Rival Secret Pharmacy");
      await shot(owner.page, info, "c02-foreign-business");
      await owner.page.goto(`/app/lists/${rivalList.id}`);
      await expect(
        owner.page.getByRole("heading", { level: 1, name: "List not found" }),
      ).toBeVisible();
      await rival.page.goto(`/app/businesses/${ownerBiz.id}`);
      await expect(
        rival.page.getByRole("heading", { level: 1, name: "Business not found" }),
      ).toBeVisible();

      // 3. The API: a foreign id is 404 in your own organization, and a foreign organization header is refused.
      expect(
        (await call(owner.page, "GET", `/businesses/${rivalBiz!.id}`, ownerOrg.id)).status(),
      ).toBe(404);
      const foreignHeader = await call(owner.page, "GET", "/businesses", rivalOrg.id);
      expect([403, 404]).toContain(foreignHeader.status());
      expect(JSON.stringify(await foreignHeader.json())).not.toContain("Rival Secret Pharmacy");

      // 4. The switcher lists only the person's own organizations.
      await owner.page.goto("/app");
      await owner.page.getByRole("button", { name: /^Switch organization\. Current: / }).click();
      const items = owner.page.getByRole("menuitem");
      await expect(items).toHaveCount(1);
      await expect(items.first()).toContainText(ownerOrg.name);
      await expect(owner.page.getByRole("menu")).not.toContainText(rivalOrg.name);
      await expectNoHorizontalScroll(owner.page, "organization switcher");
      await shot(owner.page, info, "c02-switcher");
      await owner.page.keyboard.press("Escape");
    } finally {
      await owner.context.close();
      await rival.context.close();
    }
  });
});
