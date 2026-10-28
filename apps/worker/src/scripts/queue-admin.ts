/**
 * Operator tool for the BullMQ queues (docs/OPERATIONS.md, "Failed jobs and the dead-letter set").
 * Failed jobs stay in each queue's failed set for 14 days (DEFAULT_JOB_OPTIONS.removeOnFail); that
 * set is LeadForge's dead-letter queue. Reads REDIS_URL and QUEUE_PREFIX like the worker.
 *
 *   pnpm queue:admin counts
 *   pnpm queue:admin failed <queue> [limit]        newest failed jobs: id, name, attempts, reason, ids in the payload
 *   pnpm queue:admin retry <queue> <jobId|all>      move failed jobs back to waiting (processors are idempotent)
 *   pnpm queue:admin remove <queue> <jobId>         drop one failed job after it has been handled by hand
 *
 * Payloads are summarized, never printed whole: email jobs carry addresses and message bodies.
 */
import { Queue, type Job } from "bullmq";
import { Redis } from "ioredis";
import { QueueNames, queuePrefix, type QueueName } from "@leadforge/core";

const QUEUES = Object.values(QueueNames) as QueueName[];
const ID_KEYS = /(^organizationId$|Id$|^eventId$|^release$|^reason$|^round$|^source$|^trigger$)/;

function summarize(job: Job): Record<string, unknown> {
  const data = (job.data ?? {}) as Record<string, unknown>;
  const ids = Object.fromEntries(
    Object.entries(data).filter(
      ([k, v]) => ID_KEYS.test(k) && (typeof v === "string" || typeof v === "number"),
    ),
  );
  return {
    id: job.id,
    name: job.name,
    attemptsMade: job.attemptsMade,
    failedAt: job.finishedOn ? new Date(job.finishedOn).toISOString() : null,
    reason: String(job.failedReason ?? "")
      .slice(0, 300)
      .replace(/[^\s@]+@[^\s@]+/g, "[email]"),
    ...ids,
  };
}

async function main(): Promise<void> {
  const [command, queueArg, extra] = process.argv.slice(2);
  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl) throw new Error("REDIS_URL is not set");
  const prefix = queuePrefix(process.env);
  const connection = new Redis(redisUrl, { maxRetriesPerRequest: null });
  const open = (name: string): Queue => {
    if (!QUEUES.includes(name as QueueName))
      throw new Error(`Unknown queue ${name}; one of ${QUEUES.join(", ")}`);
    return new Queue(name, { connection, prefix });
  };
  const opened: Queue[] = [];
  try {
    if (command === "counts") {
      for (const name of QUEUES) {
        const q = open(name);
        opened.push(q);
        const counts = await q.getJobCounts(
          "waiting",
          "active",
          "delayed",
          "prioritized",
          "failed",
          "completed",
          "paused",
        );
        process.stdout.write(`${JSON.stringify({ queue: name, prefix, ...counts })}\n`);
      }
    } else if (command === "failed" && queueArg) {
      const q = open(queueArg);
      opened.push(q);
      const limit = Math.min(500, Math.max(1, Number(extra ?? 20)));
      for (const job of await q.getFailed(0, limit - 1))
        process.stdout.write(`${JSON.stringify(summarize(job))}\n`);
    } else if (command === "retry" && queueArg && extra) {
      const q = open(queueArg);
      opened.push(q);
      const jobs =
        extra === "all"
          ? await q.getFailed(0, 9999)
          : [await q.getJob(extra)].filter((j): j is Job => Boolean(j));
      let retried = 0;
      for (const job of jobs) {
        if ((await job.getState()) !== "failed") continue;
        await job.retry("failed");
        retried += 1;
      }
      process.stdout.write(`${JSON.stringify({ queue: queueArg, retried })}\n`);
    } else if (command === "remove" && queueArg && extra) {
      const q = open(queueArg);
      opened.push(q);
      const job = await q.getJob(extra);
      if (!job) throw new Error(`No job ${extra} in ${queueArg}`);
      if ((await job.getState()) !== "failed")
        throw new Error(`Job ${extra} is not failed; only failed jobs are removed by hand`);
      await job.remove();
      process.stdout.write(`${JSON.stringify({ queue: queueArg, removed: extra })}\n`);
    } else {
      process.stdout.write(
        "Usage: queue-admin counts | failed <queue> [limit] | retry <queue> <jobId|all> | remove <queue> <jobId>\n",
      );
      process.exitCode = 2;
    }
  } finally {
    for (const q of opened) await q.close();
    await connection.quit();
  }
}

main().catch((err: unknown) => {
  process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
