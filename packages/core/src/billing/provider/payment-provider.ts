/**
 * Payment provider boundary (Phase 6). LeadForge ships one implementation, Paystack
 * (paystack.provider.ts). Everything above this interface works in minor units and our own
 * references; nothing here grants credits: callers verify a transaction and then settle it in
 * one PostgreSQL transaction (PaymentSettlementService).
 */

export const PAYMENT_PROVIDER = Symbol("PAYMENT_PROVIDER");

export type ProviderMode = "test" | "live";

export interface InitializeTransactionInput {
  email: string;
  amountMinor: bigint;
  currency: string;
  /** Our unique reference (`lf-<uuid>`). */
  reference: string;
  callbackUrl: string;
  /** Provider plan code for a subscription checkout (the provider then charges the plan amount). */
  planCode?: string | null;
  metadata: Record<string, string>;
}

export interface InitializedTransaction {
  authorizationUrl: string;
  accessCode: string | null;
  reference: string;
}

/** Provider transaction statuses (Paystack: success, failed, abandoned, reversed, ongoing, pending, processing, queued). */
export type ProviderTransactionStatus = "success" | "failed" | "abandoned" | "reversed" | "pending";

export interface MaskedAuthorization {
  brand: string | null;
  last4: string | null;
  expMonth: string | null;
  expYear: string | null;
  bank: string | null;
  cardType: string | null;
  channel: string | null;
}

export interface VerifiedTransaction {
  /** Normalized status; `rawStatus` keeps the provider's word. */
  status: ProviderTransactionStatus;
  rawStatus: string;
  reference: string;
  providerTransactionId: string | null;
  amountMinor: bigint;
  currency: string;
  paidAt: Date | null;
  channel: string | null;
  gatewayResponse: string | null;
  /** Masked card or bank details only; authorization codes are never returned to callers. */
  authorization: MaskedAuthorization | null;
  customerCode: string | null;
  customerEmail: string | null;
  planCode: string | null;
  /** `test` or `live` as reported by the provider for this transaction. */
  mode: ProviderMode | null;
}

export interface ProviderSubscription {
  code: string;
  emailToken: string | null;
  /** active, non-renewing, attention, completed, cancelled (Paystack words). */
  status: string;
  planCode: string | null;
  customerCode: string | null;
  nextPaymentDate: Date | null;
  /** Reference of the most recent charge, when the provider reports one (renewal recovery). */
  latestTransactionReference: string | null;
}

export interface ProviderRefund {
  id: string;
  status: string;
  amountMinor: bigint;
  currency: string;
}

/** Thrown for provider failures (network, 5xx, unexpected payloads). Messages never include secrets. */
export class PaymentProviderError extends Error {
  constructor(
    message: string,
    readonly status: number | null = null,
    /** The provider answered that the thing does not exist (e.g. an unknown reference). */
    readonly notFound = false,
  ) {
    super(message);
    this.name = "PaymentProviderError";
  }
}

export interface PaymentProvider {
  readonly name: "paystack";
  readonly configured: boolean;
  readonly mode: ProviderMode | null;

  /** Constant-time check of the webhook signature over the exact raw body. */
  verifyWebhookSignature(rawBody: Buffer, signature: string | undefined): boolean;

  createCustomer(input: {
    email: string;
    metadata: Record<string, string>;
  }): Promise<{ customerCode: string }>;
  createPlan(input: {
    name: string;
    interval: "monthly" | "yearly";
    amountMinor: bigint;
    currency: string;
    description: string | null;
  }): Promise<{ planCode: string }>;
  initializeTransaction(input: InitializeTransactionInput): Promise<InitializedTransaction>;
  verifyTransaction(reference: string): Promise<VerifiedTransaction>;
  fetchSubscription(code: string): Promise<ProviderSubscription>;
  /** Stops future charges (Paystack "disable"). */
  disableSubscription(code: string, emailToken: string): Promise<void>;
  enableSubscription(code: string, emailToken: string): Promise<void>;
  /** Hosted page where the customer updates the card on a subscription. */
  manageSubscriptionLink(code: string): Promise<{ url: string }>;
  refund(input: {
    reference: string;
    amountMinor: bigint;
    currency: string;
    merchantNote: string;
  }): Promise<ProviderRefund>;
}
