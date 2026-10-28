import { Injectable } from "@nestjs/common";
import { UnrecoverableError, type Job } from "bullmq";
import { Logger } from "nestjs-pino";
import { z } from "zod";
import { ObjectId } from "@leadforge/db-mongo";
import { ObjectIdString, UuidString } from "@leadforge/contracts";
import { EnrichmentPayloadError, EnrichmentRunner } from "./enrichment.runner.js";

const Payload = z.object({ organizationId: UuidString, runId: ObjectIdString });

/** BullMQ glue for `enrichment` (`website-contacts`, `verify-contact`), shared by the worker and tests. */
@Injectable()
export class EnrichmentQueueHandler {
  constructor(
    private readonly runner: EnrichmentRunner,
    private readonly logger: Logger,
  ) {}

  async handle(job: Job): Promise<unknown> {
    if (job.name !== "website-contacts" && job.name !== "verify-contact")
      throw new UnrecoverableError(`Unknown enrichment job ${job.name}`);
    const parsed = Payload.safeParse(job.data);
    if (!parsed.success) throw new UnrecoverableError("Invalid enrichment payload");
    try {
      return await this.runner.run(parsed.data);
    } catch (err) {
      if (err instanceof EnrichmentPayloadError) throw new UnrecoverableError(err.message);
      if (job.attemptsMade + 1 >= (job.opts.attempts ?? 1)) {
        this.logger.error(
          { err, runId: parsed.data.runId },
          "Enrichment run failed on its last attempt",
        );
        await this.runner.finalize(parsed.data.organizationId, new ObjectId(parsed.data.runId), {
          kind: "failed",
          code: "ENRICHMENT_ERROR",
          message: "The run could not be completed after retries.",
        });
      }
      throw err;
    }
  }
}
