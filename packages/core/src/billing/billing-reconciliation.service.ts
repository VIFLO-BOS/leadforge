import { Inject, Injectable } from "@nestjs/common";
import { Logger } from "nestjs-pino";
import { newId } from "@leadforge/db-postgres";
import type { ServerEnv } from "@leadforge/contracts";
import { ENV } from "../config/env.module.js";
import { PAYMENT_PROVIDER, type PaymentProvider } from "./provider/payment-provider.js";
import { BillingRepository } from "./repositories/billing.repository.js";
import { PaymentSettlementService } from "./payment-settlement.service.js";
import { SubscriptionLifecycleService } from "./subscription-lifecycle.service.js";
import { WebhookService } from "./webhook.service.js";

const BATCH = 100;
/** Events still unprocessed this long after arrival are re-enqueued. */
const WEBHOOK_STUCK_MS = 5 * 60 * 1000;
const WEBHOOK_MAX_ATTEMPTS = 10;

export interface BillingReconciliationReport {
  payments: { checked: number; fixed: number; errors: number; flaggedForReview: number };
  webhooks: { checked: number; fixed: number; errors: number };
  subscriptions: { checked: number; fixed: number; errors: number };
}

/**
 * Billing reconciliation (billing queue, `reconcile-billing`, every 10 minutes). Each pass writes
 * a reconciliation_runs row:
 * - payments: pending payments older than BILLING_PENDING_VERIFY_AFTER_MINUTES are verified with
 *   Paystack and settled (granted, failed or abandoned); flagged ones are counted, never settled.
 * - webhooks: events stored but not processed (or failed with attempts left) are re-enqueued.
 * - subscriptions: periods that ended without the expected event (SubscriptionLifecycleService).
 * Orphan credit holds stay with `reconcile-credits` (kind `holds`).
 */
@Injectable()
export class BillingReconciliationService {
  constructor(
    private readonly repo: BillingRepository,
    private readonly settlement: PaymentSettlementService,
    private readonly lifecycle: SubscriptionLifecycleService,
    private readonly webhooks: WebhookService,
    @Inject(PAYMENT_PROVIDER) private readonly provider: PaymentProvider,
    private readonly logger: Logger,
    @Inject(ENV) private readonly env: ServerEnv,
  ) {}

  async run(now: Date = new Date()): Promise<BillingReconciliationReport> {
    const payments = await this.reconcilePayments(now);
    const webhooks = await this.reconcileWebhooks(now);
    const subscriptions = await this.reconcileSubscriptions(now);
    return { payments, webhooks, subscriptions };
  }

  async reconcilePayments(
    now: Date = new Date(),
  ): Promise<BillingReconciliationReport["payments"]> {
    const startedAt = new Date();
    const errors: Array<{ paymentId: string; error: string }> = [];
    let checked = 0;
    let fixed = 0;
    if (this.provider.configured) {
      const cutoff = new Date(
        now.getTime() - this.env.BILLING_PENDING_VERIFY_AFTER_MINUTES * 60 * 1000,
      );
      for (const p of await this.repo.pendingPaymentsBefore(cutoff, BATCH)) {
        checked++;
        try {
          const outcome = await this.settlement.verifyAndSettle(p.id, { trigger: "reconcile" });
          if (outcome === "granted" || outcome === "failed" || outcome === "abandoned") fixed++;
          if (outcome === "flagged")
            errors.push({
              paymentId: p.id,
              error: "Verification mismatch: flagged for review, nothing granted",
            });
        } catch (err) {
          errors.push({
            paymentId: p.id,
            error: err instanceof Error ? err.message.slice(0, 200) : String(err),
          });
        }
      }
    }
    const flaggedForReview = await this.repo.countFlaggedPending();
    await this.repo.recordRun({
      id: newId(),
      kind: "payments",
      startedAt,
      finishedAt: new Date(),
      checked,
      fixed,
      errors: flaggedForReview ? [...errors, { flaggedForReview }] : errors,
    });
    if (errors.length || flaggedForReview)
      this.logger.warn(
        { errors: errors.length, flaggedForReview },
        "Payment reconciliation needs attention",
      );
    return { checked, fixed, errors: errors.length, flaggedForReview };
  }

  async reconcileWebhooks(
    now: Date = new Date(),
  ): Promise<BillingReconciliationReport["webhooks"]> {
    const startedAt = new Date();
    const errors: Array<{ eventId: string; error: string }> = [];
    let fixed = 0;
    const stuck = await this.repo.stuckWebhookEvents(
      new Date(now.getTime() - WEBHOOK_STUCK_MS),
      WEBHOOK_MAX_ATTEMPTS,
      BATCH,
    );
    for (const e of stuck) {
      try {
        await this.webhooks.enqueue(e.id, e.attempts + 1);
        fixed++;
      } catch (err) {
        errors.push({
          eventId: e.id,
          error: err instanceof Error ? err.message.slice(0, 200) : String(err),
        });
      }
    }
    await this.repo.recordRun({
      id: newId(),
      kind: "webhooks",
      startedAt,
      finishedAt: new Date(),
      checked: stuck.length,
      fixed,
      errors,
    });
    return { checked: stuck.length, fixed, errors: errors.length };
  }

  async reconcileSubscriptions(
    now: Date = new Date(),
  ): Promise<BillingReconciliationReport["subscriptions"]> {
    const startedAt = new Date();
    const r = await this.lifecycle.reconcile({
      now,
      graceDays: this.env.BILLING_PAST_DUE_GRACE_DAYS,
      abandonAfterHours: this.env.BILLING_PENDING_ABANDON_AFTER_HOURS,
      limit: BATCH,
    });
    await this.repo.recordRun({
      id: newId(),
      kind: "subscriptions",
      startedAt,
      finishedAt: new Date(),
      checked: r.checked,
      fixed: r.fixed,
      errors: r.errors,
    });
    return { checked: r.checked, fixed: r.fixed, errors: r.errors.length };
  }
}
