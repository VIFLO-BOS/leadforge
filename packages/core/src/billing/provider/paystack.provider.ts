import { createHmac, timingSafeEqual } from "node:crypto";
import { AppError } from "../../common/errors/app.error.js";
import {
  PaymentProviderError,
  type InitializeTransactionInput,
  type InitializedTransaction,
  type MaskedAuthorization,
  type PaymentProvider,
  type ProviderMode,
  type ProviderRefund,
  type ProviderSubscription,
  type ProviderTransactionStatus,
  type VerifiedTransaction,
} from "./payment-provider.js";

const REQUEST_TIMEOUT_MS = 15_000;

type Json = Record<string, unknown>;

const str = (v: unknown): string | null =>
  typeof v === "string" && v.length > 0 ? v : typeof v === "number" ? String(v) : null;
const obj = (v: unknown): Json | null =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Json) : null;

/** Integer minor units from a Paystack amount (a number or a numeric string). */
export function paystackAmount(v: unknown): bigint {
  if (typeof v === "number" && Number.isInteger(v)) return BigInt(v);
  if (typeof v === "string" && /^-?\d+$/.test(v.trim())) return BigInt(v.trim());
  throw new PaymentProviderError("Paystack returned an amount that is not an integer");
}

function date(v: unknown): Date | null {
  const s = str(v);
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Paystack plan fields come as a code string, a numeric id, or a plan object. */
export function planCodeOf(v: unknown): string | null {
  if (typeof v === "string") return v.startsWith("PLN_") ? v : null;
  const o = obj(v);
  return o ? str(o.plan_code) : null;
}

export function normalizeTransactionStatus(raw: string): ProviderTransactionStatus {
  switch (raw) {
    case "success":
      return "success";
    case "failed":
      return "failed";
    case "abandoned":
      return "abandoned";
    case "reversed":
      return "reversed";
    default:
      // ongoing, pending, processing, queued: not final yet.
      return "pending";
  }
}

export function maskedAuthorization(
  v: unknown,
  channel: string | null,
): MaskedAuthorization | null {
  const a = obj(v);
  if (!a) return null;
  // Only display fields are kept. authorization_code, bin and signature are deliberately dropped.
  return {
    brand: str(a.brand) ?? str(a.card_type),
    last4: str(a.last4),
    expMonth: str(a.exp_month),
    expYear: str(a.exp_year),
    bank: str(a.bank),
    cardType: str(a.card_type),
    channel: str(a.channel) ?? channel,
  };
}

/** Maps a Paystack transaction object (verify response or charge.success data) to our shape. */
export function toVerifiedTransaction(data: Json): VerifiedTransaction {
  const rawStatus = str(data.status) ?? "unknown";
  const customer = obj(data.customer);
  const channel = str(data.channel);
  const domain = str(data.domain);
  return {
    status: normalizeTransactionStatus(rawStatus),
    rawStatus,
    reference: str(data.reference) ?? "",
    providerTransactionId: str(data.id),
    amountMinor: paystackAmount(data.amount),
    currency: (str(data.currency) ?? "").toUpperCase(),
    paidAt: date(data.paid_at) ?? date(data.paidAt),
    channel,
    gatewayResponse: str(data.gateway_response)?.slice(0, 300) ?? null,
    authorization: maskedAuthorization(data.authorization, channel),
    customerCode: customer ? str(customer.customer_code) : null,
    customerEmail: customer ? str(customer.email) : null,
    planCode: planCodeOf(data.plan) ?? planCodeOf(data.plan_object),
    mode: domain === "test" || domain === "live" ? domain : null,
  };
}

export function toProviderSubscription(data: Json): ProviderSubscription {
  const customer = obj(data.customer);
  const latestInvoice = obj(data.most_recent_invoice);
  const invoices = Array.isArray(data.invoices)
    ? (data.invoices as unknown[]).map(obj).filter((i): i is Json => Boolean(i))
    : [];
  const newest = latestInvoice ?? invoices[invoices.length - 1] ?? null;
  const newestTx = newest ? obj(newest.transaction) : null;
  return {
    code: str(data.subscription_code) ?? "",
    emailToken: str(data.email_token),
    status: str(data.status) ?? "unknown",
    planCode: planCodeOf(data.plan),
    customerCode: customer ? str(customer.customer_code) : null,
    nextPaymentDate: date(data.next_payment_date),
    latestTransactionReference: newestTx
      ? str(newestTx.reference)
      : newest
        ? str(newest.reference)
        : null,
  };
}

/** HMAC-SHA512 of the raw body with the secret key, hex; compared in constant time. */
export function paystackSignature(secret: string, rawBody: Buffer): string {
  return createHmac("sha512", secret).update(rawBody).digest("hex");
}

export function verifyPaystackSignature(
  secret: string,
  rawBody: Buffer,
  header: string | undefined,
): boolean {
  if (!header) return false;
  const given = header.trim().toLowerCase();
  if (!/^[0-9a-f]{128}$/.test(given)) return false;
  const expected = Buffer.from(paystackSignature(secret, rawBody), "utf8");
  const presented = Buffer.from(given, "utf8");
  return expected.length === presented.length && timingSafeEqual(expected, presented);
}

/**
 * Paystack REST client (https://paystack.com/docs/api). Server-side only: the secret key never
 * leaves this process, amounts are integer subunits (kobo), and the redirect flow means no
 * client key is needed. Without PAYSTACK_SECRET_KEY every call fails with BILLING_NOT_CONFIGURED
 * (422) and nothing is faked. PAYSTACK_BASE_URL may point at a local fixture server in
 * development and tests only (the environment schema refuses it in production).
 */
export class PaystackProvider implements PaymentProvider {
  readonly name = "paystack" as const;
  readonly configured: boolean;
  readonly mode: ProviderMode | null;
  private readonly baseUrl: string;

  constructor(
    private readonly secretKey: string | undefined,
    baseUrl = "https://api.paystack.co",
    private readonly fetchImpl: typeof fetch = fetch,
  ) {
    this.configured = Boolean(secretKey);
    this.mode = secretKey ? (secretKey.startsWith("sk_live_") ? "live" : "test") : null;
    this.baseUrl = baseUrl.replace(/\/$/, "");
  }

  private key(): string {
    if (!this.secretKey)
      throw new AppError(
        "BILLING_NOT_CONFIGURED",
        "Payments are not configured on this server yet. Nothing was charged.",
      );
    return this.secretKey;
  }

  verifyWebhookSignature(rawBody: Buffer, signature: string | undefined): boolean {
    if (!this.secretKey) return false;
    return verifyPaystackSignature(this.secretKey, rawBody, signature);
  }

  private async call(method: "GET" | "POST", path: string, body?: Json): Promise<Json> {
    const key = this.key();
    let res: Response;
    try {
      res = await this.fetchImpl(`${this.baseUrl}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${key}`,
          Accept: "application/json",
          ...(body ? { "Content-Type": "application/json" } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (err) {
      throw new PaymentProviderError(
        `Paystack request failed: ${err instanceof Error ? err.name : "network error"}`,
      );
    }
    let payload: Json | null = null;
    try {
      payload = obj(await res.json());
    } catch {
      payload = null;
    }
    const message = (payload && str(payload.message)) ?? `HTTP ${res.status}`;
    if (!res.ok || !payload || payload.status !== true) {
      const notFound = res.status === 404 || /not found/i.test(message);
      throw new PaymentProviderError(
        `Paystack ${method} ${path.split("?")[0]?.replace(/\/[^/]*$/, "/:id")} failed: ${message.slice(0, 200)}`,
        res.status,
        notFound,
      );
    }
    return payload;
  }

  private static data(payload: Json): Json {
    const data = obj(payload.data);
    if (!data) throw new PaymentProviderError("Paystack returned no data object");
    return data;
  }

  async createCustomer(input: {
    email: string;
    metadata: Record<string, string>;
  }): Promise<{ customerCode: string }> {
    const data = PaystackProvider.data(
      await this.call("POST", "/customer", { email: input.email, metadata: input.metadata }),
    );
    const code = str(data.customer_code);
    if (!code) throw new PaymentProviderError("Paystack returned no customer_code");
    return { customerCode: code };
  }

  async createPlan(input: {
    name: string;
    interval: "monthly" | "yearly";
    amountMinor: bigint;
    currency: string;
    description: string | null;
  }): Promise<{ planCode: string }> {
    const data = PaystackProvider.data(
      await this.call("POST", "/plan", {
        name: input.name,
        interval: input.interval === "yearly" ? "annually" : "monthly",
        amount: input.amountMinor.toString(),
        currency: input.currency,
        ...(input.description ? { description: input.description } : {}),
      }),
    );
    const code = str(data.plan_code);
    if (!code) throw new PaymentProviderError("Paystack returned no plan_code");
    return { planCode: code };
  }

  async initializeTransaction(input: InitializeTransactionInput): Promise<InitializedTransaction> {
    const data = PaystackProvider.data(
      await this.call("POST", "/transaction/initialize", {
        email: input.email,
        // Subunits as a string (Paystack). With `plan`, Paystack charges the plan amount instead.
        amount: input.amountMinor.toString(),
        currency: input.currency,
        reference: input.reference,
        callback_url: input.callbackUrl,
        ...(input.planCode ? { plan: input.planCode } : {}),
        metadata: input.metadata,
      }),
    );
    const url = str(data.authorization_url);
    if (!url) throw new PaymentProviderError("Paystack returned no authorization_url");
    return {
      authorizationUrl: url,
      accessCode: str(data.access_code),
      reference: str(data.reference) ?? input.reference,
    };
  }

  async verifyTransaction(reference: string): Promise<VerifiedTransaction> {
    const data = PaystackProvider.data(
      await this.call("GET", `/transaction/verify/${encodeURIComponent(reference)}`),
    );
    return toVerifiedTransaction(data);
  }

  async fetchSubscription(code: string): Promise<ProviderSubscription> {
    return toProviderSubscription(
      PaystackProvider.data(await this.call("GET", `/subscription/${encodeURIComponent(code)}`)),
    );
  }

  async disableSubscription(code: string, emailToken: string): Promise<void> {
    await this.call("POST", "/subscription/disable", { code, token: emailToken });
  }

  async enableSubscription(code: string, emailToken: string): Promise<void> {
    await this.call("POST", "/subscription/enable", { code, token: emailToken });
  }

  async manageSubscriptionLink(code: string): Promise<{ url: string }> {
    const data = PaystackProvider.data(
      await this.call("GET", `/subscription/${encodeURIComponent(code)}/manage/link`),
    );
    const link = str(data.link);
    if (!link) throw new PaymentProviderError("Paystack returned no manage link");
    return { url: link };
  }

  async refund(input: {
    reference: string;
    amountMinor: bigint;
    currency: string;
    merchantNote: string;
  }): Promise<ProviderRefund> {
    const data = PaystackProvider.data(
      await this.call("POST", "/refund", {
        transaction: input.reference,
        amount: input.amountMinor.toString(),
        currency: input.currency,
        merchant_note: input.merchantNote.slice(0, 200),
      }),
    );
    const id = str(data.id);
    if (!id) throw new PaymentProviderError("Paystack returned no refund id");
    return {
      id,
      status: str(data.status) ?? "pending",
      amountMinor: data.amount !== undefined ? paystackAmount(data.amount) : input.amountMinor,
      currency: (str(data.currency) ?? input.currency).toUpperCase(),
    };
  }
}
