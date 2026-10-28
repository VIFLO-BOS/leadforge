import { z } from "zod";
import { IsoDateTime, ObjectIdString, UuidString } from "../common/ids.js";
import { CursorQuery } from "../common/pagination.js";
import { queryArray } from "../common/query.js";

/** Background job kinds on the all-jobs page. Phase 5 added `export` (async exports) and `bulk` (bulk operations). */
export const JobKind = z.enum(["discovery", "import", "analysis", "enrichment", "export", "bulk"]);
export type JobKind = z.infer<typeof JobKind>;

/**
 * Status normalized across kinds. Imports map `uploaded` to `draft`, `processing` to
 * `running` and `completed_with_errors` to `completed_with_warnings`; `kindStatus` keeps the original.
 */
export const JobStatus = z.enum([
  "draft",
  "queued",
  "running",
  "completed",
  "completed_with_warnings",
  "failed",
  "cancelled",
]);
export type JobStatus = z.infer<typeof JobStatus>;

export const JobSummary = z.object({
  id: ObjectIdString,
  kind: JobKind,
  name: z.string(),
  status: JobStatus,
  kindStatus: z.string(),
  progress: z.object({
    processed: z.number().int(),
    /** Known total (import rows); null when the total is not known in advance (discovery). */
    total: z.number().int().nullable(),
    failed: z.number().int(),
  }),
  createdByUserId: UuidString,
  createdAt: IsoDateTime,
  startedAt: IsoDateTime.nullable(),
  finishedAt: IsoDateTime.nullable(),
  /** Dashboard route for the job's detail page. */
  href: z.string(),
});
export type JobSummary = z.infer<typeof JobSummary>;

export const JobListQuery = z.object({
  kind: queryArray(JobKind, 6),
  status: queryArray(JobStatus, 7),
  ...CursorQuery.shape,
});
export type JobListQuery = z.infer<typeof JobListQuery>;
