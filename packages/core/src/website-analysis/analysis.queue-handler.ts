import { Injectable } from "@nestjs/common";
import { UnrecoverableError, type Job } from "bullmq";
import { Logger } from "nestjs-pino";
import { z } from "zod";
import { ObjectId } from "@leadforge/db-mongo";
import { ObjectIdString, UuidString } from "@leadforge/contracts";
import { AnalysisPayloadError, WebsiteAnalysisRunner } from "./website-analysis.runner.js";

const Payload = z.object({ organizationId: UuidString, analysisId: ObjectIdString });

/**
 * BullMQ glue for `website-analysis`, shared by apps/worker and the API test harness. A
 * malformed payload, or one naming an analysis outside its organization, fails without retries.
 * When the last attempt fails on our side, the analysis is failed and its credit released.
 */
@Injectable()
export class AnalysisQueueHandler {
  constructor(
    private readonly runner: WebsiteAnalysisRunner,
    private readonly logger: Logger,
  ) {}

  async handle(job: Job): Promise<unknown> {
    if (job.name !== "analyze-website")
      throw new UnrecoverableError(`Unknown website-analysis job ${job.name}`);
    const parsed = Payload.safeParse(job.data);
    if (!parsed.success) throw new UnrecoverableError("Invalid analyze-website payload");
    try {
      return await this.runner.run(parsed.data);
    } catch (err) {
      if (err instanceof AnalysisPayloadError) throw new UnrecoverableError(err.message);
      const maxAttempts = job.opts.attempts ?? 1;
      if (job.attemptsMade + 1 >= maxAttempts) {
        this.logger.error(
          { err, analysisId: parsed.data.analysisId },
          "Website analysis failed on its last attempt",
        );
        await this.runner.finalize(
          parsed.data.organizationId,
          new ObjectId(parsed.data.analysisId),
          {
            kind: "failed",
            code: "ANALYSIS_ERROR",
            message: "The analysis could not be completed after retries; the credit was returned.",
          },
        );
      }
      throw err;
    }
  }
}
