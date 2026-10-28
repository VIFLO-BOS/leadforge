import type { ObjectId } from "@leadforge/db-mongo";
import type {
  ActivityDirection,
  ActivityOutcome,
  ActivityType,
  BulkAction,
  BulkItemOutcome,
  BulkStatus,
  BusinessListFilter,
  LeadPriority,
  OutreachChannel,
  OutreachStatus,
  Permission,
  PipelineStageKind,
} from "@leadforge/contracts";

export interface PipelineStageDoc {
  key: string;
  label: string;
  kind: PipelineStageKind;
  order: number;
  archived: boolean;
}

export interface PipelineConfigDocument {
  _id: ObjectId;
  organizationId: string;
  version: number;
  stages: PipelineStageDoc[];
  createdAt: Date;
  updatedAt: Date;
  updatedByUserId: string | null;
}

export interface LeadDocument {
  _id: ObjectId;
  organizationId: string;
  businessId: ObjectId;
  stageKey: string;
  stageEnteredAt: Date;
  assignedToUserId: string | null;
  assignedAt: Date | null;
  priority: LeadPriority | null;
  nextActionAt: Date | null;
  lastActivityAt: Date | null;
  lostReason: string | null;
  wonValueMinor: number | null;
  currency: string | null;
  /** Set while the lead is in a won or lost stage. */
  closedAt: Date | null;
  closedKind: "won" | "lost" | null;
  version: number;
  createdByUserId: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface LeadListDocument {
  _id: ObjectId;
  organizationId: string;
  name: string;
  /** Lowercased, trimmed name: unique per organization and used for prefix search. */
  nameKey: string;
  description: string | null;
  ownerUserId: string;
  itemCount: number;
  createdByUserId: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface LeadListItemDocument {
  _id: ObjectId;
  organizationId: string;
  listId: ObjectId;
  businessId: ObjectId;
  addedByUserId: string;
  addedAt: Date;
}

export interface ActivityDocument {
  _id: ObjectId;
  organizationId: string;
  businessId: ObjectId;
  leadId: ObjectId | null;
  outreachId: ObjectId | null;
  type: ActivityType;
  direction: ActivityDirection | null;
  outcome: ActivityOutcome | null;
  body: string | null;
  target: string | null;
  occurredAt: Date;
  createdByUserId: string;
  createdAt: Date;
  editedAt: Date | null;
  stageChange: { fromStageKey: string | null; toStageKey: string } | null;
  assignment: { fromUserId: string | null; toUserId: string | null } | null;
  suppressionOverride: { reason: string } | null;
  /** The bulk operation that wrote this activity, if any. */
  bulkOperationId: ObjectId | null;
}

export interface OutreachDocument {
  _id: ObjectId;
  organizationId: string;
  businessId: ObjectId;
  leadId: ObjectId | null;
  channel: OutreachChannel;
  target: string | null;
  status: OutreachStatus;
  attempts: number;
  lastAttemptAt: Date | null;
  lastOutcome: ActivityOutcome | null;
  nextAttemptAt: Date | null;
  ownerUserId: string;
  suppressionOverride: { reason: string; byUserId: string; at: Date } | null;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface BulkOperationDocument {
  _id: ObjectId;
  organizationId: string;
  action: BulkAction;
  /** Display name for the jobs page, e.g. `Add 120 businesses to "Lagos pharmacies"`. */
  name: string;
  params: { listId: ObjectId | null; assignedToUserId: string | null; stageKey: string | null };
  selection: { kind: "ids" | "filter"; filter: BusinessListFilter | null };
  /** Resolved at creation: exactly these businesses are processed, in this order. */
  targetIds: ObjectId[];
  status: BulkStatus;
  progress: {
    total: number;
    processed: number;
    changed: number;
    unchanged: number;
    skipped: number;
    failed: number;
  };
  breakdown: Array<{ outcome: BulkItemOutcome; count: number }>;
  error: { code: string; message: string } | null;
  idempotencyKey: string;
  requestHash: string;
  requestedByUserId: string;
  createdAt: Date;
  updatedAt: Date;
  startedAt: Date | null;
  finishedAt: Date | null;
}

export interface BulkItemDocument {
  _id: ObjectId;
  organizationId: string;
  operationId: ObjectId;
  businessId: ObjectId;
  outcome: BulkItemOutcome;
  message: string | null;
  processedAt: Date;
  /** Results are kept 30 days (TTL). */
  expiresAt: Date;
}

/** Who is acting: the organization member and what their role allows. */
export interface CrmActor {
  userId: string;
  permissions: readonly Permission[];
}

export const can = (actor: CrmActor, permission: Permission) =>
  actor.permissions.includes(permission);

/**
 * Members who cannot assign leads (Sales Representatives) work only the leads assigned to them:
 * stage moves, edits, activities and outreach on other leads are refused.
 */
export const worksAssignedOnly = (actor: CrmActor) => !can(actor, "leads:assign");

/** Owners and administrators: may edit or delete anyone's activities and see every export. */
export const isManager = (actor: CrmActor) => can(actor, "members:manage");
