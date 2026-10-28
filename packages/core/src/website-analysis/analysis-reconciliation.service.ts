import { Injectable } from "@nestjs/common";
import { Logger } from "nestjs-pino";
import { CreditsService } from "../credits/credits.service.js";
import { QueueService } from "../queue/queue.service.js";
import { WebsiteAnalysisRunner } from "./website-analysis.runner.js";
import { WebsiteAnalysisRepository } from "./repositories/website-analysis.repository.js";

export interface AnalysisReconcileReport {
  timedOut: number;
  settled: number;
  requeued: number;
  orphanHoldsSettled: number;
  orphanHoldsReleased: number;
  errors: Array<{ ref: string; message: string }>;
}

const MINUTE = 60_000;

/**
 * Credit reconciliation for website analyses (runs in the 10-minute `reconcile-credits` pass):
 * analyses running for over 30 minutes are failed and released; finished analyses with
 * unsettled credits are settled; analyses queued for over 15 minutes are re-enqueued; ledger
 * holds older than 24 hours are settled against their analysis or released when it is missing.
 */
@Injectable()
export class AnalysisReconciliationService {
  constructor(
    private readonly analyses: WebsiteAnalysisRepository,
    private readonly runner: WebsiteAnalysisRunner,
    private readonly credits: CreditsService,
    private readonly queue: QueueService,
    private readonly logger: Logger,
  ) {}

  async run(
    now: Date = new Date(),
    options: {
      runningAfterMs?: number;
      unsettledAfterMs?: number;
      queuedAfterMs?: number;
      orphanAfterMs?: number;
    } = {},
  ): Promise<AnalysisReconcileReport> {
    const report: AnalysisReconcileReport = {
      timedOut: 0,
      settled: 0,
      requeued: 0,
      orphanHoldsSettled: 0,
      orphanHoldsReleased: 0,
      errors: [],
    };
    const attempt = async (ref: string, fn: () => Promise<void>) => {
      try {
        await fn();
      } catch (err) {
        report.errors.push({ ref, message: err instanceof Error ? err.message : String(err) });
      }
    };

    for (const a of await this.analyses.findStale(
      "running",
      new Date(now.getTime() - (options.runningAfterMs ?? 30 * MINUTE)),
      100,
    )) {
      await attempt(`analysis:${a._id.toHexString()}`, async () => {
        if (
          await this.runner.finalize(a.organizationId, a._id, {
            kind: "failed",
            code: "ANALYSIS_TIMEOUT",
            message:
              "The analysis ran longer than 30 minutes and was stopped; the credit was returned.",
          })
        ) {
          report.timedOut += 1;
        }
      });
    }
    for (const a of await this.analyses.findUnsettled(
      new Date(now.getTime() - (options.unsettledAfterMs ?? 5 * MINUTE)),
      200,
    )) {
      await attempt(`analysis:${a._id.toHexString()}`, async () => {
        await this.runner.settle(a.organizationId, a._id);
        report.settled += 1;
      });
    }
    for (const a of await this.analyses.findStale(
      "queued",
      new Date(now.getTime() - (options.queuedAfterMs ?? 15 * MINUTE)),
      100,
    )) {
      await attempt(`analysis:${a._id.toHexString()}`, async () => {
        await this.queue.enqueueAnalysis({
          organizationId: a.organizationId,
          analysisId: a._id.toHexString(),
        });
        await this.analyses.update(a.organizationId, a._id, { $set: { updatedAt: now } });
        report.requeued += 1;
      });
    }
    const holds = await this.credits.orphanHolds(
      new Date(now.getTime() - (options.orphanAfterMs ?? 24 * 60 * MINUTE)),
      200,
      { only: "website_analysis" },
    );
    for (const hold of holds) {
      await attempt(`hold:${hold.id}`, async () => {
        const analysis = hold.referenceId
          ? await this.analyses.findForHold(hold.organizationId, hold.referenceId)
          : null;
        if (analysis) {
          if (analysis.status === "queued" || analysis.status === "running") return; // live: keeps its hold
          await this.runner.settle(hold.organizationId, analysis._id);
          report.orphanHoldsSettled += 1;
          return;
        }
        await this.credits.releaseHold(hold.organizationId, {
          holdKey: hold.idempotencyKey,
          releaseKey: hold.idempotencyKey.replace(/:hold$/, ":release"),
          description:
            "Reconciliation: analysis hold older than 24 hours with no analysis; credit returned",
        });
        report.orphanHoldsReleased += 1;
      });
    }
    const fixed =
      report.timedOut +
      report.settled +
      report.requeued +
      report.orphanHoldsSettled +
      report.orphanHoldsReleased;
    if (fixed > 0 || report.errors.length > 0)
      this.logger.log(
        { ...report, errors: report.errors.length },
        "Website analysis reconciliation finished",
      );
    return report;
  }
}
