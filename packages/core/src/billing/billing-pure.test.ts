import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { addInterval, formatMinor, proportionalReversal } from "./money.js";
import { renderInvoicePdf } from "./invoice-pdf.js";
import { DEFAULT_BILLING_CATALOGUE, freeTierEntitlements } from "./catalogue.js";
import {
  deriveEventKey,
  eventReference,
  parseWebhookBody,
  redactPaystackPayload,
} from "./provider/paystack-events.js";
import {
  normalizeTransactionStatus,
  PaystackProvider,
  paystackSignature,
  toProviderSubscription,
  toVerifiedTransaction,
  verifyPaystackSignature,
} from "./provider/paystack.provider.js";

const SECRET = "sk_test_unit0123456789abcdef";

/** Hand-built fixture following Paystack's documented charge.success / verify `data` shape. */
const charge = {
  id: 302961,
  domain: "test",
  status: "success",
  reference: "lf-0192f1f0-0000-7000-8000-000000000001",
  amount: 250000,
  gateway_response: "Successful",
  paid_at: "2026-10-26T10:00:00.000Z",
  channel: "card",
  currency: "NGN",
  customer: { id: 1, email: "billing@example.test", customer_code: "CUS_unit" },
  authorization: {
    authorization_code: "AUTH_secret",
    bin: "408408",
    last4: "4081",
    exp_month: "12",
    exp_year: "2030",
    card_type: "visa",
    bank: "TEST BANK",
    brand: "visa",
    reusable: true,
    signature: "SIG_secret",
  },
  plan: { plan_code: "PLN_unit", interval: "monthly" },
};

describe("Paystack webhook signature (HMAC-SHA512 over the raw body)", () => {
  const body = Buffer.from(JSON.stringify({ event: "charge.success", data: charge }));

  it("accepts the exact body signed with the secret key", () => {
    const sig = createHmac("sha512", SECRET).update(body).digest("hex");
    expect(paystackSignature(SECRET, body)).toBe(sig);
    expect(verifyPaystackSignature(SECRET, body, sig)).toBe(true);
    expect(verifyPaystackSignature(SECRET, body, sig.toUpperCase())).toBe(true);
  });

  it("refuses a tampered body, a wrong secret, and missing or malformed headers", () => {
    const sig = paystackSignature(SECRET, body);
    const tampered = Buffer.from(body.toString().replace("250000", "250001"));
    expect(verifyPaystackSignature(SECRET, tampered, sig)).toBe(false);
    expect(verifyPaystackSignature("sk_test_other0123456789", body, sig)).toBe(false);
    expect(verifyPaystackSignature(SECRET, body, undefined)).toBe(false);
    expect(verifyPaystackSignature(SECRET, body, "abc")).toBe(false);
    expect(verifyPaystackSignature(SECRET, body, `${sig.slice(0, -1)}g`)).toBe(false);
    // Re-serialized JSON is not the raw body: spacing differences break the signature.
    const reformatted = Buffer.from(JSON.stringify(JSON.parse(body.toString()), null, 2));
    expect(verifyPaystackSignature(SECRET, reformatted, sig)).toBe(false);
  });

  it("an unconfigured provider verifies nothing and refuses calls with BILLING_NOT_CONFIGURED", async () => {
    const provider = new PaystackProvider(undefined);
    expect(provider.configured).toBe(false);
    expect(provider.mode).toBeNull();
    expect(provider.verifyWebhookSignature(body, paystackSignature(SECRET, body))).toBe(false);
    await expect(provider.verifyTransaction("lf-x")).rejects.toMatchObject({
      code: "BILLING_NOT_CONFIGURED",
    });
    expect(new PaystackProvider("sk_live_abcdefgh123").mode).toBe("live");
    expect(new PaystackProvider(SECRET).mode).toBe("test");
  });
});

describe("Paystack payload mapping", () => {
  it("maps a transaction to integer kobo and keeps only masked card fields", () => {
    const v = toVerifiedTransaction(charge);
    expect(v).toMatchObject({
      status: "success",
      reference: charge.reference,
      amountMinor: 250000n,
      currency: "NGN",
      customerCode: "CUS_unit",
      planCode: "PLN_unit",
      mode: "test",
      providerTransactionId: "302961",
    });
    expect(v.paidAt?.toISOString()).toBe("2026-10-26T10:00:00.000Z");
    expect(v.authorization).toEqual({
      brand: "visa",
      last4: "4081",
      expMonth: "12",
      expYear: "2030",
      bank: "TEST BANK",
      cardType: "visa",
      channel: "card",
    });
    expect(
      JSON.stringify(v, (_k, x: unknown) => (typeof x === "bigint" ? x.toString() : x)),
    ).not.toMatch(/AUTH_secret|SIG_secret|408408/);
    expect(() => toVerifiedTransaction({ ...charge, amount: 2500.5 })).toThrow(/integer/);
  });

  it("treats only success, failed, abandoned and reversed as final", () => {
    expect(
      [
        "success",
        "failed",
        "abandoned",
        "reversed",
        "ongoing",
        "pending",
        "processing",
        "queued",
      ].map(normalizeTransactionStatus),
    ).toEqual([
      "success",
      "failed",
      "abandoned",
      "reversed",
      "pending",
      "pending",
      "pending",
      "pending",
    ]);
  });

  it("reads a subscription and the reference of its latest charge", () => {
    const s = toProviderSubscription({
      subscription_code: "SUB_1",
      email_token: "tok",
      status: "active",
      next_payment_date: "2026-11-26T10:00:00.000Z",
      plan: { plan_code: "PLN_1" },
      customer: { customer_code: "CUS_1" },
      most_recent_invoice: { transaction: { reference: "T_1" } },
    });
    expect(s).toMatchObject({
      code: "SUB_1",
      emailToken: "tok",
      status: "active",
      planCode: "PLN_1",
      customerCode: "CUS_1",
      latestTransactionReference: "T_1",
    });
  });
});

describe("Webhook event keys", () => {
  it("is stable for a redelivery and differs for a real change", () => {
    const a = deriveEventKey("charge.success", charge);
    expect(deriveEventKey("charge.success", { ...charge })).toBe(a);
    expect(deriveEventKey("charge.success", { ...charge, status: "reversed" })).not.toBe(a);
    expect(
      deriveEventKey("invoice.update", {
        invoice_code: "INV_1",
        paid: true,
        subscription: { subscription_code: "SUB_1" },
      }),
    ).not.toBe(
      deriveEventKey("invoice.update", {
        invoice_code: "INV_1",
        paid: false,
        subscription: { subscription_code: "SUB_1" },
      }),
    );
    expect(eventReference({ subscription: { subscription_code: "SUB_9" } })).toBe("SUB_9");
    expect(eventReference({ transaction_reference: "T_9" })).toBe("T_9");
  });

  it("redacts reusable authorization codes before an event is stored", () => {
    const stored = redactPaystackPayload({
      ...charge,
      subscription: { authorization: { authorization_code: "AUTH_x", last4: "1111" } },
    });
    expect(stored.authorization).toEqual({
      last4: "4081",
      exp_month: "12",
      exp_year: "2030",
      card_type: "visa",
      bank: "TEST BANK",
      brand: "visa",
      reusable: true,
    });
    expect(
      (stored as unknown as { subscription: { authorization: unknown } }).subscription
        .authorization,
    ).toEqual({ last4: "1111" });
    expect(stored.reference).toBe(charge.reference);
    expect(deriveEventKey("charge.success", stored)).toBe(deriveEventKey("charge.success", charge));
  });

  it("parses only `{ event, data }` JSON objects", () => {
    expect(parseWebhookBody(Buffer.from("not json"))).toBeNull();
    expect(parseWebhookBody(Buffer.from("[1,2]"))).toBeNull();
    expect(parseWebhookBody(Buffer.from(JSON.stringify({ event: "charge.success" })))).toBeNull();
    expect(
      parseWebhookBody(Buffer.from(JSON.stringify({ event: "charge.success", data: charge })))
        ?.reference,
    ).toBe(charge.reference);
  });
});

describe("Money (integer minor units)", () => {
  it("formats without floating point", () => {
    expect(formatMinor(250000n, "NGN")).toBe("NGN 2,500.00");
    expect(formatMinor(1, "ngn")).toBe("NGN 0.01");
    expect(formatMinor(-123456789n, "USD")).toBe("-USD 1,234,567.89");
    expect(formatMinor(9007199254740993n, "NGN")).toBe("NGN 90,071,992,547,409.93");
  });

  it("takes credits back in proportion to a refund, and exactly the rest on the last one", () => {
    expect(
      proportionalReversal({
        granted: 500,
        paid: 250000n,
        refunded: 50000n,
        alreadyReversed: 0,
        completesPayment: false,
      }),
    ).toBe(100);
    expect(
      proportionalReversal({
        granted: 500,
        paid: 250000n,
        refunded: 200000n,
        alreadyReversed: 100,
        completesPayment: true,
      }),
    ).toBe(400);
    expect(
      proportionalReversal({
        granted: 3,
        paid: 300n,
        refunded: 150n,
        alreadyReversed: 0,
        completesPayment: false,
      }),
    ).toBe(2);
    expect(
      proportionalReversal({
        granted: 10,
        paid: 100n,
        refunded: 100n,
        alreadyReversed: 10,
        completesPayment: true,
      }),
    ).toBe(0);
  });

  it("adds calendar months, clamping the 31st", () => {
    expect(addInterval(new Date("2026-01-31T09:00:00Z"), "monthly").toISOString()).toBe(
      "2026-02-28T09:00:00.000Z",
    );
    expect(addInterval(new Date("2026-10-26T09:00:00Z"), "monthly").toISOString()).toBe(
      "2026-11-26T09:00:00.000Z",
    );
    expect(addInterval(new Date("2028-02-29T00:00:00Z"), "yearly").toISOString()).toBe(
      "2029-02-28T00:00:00.000Z",
    );
  });
});

describe("Catalogue", () => {
  it("ships only unpublished placeholder prices", () => {
    for (const p of [
      ...DEFAULT_BILLING_CATALOGUE.plans,
      ...DEFAULT_BILLING_CATALOGUE.creditPacks,
    ]) {
      expect(p.isPlaceholder).toBe(true);
      expect(p.priceMinor).toBe(0);
    }
    expect(
      freeTierEntitlements({ BILLING_FREE_MAX_MEMBERS: 5, EXPORT_DEFAULT_ROW_CAP: 10000 }),
    ).toEqual({
      maxMembers: 5,
      exportRowCap: 10000,
      discoveryEnabled: true,
      websiteAnalysisEnabled: true,
      monthlyIncludedCredits: 0,
    });
  });
});

describe("Invoice PDF", () => {
  it("renders a PDF from the stored invoice", async () => {
    const pdf = await renderInvoicePdf({
      number: "LF-2026-000001",
      status: "paid",
      issuedAt: new Date("2026-10-26T10:00:00Z"),
      paidAt: new Date("2026-10-26T10:00:00Z"),
      periodStart: null,
      periodEnd: null,
      currency: "NGN",
      lines: [
        {
          description: "Credit pack: 500 credits",
          quantity: 1,
          unitMinor: 250000n,
          amountMinor: 250000n,
        },
      ],
      subtotalMinor: 250000n,
      taxMinor: 0n,
      totalMinor: 250000n,
      billTo: {
        organizationName: "Acme Demo (Synthetic)",
        email: "owner@example.test",
        country: "NG",
      },
      payment: { reference: "lf-1", method: "visa ending 4081" },
      testMode: true,
    });
    expect(pdf.subarray(0, 5).toString("latin1")).toBe("%PDF-");
    expect(pdf.subarray(-6).toString("latin1")).toMatch(/%%EOF/);
    expect(pdf.length).toBeGreaterThan(1000);
  });
});
