import {
  DISCOVERY_TERMINAL_STATUSES,
  DiscoveryItemsQuery,
  DiscoveryJobListQuery,
  PAGE_SIZE_DEFAULT,
  type DiscoveryItemOutcome,
  type DiscoveryJob,
  type DiscoveryJobSpec,
  type DiscoveryJobStatus,
  type DiscoverySourceOption,
} from "@leadforge/contracts";
import type { StatusTone } from "@leadforge/ui";
import { CircleCheck, CircleSlash, CircleX, Copy, RefreshCw, type LucideIcon } from "lucide-react";
import { formatNumber } from "./format";
import { humanizeKey, sourceLabel } from "./labels";

/** Statuses during which a discovery job still changes on its own. */
const ACTIVE: readonly DiscoveryJobStatus[] = ["queued", "running"];

export function isDiscoveryActive(job: Pick<DiscoveryJob, "status">): boolean {
  return ACTIVE.includes(job.status);
}

export function isDiscoveryTerminal(job: Pick<DiscoveryJob, "status">): boolean {
  return DISCOVERY_TERMINAL_STATUSES.includes(job.status);
}

/**
 * The polling rule from docs/API_CONTRACTS.md: poll every 2 seconds while the job is queued or
 * running, and stop once it is terminal and its credits are settled (usually the same response).
 * A terminal job whose holds are not settled yet keeps polling until they are.
 */
export function shouldPollDiscoveryJob(
  job: Pick<DiscoveryJob, "status"> & { credits: Pick<DiscoveryJob["credits"], "settled"> },
): boolean {
  if (isDiscoveryActive(job)) return true;
  return isDiscoveryTerminal(job) && !job.credits.settled;
}

export const DISCOVERY_STATUS_LABELS: Record<DiscoveryJobStatus, string> = {
  draft: "Draft",
  queued: "Queued",
  running: "Running",
  completed: "Completed",
  completed_with_warnings: "Completed with warnings",
  failed: "Failed",
  cancelled: "Cancelled",
};

/** Statuses a list can filter on (`draft` is reserved and never produced). */
export const DISCOVERY_FILTER_STATUSES: DiscoveryJobStatus[] = [
  "queued",
  "running",
  "completed",
  "completed_with_warnings",
  "failed",
  "cancelled",
];

export interface OutcomeMeta {
  label: string;
  tone: StatusTone;
  icon: LucideIcon;
  description: string;
}

export const OUTCOME_META: Record<DiscoveryItemOutcome, OutcomeMeta> = {
  created: {
    label: "New business",
    tone: "success",
    icon: CircleCheck,
    description: "A new business record was created. Billed: 1 credit.",
  },
  updated: {
    label: "Updated",
    tone: "info",
    icon: RefreshCw,
    description: "An existing business gained new observations. Billed: 1 credit.",
  },
  duplicate: {
    label: "Duplicate",
    tone: "neutral",
    icon: Copy,
    description: "Resolved to a business this job already produced. Not billed.",
  },
  skipped: {
    label: "Skipped",
    tone: "neutral",
    icon: CircleSlash,
    description: "Not ingested (closed, excluded, suppressed or unusable). Not billed.",
  },
  failed: {
    label: "Failed",
    tone: "destructive",
    icon: CircleX,
    description: "Our processing failed. Never billed; retry failed items to try again.",
  },
};

export const OUTCOME_ORDER: DiscoveryItemOutcome[] = [
  "created",
  "updated",
  "duplicate",
  "skipped",
  "failed",
];

/** Readable names for job, item and source issue codes. Unknown codes are humanized. */
const ISSUE_LABELS: Record<string, string> = {
  SOURCE_NOT_CONFIGURED: "Source not configured",
  SOURCE_DISABLED: "Source disabled",
  SOURCE_REQUEST_INVALID: "Request rejected by the source",
  SOURCE_AUTH_FAILED: "Source rejected our credentials",
  SOURCE_RATE_LIMITED: "Rate limited by the source",
  SOURCE_UNAVAILABLE: "Source unavailable",
  SOURCE_ERROR: "Source error",
  JOB_TIMEOUT: "Job timed out",
  ACCESS_REVOKED: "Creator lost access",
  ENQUEUE_FAILED: "Could not be queued",
  INGEST_FAILED: "Could not be saved",
  PLACE_NOT_FOUND: "No longer listed by the source",
  PERMANENTLY_CLOSED: "Permanently closed",
  TEMPORARILY_CLOSED: "Temporarily closed",
  MISSING_NAME: "No usable name",
  DOMAIN_EXCLUDED: "Website domain excluded",
  DOMAIN_NOT_INCLUDED: "Website domain not in the include list",
  SUPPRESSED: "Suppressed business",
  POSSIBLE_DUPLICATE: "Possible duplicate",
  INVALID_VALUE: "Invalid value dropped",
  LIMIT_REACHED: "Record limit reached",
  INSUFFICIENT_CREDITS: "Not enough credits",
  ENTITLEMENT_REQUIRED: "Not included in the workspace's plan",
  CREDIT_BALANCE_NEGATIVE: "Credit balance below zero",
  VALIDATION_FAILED: "Needs a change",
};

export function issueLabel(code: string): string {
  return ISSUE_LABELS[code] ?? humanizeKey(code.toLowerCase());
}

/** Source name from the wizard metadata, falling back to the provenance label for the key. */
export function discoverySourceName(
  key: string,
  options: readonly Pick<DiscoverySourceOption, "key" | "name">[] | undefined,
): string {
  return options?.find((o) => o.key === key)?.name ?? sourceLabel(key);
}

/** "Ikeja, Lagos" (most specific first), or null when the spec names no place. */
export function locationSummary(location: DiscoveryJobSpec["location"]): string | null {
  const parts: string[] = [];
  for (const p of [location.query, location.locality, location.lga, location.region]) {
    const t = p?.trim();
    if (t && !parts.some((x) => x.toLowerCase() === t.toLowerCase())) parts.push(t);
  }
  if (location.geo) parts.push(`within ${formatNumber(location.geo.radiusM)} m of a map point`);
  return parts.length ? parts.join(", ") : null;
}

/** "Restaurant, Bakery in Ikeja, Lagos". */
export function specSummary(spec: Pick<DiscoveryJobSpec, "categories" | "location">): string {
  const what = spec.categories.join(", ");
  const where = locationSummary(spec.location);
  return where ? `${what} in ${where}` : what;
}

// ---------------------------------------------------------------------------
// URL view state for the job list and the items table
// ---------------------------------------------------------------------------

export interface DiscoveryListState {
  status: DiscoveryJobStatus[];
  source?: string;
  pageSize: number;
}

export const DISCOVERY_PAGE_SIZES = [25, 50, 100] as const;

/** Parses with the contracts' DiscoveryJobListQuery; params that fail are dropped one by one. */
export function parseDiscoveryListParams(params: URLSearchParams): DiscoveryListState {
  const raw: Record<string, unknown> = {};
  const status = params.getAll("status").filter(Boolean);
  if (status.length) raw.status = status;
  const source = params.get("source");
  if (source) raw.source = source;
  const pageSize = params.get("pageSize");
  if (pageSize) raw.pageSize = pageSize;
  let parsed = DiscoveryJobListQuery.safeParse(raw);
  for (let i = 0; !parsed.success && i < 5; i++) {
    const bad = new Set(parsed.error.issues.map((issue) => String(issue.path[0])));
    for (const key of bad) delete raw[key];
    parsed = DiscoveryJobListQuery.safeParse(raw);
  }
  const q = parsed.success
    ? parsed.data
    : { status: [], source: undefined, pageSize: PAGE_SIZE_DEFAULT };
  return {
    status: (q.status ?? []).filter((s) => s !== "draft"),
    source: q.source,
    pageSize: DISCOVERY_PAGE_SIZES.includes(q.pageSize as 25) ? q.pageSize : PAGE_SIZE_DEFAULT,
  };
}

export function serializeDiscoveryListState(state: DiscoveryListState): URLSearchParams {
  const out = new URLSearchParams();
  for (const s of state.status) out.append("status", s);
  if (state.source) out.set("source", state.source);
  if (state.pageSize !== PAGE_SIZE_DEFAULT) out.set("pageSize", String(state.pageSize));
  return out;
}

export interface ItemsViewState {
  outcome: DiscoveryItemOutcome[];
}

export function parseItemsParams(params: URLSearchParams): ItemsViewState {
  const outcome = params.getAll("outcome").filter(Boolean);
  const parsed = DiscoveryItemsQuery.safeParse(outcome.length ? { outcome } : {});
  return { outcome: parsed.success ? (parsed.data.outcome ?? []) : [] };
}

export function serializeItemsState(
  state: ItemsViewState,
  base?: URLSearchParams,
): URLSearchParams {
  const out = new URLSearchParams(base);
  out.delete("outcome");
  for (const o of state.outcome) out.append("outcome", o);
  return out;
}
