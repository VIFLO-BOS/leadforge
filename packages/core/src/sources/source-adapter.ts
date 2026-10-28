import type {
  CategoryTaxonomy,
  CollectionMethod,
  DataLicenseId,
  DiscoveryIssueCode,
  DiscoveryJobSpec,
  DiscoverySourceKey,
  DiscoverySourceOption,
  ErrorDetail,
  FieldRetention,
  ObservationField,
  SourceLicensing,
  SourceStatus,
  SourceStatusReason,
  SourceTermsReference,
} from "@leadforge/contracts";
import type { BusinessInput } from "../businesses/business-input.js";

/**
 * Source adapter contract (docs/IMPLEMENTATION_PLAN.md Phase 3, brief Prompt 6). One adapter
 * per permitted discovery source. The discovery runner only talks to sources through this
 * interface, so adding a source never touches job orchestration, billing or ingest.
 *
 * - describe(): identity, permitted method, configuration status. Never claims to work when
 *   credentials are missing.
 * - policy: retention per field, attribution, rate limits, terms checked.
 * - validateSpec(): source-specific restrictions on a job spec.
 * - estimate(): upper bounds (queries, results, requests) for the wizard and the credit hold;
 *   exact counts when the source can give them (Overture counts its staging catalogue).
 * - search(): query execution and pagination as an async iterator of pages, resumable from a cursor.
 *   With an organization context, records already in the organization's directory are left out.
 * - refreshState(): optional; refreshes whatever describe() reports (Overture: the loaded snapshot).
 * - fetchRecord(): one record by id (used by retry-failed).
 * - mapToObservations(): extraction and normalization into a BusinessInput plus the provenance
 *   (source reference, retention end, attribution) every resulting observation carries.
 *
 * Errors are thrown as SourceError with a stable code and a retryable flag.
 */
export interface SourceAdapter<R = unknown> {
  readonly key: DiscoverySourceKey;
  readonly policy: SourcePolicy;
  describe(): SourceDescription;
  validateSpec(spec: DiscoveryJobSpec): ErrorDetail[];
  estimate(
    spec: DiscoveryJobSpec,
    context?: SourceOrgContext,
  ): SourceEstimate | Promise<SourceEstimate>;
  search(spec: DiscoveryJobSpec, options?: SearchOptions): AsyncIterable<SourcePage<R>>;
  refreshState?(): Promise<void>;
  fetchRecord(externalId: string, spec: DiscoveryJobSpec, signal?: AbortSignal): Promise<R | null>;
  mapToObservations(record: R, ctx: MapContext): MappedRecord;
}

export interface SourceDescription {
  key: DiscoverySourceKey;
  name: string;
  kind: "discovery";
  method: "api";
  status: Extract<SourceStatus, "configured" | "not_configured" | "not_available">;
  /** Why the source cannot run; null when it can. */
  statusReason?: SourceStatusReason | null;
  statusDetail: string;
  fieldsProvided: ObservationField[];
  coverage: string;
  docsUrl: string | null;
  /** Development and test only: responses come from hand-built fixtures, not the provider. */
  fixtureMode: boolean;
  /** Most records one query can return (Google Text Search: 60; 0 when uncapped). */
  maxResultsPerQuery: number;
  /** Spec fields the source honours (wizard controls); defaults to Google's. */
  specSupport?: DiscoverySourceOption["specSupport"];
  /** Loaded open-data snapshot, for snapshot sources. */
  snapshot?: { release: string; syncedAt: Date; places: number; offerable: number } | null;
  /** `dataset_snapshot` for open-data snapshots; `api` otherwise (the registry's `method`). */
  collectionMethod?: Extract<CollectionMethod, "api" | "dataset_snapshot">;
}

export interface SourcePolicy {
  /** One-sentence storage rule for the Sources page. */
  storage: string;
  /**
   * How long collected content values may be kept, in milliseconds after collection.
   * 0: they expire when collected (no storage permission). null: no limit.
   */
  contentRetentionMs: number | null;
  /** How long the source's record id may be kept (null: indefinitely). */
  externalIdRetentionMs: number | null;
  fieldRetention: FieldRetention[];
  /** Short attribution label shown next to the source's data, e.g. "Google Maps". */
  attribution: string | null;
  attributionText: string;
  /** LeadForge's own limiter for calls to the source (shared by every organization). */
  rateLimit: { requestsPerSecond: number; burst: number; description: string };
  lawfulBasis: string;
  /** ISO date the terms below were last checked. */
  termsCheckedAt: string | null;
  terms: SourceTermsReference[];
  /** Attribution and licences required with the source's data (registry, wizard, licences page). */
  licensing?: SourceLicensing | null;
  /**
   * Set when the provider's terms forbid LeadForge's use: the registry reports the source as
   * `not_available` with reason `provider_terms` and it can never run, whatever its configuration.
   */
  blockedByTerms?: { detail: string } | null;
}

/** Position in a search: which query of the plan, which page, and the provider's page token. */
export interface SearchCursor {
  queryIndex: number;
  pageIndex: number;
  pageToken: string | null;
}

export interface SearchOptions {
  /** Resume from this cursor (the first page by default). */
  from?: SearchCursor;
  signal?: AbortSignal;
  /** The organization the job runs for: records already in its directory are left out. */
  context?: SourceOrgContext;
}

/** A candidate record: its id and the keys of the same real place (other ids, upstream records). */
export interface LinkCandidate {
  externalId: string;
  matchKeys: string[];
}

/**
 * Organization view for snapshot sources (supplied by the discovery engine). Records linked to a
 * business by the current job are not reported, so reprocessing a page stays idempotent.
 */
export interface SourceOrgContext {
  organizationId: string;
  /** External ids among these candidates already linked to a live business in the organization. */
  linkedAmong(candidates: LinkCandidate[]): Promise<Set<string>>;
  /** Every match key of this source's links in the organization, or null above `limit` (estimate only). */
  linkedMatchKeys(limit: number): Promise<string[] | null>;
}

export interface SourcePage<R> {
  cursor: SearchCursor;
  /** Where the next page starts, or null when the search is exhausted. */
  nextCursor: SearchCursor | null;
  records: R[];
}

export interface SourceEstimate {
  queries: number;
  maxResults: number;
  maxRequests: number;
  providerSku: string | null;
  fields: string[];
  warnings: string[];
  /** True when maxResults is an exact count. */
  exact?: boolean;
  /** Matching records left out because the organization already has them. */
  alreadyInDirectory?: number;
}

export interface MapContext {
  spec: DiscoveryJobSpec;
  collectedAt: Date;
}

export interface MappedRecord {
  externalId: string;
  /** Null when the record is skipped (see `skip`). */
  input: BusinessInput | null;
  skip: { code: DiscoveryIssueCode; message: string } | null;
  warnings: Array<{ code: DiscoveryIssueCode; message: string }>;
  provenance: {
    sourceRef: string;
    /** Retention end for the content values (field expiresAt and observation retainValueUntil). */
    expiresAt: Date | null;
    /** Retention end for the record id kept on the business; null when indefinite. */
    externalIdExpiresAt: Date | null;
    categoryTaxonomy: CategoryTaxonomy;
    /** Required attribution, including third-party providers named by the source. */
    attribution: string | null;
    /** Observation collection method (default `api`). */
    collectionMethod?: CollectionMethod;
    /** Observation confidence (default: the source's base confidence). */
    confidence?: number;
    /** When the source observed the values (field freshness); defaults to the collection time. */
    observedAt?: Date | null;
    /** Stored on every observation's metadata (release, upstream record, licence). */
    metadata?: Record<string, unknown>;
    /** Other keys of the same real place (dedup against the directory). */
    matchKeys?: string[];
    /** Open-data provenance kept on the business's source reference. */
    ref?: {
      release: string | null;
      dataset: string | null;
      recordId: string | null;
      license: DataLicenseId | null;
    };
  };
}

/** A source call failed. `retryable` errors are retried with backoff; others end the source's run. */
export class SourceError extends Error {
  constructor(
    readonly code: DiscoveryIssueCode,
    message: string,
    readonly retryable: boolean,
    readonly httpStatus: number | null = null,
  ) {
    super(message);
    this.name = "SourceError";
  }
}

/** Injection token for the list of discovery source adapters. */
export const SOURCE_ADAPTERS = Symbol("SOURCE_ADAPTERS");
