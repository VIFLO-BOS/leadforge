import {
  ANALYSIS_TERMINAL_STATUSES,
  AnalysisListQuery,
  PAGE_SIZE_DEFAULT,
  type AnalysisSkipCode,
  type AnalysisStatus,
  type DetectionKey,
  type DetectionObserved,
  type EvidenceType,
  type OpportunityKey,
  type WebsiteAnalysis,
} from "@leadforge/contracts";
import type { JobState, StatusTone } from "@leadforge/ui";
import { CircleCheck, CircleHelp, SearchCheck, type LucideIcon } from "lucide-react";
import { humanizeKey } from "./labels";

/*
 * Website analysis helpers (docs/API_CONTRACTS.md "Website analysis"). LeadForge reports only
 * what it observed on the pages it fetched: a detection observed "yes" reads "No X was detected",
 * never "the business has no X". Label maps keyed by API enums are Partial with a readable
 * fallback, so a detection or opportunity the backend adds later still renders.
 */

/** The API asks for a 2 second poll while an analysis is queued or running. */
export const ANALYSIS_POLL_MS = 2_000;

export function isAnalysisActive(a: Pick<WebsiteAnalysis, "status">): boolean {
  return a.status === "queued" || a.status === "running";
}

export function isAnalysisTerminal(a: Pick<WebsiteAnalysis, "status">): boolean {
  return ANALYSIS_TERMINAL_STATUSES.includes(a.status);
}

/** Poll while queued or running, and until a finished analysis has settled its credit. */
export function shouldPollAnalysis(
  a: Pick<WebsiteAnalysis, "status"> & { credits: Pick<WebsiteAnalysis["credits"], "settled"> },
): boolean {
  if (isAnalysisActive(a)) return true;
  return isAnalysisTerminal(a) && !a.credits.settled;
}

export const ANALYSIS_STATUS_LABELS: Record<AnalysisStatus, string> = {
  queued: "Queued",
  running: "Running",
  completed: "Completed",
  failed: "Failed",
};

/** Analysis statuses map onto the shared JobStatus states one to one. */
export function analysisJobState(status: string): JobState {
  return (["queued", "running", "completed", "failed"] as const).includes(status as AnalysisStatus)
    ? (status as JobState)
    : "queued";
}

export const OBSERVED_META: Record<
  DetectionObserved,
  { label: string; tone: StatusTone; icon: LucideIcon; description: string }
> = {
  yes: {
    label: "Gap observed",
    tone: "warning",
    icon: SearchCheck,
    description: "The analysis looked for this and did not find it on the pages it fetched.",
  },
  no: {
    label: "Feature seen",
    tone: "success",
    icon: CircleCheck,
    description: "The analysis found this on the pages it fetched.",
  },
  unknown: {
    label: "Could not check",
    tone: "neutral",
    icon: CircleHelp,
    description: "The pages needed for this check could not be fetched or read.",
  },
};

/** Short names for detections, used in links and summaries ("Contact form"). */
const DETECTION_NAMES: Partial<Record<DetectionKey, string>> = {
  website_unreachable: "Reachable website",
  mobile_unfriendly: "Mobile-friendly layout",
  no_contact_form: "Contact form",
  no_booking_flow: "Booking flow",
  no_online_ordering: "Online ordering",
  no_whatsapp_link: "WhatsApp link",
  no_https: "Working HTTPS",
  outdated_platform: "Platform version",
  missing_seo_metadata: "Basic SEO metadata",
};

export function detectionName(key: string): string {
  return DETECTION_NAMES[key as DetectionKey] ?? humanizeKey(key.replace(/^no_/, ""));
}

const OPPORTUNITY_NAMES: Partial<Record<OpportunityKey, string>> = {
  website_rebuild: "Website rebuild",
  mobile_friendly_site: "Mobile-friendly site",
  contact_form: "Website contact form",
  online_booking: "Online booking",
  online_ordering: "Online ordering",
  whatsapp_click_to_chat: "WhatsApp click-to-chat",
  https_setup: "HTTPS setup",
  platform_update: "Platform update",
  seo_basics: "SEO basics",
};

export function opportunityName(key: string): string {
  return OPPORTUNITY_NAMES[key as OpportunityKey] ?? humanizeKey(key);
}

export const OPPORTUNITY_KEYS: OpportunityKey[] = [
  "website_rebuild",
  "mobile_friendly_site",
  "contact_form",
  "online_booking",
  "online_ordering",
  "whatsapp_click_to_chat",
  "https_setup",
  "platform_update",
  "seo_basics",
];

export const EVIDENCE_TYPE_LABELS: Record<EvidenceType, string> = {
  selector: "Element",
  url: "Page",
  text: "Note",
  header: "Header",
};

/** Failure codes of an analysis (docs/API_CONTRACTS.md). Unknown codes are humanized. */
const FAILURE_LABELS: Record<string, string> = {
  ROBOTS_DISALLOWED: "The site's robots.txt does not allow fetching the home page",
  ADDRESS_NOT_ALLOWED: "The website resolves to a private or reserved address",
  URL_NOT_ALLOWED: "The website address or port is not allowed",
  CONTENT_TYPE_NOT_ALLOWED: "The home page is not an HTML page",
  TOO_LARGE: "The home page is larger than the 2 MiB limit",
  ACCESS_REVOKED: "The person who asked for it no longer has permission",
  BUSINESS_GONE: "The business was merged or deleted",
  SUPPRESSED: "The business is suppressed",
  ANALYSIS_TIMEOUT: "The analysis ran for too long",
  ANALYSIS_ERROR: "The analysis failed on our side",
  ENQUEUE_FAILED: "The analysis could not be queued",
  WEBSITE_MISSING: "The business has no usable website",
};

export function failureLabel(code: string): string {
  return FAILURE_LABELS[code] ?? humanizeKey(code.toLowerCase());
}

export const SKIP_LABELS: Record<AnalysisSkipCode, string> = {
  NOT_FOUND: "Not found in this workspace",
  WEBSITE_MISSING: "No website on record",
  SUPPRESSED: "Suppressed: its website is never fetched",
  INSUFFICIENT_CREDITS: "Not enough credits",
};

export function skipLabel(code: string): string {
  return SKIP_LABELS[code as AnalysisSkipCode] ?? humanizeKey(code.toLowerCase());
}

/** Host of a URL for titles ("mamaput.example.test"), or the input when it does not parse. */
export function hostOf(url: string | null | undefined): string {
  if (!url) return "Unknown website";
  try {
    return new URL(url).host || url;
  } catch {
    return url;
  }
}

/** "75%" for a 0 to 1 confidence. */
export function percent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

/** Detections observed "yes" (a gap seen on the pages checked). */
export function gapCount(a: Pick<WebsiteAnalysis, "detections">): number {
  return a.detections.filter((d) => d.observed === "yes").length;
}

// ---------------------------------------------------------------------------
// List view state (URL)
// ---------------------------------------------------------------------------

export interface AnalysisListState {
  status: AnalysisStatus[];
  opportunity: OpportunityKey[];
  businessId?: string;
  batchId?: string;
  pageSize: number;
}

export const ANALYSIS_PAGE_SIZES = [25, 50, 100] as const;

export function parseAnalysisListParams(params: URLSearchParams): AnalysisListState {
  const raw: Record<string, unknown> = {};
  for (const key of ["status", "opportunity"] as const) {
    const values = params.getAll(key).filter(Boolean);
    if (values.length) raw[key] = values;
  }
  for (const key of ["businessId", "batchId", "pageSize"] as const) {
    const v = params.get(key);
    if (v) raw[key] = v;
  }
  let parsed = AnalysisListQuery.safeParse(raw);
  for (let i = 0; !parsed.success && i < 6; i++) {
    const bad = new Set(parsed.error.issues.map((issue) => String(issue.path[0] ?? "")));
    if ([...bad].every((k) => !(k in raw))) break;
    for (const k of bad) delete raw[k];
    parsed = AnalysisListQuery.safeParse(raw);
  }
  const q = parsed.success ? parsed.data : AnalysisListQuery.parse({});
  return {
    status: q.status ?? [],
    opportunity: q.opportunity ?? [],
    businessId: q.businessId,
    batchId: q.batchId,
    pageSize: (ANALYSIS_PAGE_SIZES as readonly number[]).includes(q.pageSize)
      ? q.pageSize
      : PAGE_SIZE_DEFAULT,
  };
}

export function serializeAnalysisListState(state: AnalysisListState): URLSearchParams {
  const out = new URLSearchParams();
  for (const s of state.status) out.append("status", s);
  for (const o of state.opportunity) out.append("opportunity", o);
  if (state.businessId) out.set("businessId", state.businessId);
  if (state.batchId) out.set("batchId", state.batchId);
  if (state.pageSize !== PAGE_SIZE_DEFAULT) out.set("pageSize", String(state.pageSize));
  return out;
}
