import {
  BULK_CHANGE_OUTCOMES,
  BULK_LIMITS,
  type BulkAction,
  type BulkItemOutcome,
  type BulkOperation,
  type BulkStatus,
} from "@leadforge/contracts";
import type { JobState, StatusTone } from "@leadforge/ui";
import { isApiError } from "./api";
import { humanizeKey } from "./labels";

/*
 * Bulk operations (Phase 5): preview, confirm with an Idempotency-Key, then poll. Labels for
 * actions, statuses and per-business outcomes, the typed-phrase rule and error details.
 */

export const BULK_ACTION_LABELS: Partial<Record<BulkAction, string>> = {
  add_to_list: "Add to list",
  remove_from_list: "Remove from list",
  assign: "Assign",
  move_stage: "Move to stage",
};

export function bulkActionLabel(action: string): string {
  return BULK_ACTION_LABELS[action as BulkAction] ?? humanizeKey(action);
}

export type OutcomeGroup = "changed" | "unchanged" | "skipped" | "failed";

export const BULK_OUTCOME_META: Partial<
  Record<
    BulkItemOutcome,
    { label: string; tone: StatusTone; group: OutcomeGroup; description: string }
  >
> = {
  added: { label: "Added", tone: "success", group: "changed", description: "Added to the list." },
  removed: {
    label: "Removed",
    tone: "success",
    group: "changed",
    description: "Removed from the list.",
  },
  assigned: {
    label: "Assigned",
    tone: "success",
    group: "changed",
    description: "The lead was assigned.",
  },
  created_and_assigned: {
    label: "Added to pipeline and assigned",
    tone: "success",
    group: "changed",
    description: "A lead was created in the entry stage and assigned.",
  },
  moved: {
    label: "Moved",
    tone: "success",
    group: "changed",
    description: "The lead moved to the stage.",
  },
  unchanged: {
    label: "Already done",
    tone: "neutral",
    group: "unchanged",
    description: "Already in that list, already assigned to that member or already in that stage.",
  },
  not_found: {
    label: "Not found",
    tone: "warning",
    group: "skipped",
    description: "Deleted or merged since it was selected.",
  },
  suppressed: {
    label: "Suppressed",
    tone: "warning",
    group: "skipped",
    description: "Suppressed businesses are not added to lists or assigned.",
  },
  not_in_pipeline: {
    label: "Not in the pipeline",
    tone: "warning",
    group: "skipped",
    description: "Only businesses with a lead can change stage. Assign them first to add them.",
  },
  not_assigned_to_you: {
    label: "Not assigned to you",
    tone: "warning",
    group: "skipped",
    description: "Sales representatives move only the leads assigned to them.",
  },
  list_full: {
    label: "List full",
    tone: "warning",
    group: "skipped",
    description: "The list reached its limit of 10,000 businesses.",
  },
  failed: {
    label: "Failed",
    tone: "destructive",
    group: "failed",
    description: "An unexpected error on this business.",
  },
};

export function bulkOutcomeMeta(outcome: string) {
  return (
    BULK_OUTCOME_META[outcome as BulkItemOutcome] ?? {
      label: humanizeKey(outcome),
      tone: "neutral" as StatusTone,
      group: "skipped" as OutcomeGroup,
      description: "",
    }
  );
}

export function isChangeOutcome(outcome: string): boolean {
  return (BULK_CHANGE_OUTCOMES as readonly string[]).includes(outcome);
}

export const BULK_STATUS_LABELS: Partial<Record<BulkStatus, string>> = {
  queued: "Queued",
  running: "Running",
  completed: "Completed",
  completed_with_errors: "Completed with errors",
  failed: "Failed",
};

export function bulkJobState(status: string): JobState {
  switch (status) {
    case "queued":
      return "queued";
    case "running":
      return "running";
    case "completed":
      return "completed";
    case "completed_with_errors":
      return "completed_with_warnings";
    case "failed":
      return "failed";
    default:
      return "queued";
  }
}

export function isBulkActive(op: Pick<BulkOperation, "status">): boolean {
  return op.status === "queued" || op.status === "running";
}

export const BULK_POLL_MS = 1_500;

/** Selections at or above this size need the typed confirmation phrase. */
export const BULK_PHRASE_THRESHOLD = 100;

export const BULK_CAP = BULK_LIMITS.maxItems;

/** "ASSIGN 240": the phrase a large selection must type before confirming. */
export function bulkPhrase(action: BulkAction, count: number): string {
  const verb = {
    add_to_list: "ADD",
    remove_from_list: "REMOVE",
    assign: "ASSIGN",
    move_stage: "MOVE",
  }[action];
  return `${verb} ${count}`;
}

/** Why a whole operation failed (`error.code` on a failed BulkOperation). */
export function bulkFailureMessage(error: { code: string; message: string } | null): string {
  if (!error) return "The operation failed.";
  switch (error.code) {
    case "ACCESS_REVOKED":
      return "The person who started it no longer has access or the permission it needs, so it stopped.";
    case "LIST_DELETED":
      return "The list was deleted while the operation ran.";
    case "TIMED_OUT":
      return "The operation took too long and was stopped. Businesses already processed keep their changes.";
    default:
      return error.message || "The operation failed.";
  }
}

/** Matched and cap from a 422 BULK_LIMIT_EXCEEDED (`selection.matched`, `selection.cap`). */
export function bulkLimitDetails(err: unknown): { matched: number | null; cap: number } | null {
  if (!isApiError(err) || err.code !== "BULK_LIMIT_EXCEEDED") return null;
  const read = (path: string) => {
    const raw = err.details?.find((d) => d.path === path)?.message;
    const n = raw === undefined ? NaN : Number(raw);
    return Number.isFinite(n) ? n : null;
  };
  return { matched: read("selection.matched"), cap: read("selection.cap") ?? BULK_CAP };
}

/** Idempotency key for one confirmation: 8 to 128 of A-Z a-z 0-9 _ - . : (API contract). */
export function newIdempotencyKey(prefix: string): string {
  try {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
      return `${prefix}-${crypto.randomUUID()}`;
    }
  } catch {
    /* fall through */
  }
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}
