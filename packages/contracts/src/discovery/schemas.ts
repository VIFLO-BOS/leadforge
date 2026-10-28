import { z } from "zod";
import { IsoDateTime, ObjectIdString, UuidString } from "../common/ids.js";
import { CursorQuery } from "../common/pagination.js";
import { queryArray } from "../common/query.js";
import { CountryCode } from "../auth/schemas.js";
import { FieldState } from "../businesses/fields.js";
import { SourceLicensing, SourceStatus, SourceStatusReason } from "../sources/schemas.js";

/** Hard limits for discovery jobs in release 1. Enforced server-side. */
export const DISCOVERY_LIMITS = {
  maxRecords: 5000,
  maxCategories: 10,
  maxSources: 3,
  maxDomains: 50,
  /** Failed items re-queued by one retry-failed request. */
  maxRetryItems: 1000,
} as const;

/**
 * Discovery sources. `overture_places` (Overture Maps Places, open data) is the runnable source.
 * `google_places` stays in the registry but is never runnable: Google's terms forbid storing
 * place content and directory use (status `not_available`, reason `provider_terms`).
 */
export const DiscoverySourceKey = z.enum(["google_places", "overture_places"]);
export type DiscoverySourceKey = z.infer<typeof DiscoverySourceKey>;

/** Job lifecycle (`draft` is reserved for saved wizard drafts and is not produced yet). */
export const DiscoveryJobStatus = z.enum([
  "draft",
  "queued",
  "running",
  "completed",
  "completed_with_warnings",
  "failed",
  "cancelled",
]);
export type DiscoveryJobStatus = z.infer<typeof DiscoveryJobStatus>;

export const DISCOVERY_TERMINAL_STATUSES: readonly DiscoveryJobStatus[] = [
  "completed",
  "completed_with_warnings",
  "failed",
  "cancelled",
];

/**
 * Per-item outcome:
 * - created: a new business record.
 * - updated: an existing business gained new observations.
 * - duplicate: resolved to a business this job already produced (not billed).
 * - skipped: not ingested (permanently closed, excluded domain, suppressed, no usable name, limit reached).
 * - failed: our processing failed; retryable with retry-failed; never billed.
 */
export const DiscoveryItemOutcome = z.enum([
  "created",
  "updated",
  "duplicate",
  "skipped",
  "failed",
]);
export type DiscoveryItemOutcome = z.infer<typeof DiscoveryItemOutcome>;

export const DiscoveryPriorityField = z.enum(["phone", "email", "whatsapp", "website"]);
export type DiscoveryPriorityField = z.infer<typeof DiscoveryPriorityField>;

/** Machine-readable codes in job `errors`/`warnings` and item `error`. */
export const DiscoveryIssueCode = z.enum([
  "SOURCE_NOT_CONFIGURED",
  "SOURCE_DISABLED",
  "SOURCE_POLICY_BLOCKED",
  "SOURCE_REQUEST_INVALID",
  "SOURCE_AUTH_FAILED",
  "SOURCE_RATE_LIMITED",
  "SOURCE_UNAVAILABLE",
  "SOURCE_ERROR",
  "JOB_TIMEOUT",
  "ACCESS_REVOKED",
  "ENQUEUE_FAILED",
  "INGEST_FAILED",
  "PLACE_NOT_FOUND",
  "PERMANENTLY_CLOSED",
  "TEMPORARILY_CLOSED",
  "MISSING_NAME",
  "DOMAIN_EXCLUDED",
  "DOMAIN_NOT_INCLUDED",
  "SUPPRESSED",
  "POSSIBLE_DUPLICATE",
  "INVALID_VALUE",
  "LIMIT_REACHED",
  /** The place is already linked to a business in the directory (same record or same upstream page); not charged. */
  "ALREADY_IN_DIRECTORY",
  /** Matched by words in the name, not by category (the place has no matching category); lower relevance. */
  "MATCHED_BY_NAME",
  /** Overture confidence between 0.5 and 0.6: shown as lower confidence. */
  "LOWER_CONFIDENCE",
  /** The open-data release no longer contains the record (retired). */
  "PLACE_RETIRED",
]);
export type DiscoveryIssueCode = z.infer<typeof DiscoveryIssueCode>;

const Domain = z
  .string()
  .trim()
  .toLowerCase()
  .min(3)
  .max(253)
  .regex(/^(?!-)[a-z0-9-]+(\.[a-z0-9-]+)+$/, "Use a bare domain such as example.com");

/** What the job wizard submits (and the estimate endpoint accepts). */
export const DiscoveryJobSpec = z.object({
  name: z.string().trim().min(2).max(120),
  sources: z
    .array(DiscoverySourceKey)
    .min(1)
    .max(DISCOVERY_LIMITS.maxSources)
    .refine((s) => new Set(s).size === s.length, "Each source can be selected once"),
  location: z.object({
    country: CountryCode.default("NG"),
    /** State or region, e.g. "Lagos". Nigerian spellings are canonicalized. */
    region: z.string().trim().min(2).max(120).optional(),
    /** City, town or area, e.g. "Ikeja". Overture matches the address city or an LGA of that name. */
    locality: z.string().trim().min(2).max(120).optional(),
    /**
     * Local government area, e.g. "Ikeja" or "Eti Osa" (Overture; use the keys or names from
     * GET /discovery/locations). Diacritics and case are ignored.
     */
    lga: z.string().trim().min(2).max(120).optional(),
    /** Extra place text appended to every query, e.g. "Allen Avenue". */
    query: z.string().trim().min(2).max(200).optional(),
    /** A circle: Google biases results toward it; Overture keeps only places inside it. */
    geo: z
      .object({
        lat: z.number().min(-90).max(90),
        lng: z.number().min(-180).max(180),
        radiusM: z.number().int().min(100).max(50_000),
      })
      .optional(),
  }),
  /** Industries or keywords; one source query each. */
  categories: z
    .array(z.string().trim().min(2).max(80))
    .min(1)
    .max(DISCOVERY_LIMITS.maxCategories)
    .refine(
      (c) => new Set(c.map((x) => x.toLowerCase())).size === c.length,
      "Remove duplicate categories",
    ),
  /** Keep only places whose website is on one of these domains. */
  domainsInclude: z.array(Domain).max(DISCOVERY_LIMITS.maxDomains).default([]),
  /** Skip places whose website is on one of these domains. */
  domainsExclude: z.array(Domain).max(DISCOVERY_LIMITS.maxDomains).default([]),
  /** Upper bound on billable records; also the credit hold (capped by what the sources can return). */
  maxRecords: z.number().int().min(1).max(DISCOVERY_LIMITS.maxRecords),
  /**
   * Contact fields to request. For Google Places, `phone` and `website` select the Enterprise
   * fields; without them the cheaper Pro field set is used. Google provides no emails, and
   * WhatsApp is never inferred from a phone number.
   */
  priorityFields: z.array(DiscoveryPriorityField).max(4).default(["phone", "website"]),
  /**
   * Overture confidence floor: `standard` keeps places with confidence 0.5 or more (about 70% of
   * Nigeria), `high` 0.7 or more (about 28%). Overture's score measures whether the place exists,
   * not whether its contacts work. Ignored by sources without a confidence score.
   */
  confidence: z.enum(["standard", "high"]).default("standard"),
  /**
   * Keep only places with at least one phone, email or real website (not only a social profile).
   * Records without any contact are never offered, so they are never charged. Overture only.
   */
  requireContact: z.boolean().default(true),
});
export type DiscoveryJobSpec = z.infer<typeof DiscoveryJobSpec>;
export type DiscoveryJobSpecInput = z.input<typeof DiscoveryJobSpec>;

export const DiscoveryBlocker = z.object({
  code: z.enum([
    "SOURCE_NOT_CONFIGURED",
    "SOURCE_DISABLED",
    "SOURCE_POLICY_BLOCKED",
    "SOURCE_UNAVAILABLE",
    "INSUFFICIENT_CREDITS",
    "VALIDATION_FAILED",
    /** Phase 6: the organization's plan does not include discovery. */
    "ENTITLEMENT_REQUIRED",
    /** Phase 6: the credit balance is below zero (after a refund or reversal). */
    "CREDIT_BALANCE_NEGATIVE",
  ]),
  source: DiscoverySourceKey.nullable(),
  message: z.string(),
});
export type DiscoveryBlocker = z.infer<typeof DiscoveryBlocker>;

export const DiscoverySourceEstimate = z.object({
  source: DiscoverySourceKey,
  name: z.string(),
  status: SourceStatus,
  enabled: z.boolean(),
  /** True when this source could run the job right now. */
  runnable: z.boolean(),
  /** Source queries the job will run (one per category). */
  queries: z.number().int(),
  /**
   * Most records the source can return for this spec. Overture: the exact number of matching
   * places not already in the directory (see `exact`). Google: 60 per query.
   */
  maxResults: z.number().int(),
  /** True when `maxResults` is an exact count rather than an upper bound. */
  exact: z.boolean(),
  /** Matching places skipped because they are already linked to a business in the directory. */
  alreadyInDirectory: z.number().int(),
  /** Most billable API requests to the source, excluding retries. */
  maxRequests: z.number().int(),
  /** Provider billing tier the requested fields fall into, when known. */
  providerSku: z.string().nullable(),
  fields: z.array(z.string()),
  warnings: z.array(z.string()),
});
export type DiscoverySourceEstimate = z.infer<typeof DiscoverySourceEstimate>;

/** `POST /discovery/jobs/estimate` response. */
export const DiscoveryEstimate = z.object({
  /** False when no selected source can run (see `blockers`); the credit numbers are still the upper bound. */
  estimateAvailable: z.boolean(),
  credits: z.object({
    /** 1 credit per produced business record (new, or existing with new observations). */
    perRecord: z.literal(1),
    /** Credits held when the job is queued: min(maxRecords, what the sources can return). */
    hold: z.number().int(),
    /** Credits available now. */
    balance: z.number().int(),
    sufficient: z.boolean(),
  }),
  /** Most records the job can produce. */
  maxRecords: z.number().int(),
  sources: z.array(DiscoverySourceEstimate),
  basis: z.string(),
  warnings: z.array(z.string()),
  blockers: z.array(DiscoveryBlocker),
});
export type DiscoveryEstimate = z.infer<typeof DiscoveryEstimate>;

export const DiscoveryIssue = z.object({
  code: z.string(),
  message: z.string(),
  at: IsoDateTime,
  source: DiscoverySourceKey.nullable(),
});
export type DiscoveryIssue = z.infer<typeof DiscoveryIssue>;

export const DiscoverySourceOutcome = z.object({
  source: DiscoverySourceKey,
  status: z.enum(["pending", "running", "completed", "failed", "cancelled"]),
  /** Result pages fetched from the source. */
  pages: z.number().int(),
  /** Records the source returned (before skips and dedup). */
  records: z.number().int(),
  /** Requests delayed by our per-source rate limiter. */
  rateLimited: z.number().int(),
  errors: z.array(z.object({ code: z.string(), message: z.string(), count: z.number().int() })),
});
export type DiscoverySourceOutcome = z.infer<typeof DiscoverySourceOutcome>;

/** Counts come from item records written by the worker; nothing is projected or estimated. */
export const DiscoveryProgress = z.object({
  /** Items with an outcome. */
  processed: z.number().int(),
  created: z.number().int(),
  updated: z.number().int(),
  duplicates: z.number().int(),
  skipped: z.number().int(),
  failed: z.number().int(),
  /** Billable items so far (created + updated). */
  billable: z.number().int(),
  pagesFetched: z.number().int(),
  /** Most billable records this run may produce. */
  limit: z.number().int(),
  lastEventAt: IsoDateTime.nullable(),
});
export type DiscoveryProgress = z.infer<typeof DiscoveryProgress>;

export const DiscoveryJob = z.object({
  id: ObjectIdString,
  name: z.string(),
  status: DiscoveryJobStatus,
  spec: DiscoveryJobSpec,
  estimate: z.object({ maxRecords: z.number().int(), hold: z.number().int(), basis: z.string() }),
  credits: z.object({
    held: z.number().int(),
    captured: z.number().int(),
    released: z.number().int(),
    /** True once every hold of this job has been captured and released. */
    settled: z.boolean(),
    settledAt: IsoDateTime.nullable(),
  }),
  progress: DiscoveryProgress,
  sourceOutcomes: z.array(DiscoverySourceOutcome),
  errors: z.array(DiscoveryIssue),
  warnings: z.array(DiscoveryIssue),
  cancelRequested: z.boolean(),
  /** 0 for the first run; incremented by each retry-failed. */
  round: z.number().int(),
  /** Failed items that retry-failed would re-queue (0 when nothing to retry). */
  retryableItems: z.number().int(),
  /** Attribution required wherever results from these sources are shown, e.g. "Overture Maps Foundation". */
  attributions: z.array(z.string()),
  /** Snapshot release each open-data source read from when the job was created, e.g. Overture "2026-10-21.0". */
  sourceReleases: z.array(z.object({ source: DiscoverySourceKey, release: z.string() })),
  createdByUserId: UuidString,
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
  queuedAt: IsoDateTime.nullable(),
  startedAt: IsoDateTime.nullable(),
  finishedAt: IsoDateTime.nullable(),
  cancelledAt: IsoDateTime.nullable(),
  timeoutAt: IsoDateTime.nullable(),
});
export type DiscoveryJob = z.infer<typeof DiscoveryJob>;

export const DiscoveryJobListQuery = z.object({
  status: queryArray(DiscoveryJobStatus, 7),
  source: DiscoverySourceKey.optional(),
  ...CursorQuery.shape,
});
export type DiscoveryJobListQuery = z.infer<typeof DiscoveryJobListQuery>;

export const DiscoveryJobItem = z.object({
  id: ObjectIdString,
  source: DiscoverySourceKey,
  /** Source record id: the Overture GERS id (or a Google place ID for old jobs). */
  externalId: z.string(),
  outcome: DiscoveryItemOutcome,
  billable: z.boolean(),
  attempts: z.number().int(),
  round: z.number().int(),
  error: z.object({ code: z.string(), message: z.string(), retryable: z.boolean() }).nullable(),
  warnings: z.array(z.object({ code: z.string(), message: z.string() })),
  /** The resulting business; `name` follows the field model (hidden when expired). */
  business: z
    .object({ id: ObjectIdString, name: z.string().nullable(), nameState: FieldState })
    .nullable(),
  duplicateOfId: ObjectIdString.nullable(),
  processedAt: IsoDateTime.nullable(),
});
export type DiscoveryJobItem = z.infer<typeof DiscoveryJobItem>;

export const DiscoveryItemsQuery = z.object({
  outcome: queryArray(DiscoveryItemOutcome, 5),
  ...CursorQuery.shape,
});
export type DiscoveryItemsQuery = z.infer<typeof DiscoveryItemsQuery>;

/** Discovery-capable sources for the wizard (`GET /discovery/sources`). */
export const DiscoverySourceOption = z.object({
  key: DiscoverySourceKey,
  name: z.string(),
  status: SourceStatus,
  /** Why the source cannot run: provider_terms (Google), snapshot_missing (Overture before the first sync); null when runnable. */
  statusReason: SourceStatusReason.nullable(),
  statusDetail: z.string(),
  enabled: z.boolean(),
  runnable: z.boolean(),
  /** Most records one query can return; 0 when the source has no per-query cap (Overture). */
  maxResultsPerQuery: z.number().int(),
  providesFields: z.array(z.string()),
  /** Short attribution label, e.g. "Overture Maps Foundation". */
  attribution: z.string().nullable(),
  retentionSummary: z.string(),
  /** Full attribution text, per-dataset lines and licence links. */
  licensing: SourceLicensing.nullable(),
  /** Which spec fields the source honours, so the wizard can show the right controls. */
  specSupport: z.object({
    /** Location fields used: any of region, lga, locality, query, geo. */
    location: z.array(z.enum(["region", "lga", "locality", "query", "geo"])),
    /** `confidence` (standard or high) applies. */
    confidence: z.boolean(),
    /** `requireContact` applies. */
    requireContact: z.boolean(),
    /** `priorityFields` changes what is requested. */
    priorityFields: z.boolean(),
    /** GET /discovery/categories and GET /discovery/locations have options for this source. */
    catalog: z.boolean(),
  }),
  /** The loaded open-data snapshot (Overture); null for API sources or before the first sync. */
  snapshot: z
    .object({
      release: z.string(),
      syncedAt: IsoDateTime,
      places: z.number().int(),
      offerable: z.number().int(),
    })
    .nullable(),
});
export type DiscoverySourceOption = z.infer<typeof DiscoverySourceOption>;

// ---------------------------------------------------------------------------
// Wizard catalogues (Overture): categories and locations
// ---------------------------------------------------------------------------

export const DiscoveryCategoriesQuery = z.object({
  source: DiscoverySourceKey.default("overture_places"),
  /** Prefix filter over labels and synonyms (case and diacritics ignored). */
  q: z.string().trim().max(80).optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
});
export type DiscoveryCategoriesQuery = z.infer<typeof DiscoveryCategoriesQuery>;

/**
 * A category the wizard can offer. Send `label` (or any synonym) in `spec.categories`; the
 * source maps it to its own taxonomy. `places` counts offerable places in the loaded snapshot
 * (confidence 0.5 or more, open, with a contact), nationwide.
 */
export const DiscoveryCategoryOption = z.object({
  key: z.string(),
  label: z.string(),
  /** Other words that map to the same categories, e.g. "chemist" for Pharmacy. */
  synonyms: z.array(z.string()),
  /** Overture taxonomy categories it covers (snake_case ids). */
  sourceCategories: z.array(z.string()),
  /** `curated`: LeadForge's Nigerian vocabulary. `taxonomy`: an Overture category used as is. */
  kind: z.enum(["curated", "taxonomy"]),
  places: z.number().int().nullable(),
});
export type DiscoveryCategoryOption = z.infer<typeof DiscoveryCategoryOption>;

export const DiscoveryLocationsQuery = z.object({
  source: DiscoverySourceKey.default("overture_places"),
});
export type DiscoveryLocationsQuery = z.infer<typeof DiscoveryLocationsQuery>;

/**
 * States and LGAs for the wizard, from the loaded snapshot (boundaries from Overture divisions).
 * Send the state `name` as `location.region` and the LGA `name` as `location.lga`.
 */
export const DiscoveryLocationOptions = z.object({
  source: DiscoverySourceKey,
  release: z.string().nullable(),
  country: z.string(),
  states: z.array(
    z.object({
      key: z.string(),
      name: z.string(),
      /** ISO 3166-2 code, e.g. NG-LA. */
      code: z.string().nullable(),
      /** Offerable places in the snapshot. */
      places: z.number().int(),
      lgas: z.array(z.object({ key: z.string(), name: z.string(), places: z.number().int() })),
    }),
  ),
  /** Attribution for the boundaries the states and LGAs come from. */
  boundariesAttribution: z.string(),
});
export type DiscoveryLocationOptions = z.infer<typeof DiscoveryLocationOptions>;
