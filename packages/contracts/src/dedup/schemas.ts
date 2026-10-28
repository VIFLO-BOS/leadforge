import { z } from "zod";
import { IsoDateTime, ObjectIdString, UuidString } from "../common/ids.js";
import { CursorQuery } from "../common/pagination.js";
import { queryArray } from "../common/query.js";
import { FieldState, SourceKey } from "../businesses/fields.js";

/**
 * Duplicate review (dedup stages 4 to 6). Candidates come from name and location similarity
 * corroborated by a shared phone, email or domain, or the same locality or LGA. Similarity
 * never merges anything by itself: every merge is a reviewer's decision, and every merge can
 * be undone from its history.
 */
export const DuplicateCandidateStatus = z.enum([
  "pending",
  "deferred",
  "merged",
  "rejected",
  "superseded",
]);
export type DuplicateCandidateStatus = z.infer<typeof DuplicateCandidateStatus>;

export const CandidateSignalKind = z.enum([
  "name_similarity",
  "shared_phone",
  "shared_email",
  "shared_domain",
  "same_locality",
  "same_lga",
]);
export type CandidateSignalKind = z.infer<typeof CandidateSignalKind>;

export const CandidateSignal = z.object({
  kind: CandidateSignalKind,
  aValue: z.string().nullable(),
  bValue: z.string().nullable(),
  /** 0 to 1 for name similarity; 1 for an exact shared value. */
  similarity: z.number().min(0).max(1),
});
export type CandidateSignal = z.infer<typeof CandidateSignal>;

/** Side-by-side summary of one business in a candidate pair. */
export const CandidateBusiness = z.object({
  id: ObjectIdString,
  name: z.string().nullable(),
  nameState: FieldState,
  categories: z.array(z.string()),
  location: z.object({
    formatted: z.string().nullable(),
    locality: z.string().nullable(),
    lga: z.string().nullable(),
    region: z.string().nullable(),
  }),
  website: z.string().nullable(),
  /** E.164 numbers. */
  phones: z.array(z.string()),
  /**
   * The same numbers with a display format (international, e.g. "+234 803 123 4567"), in the
   * same order as `phones`. Always sent from Phase 6; typed optional so older clients compile.
   */
  phonesDisplay: z.array(z.object({ e164: z.string(), international: z.string() })).optional(),
  emails: z.array(z.string()),
  sources: z.array(SourceKey),
  suppressed: z.boolean(),
  /** False when the business was merged or deleted since the candidate was found. */
  live: z.boolean(),
  createdAt: IsoDateTime.nullable(),
});
export type CandidateBusiness = z.infer<typeof CandidateBusiness>;

export const DuplicateCandidate = z.object({
  id: ObjectIdString,
  businessIds: z.tuple([ObjectIdString, ObjectIdString]),
  businesses: z.array(CandidateBusiness),
  /** Strongest corroboration: a shared identifier, else location. */
  stage: z.enum(["phone", "email", "domain", "name_location"]),
  /** 0 to 1. */
  score: z.number().min(0).max(1),
  signals: z.array(CandidateSignal),
  /** Plain-language reasons, strongest first. */
  reasons: z.array(z.string()),
  status: DuplicateCandidateStatus,
  decidedByUserId: UuidString.nullable(),
  decidedAt: IsoDateTime.nullable(),
  mergeId: ObjectIdString.nullable(),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type DuplicateCandidate = z.infer<typeof DuplicateCandidate>;

export const DuplicateCandidateListQuery = z.object({
  /** Default: pending. */
  status: queryArray(DuplicateCandidateStatus, 5),
  businessId: ObjectIdString.optional(),
  minScore: z.coerce.number().min(0).max(1).optional(),
  ...CursorQuery.shape,
});
export type DuplicateCandidateListQuery = z.infer<typeof DuplicateCandidateListQuery>;

export const MergeFieldChoice = z.enum(["survivor", "merged"]);
export type MergeFieldChoice = z.infer<typeof MergeFieldChoice>;

/**
 * Accept a candidate: `survivorId` is one of the pair and keeps its id; the other is merged
 * into it. Single-valued fields default to the survivor's value (or the other's when the
 * survivor has none); phones, emails, socials, categories and sources are combined.
 */
export const MergeRequest = z
  .object({
    survivorId: ObjectIdString,
    fields: z
      .object({
        name: MergeFieldChoice.optional(),
        website: MergeFieldChoice.optional(),
        location: MergeFieldChoice.optional(),
      })
      .strict()
      .default({}),
  })
  .strict();
export type MergeRequest = z.infer<typeof MergeRequest>;
export type MergeRequestInput = z.input<typeof MergeRequest>;

export const MergeStatus = z.enum(["applied", "undone"]);
export type MergeStatus = z.infer<typeof MergeStatus>;

export const MergeRecord = z.object({
  id: ObjectIdString,
  candidateId: ObjectIdString.nullable(),
  survivorId: ObjectIdString,
  mergedIds: z.array(ObjectIdString),
  /**
   * Business names at merge time (from the merge snapshots), so history reads without extra
   * lookups. Null when a name was not stored or has expired under its source's retention.
   * Always sent from Phase 6; typed optional so older clients compile.
   */
  survivorName: z.string().nullable().optional(),
  mergedNames: z.array(z.object({ id: ObjectIdString, name: z.string().nullable() })).optional(),
  fieldDecisions: z.array(
    z.object({ field: z.enum(["name", "website", "location"]), chosenFrom: ObjectIdString }),
  ),
  status: MergeStatus,
  performedByUserId: UuidString,
  performedAt: IsoDateTime,
  undoneAt: IsoDateTime.nullable(),
  undoneByUserId: UuidString.nullable(),
  undoForced: z.boolean(),
  /** Whether the caller may undo now (performer within 30 days, or an owner or admin). */
  canUndo: z.boolean(),
});
export type MergeRecord = z.infer<typeof MergeRecord>;

export const MergeResponse = z.object({ merge: MergeRecord, candidate: DuplicateCandidate });
export type MergeResponse = z.infer<typeof MergeResponse>;

/** `force` restores the snapshots even if either record changed after the merge (those changes are discarded). */
export const UndoMergeRequest = z.object({ force: z.boolean().default(false) }).strict();
export type UndoMergeRequest = z.infer<typeof UndoMergeRequest>;

export const MergeListQuery = z.object({
  businessId: ObjectIdString.optional(),
  status: queryArray(MergeStatus, 2),
  ...CursorQuery.shape,
});
export type MergeListQuery = z.infer<typeof MergeListQuery>;

/** `POST /dedup/scan`: specific businesses, or the whole organization when omitted. */
export const DedupScanRequest = z
  .object({ businessIds: z.array(ObjectIdString).min(1).max(500).optional() })
  .strict();
export type DedupScanRequest = z.infer<typeof DedupScanRequest>;

export const DedupScanResponse = z.object({
  queued: z.boolean(),
  scope: z.enum(["businesses", "organization"]),
  businesses: z.number().int().nullable(),
});
export type DedupScanResponse = z.infer<typeof DedupScanResponse>;

/** Undo is open to the performer for this long; owners and admins can undo any merge. */
export const MERGE_UNDO_WINDOW_DAYS = 30;
