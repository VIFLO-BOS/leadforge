import { Inject, Injectable, type OnApplicationShutdown, type OnModuleInit } from "@nestjs/common";
import { Worker, type Job } from "bullmq";
import type { Redis } from "ioredis";
import { Logger } from "nestjs-pino";
import type { ServerEnv } from "@leadforge/contracts";
import { createRedis, ENV, type QueueName } from "@leadforge/core";
import { MailProcessor } from "./processors/mail.processor.js";

export interface QueueProcessor {
  readonly queueName: QueueName;
  readonly concurrency: number;
  process(job: Job): Promise<unknown>;
}

const SHUTDOWN_GRACE_MS = 30_000;

/**
 * Starts one BullMQ Worker per registered processor, honoring the WORKER_QUEUES
 * allowlist so deployments can dedicate processes to specific workloads.
 */
@Injectable()
export class WorkerRuntime implements OnModuleInit, OnApplicationShutdown {
  private readonly workers: Worker[] = [];
  private readonly connection: Redis;

  constructor(
    @Inject(ENV) private readonly env: ServerEnv,
    private readonly logger: Logger,
    private readonly mail: MailProcessor,
  ) {
    this.connection = createRedis(env.REDIS_URL, "worker");
  }

  private processors(): QueueProcessor[] {
    return [this.mail];
  }

  onModuleInit(): void {
    const allow = new Set(this.env.WORKER_QUEUES);
    for (const processor of this.processors()) {
      if (allow.size > 0 && !allow.has(processor.queueName)) continue;
      const worker = new Worker(processor.queueName, (job) => processor.process(job), {
        connection: this.connection,
        concurrency: processor.concurrency,
        lockDuration: 60_000,
      });
      worker.on("failed", (job, err) => {
        this.logger.error(
          { queue: processor.queueName, jobId: job?.id, attempts: job?.attemptsMade, err },
          "Job failed",
        );
      });
      worker.on("error", (err) =>
        this.logger.error({ queue: processor.queueName, err }, "Worker error"),
      );
      this.workers.push(worker);
      this.logger.log(
        { queue: processor.queueName, concurrency: processor.concurrency },
        "Worker registered",
      );
    }
    if (this.workers.length === 0)
      this.logger.warn("No queues enabled for this worker; check WORKER_QUEUES");
  }

  async onApplicationShutdown(signal?: string): Promise<void> {
    this.logger.log({ signal }, "Worker shutting down; waiting for active jobs");
    const timeout = new Promise<void>((resolve) => setTimeout(resolve, SHUTDOWN_GRACE_MS));
    await Promise.race([Promise.all(this.workers.map((w) => w.close())), timeout]);
    await this.connection.quit().catch(() => this.connection.disconnect());
  }
}
