import { Injectable } from "@nestjs/common";
import type { Job } from "bullmq";
import { EnrichmentQueueHandler, QueueNames } from "@leadforge/core";
import type { QueueProcessor } from "../worker.runtime.js";

/** Enrichment (`website-contacts`, `verify-contact`): website contacts and email checks. The logic lives in EnrichmentQueueHandler (packages/core) so the API test harness runs the same code. */
@Injectable()
export class EnrichmentProcessor implements QueueProcessor {
  readonly queueName = QueueNames.enrichment;
  readonly concurrency = 8;

  constructor(private readonly handler: EnrichmentQueueHandler) {}

  process(job: Job): Promise<unknown> {
    return this.handler.handle(job);
  }
}
