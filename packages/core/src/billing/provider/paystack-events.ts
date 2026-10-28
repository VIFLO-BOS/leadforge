import { createHash } from "node:crypto";

type Json = Record<string, unknown>;

const str = (v: unknown): string | null =>
  typeof v === "string" && v.length > 0 ? v : typeof v === "number" ? String(v) : null;
const obj = (v: unknown): Json | null =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Json) : null;

/** Webhook events LeadForge acts on. Anything else is stored and marked `ignored`. */
export const HANDLED_PAYSTACK_EVENTS = [
  "charge.success",
  "subscription.create",
  "subscription.not_renew",
  "subscription.disable",
  "invoice.create",
  "invoice.update",
  "invoice.payment_failed",
  "refund.pending",
  "refund.processing",
  "refund.processed",
  "refund.failed",
  "charge.dispute.create",
  "charge.dispute.remind",
  "charge.dispute.resolve",
] as const;
export type HandledPaystackEvent = (typeof HANDLED_PAYSTACK_EVENTS)[number];

export interface ParsedWebhookEvent {
  event: string;
  data: Json;
  /** Our dedupe key: Paystack payloads carry no event id, so it is derived (see deriveEventKey). */
  eventKey: string;
  /** The transaction (or subscription) reference the event is about, for lookup and display. */
  reference: string | null;
}

/**
 * Paystack sends no stable event id, and retries resend the same event. The key hashes the
 * event type with the identifiers and status that make two deliveries "the same event":
 * `sha256(event:data.id:reference:subscription_code:invoice_code:refund_reference:status:paid)`.
 * A retry produces the same key (unique per provider in payment_webhook_events); a real state
 * change (another status, another invoice) produces a new one.
 */
export function deriveEventKey(event: string, data: Json): string {
  const transaction = obj(data.transaction);
  const subscription = obj(data.subscription);
  const parts = [
    event,
    str(data.id) ?? "",
    str(data.reference) ??
      str(data.transaction_reference) ??
      (transaction ? str(transaction.reference) : null) ??
      "",
    str(data.subscription_code) ??
      (subscription ? str(subscription.subscription_code) : null) ??
      "",
    str(data.invoice_code) ?? "",
    str(data.refund_reference) ?? "",
    str(data.status) ?? "",
    data.paid === undefined ? "" : String(data.paid),
  ];
  return createHash("sha256").update(parts.join(":")).digest("hex");
}

export function eventReference(data: Json): string | null {
  const transaction = obj(data.transaction);
  const subscription = obj(data.subscription);
  return (
    (
      str(data.reference) ??
      str(data.transaction_reference) ??
      (transaction ? str(transaction.reference) : null) ??
      str(data.subscription_code) ??
      (subscription ? str(subscription.subscription_code) : null)
    )?.slice(0, 200) ?? null
  );
}

const AUTHORIZATION_SECRETS = new Set(["authorization_code", "signature", "bin"]);

/**
 * Copy of a payload fit for storage: inside every `authorization` object the reusable
 * authorization code, the card signature and the BIN are removed (Paystack sends only masked
 * card data, but the authorization code can charge the card again with our key). The signature
 * is checked on the raw bytes before this runs.
 */
export function redactPaystackPayload<T>(value: T, insideAuthorization = false): T {
  if (Array.isArray(value))
    return value.map((v) => redactPaystackPayload(v, insideAuthorization)) as T;
  if (!value || typeof value !== "object") return value;
  const out: Json = {};
  for (const [k, v] of Object.entries(value as Json)) {
    if (insideAuthorization && AUTHORIZATION_SECRETS.has(k)) continue;
    out[k] = redactPaystackPayload(v, k === "authorization");
  }
  return out as T;
}

/** Parses the verified raw body. Returns null for bodies that are not `{ event, data }` JSON. */
export function parseWebhookBody(rawBody: Buffer): ParsedWebhookEvent | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody.toString("utf8"));
  } catch {
    return null;
  }
  const root = obj(parsed);
  const event = root ? str(root.event) : null;
  const data = root ? obj(root.data) : null;
  if (!root || !event || !data || event.length > 100) return null;
  return { event, data, eventKey: deriveEventKey(event, data), reference: eventReference(data) };
}

/** Field access helpers for processors (payload shapes per Paystack's webhook documentation). */
export const PaystackEventData = {
  subscriptionCode(data: Json): string | null {
    const subscription = obj(data.subscription);
    return (
      str(data.subscription_code) ?? (subscription ? str(subscription.subscription_code) : null)
    );
  },
  emailToken(data: Json): string | null {
    const subscription = obj(data.subscription);
    return str(data.email_token) ?? (subscription ? str(subscription.email_token) : null);
  },
  nextPaymentDate(data: Json): Date | null {
    const subscription = obj(data.subscription);
    const raw =
      str(data.next_payment_date) ?? (subscription ? str(subscription.next_payment_date) : null);
    if (!raw) return null;
    const d = new Date(raw);
    return Number.isNaN(d.getTime()) ? null : d;
  },
  customerCode(data: Json): string | null {
    const customer = obj(data.customer);
    return customer ? str(customer.customer_code) : null;
  },
  customerEmail(data: Json): string | null {
    const customer = obj(data.customer);
    return customer ? str(customer.email) : null;
  },
  planCode(data: Json): string | null {
    const plan = obj(data.plan);
    if (typeof data.plan === "string" && data.plan.startsWith("PLN_")) return data.plan;
    return plan ? str(plan.plan_code) : null;
  },
  status(data: Json): string | null {
    return str(data.status);
  },
  invoiceCode(data: Json): string | null {
    return str(data.invoice_code);
  },
  /** invoice.update and invoice.payment_failed: the charge behind the invoice. */
  transactionReference(data: Json): string | null {
    const transaction = obj(data.transaction);
    return (transaction ? str(transaction.reference) : null) ?? str(data.transaction_reference);
  },
  paid(data: Json): boolean {
    return data.paid === true || data.paid === 1 || data.paid === "true";
  },
  /** refund.*: the refund id and the refunded transaction. */
  refund(data: Json): {
    refundId: string | null;
    refundReference: string | null;
    transactionReference: string | null;
    amount: unknown;
    currency: string | null;
    status: string | null;
  } {
    const transaction = obj(data.transaction);
    return {
      refundId: str(data.id),
      refundReference: str(data.refund_reference),
      transactionReference:
        str(data.transaction_reference) ?? (transaction ? str(transaction.reference) : null),
      amount: data.amount,
      currency: str(data.currency),
      status: str(data.status),
    };
  },
  /** charge.dispute.*: the dispute and the disputed transaction. */
  dispute(data: Json): {
    disputeId: string | null;
    transactionReference: string | null;
    status: string | null;
    resolution: string | null;
    amount: unknown;
    currency: string | null;
    reason: string | null;
    dueAt: Date | null;
  } {
    const transaction = obj(data.transaction);
    const due = str(data.dueAt) ?? str(data.due_at);
    const dueAt = due ? new Date(due) : null;
    return {
      disputeId: str(data.id),
      transactionReference: transaction
        ? str(transaction.reference)
        : str(data.transaction_reference),
      status: str(data.status),
      resolution: str(data.resolution),
      amount: data.refund_amount ?? (transaction ? transaction.amount : undefined),
      currency: str(data.currency) ?? (transaction ? str(transaction.currency) : null),
      reason: str(data.category) ?? str(data.reason) ?? str(data.message),
      dueAt: dueAt && !Number.isNaN(dueAt.getTime()) ? dueAt : null,
    };
  },
};
