import { Injectable } from "@nestjs/common";
import type { Job } from "bullmq";
import { BulkQueueHandler, QueueNames } from "@leadforge/core";
import type { QueueProcessor } from "../worker.runtime.js";

/** Bulk operations (`run-bulk-operation`): add to or remove from a list, assign, move stage, in chunks with per-business results. The logic lives in BulkQueueHandler (packages/core). */
@Injectable()
export class BulkProcessor implements QueueProcessor {
  readonly queueName = QueueNames.bulk;
  readonly concurrency = 2;

  constructor(private readonly handler: BulkQueueHandler) {}

  process(job: Job): Promise<unknown> {
    return this.handler.handle(job);
  }
}
