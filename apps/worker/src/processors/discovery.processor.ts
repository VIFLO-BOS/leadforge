import { Injectable } from "@nestjs/common";
import type { Job } from "bullmq";
import { DiscoveryQueueHandler, QueueNames } from "@leadforge/core";
import type { QueueProcessor } from "../worker.runtime.js";

/**
 * Discovery queue: `run-discovery-job` (orchestrator: start, cancel, timeout) and
 * `fetch-source-page` (one page or retry batch). The logic and the BullMQ handling (payload
 * validation, rate-limit delays, last-attempt bookkeeping) live in DiscoveryQueueHandler in
 * packages/core so the API test harness runs the same code.
 */
@Injectable()
export class DiscoveryProcessor implements QueueProcessor {
  readonly queueName = QueueNames.discovery;
  readonly concurrency = 4;

  constructor(private readonly handler: DiscoveryQueueHandler) {}

  process(job: Job, token?: string): Promise<unknown> {
    return this.handler.handle(job, token);
  }
}
