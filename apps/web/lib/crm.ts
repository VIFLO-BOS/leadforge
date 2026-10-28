import {
  ACTIVITY_OUTCOMES,
  CONTACT_ACTIVITY_TYPES,
  EXPIRED_NAME_LABEL,
  type Activity,
  type ActivityOutcome,
  type ActivityType,
  type Lead,
  type LeadPriority,
  type LoggableActivityType,
  type OutreachChannel,
  type OutreachStatus,
  type PipelineConfig,
  type PipelineStage,
} from "@leadforge/contracts";
import type { StatusTone } from "@leadforge/ui";
import { isApiError } from "./api";
import { humanizeKey } from "./labels";

/*
 * CRM helpers (Phase 5): labels for activity types, outcomes, outreach channels and statuses,
 * stage navigation on the pipeline configuration, and error helpers for the CRM error codes.
 * Label maps keyed by API enums are Partial with a readable fallback, so a value added later
 * renders instead of breaking the build.
 */

export const ACTIVITY_TYPE_LABELS: Partial<Record<ActivityType, string>> = {
  note: "Note",
  call: "Call",
  whatsapp: "WhatsApp message",
  email: "Email",
  meeting: "Meeting",
  stage_change: "Stage change",
  assignment: "Assignment",
};

export function activityTypeLabel(type: string): string {
  return ACTIVITY_TYPE_LABELS[type as ActivityType] ?? humanizeKey(type);
}

/** Activity types people log, in the order the log dialog offers them. */
export const LOGGABLE_TYPES: readonly LoggableActivityType[] = [
  "note",
  "call",
  "whatsapp",
  "email",
  "meeting",
];

export const OUTCOME_LABELS: Partial<Record<ActivityOutcome, string>> = {
  connected: "Connected",
  no_answer: "No answer",
  busy: "Line busy",
  voicemail: "Left a voicemail",
  wrong_number: "Wrong number",
  sent: "Sent",
  delivered: "Delivered",
  read: "Read",
  replied: "Replied",
  bounced: "Bounced",
  failed: "Could not send",
  completed: "Took place",
  no_show: "No-show",
  rescheduled: "Rescheduled",
  cancelled: "Cancelled",
  interested: "Interested",
  not_interested: "Not interested",
  callback_requested: "Asked for a callback",
  meeting_booked: "Meeting booked",
  other: "Other",
};

export function outcomeLabel(outcome: string): string {
  return OUTCOME_LABELS[outcome as ActivityOutcome] ?? humanizeKey(outcome);
}

/** Outcomes the API accepts for a type (notes take none). */
export function outcomesFor(type: LoggableActivityType): readonly ActivityOutcome[] {
  return ACTIVITY_OUTCOMES[type] ?? [];
}

/** Contact activities: suppression applies, and an outbound one counts an outreach attempt. */
export function isContactType(type: string): boolean {
  return (CONTACT_ACTIVITY_TYPES as readonly string[]).includes(type);
}

/** Calls, WhatsApp and email have a direction; notes and meetings do not. */
export function hasDirection(type: string): boolean {
  return type === "call" || type === "whatsapp" || type === "email";
}

/**
 * The outcome rule the API enforces (400 on `outcome`): notes take no outcome, and every other
 * type accepts only its own outcomes. Returns the message to show, or null when valid.
 */
export function outcomeError(
  type: LoggableActivityType,
  outcome: string | undefined,
): string | null {
  if (!outcome) return null;
  if (type === "note") return "Notes have no outcome.";
  if (!outcomesFor(type).includes(outcome as ActivityOutcome)) {
    return `“${outcomeLabel(outcome)}” is not an outcome for ${activityTypeLabel(type).toLowerCase()}s. Choose one from the list.`;
  }
  return null;
}

export const OUTREACH_CHANNEL_LABELS: Partial<Record<OutreachChannel, string>> = {
  call: "Calls",
  whatsapp: "WhatsApp",
  email: "Email",
};

export function channelLabel(channel: string): string {
  return OUTREACH_CHANNEL_LABELS[channel as OutreachChannel] ?? humanizeKey(channel);
}

export const OUTREACH_STATUS_META: Partial<
  Record<OutreachStatus, { label: string; tone: StatusTone; description: string }>
> = {
  planned: { label: "Planned", tone: "neutral", description: "No attempt logged yet." },
  in_progress: {
    label: "In progress",
    tone: "info",
    description: "Attempts logged, no reply yet.",
  },
  replied: {
    label: "Replied",
    tone: "success",
    description: "The business replied or showed interest.",
  },
  no_response: { label: "No response", tone: "warning", description: "Marked as not responding." },
  not_interested: {
    label: "Not interested",
    tone: "neutral",
    description: "The business said no.",
  },
  converted: {
    label: "Converted",
    tone: "success",
    description: "Became a customer or opportunity.",
  },
  opted_out: {
    label: "Opted out",
    tone: "warning",
    description:
      "Asked not to be contacted. This does not suppress the business; suppress it from its page.",
  },
  closed: { label: "Closed", tone: "neutral", description: "No further outreach planned." },
};

export function outreachStatusMeta(status: string): {
  label: string;
  tone: StatusTone;
  description: string;
} {
  return (
    OUTREACH_STATUS_META[status as OutreachStatus] ?? {
      label: humanizeKey(status),
      tone: "neutral",
      description: "",
    }
  );
}

export const PRIORITY_LABELS: Record<LeadPriority, string> = {
  low: "Low priority",
  medium: "Medium priority",
  high: "High priority",
};

/** Active stages in board order (archived stages are left out). */
export function activeStages(config: PipelineConfig | undefined): PipelineStage[] {
  if (!config) return [];
  return config.stages.filter((s) => !s.archived).sort((a, b) => a.order - b.order);
}

export function stageLabel(
  config: PipelineConfig | undefined,
  key: string | null | undefined,
): string {
  if (!key) return "No stage";
  return config?.stages.find((s) => s.key === key)?.label ?? humanizeKey(key);
}

/** The next or previous active stage in board order, or null at either end. */
export function neighbourStage(
  config: PipelineConfig | undefined,
  key: string,
  direction: "next" | "previous",
): PipelineStage | null {
  const stages = activeStages(config);
  const i = stages.findIndex((s) => s.key === key);
  if (i < 0) return null;
  return stages[direction === "next" ? i + 1 : i - 1] ?? null;
}

export function leadBusinessName(lead: Pick<Lead, "business">): string {
  const b = lead.business;
  if (!b) return "Business removed or merged";
  if (b.nameState === "expired" || !b.name) return EXPIRED_NAME_LABEL;
  return b.name;
}

export function activityBusinessName(activity: Pick<Activity, "business">): string {
  const b = activity.business;
  if (!b) return "Business removed or merged";
  if (b.nameState === "expired" || !b.name) return EXPIRED_NAME_LABEL;
  return b.name;
}

/** One-line summary of an activity, e.g. "Call · Connected" or "Moved from New to Qualified". */
export function activitySummary(
  activity: Activity,
  stage: (key: string | null) => string,
  member: (userId: string | null) => string,
): string {
  if (activity.type === "stage_change" && activity.stageChange) {
    const { fromStageKey, toStageKey } = activity.stageChange;
    return fromStageKey
      ? `Moved from ${stage(fromStageKey)} to ${stage(toStageKey)}`
      : `Added to the pipeline in ${stage(toStageKey)}`;
  }
  if (activity.type === "assignment" && activity.assignment) {
    const to = activity.assignment.toUserId;
    return to ? `Assigned to ${member(to)}` : "Unassigned";
  }
  const parts = [activityTypeLabel(activity.type)];
  if (activity.direction === "inbound") parts[0] = `${parts[0]} (inbound)`;
  if (activity.outcome) parts.push(outcomeLabel(activity.outcome));
  return parts.join(" · ");
}

/** System activities (stage changes and assignments) cannot be edited or deleted. */
export function isSystemActivity(activity: Pick<Activity, "type">): boolean {
  return activity.type === "stage_change" || activity.type === "assignment";
}

/** The authority is the API; this decides only whether to offer Edit and Delete. */
export function canEditActivity(
  activity: Pick<Activity, "type" | "authorUserId">,
  me: { userId: string; role: string; canWork: boolean },
): boolean {
  if (isSystemActivity(activity) || !me.canWork) return false;
  return activity.authorUserId === me.userId || me.role === "owner" || me.role === "admin";
}

/** The current version from a 409 VERSION_CONFLICT (`details` path `version`), when sent. */
export function conflictVersion(err: unknown): number | null {
  if (!isApiError(err) || err.code !== "VERSION_CONFLICT") return null;
  const raw = err.details?.find((d) => d.path === "version")?.message;
  const n = raw === undefined ? NaN : Number(raw);
  return Number.isFinite(n) ? n : null;
}

export function isVersionConflict(err: unknown): boolean {
  return isApiError(err) && err.code === "VERSION_CONFLICT";
}

export function isContactSuppressed(err: unknown): boolean {
  return isApiError(err) && err.code === "CONTACT_SUPPRESSED";
}

/** `datetime-local` input value for an ISO time, in the browser's time zone. */
export function toLocalInput(iso: string | Date): string {
  const d = typeof iso === "string" ? new Date(iso) : iso;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** ISO time from a `datetime-local` value; undefined when empty or invalid. */
export function fromLocalInput(value: string): string | undefined {
  if (!value) return undefined;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
}

/** The activity type inside a sentence: "call", "note", but "WhatsApp message" keeps its brand case. */
export function activityNoun(type: string): string {
  const label = activityTypeLabel(type);
  return type === "whatsapp" ? label : label.toLowerCase();
}
