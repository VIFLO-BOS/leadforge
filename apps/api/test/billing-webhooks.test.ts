import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Collections, MongoService } from "@leadforge/db-mongo";
import { PaymentSettlementService } from "@leadforge/core";
import { createHarness, type Harness } from "./harness.js";
import { createOwner, type OrgUser } from "./fixtures.js";
import {
  billingEnv,
  FAKE_SECRET,
  OTHER_SECRET,
  sign,
  startFakePaystack,
  transactionData,
  webhookBody,
  type FakePaystack,
} from "./paystack-fake.js";
import {
  call,
  createPack,
  customerOf,
  expectInvariant,
  ledgerRows,
  postWebhook,
  startBillingWorker,
} from "./billing-helpers.js";

const PRICE = 250_000; // NGN 2,500.00 (test price)

describe("Paystack webhooks (Phase 6)", () => {
  let fake: FakePaystack;
  let h: Harness;

  beforeAll(async () => {
    fake = await startFakePaystack();
    h = await createHarness(billingEnv(fake));
  });
  afterAll(async () => {
    await h?.close();
    await fake?.close();
  });
  beforeEach(async () => {
    await h.resetState();
    fake.transactions.clear();
  });

  async function checkout(): Promise<{ owner: OrgUser; reference: string; paymentId: string }> {
    const owner = await createOwner(
      h,
      `wh-${randomUUID().slice(0, 8)}@example.test`,
      "Webhook Org",
    );
    const pack = await createPack(h, { credits: 500, priceMinor: PRICE });
    const res = await call(
      owner,
      "post",
      "/billing/checkout/credits",
      { packId: pack.id },
      randomUUID(),
    ).expect(201);
    return { owner, reference: res.body.data.reference, paymentId: res.body.data.paymentId };
  }

  it("accepts a correctly signed event and refuses a tampered body, a wrong secret and a missing signature", async () => {
    const body = webhookBody(
      "charge.success",
      transactionData({ reference: "lf-sig-test", amount: 1000 }),
    );
    const ok = await postWebhook(h, body).expect(200);
    expect(ok.body.data).toEqual({ received: true, duplicate: false });

    const tampered = Buffer.from(
      body.toString("utf8").replace('"amount":1000', '"amount":9000'),
      "utf8",
    );
    const t = await postWebhook(h, tampered, sign(body)).expect(401);
    expect(t.body.error.code).toBe("WEBHOOK_SIGNATURE_INVALID");

    const other = webhookBody(
      "charge.success",
      transactionData({ reference: "lf-sig-other", amount: 1000 }),
    );
    const w = await postWebhook(h, other, sign(other, OTHER_SECRET)).expect(401);
    expect(w.body.error.code).toBe("WEBHOOK_SIGNATURE_INVALID");

    await postWebhook(h, other, null).expect(401);
    await postWebhook(h, other, "not-hex").expect(401);

    // Only the authentic event was stored.
    const events = await h.prisma.paymentWebhookEvent.findMany();
    expect(events.map((e) => e.reference)).toEqual(["lf-sig-test"]);
    expect(events[0]!.signatureValid).toBe(true);
    expect(sign(body, FAKE_SECRET)).toMatch(/^[0-9a-f]{128}$/);
  });

  it("the same charge.success delivered 10 times concurrently yields one payment and one credit grant", async () => {
    const { owner, reference, paymentId } = await checkout();
    const data = transactionData({ reference, amount: PRICE });
    fake.transactions.set(reference, data);
    const body = webhookBody("charge.success", data);

    const results = await Promise.all(Array.from({ length: 10 }, () => postWebhook(h, body)));
    expect(results.map((r) => r.status)).toEqual(Array(10).fill(200));
    expect(results.filter((r) => r.body.data.duplicate === false)).toHaveLength(1);
    expect(await h.prisma.paymentWebhookEvent.count()).toBe(1);

    const w = startBillingWorker(h);
    try {
      await w.drain();
      expect(w.failures).toEqual([]);
    } finally {
      await w.close();
    }

    const customer = await customerOf(h, owner.orgId);
    const payments = await h.prisma.payment.findMany({ where: { billingCustomerId: customer.id } });
    expect(payments).toHaveLength(1);
    expect(payments[0]!.id).toBe(paymentId);
    expect(payments[0]!.status).toBe("success");
    // Card data is masked only: no authorization code or signature is stored.
    expect(JSON.stringify(payments[0]!.authorizationMasked)).not.toMatch(/AUTH_|SIG_/);
    const grants = (await ledgerRows(h, owner.orgId)).filter(
      (r) => r.idempotencyKey === `payment:${paymentId}:grant`,
    );
    expect(grants).toHaveLength(1);
    expect(grants[0]!.entryType).toBe("purchase");
    expect(grants[0]!.units).toBe(500);
    expect(customer.creditBalance).toBe(500);
    expect(await h.prisma.invoice.count({ where: { billingCustomerId: customer.id } })).toBe(1);
    await expectInvariant(h, owner.orgId);

    const event = await h.prisma.paymentWebhookEvent.findFirstOrThrow();
    expect(event.processingStatus).toBe("processed");

    // Receipt notice for the owner.
    const notes = await call(owner, "get", "/notifications").expect(200);
    expect(notes.body.data.map((n: { type: string }) => n.type)).toContain(
      "billing.payment_succeeded",
    );
  });

  it("concurrent settlement of one payment (webhook, return page and reconciliation at once) grants once", async () => {
    const { owner, reference, paymentId } = await checkout();
    fake.transactions.set(reference, transactionData({ reference, amount: PRICE }));
    const settlement = h.app.get(PaymentSettlementService, { strict: false });
    const outcomes = await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        settlement.verifyAndSettle(paymentId, { trigger: i % 2 ? "webhook" : "reconcile" }),
      ),
    );
    expect(outcomes.filter((o) => o === "granted")).toHaveLength(1);
    expect(outcomes.every((o) => o === "granted" || o === "already_final")).toBe(true);
    const rows = (await ledgerRows(h, owner.orgId)).filter((r) => r.units > 0);
    expect(rows).toHaveLength(1);
    expect((await customerOf(h, owner.orgId)).creditBalance).toBe(500);
    await expectInvariant(h, owner.orgId);
  });

  it("a verify that disagrees on the amount grants nothing, flags the payment and alerts", async () => {
    const { owner, reference, paymentId } = await checkout();
    // The webhook claims the right amount; Paystack's verify reports a smaller one.
    fake.transactions.set(reference, transactionData({ reference, amount: 1_000 }));
    await postWebhook(
      h,
      webhookBody("charge.success", transactionData({ reference, amount: PRICE })),
    ).expect(200);
    const w = startBillingWorker(h);
    try {
      await w.drain();
    } finally {
      await w.close();
    }
    const payment = await h.prisma.payment.findUniqueOrThrow({ where: { id: paymentId } });
    expect(payment.status).toBe("pending");
    expect(payment.flagReason).toMatch(/^amount_mismatch/);
    expect(payment.flaggedAt).not.toBeNull();
    expect((await ledgerRows(h, owner.orgId)).filter((r) => r.units > 0)).toHaveLength(0);
    expect((await customerOf(h, owner.orgId)).creditBalance).toBe(0);
    const audit = await h.prisma.billingAudit.findMany({
      where: { action: "payment.verification_mismatch" },
    });
    expect(audit).toHaveLength(1);
    const appAudit = await h.app
      .get(MongoService)
      .database.collection(Collections.auditEvents)
      .countDocuments({ action: "billing.payment_flagged", resourceId: paymentId });
    expect(appAudit).toBe(1);
    const notes = await call(owner, "get", "/notifications").expect(200);
    expect(notes.body.data.map((n: { type: string }) => n.type)).toContain("billing.attention");
    const view = await call(owner, "get", `/billing/payments/${reference}`).expect(200);
    expect(view.body.data.underReview).toBe(true);
    // Reconciliation leaves it for a person: still flagged, still nothing granted.
    const again = await h.app
      .get(PaymentSettlementService, { strict: false })
      .verifyAndSettle(paymentId, { trigger: "reconcile" });
    expect(again).toBe("under_review");
  });

  it("a verify that disagrees on the currency grants nothing", async () => {
    const { owner, reference, paymentId } = await checkout();
    fake.transactions.set(
      reference,
      transactionData({ reference, amount: PRICE, currency: "USD" }),
    );
    const outcome = await h.app
      .get(PaymentSettlementService, { strict: false })
      .verifyAndSettle(paymentId, { trigger: "webhook" });
    expect(outcome).toBe("flagged");
    const payment = await h.prisma.payment.findUniqueOrThrow({ where: { id: paymentId } });
    expect(payment.flagReason).toMatch(/^currency_mismatch/);
    expect((await customerOf(h, owner.orgId)).creditBalance).toBe(0);
  });

  it("never grants from a webhook payload alone: a success Paystack does not confirm settles nothing", async () => {
    const { owner, reference, paymentId } = await checkout();
    // Paystack still reports the checkout as abandoned (the fixture default after initialize).
    await postWebhook(
      h,
      webhookBody("charge.success", transactionData({ reference, amount: PRICE })),
    ).expect(200);
    const w = startBillingWorker(h);
    try {
      await w.drain();
    } finally {
      await w.close();
    }
    const payment = await h.prisma.payment.findUniqueOrThrow({ where: { id: paymentId } });
    expect(payment.status).toBe("pending");
    expect((await customerOf(h, owner.orgId)).creditBalance).toBe(0);
  });

  it("stores and ignores events LeadForge does not use", async () => {
    await postWebhook(
      h,
      webhookBody("transfer.success", { id: 1, reference: "TRF_1", status: "success" }),
    ).expect(200);
    const w = startBillingWorker(h);
    try {
      await w.drain();
    } finally {
      await w.close();
    }
    const event = await h.prisma.paymentWebhookEvent.findFirstOrThrow();
    expect(event.processingStatus).toBe("ignored");
  });

  it("rejects a signed body that is not an event object", async () => {
    const body = Buffer.from(JSON.stringify(["not", "an", "event"]));
    const res = await postWebhook(h, body).expect(400);
    expect(res.body.error.code).toBe("VALIDATION_FAILED");
  });
});

describe("Paystack webhook IP allowlist (Phase 6)", () => {
  let fake: FakePaystack;
  let h: Harness;
  beforeAll(async () => {
    fake = await startFakePaystack();
    h = await createHarness(billingEnv(fake, { PAYSTACK_WEBHOOK_IP_ALLOWLIST: "203.0.113.9" }));
  });
  afterAll(async () => {
    await h?.close();
    await fake?.close();
  });

  it("refuses a correctly signed event from an address outside the allowlist", async () => {
    await h.resetState();
    const body = webhookBody("charge.success", transactionData({ reference: "lf-ip", amount: 1 }));
    const res = await postWebhook(h, body).expect(403);
    expect(res.body.error.code).toBe("FORBIDDEN");
    expect(await h.prisma.paymentWebhookEvent.count()).toBe(0);
  });
});

describe("Billing without a Paystack key (Phase 6)", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await createHarness({ PAYSTACK_SECRET_KEY: "" });
  });
  afterAll(async () => {
    await h?.close();
  });

  it("reports not configured, refuses checkout and webhooks cleanly, and fakes nothing", async () => {
    await h.resetState();
    const owner = await createOwner(h, "nokey-owner@example.test", "No Key Org");
    const pack = await createPack(h, { credits: 100, priceMinor: 100_000 });
    const overview = await call(owner, "get", "/billing/overview").expect(200);
    expect(overview.body.data.provider).toEqual({
      provider: "paystack",
      configured: false,
      mode: null,
    });
    expect(overview.body.data.banners.map((b: { kind: string }) => b.kind)).toContain(
      "not_configured",
    );
    const plans = await call(owner, "get", "/billing/plans").expect(200);
    expect(plans.body.data.creditPacks[0].purchasable).toBe(false);
    expect(plans.body.data.creditPacks[0].blocker).toBe("not_configured");

    const res = await call(
      owner,
      "post",
      "/billing/checkout/credits",
      { packId: pack.id },
      randomUUID(),
    ).expect(422);
    expect(res.body.error.code).toBe("BILLING_NOT_CONFIGURED");
    expect(await h.prisma.payment.count()).toBe(0);

    const body = webhookBody("charge.success", transactionData({ reference: "lf-x", amount: 1 }));
    const wh = await postWebhook(h, body).expect(422);
    expect(wh.body.error.code).toBe("BILLING_NOT_CONFIGURED");
    expect(await h.prisma.paymentWebhookEvent.count()).toBe(0);
  });
});
