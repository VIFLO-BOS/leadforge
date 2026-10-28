import { Gauge } from "prom-client";
import { QueueNames, type QueueName } from "../queue/queue.constants.js";
import type { QueueService } from "../queue/queue.service.js";
import type { MetricsService } from "./metrics.service.js";
import type {
  BillingHealth,
  JobsHealth,
  OpsMetricsRepository,
} from "./repositories/ops-metrics.repository.js";

/** Pending payments older than this are "stuck" (reconciliation verifies after 20 minutes by default). */
export const STUCK_PAYMENT_MINUTES = 60;
/** Webhook events unprocessed this long are stale (the worker normally takes seconds). */
export const STALE_WEBHOOK_MINUTES = 30;
/** Terminal jobs whose credits are unsettled this long are "unreconciled" (reconciliation runs every 10 minutes). */
export const UNSETTLED_JOB_MINUTES = 30;
/** Database gauges are computed at most this often, however often Prometheus scrapes. */
const CACHE_MS = 30_000;

const QUEUE_STATES = [
  "waiting",
  "active",
  "delayed",
  "prioritized",
  "waiting-children",
  "paused",
  "failed",
  "completed",
] as const;

/**
 * Platform health gauges, computed when Prometheus scrapes the API (cached 30 seconds): queue
 * depth per queue and state, and the billing, credit and job states the alert rules watch
 * (infra/monitoring/alerts.yml). Registered on the API's registry only, so replicas of the
 * worker do not multiply the database reads.
 */
export class OpsMetricsCollector {
  private cache: {
    at: number;
    queues: Array<[QueueName, Record<string, number>]>;
    billing: BillingHealth;
    jobs: JobsHealth;
  } | null = null;
  private inflight: Promise<NonNullable<OpsMetricsCollector["cache"]>> | null = null;

  constructor(
    metrics: MetricsService,
    private readonly repo: OpsMetricsRepository,
    private readonly queues: QueueService,
  ) {
    const registers = [metrics.registry];
    const snapshot = () => this.snapshot();
    const gauge = (
      name: string,
      help: string,
      labelNames: string[],
      fill: (g: Gauge<string>, snap: NonNullable<OpsMetricsCollector["cache"]>) => void,
    ) =>
      new Gauge({
        name,
        help,
        labelNames,
        registers,
        async collect() {
          const snap = await snapshot();
          this.reset();
          fill(this, snap);
        },
      });

    gauge("leadforge_queue_jobs", "BullMQ jobs per queue and state", ["queue", "state"], (g, s) => {
      for (const [queue, counts] of s.queues)
        for (const state of QUEUE_STATES) g.set({ queue, state }, counts[state] ?? 0);
    });
    gauge("leadforge_billing_payments", "Payments by status", ["status"], (g, s) => {
      for (const status of ["pending", "success", "failed", "reversed", "abandoned"])
        g.set({ status }, s.billing.paymentsByStatus[status] ?? 0);
    });
    gauge(
      "leadforge_billing_payments_stuck",
      `Pending payments older than ${STUCK_PAYMENT_MINUTES} minutes (not flagged)`,
      [],
      (g, s) => g.set(s.billing.stuckPayments),
    );
    gauge(
      "leadforge_billing_payments_flagged",
      "Payments flagged for review (verification mismatch or dispute)",
      [],
      (g, s) => g.set(s.billing.flaggedPayments),
    );
    gauge(
      "leadforge_billing_webhook_events",
      "Payment webhook events by processing status",
      ["status"],
      (g, s) => {
        for (const status of ["received", "processed", "ignored", "failed"])
          g.set({ status }, s.billing.webhookEventsByStatus[status] ?? 0);
      },
    );
    gauge(
      "leadforge_billing_webhook_events_stale",
      `Webhook events received or failed and not processed within ${STALE_WEBHOOK_MINUTES} minutes`,
      [],
      (g, s) => g.set(s.billing.staleWebhookEvents),
    );
    gauge(
      "leadforge_credits_negative_balances",
      "Organizations whose credit balance is below zero",
      [],
      (g, s) => g.set(s.billing.negativeBalances),
    );
    gauge(
      "leadforge_credits_ledger_units_24h",
      "Credit units moved in the last 24 hours by ledger entry type",
      ["type"],
      (g, s) => {
        for (const [type, units] of Object.entries(s.billing.ledgerUnits24h))
          g.set({ type }, units);
      },
    );
    gauge(
      "leadforge_reconciliation_last_run_timestamp_seconds",
      "When each reconciliation kind last finished (last 24 hours)",
      ["kind"],
      (g, s) => {
        for (const r of s.billing.reconciliation) g.set({ kind: r.kind }, r.finishedAt);
      },
    );
    gauge(
      "leadforge_reconciliation_last_run_fixed",
      "Items the latest pass of each reconciliation kind repaired",
      ["kind"],
      (g, s) => {
        for (const r of s.billing.reconciliation) g.set({ kind: r.kind }, r.fixed);
      },
    );
    gauge(
      "leadforge_reconciliation_last_run_errors",
      "Errors in the latest pass of each reconciliation kind",
      ["kind"],
      (g, s) => {
        for (const r of s.billing.reconciliation) g.set({ kind: r.kind }, r.errors);
      },
    );
    gauge(
      "leadforge_jobs_unsettled",
      `Finished jobs whose credits are still unsettled after ${UNSETTLED_JOB_MINUTES} minutes`,
      ["kind"],
      (g, s) => {
        g.set({ kind: "discovery" }, s.jobs.unsettledDiscoveryJobs);
        g.set({ kind: "analysis" }, s.jobs.unsettledAnalyses);
      },
    );
    gauge(
      "leadforge_overture_sync_last_success_timestamp_seconds",
      "When the last successful Overture sync finished (0 = never)",
      [],
      (g, s) => g.set(s.jobs.overture.lastSuccessAt ?? 0),
    );
    gauge(
      "leadforge_overture_sync_failed_runs_7d",
      "Overture sync runs that failed in the last 7 days",
      [],
      (g, s) => g.set(s.jobs.overture.failedLast7d),
    );
    gauge("leadforge_overture_sync_running", "Overture sync runs holding the lease", [], (g, s) =>
      g.set(s.jobs.overture.running),
    );
    gauge(
      "leadforge_overture_sync_last_run_failed",
      "1 when the most recent Overture sync run failed",
      [],
      (g, s) => g.set(s.jobs.overture.lastRunStatus === "failed" ? 1 : 0),
    );
  }

  private async snapshot(): Promise<NonNullable<OpsMetricsCollector["cache"]>> {
    if (this.cache && Date.now() - this.cache.at < CACHE_MS) return this.cache;
    this.inflight ??= this.load().finally(() => {
      this.inflight = null;
    });
    this.cache = await this.inflight;
    return this.cache;
  }

  private async load(): Promise<NonNullable<OpsMetricsCollector["cache"]>> {
    const now = new Date();
    const names = Object.values(QueueNames) as QueueName[];
    const [queues, billing, jobs] = await Promise.all([
      Promise.all(
        names.map(
          async (name) =>
            [name, await this.queues.queue(name).getJobCounts(...QUEUE_STATES)] as [
              QueueName,
              Record<string, number>,
            ],
        ),
      ),
      this.repo.billing(now, {
        stuckPaymentMinutes: STUCK_PAYMENT_MINUTES,
        staleWebhookMinutes: STALE_WEBHOOK_MINUTES,
      }),
      this.repo.jobs(now, UNSETTLED_JOB_MINUTES),
    ]);
    return { at: Date.now(), queues, billing, jobs };
  }
}
