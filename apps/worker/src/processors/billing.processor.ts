import { Injectable } from "@nestjs/common";
import type { Job } from "bullmq";
import { Logger } from "nestjs-pino";
import {
  AnalysisReconciliationService,
  BillingQueueHandler,
  DiscoveryReconciliationService,
  MetricsService,
  QueueNames,
} from "@leadforge/core";
import type { QueueProcessor } from "../worker.runtime.js";

/**
 * Billing queue. `reconcile-credits` (repeatable, every 10 minutes): unsettled jobs and orphan
 * holds. Phase 6 (BillingQueueHandler in packages/core, so the API tests run the same code):
 * `process-webhook`, `verify-payment`, `generate-invoice-pdf` and `reconcile-billing`
 * (repeatable: stuck payments, unprocessed webhooks, subscriptions past their period).
 */
@Injectable()
export class BillingProcessor implements QueueProcessor {
  readonly queueName = QueueNames.billing;
  readonly concurrency = 2;

  constructor(
    private readonly reconciliation: DiscoveryReconciliationService,
    private readonly analyses: AnalysisReconciliationService,
    private readonly billing: BillingQueueHandler,
    private readonly logger: Logger,
    private readonly metrics: MetricsService,
  ) {}

  async process(job: Job): Promise<unknown> {
    if (this.billing.handles(job.name)) {
      if (job.name !== "reconcile-billing") return this.billing.handle(job);
      const result = await this.billing.handle(job).catch((err: unknown) => {
        this.metrics.recordReconciliation("billing", null, true);
        throw err;
      });
      this.metrics.recordReconciliation("billing", result);
      this.logger.log({ jobId: job.id, report: result }, "Billing reconciliation ran");
      return result;
    }
    if (job.name !== "reconcile-credits") throw new Error(`Unknown billing job ${job.name}`);
    let report: Awaited<ReturnType<DiscoveryReconciliationService["run"]>>;
    let analyses: Awaited<ReturnType<AnalysisReconciliationService["run"]>>;
    try {
      report = await this.reconciliation.run();
      analyses = await this.analyses.run();
    } catch (err) {
      this.metrics.recordReconciliation("credits", null, true);
      throw err;
    }
    this.metrics.recordReconciliation("credits", { discovery: report, analyses });
    this.logger.log(
      {
        jobId: job.id,
        ...report,
        errors: report.errors.length,
        analyses: { ...analyses, errors: analyses.errors.length },
      },
      "Credit reconciliation ran",
    );
    return { discovery: report, analyses };
  }
}
