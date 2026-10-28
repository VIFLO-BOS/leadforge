import { Inject, Injectable } from "@nestjs/common";
import { Logger } from "nestjs-pino";
import { newId, Prisma, type Payment, type Refund } from "@leadforge/db-postgres";
import type { ServerEnv } from "@leadforge/contracts";
import { ENV } from "../config/env.module.js";
import { AuditService } from "../audit/audit.service.js";
import { QueueService } from "../queue/queue.service.js";
import { CreditsService } from "../credits/credits.service.js";
import { EntitlementsService } from "../entitlements/entitlements.service.js";
import { QueueNames } from "../queue/queue.constants.js";
import { BillingNotifier } from "./billing-notifier.js";
import { addInterval, formatMinor, proportionalReversal } from "./money.js";
import {
  PAYMENT_PROVIDER,
  PaymentProviderError,
  type PaymentProvider,
  type VerifiedTransaction,
} from "./provider/payment-provider.js";
import { paystackAmount } from "./provider/paystack.provider.js";
import {
  BillingRepository,
  type CustomerWithOrg,
  type PaymentWithRefunds,
  type SubscriptionWithPlan,
} from "./repositories/billing.repository.js";

export type SettleOutcome =
  | "granted"
  | "already_final"
  | "under_review"
  | "flagged"
  | "failed"
  | "abandoned"
  | "pending"
  | "reversed"
  | "not_found";

export type SettleTrigger = "webhook" | "return" | "reconcile" | "renewal";

const day = (d: Date | null | undefined): string => (d ? d.toISOString().slice(0, 10) : "-");

function isUniqueViolation(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002";
}

/**
 * Payment state machine (PostgreSQL only; docs/DATABASE_DESIGN.md section 5):
 *
 * - Nothing is granted on a browser redirect or on a webhook payload alone. Every grant follows a
 *   provider verify by reference whose status is `success` and whose reference, amount and
 *   currency match the payment row. A mismatch flags the payment, grants nothing, writes
 *   billing_audit and an audit event and alerts the billing managers; the record stays pending
 *   for review (reconciliation reports it and never settles it).
 * - The grant is one transaction under the customer row lock: payment pending -> success, a
 *   ledger `purchase` (credit pack) or `grant` (plan's included credits) keyed
 *   `payment:<id>:grant`, the subscription period, entitlements, a numbered invoice and
 *   billing_audit. Replays, concurrent webhooks and reconciliation find the payment final (or the
 *   ledger key taken) and do nothing.
 * - Refunds and reversals take the payment's credits back with a `refund_reversal` entry (the
 *   balance may go negative; negative balances block new holds until topped up).
 */
@Injectable()
export class PaymentSettlementService {
  constructor(
    private readonly repo: BillingRepository,
    private readonly credits: CreditsService,
    private readonly entitlements: EntitlementsService,
    @Inject(PAYMENT_PROVIDER) private readonly provider: PaymentProvider,
    private readonly notifier: BillingNotifier,
    private readonly audit: AuditService,
    private readonly queue: QueueService,
    private readonly logger: Logger,
    @Inject(ENV) private readonly env: ServerEnv,
  ) {}

  /** Enqueues `verify-payment` (deduplicated per payment and 10-second bucket). */
  async enqueueVerify(paymentId: string, trigger: SettleTrigger): Promise<void> {
    const bucket = Math.floor(Date.now() / 10_000);
    await this.queue
      .queue(QueueNames.billing)
      .add(
        "verify-payment",
        { paymentId, trigger },
        {
          jobId: `verify-payment-${paymentId}-${bucket}`,
          attempts: 5,
          backoff: { type: "exponential", delay: 15_000 },
        },
      );
  }

  /** Verifies the payment with the provider and settles it. Throws provider errors (BullMQ retries). */
  async verifyAndSettle(
    paymentId: string,
    opts: { trigger: SettleTrigger; verified?: VerifiedTransaction; eventId?: string | null },
  ): Promise<SettleOutcome> {
    const payment = await this.repo.paymentById(paymentId);
    if (!payment) return "not_found";
    if (payment.status === "success" || payment.status === "reversed") {
      // A success can still be reversed by the provider; that arrives as a refund or reversal event.
      return "already_final";
    }
    if (payment.flaggedAt) return "under_review";
    const customer = await this.repo.customerById(payment.billingCustomerId);
    if (!customer) return "not_found";

    let v = opts.verified;
    if (!v) {
      try {
        v = await this.provider.verifyTransaction(payment.providerReference);
      } catch (err) {
        if (err instanceof PaymentProviderError && err.notFound) {
          await this.repo.updatePayment(payment.id, {
            lastVerifiedAt: new Date(),
            verifyAttempts: { increment: 1 },
            providerStatus: "not_found",
          });
          if (this.pastAbandonWindow(payment))
            return this.abandon(payment, customer, "The provider has no record of this checkout.");
          return "pending";
        }
        throw err;
      }
    }
    await this.repo.updatePayment(payment.id, {
      lastVerifiedAt: new Date(),
      verifyAttempts: { increment: 1 },
      providerStatus: v.rawStatus.slice(0, 40),
      gatewayResponse: v.gatewayResponse,
    });

    switch (v.status) {
      case "success": {
        const mismatch = this.mismatch(payment, v);
        if (mismatch) return this.flag(payment, customer, mismatch, v);
        return this.grant(payment, customer, v, opts.eventId ?? null);
      }
      case "failed":
        return this.fail(payment, customer, v.gatewayResponse);
      case "abandoned":
        return this.pastAbandonWindow(payment)
          ? this.abandon(payment, customer, v.gatewayResponse)
          : "pending";
      case "reversed":
        return this.fail(payment, customer, "The charge was reversed by the provider.");
      default:
        return "pending";
    }
  }

  private pastAbandonWindow(payment: Payment): boolean {
    return (
      Date.now() - payment.initiatedAt.getTime() >
      this.env.BILLING_PENDING_ABANDON_AFTER_HOURS * 60 * 60 * 1000
    );
  }

  private mismatch(payment: Payment, v: VerifiedTransaction): string | null {
    if (v.reference !== payment.providerReference)
      return `reference_mismatch: verify returned ${v.reference.slice(0, 80)}`;
    if (v.currency !== payment.currency)
      return `currency_mismatch: expected ${payment.currency}, provider reported ${v.currency.slice(0, 3)}`;
    if (v.amountMinor !== payment.amountMinor)
      return `amount_mismatch: expected ${payment.amountMinor.toString()}, provider reported ${v.amountMinor.toString()}`;
    return null;
  }

  private async flag(
    payment: Payment,
    customer: CustomerWithOrg,
    reason: string,
    v: VerifiedTransaction,
  ): Promise<SettleOutcome> {
    const now = new Date();
    const changed = await this.repo.transaction(async (tx) => {
      const ok = await this.repo.transitionPayment(
        payment.id,
        ["pending", "abandoned", "failed"],
        { flagReason: reason.slice(0, 300), flaggedAt: now, status: "pending" },
        tx,
        { unflaggedOnly: true },
      );
      if (!ok) return false;
      await this.repo.audit(
        {
          billingCustomerId: customer.id,
          actorType: "system",
          actorId: null,
          action: "payment.verification_mismatch",
          before: {
            status: payment.status,
            amountMinor: payment.amountMinor,
            currency: payment.currency,
            reference: payment.providerReference,
          },
          after: {
            reason,
            providerAmountMinor: v.amountMinor,
            providerCurrency: v.currency,
            providerReference: v.reference,
            providerStatus: v.rawStatus,
          },
        },
        tx,
      );
      return true;
    });
    if (!changed) return "already_final";
    this.logger.error(
      { paymentId: payment.id, organizationId: customer.organizationId, reason },
      "Payment verification mismatch: no credits granted, flagged for review",
    );
    await this.audit.record({
      organizationId: customer.organizationId,
      actorUserId: null,
      actorType: "system",
      action: "billing.payment_flagged",
      resourceType: "payment",
      resourceId: payment.id,
      after: { reason: reason.split(":")[0] },
    });
    await this.notifier.attention(customer.organizationId, {
      key: `payment-flag:${payment.id}`,
      title: "A payment needs review",
      body: `Payment ${payment.providerReference} did not match what Paystack reported (${reason.split(":")[0]?.replace(/_/g, " ")}). Nothing was granted. Contact support with the reference before trying again.`,
    });
    return "flagged";
  }

  private async grant(
    payment: PaymentWithRefunds,
    customer: CustomerWithOrg,
    v: VerifiedTransaction,
    eventId: string | null,
  ): Promise<SettleOutcome> {
    const now = new Date();
    const paidAt = v.paidAt ?? now;
    const result = await this.credits.withLockedCustomer(
      customer.organizationId,
      async (tx, locked) => {
        const fresh = await this.repo.paymentById(payment.id, tx);
        if (!fresh || fresh.status === "success" || fresh.status === "reversed" || fresh.flaggedAt)
          return null;

        let units = 0;
        let periodStart: Date | null = null;
        let periodEnd: Date | null = null;
        let subscription: SubscriptionWithPlan | null = null;
        const superseded: SubscriptionWithPlan[] = [];
        const amount = fresh.amountMinor;
        let description =
          fresh.description ?? (fresh.purpose === "credit_pack" ? "Credit pack" : "Subscription");

        if (fresh.purpose === "credit_pack") {
          units = fresh.creditUnits ?? 0;
          if (units > 0) {
            await this.credits.creditInTx(tx, locked, {
              units,
              key: `payment:${fresh.id}:grant`,
              entryType: "purchase",
              description: `Purchase: ${description}`,
              referenceType: "payment",
              referenceId: fresh.id,
              referenceName: description,
              actorUserId: fresh.initiatedByUserId,
            });
          }
        } else {
          subscription = await this.repo.subscriptionById(fresh.purposeRef, tx);
          if (!subscription)
            throw new Error(`Subscription ${fresh.purposeRef} of payment ${fresh.id} is missing`);
          const plan = subscription.plan;
          periodStart = paidAt;
          periodEnd = addInterval(paidAt, plan.interval);
          const renewal = subscription.status === "active" || subscription.status === "past_due";
          description = `${plan.name} plan (${plan.interval}), ${day(periodStart)} to ${day(periodEnd)}${renewal ? ", renewal" : ""}`;
          await this.repo.updateSubscription(
            subscription.id,
            {
              status: "active",
              currentPeriodStart: periodStart,
              currentPeriodEnd: periodEnd,
              pastDueAt: null,
              endedAt: null,
              cancelledAt: null,
            },
            tx,
          );
          // A new plan replaces any other live subscription (plan change): the old one ends now.
          const others = await tx.subscription.findMany({
            where: {
              billingCustomerId: customer.id,
              status: { in: ["active", "past_due"] },
              id: { not: subscription.id },
            },
            include: { plan: true },
          });
          for (const o of others) {
            await this.repo.updateSubscription(
              o.id,
              { status: "cancelled", cancelledAt: now, endedAt: now, cancelAtPeriodEnd: false },
              tx,
            );
            superseded.push(o);
          }
          await this.entitlements.writeForPlanInTx(tx, customer.id, plan, now);
          units = plan.includedCredits;
          if (units > 0) {
            await this.credits.creditInTx(tx, locked, {
              units,
              key: `payment:${fresh.id}:grant`,
              entryType: "grant",
              description: `Included credits: ${plan.name} plan, ${day(periodStart)} to ${day(periodEnd)}`,
              referenceType: "payment",
              referenceId: fresh.id,
              referenceName: `${plan.name} plan`,
              actorUserId: fresh.initiatedByUserId,
            });
          }
        }

        const number = await this.repo.nextInvoiceNumber(tx, now.getUTCFullYear());
        const invoice = await this.repo.createInvoice(
          {
            id: newId(),
            billingCustomerId: customer.id,
            subscriptionId: subscription?.id ?? null,
            number,
            status: "paid",
            subtotalMinor: amount,
            taxMinor: 0n,
            totalMinor: amount,
            currency: fresh.currency,
            issuedAt: now,
            paidAt,
            lines: [
              {
                description,
                quantity: 1,
                unitMinor: amount.toString(),
                amountMinor: amount.toString(),
              },
            ],
            billTo: {
              organizationName: customer.organization.name,
              email: customer.email,
              country: customer.organization.country,
              testMode: v.mode === "test",
            },
            periodStart,
            periodEnd,
          },
          tx,
        );
        await this.repo.updatePayment(
          fresh.id,
          {
            status: "success",
            verifiedAt: now,
            paidAt,
            failedAt: null,
            channel: v.channel,
            authorizationMasked: v.authorization
              ? (v.authorization as unknown as Prisma.InputJsonValue)
              : Prisma.DbNull,
            providerTransactionId: v.providerTransactionId,
            invoiceId: invoice.id,
            description,
            ...(eventId ? { lastEventId: eventId } : {}),
          },
          tx,
        );
        await this.repo.audit(
          {
            billingCustomerId: customer.id,
            actorType: "provider",
            actorId: null,
            action: "payment.succeeded",
            before: { status: fresh.status },
            after: {
              status: "success",
              amountMinor: amount,
              currency: fresh.currency,
              creditsGranted: units,
              invoiceNumber: number,
              subscriptionId: subscription?.id ?? null,
              supersededSubscriptions: superseded.map((s) => s.id),
            },
          },
          tx,
        );
        return { invoiceId: invoice.id, number, units, description, superseded, subscription };
      },
    );
    if (!result) return "already_final";

    await this.queue
      .queue(QueueNames.billing)
      .add(
        "generate-invoice-pdf",
        { organizationId: customer.organizationId, invoiceId: result.invoiceId },
        {
          jobId: `invoice-pdf-${result.invoiceId}`,
          attempts: 3,
          backoff: { type: "exponential", delay: 10_000 },
        },
      )
      .catch((err: unknown) =>
        this.logger.warn(
          { err, invoiceId: result.invoiceId },
          "Could not enqueue the invoice PDF; it is rendered on first download",
        ),
      );
    for (const old of result.superseded)
      await this.disableAtProvider(old, "superseded by a new plan");
    await this.audit.record({
      organizationId: customer.organizationId,
      actorUserId: payment.initiatedByUserId,
      actorType: "system",
      action: "billing.payment_succeeded",
      resourceType: "payment",
      resourceId: payment.id,
      after: { purpose: payment.purpose, invoiceNumber: result.number },
    });
    await this.notifier.paymentSucceeded(customer.organizationId, {
      paymentId: payment.id,
      description: result.description,
      amount: formatMinor(payment.amountMinor, payment.currency),
      credits: result.units,
      invoiceNumber: result.number,
      testMode: v.mode === "test",
    });
    if (result.subscription) {
      const plan = result.subscription.plan;
      await this.notifier.subscriptionChanged(customer.organizationId, {
        key: `active:${payment.id}`,
        title:
          result.subscription.status === "incomplete"
            ? `${plan.name} plan is active`
            : `${plan.name} plan renewed`,
        body: `Your ${plan.name} plan is active until ${day(addInterval(v.paidAt ?? new Date(), plan.interval))}. Plan limits apply now.`,
      });
    }
    return "granted";
  }

  private async fail(
    payment: Payment,
    customer: CustomerWithOrg,
    reason: string | null,
  ): Promise<SettleOutcome> {
    const now = new Date();
    const changed = await this.repo.transaction(async (tx) => {
      const ok = await this.repo.transitionPayment(
        payment.id,
        ["pending", "abandoned"],
        { status: "failed", failedAt: now },
        tx,
      );
      if (!ok) return false;
      if (payment.purpose === "subscription") {
        await this.repo.transitionSubscription(
          payment.purposeRef,
          ["incomplete"],
          { status: "expired", endedAt: now },
          tx,
        );
      }
      await this.repo.audit(
        {
          billingCustomerId: customer.id,
          actorType: "provider",
          actorId: null,
          action: "payment.failed",
          before: { status: payment.status },
          after: { status: "failed", reason },
        },
        tx,
      );
      return true;
    });
    if (!changed) return "already_final";
    await this.audit.record({
      organizationId: customer.organizationId,
      actorUserId: null,
      actorType: "system",
      action: "billing.payment_failed",
      resourceType: "payment",
      resourceId: payment.id,
    });
    await this.notifier.paymentFailed(customer.organizationId, {
      key: payment.id,
      what: `Payment ${payment.providerReference} of ${formatMinor(payment.amountMinor, payment.currency)} for ${payment.description ?? payment.purpose} failed`,
      reason,
      renewal: payment.idempotencyKey.startsWith("renewal:"),
    });
    return "failed";
  }

  private async abandon(
    payment: Payment,
    customer: CustomerWithOrg,
    reason: string | null,
  ): Promise<SettleOutcome> {
    const now = new Date();
    const changed = await this.repo.transaction(async (tx) => {
      const ok = await this.repo.transitionPayment(
        payment.id,
        ["pending"],
        { status: "abandoned", gatewayResponse: reason?.slice(0, 300) ?? null },
        tx,
      );
      if (!ok) return false;
      if (payment.purpose === "subscription") {
        await this.repo.transitionSubscription(
          payment.purposeRef,
          ["incomplete"],
          { status: "expired", endedAt: now },
          tx,
        );
      }
      await this.repo.audit(
        {
          billingCustomerId: customer.id,
          actorType: "system",
          actorId: null,
          action: "payment.abandoned",
          before: { status: "pending" },
          after: { status: "abandoned" },
        },
        tx,
      );
      return true;
    });
    return changed ? "abandoned" : "already_final";
  }

  /** Paystack plan charges we did not initiate (renewals): verify first, then record and settle. */
  async settleUnknownCharge(
    reference: string,
    hint: { subscriptionCode?: string | null; eventId?: string | null },
  ): Promise<{ outcome: SettleOutcome | "ignored"; note?: string }> {
    const existing = await this.repo.paymentByReference(reference);
    if (existing)
      return {
        outcome: await this.verifyAndSettle(existing.id, {
          trigger: "webhook",
          eventId: hint.eventId ?? null,
        }),
      };
    let v: VerifiedTransaction;
    try {
      v = await this.provider.verifyTransaction(reference);
    } catch (err) {
      if (err instanceof PaymentProviderError && err.notFound)
        return { outcome: "ignored", note: "The provider has no transaction with this reference" };
      throw err;
    }
    if (v.status !== "success")
      return { outcome: "ignored", note: `Unknown charge with provider status ${v.rawStatus}` };
    const customer = v.customerCode ? await this.repo.customerByProviderCode(v.customerCode) : null;
    if (!customer)
      return { outcome: "ignored", note: "The charge belongs to no LeadForge customer" };
    let sub: SubscriptionWithPlan | null = null;
    if (hint.subscriptionCode) {
      const byCode = await this.repo.subscriptionByCode(hint.subscriptionCode);
      if (byCode && byCode.billingCustomerId === customer.id) sub = byCode;
    }
    if (!sub) {
      const subs = await this.repo.renewableSubscriptions(customer.id);
      sub =
        (v.planCode ? subs.find((s) => s.plan.providerPlanCode === v.planCode) : undefined) ??
        (subs.length === 1 ? (subs[0] ?? null) : null);
    }
    if (!sub)
      return { outcome: "ignored", note: "No subscription of this customer matches the charge" };
    let paymentId: string;
    try {
      const created = await this.repo.createPayment({
        id: newId(),
        billingCustomerId: customer.id,
        purpose: "subscription",
        purposeRef: sub.id,
        providerReference: reference,
        amountMinor: sub.plan.priceMinor,
        currency: sub.plan.currency,
        status: "pending",
        idempotencyKey: `renewal:${reference}`,
        description: `${sub.plan.name} plan renewal`,
      });
      paymentId = created.id;
    } catch (err) {
      if (!isUniqueViolation(err)) throw err;
      const again = await this.repo.paymentByReference(reference);
      if (!again) throw err;
      paymentId = again.id;
    }
    return {
      outcome: await this.verifyAndSettle(paymentId, {
        trigger: "renewal",
        verified: v,
        eventId: hint.eventId ?? null,
      }),
    };
  }

  /** Stops future charges of a subscription that ended on our side (best effort; logged). */
  async disableAtProvider(
    sub: { id: string; providerSubscriptionCode: string | null; providerEmailToken: string | null },
    why: string,
  ): Promise<void> {
    if (!sub.providerSubscriptionCode || !sub.providerEmailToken || !this.provider.configured)
      return;
    try {
      await this.provider.disableSubscription(sub.providerSubscriptionCode, sub.providerEmailToken);
    } catch (err) {
      this.logger.error(
        { err, subscriptionId: sub.id, why },
        "Could not disable the subscription at the provider; reconciliation will see it",
      );
    }
  }

  // ---------------------------------------------------------------- refunds

  /**
   * Applies a processed refund: refund -> processed, payment refunded total (reversed when fully
   * refunded) and a `refund_reversal` taking back the payment's credits in proportion, all in one
   * transaction under the customer lock. Idempotent by refund status and ledger key.
   */
  async applyProcessedRefund(refundId: string): Promise<{ applied: boolean; units: number }> {
    const refund = await this.repo.refundById(refundId);
    if (!refund) return { applied: false, units: 0 };
    const payment = await this.repo.paymentById(refund.paymentId);
    if (!payment) return { applied: false, units: 0 };
    const customer = await this.repo.customerById(payment.billingCustomerId);
    if (!customer) return { applied: false, units: 0 };
    const now = new Date();
    const result = await this.credits.withLockedCustomer(
      customer.organizationId,
      async (tx, locked) => {
        const r = await this.repo.refundById(refundId, tx);
        const p = await this.repo.paymentById(refund.paymentId, tx);
        if (!r || !p || r.status === "processed") return null;
        const refundedAfter = p.refundedMinor + r.amountMinor;
        const completes = refundedAfter >= p.amountMinor;
        const granted = await this.repo.grantedUnits(p.id, tx);
        const alreadyReversed = p.refunds
          .filter((x) => x.status === "processed")
          .reduce((s, x) => s + (x.reversalUnits ?? 0), 0);
        const units = proportionalReversal({
          granted,
          paid: p.amountMinor,
          refunded: r.amountMinor,
          alreadyReversed,
          completesPayment: completes,
        });
        if (units > 0) {
          await this.credits.debitInTx(tx, locked, {
            units,
            key: `refund:${r.id}:reversal`,
            entryType: "refund_reversal",
            description: `Refund of ${formatMinor(r.amountMinor, r.currency)} on payment ${p.providerReference}: credits taken back`,
            referenceType: "refund",
            referenceId: r.id,
            referenceName: p.description,
            actorUserId: r.requestedByUserId,
          });
        }
        await this.repo.updateRefund(
          r.id,
          {
            status: "processed",
            processedAt: now,
            reversalUnits: units,
            providerStatus: "processed",
          },
          tx,
        );
        await this.repo.updatePayment(
          p.id,
          {
            refundedMinor: refundedAfter,
            ...(completes ? { status: "reversed", reversedAt: now } : {}),
          },
          tx,
        );
        await this.repo.audit(
          {
            billingCustomerId: customer.id,
            actorType: "provider",
            actorId: null,
            action: "refund.processed",
            before: {
              paymentStatus: p.status,
              refundedMinor: p.refundedMinor,
              balance: locked.balance + units,
            },
            after: {
              refundId: r.id,
              amountMinor: r.amountMinor,
              paymentStatus: completes ? "reversed" : p.status,
              unitsReversed: units,
              balance: locked.balance,
            },
          },
          tx,
        );
        return { units, amount: formatMinor(r.amountMinor, r.currency), payment: p };
      },
    );
    if (!result) return { applied: false, units: 0 };
    await this.audit.record({
      organizationId: customer.organizationId,
      actorUserId: null,
      actorType: "system",
      action: "billing.refund_updated",
      resourceType: "refund",
      resourceId: refundId,
      after: { status: "processed" },
    });
    await this.notifier.refundUpdated(customer.organizationId, {
      refundId,
      status: "processed",
      amount: result.amount,
      credits: result.units,
      reason: null,
    });
    return { applied: true, units: result.units };
  }

  async applyFailedRefund(refundId: string, reason: string | null): Promise<boolean> {
    const refund = await this.repo.refundById(refundId);
    if (!refund || refund.status !== "pending") return false;
    const payment = await this.repo.paymentById(refund.paymentId);
    const customer = payment ? await this.repo.customerById(payment.billingCustomerId) : null;
    if (!payment || !customer) return false;
    await this.repo.transaction(async (tx) => {
      await this.repo.updateRefund(
        refund.id,
        {
          status: "failed",
          failedAt: new Date(),
          failureReason: reason?.slice(0, 300) ?? null,
          providerStatus: "failed",
        },
        tx,
      );
      await this.repo.audit(
        {
          billingCustomerId: customer.id,
          actorType: "provider",
          actorId: null,
          action: "refund.failed",
          before: { status: "pending" },
          after: { refundId: refund.id, reason },
        },
        tx,
      );
    });
    await this.audit.record({
      organizationId: customer.organizationId,
      actorUserId: null,
      actorType: "system",
      action: "billing.refund_updated",
      resourceType: "refund",
      resourceId: refund.id,
      after: { status: "failed" },
    });
    await this.notifier.refundUpdated(customer.organizationId, {
      refundId: refund.id,
      status: "failed",
      amount: formatMinor(refund.amountMinor, refund.currency),
      credits: 0,
      reason,
    });
    return true;
  }

  /**
   * refund.* webhooks: finds our refund (by the provider refund id, else the payment's pending
   * refund) or records one started in the provider dashboard, then applies the status.
   */
  async onRefundEvent(
    status: "pending" | "processing" | "processed" | "failed",
    ev: {
      refundId: string | null;
      refundReference: string | null;
      transactionReference: string | null;
      amount: unknown;
      currency: string | null;
      status: string | null;
    },
  ): Promise<{ outcome: string }> {
    let refund: Refund | null = null;
    if (ev.refundId) refund = await this.repo.refundByProviderReference(ev.refundId);
    if (!refund && ev.refundReference)
      refund = await this.repo.refundByProviderReference(ev.refundReference);
    const payment = refund
      ? await this.repo.paymentById(refund.paymentId)
      : ev.transactionReference
        ? await this.repo.paymentByReference(ev.transactionReference)
        : null;
    if (!payment) return { outcome: "ignored: no payment for this refund" };
    let amount: bigint | null = null;
    try {
      amount = ev.amount === undefined || ev.amount === null ? null : paystackAmount(ev.amount);
    } catch {
      amount = null;
    }
    if (!refund) refund = await this.repo.pendingRefundFor(payment.id, amount);
    if (!refund) {
      if (payment.status !== "success")
        return { outcome: `ignored: refund of a payment that is ${payment.status}` };
      const left = payment.amountMinor - payment.refundedMinor;
      if (left <= 0n || (amount !== null && amount > left))
        return {
          outcome: "ignored: the refund exceeds what is left on the payment (already recorded?)",
        };
      // Started outside LeadForge (provider dashboard): record it so the ledger follows the money.
      refund = await this.repo.createRefund({
        id: newId(),
        paymentId: payment.id,
        providerRefundReference: ev.refundId ?? ev.refundReference ?? null,
        amountMinor: amount ?? payment.amountMinor - payment.refundedMinor,
        currency: (ev.currency ?? payment.currency).toUpperCase().slice(0, 3),
        status: "pending",
        reason: "Refund started in the Paystack dashboard",
        providerStatus: status,
      });
    } else if (!refund.providerRefundReference && (ev.refundId || ev.refundReference)) {
      refund = await this.repo.updateRefund(refund.id, {
        providerRefundReference: ev.refundId ?? ev.refundReference,
      });
    }
    if (status === "processed") {
      const r = await this.applyProcessedRefund(refund.id);
      return {
        outcome: r.applied ? `processed: ${r.units} credits reversed` : "already processed",
      };
    }
    if (status === "failed")
      return {
        outcome: (await this.applyFailedRefund(refund.id, ev.status)) ? "failed" : "already final",
      };
    if (refund.status === "pending")
      await this.repo.updateRefund(refund.id, { providerStatus: status });
    return { outcome: `refund ${status}` };
  }
}
