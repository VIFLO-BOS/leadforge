import { Injectable } from "@nestjs/common";
import { DelayedError, UnrecoverableError, type Job } from "bullmq";
import { Logger } from "nestjs-pino";
import { z } from "zod";
import { DiscoverySourceKey, ObjectIdString, UuidString } from "@leadforge/contracts";
import type { FetchSourcePageJob, RunDiscoveryJob } from "../queue/queue.constants.js";
import { DiscoveryPayloadError, DiscoveryRunner, type RunResult } from "./discovery.runner.js";

const RunPayload = z.object({
  organizationId: UuidString,
  jobId: ObjectIdString,
  round: z.number().int().min(0),
  reason: z.enum(["start", "cancel", "timeout"]),
});

const PagePayload = z.object({
  organizationId: UuidString,
  jobId: ObjectIdString,
  round: z.number().int().min(0),
  source: DiscoverySourceKey,
  unit: z.string().regex(/^[a-z0-9_-]{1,80}$/),
  cursor: z.discriminatedUnion("kind", [
    z.object({
      kind: z.literal("search"),
      queryIndex: z.number().int().min(0).max(50),
      pageIndex: z.number().int().min(0).max(10),
      pageToken: z.string().max(4096).nullable(),
    }),
    z.object({
      kind: z.literal("items"),
      externalIds: z.array(z.string().min(1).max(512)).min(1).max(100),
    }),
  ]),
});

/**
 * BullMQ glue for the `discovery` queue, shared by apps/worker and the API test harness so
 * both run exactly the same code. Malformed payloads and payloads whose job is not in their
 * organization fail without retries (UnrecoverableError). A rate-limited page is moved back to
 * the delayed set (not counted as an attempt). After the last attempt of a page, the failure
 * is recorded on the job and its unit is finished so the job still ends and settles.
 */
@Injectable()
export class DiscoveryQueueHandler {
  constructor(
    private readonly runner: DiscoveryRunner,
    private readonly logger: Logger,
  ) {}

  async handle(job: Job, token?: string): Promise<RunResult> {
    if (job.name === "run-discovery-job") {
      const parsed = RunPayload.safeParse(job.data);
      if (!parsed.success) throw new UnrecoverableError("Invalid run-discovery-job payload");
      try {
        return await this.runner.run(parsed.data as RunDiscoveryJob);
      } catch (err) {
        if (err instanceof DiscoveryPayloadError) throw new UnrecoverableError(err.message);
        throw err;
      }
    }
    if (job.name === "fetch-source-page") {
      const parsed = PagePayload.safeParse(job.data);
      if (!parsed.success) throw new UnrecoverableError("Invalid fetch-source-page payload");
      const payload = parsed.data as FetchSourcePageJob;
      const maxAttempts = job.opts.attempts ?? 1;
      let result: RunResult;
      try {
        result = await this.runner.processUnit(payload, {
          attemptsMade: job.attemptsMade,
          maxAttempts,
        });
      } catch (err) {
        if (err instanceof DiscoveryPayloadError) throw new UnrecoverableError(err.message);
        if (job.attemptsMade + 1 >= maxAttempts) {
          this.logger.error(
            { err, jobId: payload.jobId, unit: payload.unit },
            "Discovery page failed on its last attempt",
          );
          await this.runner.failUnit(payload, err);
        }
        throw err;
      }
      if (result.status === "rate_limited") {
        if (!token) throw new Error("Rate-limited page without a worker token");
        await job.moveToDelayed(Date.now() + result.retryAfterMs, token);
        throw new DelayedError();
      }
      return result;
    }
    throw new UnrecoverableError(`Unknown discovery job ${job.name}`);
  }
}
