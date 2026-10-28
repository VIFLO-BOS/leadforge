import type { ObjectId } from "@leadforge/db-mongo";
import type { DataLicenseId, EmailKind, PhoneType, SocialPlatform } from "@leadforge/contracts";

/**
 * One Overture place as read from a release (DuckDB over the published GeoParquet, a local
 * Parquet file, or the JSON fixtures). Column names follow the flattened extract the research
 * produced (`names.primary` as `name`, `taxonomy.*` as `taxonomy_*`, `brand.*` as `brand_*`,
 * the point as `lon`/`lat`); everything else is the Overture places schema v2.0.0.
 */
export interface OvertureRawSource {
  property: string | null;
  dataset: string | null;
  license: string | null;
  record_id: string | null;
  update_time: string | null;
  confidence: number | null;
  provider?: string | null;
  resource?: string | null;
  version?: string | null;
}

export interface OvertureRawAddress {
  freeform: string | null;
  locality: string | null;
  postcode: string | null;
  region: string | null;
  country: string | null;
}

export interface OvertureRawPlace {
  id: string;
  version: number | null;
  name: string | null;
  basic_category: string | null;
  taxonomy_primary: string | null;
  taxonomy_hierarchy: string[] | null;
  taxonomy_alternates: string[] | null;
  confidence: number | null;
  operating_status: string | null;
  websites: string[] | null;
  phones: string[] | null;
  emails: string[] | null;
  socials: string[] | null;
  brand_name: string | null;
  brand_wikidata: string | null;
  addresses: OvertureRawAddress[] | null;
  lon: number | null;
  lat: number | null;
  sources: OvertureRawSource[] | null;
}

/** A division area (state or LGA polygon) from the Overture divisions theme. */
export interface OvertureDivision {
  /** division_area id. */
  id: string;
  /** The division feature the area belongs to. */
  divisionId: string | null;
  /** `region` (state) or `county` (LGA) for Nigeria. */
  subtype: string;
  name: string;
  /** ISO 3166-2 code of the region, e.g. NG-LA (also set on LGAs). */
  region: string | null;
  country: string | null;
  /** WKB Polygon or MultiPolygon in lon/lat. */
  wkb: Uint8Array;
}

/** A release to load: where it came from, its places (in batches) and its division polygons. */
export interface OvertureSnapshot {
  release: string;
  schemaVersion: string | null;
  /** `s3`, `azure`, `local` or `fixture`, with the location for the run record. */
  origin: { kind: "s3" | "azure" | "local" | "fixture"; location: string };
  divisions: OvertureDivision[];
  places: AsyncIterable<OvertureRawPlace[]>;
  /** Rows the reader expects (for the sanity check), when known up front. */
  expectedRows: number | null;
  /** Called after the load, success or not (closes DuckDB). */
  close?: () => Promise<void>;
}

export type WebsiteKind = "website" | "social" | "messaging" | "link_hub" | "shortener" | "invalid";

/**
 * Staging catalogue row (collection `overture_places`): one Overture place, normalized once at
 * sync time. Platform-level reference data, not organization data: see OverturePlaceRepository.
 */
export interface OverturePlaceDocument {
  /** GERS id (UUID). */
  _id: string;
  /**
   * Release the stored values were last written from. Unchanged places are not rewritten when a
   * new release confirms them: every place that is not retired is in the latest loaded release
   * (the sync retires the ones a release drops), so discovery takes freshness from the snapshot.
   */
  release: string;
  schemaVersion: string | null;
  firstSeenRelease: string;
  /** Set when a later release no longer contains the place; the row is kept, never deleted. */
  retiredAt: Date | null;
  retiredInRelease: string | null;
  featureVersion: number | null;
  /** sha256 of the normalized payload; unchanged rows are not rewritten. */
  contentHash: string;
  name: string;
  nameKey: string;
  nameTokens: string[];
  basicCategory: string | null;
  taxonomy: { primary: string | null; hierarchy: string[]; alternates: string[] };
  /** hierarchy ∪ alternates: matching any node matches its whole subtree. */
  categoryNodes: string[];
  confidence: number;
  operatingStatus: string | null;
  closed: boolean;
  phones: Array<{
    raw: string;
    e164: string | null;
    type: PhoneType | null;
    country: string | null;
  }>;
  emails: Array<{
    raw: string;
    address: string | null;
    domain: string | null;
    kind: EmailKind | null;
  }>;
  websites: Array<{ raw: string; url: string | null; domain: string | null; kind: WebsiteKind }>;
  socials: Array<{
    raw: string;
    platform: SocialPlatform | null;
    url: string | null;
    handle: string | null;
  }>;
  brand: { name: string | null; wikidata: string | null } | null;
  address: {
    freeform: string | null;
    locality: string | null;
    localityKey: string | null;
    /** Six digits, or null (Overture postcodes include "+234" and "<<not-applicable>>"). */
    postcode: string | null;
    regionRaw: string | null;
    country: string | null;
  };
  /** Words of the street address and locality, for `location.query`. */
  addressTokens: string[];
  /** State and LGA by point-in-polygon against Overture division boundaries. */
  admin: {
    stateName: string | null;
    stateKey: string | null;
    stateCode: string | null;
    lgaName: string | null;
    lgaKey: string | null;
    regionDivisionId: string | null;
    countyDivisionId: string | null;
  };
  location: { type: "Point"; coordinates: [number, number] } | null;
  /** The whole-feature source item (`property: ""`): the upstream dataset and its record. */
  rootSource: {
    dataset: string | null;
    recordId: string | null;
    license: DataLicenseId | null;
    licenseRaw: string | null;
    updateTime: Date | null;
    provider: string | null;
    version: string | null;
  };
  sources: Array<{
    property: string;
    dataset: string | null;
    license: string | null;
    recordId: string | null;
    updateTime: string | null;
    provider: string | null;
    resource: string | null;
    version: string | null;
  }>;
  licenses: DataLicenseId[];
  /** `up:<dataset>:<record id>` of the upstream record (null for Overture-only rows). */
  upstreamKey: string | null;
  /** `fb:<page id>` for numeric Facebook page ids the place lists (or is). */
  socialKeys: string[];
  /** Representative place of its duplicate group (same upstream record, or same Facebook page and name across datasets). */
  canonicalId: string;
  isCanonical: boolean;
  /** Keys of every place in the group: `gers:<id>` and their upstream keys. Stored on linked businesses. */
  groupKeys: string[];
  contacts: { phone: boolean; email: boolean; website: boolean; any: boolean; score: number };
  /** Canonical, not retired, not closed: the only rows discovery offers. */
  offerable: boolean;
  syncRunId: ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

export type OvertureSyncStatus =
  "running" | "completed" | "completed_with_warnings" | "failed" | "skipped";

export interface OvertureSyncCounts {
  read: number;
  /** Rows dropped before staging (no id, outside Nigeria, no name). */
  invalid: number;
  inserted: number;
  updated: number;
  unchanged: number;
  retired: number;
  /** Retired rows that came back in this release. */
  restored: number;
  withoutState: number;
  withoutLga: number;
  /** Duplicate groups (more than one place) and the places they hide from discovery. */
  duplicateGroups: number;
  duplicatesHidden: number;
  offerable: number;
  live: number;
}

export interface OvertureSyncSummary {
  states: Array<{
    key: string;
    name: string;
    code: string | null;
    places: number;
    lgas: Array<{ key: string; name: string; places: number }>;
  }>;
  /** Offerable places per taxonomy node (any level). */
  categories: Array<{ node: string; places: number }>;
}

/** One sync attempt (collection `overture_sync_runs`). */
export interface OvertureSyncRunDocument {
  _id: ObjectId;
  release: string;
  schemaVersion: string | null;
  origin: { kind: string; location: string };
  trigger: "schedule" | "manual" | "test";
  status: OvertureSyncStatus;
  counts: OvertureSyncCounts;
  warnings: string[];
  error: string | null;
  summary: OvertureSyncSummary | null;
  startedAt: Date;
  /** Refreshed every 30 seconds while the run is `running`; a run silent for 10 minutes is treated as dead. */
  heartbeatAt: Date | null;
  finishedAt: Date | null;
  durationMs: number | null;
}
