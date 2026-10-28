import { z } from "zod";
import { IsoDateTime, ObjectIdString, UuidString } from "../common/ids.js";
import { CursorQuery, sortQuery } from "../common/pagination.js";
import { queryArray, queryBoolean } from "../common/query.js";
import { FieldState } from "../businesses/fields.js";
import { BusinessListItem } from "../businesses/schemas.js";

/**
 * CRM (Phase 5): pipeline configuration, leads (pipeline state per business), lead lists,
 * activities and outreach records. Lead state is kept apart from the business's facts and from
 * its score (docs/PRODUCT_REQUIREMENTS.md section 4).
 */
export const CRM_LIMITS = {
  /** Businesses one lead list can hold. */
  listMaxItems: 10_000,
  /** Businesses per synchronous add or remove on a list; larger selections use bulk operations. */
  listItemsPerRequest: 100,
  /** Stages in a pipeline, archived ones included. */
  stagesMax: 20,
  /** Active (not archived) stages. */
  activeStagesMax: 12,
  stageLabelMax: 40,
  activityBodyMax: 5_000,
  /** Leads per stage on the board response. */
  boardPerStageMax: 50,
} as const;

// ---------------------------------------------------------------------------
// Pipeline configuration
// ---------------------------------------------------------------------------

/** Lowercase letters, digits and underscores; immutable once created. */
export const StageKey = z
  .string()
  .regex(/^[a-z][a-z0-9_]{0,39}$/, "Use lowercase letters, digits and underscores");
export type StageKey = z.infer<typeof StageKey>;

/** `won` and `lost` close a lead; each pipeline has exactly one of each, never archived. */
export const PipelineStageKind = z.enum(["open", "won", "lost"]);
export type PipelineStageKind = z.infer<typeof PipelineStageKind>;

export const PipelineStage = z.object({
  key: StageKey,
  label: z.string(),
  kind: PipelineStageKind,
  /** 0-based position on the board (archived stages keep theirs). */
  order: z.number().int(),
  archived: z.boolean(),
});
export type PipelineStage = z.infer<typeof PipelineStage>;

export const DEFAULT_PIPELINE_STAGES: ReadonlyArray<Pick<PipelineStage, "key" | "label" | "kind">> =
  [
    { key: "new", label: "New", kind: "open" },
    { key: "qualified", label: "Qualified", kind: "open" },
    { key: "contacted", label: "Contacted", kind: "open" },
    { key: "interested", label: "Interested", kind: "open" },
    { key: "opportunity", label: "Opportunity", kind: "open" },
    { key: "won", label: "Won", kind: "won" },
    { key: "lost", label: "Lost", kind: "lost" },
  ];

export const PipelineConfig = z.object({
  id: ObjectIdString,
  /** Optimistic-concurrency version; send it back on PUT. */
  version: z.number().int(),
  /** Every stage in board order, archived ones included. */
  stages: z.array(PipelineStage),
  /** New leads start here: the first active open stage. */
  entryStageKey: StageKey,
  updatedAt: IsoDateTime,
  updatedByUserId: UuidString.nullable(),
});
export type PipelineConfig = z.infer<typeof PipelineConfig>;

/**
 * `PUT /pipeline/config`: the full stage list in board order. A stage with `key` is an
 * existing one (rename, move, archive or restore); a stage without `key` is new (the key is
 * derived from the label). Existing stages cannot be removed (archive them), won and lost
 * cannot be archived or retyped, and a stage that still holds leads cannot be archived.
 */
export const UpdatePipelineConfigRequest = z.object({
  version: z.number().int().min(1),
  stages: z
    .array(
      z.object({
        key: StageKey.optional(),
        label: z.string().trim().min(1).max(CRM_LIMITS.stageLabelMax),
        archived: z.boolean().default(false),
      }),
    )
    .min(3)
    .max(CRM_LIMITS.stagesMax),
});
export type UpdatePipelineConfigRequest = z.infer<typeof UpdatePipelineConfigRequest>;

// ---------------------------------------------------------------------------
// Leads
// ---------------------------------------------------------------------------

export const LeadPriority = z.enum(["low", "medium", "high"]);
export type LeadPriority = z.infer<typeof LeadPriority>;

/** What a pipeline card shows about the business. Expired names are null. */
export const LeadBusiness = z.object({
  id: ObjectIdString,
  name: z.string().nullable(),
  nameState: FieldState,
  categories: z.array(z.string()),
  locality: z.string().nullable(),
  region: z.string().nullable(),
  /** Fit and data confidence, kept separate; null until scored. */
  fit: z.number().nullable(),
  dataConfidence: z.number().nullable(),
  suppressed: z.boolean(),
});
export type LeadBusiness = z.infer<typeof LeadBusiness>;

export const Lead = z.object({
  id: ObjectIdString,
  businessId: ObjectIdString,
  /** Null when the business was deleted or merged away. */
  business: LeadBusiness.nullable(),
  stageKey: StageKey,
  stageKind: PipelineStageKind,
  stageEnteredAt: IsoDateTime,
  /** Owner of the lead (an organization member who can work leads); null when unassigned. */
  assignedToUserId: UuidString.nullable(),
  priority: LeadPriority.nullable(),
  nextActionAt: IsoDateTime.nullable(),
  lastActivityAt: IsoDateTime.nullable(),
  lostReason: z.string().nullable(),
  wonValueMinor: z.number().int().nullable(),
  currency: z.string().nullable(),
  /** Set while the lead sits in a won or lost stage. */
  closedAt: IsoDateTime.nullable(),
  /** Optimistic-concurrency version; send it with moves and edits to refuse stale writes. */
  version: z.number().int(),
  createdByUserId: UuidString,
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type Lead = z.infer<typeof Lead>;

export const LEAD_SORT_FIELDS = ["updatedAt", "createdAt", "nextActionAt"] as const;

export const LeadListQuery = z.object({
  stage: queryArray(StageKey, CRM_LIMITS.stagesMax),
  assignedToUserId: UuidString.optional(),
  /** true: only leads without an owner. */
  unassigned: queryBoolean,
  priority: queryArray(LeadPriority, 3),
  businessId: ObjectIdString.optional(),
  /** Leads of businesses on this list. */
  listId: ObjectIdString.optional(),
  /** `field:asc|desc`; default `updatedAt:desc`. */
  sort: sortQuery(LEAD_SORT_FIELDS),
  ...CursorQuery.shape,
});
export type LeadListQuery = z.infer<typeof LeadListQuery>;

export const CreateLeadRequest = z.object({
  businessId: ObjectIdString,
  /** Defaults to the entry stage. Needs `pipeline:write`. */
  stageKey: StageKey.optional(),
  /** Needs `leads:assign` unless it is the caller (sales representatives always own the leads they add). */
  assignedToUserId: UuidString.nullable().optional(),
  priority: LeadPriority.optional(),
});
export type CreateLeadRequest = z.infer<typeof CreateLeadRequest>;

/**
 * `POST /pipeline/leads/:id/move`: one atomic stage change. Send `stageKey` for a specific
 * stage, or `direction` for the next or previous active stage in board order (keyboard
 * moves). With `version` the move is refused with 409 VERSION_CONFLICT when the lead changed
 * since it was read; without it the move applies to the current state.
 */
export const MoveLeadRequest = z
  .object({
    stageKey: StageKey.optional(),
    direction: z.enum(["next", "previous"]).optional(),
    version: z.number().int().min(1).optional(),
    /** Kept when moving to the lost stage. */
    lostReason: z.string().trim().max(500).optional(),
    /** Kept when moving to the won stage (minor units, e.g. kobo). */
    wonValueMinor: z.number().int().min(0).max(1e13).optional(),
    currency: z
      .string()
      .regex(/^[A-Z]{3}$/)
      .optional(),
  })
  .refine((v) => (v.stageKey === undefined) !== (v.direction === undefined), {
    message: "Send either stageKey or direction",
    path: ["stageKey"],
  });
export type MoveLeadRequest = z.infer<typeof MoveLeadRequest>;

export const UpdateLeadRequest = z
  .object({
    version: z.number().int().min(1).optional(),
    priority: LeadPriority.nullable().optional(),
    nextActionAt: IsoDateTime.nullable().optional(),
    lostReason: z.string().trim().max(500).nullable().optional(),
    wonValueMinor: z.number().int().min(0).max(1e13).nullable().optional(),
    currency: z
      .string()
      .regex(/^[A-Z]{3}$/)
      .nullable()
      .optional(),
  })
  .refine(
    (v) =>
      ["priority", "nextActionAt", "lostReason", "wonValueMinor", "currency"].some(
        (k) => (v as Record<string, unknown>)[k] !== undefined,
      ),
    { message: "Send at least one field to change" },
  );
export type UpdateLeadRequest = z.infer<typeof UpdateLeadRequest>;

/** `POST /pipeline/leads/:id/assign` (`leads:assign`). `null` unassigns. */
export const AssignLeadRequest = z.object({
  assignedToUserId: UuidString.nullable(),
  version: z.number().int().min(1).optional(),
});
export type AssignLeadRequest = z.infer<typeof AssignLeadRequest>;

export const PipelineBoardQuery = z.object({
  /** Leads returned per stage (newest activity first); page further with GET /pipeline/leads?stage=<key>. */
  perStage: z.coerce.number().int().min(1).max(CRM_LIMITS.boardPerStageMax).default(20),
  assignedToUserId: UuidString.optional(),
  unassigned: queryBoolean,
  /** Stage 8: only leads of businesses on this list (another organization's list is 404). Continue a column with GET /pipeline/leads?stage=&listId=. */
  listId: ObjectIdString.optional(),
  /** Also return archived stages that still hold leads. Default false. */
  includeArchived: queryBoolean,
});
export type PipelineBoardQuery = z.infer<typeof PipelineBoardQuery>;

export const PipelineBoard = z.object({
  config: PipelineConfig,
  columns: z.array(
    z.object({
      stage: PipelineStage,
      /** Leads in the stage matching the board filters. */
      count: z.number().int(),
      leads: z.array(Lead),
      /** Continue with GET /pipeline/leads?stage=<key>&sort=updatedAt:desc&cursor=<nextCursor> (same filters). */
      nextCursor: z.string().nullable(),
    }),
  ),
});
export type PipelineBoard = z.infer<typeof PipelineBoard>;

// ---------------------------------------------------------------------------
// Lead lists
// ---------------------------------------------------------------------------

export const LeadList = z.object({
  id: ObjectIdString,
  name: z.string(),
  description: z.string().nullable(),
  /** The member who owns the list. Sales representatives manage lists they own. */
  ownerUserId: UuidString,
  itemCount: z.number().int(),
  createdByUserId: UuidString,
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type LeadList = z.infer<typeof LeadList>;

export const LeadListListQuery = z.object({
  /** Name prefix, case-insensitive. */
  q: z.string().trim().max(80).optional(),
  ownerUserId: UuidString.optional(),
  /** Only lists that contain this business. */
  businessId: ObjectIdString.optional(),
  /** `name|updatedAt|createdAt:asc|desc`; default `updatedAt:desc`. */
  sort: sortQuery(["name", "updatedAt", "createdAt"] as const),
  ...CursorQuery.shape,
});
export type LeadListListQuery = z.infer<typeof LeadListListQuery>;

export const CreateLeadListRequest = z.object({
  name: z.string().trim().min(1).max(80),
  description: z.string().trim().max(500).nullable().optional(),
  /** Defaults to the caller. Only `lists:manage` may name someone else. */
  ownerUserId: UuidString.optional(),
});
export type CreateLeadListRequest = z.infer<typeof CreateLeadListRequest>;

export const UpdateLeadListRequest = z
  .object({
    name: z.string().trim().min(1).max(80).optional(),
    description: z.string().trim().max(500).nullable().optional(),
    ownerUserId: UuidString.optional(),
  })
  .refine(
    (v) => v.name !== undefined || v.description !== undefined || v.ownerUserId !== undefined,
    {
      message: "Send at least one field to change",
    },
  );
export type UpdateLeadListRequest = z.infer<typeof UpdateLeadListRequest>;

const uniqueIds = (ids: string[]) => new Set(ids.map((i) => i.toLowerCase())).size === ids.length;

export const ListItemsRequest = z.object({
  businessIds: z
    .array(ObjectIdString)
    .min(1)
    .max(
      CRM_LIMITS.listItemsPerRequest,
      `At most ${CRM_LIMITS.listItemsPerRequest} businesses per request; use a bulk operation for more`,
    )
    .refine(uniqueIds, "Each business can be listed once"),
});
export type ListItemsRequest = z.infer<typeof ListItemsRequest>;

/** A short lead reference on list rows. */
export const LeadRef = z.object({
  id: ObjectIdString,
  stageKey: StageKey,
  stageKind: PipelineStageKind,
  assignedToUserId: UuidString.nullable(),
});
export type LeadRef = z.infer<typeof LeadRef>;

export const LeadListItem = z.object({
  businessId: ObjectIdString,
  addedAt: IsoDateTime,
  addedByUserId: UuidString,
  /** The directory row; null when the business was deleted or merged away. */
  business: BusinessListItem.nullable(),
  lead: LeadRef.nullable(),
});
export type LeadListItem = z.infer<typeof LeadListItem>;

export const LeadListItemsQuery = CursorQuery;
export type LeadListItemsQuery = z.infer<typeof LeadListItemsQuery>;

/**
 * - added / removed: the list changed.
 * - already_in_list / not_in_list: nothing to do.
 * - not_found: no live business with this id in the organization.
 * - suppressed: the business is suppressed and is not added to lists.
 * - list_full: the list reached CRM_LIMITS.listMaxItems.
 */
export const ListItemOutcome = z.enum([
  "added",
  "already_in_list",
  "removed",
  "not_in_list",
  "not_found",
  "suppressed",
  "list_full",
]);
export type ListItemOutcome = z.infer<typeof ListItemOutcome>;

export const ListItemsResult = z.object({
  list: LeadList,
  results: z.array(z.object({ businessId: ObjectIdString, outcome: ListItemOutcome })),
  summary: z.object({
    requested: z.number().int(),
    changed: z.number().int(),
    unchanged: z.number().int(),
    notFound: z.number().int(),
    suppressed: z.number().int(),
    listFull: z.number().int(),
  }),
});
export type ListItemsResult = z.infer<typeof ListItemsResult>;

// ---------------------------------------------------------------------------
// Activities
// ---------------------------------------------------------------------------

/** `stage_change` and `assignment` are written by the system; the others are logged by people. */
export const ActivityType = z.enum([
  "note",
  "call",
  "whatsapp",
  "email",
  "meeting",
  "stage_change",
  "assignment",
]);
export type ActivityType = z.infer<typeof ActivityType>;

export const LoggableActivityType = z.enum(["note", "call", "whatsapp", "email", "meeting"]);
export type LoggableActivityType = z.infer<typeof LoggableActivityType>;

/** Activities that contact the business (suppression applies). */
export const CONTACT_ACTIVITY_TYPES: readonly LoggableActivityType[] = [
  "call",
  "whatsapp",
  "email",
  "meeting",
];

export const ActivityDirection = z.enum(["outbound", "inbound"]);
export type ActivityDirection = z.infer<typeof ActivityDirection>;

export const ActivityOutcome = z.enum([
  // calls
  "connected",
  "no_answer",
  "busy",
  "voicemail",
  "wrong_number",
  // messages and email
  "sent",
  "delivered",
  "read",
  "replied",
  "bounced",
  "failed",
  // meetings
  "completed",
  "no_show",
  "rescheduled",
  "cancelled",
  // any contact
  "interested",
  "not_interested",
  "callback_requested",
  "meeting_booked",
  "other",
]);
export type ActivityOutcome = z.infer<typeof ActivityOutcome>;

const ANY_CONTACT: ActivityOutcome[] = [
  "interested",
  "not_interested",
  "callback_requested",
  "meeting_booked",
  "other",
];

/** Outcomes each activity type accepts (notes take none). */
export const ACTIVITY_OUTCOMES: Record<LoggableActivityType, readonly ActivityOutcome[]> = {
  note: [],
  call: ["connected", "no_answer", "busy", "voicemail", "wrong_number", ...ANY_CONTACT],
  whatsapp: ["sent", "delivered", "read", "replied", "failed", ...ANY_CONTACT],
  email: ["sent", "replied", "bounced", "failed", ...ANY_CONTACT],
  meeting: ["completed", "no_show", "rescheduled", "cancelled", ...ANY_CONTACT],
};

/** A reason, kept on the record and audited, for logging contact with a suppressed business or contact. */
export const SuppressionOverride = z.object({ reason: z.string().trim().min(10).max(500) });
export type SuppressionOverride = z.infer<typeof SuppressionOverride>;

export const ActivityBusiness = z.object({
  id: ObjectIdString,
  name: z.string().nullable(),
  nameState: FieldState,
});
export type ActivityBusiness = z.infer<typeof ActivityBusiness>;

export const Activity = z.object({
  id: ObjectIdString,
  type: ActivityType,
  businessId: ObjectIdString,
  business: ActivityBusiness.nullable(),
  leadId: ObjectIdString.nullable(),
  outreachId: ObjectIdString.nullable(),
  direction: ActivityDirection.nullable(),
  outcome: ActivityOutcome.nullable(),
  /** Free text (note text or call notes). Render as text, never HTML. */
  body: z.string().nullable(),
  /** The phone number or email address contacted, when given. */
  target: z.string().nullable(),
  occurredAt: IsoDateTime,
  authorUserId: UuidString,
  stageChange: z.object({ fromStageKey: StageKey.nullable(), toStageKey: StageKey }).nullable(),
  assignment: z
    .object({ fromUserId: UuidString.nullable(), toUserId: UuidString.nullable() })
    .nullable(),
  suppressionOverride: z.object({ reason: z.string() }).nullable(),
  editedAt: IsoDateTime.nullable(),
  createdAt: IsoDateTime,
});
export type Activity = z.infer<typeof Activity>;

export const ActivityListQuery = z.object({
  type: queryArray(ActivityType, 7),
  /** Author. */
  userId: UuidString.optional(),
  businessId: ObjectIdString.optional(),
  leadId: ObjectIdString.optional(),
  /** Activities on businesses of this list. */
  listId: ObjectIdString.optional(),
  /** occurredAt range, inclusive. */
  from: IsoDateTime.optional(),
  to: IsoDateTime.optional(),
  ...CursorQuery.shape,
});
export type ActivityListQuery = z.infer<typeof ActivityListQuery>;

export const CreateActivityRequest = z.object({
  businessId: ObjectIdString,
  type: LoggableActivityType,
  body: z.string().trim().max(CRM_LIMITS.activityBodyMax).optional(),
  outcome: ActivityOutcome.optional(),
  /** Calls, WhatsApp and email; default outbound. */
  direction: ActivityDirection.optional(),
  /** Default now; at most 5 minutes in the future. */
  occurredAt: IsoDateTime.optional(),
  /** Phone number or email address contacted (checked against the suppression list). */
  target: z.string().trim().min(3).max(254).optional(),
  suppressionOverride: SuppressionOverride.optional(),
});
export type CreateActivityRequest = z.infer<typeof CreateActivityRequest>;

export const UpdateActivityRequest = z
  .object({
    body: z.string().trim().max(CRM_LIMITS.activityBodyMax).nullable().optional(),
    outcome: ActivityOutcome.nullable().optional(),
    occurredAt: IsoDateTime.optional(),
  })
  .refine((v) => v.body !== undefined || v.outcome !== undefined || v.occurredAt !== undefined, {
    message: "Send at least one field to change",
  });
export type UpdateActivityRequest = z.infer<typeof UpdateActivityRequest>;

// ---------------------------------------------------------------------------
// Outreach records
// ---------------------------------------------------------------------------

export const OutreachChannel = z.enum(["call", "whatsapp", "email"]);
export type OutreachChannel = z.infer<typeof OutreachChannel>;

export const OutreachStatus = z.enum([
  "planned",
  "in_progress",
  "replied",
  "no_response",
  "not_interested",
  "converted",
  "opted_out",
  "closed",
]);
export type OutreachStatus = z.infer<typeof OutreachStatus>;

/** One record per business and channel; logging an outbound call, WhatsApp or email adds an attempt. */
export const OutreachRecord = z.object({
  id: ObjectIdString,
  businessId: ObjectIdString,
  business: ActivityBusiness.nullable(),
  leadId: ObjectIdString.nullable(),
  channel: OutreachChannel,
  /** Last phone number or email address used. */
  target: z.string().nullable(),
  status: OutreachStatus,
  attempts: z.number().int(),
  lastAttemptAt: IsoDateTime.nullable(),
  lastOutcome: ActivityOutcome.nullable(),
  nextAttemptAt: IsoDateTime.nullable(),
  ownerUserId: UuidString,
  suppressionOverride: z
    .object({ reason: z.string(), byUserId: UuidString, at: IsoDateTime })
    .nullable(),
  version: z.number().int(),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type OutreachRecord = z.infer<typeof OutreachRecord>;

export const OutreachListQuery = z.object({
  channel: queryArray(OutreachChannel, 3),
  status: queryArray(OutreachStatus, 8),
  /** Owner. */
  userId: UuidString.optional(),
  businessId: ObjectIdString.optional(),
  listId: ObjectIdString.optional(),
  /** lastAttemptAt range, inclusive. */
  from: IsoDateTime.optional(),
  to: IsoDateTime.optional(),
  ...CursorQuery.shape,
});
export type OutreachListQuery = z.infer<typeof OutreachListQuery>;

export const CreateOutreachRequest = z.object({
  businessId: ObjectIdString,
  channel: OutreachChannel,
  target: z.string().trim().min(3).max(254).optional(),
  nextAttemptAt: IsoDateTime.nullable().optional(),
  suppressionOverride: SuppressionOverride.optional(),
});
export type CreateOutreachRequest = z.infer<typeof CreateOutreachRequest>;

export const UpdateOutreachRequest = z
  .object({
    version: z.number().int().min(1).optional(),
    status: OutreachStatus.optional(),
    nextAttemptAt: IsoDateTime.nullable().optional(),
    target: z.string().trim().min(3).max(254).nullable().optional(),
  })
  .refine(
    (v) => v.status !== undefined || v.nextAttemptAt !== undefined || v.target !== undefined,
    {
      message: "Send at least one field to change",
    },
  );
export type UpdateOutreachRequest = z.infer<typeof UpdateOutreachRequest>;

/** Logs one attempt on an outreach record: an activity of the record's channel. */
export const LogOutreachAttemptRequest = z.object({
  outcome: ActivityOutcome.optional(),
  body: z.string().trim().max(CRM_LIMITS.activityBodyMax).optional(),
  occurredAt: IsoDateTime.optional(),
  target: z.string().trim().min(3).max(254).optional(),
  suppressionOverride: SuppressionOverride.optional(),
});
export type LogOutreachAttemptRequest = z.infer<typeof LogOutreachAttemptRequest>;

export const LogOutreachAttemptResponse = z.object({
  outreach: OutreachRecord,
  activity: Activity,
});
export type LogOutreachAttemptResponse = z.infer<typeof LogOutreachAttemptResponse>;

export const CreateActivityResponse = z.object({
  activity: Activity,
  /** The outreach record the activity counted toward (outbound call, WhatsApp or email), else null. */
  outreach: OutreachRecord.nullable(),
});
export type CreateActivityResponse = z.infer<typeof CreateActivityResponse>;
