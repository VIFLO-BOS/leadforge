import { Injectable } from "@nestjs/common";
import { Logger } from "nestjs-pino";
import { DISCOVERY_TERMINAL_STATUSES } from "@leadforge/contracts";
import { CreditsService } from "../credits/credits.service.js";
import { QueueService } from "../queue/queue.service.js";
import { DiscoveryRunner } from "./discovery.runner.js";
import { DiscoveryJobRepository } from "./repositories/discovery-job.repository.js";

export interface ReconcileReport {
  timedOut: number;
  settledJobs: number;
  requeued: number;
  orphanHoldsReleased: number;
  orphanHoldsSettled: number;
  checked: number;
  errors: Array<{ ref: string; message: string }>;
}

const MINUTE = 60_000;

/**
 * Reconciliation (repeatable every 10 minutes on the `billing` queue, ARCHITECTURE section 6):
 * 1. running jobs past their timeout are failed and settled;
 * 2. terminal jobs without `credits.settledAt`, finished more than 5 minutes ago, are settled;
 * 3. queued jobs whose start job was lost (15 minutes) are re-enqueued (idempotent ids);
 * 4. ledger holds older than 24 hours with no live job are settled against their job, or
 *    released in full when the job does not exist.
 * Each pass is recorded in reconciliation_runs (kind `holds`).
 */
@Injectable()
export class DiscoveryReconciliationService {
  constructor(
    private readonly jobs: DiscoveryJobRepository,
    private readonly runner: DiscoveryRunner,
    private readonly credits: CreditsService,
    private readonly queue: QueueService,
    private readonly logger: Logger,
  ) {}

  async run(
    now: Date = new Date(),
    options: {
      unsettledAfterMs?: number;
      orphanAfterMs?: number;
      stuckQueuedAfterMs?: number;
    } = {},
  ): Promise<ReconcileReport> {
    const startedAt = new Date();
    const report: ReconcileReport = {
      timedOut: 0,
      settledJobs: 0,
      requeued: 0,
      orphanHoldsReleased: 0,
      orphanHoldsSettled: 0,
      checked: 0,
      errors: [],
    };
    const attempt = async (ref: string, fn: () => Promise<void>) => {
      report.checked += 1;
      try {
        await fn();
      } catch (err) {
        report.errors.push({ ref, message: err instanceof Error ? err.message : String(err) });
      }
    };

    for (const j of await this.jobs.findTimedOut(now, 100)) {
      await attempt(`job:${j._id.toHexString()}`, async () => {
        const job = await this.jobs.findById(j.organizationId, j._id);
        if (!job) return;
        if (
          await this.runner.finalize(j.organizationId, j._id, job.round, {
            kind: "failed",
            code: "JOB_TIMEOUT",
            message: "The job ran longer than its time limit and was stopped.",
          })
        ) {
          report.timedOut += 1;
        }
      });
    }

    for (const j of await this.jobs.findUnsettled(
      new Date(now.getTime() - (options.unsettledAfterMs ?? 5 * MINUTE)),
      200,
    )) {
      await attempt(`job:${j._id.toHexString()}`, async () => {
        if ((await this.runner.settleAll(j.organizationId, j._id)) > 0) report.settledJobs += 1;
      });
    }

    for (const j of await this.jobs.findStuckQueued(
      new Date(now.getTime() - (options.stuckQueuedAfterMs ?? 15 * MINUTE)),
      100,
    )) {
      await attempt(`job:${j._id.toHexString()}`, async () => {
        await this.queue.enqueueDiscoveryRun({
          organizationId: j.organizationId,
          jobId: j._id.toHexString(),
          round: j.round,
          reason: "start",
        });
        report.requeued += 1;
      });
    }

    // Website analysis holds are reconciled by AnalysisReconciliationService.
    const holds = await this.credits.orphanHolds(
      new Date(now.getTime() - (options.orphanAfterMs ?? 24 * 60 * MINUTE)),
      200,
      { exclude: ["website_analysis"] },
    );
    for (const hold of holds) {
      await attempt(`hold:${hold.id}`, async () => {
        const job =
          hold.referenceType === "discovery_job" && hold.referenceId
            ? await this.jobs.findForHold(hold.organizationId, hold.referenceId)
            : null;
        const round = job?.credits.rounds.find((r) => r.holdKey === hold.idempotencyKey) ?? null;
        if (job && round) {
          const live =
            round.round === job.round && !DISCOVERY_TERMINAL_STATUSES.includes(job.status);
          if (live) return; // a live job keeps its hold
          if (!round.settledAt) {
            await this.runner.settle(hold.organizationId, job._id, round.round);
          } else {
            // Mongo says settled but the ledger hold is still open: repair the ledger with the recorded capture.
            await this.credits.settle(hold.organizationId, {
              holdKey: hold.idempotencyKey,
              captureKey: hold.idempotencyKey.replace(/:hold$/, ":capture"),
              releaseKey: hold.idempotencyKey.replace(/:hold$/, ":release"),
              capturedUnits: round.capturedUnits,
              description: "Reconciliation: settled from the job's recorded capture",
            });
          }
          report.orphanHoldsSettled += 1;
          return;
        }
        // No job owns this hold (for example the job insert failed after the hold): release all of it.
        await this.credits.releaseHold(hold.organizationId, {
          holdKey: hold.idempotencyKey,
          releaseKey: hold.idempotencyKey.endsWith(":hold")
            ? hold.idempotencyKey.replace(/:hold$/, ":release")
            : `${hold.idempotencyKey}:release`,
          description: "Reconciliation: hold older than 24 hours with no job; credits returned",
        });
        report.orphanHoldsReleased += 1;
      });
    }

    const fixed =
      report.timedOut +
      report.settledJobs +
      report.requeued +
      report.orphanHoldsReleased +
      report.orphanHoldsSettled;
    await this.credits
      .recordReconciliation({
        startedAt,
        finishedAt: new Date(),
        checked: report.checked,
        fixed,
        errors: report.errors,
      })
      .catch((err: unknown) =>
        this.logger.error({ err }, "Could not record the reconciliation run"),
      );
    if (fixed > 0 || report.errors.length > 0)
      this.logger.log({ ...report }, "Credit reconciliation finished");
    return report;
  }
}
