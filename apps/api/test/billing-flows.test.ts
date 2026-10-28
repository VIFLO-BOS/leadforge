import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { CHECKOUT_RESUME_WINDOW_MINUTES, CSRF_HEADER } from "@leadforge/contracts";
import {
  ENTITLEMENT_KEYS,
  EntitlementsService,
  InvoiceService,
  PaymentSettlementService,
} from "@leadforge/core";
import { API, createHarness, csrfFrom, orgHeaders, addMember, type Harness } from "./harness.js";
import { createOwner, seedBusinesses, type OrgUser } from "./fixtures.js";
import { DISCOVERY_TEST_ENV, createJob, spec } from "./discovery-helpers.js";
import { forgetOverture, seedOverture } from "./overture-helpers.js";
import { download, expiredAccessToken, navigate } from "./phase5-helpers.js";
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

const PACK_PRICE = 250_000;
const PLAN_PRICE = 500_000;

describe("Billing flows (Phase 6)", () => {
  let fake: FakePaystack;
  let h: Harness;

  beforeAll(async () => {
    fake = await startFakePaystack();
    h = await createHarness({ ...DISCOVERY_TEST_ENV, ...billingEnv(fake) });
  });
  afterAll(async () => {
    await h?.close();
    await fake?.close();
  });
  beforeEach(async () => {
    await h.resetState();
    forgetOverture(h);
    fake.transactions.clear();
    fake.subscriptions.clear();
    fake.requests.length = 0;
  });

  const settle = (paymentId: string) =>
    h.app
      .get(PaymentSettlementService, { strict: false })
      .verifyAndSettle(paymentId, { trigger: "webhook" });

  async function runWorker(): Promise<void> {
    const w = startBillingWorker(h);
    try {
      await w.drain();
      expect(w.failures).toEqual([]);
    } finally {
      await w.close();
    }
  }

  async function buyPack(
    owner: OrgUser,
    credits = 500,
  ): Promise<{ reference: string; paymentId: string }> {
    const pack = await createPack(h, { credits, priceMinor: PACK_PRICE });
    const res = await call(
      owner,
      "post",
      "/billing/checkout/credits",
      { packId: pack.id },
      randomUUID(),
    ).expect(201);
    const { reference, paymentId } = res.body.data;
    fake.transactions.set(reference, transactionData({ reference, amount: PACK_PRICE }));
    expect(await settle(paymentId)).toBe("granted");
    return { reference, paymentId };
  }

  it("credit pack checkout: server-side price, idempotent per key, nothing granted until verified, then one grant and an invoice", async () => {
    const owner = await createOwner(h, "flow-owner@example.test", "Flow Org");
    const pack = await createPack(h, { credits: 500, priceMinor: PACK_PRICE });
    const other = await createPack(h, { credits: 100, priceMinor: 90_000 });
    const key = randomUUID();

    await call(owner, "post", "/billing/checkout/credits", { packId: pack.id }).expect(400); // no Idempotency-Key
    const first = await call(
      owner,
      "post",
      "/billing/checkout/credits",
      { packId: pack.id, priceMinor: 1 } as object,
      key,
    ).expect(400); // unknown field
    expect(first.body.error.code).toBe("VALIDATION_FAILED");
    const created = await call(
      owner,
      "post",
      "/billing/checkout/credits",
      { packId: pack.id },
      key,
    ).expect(201);
    const session = created.body.data;
    expect(session.authorizationUrl).toMatch(/^https:\/\/checkout\.paystack\.com\//);
    expect(session.reference).toMatch(/^lf-/);
    expect(session.amountMinor).toBe(PACK_PRICE);
    const replay = await call(
      owner,
      "post",
      "/billing/checkout/credits",
      { packId: pack.id },
      key,
    ).expect(200);
    expect(replay.body.data).toEqual(session);
    const reused = await call(
      owner,
      "post",
      "/billing/checkout/credits",
      { packId: other.id },
      key,
    ).expect(409);
    expect(reused.body.error.code).toBe("CONFLICT");

    // The amount sent to Paystack is the database price; a provider customer was created lazily.
    const init = fake.requests.filter((r) => r.path === "/transaction/initialize");
    expect(init).toHaveLength(1);
    expect(init[0]!.body).toMatchObject({
      amount: String(PACK_PRICE),
      currency: "NGN",
      reference: session.reference,
      callback_url: "http://localhost:3000/app/billing/return",
    });
    expect((await customerOf(h, owner.orgId)).providerCustomerCode).toMatch(/^CUS_/);

    // The browser comes back: the return page asks for verification; the request grants nothing.
    fake.transactions.set(
      session.reference,
      transactionData({ reference: session.reference, amount: PACK_PRICE }),
    );
    const verify = await call(
      owner,
      "post",
      `/billing/payments/${session.reference}/verify`,
    ).expect(202);
    expect(verify.body.data.queued).toBe(true);
    expect(verify.body.data.payment.status).toBe("pending");
    expect((await customerOf(h, owner.orgId)).creditBalance).toBe(0);
    await runWorker();

    const payment = await call(owner, "get", `/billing/payments/${session.reference}`).expect(200);
    expect(payment.body.data).toMatchObject({
      status: "success",
      creditsGranted: 500,
      amountMinor: PACK_PRICE,
      currency: "NGN",
      refundableMinor: PACK_PRICE,
      underReview: false,
    });
    expect(payment.body.data.card).toMatchObject({ last4: "4081", brand: "visa" });
    const balance = await call(owner, "get", "/credits/balance").expect(200);
    expect(balance.body.data.balance).toBe(500);
    const again = await call(owner, "post", `/billing/payments/${session.reference}/verify`).expect(
      202,
    );
    expect(again.body.data.queued).toBe(false);
    await expectInvariant(h, owner.orgId);

    const list = await call(owner, "get", "/billing/payments").expect(200);
    expect(list.body.data).toHaveLength(1);
    const ledger = await call(owner, "get", "/credits/ledger").expect(200);
    expect(ledger.body.data[0]).toMatchObject({
      entryType: "purchase",
      units: 500,
      referenceType: "payment",
    });

    // Invoice: sequential number, PDF through a signed link.
    const invoices = await call(owner, "get", "/billing/invoices").expect(200);
    expect(invoices.body.data).toHaveLength(1);
    const inv = invoices.body.data[0];
    expect(inv.number.startsWith(`LF-${new Date().getUTCFullYear()}-`)).toBe(true);
    expect(inv.number).toMatch(/^LF-\d{4}-\d{6}$/);
    expect(inv).toMatchObject({
      status: "paid",
      totalMinor: PACK_PRICE,
      taxMinor: 0,
      currency: "NGN",
      paymentReference: session.reference,
    });
    const link = await call(owner, "get", `/billing/invoices/${inv.id}/download-url`).expect(200);
    const file = await download(owner.agent, link.body.data.url);
    expect(file.status).toBe(200);
    expect(file.headers["content-type"]).toMatch(/application\/pdf/);
    expect(file.body.subarray(0, 5).toString("latin1")).toBe("%PDF-");
    expect(file.body.length).toBeGreaterThan(1000);
    expect((await h.prisma.invoice.findUniqueOrThrow({ where: { id: inv.id } })).pdfKey).toMatch(
      /^invoices\//,
    );

    // Tampered and other-user links are refused.
    const tampered = link.body.data.url.replace(
      /sig=([^&]+)/,
      (_m: string, s: string) => `sig=${s.slice(0, -2)}AA`,
    );
    const bad = await download(owner.agent, tampered);
    expect(bad.status).toBe(403);
    expect(bad.json?.error?.code).toBe("DOWNLOAD_LINK_INVALID");
    const admin = await addMember(h, owner.orgId, "admin");
    const stolen = await download(admin.agent, link.body.data.url);
    expect(stolen.status).toBe(403);
  });

  it("sends a browser that opens a failed invoice link back to the Billing page (303), and keeps the JSON error for scripts (Stage 8)", async () => {
    const owner = await createOwner(h, "nav-invoice@example.test", "Nav Invoice Org");
    await buyPack(owner);
    const inv = (await call(owner, "get", "/billing/invoices").expect(200)).body.data[0] as {
      id: string;
    };
    const link = (await call(owner, "get", `/billing/invoices/${inv.id}/download-url`).expect(200))
      .body.data as { url: string };
    // A fixed page of APP_URL (http://localhost:3000 in tests) and a fixed code; nothing from the request.
    const billingPage = (code: string) => `http://localhost:3000/app/billing?downloadError=${code}`;

    const ok = await navigate(owner.agent, link.url);
    expect(ok.status).toBe(200);
    expect(ok.body.subarray(0, 5).toString("latin1")).toBe("%PDF-");

    const tampered = link.url.replace(
      /sig=([^&]+)/,
      (_m: string, s: string) => `sig=${s.slice(0, -2)}AA`,
    );
    for (const how of ["fetch-metadata", "accept-html"] as const) {
      const res = await navigate(owner.agent, tampered, how);
      expect(res.status, how).toBe(303);
      expect(res.headers.location, how).toBe(billingPage("DOWNLOAD_LINK_INVALID"));
      expect(res.headers["cache-control"], how).toBe("no-store");
    }
    // Not a navigation: the JSON envelope as before.
    const scripted = await download(owner.agent, tampered);
    expect(scripted.status).toBe(403);
    expect(scripted.json?.error?.code).toBe("DOWNLOAD_LINK_INVALID");
    const spoofed = await navigate(owner.agent, tampered, "fetch-metadata", {
      Host: "evil.example",
      "X-Forwarded-Host": "evil.example",
    });
    expect(spoofed.headers.location).toBe(billingPage("DOWNLOAD_LINK_INVALID"));

    const customer = await customerOf(h, owner.orgId);
    const stale = await h.app
      .get(InvoiceService, { strict: false })
      .downloadLink(
        owner.orgId,
        customer.id,
        owner.userId,
        inv.id,
        new Date(Date.now() - 60 * 60 * 1000),
      );
    const expired = await navigate(owner.agent, stale.url);
    expect(expired.status).toBe(303);
    expect(expired.headers.location).toBe(billingPage("DOWNLOAD_LINK_EXPIRED"));
    expect((await download(owner.agent, stale.url)).json?.error?.code).toBe(
      "DOWNLOAD_LINK_EXPIRED",
    );

    // A damaged link (no signature, or a mangled invoice id) is an invalid link; the Billing page needs no id.
    expect(
      (await navigate(owner.agent, link.url.replace(/&?sig=[^&]+/, ""))).headers.location,
    ).toBe(billingPage("DOWNLOAD_LINK_INVALID"));
    expect(
      (
        await navigate(
          owner.agent,
          link.url.replace(`/invoices/${inv.id}/`, "/invoices/not-an-invoice/"),
        )
      ).headers.location,
    ).toBe(billingPage("DOWNLOAD_LINK_INVALID"));

    // Signed out (Stage 9): a navigation goes to sign in and comes back to the Billing page; the
    // Location is APP_URL and a fixed path whatever the request says. Scripts keep the JSON 401.
    const signIn = "http://localhost:3000/sign-in?next=/app/billing";
    for (const how of ["fetch-metadata", "accept-html"] as const) {
      const anonymous = await navigate(h.agent(), link.url, how);
      expect(anonymous.status, how).toBe(303);
      expect(anonymous.headers.location, how).toBe(signIn);
      expect(anonymous.headers["cache-control"], how).toBe("no-store");
    }
    const bearer = { Authorization: `Bearer ${await expiredAccessToken(h, owner.userId)}` };
    expect((await navigate(h.agent(), link.url, "fetch-metadata", bearer)).headers.location).toBe(
      signIn,
    );
    const spoofHeaders = {
      Host: "evil.example",
      "X-Forwarded-Host": "evil.example",
      "X-Forwarded-Proto": "https",
      "X-Forwarded-Prefix": "//evil.example",
      Referer: "https://evil.example/app/billing",
      Origin: "https://evil.example",
    };
    for (const how of ["fetch-metadata", "accept-html"] as const) {
      const spoofed = await navigate(
        h.agent(),
        `${link.url}&next=https://evil.example/`,
        how,
        spoofHeaders,
      );
      expect(spoofed.status, how).toBe(303);
      expect(spoofed.headers.location, how).toBe(signIn);
    }
    // A mangled invoice id is still the Billing page (it needs no id).
    expect(
      (
        await navigate(
          h.agent(),
          link.url.replace(`/invoices/${inv.id}/`, "/invoices/%2F%2Fevil.example/"),
        )
      ).headers.location,
    ).toBe(signIn);
    const signedOutScript = await download(h.agent(), link.url);
    expect(signedOutScript.status).toBe(401);
    expect(signedOutScript.json?.error?.code).toBe("UNAUTHENTICATED");
    for (const headers of [
      { Accept: "application/json" },
      { Accept: "*/*", "Sec-Fetch-Mode": "cors" },
      { Accept: "application/json", ...bearer },
    ]) {
      const res = await h
        .agent()
        .get(`${new URL(link.url).pathname}${new URL(link.url).search}`)
        .set(headers)
        .redirects(0);
      expect(res.status, JSON.stringify(headers)).toBe(401);
      expect(res.body.error.code, JSON.stringify(headers)).toBe(
        "Authorization" in headers ? "TOKEN_EXPIRED" : "UNAUTHENTICATED",
      );
    }

    // Other failures stay JSON for navigations too: no longer a billing manager.
    const admin = await addMember(h, owner.orgId, "admin");
    const adminLink = (
      await call(
        { agent: admin.agent, orgId: owner.orgId, userId: admin.userId },
        "get",
        `/billing/invoices/${inv.id}/download-url`,
      ).expect(200)
    ).body.data as { url: string };
    await h.prisma.membership.update({
      where: { organizationId_userId: { organizationId: owner.orgId, userId: admin.userId } },
      data: { role: "researcher" },
    });
    const demoted = await navigate(admin.agent, adminLink.url);
    expect(demoted.status).toBe(403);
    expect(demoted.json?.error?.code).toBe("FORBIDDEN");
  });

  it("refuses placeholder or unpriced items on a live-style catalogue, and reports provider failures without charging", async () => {
    const owner = await createOwner(h, "price-owner@example.test", "Price Org");
    const unpriced = await createPack(h, { credits: 500, priceMinor: 0, isPlaceholder: true });
    const res = await call(
      owner,
      "post",
      "/billing/checkout/credits",
      { packId: unpriced.id },
      randomUUID(),
    ).expect(422);
    expect(res.body.error.code).toBe("PRICE_NOT_PUBLISHED");
    const plans = await call(owner, "get", "/billing/plans").expect(200);
    expect(plans.body.data.creditPacks[0]).toMatchObject({
      purchasable: false,
      blocker: "price_not_published",
    });
    expect(plans.body.data.pricingPublished).toBe(false);
    expect(plans.body.data.provider).toEqual({
      provider: "paystack",
      configured: true,
      mode: "test",
    });

    const pack = await createPack(h, { credits: 100, priceMinor: 100_000 });
    fake.failNext("/transaction/initialize");
    const failed = await call(
      owner,
      "post",
      "/billing/checkout/credits",
      { packId: pack.id },
      randomUUID(),
    ).expect(502);
    expect(failed.body.error.code).toBe("PAYMENT_PROVIDER_ERROR");
    expect(failed.body.error.message).not.toMatch(/sk_test/);
    const payments = await h.prisma.payment.findMany();
    expect(payments).toHaveLength(1);
    expect(payments[0]!.status).toBe("failed");
    expect((await customerOf(h, owner.orgId)).creditBalance).toBe(0);
  });

  it("subscription lifecycle: incomplete, active with plan entitlements and credits, linked, past_due on a failed renewal, renewed, cancel and resume", async () => {
    const owner = await createOwner(h, "sub-owner@example.test", "Sub Org");
    const plan = await createPlan(h, {
      name: "Team",
      priceMinor: PLAN_PRICE,
      includedCredits: 100,
      maxMembers: 3,
      exportRowCap: 2000,
    });

    const res = await call(
      owner,
      "post",
      "/billing/checkout/subscription",
      { planId: plan.id },
      randomUUID(),
    ).expect(201);
    const { reference, paymentId } = res.body.data;
    const planCode = (await h.prisma.plan.findUniqueOrThrow({ where: { id: plan.id } }))
      .providerPlanCode;
    expect(planCode).toMatch(/^PLN_fixture/);
    expect(fake.requests.find((r) => r.path === "/transaction/initialize")!.body).toMatchObject({
      plan: planCode,
      amount: String(PLAN_PRICE),
    });
    let overview = await call(owner, "get", "/billing/overview").expect(200);
    expect(overview.body.data.subscription).toBeNull();
    expect(overview.body.data.pendingSubscription.status).toBe("incomplete");
    expect(overview.body.data.entitlements.basis.kind).toBe("free");

    const customerCode = (await customerOf(h, owner.orgId)).providerCustomerCode!;
    fake.transactions.set(
      reference,
      transactionData({ reference, amount: PLAN_PRICE, planCode, customerCode }),
    );
    await postWebhook(
      h,
      webhookBody(
        "charge.success",
        transactionData({ reference, amount: PLAN_PRICE, planCode, customerCode }),
      ),
    ).expect(200);
    await runWorker();

    overview = await call(owner, "get", "/billing/overview").expect(200);
    const sub = overview.body.data.subscription;
    expect(sub).toMatchObject({
      status: "active",
      cancelAtPeriodEnd: false,
      providerLinked: false,
      plan: { id: plan.id, includedCredits: 100 },
    });
    expect(new Date(sub.renewsAt).getTime()).toBeGreaterThan(Date.now() + 25 * 24 * 3600 * 1000);
    expect(overview.body.data.entitlements).toMatchObject({
      maxMembers: 3,
      exportRowCap: 2000,
      discoveryEnabled: true,
      basis: { kind: "subscription", planCode: plan.code },
    });
    expect(overview.body.data.entitlements.sources.maxMembers).toBe("plan");
    expect(overview.body.data.credits.balance).toBe(100);
    const grant = (await ledgerRows(h, owner.orgId)).find(
      (r) => r.idempotencyKey === `payment:${paymentId}:grant`,
    );
    expect(grant).toMatchObject({ entryType: "grant", units: 100 });

    // Paystack confirms the subscription: linked with its code and email token.
    const nextPayment = new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString();
    await postWebhook(
      h,
      webhookBody("subscription.create", {
        domain: "test",
        status: "active",
        subscription_code: "SUB_fixture1",
        email_token: "tok_fixture1",
        amount: PLAN_PRICE,
        next_payment_date: nextPayment,
        plan: { plan_code: planCode },
        customer: { customer_code: customerCode, email: "sub-owner@example.test" },
      }),
    ).expect(200);
    await runWorker();
    let dbSub = await h.prisma.subscription.findUniqueOrThrow({ where: { id: sub.id } });
    expect(dbSub.providerSubscriptionCode).toBe("SUB_fixture1");
    expect(dbSub.providerEmailToken).toBe("tok_fixture1");

    // A renewal fails: past_due, a banner and a notification.
    await postWebhook(
      h,
      webhookBody("invoice.payment_failed", {
        domain: "test",
        invoice_code: "INV_fixture1",
        status: "failed",
        paid: false,
        amount: PLAN_PRICE,
        subscription: { subscription_code: "SUB_fixture1", status: "attention" },
      }),
    ).expect(200);
    await runWorker();
    overview = await call(owner, "get", "/billing/overview").expect(200);
    expect(overview.body.data.subscription.status).toBe("past_due");
    expect(overview.body.data.banners.map((b: { kind: string }) => b.kind)).toContain("past_due");
    const notes = await call(owner, "get", "/notifications").expect(200);
    expect(notes.body.data.map((n: { type: string }) => n.type)).toContain(
      "billing.payment_failed",
    );

    // Paystack retries and the renewal succeeds (a reference Paystack generated): active again, credits, a second invoice.
    const renewalRef = "T_renewal_fixture1";
    fake.transactions.set(
      renewalRef,
      transactionData({ reference: renewalRef, amount: PLAN_PRICE, planCode, customerCode }),
    );
    await postWebhook(
      h,
      webhookBody(
        "charge.success",
        transactionData({ reference: renewalRef, amount: PLAN_PRICE, planCode, customerCode }),
      ),
    ).expect(200);
    await runWorker();
    overview = await call(owner, "get", "/billing/overview").expect(200);
    expect(overview.body.data.subscription.status).toBe("active");
    expect(overview.body.data.subscription.pastDueAt).toBeNull();
    expect(overview.body.data.credits.balance).toBe(200);
    expect(overview.body.data.banners.map((b: { kind: string }) => b.kind)).not.toContain(
      "past_due",
    );
    expect(await h.prisma.invoice.count()).toBe(2);
    const renewal = await h.prisma.payment.findUniqueOrThrow({
      where: { providerReference: renewalRef },
    });
    expect(renewal).toMatchObject({
      status: "success",
      purpose: "subscription",
      purposeRef: sub.id,
    });

    // Cancel at period end, resume, card page.
    const cancelled = await call(owner, "post", "/billing/subscription/cancel", {
      atPeriodEnd: true,
    }).expect(200);
    expect(cancelled.body.data).toMatchObject({
      status: "active",
      cancelAtPeriodEnd: true,
      renewsAt: null,
    });
    expect(
      fake.requests.some(
        (r) =>
          r.path === "/subscription/disable" &&
          r.body?.code === "SUB_fixture1" &&
          r.body?.token === "tok_fixture1",
      ),
    ).toBe(true);
    const resumed = await call(owner, "post", "/billing/subscription/resume").expect(200);
    expect(resumed.body.data.cancelAtPeriodEnd).toBe(false);
    const manage = await call(owner, "get", "/billing/subscription/manage-link").expect(200);
    expect(manage.body.data.url).toMatch(
      /^https:\/\/paystack\.com\/manage\/subscriptions\/SUB_fixture1/,
    );

    // subscription.not_renew from the Paystack page sets cancel at period end too.
    await postWebhook(
      h,
      webhookBody("subscription.not_renew", {
        status: "non-renewing",
        subscription_code: "SUB_fixture1",
        email_token: "tok_fixture1",
      }),
    ).expect(200);
    await runWorker();
    dbSub = await h.prisma.subscription.findUniqueOrThrow({ where: { id: sub.id } });
    expect(dbSub.cancelAtPeriodEnd).toBe(true);
    await expectInvariant(h, owner.orgId);
  });

  it("offers an abandoned subscription checkout's stored authorization URL for 30 minutes while its payment is pending, never once it is final (Stage 9)", async () => {
    const owner = await createOwner(h, "resume-owner@example.test", "Resume Org");
    const plan = await createPlan(h, { name: "Resume", priceMinor: PLAN_PRICE });
    const session = (
      await call(
        owner,
        "post",
        "/billing/checkout/subscription",
        { planId: plan.id },
        randomUUID(),
      ).expect(201)
    ).body.data as { paymentId: string; reference: string; authorizationUrl: string };
    // The URL is the one Paystack returned at initialize (fixture), stored on the payment row.
    expect(session.authorizationUrl).toMatch(/^https:\/\/checkout\.paystack\.com\//);
    const payment = await h.prisma.payment.findUniqueOrThrow({ where: { id: session.paymentId } });
    expect(payment.authorizationUrl).toBe(session.authorizationUrl);
    const pending = async () =>
      (await call(owner, "get", "/billing/overview").expect(200)).body.data
        .pendingSubscription as Record<string, unknown> | null;
    const setPayment = (data: Parameters<typeof h.prisma.payment.update>[0]["data"]) =>
      h.prisma.payment.update({ where: { id: session.paymentId }, data });

    let view = await pending();
    expect(view).toMatchObject({
      status: "incomplete",
      plan: { id: plan.id },
      authorizationUrl: session.authorizationUrl,
    });
    expect(view!.authorizationUrlExpiresAt).toBe(
      new Date(
        payment.initiatedAt.getTime() + CHECKOUT_RESUME_WINDOW_MINUTES * 60_000,
      ).toISOString(),
    );

    // Paystack reports an opened-but-unpaid checkout as "abandoned"; locally it stays pending inside the abandon window, so it is still offered.
    fake.transactions.set(
      session.reference,
      transactionData({ reference: session.reference, amount: PLAN_PRICE, status: "abandoned" }),
    );
    expect(await settle(session.paymentId)).toBe("pending");
    expect((await pending())!.authorizationUrl).toBe(session.authorizationUrl);

    // Under review: not offered.
    await setPayment({ flaggedAt: new Date(), flagReason: "amount_mismatch: fixture" });
    view = await pending();
    expect(view!.status).toBe("incomplete");
    expect(view).not.toHaveProperty("authorizationUrl");
    expect(view).not.toHaveProperty("authorizationUrlExpiresAt");
    await setPayment({ flaggedAt: null, flagReason: null });

    // Past the window: the subscription is still pending, but the URL is no longer offered.
    await setPayment({
      initiatedAt: new Date(Date.now() - (CHECKOUT_RESUME_WINDOW_MINUTES + 1) * 60_000),
    });
    view = await pending();
    expect(view!.status).toBe("incomplete");
    expect(view).not.toHaveProperty("authorizationUrl");
    await setPayment({
      initiatedAt: new Date(Date.now() - (CHECKOUT_RESUME_WINDOW_MINUTES - 1) * 60_000),
    });
    expect((await pending())!.authorizationUrl).toBe(session.authorizationUrl);

    // A final payment is never offered, even while the subscription row still reads incomplete.
    for (const status of ["failed", "abandoned", "success", "reversed"] as const) {
      await setPayment({ status });
      expect(await pending(), status).not.toHaveProperty("authorizationUrl");
    }
    await setPayment({ status: "pending" });
    expect((await pending())!.authorizationUrl).toBe(session.authorizationUrl);

    // Declined at Paystack: the payment fails, the subscription expires, nothing is pending any more.
    fake.transactions.set(
      session.reference,
      transactionData({ reference: session.reference, amount: PLAN_PRICE, status: "failed" }),
    );
    expect(await settle(session.paymentId)).toBe("failed");
    expect(await pending()).toBeNull();

    // Paid: the plan is live and nothing is pending.
    const again = (
      await call(
        owner,
        "post",
        "/billing/checkout/subscription",
        { planId: plan.id },
        randomUUID(),
      ).expect(201)
    ).body.data as { paymentId: string; reference: string; authorizationUrl: string };
    expect((await pending())!.authorizationUrl).toBe(again.authorizationUrl);
    const planCode = (await h.prisma.plan.findUniqueOrThrow({ where: { id: plan.id } }))
      .providerPlanCode;
    const customerCode = (await customerOf(h, owner.orgId)).providerCustomerCode;
    fake.transactions.set(
      again.reference,
      transactionData({ reference: again.reference, amount: PLAN_PRICE, planCode, customerCode }),
    );
    expect(await settle(again.paymentId)).toBe("granted");
    const overview = (await call(owner, "get", "/billing/overview").expect(200)).body.data;
    expect(overview.pendingSubscription).toBeNull();
    expect(overview.subscription).toMatchObject({ status: "active", plan: { id: plan.id } });
    expect(overview.subscription).not.toHaveProperty("authorizationUrl");
    await expectInvariant(h, owner.orgId);
  });

  it("recalculates entitlements on a plan change and disables the old plan at Paystack", async () => {
    const owner = await createOwner(h, "change-owner@example.test", "Change Org");
    const small = await createPlan(h, {
      name: "Small",
      priceMinor: PLAN_PRICE,
      maxMembers: 2,
      exportRowCap: 1000,
      includedCredits: 10,
    });
    const big = await createPlan(h, {
      name: "Big",
      priceMinor: PLAN_PRICE * 2,
      maxMembers: 12,
      exportRowCap: 40_000,
      includedCredits: 50,
      discoveryEnabled: true,
    });
    const entitlements = h.app.get(EntitlementsService, { strict: false });

    const a = await call(
      owner,
      "post",
      "/billing/checkout/subscription",
      { planId: small.id },
      randomUUID(),
    ).expect(201);
    fake.transactions.set(
      a.body.data.reference,
      transactionData({ reference: a.body.data.reference, amount: PLAN_PRICE }),
    );
    expect(await settle(a.body.data.paymentId)).toBe("granted");
    expect(await entitlements.maxMembers(owner.orgId)).toBe(2);
    expect(await entitlements.exportRowCap(owner.orgId)).toBe(1000);
    const smallSub = await h.prisma.subscription.findFirstOrThrow({ where: { planId: small.id } });
    await h.prisma.subscription.update({
      where: { id: smallSub.id },
      data: { providerSubscriptionCode: "SUB_small", providerEmailToken: "tok_small" },
    });

    // Already on this plan.
    const same = await call(
      owner,
      "post",
      "/billing/checkout/subscription",
      { planId: small.id },
      randomUUID(),
    ).expect(409);
    expect(same.body.error.code).toBe("CONFLICT");

    const b = await call(
      owner,
      "post",
      "/billing/checkout/subscription",
      { planId: big.id },
      randomUUID(),
    ).expect(201);
    fake.transactions.set(
      b.body.data.reference,
      transactionData({ reference: b.body.data.reference, amount: PLAN_PRICE * 2 }),
    );
    expect(await settle(b.body.data.paymentId)).toBe("granted");

    expect(await entitlements.maxMembers(owner.orgId)).toBe(12);
    expect(await entitlements.exportRowCap(owner.orgId)).toBe(40_000);
    expect(
      (await h.prisma.subscription.findUniqueOrThrow({ where: { id: smallSub.id } })).status,
    ).toBe("cancelled");
    expect(
      fake.requests.some((r) => r.path === "/subscription/disable" && r.body?.code === "SUB_small"),
    ).toBe(true);
    const rows = await h.prisma.entitlement.findMany({
      where: { billingCustomer: { organizationId: owner.orgId }, source: "plan" },
    });
    expect(Object.fromEntries(rows.map((r) => [r.key, r.valueInt ?? r.valueBool]))).toEqual({
      max_members: 12,
      export_row_cap: 40_000,
      discovery_enabled: true,
      website_analysis_enabled: true,
      monthly_included_credits: 50,
    });
  });

  it("enforces the member cap on invitations, acceptance and reactivation (MEMBER_LIMIT_REACHED)", async () => {
    const owner = await createOwner(h, "cap-owner@example.test", "Cap Org");
    const entitlements = h.app.get(EntitlementsService, { strict: false });
    await entitlements.setOverride(owner.orgId, { key: ENTITLEMENT_KEYS.maxMembers, valueInt: 2 });

    await owner.agent
      .post(`${API}/organizations/current/invitations`)
      .set(orgHeaders(owner.agent, owner.orgId))
      .send({ email: "cap-one@example.test", role: "researcher" })
      .expect(201);
    const over = await owner.agent
      .post(`${API}/organizations/current/invitations`)
      .set(orgHeaders(owner.agent, owner.orgId))
      .send({ email: "cap-two@example.test", role: "analyst" })
      .expect(402);
    expect(over.body.error.code).toBe("MEMBER_LIMIT_REACHED");
    expect(over.body.error.details).toEqual([
      { path: "members.cap", message: "2" },
      { path: "members.used", message: "2" },
    ]);
    // Re-inviting the same address replaces the pending invitation instead of taking a seat.
    await owner.agent
      .post(`${API}/organizations/current/invitations`)
      .set(orgHeaders(owner.agent, owner.orgId))
      .send({ email: "cap-one@example.test", role: "analyst" })
      .expect(201);

    // The plan shrinks before the invitation is accepted: acceptance is refused.
    await entitlements.setOverride(owner.orgId, { key: ENTITLEMENT_KEYS.maxMembers, valueInt: 1 });
    const token = await h.tokenFromMail("cap-one@example.test", "/invite/");
    const invitee = await createOwner(h, "cap-one@example.test", "Invitee Org");
    const accept = await invitee.agent
      .post(`${API}/invitations/${encodeURIComponent(token)}/accept`)
      .set(CSRF_HEADER, csrfFrom(invitee.agent))
      .expect(402);
    expect(accept.body.error.code).toBe("MEMBER_LIMIT_REACHED");

    // Reactivating a suspended member counts too.
    await entitlements.setOverride(owner.orgId, { key: ENTITLEMENT_KEYS.maxMembers, valueInt: 2 });
    const member = await addMember(h, owner.orgId, "researcher");
    await owner.agent
      .patch(`${API}/organizations/current/members/${member.userId}`)
      .set(orgHeaders(owner.agent, owner.orgId))
      .send({ status: "suspended" })
      .expect(200);
    await addMember(h, owner.orgId, "analyst");
    const reactivate = await owner.agent
      .patch(`${API}/organizations/current/members/${member.userId}`)
      .set(orgHeaders(owner.agent, owner.orgId))
      .send({ status: "active" })
      .expect(402);
    expect(reactivate.body.error.code).toBe("MEMBER_LIMIT_REACHED");

    const overview = await call(owner, "get", "/billing/overview").expect(200);
    expect(overview.body.data.members).toMatchObject({ cap: 2, active: 2 });
    expect(overview.body.data.entitlements.sources.maxMembers).toBe("override");
  });

  it("a refund reversal drives the balance negative and blocks discovery and analyses (CREDIT_BALANCE_NEGATIVE)", async () => {
    await seedOverture(h);
    const owner = await createOwner(h, "refund-owner@example.test", "Refund Org");
    const admin = await addMember(h, owner.orgId, "admin");
    const analyst = await addMember(h, owner.orgId, "analyst");
    const { reference, paymentId } = await buyPack(owner, 500);

    // 400 of the 500 credits are used.
    const credits = creditsOf(h);
    await credits.hold(owner.orgId, {
      units: 400,
      key: "test:use:hold",
      referenceType: "test",
      referenceId: "use",
      actorUserId: null,
      description: "Usage",
    });
    await credits.settle(owner.orgId, {
      holdKey: "test:use:hold",
      captureKey: "test:use:capture",
      releaseKey: "test:use:release",
      capturedUnits: 400,
      description: "Usage",
    });

    // Refunds are owner-only.
    const adminRefund = await admin.agent
      .post(`${API}/billing/payments/${paymentId}/refund`)
      .set(orgHeaders(admin.agent, owner.orgId))
      .send({ reason: "Customer asked" })
      .expect(403);
    expect(adminRefund.body.error.code).toBe("FORBIDDEN");
    const tooMuch = await call(owner, "post", `/billing/payments/${paymentId}/refund`, {
      reason: "Customer asked",
      amountMinor: PACK_PRICE + 1,
    }).expect(400);
    expect(tooMuch.body.error.details[0].path).toBe("amountMinor");
    const requested = await call(owner, "post", `/billing/payments/${paymentId}/refund`, {
      reason: "Customer asked",
    }).expect(202);
    expect(requested.body.data.refunds).toHaveLength(1);
    expect(requested.body.data.refunds[0]).toMatchObject({
      status: "pending",
      amountMinor: PACK_PRICE,
    });
    expect(requested.body.data.refundableMinor).toBe(0);
    expect(fake.requests.find((r) => r.path === "/refund")!.body).toMatchObject({
      transaction: reference,
      amount: String(PACK_PRICE),
    });
    // Nothing is taken back until Paystack confirms.
    expect((await customerOf(h, owner.orgId)).creditBalance).toBe(100);

    const refund = await h.prisma.refund.findFirstOrThrow({ where: { paymentId } });
    await postWebhook(
      h,
      webhookBody("refund.processed", {
        id: Number(refund.providerRefundReference),
        status: "processed",
        transaction_reference: reference,
        refund_reference: null,
        amount: PACK_PRICE,
        currency: "NGN",
        domain: "test",
      }),
    ).expect(200);
    await runWorker();

    const after = await customerOf(h, owner.orgId);
    expect(after.creditBalance).toBe(-400);
    const reversal = (await ledgerRows(h, owner.orgId)).find(
      (r) => r.entryType === "refund_reversal",
    );
    expect(reversal).toMatchObject({ units: -500, idempotencyKey: `refund:${refund.id}:reversal` });
    const pay = await call(owner, "get", `/billing/payments/${paymentId}`).expect(200);
    expect(pay.body.data).toMatchObject({ status: "reversed", refundedMinor: PACK_PRICE });
    expect(pay.body.data.refunds[0]).toMatchObject({ status: "processed", reversalUnits: 500 });
    await expectInvariant(h, owner.orgId);

    // Banners: everyone sees the negative balance; only billing managers get the link.
    const ownerBanners = await call(owner, "get", "/billing/banners").expect(200);
    expect(
      ownerBanners.body.data.banners.find((b: { kind: string }) => b.kind === "negative_balance")
        .href,
    ).toBe("/app/billing");
    const analystBanners = await analyst.agent
      .get(`${API}/billing/banners`)
      .set(orgHeaders(analyst.agent, owner.orgId))
      .expect(200);
    expect(analystBanners.body.data.banners).toEqual([
      expect.objectContaining({ kind: "negative_balance", href: null }),
    ]);

    // New discovery and analyses are blocked.
    const job = await createJob(owner.agent, owner.orgId, spec()).expect(402);
    expect(job.body.error.code).toBe("CREDIT_BALANCE_NEGATIVE");
    expect(job.body.error.details).toEqual([{ path: "credits.balance", message: "-400" }]);
    const estimate = await owner.agent
      .post(`${API}/discovery/jobs/estimate`)
      .set(orgHeaders(owner.agent, owner.orgId))
      .send(spec())
      .expect(200);
    expect(estimate.body.data.blockers.map((b: { code: string }) => b.code)).toContain(
      "CREDIT_BALANCE_NEGATIVE",
    );
    const [businessId] = await seedBusinesses(h, owner.orgId, [
      { name: "Refund Site (Sample)", website: "https://refund-site.example.test" },
    ]);
    const analysis = await call(owner, "post", "/analysis/websites", { businessId }).expect(402);
    expect(analysis.body.error.code).toBe("CREDIT_BALANCE_NEGATIVE");

    const notes = await call(owner, "get", "/notifications").expect(200);
    expect(notes.body.data.map((n: { type: string }) => n.type)).toContain(
      "billing.refund_updated",
    );

    // Topping up past zero unblocks.
    await buyPack(owner, 500);
    expect((await customerOf(h, owner.orgId)).creditBalance).toBe(100);
    await createJob(owner.agent, owner.orgId, spec({ maxRecords: 5 })).expect(201);
  });

  it("records a failed refund without taking credits back, and a partial refund takes back credits in proportion", async () => {
    const owner = await createOwner(h, "partial-owner@example.test", "Partial Org");
    const { reference, paymentId } = await buyPack(owner, 500);
    await call(owner, "post", `/billing/payments/${paymentId}/refund`, {
      reason: "Half back",
      amountMinor: PACK_PRICE / 5,
    }).expect(202);
    let refund = await h.prisma.refund.findFirstOrThrow({ where: { paymentId } });
    await postWebhook(
      h,
      webhookBody("refund.failed", {
        id: Number(refund.providerRefundReference),
        status: "failed",
        transaction_reference: reference,
        amount: PACK_PRICE / 5,
        currency: "NGN",
      }),
    ).expect(200);
    await runWorker();
    refund = await h.prisma.refund.findUniqueOrThrow({ where: { id: refund.id } });
    expect(refund.status).toBe("failed");
    expect((await customerOf(h, owner.orgId)).creditBalance).toBe(500);

    await call(owner, "post", `/billing/payments/${paymentId}/refund`, {
      reason: "A fifth back",
      amountMinor: PACK_PRICE / 5,
    }).expect(202);
    const second = await h.prisma.refund.findFirstOrThrow({
      where: { paymentId, status: "pending" },
    });
    await postWebhook(
      h,
      webhookBody("refund.processed", {
        id: Number(second.providerRefundReference),
        status: "processed",
        transaction_reference: reference,
        amount: PACK_PRICE / 5,
        currency: "NGN",
      }),
    ).expect(200);
    await runWorker();
    expect((await customerOf(h, owner.orgId)).creditBalance).toBe(400);
    const pay = await h.prisma.payment.findUniqueOrThrow({ where: { id: paymentId } });
    expect(pay.status).toBe("success");
    expect(pay.refundedMinor).toBe(BigInt(PACK_PRICE / 5));
    await expectInvariant(h, owner.orgId);
  });

  it("records disputes and alerts the billing managers", async () => {
    const owner = await createOwner(h, "dispute-owner@example.test", "Dispute Org");
    const { reference, paymentId } = await buyPack(owner, 500);
    const dispute = {
      id: 9001,
      refund_amount: PACK_PRICE,
      currency: "NGN",
      status: "awaiting-merchant-feedback",
      resolution: null,
      domain: "test",
      category: "chargeback",
      dueAt: new Date(Date.now() + 3 * 864e5).toISOString(),
      transaction: { id: 1, reference, amount: PACK_PRICE, currency: "NGN" },
    };
    await postWebhook(h, webhookBody("charge.dispute.create", dispute)).expect(200);
    await runWorker();
    const row = await h.prisma.paymentDispute.findUniqueOrThrow({
      where: { providerDisputeId: "9001" },
    });
    expect(row).toMatchObject({ status: "awaiting_merchant", paymentId });
    let view = await call(owner, "get", `/billing/payments/${paymentId}`).expect(200);
    expect(view.body.data.underReview).toBe(true);
    const notes = await call(owner, "get", "/notifications").expect(200);
    expect(notes.body.data.map((n: { type: string }) => n.type)).toContain("billing.attention");

    await postWebhook(
      h,
      webhookBody("charge.dispute.resolve", {
        ...dispute,
        status: "resolved",
        resolution: "merchant-accepted",
      }),
    ).expect(200);
    await runWorker();
    expect(
      (await h.prisma.paymentDispute.findUniqueOrThrow({ where: { providerDisputeId: "9001" } }))
        .status,
    ).toBe("resolved");
    view = await call(owner, "get", `/billing/payments/${paymentId}`).expect(200);
    expect(view.body.data.underReview).toBe(false);
  });

  it("blocks discovery when the plan does not include it (ENTITLEMENT_REQUIRED)", async () => {
    await seedOverture(h);
    const owner = await createOwner(h, "noent-owner@example.test", "No Discovery Org");
    await creditsOf(h).grant(owner.orgId, {
      units: 100,
      key: `test-grant:${owner.orgId}`,
      description: "Test grant",
    });
    await h.app
      .get(EntitlementsService, { strict: false })
      .setOverride(owner.orgId, { key: ENTITLEMENT_KEYS.discoveryEnabled, valueBool: false });
    const res = await createJob(owner.agent, owner.orgId, spec()).expect(402);
    expect(res.body.error.code).toBe("ENTITLEMENT_REQUIRED");
    expect(res.body.error.details).toEqual([{ path: "entitlement", message: "discovery_enabled" }]);
    const estimate = await owner.agent
      .post(`${API}/discovery/jobs/estimate`)
      .set(orgHeaders(owner.agent, owner.orgId))
      .send(spec())
      .expect(200);
    expect(estimate.body.data.blockers.map((b: { code: string }) => b.code)).toContain(
      "ENTITLEMENT_REQUIRED",
    );
    expect((await customerOf(h, owner.orgId)).creditBalance).toBe(100);
  });
});
