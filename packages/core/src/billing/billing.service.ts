import { Inject, Injectable } from "@nestjs/common";
import { Logger } from "nestjs-pino";
import { newId, Prisma, type CreditPack, type Payment, type Plan } from "@leadforge/db-postgres";
import {
  CHECKOUT_RESUME_WINDOW_MINUTES,
  UuidString,
  type BillingBanner,
  type BillingCatalogue,
  type BillingCreditPack,
  type BillingOverview,
  type BillingPlan,
  type BillingProviderStatus,
  type CheckoutSession,
  type EntitlementsView,
  type InvoiceListQuery,
  type InvoiceView,
  type Permission,
  type PaymentListQuery,
  type PaymentView,
  type PendingSubscriptionView,
  type PurchaseBlocker,
  type RefundRequest,
  type ServerEnv,
  type SubscriptionManageLink,
  type SubscriptionView,
  type VerifyPaymentResponse,
} from "@leadforge/contracts";
import { ENV } from "../config/env.module.js";
import { AppError } from "../common/errors/app.error.js";
import { AuditService, type AuditContext } from "../audit/audit.service.js";
import { CreditsService } from "../credits/credits.service.js";
import {
  EntitlementsService,
  type EntitlementSource,
} from "../entitlements/entitlements.service.js";
import { minorToNumber } from "./money.js";
import {
  PAYMENT_PROVIDER,
  PaymentProviderError,
  type PaymentProvider,
} from "./provider/payment-provider.js";
import {
  BillingRepository,
  type CustomerWithOrg,
  type PaymentWithRefunds,
  type SubscriptionWithPlan,
} from "./repositories/billing.repository.js";
import { InvoiceService, toInvoiceView } from "./invoice.service.js";
import { PaymentSettlementService } from "./payment-settlement.service.js";

const DAY_MS = 24 * 60 * 60 * 1000;
const PAYMENT_FAILED_BANNER_DAYS = 7;

function isUniqueViolation(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002";
}

export function toSubscriptionView(s: SubscriptionWithPlan): SubscriptionView {
  return {
    id: s.id,
    status: s.status,
    plan: {
      id: s.plan.id,
      code: s.plan.code,
      name: s.plan.name,
      interval: s.plan.interval,
      priceMinor: minorToNumber(s.plan.priceMinor),
      currency: s.plan.currency,
      includedCredits: s.plan.includedCredits,
    },
    currentPeriodStart: s.currentPeriodStart?.toISOString() ?? null,
    currentPeriodEnd: s.currentPeriodEnd?.toISOString() ?? null,
    renewsAt:
      s.status === "active" && !s.cancelAtPeriodEnd
        ? (s.currentPeriodEnd?.toISOString() ?? null)
        : null,
    cancelAtPeriodEnd: s.cancelAtPeriodEnd,
    cancelledAt: s.cancelledAt?.toISOString() ?? null,
    pastDueAt: s.pastDueAt?.toISOString() ?? null,
    endedAt: s.endedAt?.toISOString() ?? null,
    providerLinked: Boolean(s.providerSubscriptionCode),
    createdAt: s.createdAt.toISOString(),
  };
}

export function toPaymentView(p: PaymentWithRefunds, creditsGranted: number | null): PaymentView {
  const card = (p.authorizationMasked ?? null) as {
    brand?: string | null;
    last4?: string | null;
    expMonth?: string | null;
    expYear?: string | null;
    bank?: string | null;
  } | null;
  const pendingRefunds = p.refunds
    .filter((r) => r.status === "pending")
    .reduce((s, r) => s + r.amountMinor, 0n);
  const refundable = p.status === "success" ? p.amountMinor - p.refundedMinor - pendingRefunds : 0n;
  return {
    id: p.id,
    reference: p.providerReference,
    purpose: p.purpose,
    status: p.status,
    description: p.description,
    amountMinor: minorToNumber(p.amountMinor),
    currency: p.currency,
    creditsGranted,
    channel: p.channel,
    card: card
      ? {
          brand: card.brand ?? null,
          last4: card.last4 ?? null,
          expMonth: card.expMonth ?? null,
          expYear: card.expYear ?? null,
          bank: card.bank ?? null,
        }
      : null,
    gatewayResponse: p.gatewayResponse,
    invoiceId: p.invoiceId,
    initiatedAt: p.initiatedAt.toISOString(),
    paidAt: p.paidAt?.toISOString() ?? null,
    verifiedAt: p.verifiedAt?.toISOString() ?? null,
    failedAt: p.failedAt?.toISOString() ?? null,
    reversedAt: p.reversedAt?.toISOString() ?? null,
    refundedMinor: minorToNumber(p.refundedMinor),
    refundableMinor: minorToNumber(refundable > 0n ? refundable : 0n),
    refunds: p.refunds.map((r) => ({
      id: r.id,
      status: r.status,
      amountMinor: minorToNumber(r.amountMinor),
      currency: r.currency,
      reason: r.reason,
      reversalUnits: r.reversalUnits,
      failureReason: r.failureReason,
      createdAt: r.createdAt.toISOString(),
      processedAt: r.processedAt?.toISOString() ?? null,
    })),
    underReview: Boolean(p.flaggedAt),
  };
}

/**
 * Billing for the API: catalogue, overview, checkout (server-side prices only; the client sends
 * a plan or pack id), payments and their verification trigger, invoices, subscription
 * cancel/resume/card page, refunds and banners. Nothing here grants credits: the worker's
 * settlement does, after verifying with Paystack.
 */
@Injectable()
export class BillingService {
  constructor(
    private readonly repo: BillingRepository,
    private readonly credits: CreditsService,
    private readonly entitlements: EntitlementsService,
    private readonly invoices: InvoiceService,
    private readonly settlement: PaymentSettlementService,
    @Inject(PAYMENT_PROVIDER) private readonly provider: PaymentProvider,
    private readonly audit: AuditService,
    private readonly logger: Logger,
    @Inject(ENV) private readonly env: ServerEnv,
  ) {}

  providerStatus(): BillingProviderStatus {
    return { provider: "paystack", configured: this.provider.configured, mode: this.provider.mode };
  }

  private async customer(organizationId: string): Promise<CustomerWithOrg> {
    const customer = await this.repo.customerByOrg(organizationId);
    if (!customer) throw AppError.notFound("Billing account");
    return customer;
  }

  private requireConfigured(): void {
    if (!this.provider.configured)
      throw new AppError(
        "BILLING_NOT_CONFIGURED",
        "Payments are not configured on this server yet. Nothing was charged.",
      );
  }

  /** Placeholder or zero prices are never charged on a live key (and zero never at all). */
  private priceBlocker(item: {
    priceMinor: bigint;
    isPlaceholder: boolean;
  }): PurchaseBlocker | null {
    if (!this.provider.configured) return "not_configured";
    if (item.priceMinor <= 0n) return "price_not_published";
    if (item.isPlaceholder && this.provider.mode !== "test") return "price_not_published";
    return null;
  }

  private assertPurchasable(item: {
    priceMinor: bigint;
    isPlaceholder: boolean;
    name: string;
  }): void {
    const blocker = this.priceBlocker(item);
    if (blocker === "not_configured") this.requireConfigured();
    if (blocker === "price_not_published") {
      throw new AppError(
        "PRICE_NOT_PUBLISHED",
        `The price of "${item.name}" has not been published yet, so it cannot be bought.`,
        [{ path: "priceMinor", message: item.priceMinor.toString() }],
      );
    }
  }

  // ---------------------------------------------------------------- catalogue and overview

  async catalogue(organizationId: string): Promise<BillingCatalogue> {
    const customer = await this.customer(organizationId);
    const [plans, packs, live] = await Promise.all([
      this.repo.activePlans(),
      this.repo.activePacks(),
      this.repo.liveSubscription(customer.id),
    ]);
    const planView = (p: Plan): BillingPlan => {
      const blocker =
        live && live.planId === p.id && live.status === "active"
          ? "current_plan"
          : this.priceBlocker(p);
      return {
        id: p.id,
        code: p.code,
        name: p.name,
        description: p.description,
        interval: p.interval,
        priceMinor: minorToNumber(p.priceMinor),
        currency: p.currency,
        includedCredits: p.includedCredits,
        maxMembers: p.maxMembers,
        exportRowCap: p.exportRowCap,
        discoveryEnabled: p.discoveryEnabled,
        websiteAnalysisEnabled: p.websiteAnalysisEnabled,
        isPlaceholder: p.isPlaceholder,
        purchasable: blocker === null,
        blocker,
      };
    };
    const packView = (p: CreditPack): BillingCreditPack => {
      const blocker = this.priceBlocker(p);
      return {
        id: p.id,
        code: p.code,
        name: p.name,
        credits: p.credits,
        priceMinor: minorToNumber(p.priceMinor),
        currency: p.currency,
        isPlaceholder: p.isPlaceholder,
        purchasable: blocker === null,
        blocker,
      };
    };
    return {
      plans: plans.map(planView),
      creditPacks: packs.map(packView),
      pricingPublished:
        plans.length > 0 &&
        !plans.some((p) => p.isPlaceholder) &&
        !packs.some((p) => p.isPlaceholder),
      provider: this.providerStatus(),
    };
  }

  async entitlementsView(
    organizationId: string,
    live: SubscriptionWithPlan | null,
  ): Promise<EntitlementsView> {
    const e = await this.entitlements.resolve(organizationId);
    const map = (s: EntitlementSource) =>
      s === "override" ? ("override" as const) : live ? ("plan" as const) : ("free" as const);
    return {
      maxMembers: e.maxMembers,
      exportRowCap: e.exportRowCap,
      discoveryEnabled: e.discoveryEnabled,
      websiteAnalysisEnabled: e.websiteAnalysisEnabled,
      monthlyIncludedCredits: e.monthlyIncludedCredits,
      sources: {
        maxMembers: map(e.sources.maxMembers),
        exportRowCap: map(e.sources.exportRowCap),
        discoveryEnabled: map(e.sources.discoveryEnabled),
        websiteAnalysisEnabled: map(e.sources.websiteAnalysisEnabled),
        monthlyIncludedCredits: map(e.sources.monthlyIncludedCredits),
      },
      basis: live
        ? { kind: "subscription", planCode: live.plan.code, planName: live.plan.name }
        : { kind: "free", planCode: null, planName: null },
    };
  }

  async overview(
    organizationId: string,
    permissions: readonly Permission[],
  ): Promise<BillingOverview> {
    const customer = await this.customer(organizationId);
    const [live, pending, balance, usage, latest, plans, packs] = await Promise.all([
      this.repo.liveSubscription(customer.id),
      this.repo.pendingSubscription(
        customer.id,
        new Date(Date.now() - this.env.BILLING_PENDING_ABANDON_AFTER_HOURS * 60 * 60 * 1000),
      ),
      this.credits.balance(organizationId),
      this.repo.memberUsage(organizationId),
      this.repo.latestPayment(customer.id),
      this.repo.activePlans(),
      this.repo.activePacks(),
    ]);
    const entitlements = await this.entitlementsView(organizationId, live);
    const granted = latest ? await this.repo.grantedUnits(latest.id) : 0;
    return {
      provider: this.providerStatus(),
      subscription: live ? toSubscriptionView(live) : null,
      pendingSubscription: pending
        ? await this.pendingSubscriptionView(customer.id, pending)
        : null,
      entitlements,
      credits: { balance: balance.balance, held: balance.held },
      members: {
        active: usage.active,
        pendingInvitations: usage.pendingInvitations,
        cap: entitlements.maxMembers,
      },
      latestPayment: latest
        ? toPaymentView(
            latest,
            latest.status === "success" || latest.status === "reversed" ? granted : null,
          )
        : null,
      banners: await this.banners(organizationId, permissions),
      pricingPublished:
        plans.length > 0 &&
        !plans.some((p) => p.isPlaceholder) &&
        !packs.some((p) => p.isPlaceholder),
    };
  }

  /**
   * An incomplete subscription with, while it is likely to still work, the Paystack checkout it
   * was started with, so an abandoned checkout can be resumed. Paystack documents no lifetime for
   * an authorization URL, so it is offered for CHECKOUT_RESUME_WINDOW_MINUTES after the checkout
   * started (an assumption, well inside the abandon window), only while that payment is pending
   * and not under review, and only while the provider is configured (nothing could verify it
   * otherwise). A final payment's URL is never offered.
   */
  private async pendingSubscriptionView(
    customerId: string,
    pending: SubscriptionWithPlan,
  ): Promise<PendingSubscriptionView> {
    const view = toSubscriptionView(pending);
    if (!this.provider.configured) return view;
    const windowMs = CHECKOUT_RESUME_WINDOW_MINUTES * 60 * 1000;
    const checkout = await this.repo.resumableSubscriptionCheckout(
      customerId,
      pending.id,
      new Date(Date.now() - windowMs),
    );
    if (!checkout?.authorizationUrl) return view;
    return {
      ...view,
      authorizationUrl: checkout.authorizationUrl,
      authorizationUrlExpiresAt: new Date(checkout.initiatedAt.getTime() + windowMs).toISOString(),
    };
  }

  /** In-app banners. Everyone sees a negative balance (it blocks their work); billing details only owners and admins. */
  async banners(
    organizationId: string,
    permissions: readonly Permission[],
  ): Promise<BillingBanner[]> {
    const manager = permissions.includes("billing:manage");
    const banners: BillingBanner[] = [];
    const balance = await this.credits.balance(organizationId);
    if (balance.balance < 0) {
      banners.push({
        kind: "negative_balance",
        severity: "error",
        title: "Credit balance is below zero",
        message: manager
          ? `A refund took back credits that were already used (balance ${balance.balance}). New discovery jobs and website analyses are paused until you buy credits.`
          : `A refund took back credits that were already used (balance ${balance.balance}). New discovery jobs and website analyses are paused until an owner or admin buys credits.`,
        href: manager ? "/app/billing" : null,
        since: null,
      });
    }
    if (!manager) return banners;
    if (!this.provider.configured) {
      banners.push({
        kind: "not_configured",
        severity: "info",
        title: "Payments are not set up yet",
        message:
          "Billing is not configured on this server, so plans and credit packs cannot be bought yet. Nothing will be charged.",
        href: null,
        since: null,
      });
    }
    const customer = await this.customer(organizationId);
    const live = await this.repo.liveSubscription(customer.id);
    if (live?.status === "past_due") {
      banners.push({
        kind: "past_due",
        severity: "error",
        title: `${live.plan.name} renewal failed`,
        message: `The renewal payment failed. Update the card on the Billing page; the plan ends ${this.env.BILLING_PAST_DUE_GRACE_DAYS} days after the failure if no payment succeeds.`,
        href: "/app/billing",
        since: live.pastDueAt?.toISOString() ?? null,
      });
    }
    const latest = await this.repo.latestPayment(customer.id);
    if (
      latest?.status === "failed" &&
      latest.failedAt &&
      Date.now() - latest.failedAt.getTime() < PAYMENT_FAILED_BANNER_DAYS * DAY_MS &&
      live?.status !== "past_due"
    ) {
      banners.push({
        kind: "payment_failed",
        severity: "warning",
        title: "A payment failed",
        message: `${latest.description ?? "A payment"} could not be completed${latest.gatewayResponse ? ` (${latest.gatewayResponse})` : ""}. Nothing was charged or added.`,
        href: "/app/billing",
        since: latest.failedAt.toISOString(),
      });
    }
    return banners;
  }

  // ---------------------------------------------------------------- checkout

  private callbackUrl(): string {
    return (
      this.env.BILLING_CALLBACK_URL ?? `${this.env.APP_URL.replace(/\/$/, "")}/app/billing/return`
    );
  }

  private session(p: Payment): CheckoutSession {
    if (!p.authorizationUrl)
      throw new AppError(
        "PAYMENT_PROVIDER_ERROR",
        "This checkout could not be started; start a new one.",
      );
    return {
      paymentId: p.id,
      reference: p.providerReference,
      authorizationUrl: p.authorizationUrl,
      purpose: p.purpose,
      amountMinor: minorToNumber(p.amountMinor),
      currency: p.currency,
      description: p.description,
    };
  }

  /** The same Idempotency-Key returns the same checkout; reused for another item it is a 409. */
  private async replay(
    organizationId: string,
    userId: string,
    key: string,
    match: (p: Payment) => boolean,
  ): Promise<CheckoutSession | null> {
    const existing = await this.repo.paymentByIdempotencyKey(
      `checkout:${organizationId}:${userId}:${key}`,
    );
    if (!existing) return null;
    if (!match(existing))
      throw AppError.conflict("This Idempotency-Key was already used for a different checkout");
    return this.session(existing);
  }

  private async ensureProviderCustomer(customer: CustomerWithOrg): Promise<string> {
    if (customer.providerCustomerCode) return customer.providerCustomerCode;
    const { customerCode } = await this.callProvider(() =>
      this.provider.createCustomer({
        email: customer.email,
        metadata: { organization_id: customer.organizationId, billing_customer_id: customer.id },
      }),
    );
    return this.repo.setProviderCustomerCode(customer.id, customerCode);
  }

  private async ensureProviderPlan(plan: Plan): Promise<string> {
    if (plan.providerPlanCode) return plan.providerPlanCode;
    const { planCode } = await this.callProvider(() =>
      this.provider.createPlan({
        name: `LeadForge ${plan.name}`,
        interval: plan.interval,
        amountMinor: plan.priceMinor,
        currency: plan.currency,
        description: plan.description,
      }),
    );
    return this.repo.setProviderPlanCode(plan.id, planCode);
  }

  private async callProvider<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (err) {
      if (err instanceof AppError) throw err;
      this.logger.error({ err }, "Payment provider call failed");
      throw new AppError(
        "PAYMENT_PROVIDER_ERROR",
        "The payment provider could not be reached. Nothing was charged; try again shortly.",
      );
    }
  }

  /** Creates the pending payment, then the hosted checkout. A provider failure fails the payment (nothing charged). */
  private async startCheckout(
    customer: CustomerWithOrg,
    userId: string,
    key: string,
    item: {
      purpose: "credit_pack" | "subscription";
      purposeRef: string;
      amountMinor: bigint;
      currency: string;
      creditUnits: number | null;
      description: string;
      planCode: string | null;
    },
    ctx: AuditContext,
  ): Promise<{ session: CheckoutSession; replayed: boolean }> {
    const id = newId();
    let payment: Payment;
    try {
      payment = await this.repo.createPayment({
        id,
        billingCustomerId: customer.id,
        purpose: item.purpose,
        purposeRef: item.purposeRef,
        providerReference: `lf-${id}`,
        amountMinor: item.amountMinor,
        currency: item.currency,
        status: "pending",
        idempotencyKey: `checkout:${customer.organizationId}:${userId}:${key}`,
        creditUnits: item.creditUnits,
        description: item.description,
        initiatedByUserId: userId,
      });
    } catch (err) {
      if (!isUniqueViolation(err)) throw err;
      // A concurrent request with the same key won the insert; return its checkout.
      const again = await this.repo.paymentByIdempotencyKey(
        `checkout:${customer.organizationId}:${userId}:${key}`,
      );
      if (!again) throw err;
      return { session: this.session(again), replayed: true };
    }
    try {
      const init = await this.provider.initializeTransaction({
        email: customer.email,
        amountMinor: item.amountMinor,
        currency: item.currency,
        reference: payment.providerReference,
        callbackUrl: this.callbackUrl(),
        planCode: item.planCode,
        metadata: {
          organization_id: customer.organizationId,
          payment_id: payment.id,
          purpose: item.purpose,
        },
      });
      payment = await this.repo.updatePayment(payment.id, {
        authorizationUrl: init.authorizationUrl,
        accessCode: init.accessCode,
      });
    } catch (err) {
      await this.repo.updatePayment(payment.id, {
        status: "failed",
        failedAt: new Date(),
        gatewayResponse: "Checkout could not be started at the provider",
      });
      if (item.purpose === "subscription")
        await this.repo.transitionSubscription(item.purposeRef, ["incomplete"], {
          status: "expired",
          endedAt: new Date(),
        });
      if (err instanceof AppError) throw err;
      this.logger.error(
        { err: err instanceof PaymentProviderError ? err.message : err, paymentId: payment.id },
        "Checkout initialization failed",
      );
      throw new AppError(
        "PAYMENT_PROVIDER_ERROR",
        "The payment provider could not start the checkout. Nothing was charged; try again shortly.",
      );
    }
    await this.repo.audit({
      billingCustomerId: customer.id,
      actorType: "user",
      actorId: userId,
      action: "checkout.created",
      after: {
        paymentId: payment.id,
        purpose: item.purpose,
        purposeRef: item.purposeRef,
        amountMinor: item.amountMinor,
        currency: item.currency,
      },
      requestId: ctx.requestId ?? null,
    });
    await this.audit.record(
      {
        organizationId: customer.organizationId,
        actorUserId: userId,
        actorType: "user",
        action: "billing.checkout_created",
        resourceType: "payment",
        resourceId: payment.id,
        after: { purpose: item.purpose },
      },
      ctx,
    );
    return { session: this.session(payment), replayed: false };
  }

  async checkoutCredits(
    organizationId: string,
    userId: string,
    packId: string,
    key: string,
    ctx: AuditContext,
  ): Promise<{ session: CheckoutSession; replayed: boolean }> {
    const replay = await this.replay(
      organizationId,
      userId,
      key,
      (p) => p.purpose === "credit_pack" && p.purposeRef === packId,
    );
    if (replay) return { session: replay, replayed: true };
    const pack = await this.repo.packById(packId);
    if (!pack || !pack.isActive) throw AppError.notFound("Credit pack");
    this.assertPurchasable(pack);
    const customer = await this.customer(organizationId);
    await this.ensureProviderCustomer(customer);
    return this.startCheckout(
      customer,
      userId,
      key,
      {
        purpose: "credit_pack",
        purposeRef: pack.id,
        amountMinor: pack.priceMinor,
        currency: pack.currency,
        creditUnits: pack.credits,
        description: `Credit pack: ${pack.name} (${pack.credits.toLocaleString("en-US")} credits)`,
        planCode: null,
      },
      ctx,
    );
  }

  async checkoutSubscription(
    organizationId: string,
    userId: string,
    planId: string,
    key: string,
    ctx: AuditContext,
  ): Promise<{ session: CheckoutSession; replayed: boolean }> {
    const customer = await this.customer(organizationId);
    const existingSession = await this.repo.paymentByIdempotencyKey(
      `checkout:${organizationId}:${userId}:${key}`,
    );
    if (existingSession) {
      const sub =
        existingSession.purpose === "subscription"
          ? await this.repo.subscriptionById(existingSession.purposeRef)
          : null;
      if (!sub || sub.planId !== planId)
        throw AppError.conflict("This Idempotency-Key was already used for a different checkout");
      return { session: this.session(existingSession), replayed: true };
    }
    const plan = await this.repo.planById(planId);
    if (!plan || !plan.isActive) throw AppError.notFound("Plan");
    this.assertPurchasable(plan);
    const live = await this.repo.liveSubscription(customer.id);
    if (live && live.planId === plan.id) {
      throw AppError.conflict(
        live.status === "past_due"
          ? "This plan's renewal is past due. Update the card on the Billing page instead of buying it again."
          : "Your organization is already on this plan.",
      );
    }
    await this.ensureProviderCustomer(customer);
    const planCode = await this.ensureProviderPlan(plan);
    const sub = await this.repo.createSubscription({
      id: newId(),
      billingCustomerId: customer.id,
      planId: plan.id,
      status: "incomplete",
    });
    return this.startCheckout(
      customer,
      userId,
      key,
      {
        purpose: "subscription",
        purposeRef: sub.id,
        amountMinor: plan.priceMinor,
        currency: plan.currency,
        creditUnits: null,
        description: `${plan.name} plan (${plan.interval})`,
        planCode,
      },
      ctx,
    );
  }

  // ---------------------------------------------------------------- payments

  private async paymentOf(
    organizationId: string,
    idOrReference: string,
  ): Promise<PaymentWithRefunds> {
    const customer = await this.customer(organizationId);
    const p = UuidString.safeParse(idOrReference).success
      ? await this.repo.paymentById(idOrReference)
      : await this.repo.paymentByReference(idOrReference);
    // Another organization's payment is indistinguishable from a missing one.
    if (!p || p.billingCustomerId !== customer.id) throw AppError.notFound("Payment");
    return p;
  }

  private async view(p: PaymentWithRefunds): Promise<PaymentView> {
    const granted =
      p.status === "success" || p.status === "reversed" ? await this.repo.grantedUnits(p.id) : null;
    return toPaymentView(p, granted);
  }

  async listPayments(
    organizationId: string,
    query: PaymentListQuery,
  ): Promise<{ items: PaymentView[]; nextCursor: string | null }> {
    if (query.cursor && !UuidString.safeParse(query.cursor).success)
      throw AppError.validation([
        { path: "cursor", message: "Invalid cursor; start from the first page" },
      ]);
    const customer = await this.customer(organizationId);
    const page = await this.repo.paymentsPage(
      customer.id,
      { statuses: query.status, purpose: query.purpose },
      { pageSize: query.pageSize, cursor: query.cursor ?? null },
    );
    const granted = await this.repo.grantedUnitsMany(
      page.items.filter((p) => p.status === "success" || p.status === "reversed").map((p) => p.id),
    );
    return {
      items: page.items.map((p) =>
        toPaymentView(
          p,
          p.status === "success" || p.status === "reversed" ? (granted.get(p.id) ?? 0) : null,
        ),
      ),
      nextCursor: page.nextCursor,
    };
  }

  async getPayment(organizationId: string, idOrReference: string): Promise<PaymentView> {
    return this.view(await this.paymentOf(organizationId, idOrReference));
  }

  /**
   * The return page calls this once: it queues a provider verify (never grants in the request).
   * Final payments return as they are.
   */
  async requestVerification(
    organizationId: string,
    idOrReference: string,
  ): Promise<VerifyPaymentResponse> {
    const p = await this.paymentOf(organizationId, idOrReference);
    let queued = false;
    if (p.status === "pending" && !p.flaggedAt) {
      this.requireConfigured();
      await this.settlement.enqueueVerify(p.id, "return");
      queued = true;
    }
    return { queued, payment: await this.view(p) };
  }

  // ---------------------------------------------------------------- invoices

  async listInvoices(
    organizationId: string,
    query: InvoiceListQuery,
  ): Promise<{ items: InvoiceView[]; nextCursor: string | null }> {
    if (query.cursor && !UuidString.safeParse(query.cursor).success)
      throw AppError.validation([
        { path: "cursor", message: "Invalid cursor; start from the first page" },
      ]);
    const customer = await this.customer(organizationId);
    const page = await this.repo.invoicesPage(customer.id, {
      pageSize: query.pageSize,
      cursor: query.cursor ?? null,
    });
    return { items: page.items.map(toInvoiceView), nextCursor: page.nextCursor };
  }

  async getInvoice(organizationId: string, id: string): Promise<InvoiceView> {
    const customer = await this.customer(organizationId);
    const inv = await this.repo.invoiceById(customer.id, id);
    if (!inv) throw AppError.notFound("Invoice");
    return toInvoiceView(inv);
  }

  async invoiceDownloadLink(organizationId: string, userId: string, id: string) {
    const customer = await this.customer(organizationId);
    return this.invoices.downloadLink(organizationId, customer.id, userId, id);
  }

  // ---------------------------------------------------------------- subscription management

  private async liveLinked(
    organizationId: string,
  ): Promise<{
    customer: CustomerWithOrg;
    sub: SubscriptionWithPlan;
    code: string;
    token: string;
  }> {
    this.requireConfigured();
    const customer = await this.customer(organizationId);
    const sub = await this.repo.liveSubscription(customer.id);
    if (!sub) throw AppError.notFound("Subscription");
    if (!sub.providerSubscriptionCode || !sub.providerEmailToken) {
      throw AppError.conflict(
        "Paystack has not confirmed this subscription yet. Try again in a minute.",
      );
    }
    return { customer, sub, code: sub.providerSubscriptionCode, token: sub.providerEmailToken };
  }

  /** Stops renewal now (Paystack disable); the plan stays active until the paid period ends. */
  async cancelAtPeriodEnd(
    organizationId: string,
    userId: string,
    ctx: AuditContext,
  ): Promise<SubscriptionView> {
    const { customer, sub, code, token } = await this.liveLinked(organizationId);
    if (sub.status !== "active")
      throw AppError.conflict(
        "Only an active subscription can be cancelled; a past-due one ends by itself after the grace period.",
      );
    if (sub.cancelAtPeriodEnd) return toSubscriptionView(sub);
    await this.callProvider(() => this.provider.disableSubscription(code, token));
    const updated = await this.repo.updateSubscription(sub.id, {
      cancelAtPeriodEnd: true,
      providerStatus: "non-renewing",
      lastSyncedAt: new Date(),
    });
    await this.repo.audit({
      billingCustomerId: customer.id,
      actorType: "user",
      actorId: userId,
      action: "subscription.cancel_at_period_end",
      before: { cancelAtPeriodEnd: false },
      after: { cancelAtPeriodEnd: true },
      requestId: ctx.requestId ?? null,
    });
    await this.audit.record(
      {
        organizationId,
        actorUserId: userId,
        actorType: "user",
        action: "billing.subscription_cancel_requested",
        resourceType: "subscription",
        resourceId: sub.id,
      },
      ctx,
    );
    return toSubscriptionView({ ...sub, ...updated, plan: sub.plan });
  }

  /** Turns renewal back on before the period ends (Paystack enable). */
  async resume(
    organizationId: string,
    userId: string,
    ctx: AuditContext,
  ): Promise<SubscriptionView> {
    const { customer, sub, code, token } = await this.liveLinked(organizationId);
    if (!sub.cancelAtPeriodEnd) return toSubscriptionView(sub);
    if (sub.status !== "active" || !sub.currentPeriodEnd || sub.currentPeriodEnd <= new Date())
      throw AppError.conflict("This subscription can no longer be resumed; choose a plan instead.");
    await this.callProvider(() => this.provider.enableSubscription(code, token));
    const updated = await this.repo.updateSubscription(sub.id, {
      cancelAtPeriodEnd: false,
      providerStatus: "active",
      lastSyncedAt: new Date(),
    });
    await this.repo.audit({
      billingCustomerId: customer.id,
      actorType: "user",
      actorId: userId,
      action: "subscription.resumed",
      before: { cancelAtPeriodEnd: true },
      after: { cancelAtPeriodEnd: false },
      requestId: ctx.requestId ?? null,
    });
    await this.audit.record(
      {
        organizationId,
        actorUserId: userId,
        actorType: "user",
        action: "billing.subscription_resumed",
        resourceType: "subscription",
        resourceId: sub.id,
      },
      ctx,
    );
    return toSubscriptionView({ ...sub, ...updated, plan: sub.plan });
  }

  async manageLink(organizationId: string): Promise<SubscriptionManageLink> {
    const { code } = await this.liveLinked(organizationId);
    return this.callProvider(() => this.provider.manageSubscriptionLink(code));
  }

  // ---------------------------------------------------------------- refunds

  /** Owner-only: refund all or part of a successful payment. Credits are taken back when Paystack confirms. */
  async requestRefund(
    organizationId: string,
    userId: string,
    paymentId: string,
    req: RefundRequest,
    ctx: AuditContext,
  ): Promise<PaymentView> {
    this.requireConfigured();
    const p = await this.paymentOf(organizationId, paymentId);
    if (p.status !== "success")
      throw AppError.conflict("Only a successful payment can be refunded.");
    const pending = p.refunds
      .filter((r) => r.status === "pending")
      .reduce((s, r) => s + r.amountMinor, 0n);
    const refundable = p.amountMinor - p.refundedMinor - pending;
    const amount = req.amountMinor !== undefined ? BigInt(req.amountMinor) : refundable;
    if (refundable <= 0n) throw AppError.conflict("This payment has nothing left to refund.");
    if (amount <= 0n || amount > refundable)
      throw AppError.validation([
        { path: "amountMinor", message: `At most ${refundable.toString()} can be refunded` },
      ]);
    const refundId = newId();
    await this.repo.createRefund({
      id: refundId,
      paymentId: p.id,
      amountMinor: amount,
      currency: p.currency,
      status: "pending",
      reason: req.reason,
      requestedByUserId: userId,
    });
    try {
      const r = await this.provider.refund({
        reference: p.providerReference,
        amountMinor: amount,
        currency: p.currency,
        merchantNote: req.reason,
      });
      await this.repo.updateRefund(refundId, {
        providerRefundReference: r.id,
        providerStatus: r.status,
      });
    } catch (err) {
      await this.repo.updateRefund(refundId, {
        status: "failed",
        failedAt: new Date(),
        failureReason: "The payment provider refused or could not process the refund request",
      });
      if (err instanceof AppError) throw err;
      this.logger.error(
        { err: err instanceof PaymentProviderError ? err.message : err, paymentId: p.id },
        "Refund request failed at the provider",
      );
      throw new AppError(
        "PAYMENT_PROVIDER_ERROR",
        "The payment provider could not take the refund request. Nothing was refunded; try again shortly.",
      );
    }
    await this.repo.audit({
      billingCustomerId: p.billingCustomerId,
      actorType: "user",
      actorId: userId,
      action: "refund.requested",
      after: {
        refundId,
        paymentId: p.id,
        amountMinor: amount,
        currency: p.currency,
        reason: req.reason,
      },
      requestId: ctx.requestId ?? null,
    });
    await this.audit.record(
      {
        organizationId,
        actorUserId: userId,
        actorType: "user",
        action: "billing.refund_requested",
        resourceType: "payment",
        resourceId: p.id,
        after: { refundId },
      },
      ctx,
    );
    return this.view(await this.paymentOf(organizationId, p.id));
  }
}
