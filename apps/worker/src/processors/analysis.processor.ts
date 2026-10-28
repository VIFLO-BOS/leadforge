import { Injectable } from "@nestjs/common";
import type { Job } from "bullmq";
import { AnalysisQueueHandler, QueueNames } from "@leadforge/core";
import type { QueueProcessor } from "../worker.runtime.js";

/** Website analysis (`analyze-website`): SafeFetch crawl, detections, then credit capture or release. The logic lives in AnalysisQueueHandler (packages/core) so the API test harness runs the same code. */
@Injectable()
export class AnalysisProcessor implements QueueProcessor {
  readonly queueName = QueueNames.websiteAnalysis;
  readonly concurrency = 4;

  constructor(private readonly handler: AnalysisQueueHandler) {}

  process(job: Job): Promise<unknown> {
    return this.handler.handle(job);
  }
}
