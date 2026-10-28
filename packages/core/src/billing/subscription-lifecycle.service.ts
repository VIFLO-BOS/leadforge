import { Inject, Injectable } from "@nestjs/common";
import { Logger } from "nestjs-pino";
import { newId, type SubscriptionStatus } from "@leadforge/db-postgres";
import { AuditService } from "../audit/audit.service.js";
import { EntitlementsService } from "../entitlements/entitlements.service.js";
import { BillingNotifier } from "./billing-notifier.js";
import { formatMinor } from "./money.js";
import { PAYMENT_PROVIDER, type PaymentProvider } from "./provider/payment-provider.js";
import { paystackAmount } from "./provider/paystack.provider.js";
import { PaystackEventData } from "./provider/paystack-events.js";
import { BillingRepository, type SubscriptionWithPlan } from "./repositories/billing.repository.js";
import { PaymentSettlementService } from "./payment-settlement.service.js";

type Json = Record<string, unknown>;

const day = (d: Date | null | undefined): string => (d ? d.toISOString().slice(0, 10) : "-");

/**
 * Subscription lifecycle: incomplete -> active (verified first payment) -> past_due (failed
 * renewal) -> cancelled (ended by the customer) or expired (unpaid past the grace period, or a
 * checkout that never completed). Driven by Paystack webhooks (subscription.*, invoice.*) and
 * the reconciliation pass; activation and renewals only ever follow a verified payment
 * (PaymentSettlementService). Every end recalculates entitlements in the same transaction.
 */
@Injectable()
export class SubscriptionLifecycleService {
  constructor(
    private readonly repo: BillingRepository,
    private readonly settlement: PaymentSettlementService,
    private readonly entitlements: EntitlementsService,
    @Inject(PAYMENT_PROVIDER) private readonly provider: PaymentProvider,
    private readonly notifier: BillingNotifier,
    private readonly audit: AuditService,
    private readonly logger: Logger,
  ) {}

  /**
   * Stage 10 (organization purge): stops every subscription of the organization that could still
   * charge. Renewal is disabled at Paystack first (when Paystack is configured, the provider knows
   * the subscription and renewal is still on); a provider error throws, so the purge step fails
   * and retries rather than leaving a live subscription behind. Locally each one ends as
   * `cancelled` with a billing_audit entry, and entitlements fall back to the free tier. No owner
   * notice is sent: the organization is being erased. Idempotent: ended subscriptions are skipped.
   */
  async cancelForErasure(
    organizationId: string,
  ): Promise<{
    subscriptions: number;
    providerDisabled: number;
    providerSkipped: number;
    providerConfigured: boolean;
  }> {
    const out = {
      subscriptions: 0,
      providerDisabled: 0,
      providerSkipped: 0,
      providerConfigured: this.provider.configured,
    };
    const customer = await this.repo.customerByOrg(organizationId);
    if (!customer) return out;
    for (const sub of await this.repo.renewableSubscriptions(customer.id)) {
      const renewing =
        (sub.status === "active" || sub.status === "past_due") && !sub.cancelAtPeriodEnd;
      if (renewing && sub.providerSubscriptionCode && sub.providerEmailToken) {
        if (this.provider.configured) {
          await this.provider.disableSubscription(
            sub.providerSubscriptionCode,
            sub.providerEmailToken,
          );
          out.providerDisabled += 1;
        } else {
          // Not configured here: nothing can charge through this server; recorded for operators.
          out.providerSkipped += 1;
          this.logger.warn(
            { subscriptionId: sub.id, organizationId },
            "Organization purge: Paystack is not configured, so renewal could not be disabled at the provider",
          );
        }
      }
      const now = new Date();
      const changed = await this.repo.transaction(async (tx) => {
        const ok = await this.repo.transitionSubscription(
          sub.id,
          ["active", "past_due", "incomplete"],
          {
            status: "cancelled",
            endedAt: now,
            cancelledAt: sub.cancelledAt ?? now,
            cancelAtPeriodEnd: true,
            ...(renewing && this.provider.configured && sub.providerSubscriptionCode
              ? { providerStatus: "non-renewing", lastSyncedAt: now }
              : {}),
          },
          tx,
        );
        if (!ok) return false;
        await this.entitlements.writeForPlanInTx(tx, sub.billingCustomerId, null, now);
        await this.repo.audit(
          {
            billingCustomerId: sub.billingCustomerId,
            actorType: "system",
            actorId: null,
            action: "subscription.cancelled",
            before: { status: sub.status },
            after: { status: "cancelled", why: "organization deleted" },
          },
          tx,
        );
        return true;
      });
      if (changed) out.subscriptions += 1;
    }
    return out;
  }

  /**
   * Ends a subscription (cancelled or expired) and recalculates entitlements from whatever live
   * subscription remains (or the free tier), in one transaction. Returns whether it changed.
   */
  async end(
    sub: SubscriptionWithPlan,
    to: Extract<SubscriptionStatus, "cancelled" | "expired">,
    why: string,
    actor: { type: "user" | "system" | "provider"; id: string | null } = {
      type: "system",
      id: null,
    },
  ): Promise<boolean> {
    const now = new Date();
    const changed = await this.repo.transaction(async (tx) => {
      const ok = await this.repo.transitionSubscription(
        sub.id,
        ["active", "past_due", "incomplete"],
        {
          status: to,
          endedAt: now,
          ...(to === "cancelled" ? { cancelledAt: sub.cancelledAt ?? now } : {}),
        },
        tx,
      );
      if (!ok) return false;
      if (sub.status !== "incomplete") {
        const remaining = await this.repo.liveSubscription(sub.billingCustomerId, tx);
        await this.entitlements.writeForPlanInTx(
          tx,
          sub.billingCustomerId,
          remaining?.plan ?? null,
          now,
        );
      }
      await this.repo.audit(
        {
          billingCustomerId: sub.billingCustomerId,
          actorType: actor.type,
          actorId: actor.id,
          action: `subscription.${to}`,
          before: { status: sub.status },
          after: { status: to, why },
        },
        tx,
      );
      return true;
    });
    if (!changed) return false;
    const customer = await this.repo.customerById(sub.billingCustomerId);
    if (customer && sub.status !== "incomplete") {
      await this.audit.record({
        organizationId: customer.organizationId,
        actorUserId: actor.type === "user" ? actor.id : null,
        actorType: actor.type === "user" ? "user" : "system",
        action: "billing.subscription_changed",
        resourceType: "subscription",
        resourceId: sub.id,
        after: { status: to },
      });
      await this.notifier.subscriptionChanged(customer.organizationId, {
        key: `${to}:${sub.id}`,
        title: to === "cancelled" ? `${sub.plan.name} plan ended` : `${sub.plan.name} plan expired`,
        body: `${why} Your organization is back on the free tier's limits; buy credits or choose a plan on the Billing page.`,
      });
    }
    return true;
  }

  /** Marks a live subscription past_due (failed renewal) and notifies once per invoice. */
  async markPastDue(
    sub: SubscriptionWithPlan,
    key: string,
    reason: string | null,
  ): Promise<boolean> {
    const now = new Date();
    const changed = await this.repo.transaction(async (tx) => {
      const ok = await this.repo.transitionSubscription(
        sub.id,
        ["active"],
        { status: "past_due", pastDueAt: now, providerStatus: "attention" },
        tx,
      );
      if (!ok) return false;
      await this.repo.audit(
        {
          billingCustomerId: sub.billingCustomerId,
          actorType: "provider",
          actorId: null,
          action: "subscription.past_due",
          before: { status: sub.status },
          after: { status: "past_due", reason },
        },
        tx,
      );
      return true;
    });
    const customer = await this.repo.customerById(sub.billingCustomerId);
    if (customer) {
      await this.notifier.paymentFailed(customer.organizationId, {
        key: `renewal:${key}`,
        what: `The renewal of your ${sub.plan.name} plan (${formatMinor(sub.plan.priceMinor, sub.plan.currency)}) failed`,
        reason,
        renewal: true,
      });
      if (changed) {
        await this.audit.record({
          organizationId: customer.organizationId,
          actorUserId: null,
          actorType: "system",
          action: "billing.subscription_changed",
          resourceType: "subscription",
          resourceId: sub.id,
          after: { status: "past_due" },
        });
      }
    }
    return changed;
  }

  // ---------------------------------------------------------------- webhook handlers

  /** subscription.create: links our subscription to Paystack's code and email token. */
  async onSubscriptionCreate(data: Json): Promise<string> {
    const code = PaystackEventData.subscriptionCode(data);
    if (!code) return "ignored: no subscription_code";
    const already = await this.repo.subscriptionByCode(code);
    if (already) return "already linked";
    const customerCode = PaystackEventData.customerCode(data);
    const customer = customerCode ? await this.repo.customerByProviderCode(customerCode) : null;
    if (!customer) return "ignored: unknown customer";
    const planCode = PaystackEventData.planCode(data);
    const plan = planCode ? await this.repo.planByProviderCode(planCode) : null;
    const sub = await this.repo.linkableSubscription(customer.id, plan?.id ?? null);
    if (!sub) return "ignored: no subscription to link";
    const next = PaystackEventData.nextPaymentDate(data);
    await this.repo.updateSubscription(sub.id, {
      providerSubscriptionCode: code,
      providerEmailToken: PaystackEventData.emailToken(data),
      providerStatus: PaystackEventData.status(data),
      lastSyncedAt: new Date(),
      // Paystack's next charge date is authoritative for the period end once the plan is active.
      ...(next && sub.status === "active" ? { currentPeriodEnd: next } : {}),
    });
    await this.repo.audit({
      billingCustomerId: customer.id,
      actorType: "provider",
      actorId: null,
      action: "subscription.linked",
      after: { subscriptionId: sub.id, code },
    });
    return "linked";
  }

  /** subscription.not_renew: the customer turned renewal off (e.g. on the Paystack manage page). */
  async onNotRenew(data: Json): Promise<string> {
    const sub = await this.byCode(data);
    if (!sub) return "ignored: unknown subscription";
    if (sub.cancelAtPeriodEnd) return "already non-renewing";
    await this.repo.updateSubscription(sub.id, {
      cancelAtPeriodEnd: true,
      providerStatus: PaystackEventData.status(data) ?? "non-renewing",
      lastSyncedAt: new Date(),
    });
    await this.repo.audit({
      billingCustomerId: sub.billingCustomerId,
      actorType: "provider",
      actorId: null,
      action: "subscription.not_renew",
      before: { cancelAtPeriodEnd: false },
      after: { cancelAtPeriodEnd: true },
    });
    const customer = await this.repo.customerById(sub.billingCustomerId);
    if (customer) {
      await this.notifier.subscriptionChanged(customer.organizationId, {
        key: `not-renew:${sub.id}`,
        title: `${sub.plan.name} plan will not renew`,
        body: `Renewal is off. The plan stays active until ${day(sub.currentPeriodEnd)}, then the free tier's limits apply.`,
      });
    }
    return "non-renewing";
  }

  /**
   * subscription.disable: no further charges. A subscription cancelled at period end stays
   * active until the period ends (reconciliation ends it then); otherwise it ends now.
   */
  async onDisable(data: Json): Promise<string> {
    const sub = await this.byCode(data);
    if (!sub) return "ignored: unknown subscription";
    const providerStatus = PaystackEventData.status(data) ?? "disabled";
    if (
      sub.status === "active" &&
      sub.cancelAtPeriodEnd &&
      sub.currentPeriodEnd &&
      sub.currentPeriodEnd > new Date()
    ) {
      await this.repo.updateSubscription(sub.id, { providerStatus, lastSyncedAt: new Date() });
      return "disabled at provider; active until the period ends";
    }
    if (sub.status === "active")
      return (await this.end(sub, "cancelled", "The subscription was cancelled at Paystack.", {
        type: "provider",
        id: null,
      }))
        ? "cancelled"
        : "already ended";
    if (sub.status === "past_due")
      return (await this.end(sub, "expired", "The unpaid subscription was disabled at Paystack.", {
        type: "provider",
        id: null,
      }))
        ? "expired"
        : "already ended";
    return "already ended";
  }

  /** invoice.payment_failed: renewal charge failed -> past_due (Paystack retries the charge). */
  async onInvoiceFailed(data: Json): Promise<string> {
    const sub = await this.byCode(data);
    const reference = PaystackEventData.transactionReference(data);
    if (reference) {
      const payment = await this.repo.paymentByReference(reference);
      if (payment && payment.status === "pending")
        await this.settlement
          .verifyAndSettle(payment.id, { trigger: "webhook" })
          .catch(() => undefined);
    }
    if (!sub) return "ignored: unknown subscription";
    if (sub.status !== "active" && sub.status !== "past_due")
      return `ignored: subscription is ${sub.status}`;
    const key = PaystackEventData.invoiceCode(data) ?? reference ?? `${sub.id}:${day(new Date())}`;
    await this.markPastDue(sub, key, PaystackEventData.status(data));
    return "past_due";
  }

  /** invoice.update: a paid renewal invoice settles its charge (verified like any payment). */
  async onInvoiceUpdate(data: Json, eventId: string): Promise<string> {
    const reference = PaystackEventData.transactionReference(data);
    const paid = PaystackEventData.paid(data) || PaystackEventData.status(data) === "success";
    if (!paid || !reference) return "ignored: invoice not paid";
    const res = await this.settlement.settleUnknownCharge(reference, {
      subscriptionCode: PaystackEventData.subscriptionCode(data),
      eventId,
    });
    const sub = await this.byCode(data);
    const next = PaystackEventData.nextPaymentDate(data);
    if (sub && next && sub.status === "active" && res.outcome === "granted")
      await this.repo.updateSubscription(sub.id, {
        currentPeriodEnd: next,
        lastSyncedAt: new Date(),
      });
    return `${res.outcome}${res.note ? `: ${res.note}` : ""}`;
  }

  /** charge.dispute.*: recorded and alerted; the payment shows as under review while open. */
  async onDispute(event: "create" | "remind" | "resolve", data: Json): Promise<string> {
    const d = PaystackEventData.dispute(data);
    if (!d.disputeId || !d.transactionReference)
      return "ignored: dispute without id or transaction";
    const payment = await this.repo.paymentByReference(d.transactionReference);
    if (!payment) return "ignored: dispute for an unknown payment";
    const customer = await this.repo.customerById(payment.billingCustomerId);
    if (!customer) return "ignored: no customer";
    let amount: bigint | null = null;
    try {
      amount = d.amount === undefined || d.amount === null ? null : paystackAmount(d.amount);
    } catch {
      amount = null;
    }
    const resolved = event === "resolve" || d.status === "resolved";
    const status = resolved
      ? "resolved"
      : d.status === "awaiting-bank-feedback"
        ? "awaiting_bank"
        : d.status === "awaiting-merchant-feedback"
          ? "awaiting_merchant"
          : "open";
    const existing = await this.repo.disputeByProviderId(d.disputeId);
    const now = new Date();
    await this.repo.upsertDispute(
      {
        id: newId(),
        billingCustomerId: customer.id,
        paymentId: payment.id,
        providerDisputeId: d.disputeId,
        status,
        providerStatus: d.status,
        resolution: d.resolution,
        amountMinor: amount,
        currency: d.currency?.toUpperCase().slice(0, 3) ?? null,
        reason: d.reason?.slice(0, 300) ?? null,
        dueAt: d.dueAt,
        resolvedAt: resolved ? now : null,
      },
      {
        status,
        providerStatus: d.status,
        resolution: d.resolution,
        ...(resolved ? { resolvedAt: now } : {}),
        ...(d.dueAt ? { dueAt: d.dueAt } : {}),
      },
    );
    // A successful payment shows as under review while a dispute is open (the flag never blocks
    // anything already settled); resolving the last open dispute clears it.
    if (!resolved && payment.status === "success" && !payment.flaggedAt) {
      await this.repo.updatePayment(payment.id, {
        flaggedAt: now,
        flagReason: `dispute_open: ${d.disputeId}`.slice(0, 300),
      });
    } else if (
      resolved &&
      payment.flagReason?.startsWith("dispute_open") &&
      (await this.repo.countOpenDisputes(payment.id)) === 0
    ) {
      await this.repo.updatePayment(payment.id, { flaggedAt: null, flagReason: null });
    }
    await this.repo.audit({
      billingCustomerId: customer.id,
      actorType: "provider",
      actorId: null,
      action: `dispute.${event}`,
      before: existing ? { status: existing.status } : null,
      after: { disputeId: d.disputeId, paymentId: payment.id, status, resolution: d.resolution },
    });
    await this.audit.record({
      organizationId: customer.organizationId,
      actorUserId: null,
      actorType: "system",
      action: existing ? "billing.dispute_updated" : "billing.dispute_opened",
      resourceType: "payment",
      resourceId: payment.id,
      after: { status },
    });
    if (!existing || event === "remind") {
      await this.notifier.attention(customer.organizationId, {
        key: `dispute:${d.disputeId}:${event}`,
        title: event === "remind" ? "A payment dispute needs a response" : "A payment was disputed",
        body: `The charge ${payment.providerReference} (${formatMinor(payment.amountMinor, payment.currency)}) was disputed with the card issuer${d.dueAt ? `; respond in the Paystack dashboard by ${day(d.dueAt)}` : ""}.`,
      });
    } else if (resolved) {
      await this.notifier.attention(customer.organizationId, {
        key: `dispute:${d.disputeId}:resolved`,
        title: "A payment dispute was resolved",
        body: `The dispute on ${payment.providerReference} was resolved${d.resolution ? ` (${d.resolution})` : ""}. If money was returned to the cardholder, the refund appears on the Billing page.`,
      });
    }
    return `dispute ${status}`;
  }

  private async byCode(data: Json): Promise<SubscriptionWithPlan | null> {
    const code = PaystackEventData.subscriptionCode(data);
    return code ? this.repo.subscriptionByCode(code) : null;
  }

  // ---------------------------------------------------------------- reconciliation

  /**
   * Subscriptions whose period ended without the event we expected: cancel-at-period-end ones
   * end; renewing ones are fetched from Paystack (a missed renewal charge is verified and settled,
   * a provider-side cancellation or failure is applied). Past-due ones expire after the grace
   * period; incomplete checkouts expire after the abandon window.
   */
  async reconcile(opts: {
    now: Date;
    graceDays: number;
    abandonAfterHours: number;
    limit: number;
  }): Promise<{
    checked: number;
    fixed: number;
    errors: Array<{ subscriptionId: string; error: string }>;
  }> {
    const errors: Array<{ subscriptionId: string; error: string }> = [];
    let checked = 0;
    let fixed = 0;
    const hour = 60 * 60 * 1000;

    for (const sub of await this.repo.subscriptionsEndedBefore(
      ["active"],
      opts.now,
      { cancelAtPeriodEnd: true },
      opts.limit,
    )) {
      checked++;
      if (
        await this.end(
          sub,
          "cancelled",
          `The plan was cancelled and its paid period ended on ${day(sub.currentPeriodEnd)}.`,
        )
      )
        fixed++;
    }

    for (const sub of await this.repo.subscriptionsEndedBefore(
      ["active"],
      new Date(opts.now.getTime() - hour),
      { cancelAtPeriodEnd: false },
      opts.limit,
    )) {
      checked++;
      try {
        if (!sub.providerSubscriptionCode || !this.provider.configured) {
          errors.push({
            subscriptionId: sub.id,
            error: "Period ended without a renewal and the subscription is not linked to Paystack",
          });
          continue;
        }
        const remote = await this.provider.fetchSubscription(sub.providerSubscriptionCode);
        await this.repo.updateSubscription(sub.id, {
          providerStatus: remote.status,
          lastSyncedAt: new Date(),
        });
        if (remote.status === "active" && remote.latestTransactionReference) {
          const res = await this.settlement.settleUnknownCharge(remote.latestTransactionReference, {
            subscriptionCode: sub.providerSubscriptionCode,
          });
          if (res.outcome === "granted") fixed++;
          else if (res.outcome !== "already_final")
            errors.push({
              subscriptionId: sub.id,
              error: `Renewal not settled: ${res.outcome}${res.note ? ` (${res.note})` : ""}`,
            });
          else if (
            remote.nextPaymentDate &&
            sub.currentPeriodEnd &&
            remote.nextPaymentDate > sub.currentPeriodEnd
          ) {
            await this.repo.updateSubscription(sub.id, {
              currentPeriodEnd: remote.nextPaymentDate,
            });
            fixed++;
          }
        } else if (remote.status === "attention") {
          if (
            await this.markPastDue(
              sub,
              `sync:${sub.id}:${day(sub.currentPeriodEnd)}`,
              "Paystack reports the renewal needs attention",
            )
          )
            fixed++;
        } else if (remote.status === "non-renewing") {
          await this.repo.updateSubscription(sub.id, { cancelAtPeriodEnd: true });
          if (
            await this.end(
              { ...sub, cancelAtPeriodEnd: true },
              "cancelled",
              "The plan was set not to renew and its period ended.",
            )
          )
            fixed++;
        } else if (
          remote.status === "complete" ||
          remote.status === "completed" ||
          remote.status === "cancelled"
        ) {
          if (await this.end(sub, "cancelled", "Paystack reports the subscription has ended."))
            fixed++;
        } else {
          errors.push({
            subscriptionId: sub.id,
            error: `Period ended; Paystack status ${remote.status} without a verifiable renewal`,
          });
        }
      } catch (err) {
        errors.push({
          subscriptionId: sub.id,
          error: err instanceof Error ? err.message.slice(0, 200) : String(err),
        });
      }
    }

    for (const sub of await this.repo.pastDueBefore(
      new Date(opts.now.getTime() - opts.graceDays * 24 * hour),
      opts.limit,
    )) {
      checked++;
      if (
        await this.end(
          sub,
          "expired",
          `No renewal payment succeeded within ${opts.graceDays} days.`,
        )
      ) {
        fixed++;
        await this.settlement.disableAtProvider(sub, "expired after the grace period");
      }
    }

    for (const sub of await this.repo.incompleteBefore(
      new Date(opts.now.getTime() - opts.abandonAfterHours * hour),
      opts.limit,
    )) {
      checked++;
      if (await this.end(sub, "expired", "The checkout was never completed.")) fixed++;
    }
    if (errors.length)
      this.logger.warn(
        { errors: errors.length },
        "Subscription reconciliation left items for review",
      );
    return { checked, fixed, errors };
  }
}
