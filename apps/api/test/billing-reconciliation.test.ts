import { randomUUID } from "node:crypto";
import { Queue } from "bullmq";
import { Redis } from "ioredis";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { ObjectId } from "@leadforge/db-mongo";
import {
  AppError,
  BillingReconciliationService,
  DiscoveryReconciliationService,
  EntitlementsService,
  PaymentSettlementService,
  QueueNames,
} from "@leadforge/core";
import { createHarness, TEST_QUEUE_PREFIX, type Harness } from "./harness.js";
import { createOwner, type OrgUser } from "./fixtures.js";
import {
  billingEnv,
  startFakePaystack,
  transactionData,
  webhookBody,
  type FakePaystack,
} from "./paystack-fake.js";
import {
  call,
  createPack,
  createPlan,
  creditsOf,
  customerOf,
  expectInvariant,
  ledgerRows,
  postWebhook,
  startBillingWorker,
} from "./billing-helpers.js";

const PRICE = 100_000;
const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

describe("Billing reconciliation and credit consumption (Phase 6)", () => {
  let fake: FakePaystack;
  let h: Harness;
  let billingQueue: Queue;

  beforeAll(async () => {
    fake = await startFakePaystack();
    h = await createHarness(billingEnv(fake));
    billingQueue = new Queue(QueueNames.billing, {
      connection: new Redis(process.env.REDIS_URL!, { maxRetriesPerRequest: null }),
      prefix: TEST_QUEUE_PREFIX,
    });
  });
  afterAll(async () => {
    await billingQueue?.close();
    await h?.close();
    await fake?.close();
  });
  beforeEach(async () => {
    await h.resetState();
    fake.transactions.clear();
    fake.subscriptions.clear();
  });

  const reconciliation = () => h.app.get(BillingReconciliationService, { strict: false });

  async function packCheckout(
    owner: OrgUser,
    credits = 10,
  ): Promise<{ reference: string; paymentId: string }> {
    const pack = await createPack(h, { credits, priceMinor: PRICE });
    const res = await call(
      owner,
      "post",
      "/billing/checkout/credits",
      { packId: pack.id },
      randomUUID(),
    ).expect(201);
    return { reference: res.body.data.reference, paymentId: res.body.data.paymentId };
  }

  it("verifies and settles stuck pending payments, abandons old unpaid ones, and records a run", async () => {
    const owner = await createOwner(h, "rec-owner@example.test", "Rec Org");
    const paid = await packCheckout(owner, 10);
    const fresh = await packCheckout(owner, 10);
    const unpaid = await packCheckout(owner, 10);
    // The webhook never arrived; Paystack says the first one succeeded.
    fake.transactions.set(
      paid.reference,
      transactionData({ reference: paid.reference, amount: PRICE }),
    );
    fake.transactions.set(
      fresh.reference,
      transactionData({ reference: fresh.reference, amount: PRICE }),
    );
    await h.prisma.payment.update({
      where: { id: paid.paymentId },
      data: { initiatedAt: new Date(Date.now() - 30 * MIN) },
    });
    await h.prisma.payment.update({
      where: { id: unpaid.paymentId },
      data: { initiatedAt: new Date(Date.now() - 25 * HOUR) },
    });

    const report = await reconciliation().reconcilePayments();
    expect(report).toMatchObject({ checked: 2, fixed: 2, errors: 0 });
    expect(
      (await h.prisma.payment.findUniqueOrThrow({ where: { id: paid.paymentId } })).status,
    ).toBe("success");
    expect(
      (await h.prisma.payment.findUniqueOrThrow({ where: { id: unpaid.paymentId } })).status,
    ).toBe("abandoned");
    // Younger than BILLING_PENDING_VERIFY_AFTER_MINUTES: left for the webhook or the return page.
    expect(
      (await h.prisma.payment.findUniqueOrThrow({ where: { id: fresh.paymentId } })).status,
    ).toBe("pending");
    expect((await customerOf(h, owner.orgId)).creditBalance).toBe(10);
    const runs = await h.prisma.reconciliationRun.findMany({ where: { kind: "payments" } });
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({ checked: 2, fixed: 2 });

    // A second pass finds nothing to do and grants nothing more.
    expect(await reconciliation().reconcilePayments()).toMatchObject({ checked: 0, fixed: 0 });
    await expectInvariant(h, owner.orgId);
  });

  it("re-enqueues webhooks that were stored but never processed", async () => {
    const owner = await createOwner(h, "rewh-owner@example.test", "Rewh Org");
    const { reference, paymentId } = await packCheckout(owner, 10);
    fake.transactions.set(reference, transactionData({ reference, amount: PRICE }));
    await postWebhook(
      h,
      webhookBody("charge.success", transactionData({ reference, amount: PRICE })),
    ).expect(200);
    // Simulate a lost queue job (Redis flushed, crash between insert and enqueue).
    await billingQueue.obliterate({ force: true });
    await h.prisma.paymentWebhookEvent.updateMany({
      data: { receivedAt: new Date(Date.now() - 10 * MIN) },
    });

    const report = await reconciliation().reconcileWebhooks();
    expect(report).toMatchObject({ checked: 1, fixed: 1, errors: 0 });
    expect(await billingQueue.getJobCountByTypes("waiting", "prioritized", "delayed")).toBe(1);
    const w = startBillingWorker(h);
    try {
      await w.drain();
    } finally {
      await w.close();
    }
    expect((await h.prisma.paymentWebhookEvent.findFirstOrThrow()).processingStatus).toBe(
      "processed",
    );
    expect((await h.prisma.payment.findUniqueOrThrow({ where: { id: paymentId } })).status).toBe(
      "success",
    );
    expect(await h.prisma.reconciliationRun.count({ where: { kind: "webhooks" } })).toBe(1);
    // Processed events are not picked up again.
    expect(await reconciliation().reconcileWebhooks()).toMatchObject({ checked: 0 });
  });

  it("ends subscriptions whose period ended, expires unpaid ones after the grace period, and recovers a missed renewal", async () => {
    const entitlements = h.app.get(EntitlementsService, { strict: false });
    const settlement = h.app.get(PaymentSettlementService, { strict: false });
    const plan = await createPlan(h, {
      name: "Recon",
      priceMinor: PRICE,
      maxMembers: 9,
      includedCredits: 20,
    });

    async function activeSubscriber(email: string): Promise<{ owner: OrgUser; subId: string }> {
      const owner = await createOwner(h, email, `${email} org`);
      const res = await call(
        owner,
        "post",
        "/billing/checkout/subscription",
        { planId: plan.id },
        randomUUID(),
      ).expect(201);
      fake.transactions.set(
        res.body.data.reference,
        transactionData({ reference: res.body.data.reference, amount: PRICE }),
      );
      expect(
        await settlement.verifyAndSettle(res.body.data.paymentId, { trigger: "webhook" }),
      ).toBe("granted");
      const sub = await h.prisma.subscription.findFirstOrThrow({
        where: { billingCustomer: { organizationId: owner.orgId }, status: "active" },
      });
      expect(await entitlements.maxMembers(owner.orgId)).toBe(9);
      return { owner, subId: sub.id };
    }

    // a) cancelled at period end, period over -> cancelled, free tier.
    const a = await activeSubscriber("rec-a@example.test");
    await h.prisma.subscription.update({
      where: { id: a.subId },
      data: { cancelAtPeriodEnd: true, currentPeriodEnd: new Date(Date.now() - MIN) },
    });
    // b) past due beyond the 7-day grace -> expired, free tier.
    const b = await activeSubscriber("rec-b@example.test");
    await h.prisma.subscription.update({
      where: { id: b.subId },
      data: { status: "past_due", pastDueAt: new Date(Date.now() - 8 * DAY) },
    });
    // c) period ended 2 hours ago with no renewal event; Paystack shows the renewal charge.
    const c = await activeSubscriber("rec-c@example.test");
    await h.prisma.subscription.update({
      where: { id: c.subId },
      data: {
        currentPeriodEnd: new Date(Date.now() - 2 * HOUR),
        providerSubscriptionCode: "SUB_rec_c",
        providerEmailToken: "tok_c",
      },
    });
    const customerCode = (await customerOf(h, c.owner.orgId)).providerCustomerCode!;
    fake.subscriptions.set("SUB_rec_c", {
      subscription_code: "SUB_rec_c",
      email_token: "tok_c",
      status: "active",
      next_payment_date: new Date(Date.now() + 29 * DAY).toISOString(),
      plan: { plan_code: "PLN_missing" },
      customer: { customer_code: customerCode },
      most_recent_invoice: {
        invoice_code: "INV_rec_c",
        status: "success",
        transaction: { reference: "T_missed_renewal" },
      },
    });
    fake.transactions.set(
      "T_missed_renewal",
      transactionData({ reference: "T_missed_renewal", amount: PRICE, customerCode }),
    );
    // d) an incomplete checkout from yesterday -> expired.
    const d = await createOwner(h, "rec-d@example.test", "Rec D");
    await call(
      d,
      "post",
      "/billing/checkout/subscription",
      { planId: plan.id },
      randomUUID(),
    ).expect(201);
    await h.prisma.subscription.updateMany({
      where: { billingCustomer: { organizationId: d.orgId } },
      data: { createdAt: new Date(Date.now() - 25 * HOUR) },
    });

    const report = await reconciliation().reconcileSubscriptions();
    expect(report.errors).toBe(0);
    expect(report.fixed).toBe(4);
    expect((await h.prisma.subscription.findUniqueOrThrow({ where: { id: a.subId } })).status).toBe(
      "cancelled",
    );
    expect(await entitlements.maxMembers(a.owner.orgId)).toBe(5);
    expect((await h.prisma.subscription.findUniqueOrThrow({ where: { id: b.subId } })).status).toBe(
      "expired",
    );
    expect(await entitlements.maxMembers(b.owner.orgId)).toBe(5);
    const renewed = await h.prisma.subscription.findUniqueOrThrow({ where: { id: c.subId } });
    expect(renewed.status).toBe("active");
    expect(renewed.currentPeriodEnd!.getTime()).toBeGreaterThan(Date.now());
    expect((await customerOf(h, c.owner.orgId)).creditBalance).toBe(40);
    expect(
      await h.prisma.subscription.count({
        where: { billingCustomer: { organizationId: d.orgId }, status: "expired" },
      }),
    ).toBe(1);
    expect(await h.prisma.reconciliationRun.count({ where: { kind: "subscriptions" } })).toBe(1);

    // The scheduled job runs all three passes through the queue handler.
    await billingQueue.add("reconcile-billing", {});
    const w = startBillingWorker(h);
    try {
      await w.drain();
      expect(w.failures).toEqual([]);
    } finally {
      await w.close();
    }
    expect(
      await h.prisma.reconciliationRun.count({
        where: { kind: { in: ["payments", "webhooks", "subscriptions"] } },
      }),
    ).toBe(4);
  });

  it("releases orphan credit holds (the existing holds pass)", async () => {
    const owner = await createOwner(h, "orphan-owner@example.test", "Orphan Org");
    await creditsOf(h).grant(owner.orgId, {
      units: 50,
      key: `test:${owner.orgId}`,
      description: "Test grant",
    });
    const ghostJob = new ObjectId().toHexString();
    await creditsOf(h).hold(owner.orgId, {
      units: 20,
      key: `job:${ghostJob}:hold`,
      referenceType: "discovery_job",
      referenceId: ghostJob,
      actorUserId: null,
      description: "Hold for a job that was never saved",
    });
    await h.prisma.creditLedger.updateMany({
      where: { idempotencyKey: `job:${ghostJob}:hold` },
      data: { createdAt: new Date(Date.now() - 25 * HOUR) },
    });
    expect((await customerOf(h, owner.orgId)).creditBalance).toBe(30);
    await h.app.get(DiscoveryReconciliationService, { strict: false }).run();
    expect((await customerOf(h, owner.orgId)).creditBalance).toBe(50);
    expect(
      await h.prisma.reconciliationRun.count({ where: { kind: "holds" } }),
    ).toBeGreaterThanOrEqual(1);
    await expectInvariant(h, owner.orgId);
  });

  it("concurrent consumption against a purchased grant: 50 parallel holds of 1 on 10 credits give exactly 10", async () => {
    const owner = await createOwner(h, "conc-owner@example.test", "Conc Org");
    const { reference, paymentId } = await packCheckout(owner, 10);
    fake.transactions.set(reference, transactionData({ reference, amount: PRICE }));
    expect(
      await h.app
        .get(PaymentSettlementService, { strict: false })
        .verifyAndSettle(paymentId, { trigger: "webhook" }),
    ).toBe("granted");
    const credits = creditsOf(h);
    const results = await Promise.allSettled(
      Array.from({ length: 50 }, (_, i) =>
        credits.hold(owner.orgId, {
          units: 1,
          key: `conc:${i}:hold`,
          referenceType: "test",
          referenceId: String(i),
          actorUserId: null,
          description: "Concurrent hold",
        }),
      ),
    );
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(10);
    const rejected = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");
    expect(rejected).toHaveLength(40);
    expect(
      rejected.every(
        (r) => r.reason instanceof AppError && r.reason.code === "INSUFFICIENT_CREDITS",
      ),
    ).toBe(true);
    expect((await customerOf(h, owner.orgId)).creditBalance).toBe(0);
    await expectInvariant(h, owner.orgId);
  });

  it("failed job refund path: a job that fails after a hold returns every held credit", async () => {
    const owner = await createOwner(h, "failjob-owner@example.test", "Failjob Org");
    const { reference, paymentId } = await packCheckout(owner, 30);
    fake.transactions.set(reference, transactionData({ reference, amount: PRICE }));
    await h.app
      .get(PaymentSettlementService, { strict: false })
      .verifyAndSettle(paymentId, { trigger: "webhook" });
    const credits = creditsOf(h);
    const job = new ObjectId().toHexString();
    await credits.hold(owner.orgId, {
      units: 20,
      key: `job:${job}:hold`,
      referenceType: "discovery_job",
      referenceId: job,
      actorUserId: null,
      description: "Hold",
    });
    expect((await customerOf(h, owner.orgId)).creditBalance).toBe(10);
    // The job failed on our side before producing anything: nothing is captured.
    const settled = await credits.settle(owner.orgId, {
      holdKey: `job:${job}:hold`,
      captureKey: `job:${job}:capture`,
      releaseKey: `job:${job}:release`,
      capturedUnits: 0,
      description: "Job failed",
    });
    expect(settled).toEqual({ found: true, held: 20, captured: 0, released: 20 });
    // Settling again (a retried failure handler) changes nothing.
    expect(
      await credits.settle(owner.orgId, {
        holdKey: `job:${job}:hold`,
        captureKey: `job:${job}:capture`,
        releaseKey: `job:${job}:release`,
        capturedUnits: 5,
        description: "Retry",
      }),
    ).toEqual({ found: true, held: 20, captured: 0, released: 20 });
    expect((await customerOf(h, owner.orgId)).creditBalance).toBe(30);
    const rows = await ledgerRows(h, owner.orgId);
    expect(rows.map((r) => r.entryType)).toEqual(["purchase", "hold", "capture", "release"]);
    await expectInvariant(h, owner.orgId);
  });

  it("numbers invoices sequentially without gaps across organizations", async () => {
    const numbers: string[] = [];
    for (const email of ["inv-a@example.test", "inv-b@example.test"]) {
      const owner = await createOwner(h, email, email);
      for (let i = 0; i < 2; i++) {
        const { reference, paymentId } = await packCheckout(owner, 5);
        fake.transactions.set(reference, transactionData({ reference, amount: PRICE }));
        await h.app
          .get(PaymentSettlementService, { strict: false })
          .verifyAndSettle(paymentId, { trigger: "webhook" });
      }
    }
    const invoices = await h.prisma.invoice.findMany({ orderBy: { number: "asc" } });
    numbers.push(...invoices.map((i) => i.number));
    const seq = numbers.map((n) => Number(n.split("-")[2]));
    expect(seq).toEqual([1, 2, 3, 4]);
    expect(new Set(numbers).size).toBe(4);
  });
});
