import {
  INVOICE_DOWNLOAD_ERROR_CODES,
  PAYMENT_TERMINAL_STATUSES,
  type InvoiceDownloadErrorCode,
  type BillingBanner,
  type BillingCatalogue,
  type BillingCreditPack,
  type BillingPlan,
  type EntitlementSourceView,
  type InvoiceStatus,
  type PaymentPurpose,
  type PaymentStatus,
  type PaymentView,
  type PurchaseBlocker,
  type RefundStatus,
  type SubscriptionStatus,
  type SubscriptionView,
} from "@leadforge/contracts";
import type { StatusTone } from "@leadforge/ui";
import { isApiError } from "./api";
import { humanizeKey } from "./labels";
import { pendingDeletionMessage, pendingDeletionPurgeAfter } from "./org-lifecycle";

/*
 * Billing (Phase 6). Money is always an integer in minor units with an ISO 4217 currency; the
 * browser formats it and never computes a price. Prices, plans, entitlements and payment states
 * all come from the billing API. A placeholder or zero price is never shown as a price.
 */

// ---------------------------------------------------------------------------
// Money
// ---------------------------------------------------------------------------

/** Minor-unit digits of a currency (2 for NGN, 0 for JPY); 2 when the code is unknown. */
export function minorDigits(currency: string): number {
  try {
    return (
      new Intl.NumberFormat("en-NG", { style: "currency", currency }).resolvedOptions()
        .maximumFractionDigits ?? 2
    );
  } catch {
    return 2;
  }
}

/** "₦25,000.00" from 2500000 and "NGN". Unknown codes fall back to "XYZ 25,000.00". */
export function formatMoney(amountMinor: number, currency: string): string {
  const digits = minorDigits(currency);
  const major = amountMinor / 10 ** digits;
  try {
    return new Intl.NumberFormat("en-NG", {
      style: "currency",
      currency,
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    }).format(major);
  } catch {
    return `${currency} ${major.toFixed(digits)}`;
  }
}

/**
 * Minor units from what a person typed ("25,000", "25000.5", "₦1,200.00"). Null when it is not a
 * positive amount with at most the currency's decimals.
 */
export function parseMoneyInput(text: string, currency: string): number | null {
  const digits = minorDigits(currency);
  let cleaned = text.replace(/[\s,₦]/g, "");
  if (cleaned.toUpperCase().startsWith(currency.toUpperCase()))
    cleaned = cleaned.slice(currency.length);
  const [whole = "", frac = "", ...rest] = cleaned.split(".");
  if (rest.length || !/^\d+$/.test(whole) || (cleaned.includes(".") && !/^\d+$/.test(frac)))
    return null;
  if (frac.length > digits) return null;
  const minor = Number(whole) * 10 ** digits + Number(frac.padEnd(digits, "0") || "0");
  return Number.isSafeInteger(minor) ? minor : null;
}

/** Major-unit text for an input's starting value ("25000.50"). */
export function toMoneyInput(amountMinor: number, currency: string): string {
  const digits = minorDigits(currency);
  return (amountMinor / 10 ** digits).toFixed(digits);
}

// ---------------------------------------------------------------------------
// Catalogue
// ---------------------------------------------------------------------------

export const PRICING_NOT_PUBLISHED = "Pricing not yet published";

/** A price that may be shown: published catalogue, not a placeholder, above zero. */
export function hasRealPrice(
  item: Pick<BillingPlan | BillingCreditPack, "isPlaceholder" | "priceMinor">,
  pricingPublished: boolean,
): boolean {
  return pricingPublished && !item.isPlaceholder && item.priceMinor > 0;
}

/** The price as shown, or "Pricing not yet published" (never "₦0" or a placeholder amount). */
export function priceText(
  item: Pick<BillingPlan | BillingCreditPack, "isPlaceholder" | "priceMinor" | "currency">,
  pricingPublished: boolean,
): string {
  return hasRealPrice(item, pricingPublished)
    ? formatMoney(item.priceMinor, item.currency)
    : PRICING_NOT_PUBLISHED;
}

export const INTERVAL_LABELS: Record<string, { per: string; adjective: string }> = {
  monthly: { per: "per month", adjective: "Monthly" },
  yearly: { per: "per year", adjective: "Yearly" },
};

export function intervalPer(interval: string): string {
  return INTERVAL_LABELS[interval]?.per ?? `per ${interval}`;
}

/** Why a plan or pack cannot be bought, in words shown next to its disabled button. */
export const BLOCKER_TEXT: Record<PurchaseBlocker, string> = {
  not_configured: "Payments are not set up yet, so nothing can be bought.",
  price_not_published: "This price has not been published yet, so it cannot be bought.",
  current_plan: "This is your current plan.",
};

export function blockerText(blocker: PurchaseBlocker | null): string | null {
  return blocker ? (BLOCKER_TEXT[blocker] ?? humanizeKey(blocker)) : null;
}

export type CatalogueItem =
  { kind: "plan"; item: BillingPlan } | { kind: "pack"; item: BillingCreditPack };

/**
 * Whether the buy button is enabled and, if not, the visible reason. The API's `purchasable`
 * and `blocker` decide; a missing provider disables everything even when an item says otherwise.
 */
export function purchaseState(
  item: Pick<BillingPlan | BillingCreditPack, "purchasable" | "blocker">,
  catalogue: Pick<BillingCatalogue, "provider">,
): { enabled: boolean; reason: string | null } {
  if (!catalogue.provider.configured)
    return { enabled: false, reason: BLOCKER_TEXT.not_configured };
  if (!item.purchasable) {
    return {
      enabled: false,
      reason: blockerText(item.blocker) ?? "This cannot be bought right now.",
    };
  }
  return { enabled: true, reason: null };
}

// ---------------------------------------------------------------------------
// Statuses
// ---------------------------------------------------------------------------

type Meta = { label: string; tone: StatusTone; description: string };

export const PAYMENT_STATUS_META: Record<PaymentStatus, Meta> = {
  pending: {
    label: "Pending",
    tone: "info",
    description: "Waiting for Paystack to confirm the payment.",
  },
  success: {
    label: "Paid",
    tone: "success",
    description: "Confirmed with Paystack; credits or the plan were granted.",
  },
  failed: {
    label: "Failed",
    tone: "destructive",
    description: "The payment did not go through. Nothing was granted.",
  },
  abandoned: {
    label: "Abandoned",
    tone: "neutral",
    description: "The checkout was left before paying. Nothing was charged.",
  },
  reversed: {
    label: "Refunded",
    tone: "warning",
    description: "Refunded or reversed in full; its credits were taken back.",
  },
};

export function paymentStatusMeta(status: string): Meta {
  return (
    PAYMENT_STATUS_META[status as PaymentStatus] ?? {
      label: humanizeKey(status),
      tone: "neutral",
      description: "",
    }
  );
}

export const UNDER_REVIEW_META: Meta = {
  label: "Under review",
  tone: "warning",
  description:
    "The payment details did not match what Paystack reported, or a dispute is open. Nothing is granted while it is reviewed.",
};

export const SUBSCRIPTION_STATUS_META: Record<SubscriptionStatus, Meta> = {
  incomplete: {
    label: "Waiting for payment",
    tone: "info",
    description: "The checkout has not been paid yet.",
  },
  active: { label: "Active", tone: "success", description: "Paid for the current period." },
  past_due: {
    label: "Payment overdue",
    tone: "destructive",
    description: "A renewal failed. Update the card to keep the plan.",
  },
  cancelled: {
    label: "Cancelled",
    tone: "neutral",
    description: "Ended at the close of its last paid period.",
  },
  expired: {
    label: "Expired",
    tone: "neutral",
    description: "Ended after an unpaid renewal; the free tier applies.",
  },
};

export function subscriptionStatusMeta(status: string): Meta {
  return (
    SUBSCRIPTION_STATUS_META[status as SubscriptionStatus] ?? {
      label: humanizeKey(status),
      tone: "neutral",
      description: "",
    }
  );
}

export const REFUND_STATUS_META: Record<RefundStatus, Meta> = {
  pending: {
    label: "Refund pending",
    tone: "info",
    description: "Sent to Paystack; credits are taken back when it is processed.",
  },
  processed: {
    label: "Refunded",
    tone: "warning",
    description: "Processed by Paystack; credits were taken back in proportion.",
  },
  failed: {
    label: "Refund failed",
    tone: "destructive",
    description: "Paystack could not refund it; nothing was taken back.",
  },
};

export function refundStatusMeta(status: string): Meta {
  return (
    REFUND_STATUS_META[status as RefundStatus] ?? {
      label: humanizeKey(status),
      tone: "neutral",
      description: "",
    }
  );
}

export const INVOICE_STATUS_META: Record<InvoiceStatus, Meta> = {
  draft: { label: "Draft", tone: "neutral", description: "Not issued yet." },
  open: { label: "Open", tone: "info", description: "Issued, not paid yet." },
  paid: { label: "Paid", tone: "success", description: "Paid in full." },
  void: { label: "Void", tone: "neutral", description: "Cancelled; nothing is owed." },
  uncollectible: {
    label: "Uncollectible",
    tone: "warning",
    description: "Could not be collected.",
  },
};

export function invoiceStatusMeta(status: string): Meta {
  return (
    INVOICE_STATUS_META[status as InvoiceStatus] ?? {
      label: humanizeKey(status),
      tone: "neutral",
      description: "",
    }
  );
}

export const PURPOSE_LABELS: Record<PaymentPurpose, string> = {
  credit_pack: "Credit pack",
  subscription: "Subscription",
};

export function purposeLabel(purpose: string): string {
  return PURPOSE_LABELS[purpose as PaymentPurpose] ?? humanizeKey(purpose);
}

export const ENTITLEMENT_SOURCE_LABELS: Record<EntitlementSourceView, string> = {
  plan: "From your plan",
  override: "Set for this workspace",
  free: "Free tier",
};

export function entitlementSourceLabel(source: string): string {
  return ENTITLEMENT_SOURCE_LABELS[source as EntitlementSourceView] ?? humanizeKey(source);
}

/** "Visa •••• 4081", "GTBank", or null when Paystack sent nothing. Masked values only. */
export function cardSummary(card: PaymentView["card"], channel: string | null): string | null {
  if (card) {
    const brand = card.brand ? humanizeKey(card.brand) : null;
    const parts = [brand, card.last4 ? `•••• ${card.last4}` : null].filter(Boolean);
    if (parts.length) return parts.join(" ");
    if (card.bank) return card.bank;
  }
  return channel ? humanizeKey(channel) : null;
}

/** Cancel, resume and the card page need the Paystack link (normally seconds after paying). */
export function subscriptionActionsReady(s: Pick<SubscriptionView, "providerLinked">): boolean {
  return s.providerLinked;
}

/**
 * About how many credits a refund takes back: the payment's credits in proportion to the amount.
 * The server computes the real figure when Paystack processes the refund, so this is labelled
 * "about" wherever it is shown.
 */
export function proportionalCredits(
  payment: Pick<PaymentView, "creditsGranted" | "amountMinor">,
  refundMinor: number,
): number | null {
  if (!payment.creditsGranted || payment.amountMinor <= 0) return null;
  return Math.round(
    (payment.creditsGranted * Math.min(refundMinor, payment.amountMinor)) / payment.amountMinor,
  );
}

// ---------------------------------------------------------------------------
// Return page state machine
// ---------------------------------------------------------------------------

export const RETURN_POLL_MS = 2_000;
export const RETURN_TIMEOUT_MS = 60_000;

/** Stop polling: a final status, or a payment held for review. */
export function isPaymentSettled(p: Pick<PaymentView, "status" | "underReview">): boolean {
  return (PAYMENT_TERMINAL_STATUSES as readonly string[]).includes(p.status) || p.underReview;
}

export type ReturnPhase =
  | "missing_reference"
  | "verifying"
  | "confirming"
  | "success"
  | "failed"
  | "abandoned"
  | "reversed"
  | "under_review"
  | "slow"
  | "not_found"
  | "error";

/**
 * Where the return page is. Success comes only from the server's `status: "success"`; the
 * redirect from Paystack proves nothing. `underReview` wins over every status.
 */
export function returnPhase(args: {
  reference: string | null;
  payment: Pick<PaymentView, "status" | "underReview"> | undefined;
  verifyDone: boolean;
  timedOut: boolean;
  error: unknown;
}): ReturnPhase {
  const { reference, payment, verifyDone, timedOut, error } = args;
  if (!reference) return "missing_reference";
  if (payment) {
    if (payment.underReview) return "under_review";
    switch (payment.status) {
      case "success":
        return "success";
      case "failed":
        return "failed";
      case "abandoned":
        return "abandoned";
      case "reversed":
        return "reversed";
      default:
        break;
    }
  }
  if (error && !payment) {
    if (isApiError(error) && (error.status === 404 || error.code === "VALIDATION_FAILED"))
      return "not_found";
    return "error";
  }
  if (timedOut) return "slow";
  return verifyDone || payment ? "confirming" : "verifying";
}

/** Said once per phase change through a live region. */
export function returnAnnouncement(phase: ReturnPhase): string {
  switch (phase) {
    case "verifying":
    case "confirming":
      return "Confirming the payment with Paystack.";
    case "success":
      return "Payment confirmed.";
    case "failed":
      return "The payment failed. Nothing was charged.";
    case "abandoned":
      return "The checkout was not completed. Nothing was charged.";
    case "reversed":
      return "The payment was reversed.";
    case "under_review":
      return "The payment is under review. Nothing has been granted yet.";
    case "slow":
      return "Still confirming. We will notify you when the payment is confirmed.";
    case "not_found":
      return "This payment could not be found.";
    case "error":
      return "Could not check the payment.";
    default:
      return "";
  }
}

// ---------------------------------------------------------------------------
// Checkout errors
// ---------------------------------------------------------------------------

/** Readable title and message for a failed checkout, by documented code. */
export function checkoutError(err: unknown): {
  title: string;
  message: string;
  tone: "warning" | "destructive";
} {
  if (isApiError(err)) {
    switch (err.code) {
      case "PRICE_NOT_PUBLISHED":
        return {
          title: "This price is not published yet",
          message:
            "LeadForge has not published this price, so it cannot be charged. Nothing was charged. The plans below were reloaded.",
          tone: "warning",
        };
      case "BILLING_NOT_CONFIGURED":
        return {
          title: "Payments are not set up yet",
          message:
            "This LeadForge server is not connected to Paystack, so nothing can be bought. Nothing was charged.",
          tone: "warning",
        };
      case "PAYMENT_PROVIDER_ERROR":
        return {
          title: "Paystack could not start the checkout",
          message:
            "The payment provider could not be reached or declined the request. Nothing was charged. Try again in a few minutes.",
          tone: "destructive",
        };
      case "CONFLICT":
        return {
          title: "This checkout cannot start",
          message:
            err.message ||
            "It conflicts with the workspace's current plan. Reload the page and check the plan.",
          tone: "warning",
        };
      case "FORBIDDEN":
        return {
          title: "Your role cannot buy plans or credits",
          message: "Owners and administrators manage billing.",
          tone: "destructive",
        };
      case "ORGANIZATION_PENDING_DELETION":
        return {
          title: "Purchases are paused: this organization is scheduled for deletion",
          message: `${pendingDeletionMessage(pendingDeletionPurgeAfter(err))} Nothing was charged.`,
          tone: "warning",
        };
      default:
        break;
    }
  }
  return {
    title: "Could not start the checkout",
    message:
      err instanceof TypeError
        ? "Could not reach the server. Nothing was charged."
        : "Something went wrong. Nothing was charged.",
    tone: "destructive",
  };
}

// ---------------------------------------------------------------------------
// Invoice download links that failed in the browser
// ---------------------------------------------------------------------------

/**
 * An invoice link that fails when the browser opens it is redirected (303) to
 * `/app/billing?downloadError=<code>`. Known codes only; anything else is ignored.
 */
export function invoiceDownloadErrorFrom(value: string | null): InvoiceDownloadErrorCode | null {
  return value && (INVOICE_DOWNLOAD_ERROR_CODES as readonly string[]).includes(value)
    ? (value as InvoiceDownloadErrorCode)
    : null;
}

export const INVOICE_DOWNLOAD_ERROR_MESSAGES: Record<
  InvoiceDownloadErrorCode,
  { title: string; message: string }
> = {
  DOWNLOAD_LINK_EXPIRED: {
    title: "That download link expired",
    message:
      "Invoice links work for 15 minutes. Download the invoice again from Invoices for a fresh link.",
  },
  DOWNLOAD_LINK_INVALID: {
    title: "That download link is not valid for you",
    message:
      "Invoice links work only for the person who asked for them, in this workspace. Download the invoice again from Invoices.",
  },
};

// ---------------------------------------------------------------------------
// Banners
// ---------------------------------------------------------------------------

/** Banner kinds only owners and administrators see (the server filters too). */
const MANAGER_ONLY = new Set(["not_configured", "past_due", "payment_failed"]);

/** Defensive role filter on top of the server's: managers see every kind, others only negative_balance. */
export function visibleBanners(
  banners: BillingBanner[],
  canManageBilling: boolean,
): BillingBanner[] {
  return banners.filter((b) => canManageBilling || !MANAGER_ONLY.has(b.kind));
}

/**
 * Whether a banner may be dismissed for the rest of the tab session. Account conditions that
 * block work or money (negative balance, an overdue renewal) stay until they are resolved.
 */
export function bannerDismissible(b: Pick<BillingBanner, "kind" | "severity">): boolean {
  if (b.kind === "negative_balance" || b.kind === "past_due") return false;
  return b.severity !== "error";
}

/** Session key for a dismissed banner; a new occurrence (another `since`) shows again. */
export function bannerDismissKey(orgId: string, b: Pick<BillingBanner, "kind" | "since">): string {
  return `lf.billingBanner.${orgId}.${b.kind}.${b.since ?? "none"}`;
}

/** The banner's action link: dashboard paths only, and only for people who can use the page. */
export function bannerHref(
  b: Pick<BillingBanner, "href">,
  canManageBilling: boolean,
): string | null {
  const href = b.href;
  if (!href || !href.startsWith("/app/") || href.startsWith("//")) return null;
  if (href.startsWith("/app/billing") && !canManageBilling) return null;
  return href;
}
