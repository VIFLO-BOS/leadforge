import { Injectable } from "@nestjs/common";
import { UnrecoverableError, type Job } from "bullmq";
import { z } from "zod";
import { ObjectIdString, UuidString } from "@leadforge/contracts";
import { DedupService } from "./dedup.service.js";

const Payload = z.object({
  organizationId: UuidString,
  businessIds: z.array(ObjectIdString).min(1).max(500).nullable(),
});

/** BullMQ glue for `dedup` (`find-duplicates`), shared by the worker and tests. */
@Injectable()
export class DedupQueueHandler {
  constructor(private readonly dedup: DedupService) {}

  async handle(job: Job): Promise<unknown> {
    if (job.name !== "find-duplicates")
      throw new UnrecoverableError(`Unknown dedup job ${job.name}`);
    const parsed = Payload.safeParse(job.data);
    if (!parsed.success) throw new UnrecoverableError("Invalid find-duplicates payload");
    return this.dedup.findCandidates(parsed.data.organizationId, parsed.data.businessIds);
  }
}
