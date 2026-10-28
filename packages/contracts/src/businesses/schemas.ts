import { z } from "zod";
import { IsoDateTime, ObjectIdString, UuidString } from "../common/ids.js";
import { CursorQuery, sortQuery } from "../common/pagination.js";
import { queryArray, queryBoolean, queryList } from "../common/query.js";
import { CountryCode } from "../auth/schemas.js";
import { AnalysisSummary } from "../analysis/schemas.js";
import { ScoreSnapshot } from "../scoring/schemas.js";
import { DataLicenseId, DataLicenseRef } from "../sources/schemas.js";
import {
  alternativeOf,
  CategoryTaxonomy,
  CollectionMethod,
  EmailKind,
  FieldMeta,
  FieldState,
  FieldSummary,
  fieldValue,
  ObservationField,
  PhoneType,
  SocialPlatform,
  SourceKey,
  WhatsAppStatus,
} from "./fields.js";

// ---------------------------------------------------------------------------
// Directory list
// ---------------------------------------------------------------------------

export const BUSINESS_SORT_FIELDS = [
  "updatedAt",
  "createdAt",
  "name",
  "lastVerifiedAt",
  "fit",
  "dataConfidence",
] as const;
export const BusinessSortField = z.enum(BUSINESS_SORT_FIELDS);
export type BusinessSortField = z.infer<typeof BusinessSortField>;

export const SuppressionFilter = z.enum(["exclude", "include", "only"]);
export type SuppressionFilter = z.infer<typeof SuppressionFilter>;

const filterText = (max: number) => z.string().trim().min(1).max(max);
/** 0 to 100 from a query string or JSON. */
const scoreBound = z.coerce.number().int().min(0).max(100).optional();

/** Most business ids the `ids` directory filter accepts. */
export const BUSINESS_IDS_FILTER_MAX = 100;

/**
 * Directory filters. Shared by GET /businesses (query string) and POST /exports/businesses
 * (JSON body). Array filters match any of the given values; different filters combine with AND.
 */
export const BusinessListFilter = z.object({
  /**
   * Only these businesses (Stage 8): `?ids=a,b`, `?ids=a&ids=b` or a JSON array, at most
   * BUSINESS_IDS_FILTER_MAX. Combines with every other filter (including the default
   * `suppression: exclude`). Ids that are not in the organization match nothing.
   */
  ids: queryList(ObjectIdString, BUSINESS_IDS_FILTER_MAX),
  /** Prefix search over name, categories, location, website domain, emails and phone digits. */
  q: z.string().trim().max(200).optional(),
  /** Category labels; matched case-insensitively. */
  category: queryArray(filterText(80)),
  country: CountryCode.optional(),
  /** State or region (Nigerian states accept "Lagos" or "Lagos State"). */
  region: queryArray(filterText(120)),
  /** City or town. */
  locality: queryArray(filterText(120)),
  /** Local government area. */
  lga: queryArray(filterText(120)),
  hasWebsite: queryBoolean,
  hasPhone: queryBoolean,
  hasEmail: queryBoolean,
  /** Business-level WhatsApp status (best status across its phones). */
  whatsapp: queryArray(WhatsAppStatus, 3),
  /** Matches businesses with at least one value of the field in one of these states. */
  websiteState: queryArray(FieldState, 6),
  phoneState: queryArray(FieldState, 6),
  emailState: queryArray(FieldState, 6),
  /** Businesses observed from any of these sources. */
  source: queryArray(SourceKey, 5),
  /** Suppressed businesses are hidden unless asked for. */
  suppression: SuppressionFilter.default("exclude"),
  /** Businesses created or updated by this import. */
  importId: ObjectIdString.optional(),
  updatedAfter: IsoDateTime.optional(),
  /** Fit score range (inclusive). Unscored businesses never match a score filter. */
  fitMin: scoreBound,
  fitMax: scoreBound,
  /** Data confidence range (inclusive). */
  dataConfidenceMin: scoreBound,
  dataConfidenceMax: scoreBound,
});
export type BusinessListFilter = z.infer<typeof BusinessListFilter>;
/** What a client sends: every filter is optional. */
export type BusinessListFilterInput = Partial<BusinessListFilter>;

export const BusinessListQuery = BusinessListFilter.extend({
  /** `field:asc|desc`; default `updatedAt:desc`. */
  sort: sortQuery(BUSINESS_SORT_FIELDS),
  ...CursorQuery.shape,
});
export type BusinessListQuery = z.infer<typeof BusinessListQuery>;

/**
 * Shown in place of a business name whose only source has a retention limit that has
 * passed (for example Google Places content, which may not be stored). Detail views
 * return `name.value: null` with `state: "expired"` instead.
 */
export const EXPIRED_NAME_LABEL = "Name expired under source terms";

export const BusinessListItem = z.object({
  id: ObjectIdString,
  name: z.string(),
  slug: z.string(),
  categories: z.array(z.string()),
  location: z.object({
    formatted: z.string().nullable(),
    locality: z.string().nullable(),
    lga: z.string().nullable(),
    region: z.string().nullable(),
    country: z.string().nullable(),
  }),
  website: z
    .object({ value: z.string().nullable(), domain: z.string().nullable(), state: FieldState })
    .nullable(),
  /** Primary phone (best state first). */
  phone: z
    .object({
      value: z.string().nullable(),
      international: z.string().nullable(),
      state: FieldState,
      whatsapp: WhatsAppStatus,
    })
    .nullable(),
  phoneCount: z.number().int(),
  /** Primary email (best state first). */
  email: FieldSummary.nullable(),
  emailCount: z.number().int(),
  whatsapp: WhatsAppStatus,
  /** Field states for directory badges; `missing` when the business has no value. */
  states: z.object({
    /** `expired` when the name came only from a source whose retention ended; `name` is then EXPIRED_NAME_LABEL. */
    name: FieldState,
    website: FieldState,
    phone: FieldState,
    email: FieldState,
    location: FieldState,
  }),
  /** Fit score and data confidence (two separate numbers, 0 to 100); null until the business is scored. */
  score: z.object({ fit: z.number(), dataConfidence: z.number() }).nullable(),
  sources: z.array(SourceKey),
  sourceCount: z.number().int(),
  suppressed: z.boolean(),
  lastVerifiedAt: IsoDateTime.nullable(),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type BusinessListItem = z.infer<typeof BusinessListItem>;

// ---------------------------------------------------------------------------
// Facets
// ---------------------------------------------------------------------------

export const FacetBucket = z.object({
  /** Send this back as the filter value. */
  value: z.string(),
  label: z.string(),
  count: z.number().int(),
});
export type FacetBucket = z.infer<typeof FacetBucket>;

export const BusinessFacets = z.object({
  /** Non-suppressed businesses the counts are drawn from. */
  total: z.number().int(),
  categories: z.array(FacetBucket),
  regions: z.array(FacetBucket),
  localities: z.array(FacetBucket),
  sources: z.array(FacetBucket),
  whatsapp: z.array(FacetBucket),
  generatedAt: IsoDateTime,
  /** Facets are cached per organization for this many seconds. */
  maxAgeSeconds: z.number().int(),
});
export type BusinessFacets = z.infer<typeof BusinessFacets>;

// ---------------------------------------------------------------------------
// Detail
// ---------------------------------------------------------------------------

export const LocationValue = z.object({
  formatted: z.string().nullable(),
  street: z.string().nullable(),
  locality: z.string().nullable(),
  lga: z.string().nullable(),
  region: z.string().nullable(),
  country: z.string().nullable(),
  postalCode: z.string().nullable(),
});
export type LocationValue = z.infer<typeof LocationValue>;

export const BusinessNameField = fieldValue(z.string());
export type BusinessNameField = z.infer<typeof BusinessNameField>;

export const BusinessWebsiteField = fieldValue(z.string()).extend({
  domain: z.string().nullable(),
  alternatives: z.array(alternativeOf(z.string())),
});
export type BusinessWebsiteField = z.infer<typeof BusinessWebsiteField>;

export const BusinessLocationField = fieldValue(LocationValue).extend({
  alternatives: z.array(alternativeOf(LocationValue)),
});
export type BusinessLocationField = z.infer<typeof BusinessLocationField>;

export const WhatsAppInfo = z.object({
  status: WhatsAppStatus,
  evidenceObservationId: ObjectIdString.nullable(),
  assertedByUserId: UuidString.nullable(),
  assertedAt: IsoDateTime.nullable(),
});
export type WhatsAppInfo = z.infer<typeof WhatsAppInfo>;

export const BusinessPhoneField = fieldValue(z.string()).extend({
  /** Null only when the value has expired. */
  e164: z.string().nullable(),
  national: z.string().nullable(),
  international: z.string().nullable(),
  country: z.string().nullable(),
  type: PhoneType,
  whatsapp: WhatsAppInfo,
});
export type BusinessPhoneField = z.infer<typeof BusinessPhoneField>;

export const EmailVerification = z.object({
  method: z.string(),
  result: z.string(),
  checkedAt: IsoDateTime,
});

export const BusinessEmailField = fieldValue(z.string()).extend({
  /** Null only when the value has expired. */
  address: z.string().nullable(),
  domain: z.string(),
  /** free_mail (gmail.com and similar consumer providers) or business (any other domain). */
  kind: EmailKind,
  verification: EmailVerification.nullable(),
});
export type BusinessEmailField = z.infer<typeof BusinessEmailField>;

export const BusinessCategory = z.object({
  value: z.string(),
  key: z.string(),
  taxonomy: CategoryTaxonomy,
  observationIds: z.array(ObjectIdString),
});
export type BusinessCategory = z.infer<typeof BusinessCategory>;

export const BusinessSocial = FieldMeta.extend({
  platform: SocialPlatform,
  url: z.string(),
  handle: z.string().nullable(),
});
export type BusinessSocial = z.infer<typeof BusinessSocial>;

export const ObservationLicensing = z.object({
  /** Overture release, e.g. "2026-10-21.0". */
  release: z.string().nullable(),
  /** Upstream dataset as Overture names it, e.g. "meta" or "Foursquare". */
  dataset: z.string().nullable(),
  /** The record id in the upstream dataset (for Meta, the Facebook page id). */
  recordId: z.string().nullable(),
  license: DataLicenseId.nullable(),
  /** API path of the licence text. */
  licenseTextPath: z.string().nullable(),
});
export type ObservationLicensing = z.infer<typeof ObservationLicensing>;

export const Observation = z.object({
  id: ObjectIdString,
  businessId: ObjectIdString,
  source: SourceKey,
  /** URL, API path or internal reference such as `import:<id>`. */
  sourceRef: z.string().nullable(),
  field: ObservationField,
  /** Which value of a multi-valued field (E.164 phone, email address); null otherwise. */
  fieldKey: z.string().nullable(),
  rawValue: z.string().nullable(),
  normalizedValue: z
    .union([z.string(), z.record(z.string(), z.unknown()), z.array(z.string())])
    .nullable(),
  collectedAt: IsoDateTime,
  collectionMethod: CollectionMethod,
  verification: z
    .object({
      method: z.string(),
      status: z.enum(["verified", "unverified", "failed"]),
      checkedAt: IsoDateTime,
      details: z.string().nullable(),
    })
    .nullable(),
  confidence: z.number(),
  importId: ObjectIdString.nullable(),
  actor: z.object({ type: z.enum(["user", "system"]), userId: UuidString.nullable() }),
  /** Free-text note supplied with a correction. */
  note: z.string().nullable(),
  /** "remove" when a correction deleted the value; otherwise "set". */
  action: z.enum(["set", "remove"]),
  /** True when the value was removed under a retention policy; metadata is kept. */
  redacted: z.boolean(),
  /** Source record id, e.g. a Google place ID; null for imports and edits. */
  sourceExternalId: z.string().nullable(),
  /** Discovery job that collected the value; null otherwise. */
  discoveryJobId: ObjectIdString.nullable(),
  /** End of the source's retention window for the value; null when unlimited. */
  retainValueUntil: IsoDateTime.nullable(),
  /** Attribution the source requires next to this value, e.g. "Google Maps". */
  attribution: z.string().nullable(),
  /** Enrichment run that collected the value (website observations); null otherwise. */
  enrichmentRunId: ObjectIdString.nullable(),
  /** Where on the page a website value was found: page URL, CSS selector and a short text snippet. */
  evidence: z.object({ page: z.string(), selector: z.string(), snippet: z.string() }).nullable(),
  /**
   * Open-data provenance (Overture observations): the release the value came from, the upstream
   * dataset and its record id, and the licence. Null for other sources.
   */
  licensing: ObservationLicensing.nullable(),
});
export type Observation = z.infer<typeof Observation>;

export const VerificationEvent = z.object({
  id: ObjectIdString,
  businessId: ObjectIdString,
  field: ObservationField,
  fieldKey: z.string().nullable(),
  method: z.string(),
  result: z.enum(["passed", "failed", "inconclusive"]),
  details: z.string().nullable(),
  actorType: z.enum(["system", "user"]),
  actorId: z.string().nullable(),
  occurredAt: IsoDateTime,
});
export type VerificationEvent = z.infer<typeof VerificationEvent>;

export const SuppressionScope = z.enum(["business", "domain", "phone", "email"]);
export type SuppressionScope = z.infer<typeof SuppressionScope>;

export const SuppressionEntry = z.object({
  id: ObjectIdString,
  kind: SuppressionScope,
  value: z.string(),
  reason: z.string(),
  createdByUserId: UuidString.nullable(),
  createdAt: IsoDateTime,
});
export type SuppressionEntry = z.infer<typeof SuppressionEntry>;

export const SourceSummaryItem = z.object({
  source: SourceKey,
  observationCount: z.number().int(),
  firstSeenAt: IsoDateTime,
  lastSeenAt: IsoDateTime,
});
export type SourceSummaryItem = z.infer<typeof SourceSummaryItem>;

export const BusinessDetail = z.object({
  id: ObjectIdString,
  slug: z.string(),
  name: BusinessNameField,
  categories: z.array(BusinessCategory),
  location: BusinessLocationField,
  website: BusinessWebsiteField,
  phones: z.array(BusinessPhoneField),
  emails: z.array(BusinessEmailField),
  socials: z.array(BusinessSocial),
  whatsapp: WhatsAppStatus,
  /** Field-level summary states (`missing` when absent). */
  states: z.object({
    name: FieldState,
    website: FieldState,
    phone: FieldState,
    email: FieldState,
    location: FieldState,
  }),
  sources: z.array(SourceSummaryItem),
  provenance: z.object({
    totalObservations: z.number().int(),
    /** Newest first, at most 20. Page through GET /businesses/:id/observations for more. */
    recent: z.array(Observation),
  }),
  recentVerificationEvents: z.array(VerificationEvent),
  suppression: z.object({
    suppressed: z.boolean(),
    reason: z.string().nullable(),
    suppressedAt: IsoDateTime.nullable(),
    suppressedByUserId: UuidString.nullable(),
    entries: z.array(SuppressionEntry),
  }),
  /** Score snapshot with its per-signal breakdown and explanation; null until scored. */
  score: ScoreSnapshot.nullable(),
  /** Latest website analysis (status and high-confidence opportunities); null when none ran. */
  latestAnalysis: AnalysisSummary.nullable(),
  dedup: z.object({
    status: z.enum(["unique", "has_candidates", "merged_into"]),
    candidateCount: z.number().int(),
    /** Businesses merged into this one (their provenance is listed with this business). */
    absorbedIds: z.array(ObjectIdString),
  }),
  createdVia: z.object({
    kind: z.enum(["import", "manual", "discovery", "seed"]),
    importId: ObjectIdString.nullable(),
    userId: UuidString.nullable(),
    discoveryJobId: ObjectIdString.nullable(),
  }),
  /**
   * Source records this business is linked to (for example a Google place ID, which may be
   * kept indefinitely so the record can be refreshed).
   */
  externalRefs: z.array(
    z.object({
      source: SourceKey,
      externalId: z.string(),
      lastFetchedAt: IsoDateTime,
      expiresAt: IsoDateTime.nullable(),
      /** Open-data snapshot release the record was last read from (Overture); null otherwise. */
      release: z.string().nullable(),
      /** Upstream dataset and its record id behind the source record (Overture); null otherwise. */
      dataset: z.string().nullable(),
      recordId: z.string().nullable(),
      license: DataLicenseId.nullable(),
      /**
       * active: the source still publishes the record. retired: it was missing from the latest
       * snapshot (Overture removes records, partly for erasure requests); review its values before
       * use. unknown: the source keeps no snapshot to check against.
       */
      status: z.enum(["active", "retired", "unknown"]),
    }),
  ),
  /**
   * Attribution this record must show wherever its data is displayed or shared: one entry per
   * source that requires it, with the verbatim lines and the licences that apply to this record.
   */
  attributions: z.array(
    z.object({
      source: SourceKey,
      text: z.string(),
      lines: z.array(z.string()),
      licenses: z.array(DataLicenseRef),
    }),
  ),
  /** The organization freshness window used to derive `stale`. */
  freshnessDays: z.number().int(),
  lastVerifiedAt: IsoDateTime.nullable(),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type BusinessDetail = z.infer<typeof BusinessDetail>;

// ---------------------------------------------------------------------------
// Provenance queries
// ---------------------------------------------------------------------------

export const ObservationListQuery = z.object({
  field: ObservationField.optional(),
  source: SourceKey.optional(),
  ...CursorQuery.shape,
});
export type ObservationListQuery = z.infer<typeof ObservationListQuery>;

export const VerificationEventListQuery = CursorQuery;
export type VerificationEventListQuery = z.infer<typeof VerificationEventListQuery>;

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

const note = z.string().trim().max(500).optional();
const nullableText = (max: number) => z.string().trim().max(max).nullable().optional();

export const LocationInput = z.object({
  street: nullableText(300),
  locality: nullableText(120),
  lga: nullableText(120),
  region: nullableText(120),
  country: CountryCode.nullable().optional(),
  postalCode: nullableText(20),
});
export type LocationInput = z.infer<typeof LocationInput>;

/**
 * A correction records a `user_edit` observation and updates the canonical value. The
 * corrected value is `unverified` until a verification method confirms it.
 * For phones and emails: no `target` adds a value; `target` with a value replaces it;
 * `target` with `value: null` removes it.
 */
export const CorrectionRequest = z.discriminatedUnion("field", [
  z.object({ field: z.literal("name"), value: z.string().trim().min(1).max(200), note }),
  z.object({
    field: z.literal("website"),
    value: z.string().trim().min(1).max(2048).nullable(),
    note,
  }),
  z
    .object({
      field: z.literal("phone"),
      target: z.string().trim().min(3).max(40).optional(),
      value: z.string().trim().min(3).max(40).nullable(),
      /** Parsing region for numbers without a country code; defaults to the business or org country. */
      country: CountryCode.optional(),
      note,
    })
    .refine((v) => v.value !== null || v.target !== undefined, {
      message: "Removing a phone requires target",
      path: ["target"],
    }),
  z
    .object({
      field: z.literal("email"),
      target: z.string().trim().min(3).max(254).optional(),
      value: z.string().trim().min(3).max(254).nullable(),
      note,
    })
    .refine((v) => v.value !== null || v.target !== undefined, {
      message: "Removing an email requires target",
      path: ["target"],
    }),
  z.object({
    field: z.literal("whatsapp"),
    /** E.164 of an existing phone on the business. */
    target: z.string().trim().min(3).max(40),
    /** `confirmed` needs explicit evidence and cannot be set by hand. */
    value: z.enum(["user_asserted", "unknown"]),
    note,
  }),
  z.object({
    field: z.literal("categories"),
    value: z.array(z.string().trim().min(1).max(80)).max(10),
    note,
  }),
  z.object({ field: z.literal("location"), value: LocationInput, note }),
]);
export type CorrectionRequest = z.infer<typeof CorrectionRequest>;
export type CorrectionField = CorrectionRequest["field"];

export const CreateBusinessRequest = z.object({
  name: z.string().trim().min(1).max(200),
  categories: z.array(z.string().trim().min(1).max(80)).max(10).default([]),
  website: z.string().trim().min(1).max(2048).optional(),
  phones: z.array(z.string().trim().min(3).max(40)).max(10).default([]),
  emails: z.array(z.string().trim().min(3).max(254)).max(10).default([]),
  location: LocationInput.optional(),
  /** Parsing region for phone numbers without a country code. Defaults to the org country. */
  country: CountryCode.optional(),
  note,
});
export type CreateBusinessRequest = z.infer<typeof CreateBusinessRequest>;

export const SuppressRequest = z.object({
  scope: SuppressionScope,
  reason: z.string().trim().min(3).max(500),
  /**
   * For phone and email scopes: which value to suppress (defaults to the primary one).
   * Ignored for business and domain scopes.
   */
  value: z.string().trim().min(3).max(254).optional(),
});
export type SuppressRequest = z.infer<typeof SuppressRequest>;

// ---------------------------------------------------------------------------
// Bulk suppression
// ---------------------------------------------------------------------------

/** Most businesses one bulk suppress request may name. */
export const BULK_SUPPRESS_MAX = 100;

/**
 * `POST /businesses/suppress`: suppress many businesses in one request. Each business is
 * handled like `POST /businesses/:id/suppress` (phone and email scopes use its primary value);
 * results are per item, so one bad id never fails the others.
 */
export const BulkSuppressRequest = z.object({
  ids: z
    .array(ObjectIdString)
    .min(1)
    .max(BULK_SUPPRESS_MAX, `At most ${BULK_SUPPRESS_MAX} businesses per request`)
    .refine(
      (ids) => new Set(ids.map((i) => i.toLowerCase())).size === ids.length,
      "Each business can be listed once",
    ),
  scope: SuppressionScope,
  reason: z.string().trim().min(3).max(500),
});
export type BulkSuppressRequest = z.infer<typeof BulkSuppressRequest>;

/**
 * - suppressed: a suppression entry was added (or the existing one for this value was reused) and
 *   the business, plus any business sharing the value, is flagged.
 * - already_suppressed: the business was already flagged by an entry for this scope and value.
 * - not_found: no live business with this id in the organization.
 * - no_value: the business has no value for the scope (no website domain, phone or email).
 * - failed: an unexpected error; retry the item.
 */
export const BulkSuppressOutcome = z.enum([
  "suppressed",
  "already_suppressed",
  "not_found",
  "no_value",
  "failed",
]);
export type BulkSuppressOutcome = z.infer<typeof BulkSuppressOutcome>;

export const BulkSuppressResult = z.object({
  results: z.array(
    z.object({
      id: ObjectIdString,
      outcome: BulkSuppressOutcome,
      /** The suppressed value (business id, domain, E.164 phone or email); null when nothing was suppressed. */
      value: z.string().nullable(),
      entryId: ObjectIdString.nullable(),
      message: z.string().nullable(),
    }),
  ),
  summary: z.object({
    requested: z.number().int(),
    suppressed: z.number().int(),
    alreadySuppressed: z.number().int(),
    notFound: z.number().int(),
    noValue: z.number().int(),
    failed: z.number().int(),
    /** Businesses flagged in total, including others that share a suppressed domain, phone or email. */
    businessesAffected: z.number().int(),
  }),
});
export type BulkSuppressResult = z.infer<typeof BulkSuppressResult>;
