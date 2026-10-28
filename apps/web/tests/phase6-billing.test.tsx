import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BillingCatalogue, PaymentView } from "@leadforge/contracts";
import { Toaster, TooltipProvider } from "@leadforge/ui";
import { BillingBanners } from "@/components/app/billing/billing-banners";
import { ProviderBanners } from "@/components/app/billing/billing-overview-tab";
import { PaymentsTab } from "@/components/app/billing/billing-history";
import { BillingPlansTab } from "@/components/app/billing/billing-plans-tab";
import { BillingReturnPage, referenceFrom } from "@/components/app/billing/billing-return-page";
import { InviteMemberDialog } from "@/components/app/team/invite-member-dialog";
import { ApiError } from "@/lib/api";
import {
  bannerDismissible,
  bannerHref,
  formatMoney,
  isPaymentSettled,
  parseMoneyInput,
  priceText,
  purchaseState,
  returnPhase,
  visibleBanners,
} from "@/lib/billing";
import { friendlyMessage, memberLimitDetails } from "@/lib/errors";
import { resetVerifyRequests } from "@/lib/hooks/use-billing";
import {
  PACKS,
  PAYMENTS,
  PAYMENT_PACK_ID,
  PLANS,
  PROVIDER_LIVE,
  PROVIDER_NONE,
  PROVIDER_TEST,
  banner,
  payment,
  subscription,
} from "../e2e/fixtures-phase6";
import { stubApi } from "./phase2-helpers";
import { setLocation } from "./phase3-helpers";

vi.mock("next/navigation", async () => (await import("./phase3-helpers")).navigationMock());

let role: "owner" | "admin" | "researcher" | "sales_rep" | "analyst" = "owner";
vi.mock("@/components/app/app-shell", async () => {
  const { workspace } = await import("./phase2-helpers");
  return { useWorkspace: () => workspace(role) };
});

beforeEach(() => {
  role = "owner";
  setLocation("/app/billing");
  resetVerifyRequests();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const ok = (data: unknown, status = 200) => ({ status, body: { data } });
const page = <T,>(data: T[]) => ({ data, meta: { nextCursor: null, pageSize: 25 } });

function renderUi(ui: React.ReactElement, strict = false) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const tree = (
    <QueryClientProvider client={client}>
      <TooltipProvider>
        {ui}
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
  return { client, ...render(strict ? <StrictMode>{tree}</StrictMode> : tree) };
}

function catalogue(o: Partial<BillingCatalogue> = {}): BillingCatalogue {
  return {
    plans: PLANS,
    creditPacks: PACKS,
    pricingPublished: true,
    provider: PROVIDER_LIVE,
    ...o,
  };
}

// ---------------------------------------------------------------------------
// Money, prices and purchase states
// ---------------------------------------------------------------------------

describe("money and prices", () => {
  it("formats minor units in the payload's currency and parses typed amounts", () => {
    expect(formatMoney(2500000, "NGN")).toBe("₦25,000.00");
    expect(formatMoney(1999, "USD")).toMatch(/19\.99/);
    expect(parseMoneyInput("25,000", "NGN")).toBe(2500000);
    expect(parseMoneyInput("₦1,200.5", "NGN")).toBe(120050);
    expect(parseMoneyInput("NGN 300", "NGN")).toBe(30000);
    expect(parseMoneyInput("12.345", "NGN")).toBeNull();
    expect(parseMoneyInput("1e5", "NGN")).toBeNull();
    expect(parseMoneyInput("", "NGN")).toBeNull();
  });

  it("never shows a placeholder or zero price as a price", () => {
    const placeholder = { ...PACKS[0]!, isPlaceholder: true, priceMinor: 0 };
    expect(priceText(placeholder, true)).toBe("Pricing not yet published");
    expect(priceText({ ...PACKS[0]!, priceMinor: 0 }, true)).toBe("Pricing not yet published");
    expect(priceText(PACKS[0]!, false)).toBe("Pricing not yet published");
    expect(priceText(PACKS[0]!, true)).toBe("₦15,000.00");
  });

  it("disables purchases without a provider whatever the item says", () => {
    expect(purchaseState(PACKS[0]!, { provider: PROVIDER_NONE })).toEqual({
      enabled: false,
      reason: "Payments are not set up yet, so nothing can be bought.",
    });
    expect(
      purchaseState(
        { purchasable: false, blocker: "price_not_published" },
        { provider: PROVIDER_LIVE },
      ).reason,
    ).toMatch(/not been published/);
    expect(purchaseState(PACKS[0]!, { provider: PROVIDER_LIVE })).toEqual({
      enabled: true,
      reason: null,
    });
  });
});

describe("plans and credit packs", () => {
  it("pricing not published: says so for every item and never renders ₦0", async () => {
    const unpublished = catalogue({
      pricingPublished: false,
      plans: PLANS.map((p) => ({
        ...p,
        isPlaceholder: true,
        priceMinor: 0,
        purchasable: false,
        blocker: "price_not_published" as const,
      })),
      creditPacks: PACKS.map((p) => ({
        ...p,
        isPlaceholder: true,
        priceMinor: 0,
        purchasable: false,
        blocker: "price_not_published" as const,
      })),
    });
    stubApi(() => undefined);
    renderUi(<BillingPlansTab catalogue={unpublished} onReload={() => {}} />);
    expect(screen.getByTestId("pricing-not-published")).toBeVisible();
    expect(screen.getAllByText("Pricing not yet published").length).toBeGreaterThanOrEqual(
      PLANS.length + PACKS.length,
    );
    expect(document.body.textContent).not.toMatch(/₦\s?0(\.00)?\b|NGN\s?0\b/);
    for (const b of screen.getAllByRole("button", { name: /Choose|Buy/ })) expect(b).toBeDisabled();
    expect(screen.getAllByTestId("purchase-blocked")[0]).toHaveTextContent(
      "This price has not been published yet",
    );
  });

  it("not configured: buttons are disabled and the reason is visible and linked", () => {
    const none = catalogue({
      provider: PROVIDER_NONE,
      plans: PLANS.map((p) => ({ ...p, purchasable: false, blocker: "not_configured" as const })),
      creditPacks: PACKS.map((p) => ({
        ...p,
        purchasable: false,
        blocker: "not_configured" as const,
      })),
    });
    stubApi(() => undefined);
    renderUi(<BillingPlansTab catalogue={none} onReload={() => {}} />);
    expect(screen.getByTestId("billing-not-configured")).toHaveTextContent(
      "Payments are not set up yet",
    );
    const buy = screen.getByRole("button", { name: "Buy 500 credits" });
    expect(buy).toBeDisabled();
    const reasonId = buy.getAttribute("aria-describedby");
    expect(reasonId).toBeTruthy();
    expect(document.getElementById(reasonId!)).toHaveTextContent("Payments are not set up yet");
  });

  it("sends a fresh Idempotency-Key on every click and goes to Paystack's page", async () => {
    const keys: string[] = [];
    let n = 0;
    stubApi((url, init) => {
      if (url.pathname === "/billing/checkout/credits") {
        keys.push(new Headers(init.headers).get("Idempotency-Key") ?? "");
        n += 1;
        if (n === 1)
          return {
            status: 502,
            body: { error: { code: "PAYMENT_PROVIDER_ERROR", message: "Down", requestId: "r1" } },
          };
        return ok(
          {
            paymentId: "p",
            reference: "lf-x",
            authorizationUrl: "https://checkout.paystack.com/abc",
            purpose: "credit_pack",
            amountMinor: 1500000,
            currency: "NGN",
            description: null,
          },
          201,
        );
      }
      return undefined;
    });
    const navigate = vi.fn();
    const user = userEvent.setup();
    renderUi(<BillingPlansTab catalogue={catalogue()} onReload={() => {}} navigate={navigate} />);
    await user.click(screen.getByRole("button", { name: "Buy 500 credits" }));
    expect(await screen.findByTestId("checkout-problem")).toHaveTextContent(
      "Paystack could not start the checkout",
    );
    expect(navigate).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Buy 500 credits" }));
    await waitFor(() => expect(navigate).toHaveBeenCalledWith("https://checkout.paystack.com/abc"));
    expect(keys).toHaveLength(2);
    expect(keys[0]).toMatch(/^checkout-[A-Za-z0-9-]{8,}$/);
    expect(keys[1]).toMatch(/^checkout-/);
    expect(keys[0]).not.toBe(keys[1]);
  });

  it("explains PRICE_NOT_PUBLISHED and CONFLICT and reloads the catalogue", async () => {
    let code = "PRICE_NOT_PUBLISHED";
    stubApi((url) =>
      url.pathname.startsWith("/billing/checkout/")
        ? {
            status: code === "CONFLICT" ? 409 : 422,
            body: {
              error: { code, message: "The workspace is already on this plan.", requestId: "r" },
            },
          }
        : undefined,
    );
    const reload = vi.fn();
    const user = userEvent.setup();
    renderUi(<BillingPlansTab catalogue={catalogue()} onReload={reload} />);
    await user.click(screen.getByRole("button", { name: "Choose Starter (Sample)" }));
    expect(await screen.findByTestId("checkout-problem")).toHaveTextContent(
      "This price is not published yet",
    );
    expect(reload).toHaveBeenCalledTimes(1);
    code = "CONFLICT";
    await user.click(screen.getByRole("button", { name: "Choose Starter (Sample)" }));
    await waitFor(() =>
      expect(screen.getByTestId("checkout-problem")).toHaveTextContent(
        "The workspace is already on this plan.",
      ),
    );
    expect(reload).toHaveBeenCalledTimes(2);
  });
});

// ---------------------------------------------------------------------------
// Return page state machine
// ---------------------------------------------------------------------------

describe("return page state machine (pure)", () => {
  const p = (o: Partial<PaymentView>) =>
    payment({ id: "x", reference: "lf-x", status: "pending", underReview: false, ...o });
  it("never reports success before the server does; review wins over status", () => {
    expect(
      returnPhase({
        reference: null,
        payment: undefined,
        verifyDone: false,
        timedOut: false,
        error: null,
      }),
    ).toBe("missing_reference");
    expect(
      returnPhase({
        reference: "r",
        payment: undefined,
        verifyDone: false,
        timedOut: false,
        error: null,
      }),
    ).toBe("verifying");
    expect(
      returnPhase({
        reference: "r",
        payment: p({}),
        verifyDone: true,
        timedOut: false,
        error: null,
      }),
    ).toBe("confirming");
    expect(
      returnPhase({
        reference: "r",
        payment: p({}),
        verifyDone: true,
        timedOut: true,
        error: null,
      }),
    ).toBe("slow");
    expect(
      returnPhase({
        reference: "r",
        payment: p({ status: "success" }),
        verifyDone: true,
        timedOut: true,
        error: null,
      }),
    ).toBe("success");
    expect(
      returnPhase({
        reference: "r",
        payment: p({ status: "success", underReview: true }),
        verifyDone: true,
        timedOut: false,
        error: null,
      }),
    ).toBe("under_review");
    expect(
      returnPhase({
        reference: "r",
        payment: undefined,
        verifyDone: true,
        timedOut: false,
        error: new ApiError({ code: "NOT_FOUND", status: 404, message: "x" }),
      }),
    ).toBe("not_found");
    expect(isPaymentSettled(p({ status: "abandoned" }))).toBe(true);
    expect(isPaymentSettled(p({ underReview: true }))).toBe(true);
    expect(isPaymentSettled(p({}))).toBe(false);
  });

  it("reads the reference from Paystack's return URL", () => {
    expect(referenceFrom(new URLSearchParams("trxref=lf-abc123&reference=lf-abc123"))).toBe(
      "lf-abc123",
    );
    expect(referenceFrom(new URLSearchParams("trxref=lf-abc123"))).toBe("lf-abc123");
    expect(referenceFrom(new URLSearchParams("reference=<script>"))).toBeNull();
    expect(referenceFrom(new URLSearchParams(""))).toBeNull();
  });
});

describe("return page (fake timers)", () => {
  /** Payments move from pending to `final` on the `after`-th GET. */
  function returnApi(final: Partial<PaymentView> | null, after = 2) {
    const calls = { verify: 0, get: 0 };
    const pending = payment({
      id: "p1",
      reference: "lf-e2e-ret",
      status: "pending",
      paidAt: null,
      creditsGranted: null,
      refundableMinor: 0,
    });
    stubApi((url, init) => {
      if (url.pathname === "/billing/payments/lf-e2e-ret/verify" && init.method === "POST") {
        calls.verify += 1;
        return ok({ queued: true, payment: pending }, 202);
      }
      if (url.pathname === "/billing/payments/lf-e2e-ret") {
        calls.get += 1;
        return ok(final && calls.get >= after ? { ...pending, ...final } : pending);
      }
      return undefined;
    });
    return calls;
  }
  /** Advances fake time, then drains the zero-delay timers TanStack Query notifies with. */
  const flush = async (ms = 0) => {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ms);
    });
    for (let i = 0; i < 3; i++) {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1);
      });
    }
  };

  beforeEach(() => {
    vi.useFakeTimers({
      toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"],
    });
    setLocation("/app/billing/return?trxref=lf-e2e-ret&reference=lf-e2e-ret");
  });

  it("verifies exactly once (even in strict mode), polls every 2 s, then confirms and announces once", async () => {
    const calls = returnApi({
      status: "success",
      paidAt: "2026-10-25T09:00:00.000Z",
      creditsGranted: 500,
    });
    renderUi(<BillingReturnPage />, true);
    await flush();
    expect(calls.verify).toBe(1);
    expect(screen.getByTestId("billing-return")).toHaveAttribute("data-phase", "confirming");
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Confirming your payment");
    expect(screen.queryByText(/Payment confirmed/)).toBeNull();
    await flush(2_000);
    expect(calls.get).toBe(1);
    expect(screen.getByTestId("billing-return")).toHaveAttribute("data-phase", "confirming");
    await flush(2_000);
    expect(calls.get).toBe(2);
    expect(screen.getByTestId("billing-return")).toHaveAttribute("data-phase", "success");
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Payment confirmed");
    expect(screen.getByTestId("return-announcer")).toHaveTextContent("Payment confirmed.");
    expect(screen.getByTestId("return-message")).toHaveTextContent("500 credits were added");
    // Polling stops once settled; verify was never repeated.
    await flush(10_000);
    expect(calls.get).toBe(2);
    expect(calls.verify).toBe(1);
  });

  for (const [name, final, phase, title] of [
    [
      "failed",
      { status: "failed" as const, gatewayResponse: "Declined" },
      "failed",
      "Payment failed",
    ],
    ["abandoned", { status: "abandoned" as const }, "abandoned", "Checkout not completed"],
    ["reversed", { status: "reversed" as const }, "reversed", "Payment reversed"],
    ["under review", { underReview: true }, "under_review", "Payment under review"],
  ] as const) {
    it(`stops at ${name}`, async () => {
      const calls = returnApi(final, 1);
      renderUi(<BillingReturnPage />);
      await flush();
      await flush(2_000);
      expect(screen.getByTestId("billing-return")).toHaveAttribute("data-phase", phase);
      expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(title);
      expect(screen.queryByText("Payment confirmed")).toBeNull();
      const before = calls.get;
      await flush(8_000);
      expect(calls.get).toBe(before);
    });
  }

  it("after about 60 s stops polling and says it is still confirming; Check again asks once", async () => {
    const calls = returnApi(null);
    renderUi(<BillingReturnPage />);
    await flush();
    await flush(58_000);
    expect(screen.getByTestId("billing-return")).toHaveAttribute("data-phase", "confirming");
    const polled = calls.get;
    expect(polled).toBeGreaterThanOrEqual(25);
    await flush(2_500);
    expect(screen.getByTestId("billing-return")).toHaveAttribute("data-phase", "slow");
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Still confirming");
    expect(screen.getByTestId("return-announcer")).toHaveTextContent(
      "Still confirming. We will notify you",
    );
    const stopped = calls.get;
    await flush(20_000);
    expect(calls.get).toBe(stopped);
    await act(async () => {
      screen.getByTestId("check-again").click();
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(calls.get).toBe(stopped + 1);
    expect(calls.verify).toBe(1);
  });

  it("an unknown reference is not found, and nothing is polled", async () => {
    let gets = 0;
    stubApi((url) => {
      if (url.pathname.endsWith("/verify"))
        return {
          status: 404,
          body: { error: { code: "NOT_FOUND", message: "Payment not found", requestId: "r" } },
        };
      if (url.pathname.startsWith("/billing/payments/")) gets += 1;
      return undefined;
    });
    renderUi(<BillingReturnPage />);
    await flush();
    await flush(4_000);
    expect(screen.getByTestId("billing-return")).toHaveAttribute("data-phase", "not_found");
    expect(gets).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Payments and refunds
// ---------------------------------------------------------------------------

describe("refund role gating", () => {
  function paymentsApi() {
    const refunds: unknown[] = [];
    stubApi((url, init) => {
      if (url.pathname === "/billing/payments") return { body: page(PAYMENTS) };
      if (url.pathname === `/billing/payments/${PAYMENT_PACK_ID}/refund`) {
        refunds.push(JSON.parse(String(init.body)));
        return ok(PAYMENTS[1], 202);
      }
      return undefined;
    });
    return refunds;
  }

  it("administrators see payments but no Refund", async () => {
    role = "admin";
    paymentsApi();
    renderUi(<PaymentsTab />);
    await screen.findAllByText("500 credits (Sample)");
    expect(screen.queryByTestId("refund-button")).toBeNull();
    expect(screen.getByText("Refunds are issued by owners of the workspace.")).toBeVisible();
    expect(screen.getAllByTestId("under-review").length).toBeGreaterThan(0);
  });

  it("owners refund successful payments only, after reading the consequences", async () => {
    const refunds = paymentsApi();
    const user = userEvent.setup();
    renderUi(<PaymentsTab />);
    await screen.findAllByText("500 credits (Sample)");
    // Pack and subscription payments are refundable; pending, failed, review and reversed are not.
    expect(screen.getAllByTestId("refund-button")).toHaveLength(2);
    await user.click(screen.getAllByTestId("refund-button")[0]!);
    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByTestId("refund-consequences")).toHaveTextContent("in proportion");
    expect(within(dialog).getByTestId("refund-consequences")).toHaveTextContent(
      "about 500 of the 500 credits",
    );
    expect(within(dialog).getByTestId("refund-consequences")).toHaveTextContent(
      "may go below zero",
    );
    await user.type(within(dialog).getByLabelText(/Amount to refund/), "200000");
    expect(within(dialog).getByText("At most ₦15,000.00 can be refunded.")).toBeVisible();
    expect(within(dialog).getByRole("button", { name: /^Refund/ })).toBeDisabled();
    await user.clear(within(dialog).getByLabelText(/Amount to refund/));
    await user.type(within(dialog).getByLabelText(/Amount to refund/), "5000");
    expect(within(dialog).getByTestId("refund-consequences")).toHaveTextContent(
      "about 167 of the 500 credits",
    );
    await user.click(within(dialog).getByRole("button", { name: "Refund ₦5,000.00" }));
    expect(await within(dialog).findByText(/Give a reason/)).toBeVisible();
    expect(refunds).toHaveLength(0);
    await user.type(within(dialog).getByLabelText(/Reason/), "Bought twice by mistake");
    await user.click(within(dialog).getByRole("button", { name: "Refund ₦5,000.00" }));
    await waitFor(() =>
      expect(refunds).toEqual([{ amountMinor: 500000, reason: "Bought twice by mistake" }]),
    );
  });
});

// ---------------------------------------------------------------------------
// Banners
// ---------------------------------------------------------------------------

describe("billing banner role rules", () => {
  const all = [
    banner("negative_balance"),
    banner("not_configured"),
    banner("past_due"),
    banner("payment_failed"),
  ];

  it("non-managers see only the negative balance, without a billing link", () => {
    expect(visibleBanners(all, false).map((b) => b.kind)).toEqual(["negative_balance"]);
    expect(visibleBanners(all, true)).toHaveLength(4);
    expect(bannerHref(banner("negative_balance"), false)).toBeNull();
    expect(bannerHref(banner("negative_balance"), true)).toBe("/app/billing");
    expect(bannerHref(banner("payment_failed", { href: "https://evil.example" }), true)).toBeNull();
  });

  it("negative balance and past due cannot be dismissed; information can, per session", () => {
    expect(bannerDismissible(banner("negative_balance"))).toBe(false);
    expect(bannerDismissible(banner("past_due"))).toBe(false);
    expect(bannerDismissible(banner("payment_failed"))).toBe(true);
    expect(bannerDismissible(banner("not_configured"))).toBe(true);
  });

  it("a researcher sees the negative balance only, even when the server sends more", async () => {
    role = "researcher";
    stubApi((url) => (url.pathname === "/billing/banners" ? ok({ banners: all }) : undefined));
    renderUi(<BillingBanners />);
    const shown = await screen.findByText("Credit balance below zero");
    expect(shown).toBeVisible();
    expect(screen.queryByText("A payment failed")).toBeNull();
    expect(screen.queryByText("Subscription payment overdue")).toBeNull();
    expect(screen.queryByRole("button", { name: /Dismiss/ })).toBeNull();
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("owners can dismiss a failed-payment banner for the session; the negative balance stays", async () => {
    window.sessionStorage.clear();
    stubApi((url) =>
      url.pathname === "/billing/banners"
        ? ok({ banners: [banner("negative_balance"), banner("payment_failed")] })
        : undefined,
    );
    const user = userEvent.setup();
    renderUi(<BillingBanners />);
    await screen.findByText("A payment failed");
    expect(screen.getAllByRole("button", { name: /^Dismiss/ })).toHaveLength(1);
    await user.click(screen.getByRole("button", { name: "Dismiss: A payment failed" }));
    expect(screen.queryByText("A payment failed")).toBeNull();
    expect(screen.getByText("Credit balance below zero")).toBeVisible();
    expect(screen.getByRole("link", { name: "Buy credits" })).toHaveAttribute(
      "href",
      "/app/billing?tab=plans#credit-packs",
    );
  });
});

// ---------------------------------------------------------------------------
// Member limit
// ---------------------------------------------------------------------------

describe("MEMBER_LIMIT_REACHED", () => {
  const limitError = {
    status: 402,
    body: {
      error: {
        code: "MEMBER_LIMIT_REACHED",
        message: "Your plan allows 5 members",
        details: [
          { path: "members.cap", message: "5" },
          { path: "members.used", message: "5" },
        ],
        requestId: "r",
      },
    },
  };

  it("reads the cap and use from the details", () => {
    const err = new ApiError({
      code: "MEMBER_LIMIT_REACHED",
      status: 402,
      message: "x",
      details: limitError.body.error.details,
    });
    expect(memberLimitDetails(err)).toEqual({ cap: 5, used: 5 });
    expect(friendlyMessage(err)).toBe(
      "The workspace's plan allows 5 members, counting pending invitations, and 5 are in use. Remove a member, revoke an invitation or change the plan.",
    );
  });

  it("the invite dialog shows the cap and, for managers, a link to the plans", async () => {
    stubApi((url, init) =>
      url.pathname === "/organizations/current/invitations" && init.method === "POST"
        ? limitError
        : undefined,
    );
    const user = userEvent.setup();
    renderUi(<InviteMemberDialog organizationId="6f1c2a7e-3b4d-4e5f-8a9b-0c1d2e3f4a5b" />);
    await user.click(screen.getByRole("button", { name: "Invite member" }));
    await user.type(screen.getByLabelText(/Email/), "new.person@example.test");
    await user.click(screen.getByRole("button", { name: "Send invitation" }));
    const limit = await screen.findByTestId("member-limit");
    expect(limit).toHaveTextContent("Member limit reached: 5 on this plan");
    expect(limit).toHaveTextContent("5 are in use");
    expect(within(limit).getByRole("link", { name: "See plans" })).toHaveAttribute(
      "href",
      "/app/billing?tab=plans",
    );
  });
});

// ---------------------------------------------------------------------------
// Stage 9: resuming an abandoned subscription checkout
// ---------------------------------------------------------------------------

describe("pending subscription checkout (Stage 9)", () => {
  const pending = (offset: number | null) => ({
    ...subscription({ status: "incomplete", renewsAt: null }),
    createdAt: new Date(Date.now() - 5 * 60_000).toISOString(),
    ...(offset === null
      ? {}
      : {
          authorizationUrl: "https://checkout.paystack.com/resume-sample",
          authorizationUrlExpiresAt: new Date(Date.now() + offset).toISOString(),
        }),
  });

  it("offers Resume checkout while the link is fresh and sends the browser to Paystack's page", async () => {
    const navigate = vi.fn();
    const user = userEvent.setup();
    renderUi(
      <ProviderBanners
        overview={{ provider: PROVIDER_TEST, pendingSubscription: pending(20 * 60_000) }}
        navigate={navigate}
      />,
    );
    const banner = screen.getByTestId("billing-pending-checkout");
    expect(banner).toHaveTextContent("Resume it to finish paying");
    await user.click(within(banner).getByRole("button", { name: "Resume checkout" }));
    expect(navigate).toHaveBeenCalledWith("https://checkout.paystack.com/resume-sample");
  });

  it("never offers a lapsed link, and stops offering one when it lapses", () => {
    vi.useFakeTimers();
    const { rerender } = renderUi(
      <ProviderBanners
        overview={{ provider: PROVIDER_TEST, pendingSubscription: pending(-1_000) }}
      />,
    );
    expect(screen.queryByRole("button", { name: "Resume checkout" })).toBeNull();
    expect(screen.getByTestId("billing-pending-checkout")).toHaveTextContent(
      "choose the plan again",
    );
    const client = new QueryClient();
    rerender(
      <QueryClientProvider client={client}>
        <ProviderBanners
          overview={{ provider: PROVIDER_TEST, pendingSubscription: pending(3_000) }}
        />
      </QueryClientProvider>,
    );
    expect(screen.getByRole("button", { name: "Resume checkout" })).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(3_100);
    });
    expect(screen.queryByRole("button", { name: "Resume checkout" })).toBeNull();
  });

  it("refuses a link that is not a web address", () => {
    const bad = { ...pending(20 * 60_000), authorizationUrl: "javascript:alert(1)" };
    renderUi(<ProviderBanners overview={{ provider: PROVIDER_TEST, pendingSubscription: bad }} />);
    expect(screen.queryByRole("button", { name: "Resume checkout" })).toBeNull();
  });
});
