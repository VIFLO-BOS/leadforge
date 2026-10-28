import type { ObjectId } from "@leadforge/db-mongo";
import type { BusinessesService } from "../businesses/businesses.service.js";
import type { SourceOrgContext } from "../sources/source-adapter.js";

/**
 * The organization view a snapshot source uses to leave out places already in the directory.
 * `jobId` is the job asking: records it linked itself still count as new for it, so a page it
 * reprocesses after a crash yields the same records.
 */
export function sourceOrgContext(
  businesses: BusinessesService,
  organizationId: string,
  source: string,
  jobId: ObjectId | null,
): SourceOrgContext {
  return {
    organizationId,
    linkedAmong: (candidates) => businesses.linkedAmong(organizationId, source, candidates, jobId),
    linkedMatchKeys: (limit) => businesses.linkedMatchKeys(organizationId, source, limit),
  };
}
