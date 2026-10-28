import type { Route } from "@playwright/test";
import type {
  BillingBanner,
  BillingBannerKind,
  BillingCatalogue,
  BillingCreditPack,
  BillingOverview,
  BillingPlan,
  BillingProviderStatus,
  EntitlementsView,
  InvoiceView,
  PaymentView,
  RefundView,
  SubscriptionView,
} from "@leadforge/contracts";

/*
 * Synthetic Phase 6 (billing) fixtures and a stateful mock for the billing endpoints. Every plan,
 * pack and payment is "(Sample)". The mock keeps per-page state: a cancelled or resumed
 * subscription, a requested refund and a created checkout persist for the page, and payments on
 * the return page move from pending to their final state after a few polls, so the return page's
 * state machine runs against it. Factories give every field a default.
 */

export const ORG_ID = "6f1c2a7e-3b4d-4e5f-8a9b-0c1d2e3f4a5b";
const NOW = "2026-10-25T09:00:00.000Z";
const LAST_WEEK = "2026-10-19T11:00:00.000Z";
const NEXT_MONTH = "2026-11-25T09:00:00.000Z";
const uuid = (n: number) => `8b0c${n.toString(16).padStart(4, "0")}-1d2e-4f3a-8b4c-5d6e7f8a9b0c`;

export const PLAN_STARTER_ID = uuid(0x6101);
export const PLAN_GROWTH_ID = uuid(0x6102);
export const PACK_SMALL_ID = uuid(0x6201);
export const PACK_LARGE_ID = uuid(0x6202);
export const SUBSCRIPTION_ID = uuid(0x6301);
export const PAYMENT_PACK_ID = uuid(0x6401);
export const PAYMENT_SUB_ID = uuid(0x6402);
export const PAYMENT_FAILED_ID = uuid(0x6403);
export const PAYMENT_PENDING_ID = uuid(0x6404);
export const PAYMENT_REVIEW_ID = uuid(0x6405);
export const PAYMENT_REVERSED_ID = uuid(0x6406);
export const PAYMENT_NEW_ID = uuid(0x64aa);
export const INVOICE_1_ID = uuid(0x6501);
export const INVOICE_2_ID = uuid(0x6502);

/** Return-page references and what each becomes (after `polls` GETs). */
export const RETURN_REFS = {
  success: "lf-e2e-success",
  failed: "lf-e2e-failed",
  abandoned: "lf-e2e-abandoned",
  review: "lf-e2e-review",
  reversed: "lf-e2e-reversed",
  slow: "lf-e2e-slow",
  /** Already final when verified (plain a11y routes: nothing changes while axe runs). */
  paid: "lf-e2e-paid",
  /** Created by a checkout click in the mock. */
  created: "lf-e2e-new",
  unknown: "lf-e2e-unknown",
} as const;

export const PROVIDER_LIVE: BillingProviderStatus = {
  provider: "paystack",
  configured: true,
  mode: "live",
};
export const PROVIDER_TEST: BillingProviderStatus = {
  provider: "paystack",
  configured: true,
  mode: "test",
};
export const PROVIDER_NONE: BillingProviderStatus = {
  provider: "paystack",
  configured: false,
  mode: null,
};

export function plan(
  o: Partial<BillingPlan> & Pick<BillingPlan, "id" | "code" | "name">,
): BillingPlan {
  return {
    description: "Sample plan for the e2e suite (Sample).",
    interval: "monthly",
    priceMinor: 2500000,
    currency: "NGN",
    includedCredits: 500,
    maxMembers: 10,
    exportRowCap: 25000,
    discoveryEnabled: true,
    websiteAnalysisEnabled: true,
    isPlaceholder: false,
    purchasable: true,
    blocker: null,
    ...o,
  };
}

export function pack(
  o: Partial<BillingCreditPack> & Pick<BillingCreditPack, "id" | "code" | "name">,
): BillingCreditPack {
  return {
    credits: 500,
    priceMinor: 1500000,
    currency: "NGN",
    isPlaceholder: false,
    purchasable: true,
    blocker: null,
    ...o,
  };
}

export function payment(
  o: Partial<PaymentView> & Pick<PaymentView, "id" | "reference">,
): PaymentView {
  return {
    purpose: "credit_pack",
    status: "success",
    description: "500 credits (Sample)",
    amountMinor: 1500000,
    currency: "NGN",
    creditsGranted: 500,
    channel: "card",
    card: { brand: "visa", last4: "4081", expMonth: "12", expYear: "2030", bank: "Sample Bank" },
    gatewayResponse: "Approved",
    invoiceId: null,
    initiatedAt: LAST_WEEK,
    paidAt: LAST_WEEK,
    verifiedAt: LAST_WEEK,
    failedAt: null,
    reversedAt: null,
    refundedMinor: 0,
    refundableMinor: 1500000,
    refunds: [],
    underReview: false,
    ...o,
  };
}

export function refund(o: Partial<RefundView> & Pick<RefundView, "id">): RefundView {
  return {
    status: "pending",
    amountMinor: 1500000,
    currency: "NGN",
    reason: "Requested by the customer (Sample)",
    reversalUnits: null,
    failureReason: null,
    createdAt: NOW,
    processedAt: null,
    ...o,
  };
}

export function invoice(o: Partial<InvoiceView> & Pick<InvoiceView, "id" | "number">): InvoiceView {
  return {
    status: "paid",
    lines: [
      {
        description: "500 credits (Sample)",
        quantity: 1,
        unitMinor: 1500000,
        amountMinor: 1500000,
      },
    ],
    subtotalMinor: 1500000,
    taxMinor: 0,
    totalMinor: 1500000,
    currency: "NGN",
    issuedAt: LAST_WEEK,
    paidAt: LAST_WEEK,
    periodStart: null,
    periodEnd: null,
    paymentReference: "lf-e2e-pack-1",
    subscriptionId: null,
    pdfReady: true,
    ...o,
  };
}

export function subscription(o: Partial<SubscriptionView> = {}): SubscriptionView {
  return {
    id: SUBSCRIPTION_ID,
    status: "active",
    plan: {
      id: PLAN_GROWTH_ID,
      code: "growth",
      name: "Growth (Sample)",
      interval: "monthly",
      priceMinor: 2500000,
      currency: "NGN",
      includedCredits: 500,
    },
    currentPeriodStart: "2026-10-25T09:00:00.000Z",
    currentPeriodEnd: NEXT_MONTH,
    renewsAt: NEXT_MONTH,
    cancelAtPeriodEnd: false,
    cancelledAt: null,
    pastDueAt: null,
    endedAt: null,
    providerLinked: true,
    createdAt: "2026-09-25T09:00:00.000Z",
    ...o,
  };
}

export const PLANS: BillingPlan[] = [
  plan({
    id: PLAN_STARTER_ID,
    code: "starter",
    name: "Starter (Sample)",
    priceMinor: 1000000,
    includedCredits: 100,
    maxMembers: 5,
    exportRowCap: 10000,
    websiteAnalysisEnabled: false,
  }),
  plan({ id: PLAN_GROWTH_ID, code: "growth", name: "Growth (Sample)" }),
];

export const PACKS: BillingCreditPack[] = [
  pack({ id: PACK_SMALL_ID, code: "pack_500", name: "500 credits (Sample)" }),
  pack({
    id: PACK_LARGE_ID,
    code: "pack_2000",
    name: "2,000 credits (Sample)",
    credits: 2000,
    priceMinor: 5000000,
  }),
];

export const PAYMENTS: PaymentView[] = [
  payment({
    id: PAYMENT_PENDING_ID,
    reference: "lf-e2e-pending",
    status: "pending",
    paidAt: null,
    verifiedAt: null,
    creditsGranted: null,
    refundableMinor: 0,
    initiatedAt: NOW,
    card: null,
    gatewayResponse: null,
  }),
  payment({ id: PAYMENT_PACK_ID, reference: "lf-e2e-pack-1", invoiceId: INVOICE_1_ID }),
  payment({
    id: PAYMENT_SUB_ID,
    reference: "lf-e2e-sub-1",
    purpose: "subscription",
    description: "Growth (Sample), monthly",
    amountMinor: 2500000,
    refundableMinor: 2500000,
    invoiceId: INVOICE_2_ID,
  }),
  payment({
    id: PAYMENT_FAILED_ID,
    reference: "lf-e2e-failed-1",
    status: "failed",
    paidAt: null,
    verifiedAt: null,
    failedAt: LAST_WEEK,
    creditsGranted: null,
    refundableMinor: 0,
    gatewayResponse: "Declined (Sample)",
  }),
  payment({
    id: PAYMENT_REVIEW_ID,
    reference: "lf-e2e-review-1",
    status: "pending",
    paidAt: null,
    creditsGranted: null,
    refundableMinor: 0,
    underReview: true,
  }),
  payment({
    id: PAYMENT_REVERSED_ID,
    reference: "lf-e2e-reversed-1",
    status: "reversed",
    refundedMinor: 1500000,
    refundableMinor: 0,
    reversedAt: NOW,
    refunds: [
      refund({ id: uuid(0x6601), status: "processed", reversalUnits: 500, processedAt: NOW }),
    ],
  }),
];

export const INVOICES: InvoiceView[] = [
  invoice({
    id: INVOICE_2_ID,
    number: "LF-2026-000002",
    lines: [
      {
        description: "Growth (Sample), monthly",
        quantity: 1,
        unitMinor: 2500000,
        amountMinor: 2500000,
      },
    ],
    subtotalMinor: 2500000,
    totalMinor: 2500000,
    periodStart: "2026-10-25T09:00:00.000Z",
    periodEnd: NEXT_MONTH,
    paymentReference: "lf-e2e-sub-1",
    subscriptionId: SUBSCRIPTION_ID,
  }),
  invoice({ id: INVOICE_1_ID, number: "LF-2026-000001" }),
];

const ENTITLEMENTS_PLAN: EntitlementsView = {
  maxMembers: 10,
  exportRowCap: 25000,
  discoveryEnabled: true,
  websiteAnalysisEnabled: true,
  monthlyIncludedCredits: 500,
  sources: {
    maxMembers: "plan",
    exportRowCap: "plan",
    discoveryEnabled: "plan",
    websiteAnalysisEnabled: "override",
    monthlyIncludedCredits: "plan",
  },
  basis: { kind: "subscription", planCode: "growth", planName: "Growth (Sample)" },
};

const ENTITLEMENTS_FREE: EntitlementsView = {
  maxMembers: 5,
  exportRowCap: 10000,
  discoveryEnabled: true,
  websiteAnalysisEnabled: true,
  monthlyIncludedCredits: 0,
  sources: {
    maxMembers: "free",
    exportRowCap: "free",
    discoveryEnabled: "free",
    websiteAnalysisEnabled: "free",
    monthlyIncludedCredits: "free",
  },
  basis: { kind: "free", planCode: null, planName: null },
};

export function banner(kind: BillingBannerKind, o: Partial<BillingBanner> = {}): BillingBanner {
  const base: Record<BillingBannerKind, Omit<BillingBanner, "kind">> = {
    negative_balance: {
      severity: "error",
      title: "Credit balance below zero",
      message:
        "The balance is -120 credits after a refund. New discovery jobs and website analyses are paused until credits are bought.",
      href: "/app/billing",
      since: NOW,
    },
    not_configured: {
      severity: "info",
      title: "Payments are not set up",
      message: "Paystack is not configured on this server, so plans and credits cannot be bought.",
      href: "/app/billing",
      since: null,
    },
    past_due: {
      severity: "error",
      title: "Subscription payment overdue",
      message: "The renewal of Growth (Sample) failed. Update the card to keep the plan.",
      href: "/app/billing",
      since: NOW,
    },
    payment_failed: {
      severity: "warning",
      title: "A payment failed",
      message: "The latest payment did not go through. Nothing was charged.",
      href: "/app/billing",
      since: LAST_WEEK,
    },
  };
  return { kind, ...base[kind], ...o };
}

/** Pages with their primary request, for the controls-fit, motion and a11y suites. */
export const PHASE6_ROUTES = [
  "/app/billing",
  "/app/billing?tab=plans",
  "/app/billing?tab=payments",
  "/app/billing?tab=invoices",
  `/app/billing/return?reference=${RETURN_REFS.paid}`,
  "/app/settings?tab=pipeline",
] as const;

export interface Phase6Options {
  role?: string;
  empty?: boolean;
  /** Payment provider: live (default), test keys, or not configured. */
  provider?: "live" | "test" | "none";
  /** Prices are placeholders (pricingPublished false). */
  unpublished?: boolean;
  /** The workspace's subscription. */
  subscription?: "active" | "none" | "cancelling" | "past_due" | "unlinked";
  /** Banner kinds GET /billing/banners returns (filtered by role like the server, unless leakBanners). */
  banners?: BillingBannerKind[];
  /** Return every banner kind to every role (tests the client's own role filter). */
  leakBanners?: boolean;
  /** POST /billing/checkout/* answers with this error. */
  checkoutError?:
    "PRICE_NOT_PUBLISHED" | "PAYMENT_PROVIDER_ERROR" | "CONFLICT" | "BILLING_NOT_CONFIGURED";
  /** POST /organizations/current/invitations answers 402 MEMBER_LIMIT_REACHED. */
  memberLimit?: boolean;
  /** The credit balance is below zero (overview credits). */
  negativeBalance?: boolean;
  /**
   * An incomplete subscription checkout (Stage 9): `resumable` carries Paystack's
   * `authorizationUrl` with an expiry 25 minutes ahead of the real clock; `expired` carries one
   * that lapsed a minute ago (the page must not offer it); `plain` has none.
   */
  pendingCheckout?: "resumable" | "expired" | "plain";
}

/** The hosted checkout a resumable pending subscription points at (tests intercept it). */
export const RESUME_CHECKOUT_URL = "https://checkout.paystack.com/e2e-resume-sample";

function json(route: Route, status: number, body: unknown) {
  return route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
}
function err(
  route: Route,
  status: number,
  code: string,
  message: string,
  details?: { path: string; message: string }[],
) {
  return json(route, status, { error: { code, message, details, requestId: "e2e" } });
}

const MANAGERS = new Set(["owner", "admin"]);
const MANAGER_ONLY_BANNERS = new Set<BillingBannerKind>([
  "not_configured",
  "past_due",
  "payment_failed",
]);

/** Creates the billing mock for one page; returns null for paths it does not own. */
export function createPhase6Mock(opts: Phase6Options = {}) {
  const role = opts.role ?? "owner";
  const manager = MANAGERS.has(role);
  const provider =
    opts.provider === "none"
      ? PROVIDER_NONE
      : opts.provider === "test"
        ? PROVIDER_TEST
        : PROVIDER_LIVE;
  const published = !opts.unpublished;
  let sub: SubscriptionView | null =
    opts.subscription === "none"
      ? null
      : opts.subscription === "cancelling"
        ? subscription({ cancelAtPeriodEnd: true, renewsAt: null })
        : opts.subscription === "past_due"
          ? subscription({ status: "past_due", pastDueAt: NOW })
          : opts.subscription === "unlinked"
            ? subscription({ providerLinked: false })
            : opts.empty
              ? null
              : subscription();
  const payments = new Map((opts.empty ? [] : PAYMENTS).map((p) => [p.id, { ...p }]));
  const polls: Record<string, number> = {};
  let created: PaymentView | null = null;

  const blocker = (item: { isPlaceholder: boolean; priceMinor: number }, isCurrent = false) => {
    if (!provider.configured) return "not_configured" as const;
    if (isCurrent) return "current_plan" as const;
    if ((item.isPlaceholder || item.priceMinor <= 0) && provider.mode !== "test")
      return "price_not_published" as const;
    return null;
  };

  const catalogue = (): BillingCatalogue => {
    const plans = PLANS.map((p) => {
      const placeholder = opts.unpublished ? { isPlaceholder: true, priceMinor: 0 } : {};
      const item = { ...p, ...placeholder };
      const b = blocker(item, sub?.status === "active" && sub.plan.id === p.id);
      return { ...item, purchasable: b === null, blocker: b };
    });
    const creditPacks = PACKS.map((p) => {
      const placeholder = opts.unpublished ? { isPlaceholder: true, priceMinor: 0 } : {};
      const item = { ...p, ...placeholder };
      const b = blocker(item);
      return { ...item, purchasable: b === null, blocker: b };
    });
    return { plans, creditPacks, pricingPublished: published, provider };
  };

  const banners = (): BillingBanner[] => {
    const kinds = opts.banners ?? [];
    return kinds
      .filter((k) => opts.leakBanners || manager || !MANAGER_ONLY_BANNERS.has(k))
      .map((k) => banner(k, k === "negative_balance" && !manager ? { href: null } : {}));
  };

  const pendingSubscription = (): BillingOverview["pendingSubscription"] => {
    if (!opts.pendingCheckout) return null;
    const startedAt = new Date(Date.now() - 5 * 60_000).toISOString();
    const base = {
      ...subscription({ id: uuid(0x6901), status: "incomplete", renewsAt: null }),
      createdAt: startedAt,
    };
    if (opts.pendingCheckout === "plain") return base;
    const offset = opts.pendingCheckout === "resumable" ? 25 * 60_000 : -60_000;
    return {
      ...base,
      authorizationUrl: RESUME_CHECKOUT_URL,
      authorizationUrlExpiresAt: new Date(Date.now() + offset).toISOString(),
    };
  };

  const overview = (): BillingOverview => ({
    provider,
    subscription: sub,
    pendingSubscription: pendingSubscription(),
    entitlements: sub ? ENTITLEMENTS_PLAN : ENTITLEMENTS_FREE,
    credits: { balance: opts.negativeBalance ? -120 : 877, held: opts.negativeBalance ? 0 : 27 },
    members: { active: 4, pendingInvitations: 1, cap: sub ? 10 : 5 },
    latestPayment: opts.empty ? null : (payments.get(PAYMENT_PACK_ID) ?? null),
    banners: banners(),
    pricingPublished: published,
  });

  /** A return-page payment: pending, then its final state after `after` polls. */
  const returnPayment = (reference: string): PaymentView | null => {
    const pending = payment({
      id: uuid(0x6700 + reference.length),
      reference,
      status: "pending",
      paidAt: null,
      verifiedAt: null,
      creditsGranted: null,
      refundableMinor: 0,
      initiatedAt: NOW,
      card: null,
      gatewayResponse: null,
    });
    const n = polls[reference] ?? 0;
    const final = (after: number, p: Partial<PaymentView>) =>
      n >= after ? { ...pending, ...p } : pending;
    switch (reference) {
      case RETURN_REFS.success:
        return final(2, {
          status: "success",
          paidAt: NOW,
          verifiedAt: NOW,
          creditsGranted: 500,
          refundableMinor: 1500000,
          card: payment({ id: "x", reference: "x" }).card,
        });
      case RETURN_REFS.failed:
        return final(1, {
          status: "failed",
          failedAt: NOW,
          gatewayResponse: "Declined by the bank (Sample)",
        });
      case RETURN_REFS.abandoned:
        return final(1, { status: "abandoned" });
      case RETURN_REFS.review:
        return final(1, { underReview: true });
      case RETURN_REFS.reversed:
        return final(1, { status: "reversed", reversedAt: NOW });
      case RETURN_REFS.slow:
        return pending;
      case RETURN_REFS.paid:
        return {
          ...pending,
          status: "success",
          paidAt: NOW,
          verifiedAt: NOW,
          creditsGranted: 500,
          refundableMinor: 1500000,
        };
      case RETURN_REFS.created:
        return created
          ? n >= 2
            ? { ...created, status: "success", paidAt: NOW, verifiedAt: NOW, creditsGranted: 2000 }
            : created
          : null;
      default: {
        const known = [...payments.values()].find((p) => p.reference === reference);
        return known ?? null;
      }
    }
  };

  return function handle(
    route: Route,
    url: URL,
    path: string,
    method: string,
  ): Promise<void> | null {
    if (path === "/organizations/current/invitations" && method === "POST" && opts.memberLimit) {
      return err(
        route,
        402,
        "MEMBER_LIMIT_REACHED",
        "Your plan allows 5 members (including pending invitations); 5 are in use.",
        [
          { path: "members.cap", message: "5" },
          { path: "members.used", message: "5" },
        ],
      );
    }
    if (!path.startsWith("/billing/")) return null;
    if (method === "GET" && path === "/billing/banners")
      return json(route, 200, { data: { banners: banners() } });
    if (!manager) return err(route, 403, "FORBIDDEN", "Your role cannot do this.");

    if (method === "GET" && path === "/billing/overview")
      return json(route, 200, { data: overview() });
    if (method === "GET" && path === "/billing/plans")
      return json(route, 200, { data: catalogue() });

    if (
      method === "POST" &&
      (path === "/billing/checkout/credits" || path === "/billing/checkout/subscription")
    ) {
      const key = route.request().headers()["idempotency-key"];
      if (!key || key.length < 8) {
        return err(route, 400, "VALIDATION_FAILED", "Idempotency-Key is required", [
          { path: "Idempotency-Key", message: "Send an Idempotency-Key header" },
        ]);
      }
      if (opts.checkoutError) {
        const status =
          opts.checkoutError === "PAYMENT_PROVIDER_ERROR"
            ? 502
            : opts.checkoutError === "CONFLICT"
              ? 409
              : 422;
        const message =
          opts.checkoutError === "CONFLICT"
            ? "The workspace is already on this plan."
            : opts.checkoutError === "PRICE_NOT_PUBLISHED"
              ? "The price is not published."
              : "The payment provider is unavailable.";
        return err(route, status, opts.checkoutError, message);
      }
      const body = route.request().postDataJSON() as { packId?: string; planId?: string };
      const item = body.packId
        ? PACKS.find((p) => p.id === body.packId)
        : PLANS.find((p) => p.id === body.planId);
      if (!item) return err(route, 404, "NOT_FOUND", "Not found");
      created = payment({
        id: PAYMENT_NEW_ID,
        reference: RETURN_REFS.created,
        purpose: body.packId ? "credit_pack" : "subscription",
        description: item.name,
        status: "pending",
        amountMinor: item.priceMinor,
        paidAt: null,
        verifiedAt: null,
        creditsGranted: null,
        refundableMinor: 0,
        initiatedAt: NOW,
      });
      const origin = new URL(route.request().url()).origin;
      return json(route, 201, {
        data: {
          paymentId: created.id,
          reference: created.reference,
          // Paystack's hosted page is not reachable in tests: the mock "pays" at once and
          // sends the browser straight back to the return page, as Paystack would.
          authorizationUrl: `${origin}/app/billing/return?trxref=${created.reference}&reference=${created.reference}`,
          purpose: created.purpose,
          amountMinor: created.amountMinor,
          currency: created.currency,
          description: created.description,
        },
      });
    }

    const verify = /^\/billing\/payments\/([A-Za-z0-9.=_-]+)\/verify$/.exec(path);
    if (method === "POST" && verify) {
      const p = returnPayment(verify[1]!);
      if (!p) return err(route, 404, "NOT_FOUND", "Payment not found");
      return json(route, 202, { data: { queued: true, payment: p } });
    }

    const refundPath = /^\/billing\/payments\/([0-9a-f-]{36})\/refund$/.exec(path);
    if (method === "POST" && refundPath) {
      if (role !== "owner") return err(route, 403, "FORBIDDEN", "Only owners can refund.");
      const p = payments.get(refundPath[1]!);
      if (!p) return err(route, 404, "NOT_FOUND", "Payment not found");
      if (p.status !== "success")
        return err(route, 409, "CONFLICT", "Only successful payments can be refunded.");
      const body = route.request().postDataJSON() as { amountMinor?: number; reason: string };
      const amount = body.amountMinor ?? p.refundableMinor;
      if (amount > p.refundableMinor) {
        return err(route, 400, "VALIDATION_FAILED", "Too much", [
          { path: "amountMinor", message: "At most the refundable amount" },
        ]);
      }
      const next = {
        ...p,
        refundableMinor: p.refundableMinor - amount,
        refunds: [
          ...p.refunds,
          refund({ id: uuid(0x66a0 + p.refunds.length), amountMinor: amount, reason: body.reason }),
        ],
      };
      payments.set(p.id, next);
      return json(route, 202, { data: next });
    }

    const paymentPath = /^\/billing\/payments\/([A-Za-z0-9.=_-]+)$/.exec(path);
    if (method === "GET" && paymentPath) {
      const ref = paymentPath[1]!;
      polls[ref] = (polls[ref] ?? 0) + 1;
      const p = returnPayment(ref) ?? payments.get(ref) ?? null;
      return p ? json(route, 200, { data: p }) : err(route, 404, "NOT_FOUND", "Payment not found");
    }
    if (method === "GET" && path === "/billing/payments") {
      const rows = [...payments.values()];
      if (created) rows.unshift(created);
      return json(route, 200, { data: rows, meta: { nextCursor: null, pageSize: 25 } });
    }
    if (method === "GET" && path === "/billing/invoices") {
      return json(route, 200, {
        data: opts.empty ? [] : INVOICES,
        meta: { nextCursor: null, pageSize: 25 },
      });
    }
    const invoicePath = /^\/billing\/invoices\/([0-9a-f-]{36})(\/download-url|\/download)?$/.exec(
      path,
    );
    if (method === "GET" && invoicePath) {
      const inv = INVOICES.find((i) => i.id === invoicePath[1]);
      if (!inv) return err(route, 404, "NOT_FOUND", "Invoice not found");
      if (invoicePath[2] === "/download-url") {
        return json(route, 200, {
          data: {
            url: `http://127.0.0.1:4999/api/v1/billing/invoices/${inv.id}/download?org=${ORG_ID}&expires=1793000000&sig=e2e-signature-abcdefghijklmnop`,
            expiresAt: "2026-10-25T09:15:00.000Z",
          },
        });
      }
      if (invoicePath[2] === "/download") {
        return route.fulfill({
          status: 200,
          contentType: "application/pdf",
          headers: { "content-disposition": `attachment; filename="${inv.number}.pdf"` },
          body: Buffer.from("%PDF-1.4 e2e sample invoice"),
        });
      }
      return json(route, 200, { data: inv });
    }

    if (
      method === "POST" &&
      (path === "/billing/subscription/cancel" || path === "/billing/subscription/resume")
    ) {
      if (!sub) return err(route, 409, "CONFLICT", "There is no subscription.");
      if (!sub.providerLinked)
        return err(
          route,
          409,
          "CONFLICT",
          "The subscription is still linking with Paystack; try again in a minute.",
        );
      sub = path.endsWith("cancel")
        ? { ...sub, cancelAtPeriodEnd: true, renewsAt: null }
        : { ...sub, cancelAtPeriodEnd: false, renewsAt: sub.currentPeriodEnd };
      return json(route, 200, { data: sub });
    }
    if (method === "GET" && path === "/billing/subscription/manage-link") {
      if (!sub?.providerLinked)
        return err(
          route,
          409,
          "CONFLICT",
          "The subscription is still linking with Paystack; try again in a minute.",
        );
      const origin = new URL(route.request().url()).origin;
      return json(route, 200, { data: { url: `${origin}/app/billing?card=paystack-sample` } });
    }
    return null;
  };
}
