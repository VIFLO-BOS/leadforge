import { expect, test } from "@playwright/test";
import {
  api,
  apiAll,
  expectNoHorizontalScroll,
  FIXTURE_URL,
  fixture,
  primaryOrg,
  releaseOnly,
  sessionFor,
  shot,
} from "./helpers";

/*
 * Criteria 12 and 13 against the Paystack fixture server (apps/api/test/paystack-fake.ts behind the
 * stack's fixture front; the real Paystack test-mode run needs keys and is not part of this suite).
 *
 * 12. Pay through a verified Paystack workflow: Buy credits creates a checkout on the server (the
 *     browser only sends the pack id), the browser goes to the hosted checkout (served here by the
 *     fixture instead of checkout.paystack.com), pays, and comes back to the return page, which says
 *     "Confirming your payment" and adds nothing until Paystack's signed charge.success arrives and
 *     the server verifies it; then it shows the confirmed payment.
 * 13. The purchased credits are granted exactly once: the webhook is delivered three times, the
 *     return page is reloaded (which verifies again), and the balance still rose by exactly the pack
 *     once, with one purchase entry in the ledger. An invitation in a workspace at its member cap
 *     shows the member limit message.
 */

interface Payment {
  id: string;
  reference: string;
  status: string;
  amountMinor: number;
  currency: string;
  creditsGranted: number | null;
}

test.describe("C12 C13 Paystack payment and exact entitlements", () => {
  releaseOnly();

  test("C12 checkout, fixture Paystack, return page confirming then confirmed; C13 credits granted once", async ({
    browser,
    request,
  }, info) => {
    const { context, page } = await sessionFor(browser, info, "owner");
    try {
      await page.goto("/app");
      const org = await primaryOrg(page);
      const catalogue = await api<{
        creditPacks: {
          id: string;
          credits: number;
          priceMinor: number;
          currency: string;
          purchasable: boolean;
        }[];
      }>(page, "GET", "/billing/plans", org.id);
      const pack = catalogue.creditPacks.find((p) => p.purchasable);
      expect(pack, "the e2e catalogue has a test-priced credit pack").toBeTruthy();
      const before = await api<{ balance: number }>(page, "GET", "/credits/balance", org.id);
      const startedAt = new Date().toISOString();

      // The hosted checkout page is the fixture's; nothing reaches checkout.paystack.com.
      await context.route("https://checkout.paystack.com/**", (route) => {
        const access = new URL(route.request().url()).pathname.replace(/^\//, "");
        return route.fulfill({
          status: 302,
          headers: { location: `${FIXTURE_URL}/__e2e/checkout/${access}` },
        });
      });

      // 1. Buy credits: one checkout created on the server, with a fresh Idempotency-Key.
      await page.goto("/app/billing?tab=plans");
      const checkout = page.waitForRequest(
        (r) => r.method() === "POST" && r.url().endsWith("/api/v1/billing/checkout/credits"),
      );
      await page
        .locator("#main")
        .getByRole("button", { name: `Buy ${pack!.credits.toLocaleString("en-US")} credits` })
        .click();
      const sent = await checkout;
      expect(sent.headers()["idempotency-key"]).toBeTruthy();
      expect(JSON.parse(sent.postData() ?? "{}")).toEqual({ packId: pack!.id });

      // 2. The fixture's hosted checkout: the server's price, not the browser's.
      await page.waitForURL((u) => u.href.startsWith(`${FIXTURE_URL}/__e2e/checkout/`));
      await expect(page.getByTestId("fixture-amount")).toHaveText(
        `${pack!.currency} ${(pack!.priceMinor / 100).toLocaleString("en-NG", { minimumFractionDigits: 2 })}`,
      );
      const reference = ((await page.getByTestId("fixture-reference").textContent()) ?? "").trim();
      expect(reference).not.toBe("");
      await shot(page, info, "c12-fixture-checkout");
      await page.getByRole("button", { name: "Pay, confirm later (test)" }).click();

      // 3. Back on LeadForge: confirming, and nothing added yet.
      await page.waitForURL(
        (u) =>
          u.pathname === "/app/billing/return" && u.searchParams.get("reference") === reference,
      );
      const card = page.getByTestId("return-card");
      await expect(
        page.getByRole("heading", { level: 1, name: "Confirming your payment" }),
      ).toBeVisible();
      await expect(card.getByTestId("return-status")).toHaveText(/Confirming/);
      await expect(card.getByTestId("return-message")).toContainText(
        "added only after Paystack confirms",
      );
      await expectNoHorizontalScroll(page, "return page confirming");
      await shot(page, info, "c12-confirming");
      expect(
        (await api<{ balance: number }>(page, "GET", "/credits/balance", org.id)).balance,
      ).toBe(before.balance);
      expect(
        (await api<Payment>(page, "GET", `/billing/payments/${reference}`, org.id)).status,
      ).toBe("pending");

      // 4. Paystack completes the charge and delivers its signed webhook, three times.
      await fixture(
        request,
        "POST",
        `/__e2e/paystack/settle?reference=${encodeURIComponent(reference)}`,
      );
      const delivered = await fixture<{ statuses: number[] }>(
        request,
        "POST",
        `/__e2e/paystack/webhook?reference=${encodeURIComponent(reference)}&times=3`,
      );
      expect(delivered.statuses).toEqual([200, 200, 200]);
      await expect(page.getByRole("heading", { level: 1, name: "Payment confirmed" })).toBeVisible({
        timeout: 60_000,
      });
      await expect(card.getByTestId("return-status")).toHaveText(/Paid/);
      await expect(card.getByTestId("return-message")).toContainText(
        `${pack!.credits.toLocaleString("en-US")} credits were added`,
      );
      await expectNoHorizontalScroll(page, "return page confirmed");
      await shot(page, info, "c12-confirmed");

      // ---- C13: exactly once, after a reload (which verifies again) and more deliveries.
      await page.reload();
      await expect(page.getByRole("heading", { level: 1, name: "Payment confirmed" })).toBeVisible({
        timeout: 60_000,
      });
      await fixture(
        request,
        "POST",
        `/__e2e/paystack/webhook?reference=${encodeURIComponent(reference)}&times=2`,
      );
      await page.waitForTimeout(5_000);
      const after = await api<{ balance: number }>(page, "GET", "/credits/balance", org.id);
      expect(after.balance - before.balance).toBe(pack!.credits);
      const payment = await api<Payment>(page, "GET", `/billing/payments/${reference}`, org.id);
      expect(payment).toMatchObject({
        status: "success",
        creditsGranted: pack!.credits,
        amountMinor: pack!.priceMinor,
      });
      const purchases = (
        await apiAll<{ entryType: string; units: number; createdAt: string }>(
          page,
          "/credits/ledger?pageSize=100",
          org.id,
        )
      ).filter((e) => e.entryType === "purchase" && e.createdAt >= startedAt);
      expect(purchases.map((e) => e.units)).toEqual([pack!.credits]);
      const calls = await fixture<{ method: string; path: string }[]>(
        request,
        "GET",
        "/__e2e/paystack/calls",
      );
      expect(
        calls.filter((c) => c.path === `/transaction/verify/${reference}`).length,
        "the server verified with Paystack",
      ).toBeGreaterThan(0);

      // The Billing page shows the new balance and the payment.
      await page.goto("/app/billing");
      await expect(page.getByTestId("billing-balance")).toContainText(
        after.balance.toLocaleString("en-US"),
      );
      await page.getByRole("tab", { name: "Payments" }).click();
      await expect(page.getByTestId("payments-tab")).toContainText(reference.slice(0, 8));
      await expectNoHorizontalScroll(page, "payments tab");
    } finally {
      await context.close();
    }
  });

  test("C12 an abandoned subscription checkout is resumed on the same Paystack page, then declined honestly", async ({
    browser,
    request,
  }, info) => {
    const { context, page } = await sessionFor(browser, info, "owner");
    try {
      await page.goto("/app");
      const org = await primaryOrg(page);
      const catalogue = await api<{ plans: { id: string; name: string; purchasable: boolean }[] }>(
        page,
        "GET",
        "/billing/plans",
        org.id,
      );
      const plan = catalogue.plans.find((p) => p.purchasable);
      expect(plan, "the e2e catalogue has a test-priced plan").toBeTruthy();
      await context.route("https://checkout.paystack.com/**", (route) => {
        const access = new URL(route.request().url()).pathname.replace(/^\//, "");
        return route.fulfill({
          status: 302,
          headers: { location: `${FIXTURE_URL}/__e2e/checkout/${access}` },
        });
      });

      // 1. Start a subscription checkout and walk away from Paystack's page.
      await page.goto("/app/billing?tab=plans");
      await page
        .locator("#main")
        .getByRole("button", { name: `Choose ${plan!.name}` })
        .click();
      await page.waitForURL((u) => u.href.startsWith(`${FIXTURE_URL}/__e2e/checkout/`));
      const firstCheckout = page.url();
      const reference = ((await page.getByTestId("fixture-reference").textContent()) ?? "").trim();
      await page.goto("/app/billing");

      // 2. Billing offers to resume it while the link is fresh (Stage 9 authorizationUrl).
      const overview = await api<{
        pendingSubscription: {
          plan: { name: string };
          authorizationUrl?: string;
          authorizationUrlExpiresAt?: string;
        } | null;
      }>(page, "GET", "/billing/overview", org.id);
      expect(overview.pendingSubscription?.authorizationUrl).toMatch(
        /^https:\/\/checkout\.paystack\.com\//,
      );
      expect(Date.parse(overview.pendingSubscription!.authorizationUrlExpiresAt!)).toBeGreaterThan(
        Date.now(),
      );
      const banner = page.getByTestId("billing-pending-checkout");
      await expect(banner).toContainText(`${plan!.name} checkout is waiting for payment`);
      await expectNoHorizontalScroll(page, "pending checkout banner");
      await shot(page, info, "c12-resume-checkout");
      await banner.getByRole("button", { name: "Resume checkout" }).click();
      await page.waitForURL((u) => u.href === firstCheckout);
      await expect(page.getByTestId("fixture-reference")).toHaveText(reference);

      // 3. The card is declined: nothing is granted and the return page says so.
      await page.getByRole("button", { name: "Decline (test)" }).click();
      await page.waitForURL(
        (u) =>
          u.pathname === "/app/billing/return" && u.searchParams.get("reference") === reference,
      );
      await expect(page.getByRole("heading", { level: 1, name: "Payment failed" })).toBeVisible({
        timeout: 60_000,
      });
      await expect(page.getByTestId("return-message")).toContainText("nothing was added");
      const after = await api<{ subscription: unknown; pendingSubscription: unknown }>(
        page,
        "GET",
        "/billing/overview",
        org.id,
      );
      expect(after.subscription).toBeNull();
      await fixture(request, "GET", "/__e2e/health");
    } finally {
      await context.close();
    }
  });

  test("C13 an invitation in a workspace at its member cap shows the member limit", async ({
    browser,
  }, info) => {
    const { context, page } = await sessionFor(browser, info, "owner");
    try {
      await page.goto("/app");
      const org = await primaryOrg(page);
      const overview = await api<{
        members: { active: number; pendingInvitations: number; cap: number };
      }>(page, "GET", "/billing/overview", org.id);
      expect(overview.members.active + overview.members.pendingInvitations).toBeGreaterThanOrEqual(
        overview.members.cap,
      );
      await page.goto("/app/team");
      await page.locator("#main").getByRole("button", { name: "Invite member" }).click();
      const dialog = page.getByRole("dialog");
      await dialog.getByLabel("Email").fill(`capped.${Date.now().toString(36)}@e2e.example.test`);
      await dialog.getByRole("button", { name: "Send invitation" }).click();
      const limit = dialog.getByTestId("member-limit");
      await expect(limit).toBeVisible();
      await expect(limit).toContainText(`Member limit reached: ${overview.members.cap}`);
      await expectNoHorizontalScroll(page, "invite at the member cap");
      await shot(page, info, "c13-member-cap");
      const after = await api<{ members: { pendingInvitations: number } }>(
        page,
        "GET",
        "/billing/overview",
        org.id,
      );
      expect(after.members.pendingInvitations).toBe(overview.members.pendingInvitations);
    } finally {
      await context.close();
    }
  });
});
