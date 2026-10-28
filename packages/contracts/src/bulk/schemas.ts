import { z } from "zod";
import { IsoDateTime, ObjectIdString, UuidString } from "../common/ids.js";
import { CursorQuery } from "../common/pagination.js";
import { queryArray } from "../common/query.js";
import { BusinessListFilter } from "../businesses/schemas.js";
import { FieldState } from "../businesses/fields.js";
import { StageKey } from "../crm/schemas.js";

/**
 * Bulk operations on businesses (Phase 5): preview the counts, confirm with an
 * Idempotency-Key, then poll. They run in the worker; results are per business.
 */
export const BULK_LIMITS = {
  /** Businesses one operation may touch (selected ids or matching the filter). */
  maxItems: 5_000,
  /** Ids per request body. */
  idsPerRequest: 1_000,
} as const;

export const BulkAction = z.enum(["add_to_list", "remove_from_list", "assign", "move_stage"]);
export type BulkAction = z.infer<typeof BulkAction>;

/**
 * Either `ids` (selected rows) or `filter` (the directory filters, same fields as
 * GET /businesses). The selection is resolved once, when the operation is created, so the
 * preview count is what runs and a retry never picks up new rows.
 */
export const BulkSelection = z
  .object({
    ids: z
      .array(ObjectIdString)
      .min(1)
      .max(BULK_LIMITS.idsPerRequest)
      .refine(
        (ids) => new Set(ids.map((i) => i.toLowerCase())).size === ids.length,
        "Each business can be listed once",
      )
      .optional(),
    filter: BusinessListFilter.optional(),
  })
  .refine((s) => (s.ids === undefined) !== (s.filter === undefined), {
    message: "Send either ids or filter",
    path: ["ids"],
  });
export type BulkSelection = z.infer<typeof BulkSelection>;

export const BulkOperationRequest = z.discriminatedUnion("action", [
  z.object({ action: z.literal("add_to_list"), listId: ObjectIdString, selection: BulkSelection }),
  z.object({
    action: z.literal("remove_from_list"),
    listId: ObjectIdString,
    selection: BulkSelection,
  }),
  /** `null` unassigns. Businesses without a lead get one in the entry stage. */
  z.object({
    action: z.literal("assign"),
    assignedToUserId: UuidString.nullable(),
    selection: BulkSelection,
  }),
  /** Moves existing leads only; businesses not in the pipeline are skipped. */
  z.object({ action: z.literal("move_stage"), stageKey: StageKey, selection: BulkSelection }),
]);
export type BulkOperationRequest = z.infer<typeof BulkOperationRequest>;

/**
 * - added, removed, assigned, created_and_assigned, moved: the business changed.
 * - unchanged: already in that state (in the list, assigned to that member, in that stage).
 * - not_found: not a live business of the organization (deleted or merged since selection).
 * - suppressed: suppressed businesses are not added to lists or assigned.
 * - not_in_pipeline: move_stage on a business without a lead.
 * - not_assigned_to_you: sales representatives only move leads assigned to them.
 * - list_full: the list reached its item limit.
 * - failed: an unexpected error on this business.
 */
export const BulkItemOutcome = z.enum([
  "added",
  "removed",
  "assigned",
  "created_and_assigned",
  "moved",
  "unchanged",
  "not_found",
  "suppressed",
  "not_in_pipeline",
  "not_assigned_to_you",
  "list_full",
  "failed",
]);
export type BulkItemOutcome = z.infer<typeof BulkItemOutcome>;

export const BULK_CHANGE_OUTCOMES: readonly BulkItemOutcome[] = [
  "added",
  "removed",
  "assigned",
  "created_and_assigned",
  "moved",
];

export const BulkOutcomeCount = z.object({ outcome: BulkItemOutcome, count: z.number().int() });
export type BulkOutcomeCount = z.infer<typeof BulkOutcomeCount>;

/** `POST /bulk-operations/preview`: what confirming would do, without changing anything. */
export const BulkPreview = z.object({
  action: BulkAction,
  /** Businesses the selection matches (live, in the organization). */
  matched: z.number().int(),
  cap: z.number().int(),
  /** True when matched > cap: confirming would fail with 422 BULK_LIMIT_EXCEEDED. */
  overCap: z.boolean(),
  /** Businesses that would change. */
  willChange: z.number().int(),
  /** Expected outcome per business, as counts (computed on at most `cap` businesses). */
  breakdown: z.array(BulkOutcomeCount),
});
export type BulkPreview = z.infer<typeof BulkPreview>;

export const BulkStatus = z.enum([
  "queued",
  "running",
  "completed",
  "completed_with_errors",
  "failed",
]);
export type BulkStatus = z.infer<typeof BulkStatus>;

export const BulkOperation = z.object({
  id: ObjectIdString,
  action: BulkAction,
  params: z.object({
    listId: ObjectIdString.nullable(),
    assignedToUserId: UuidString.nullable(),
    stageKey: StageKey.nullable(),
  }),
  status: BulkStatus,
  selection: z.object({ kind: z.enum(["ids", "filter"]), filter: BusinessListFilter.nullable() }),
  progress: z.object({
    total: z.number().int(),
    processed: z.number().int(),
    changed: z.number().int(),
    unchanged: z.number().int(),
    skipped: z.number().int(),
    failed: z.number().int(),
    /** 0 to 100. */
    percent: z.number().int(),
  }),
  breakdown: z.array(BulkOutcomeCount),
  error: z.object({ code: z.string(), message: z.string() }).nullable(),
  requestedByUserId: UuidString,
  createdAt: IsoDateTime,
  startedAt: IsoDateTime.nullable(),
  finishedAt: IsoDateTime.nullable(),
});
export type BulkOperation = z.infer<typeof BulkOperation>;

export const BulkOperationListQuery = z.object({
  status: queryArray(BulkStatus, 5),
  action: queryArray(BulkAction, 4),
  ...CursorQuery.shape,
});
export type BulkOperationListQuery = z.infer<typeof BulkOperationListQuery>;

export const BulkOperationItem = z.object({
  businessId: ObjectIdString,
  /**
   * Stage 8: the business's current name, read with the page (never stored on the item). Null
   * when the name expired under its source's terms (`businessNameState: "expired"`), when the
   * business has no name, or when it is not a business of this organization
   * (`businessNameState: null`, for example an id selected from another organization).
   * Optional for older fixtures; the API always sends it.
   */
  businessName: z.string().nullable().optional(),
  /** The name's field state as in directory rows (`states.name`); null when the business is not in this organization. */
  businessNameState: FieldState.nullable().optional(),
  outcome: BulkItemOutcome,
  message: z.string().nullable(),
  processedAt: IsoDateTime,
});
export type BulkOperationItem = z.infer<typeof BulkOperationItem>;

export const BulkOperationItemsQuery = z.object({
  outcome: queryArray(BulkItemOutcome, 12),
  ...CursorQuery.shape,
});
export type BulkOperationItemsQuery = z.infer<typeof BulkOperationItemsQuery>;
