import { Injectable } from "@nestjs/common";
import type { Job } from "bullmq";
import { DedupQueueHandler, QueueNames } from "@leadforge/core";
import type { QueueProcessor } from "../worker.runtime.js";

/** Dedup (`find-duplicates`): candidate generation and scoring; it never merges. The logic lives in DedupQueueHandler (packages/core) so the API test harness runs the same code. */
@Injectable()
export class DedupProcessor implements QueueProcessor {
  readonly queueName = QueueNames.dedup;
  readonly concurrency = 2;

  constructor(private readonly handler: DedupQueueHandler) {}

  process(job: Job): Promise<unknown> {
    return this.handler.handle(job);
  }
}
