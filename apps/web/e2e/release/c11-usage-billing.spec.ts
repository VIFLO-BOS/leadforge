import { expect, test } from "@playwright/test";
import {
  api,
  apiAll,
  expectNoHorizontalScroll,
  fixture,
  primaryOrg,
  releaseOnly,
  sessionFor,
  shot,
  statValue,
} from "./helpers";

/*
 * Criterion 11: accurate usage and billing information. The worker's usage rollup is queued now
 * (instead of waiting for its 10-minute schedule); the Usage page's totals then equal the sums of
 * the credit ledger, and the balance equals the API's. The Billing page shows the provider status
 * (Paystack test mode against the fixture), "Pricing not yet published" for every placeholder
 * price and never a ₦0 price, the free-tier entitlements with the member meter, and exactly the
 * banners the API returns.
 */

interface LedgerEntry {
  entryType: string;
  units: number;
  capturedUnits: number | null;
  referenceType: string | null;
  createdAt: string;
}

interface Usage {
  from: string;
  to: string;
  computedAt: string | null;
  totals: { credits_used: number; discovery_records: number; analyses: number; exports: number };
  credits: { balance: number; held: number };
}

const fmt = (n: number) => n.toLocaleString("en-US");

test.describe("C11 accurate usage and billing information", () => {
  releaseOnly();

  test("C11 usage totals equal the ledger; the billing page shows status, prices and entitlements honestly", async ({
    browser,
    request,
  }, info) => {
    const { context, page } = await sessionFor(browser, info, "owner");
    try {
      await page.goto("/app");
      const org = await primaryOrg(page);

      // 1. Roll usage up now, then compare it with the ledger.
      const asked = Date.now();
      await fixture(request, "POST", "/__e2e/maintenance/rollup-usage");
      let usage: Usage | null = null;
      await expect
        .poll(
          async () => {
            usage = await api<Usage>(page, "GET", "/usage?period=30d", org.id);
            return usage.computedAt ? new Date(usage.computedAt).getTime() >= asked - 1000 : false;
          },
          { timeout: 60_000, intervals: [1_000] },
        )
        .toBe(true);
      const u = usage as unknown as Usage;
      const ledger = await apiAll<LedgerEntry>(page, "/credits/ledger?pageSize=100", org.id);
      const inPeriod = ledger.filter(
        (e) => e.createdAt.slice(0, 10) >= u.from && e.createdAt.slice(0, 10) <= u.to,
      );
      const captured = (ref?: string) =>
        inPeriod
          .filter((e) => e.entryType === "capture" && (!ref || e.referenceType === ref))
          .reduce((n, e) => n + (e.capturedUnits ?? 0), 0);
      expect(u.totals.credits_used).toBe(captured());
      expect(u.totals.discovery_records).toBe(captured("discovery_job"));
      expect(u.totals.analyses).toBe(captured("website_analysis"));
      const balance = await api<{ balance: number; held: number }>(
        page,
        "GET",
        "/credits/balance",
        org.id,
      );
      expect(u.credits.balance).toBe(balance.balance);
      // Holds are negative, releases and grants positive, captures 0: the units add up to the balance.
      expect(
        ledger.reduce((n, e) => n + e.units, 0),
        "the ledger adds up to the balance",
      ).toBe(balance.balance);

      await page.goto("/app/usage");
      await expect(page.getByRole("heading", { level: 1, name: /Usage/ })).toBeVisible();
      const totals = page.getByTestId("usage-totals");
      expect(await statValue(totals, "Credits used")).toBe(fmt(u.totals.credits_used));
      expect(await statValue(totals, "Discovery records")).toBe(fmt(u.totals.discovery_records));
      expect(await statValue(totals, "Website analyses")).toBe(fmt(u.totals.analyses));
      expect(await statValue(totals, "Exports")).toBe(fmt(u.totals.exports));
      expect(await statValue(page, "Available now")).toBe(fmt(balance.balance));
      await expectNoHorizontalScroll(page, "usage");
      await shot(page, info, "c11-usage");

      // 2. Billing: provider status, credits, entitlements, banners.
      const overview = await api<{
        provider: { configured: boolean; mode: string };
        credits: { balance: number };
        members: { active: number; pendingInvitations: number; cap: number };
        pricingPublished: boolean;
        banners: { kind: string; title: string }[];
      }>(page, "GET", "/billing/overview", org.id);
      expect(overview.provider).toMatchObject({ configured: true, mode: "test" });
      await page.goto("/app/billing");
      const main = page.locator("#main");
      await expect(page.getByRole("heading", { level: 1, name: "Billing" })).toBeVisible();
      await expect(main.getByTestId("billing-test-mode")).toContainText("Test mode");
      await expect(main.getByTestId("billing-not-configured")).toHaveCount(0);
      await expect(main.getByTestId("plan-name")).toContainText(/Free/);
      await expect(main.getByTestId("billing-balance")).toContainText(
        fmt(overview.credits.balance),
      );
      const used = overview.members.active + overview.members.pendingInvitations;
      await expect(main.getByTestId("members-meter")).toContainText(
        `${used} of ${overview.members.cap}`,
      );
      const banners = await api<{ kind: string; title: string }[]>(
        page,
        "GET",
        "/billing/banners",
        org.id,
      );
      if (banners.length) {
        for (const b of banners)
          await expect(page.getByTestId("billing-banners")).toContainText(b.title);
      } else {
        await expect(page.getByTestId("billing-banners")).toHaveCount(0);
      }
      await expectNoHorizontalScroll(page, "billing overview");
      await shot(page, info, "c11-billing");

      // 3. Prices: placeholders are never shown as a price, and never as ₦0.
      const plans = await api<{
        plans: { name: string; isPlaceholder: boolean; priceMinor: number; purchasable: boolean }[];
        creditPacks: { credits: number; isPlaceholder: boolean; purchasable: boolean }[];
      }>(page, "GET", "/billing/plans", org.id);
      await page.getByRole("tab", { name: "Plans and credits" }).click();
      await expect(page).toHaveURL(/tab=plans/);
      expect(overview.pricingPublished).toBe(false);
      const prices = main.getByTestId("price");
      await expect(prices).toHaveCount(plans.plans.length + plans.creditPacks.length);
      for (const text of await prices.allTextContents())
        expect(text).toContain("Pricing not yet published");
      await expect(main).not.toContainText(/₦\s?0(\.00)?\b/);
      await expect(main).not.toContainText(/NGN\s?0(\.00)?\b/);
      // Test mode lets the placeholder prices be bought: every button follows the API's `purchasable`.
      for (const p of plans.creditPacks) {
        const button = main.getByRole("button", { name: `Buy ${fmt(p.credits)} credits` });
        if (p.purchasable) await expect(button).toBeEnabled();
        else await expect(button).toBeDisabled();
      }
      await expectNoHorizontalScroll(page, "billing plans");
      await shot(page, info, "c11-plans");
    } finally {
      await context.close();
    }
  });
});
