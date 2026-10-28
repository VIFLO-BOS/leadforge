import { Injectable } from "@nestjs/common";
import { Collections, MongoService } from "@leadforge/db-mongo";
import { PrismaService } from "@leadforge/db-postgres";

export interface BillingHealth {
  paymentsByStatus: Record<string, number>;
  /** Pending payments older than the stuck threshold (reconciliation should have verified them). */
  stuckPayments: number;
  /** Payments flagged for review (verification mismatch or dispute); never granted while flagged. */
  flaggedPayments: number;
  webhookEventsByStatus: Record<string, number>;
  /** Webhook events not processed within the stale threshold. */
  staleWebhookEvents: number;
  negativeBalances: number;
  /** Credit units moved in the last 24 hours by ledger entry type. */
  ledgerUnits24h: Record<string, number>;
  /** Last finished reconciliation pass per kind (unix seconds) and its fixed count. */
  reconciliation: Array<{ kind: string; finishedAt: number; fixed: number; errors: number }>;
}

export interface JobsHealth {
  unsettledDiscoveryJobs: number;
  unsettledAnalyses: number;
  overture: {
    lastSuccessAt: number | null;
    lastRunStatus: string | null;
    failedLast7d: number;
    running: number;
  };
}

/**
 * Platform-level aggregate counts for the Prometheus endpoint (operations only). Like the
 * reconciliation queries it reads across organizations, but it returns counts and timestamps,
 * never organization data, ids or amounts per customer. Every query is served by an index
 * (payments status+initiated_at, webhook processing_status+received_at, ledger entry_type+
 * created_at; Mongo `credits.settledAt` and status/finishedAt on jobs).
 */
@Injectable()
export class OpsMetricsRepository {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mongo: MongoService,
  ) {}

  async billing(
    now: Date,
    thresholds: { stuckPaymentMinutes: number; staleWebhookMinutes: number },
  ): Promise<BillingHealth> {
    const stuckBefore = new Date(now.getTime() - thresholds.stuckPaymentMinutes * 60_000);
    const staleBefore = new Date(now.getTime() - thresholds.staleWebhookMinutes * 60_000);
    const dayAgo = new Date(now.getTime() - 24 * 60 * 60_000);
    const [payments, stuck, flagged, events, stale, negative, ledger, runs] = await Promise.all([
      this.prisma.payment.groupBy({ by: ["status"], _count: { _all: true } }),
      this.prisma.payment.count({
        where: { status: "pending", initiatedAt: { lt: stuckBefore }, flagReason: null },
      }),
      this.prisma.payment.count({ where: { flagReason: { not: null } } }),
      this.prisma.paymentWebhookEvent.groupBy({ by: ["processingStatus"], _count: { _all: true } }),
      this.prisma.paymentWebhookEvent.count({
        where: {
          processingStatus: { in: ["received", "failed"] },
          receivedAt: { lt: staleBefore },
        },
      }),
      this.prisma.billingCustomer.count({ where: { creditBalance: { lt: 0 } } }),
      this.prisma.creditLedger.groupBy({
        by: ["entryType"],
        where: { createdAt: { gte: dayAgo } },
        _sum: { units: true },
      }),
      this.prisma.reconciliationRun.findMany({
        where: { finishedAt: { not: null }, startedAt: { gte: dayAgo } },
        orderBy: { startedAt: "desc" },
        take: 200,
        select: { kind: true, finishedAt: true, fixed: true, errors: true },
      }),
    ]);
    const latest = new Map<
      string,
      { kind: string; finishedAt: number; fixed: number; errors: number }
    >();
    for (const r of runs) {
      if (latest.has(r.kind) || !r.finishedAt) continue;
      latest.set(r.kind, {
        kind: r.kind,
        finishedAt: Math.floor(r.finishedAt.getTime() / 1000),
        fixed: r.fixed,
        errors: Array.isArray(r.errors) ? r.errors.length : 0,
      });
    }
    return {
      paymentsByStatus: Object.fromEntries(payments.map((p) => [p.status, p._count._all])),
      stuckPayments: stuck,
      flaggedPayments: flagged,
      webhookEventsByStatus: Object.fromEntries(
        events.map((e) => [e.processingStatus, e._count._all]),
      ),
      staleWebhookEvents: stale,
      negativeBalances: negative,
      ledgerUnits24h: Object.fromEntries(
        ledger.map((l) => [l.entryType, Math.abs(l._sum.units ?? 0)]),
      ),
      reconciliation: [...latest.values()],
    };
  }

  async jobs(now: Date, unsettledAfterMinutes: number): Promise<JobsHealth> {
    const cutoff = new Date(now.getTime() - unsettledAfterMinutes * 60_000);
    const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60_000);
    const db = this.mongo.database;
    const [discovery, analyses, lastOk, lastRun, failed, running] = await Promise.all([
      db.collection(Collections.discoveryJobs).countDocuments({
        "credits.settledAt": null,
        status: { $in: ["completed", "completed_with_warnings", "failed", "cancelled"] },
        finishedAt: { $lt: cutoff },
      }),
      db.collection(Collections.websiteAnalyses).countDocuments({
        "credits.settledAt": null,
        status: { $in: ["completed", "failed"] },
        finishedAt: { $lt: cutoff },
      }),
      db
        .collection(Collections.overtureSyncRuns)
        .findOne(
          { status: { $in: ["completed", "completed_with_warnings"] } },
          { sort: { finishedAt: -1 }, projection: { finishedAt: 1 } },
        ),
      db
        .collection(Collections.overtureSyncRuns)
        .findOne({}, { sort: { startedAt: -1 }, projection: { status: 1 } }),
      db
        .collection(Collections.overtureSyncRuns)
        .countDocuments({ status: "failed", startedAt: { $gte: weekAgo } }),
      db.collection(Collections.overtureSyncRuns).countDocuments({ status: "running" }),
    ]);
    const finishedAt = lastOk?.finishedAt instanceof Date ? lastOk.finishedAt : null;
    return {
      unsettledDiscoveryJobs: discovery,
      unsettledAnalyses: analyses,
      overture: {
        lastSuccessAt: finishedAt ? Math.floor(finishedAt.getTime() / 1000) : null,
        lastRunStatus: typeof lastRun?.status === "string" ? lastRun.status : null,
        failedLast7d: failed,
        running,
      },
    };
  }
}
