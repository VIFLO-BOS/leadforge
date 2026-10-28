import { Injectable } from "@nestjs/common";
import type { Job } from "bullmq";
import { ExportQueueHandler, OrganizationExportQueueHandler, QueueNames } from "@leadforge/core";
import type { QueueProcessor } from "../worker.runtime.js";

/**
 * Async exports (`build-export`): rows in pages, ZIP with CSV, attribution and licences, object
 * storage. Stage 10: whole-organization data exports (`build-organization-export`). The logic lives
 * in packages/core (ExportQueueHandler, OrganizationExportQueueHandler) so the API test harness
 * runs the same code.
 */
@Injectable()
export class ExportProcessor implements QueueProcessor {
  readonly queueName = QueueNames.exports;
  readonly concurrency = 2;

  constructor(
    private readonly handler: ExportQueueHandler,
    private readonly organizationExports: OrganizationExportQueueHandler,
  ) {}

  process(job: Job): Promise<unknown> {
    return job.name === "build-organization-export"
      ? this.organizationExports.handle(job)
      : this.handler.handle(job);
  }
}
