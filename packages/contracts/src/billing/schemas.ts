import { z } from "zod";
import { IsoDateTime, UuidString } from "../common/ids.js";
import { CursorQuery } from "../common/pagination.js";
import { queryArray } from "../common/query.js";
import { PlanInterval } from "../public/schemas.js";
import type { ErrorCode } from "../common/errors.js";

/**
 * Billing (Phase 6). PostgreSQL is the only store of billing state; MongoDB never holds it.
 * Money is always an integer in minor units (kobo for NGN) with an ISO 4217 currency code.
 * Prices come from the database; clients send only a plan or credit pack id.
 */

/** Whether payments can be taken. `configured: false` means PAYSTACK_SECRET_KEY is not set. */
export const BillingProviderStatus = z.object({
  provider: z.literal("paystack"),
  configured: z.boolean(),
  /** `test` for sk_test_ keys, `live` for sk_live_ keys, null when not configured. */
  mode: z.enum(["test", "live"]).nullable(),
});
export type BillingProviderStatus = z.infer<typeof BillingProviderStatus>;

/** Why a plan or pack cannot be bought right now (null when it can). */
export const PurchaseBlocker = z.enum([
  /** Billing is not configured on the server (no Paystack key). */
  "not_configured",
  /** The price is a placeholder (or zero): it is never charged on a live key. */
  "price_not_published",
  /** The organization already has an active subscription to this plan. */
  "current_plan",
]);
export type PurchaseBlocker = z.infer<typeof PurchaseBlocker>;

export const BillingPlan = z.object({
  id: UuidString,
  code: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  interval: PlanInterval,
  priceMinor: z.number().int(),
  currency: z.string(),
  includedCredits: z.number().int(),
  maxMembers: z.number().int(),
  exportRowCap: z.number().int(),
  discoveryEnabled: z.boolean(),
  websiteAnalysisEnabled: z.boolean(),
  isPlaceholder: z.boolean(),
  purchasable: z.boolean(),
  blocker: PurchaseBlocker.nullable(),
});
export type BillingPlan = z.infer<typeof BillingPlan>;

export const BillingCreditPack = z.object({
  id: UuidString,
  code: z.string(),
  name: z.string(),
  credits: z.number().int(),
  priceMinor: z.number().int(),
  currency: z.string(),
  isPlaceholder: z.boolean(),
  purchasable: z.boolean(),
  blocker: PurchaseBlocker.nullable(),
});
export type BillingCreditPack = z.infer<typeof BillingCreditPack>;

/** `GET /billing/plans`. */
export const BillingCatalogue = z.object({
  plans: z.array(BillingPlan),
  creditPacks: z.array(BillingCreditPack),
  /** False while any active price is a placeholder: show "Pricing not yet published". */
  pricingPublished: z.boolean(),
  provider: BillingProviderStatus,
});
export type BillingCatalogue = z.infer<typeof BillingCatalogue>;

export const SubscriptionStatus = z.enum([
  "incomplete",
  "active",
  "past_due",
  "cancelled",
  "expired",
]);
export type SubscriptionStatus = z.infer<typeof SubscriptionStatus>;

export const SubscriptionView = z.object({
  id: UuidString,
  status: SubscriptionStatus,
  plan: z.object({
    id: UuidString,
    code: z.string(),
    name: z.string(),
    interval: PlanInterval,
    priceMinor: z.number().int(),
    currency: z.string(),
    includedCredits: z.number().int(),
  }),
  currentPeriodStart: IsoDateTime.nullable(),
  currentPeriodEnd: IsoDateTime.nullable(),
  /** Next charge date: the period end, or null when the subscription will not renew. */
  renewsAt: IsoDateTime.nullable(),
  cancelAtPeriodEnd: z.boolean(),
  cancelledAt: IsoDateTime.nullable(),
  pastDueAt: IsoDateTime.nullable(),
  endedAt: IsoDateTime.nullable(),
  /** True when it is linked to a Paystack subscription (cancel, resume and the card page need that). */
  providerLinked: z.boolean(),
  createdAt: IsoDateTime,
});
export type SubscriptionView = z.infer<typeof SubscriptionView>;

/**
 * Stage 9: how long after a subscription checkout starts its Paystack `authorization_url` is
 * offered again to resume it. Paystack's documentation states no lifetime for an authorization URL
 * or access code, so this is a conservative assumption (well inside the 24-hour abandon window),
 * not a documented Paystack limit.
 */
export const CHECKOUT_RESUME_WINDOW_MINUTES = 30;

/**
 * `BillingOverview.pendingSubscription`: an incomplete subscription checkout. Stage 9 adds
 * `authorizationUrl` and `authorizationUrlExpiresAt`, both present or both absent: the hosted
 * Paystack checkout of this subscription, to send the browser back to an abandoned checkout. They
 * are present only while that payment is still pending, not under review, the provider is
 * configured, and it started less than CHECKOUT_RESUME_WINDOW_MINUTES ago; never once the payment
 * is final. When absent, start a new checkout.
 */
export const PendingSubscriptionView = SubscriptionView.extend({
  authorizationUrl: z.string().url().optional(),
  /** When LeadForge stops offering `authorizationUrl` (checkout start + CHECKOUT_RESUME_WINDOW_MINUTES). */
  authorizationUrlExpiresAt: IsoDateTime.optional(),
});
export type PendingSubscriptionView = z.infer<typeof PendingSubscriptionView>;

export const EntitlementSourceView = z.enum(["plan", "override", "free"]);
export type EntitlementSourceView = z.infer<typeof EntitlementSourceView>;

/**
 * What the organization may use now, from `entitlements` (an `override` row wins over a `plan`
 * row; without a row the free tier applies). The API enforces these; the UI only displays them.
 */
export const EntitlementsView = z.object({
  maxMembers: z.number().int(),
  exportRowCap: z.number().int(),
  discoveryEnabled: z.boolean(),
  websiteAnalysisEnabled: z.boolean(),
  monthlyIncludedCredits: z.number().int(),
  /** Where each value comes from. */
  sources: z.object({
    maxMembers: EntitlementSourceView,
    exportRowCap: EntitlementSourceView,
    discoveryEnabled: EntitlementSourceView,
    websiteAnalysisEnabled: EntitlementSourceView,
    monthlyIncludedCredits: EntitlementSourceView,
  }),
  /** The plan the plan-sourced values come from, or "free" without a subscription. */
  basis: z.object({
    kind: z.enum(["subscription", "free"]),
    planCode: z.string().nullable(),
    planName: z.string().nullable(),
  }),
});
export type EntitlementsView = z.infer<typeof EntitlementsView>;

export const BillingBannerKind = z.enum([
  /** Billing is not configured (owners and admins only). */
  "not_configured",
  /** A renewal failed; the subscription is past due (owners and admins only). */
  "past_due",
  /** The latest payment failed in the last 7 days (owners and admins only). */
  "payment_failed",
  /** The credit balance is below zero after a refund or reversal: new discovery and analyses are blocked (every role). */
  "negative_balance",
]);
export type BillingBannerKind = z.infer<typeof BillingBannerKind>;

export const BillingBanner = z.object({
  kind: BillingBannerKind,
  severity: z.enum(["info", "warning", "error"]),
  title: z.string(),
  message: z.string(),
  /** Dashboard route for the action, e.g. /app/billing; null when the viewer cannot act. */
  href: z.string().nullable(),
  since: IsoDateTime.nullable(),
});
export type BillingBanner = z.infer<typeof BillingBanner>;

/** `GET /billing/banners` (every role; content depends on the role). */
export const BillingBanners = z.object({ banners: z.array(BillingBanner) });
export type BillingBanners = z.infer<typeof BillingBanners>;

export const PaymentPurpose = z.enum(["subscription", "credit_pack"]);
export type PaymentPurpose = z.infer<typeof PaymentPurpose>;

export const PaymentStatus = z.enum(["pending", "success", "failed", "reversed", "abandoned"]);
export type PaymentStatus = z.infer<typeof PaymentStatus>;

/** Statuses after which a payment no longer changes on its own (stop polling). */
export const PAYMENT_TERMINAL_STATUSES: readonly PaymentStatus[] = [
  "success",
  "failed",
  "reversed",
  "abandoned",
];

export const RefundStatus = z.enum(["pending", "processed", "failed"]);
export type RefundStatus = z.infer<typeof RefundStatus>;

export const RefundView = z.object({
  id: UuidString,
  status: RefundStatus,
  amountMinor: z.number().int(),
  currency: z.string(),
  reason: z.string().nullable(),
  /** Credits taken back when the refund was processed (the balance may go negative). */
  reversalUnits: z.number().int().nullable(),
  failureReason: z.string().nullable(),
  createdAt: IsoDateTime,
  processedAt: IsoDateTime.nullable(),
});
export type RefundView = z.infer<typeof RefundView>;

export const PaymentView = z.object({
  id: UuidString,
  /** Our provider reference (also in the return URL as `reference`). */
  reference: z.string(),
  purpose: PaymentPurpose,
  status: PaymentStatus,
  description: z.string().nullable(),
  amountMinor: z.number().int(),
  currency: z.string(),
  /** Credits the payment granted (credit packs) or the plan's included credits for the period; null before success. */
  creditsGranted: z.number().int().nullable(),
  channel: z.string().nullable(),
  /** Masked card or bank details from the provider; never a card number. */
  card: z
    .object({
      brand: z.string().nullable(),
      last4: z.string().nullable(),
      expMonth: z.string().nullable(),
      expYear: z.string().nullable(),
      bank: z.string().nullable(),
    })
    .nullable(),
  gatewayResponse: z.string().nullable(),
  invoiceId: UuidString.nullable(),
  initiatedAt: IsoDateTime,
  paidAt: IsoDateTime.nullable(),
  verifiedAt: IsoDateTime.nullable(),
  failedAt: IsoDateTime.nullable(),
  reversedAt: IsoDateTime.nullable(),
  refundedMinor: z.number().int(),
  /** Amount still refundable (success payments only). */
  refundableMinor: z.number().int(),
  refunds: z.array(RefundView),
  /** True when verification disagreed or a dispute is open; nothing is granted while set. */
  underReview: z.boolean(),
});
export type PaymentView = z.infer<typeof PaymentView>;

export const PaymentListQuery = z.object({
  status: queryArray(PaymentStatus, 5),
  purpose: PaymentPurpose.optional(),
  ...CursorQuery.shape,
});
export type PaymentListQuery = z.infer<typeof PaymentListQuery>;

/** Our references: `lf-` followed by a UUID. Paystack renewal references are accepted too. */
export const PaymentReference = z
  .string()
  .trim()
  .min(6)
  .max(100)
  .regex(/^[A-Za-z0-9.=_-]+$/, "Invalid payment reference");

export const CheckoutCreditsRequest = z.object({ packId: UuidString }).strict();
export type CheckoutCreditsRequest = z.infer<typeof CheckoutCreditsRequest>;

export const CheckoutSubscriptionRequest = z.object({ planId: UuidString }).strict();
export type CheckoutSubscriptionRequest = z.infer<typeof CheckoutSubscriptionRequest>;

/**
 * A hosted checkout. Send the browser to `authorizationUrl`; Paystack returns it to
 * `/app/billing/return?reference=<reference>`. Nothing is granted by the redirect.
 */
export const CheckoutSession = z.object({
  paymentId: UuidString,
  reference: z.string(),
  authorizationUrl: z.string().url(),
  purpose: PaymentPurpose,
  amountMinor: z.number().int(),
  currency: z.string(),
  description: z.string().nullable(),
});
export type CheckoutSession = z.infer<typeof CheckoutSession>;

/** `POST /billing/payments/:reference/verify`: verification was queued (or the payment is already final). */
export const VerifyPaymentResponse = z.object({
  queued: z.boolean(),
  payment: PaymentView,
});
export type VerifyPaymentResponse = z.infer<typeof VerifyPaymentResponse>;

export const InvoiceStatus = z.enum(["draft", "open", "paid", "void", "uncollectible"]);
export type InvoiceStatus = z.infer<typeof InvoiceStatus>;

export const InvoiceLine = z.object({
  description: z.string(),
  quantity: z.number().int(),
  unitMinor: z.number().int(),
  amountMinor: z.number().int(),
});
export type InvoiceLine = z.infer<typeof InvoiceLine>;

export const InvoiceView = z.object({
  id: UuidString,
  number: z.string(),
  status: InvoiceStatus,
  lines: z.array(InvoiceLine),
  subtotalMinor: z.number().int(),
  taxMinor: z.number().int(),
  totalMinor: z.number().int(),
  currency: z.string(),
  issuedAt: IsoDateTime.nullable(),
  paidAt: IsoDateTime.nullable(),
  periodStart: IsoDateTime.nullable(),
  periodEnd: IsoDateTime.nullable(),
  paymentReference: z.string().nullable(),
  subscriptionId: UuidString.nullable(),
  /** A PDF is stored (it is generated on the first download otherwise). */
  pdfReady: z.boolean(),
});
export type InvoiceView = z.infer<typeof InvoiceView>;

export const InvoiceListQuery = z.object({ ...CursorQuery.shape });
export type InvoiceListQuery = z.infer<typeof InvoiceListQuery>;

export const InvoiceDownloadLink = z.object({ url: z.string(), expiresAt: IsoDateTime });
export type InvoiceDownloadLink = z.infer<typeof InvoiceDownloadLink>;

/** Query of the signed invoice download URL (`GET /billing/invoices/:id/download`). */
export const InvoiceDownloadQuery = z.object({
  org: UuidString,
  expires: z.coerce.number().int().min(0),
  sig: z.string().regex(/^[A-Za-z0-9_-]{20,128}$/),
});
export type InvoiceDownloadQuery = z.infer<typeof InvoiceDownloadQuery>;

/**
 * Stage 8: when a browser navigates to a signed invoice link and the link fails with one of these
 * codes, the API answers `303 See Other` to `<APP_URL>/app/billing?downloadError=<code>` instead of
 * the JSON error (a damaged link is DOWNLOAD_LINK_INVALID). Invoice PDFs have no "not ready" or
 * "expired" state: they are rendered on the first download and kept as statutory records.
 */
export const INVOICE_DOWNLOAD_ERROR_CODES = [
  "DOWNLOAD_LINK_INVALID",
  "DOWNLOAD_LINK_EXPIRED",
] as const satisfies readonly ErrorCode[];
export const InvoiceDownloadErrorCode = z.enum(INVOICE_DOWNLOAD_ERROR_CODES);
export type InvoiceDownloadErrorCode = z.infer<typeof InvoiceDownloadErrorCode>;

/** Only cancellation at the end of the paid period is offered (no partial-period refunds). */
export const CancelSubscriptionRequest = z
  .object({ atPeriodEnd: z.literal(true).default(true) })
  .strict();
export type CancelSubscriptionRequest = z.infer<typeof CancelSubscriptionRequest>;

/** Paystack's hosted page where the customer updates the card for the subscription. */
export const SubscriptionManageLink = z.object({ url: z.string().url() });
export type SubscriptionManageLink = z.infer<typeof SubscriptionManageLink>;

/** `POST /billing/payments/:id/refund` (owner). Omit `amountMinor` to refund what is left. */
export const RefundRequest = z
  .object({
    amountMinor: z.number().int().positive().optional(),
    reason: z.string().trim().min(3).max(500),
  })
  .strict();
export type RefundRequest = z.infer<typeof RefundRequest>;

/** `GET /billing/overview` (owner and admin). */
export const BillingOverview = z.object({
  provider: BillingProviderStatus,
  subscription: SubscriptionView.nullable(),
  /** An incomplete subscription checkout waiting for payment, if any (with its resumable checkout URL while it is likely to work). */
  pendingSubscription: PendingSubscriptionView.nullable(),
  entitlements: EntitlementsView,
  credits: z.object({ balance: z.number().int(), held: z.number().int() }),
  members: z.object({
    active: z.number().int(),
    pendingInvitations: z.number().int(),
    cap: z.number().int(),
  }),
  latestPayment: PaymentView.nullable(),
  banners: z.array(BillingBanner),
  pricingPublished: z.boolean(),
});
export type BillingOverview = z.infer<typeof BillingOverview>;

/** `POST /webhooks/paystack` acknowledgement. */
export const WebhookAck = z.object({ received: z.literal(true), duplicate: z.boolean() });
export type WebhookAck = z.infer<typeof WebhookAck>;
