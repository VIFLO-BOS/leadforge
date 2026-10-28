import { Injectable } from "@nestjs/common";
import type { Job } from "bullmq";
import { Logger } from "nestjs-pino";
import { ObjectIdString, UuidString } from "@leadforge/contracts";
import { ImportsService, QueueNames, type CommitImportJob } from "@leadforge/core";
import type { QueueProcessor } from "../worker.runtime.js";

/**
 * Commits a staged CSV import. The work lives in ImportsService.process, which resumes from
 * the first unprocessed row, so BullMQ retries never duplicate businesses. After the last
 * attempt fails the import is marked failed with the reason.
 */
@Injectable()
export class ImportProcessor implements QueueProcessor {
  readonly queueName = QueueNames.imports;
  readonly concurrency = 2;

  constructor(
    private readonly imports: ImportsService,
    private readonly logger: Logger,
  ) {}

  async process(job: Job<CommitImportJob>): Promise<unknown> {
    if (job.name !== "commit-import") throw new Error(`Unknown imports job ${job.name}`);
    const { organizationId, importId } = job.data;
    // Reject malformed payloads before touching any data.
    if (
      !UuidString.safeParse(organizationId).success ||
      !ObjectIdString.safeParse(importId).success
    ) {
      throw new Error("Invalid commit-import payload");
    }
    try {
      const result = await this.imports.process(organizationId, importId);
      this.logger.log(
        { jobId: job.id, organizationId, importId, status: result.status },
        "Import processed",
      );
      return result;
    } catch (err) {
      const attempts = job.opts.attempts ?? 1;
      if (job.attemptsMade + 1 >= attempts) {
        await this.imports.markFailed(
          organizationId,
          importId,
          "PROCESSING_FAILED",
          "The import stopped after repeated errors. Rows already processed were kept; contact support with the import id.",
        );
      }
      throw err;
    }
  }
}
