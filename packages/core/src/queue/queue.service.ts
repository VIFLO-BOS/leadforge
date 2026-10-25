import { Inject, Injectable, type OnApplicationShutdown } from "@nestjs/common";
import { Queue, type JobsOptions } from "bullmq";
import type { Redis } from "ioredis";
import type { ServerEnv } from "@leadforge/contracts";
import { ENV } from "../config/env.module.js";
import { createRedis } from "../redis/redis.module.js";
import {
  DEFAULT_JOB_OPTIONS,
  QueueNames,
  type QueueName,
  type SendEmailJob,
} from "./queue.constants.js";

/**
 * Lazily creates BullMQ queues on a dedicated Redis connection. Producers only;
 * workers are created in apps/worker.
 */
@Injectable()
export class QueueService implements OnApplicationShutdown {
  private readonly connection: Redis;
  private readonly queues = new Map<QueueName, Queue>();

  constructor(@Inject(ENV) env: ServerEnv) {
    this.connection = createRedis(env.REDIS_URL, "queue-producer");
  }

  queue(name: QueueName): Queue {
    let q = this.queues.get(name);
    if (!q) {
      q = new Queue(name, { connection: this.connection, defaultJobOptions: DEFAULT_JOB_OPTIONS });
      this.queues.set(name, q);
    }
    return q;
  }

  async enqueueMail(job: SendEmailJob, options?: JobsOptions): Promise<string> {
    const added = await this.queue(QueueNames.mail).add("send-email", job, {
      jobId: `mail:${job.idempotencyKey}`,
      ...options,
    });
    return added.id ?? job.idempotencyKey;
  }

  async onApplicationShutdown(): Promise<void> {
    await Promise.all([...this.queues.values()].map((q) => q.close()));
    await this.connection.quit().catch(() => this.connection.disconnect());
  }
}
