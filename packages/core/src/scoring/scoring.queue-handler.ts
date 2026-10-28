import { Injectable } from "@nestjs/common";
import { UnrecoverableError, type Job } from "bullmq";
import { z } from "zod";
import { ObjectIdString, UuidString } from "@leadforge/contracts";
import { ScoringService } from "./scoring.service.js";

const RecomputePayload = z.object({
  organizationId: UuidString,
  profileVersion: z.number().int().min(1),
});
const BusinessesPayload = z.object({
  organizationId: UuidString,
  businessIds: z.array(ObjectIdString).min(1).max(500),
});

/** BullMQ glue for `scoring` (`recompute-scores`, `score-businesses`), shared by the worker and tests. */
@Injectable()
export class ScoringQueueHandler {
  constructor(private readonly scoring: ScoringService) {}

  async handle(job: Job): Promise<unknown> {
    if (job.name === "recompute-scores") {
      const parsed = RecomputePayload.safeParse(job.data);
      if (!parsed.success) throw new UnrecoverableError("Invalid recompute-scores payload");
      try {
        return await this.scoring.recompute(parsed.data.organizationId, parsed.data.profileVersion);
      } catch (err) {
        if (job.attemptsMade + 1 >= (job.opts.attempts ?? 1)) {
          await this.scoring.markRecomputeFailed(
            parsed.data.organizationId,
            parsed.data.profileVersion,
            err instanceof Error ? err.message : String(err),
          );
        }
        throw err;
      }
    }
    if (job.name === "score-businesses") {
      const parsed = BusinessesPayload.safeParse(job.data);
      if (!parsed.success) throw new UnrecoverableError("Invalid score-businesses payload");
      return {
        scored: await this.scoring.scoreBusinesses(
          parsed.data.organizationId,
          parsed.data.businessIds,
        ),
      };
    }
    throw new UnrecoverableError(`Unknown scoring job ${job.name}`);
  }
}
