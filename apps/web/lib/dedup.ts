import {
  MERGE_UNDO_WINDOW_DAYS,
  type CandidateBusiness,
  type CandidateSignalKind,
  type DuplicateCandidate,
  type DuplicateCandidateStatus,
  type MergeFieldChoice,
} from "@leadforge/contracts";
import type { StatusTone } from "@leadforge/ui";
import { EXPIRED_NAME_LABEL } from "@leadforge/contracts";
import { humanizeKey } from "./labels";

/*
 * Duplicate review helpers. Nothing merges automatically: a candidate is a proposal with its
 * reasons, and every merge is a reviewer's decision that can be undone from the history.
 */

export const CANDIDATE_STATUS_META: Record<
  DuplicateCandidateStatus,
  { label: string; tone: StatusTone; description: string }
> = {
  pending: { label: "Pending review", tone: "info", description: "Waiting for a reviewer." },
  deferred: {
    label: "Deferred",
    tone: "neutral",
    description: "A reviewer chose to decide later.",
  },
  merged: { label: "Merged", tone: "success", description: "Merged into one record." },
  rejected: {
    label: "Not duplicates",
    tone: "neutral",
    description:
      "A reviewer said these are different businesses. The pair is never proposed again.",
  },
  superseded: {
    label: "Superseded",
    tone: "neutral",
    description: "One of the businesses was merged through another candidate.",
  },
};

export function candidateStatusMeta(status: string) {
  return (
    CANDIDATE_STATUS_META[status as DuplicateCandidateStatus] ?? {
      label: humanizeKey(status),
      tone: "neutral" as StatusTone,
      description: "",
    }
  );
}

const SIGNAL_LABELS: Partial<Record<CandidateSignalKind, string>> = {
  name_similarity: "Name similarity",
  shared_phone: "Same phone",
  shared_email: "Same email",
  shared_domain: "Same website domain",
  same_locality: "Same city or town",
  same_lga: "Same LGA",
};

export function signalLabel(kind: string): string {
  return SIGNAL_LABELS[kind as CandidateSignalKind] ?? humanizeKey(kind);
}

const STAGE_LABELS: Record<DuplicateCandidate["stage"], string> = {
  phone: "Shared phone",
  email: "Shared email",
  domain: "Shared website domain",
  name_location: "Similar name in the same place",
};

export function stageLabel(stage: string): string {
  return STAGE_LABELS[stage as DuplicateCandidate["stage"]] ?? humanizeKey(stage);
}

export function candidateName(b: Pick<CandidateBusiness, "name" | "nameState">): string {
  return b.name ?? (b.nameState === "expired" ? EXPIRED_NAME_LABEL : "Unnamed business");
}

/** "Mama Put Kitchen and Mama Put Kitchens" for titles and toasts. */
export function pairTitle(c: Pick<DuplicateCandidate, "businesses">): string {
  const [a, b] = c.businesses;
  if (!a || !b) return "Possible duplicate";
  return `${candidateName(a)} and ${candidateName(b)}`;
}

export const MERGE_FIELDS = ["name", "website", "location"] as const;
export type MergeField = (typeof MERGE_FIELDS)[number];

export const MERGE_FIELD_LABELS: Record<MergeField, string> = {
  name: "Name",
  website: "Website",
  location: "Location",
};

export function mergeFieldValue(b: CandidateBusiness, field: MergeField): string | null {
  if (field === "name") return b.name;
  if (field === "website") return b.website;
  return (
    b.location.formatted ??
    ([b.location.locality, b.location.region].filter(Boolean).join(", ") || null)
  );
}

/**
 * The API's default for a field: the survivor's value when it has one, else the other side's.
 * Shown preselected in the merge dialog so the reviewer sees exactly what will happen.
 */
export function defaultChoice(survivor: CandidateBusiness, field: MergeField): MergeFieldChoice {
  return mergeFieldValue(survivor, field) ? "survivor" : "merged";
}

/** Who may undo a merge (the API decides; this is the explanation shown next to the button). */
export const UNDO_RULE = `Owners and administrators can undo any merge. The person who merged can undo it within ${MERGE_UNDO_WINDOW_DAYS} days.`;

/** Queue views in the URL. "history" lists merges; the rest filter candidates by status. */
export const DEDUP_VIEWS = ["pending", "deferred", "merged", "rejected", "history"] as const;
export type DedupView = (typeof DEDUP_VIEWS)[number];

export function parseDedupView(params: URLSearchParams): DedupView {
  const v = params.get("view");
  return DEDUP_VIEWS.includes(v as DedupView) ? (v as DedupView) : "pending";
}

export function serializeDedupView(view: DedupView): URLSearchParams {
  return new URLSearchParams(view === "pending" ? {} : { view });
}
