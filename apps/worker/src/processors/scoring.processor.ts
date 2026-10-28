import { Injectable } from "@nestjs/common";
import type { Job } from "bullmq";
import { ScoringQueueHandler, QueueNames } from "@leadforge/core";
import type { QueueProcessor } from "../worker.runtime.js";

/** Scoring (`recompute-scores`, `score-businesses`). The logic lives in ScoringQueueHandler (packages/core) so the API test harness runs the same code. */
@Injectable()
export class ScoringProcessor implements QueueProcessor {
  readonly queueName = QueueNames.scoring;
  readonly concurrency = 2;

  constructor(private readonly handler: ScoringQueueHandler) {}

  process(job: Job): Promise<unknown> {
    return this.handler.handle(job);
  }
}
