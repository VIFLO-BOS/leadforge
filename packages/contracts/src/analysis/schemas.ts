import { z } from "zod";
import { IsoDateTime, ObjectIdString, UuidString } from "../common/ids.js";
import { CursorQuery } from "../common/pagination.js";
import { queryArray } from "../common/query.js";

/**
 * Website analysis (docs/PRODUCT_REQUIREMENTS.md section 6). LeadForge reports only what it
 * observed on the pages it could fetch: a detection with `observed: "yes"` means "No X was
 * detected on the pages checked", never "the business has no X".
 */
export const ANALYSIS_LIMITS = {
  /** Businesses per bulk request. */
  bulkMax: 50,
  /** Pages fetched per analysis: home plus up to four linked pages. */
  maxPages: 5,
  /** Credits per analysis (held at queue, captured on completion, released on failure). */
  creditsPerAnalysis: 1,
  /** Opportunities at or above this confidence count toward the scoring signal. */
  opportunityConfidence: 0.7,
} as const;

export const DetectionKey = z.enum([
  "website_unreachable",
  "mobile_unfriendly",
  "no_contact_form",
  "no_booking_flow",
  "no_online_ordering",
  "no_whatsapp_link",
  "no_https",
  "outdated_platform",
  "missing_seo_metadata",
]);
export type DetectionKey = z.infer<typeof DetectionKey>;

/** `yes`: the gap was observed; `no`: the feature was seen; `unknown`: it could not be checked. */
export const DetectionObserved = z.enum(["yes", "no", "unknown"]);
export type DetectionObserved = z.infer<typeof DetectionObserved>;

export const EvidenceType = z.enum(["selector", "url", "text", "header"]);
export type EvidenceType = z.infer<typeof EvidenceType>;

/** One piece of evidence. `value` is a short snippet (at most 300 characters), never the page. */
export const Evidence = z.object({
  type: EvidenceType,
  value: z.string(),
  /** Page the evidence was taken from. */
  page: z.string().nullable(),
});
export type Evidence = z.infer<typeof Evidence>;

export const Detection = z.object({
  key: DetectionKey,
  /** Display copy, always phrased as an observation ("No contact form was detected"). */
  label: z.string(),
  observed: DetectionObserved,
  /** 0 to 1: how strongly the evidence supports `observed`. */
  confidence: z.number().min(0).max(1),
  evidence: z.array(Evidence),
  /** For `outdated_platform`: the generator string exactly as observed. */
  observedValue: z.string().nullable(),
  analyzedAt: IsoDateTime,
});
export type Detection = z.infer<typeof Detection>;

export const OpportunityKey = z.enum([
  "website_rebuild",
  "mobile_friendly_site",
  "contact_form",
  "online_booking",
  "online_ordering",
  "whatsapp_click_to_chat",
  "https_setup",
  "platform_update",
  "seo_basics",
]);
export type OpportunityKey = z.infer<typeof OpportunityKey>;

export const Opportunity = z.object({
  key: OpportunityKey,
  title: z.string(),
  rationale: z.string(),
  confidence: z.number().min(0).max(1),
  /** Detections this suggestion rests on; their evidence is in `detections`. */
  detectionKeys: z.array(DetectionKey),
});
export type Opportunity = z.infer<typeof Opportunity>;

export const AnalysisStatus = z.enum(["queued", "running", "completed", "failed"]);
export type AnalysisStatus = z.infer<typeof AnalysisStatus>;

export const ANALYSIS_TERMINAL_STATUSES: readonly AnalysisStatus[] = ["completed", "failed"];

export const AnalysisTrigger = z.enum(["single", "bulk", "refresh"]);
export type AnalysisTrigger = z.infer<typeof AnalysisTrigger>;

export const AnalysisPage = z.object({
  url: z.string(),
  finalUrl: z.string().nullable(),
  kind: z.enum(["home", "contact", "about", "services", "booking"]),
  status: z.number().int().nullable(),
  /** Why the page was not analyzed (robots, size, content type, timeout...), else null. */
  error: z.string().nullable(),
});
export type AnalysisPage = z.infer<typeof AnalysisPage>;

export const WebsiteAnalysis = z.object({
  id: ObjectIdString,
  businessId: ObjectIdString,
  business: z.object({ name: z.string().nullable(), nameState: z.string() }).nullable(),
  url: z.string(),
  finalUrl: z.string().nullable(),
  status: AnalysisStatus,
  trigger: AnalysisTrigger,
  batchId: ObjectIdString.nullable(),
  fetched: z
    .object({
      status: z.number().int().nullable(),
      redirects: z.array(z.object({ url: z.string(), status: z.number().int() })),
      bytes: z.number().int(),
      contentType: z.string().nullable(),
      durationMs: z.number().int(),
      tls: z.object({
        secure: z.boolean(),
        valid: z.boolean().nullable(),
        issuer: z.string().nullable(),
        validTo: z.string().nullable(),
        error: z.string().nullable(),
      }),
    })
    .nullable(),
  robots: z.object({ fetched: z.boolean(), allowed: z.boolean().nullable() }),
  pagesVisited: z.array(AnalysisPage),
  detections: z.array(Detection),
  opportunities: z.array(Opportunity),
  credits: z.object({
    held: z.number().int(),
    captured: z.number().int(),
    released: z.number().int(),
    settled: z.boolean(),
  }),
  error: z.object({ code: z.string(), message: z.string() }).nullable(),
  requestedByUserId: UuidString,
  createdAt: IsoDateTime,
  startedAt: IsoDateTime.nullable(),
  analyzedAt: IsoDateTime.nullable(),
  finishedAt: IsoDateTime.nullable(),
});
export type WebsiteAnalysis = z.infer<typeof WebsiteAnalysis>;

/** `POST /analysis/websites`: one business, or up to 50 (bulk). */
export const CreateAnalysisRequest = z.union([
  z.object({ businessId: ObjectIdString }).strict(),
  z
    .object({ businessIds: z.array(ObjectIdString).min(1).max(ANALYSIS_LIMITS.bulkMax) })
    .strict()
    .refine(
      (v) => new Set(v.businessIds.map((id) => id.toLowerCase())).size === v.businessIds.length,
      {
        message: "businessIds must be distinct",
        path: ["businessIds"],
      },
    ),
]);
export type CreateAnalysisRequest = z.infer<typeof CreateAnalysisRequest>;

export const AnalysisSkipCode = z.enum([
  "NOT_FOUND",
  "WEBSITE_MISSING",
  "SUPPRESSED",
  "INSUFFICIENT_CREDITS",
]);
export type AnalysisSkipCode = z.infer<typeof AnalysisSkipCode>;

export const CreateAnalysisResponse = z.object({
  /** Analyses created by this request, plus ones already queued or running for these businesses. */
  analyses: z.array(WebsiteAnalysis),
  /** Ids of analyses that were already in progress (no new credit held). */
  alreadyInProgress: z.array(ObjectIdString),
  /** Businesses not analyzed, with the reason. */
  skipped: z.array(
    z.object({ businessId: ObjectIdString, code: AnalysisSkipCode, message: z.string() }),
  ),
  batchId: ObjectIdString.nullable(),
  credits: z.object({ held: z.number().int() }),
});
export type CreateAnalysisResponse = z.infer<typeof CreateAnalysisResponse>;

export const AnalysisListQuery = z.object({
  status: queryArray(AnalysisStatus, 4),
  /** Completed analyses suggesting any of these opportunities. */
  opportunity: queryArray(OpportunityKey, 9),
  businessId: ObjectIdString.optional(),
  batchId: ObjectIdString.optional(),
  ...CursorQuery.shape,
});
export type AnalysisListQuery = z.infer<typeof AnalysisListQuery>;

/** Latest completed analysis, embedded on the business for scoring and the directory. */
export const AnalysisSummary = z.object({
  analysisId: ObjectIdString,
  status: AnalysisStatus,
  analyzedAt: IsoDateTime.nullable(),
  /** Opportunity keys at or above ANALYSIS_LIMITS.opportunityConfidence. */
  opportunities: z.array(OpportunityKey),
  /**
   * The queued or running analysis of this business, if any (poll GET /analysis/websites/:id).
   * On `BusinessDetail.latestAnalysis` from Phase 6; null elsewhere. When no analysis has
   * finished yet, `latestAnalysis` is the active one itself (status queued or running).
   * Typed optional so older clients compile.
   */
  activeAnalysisId: ObjectIdString.nullable().optional(),
});
export type AnalysisSummary = z.infer<typeof AnalysisSummary>;
