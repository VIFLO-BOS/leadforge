import type { ObjectId } from "@leadforge/db-mongo";
import type {
  AnalysisStatus,
  CategoryTaxonomy,
  DataLicenseId,
  FieldState,
  OpportunityKey,
  PhoneType,
  ScoringSignal,
  SocialPlatform,
  SourceKey,
  WhatsAppStatus,
} from "@leadforge/contracts";

/** States persisted on a field. `stale`, `expired` and `missing` are derived at read time. */
export type StoredFieldState = "verified" | "unverified" | "conflicting";

export interface StoredFieldMeta {
  state: StoredFieldState;
  confidence: number;
  observationIds: ObjectId[];
  lastObservedAt: Date | null;
  lastVerifiedAt: Date | null;
  expiresAt: Date | null;
}

export interface StoredAlternative<T> {
  value: T;
  rawValue: string | null;
  observationIds: ObjectId[];
  lastObservedAt: Date | null;
  /** Retention end when the alternative came only from a retention-limited source. */
  expiresAt?: Date | null;
}

export interface StoredLocationValue {
  formatted: string | null;
  street: string | null;
  locality: string | null;
  lga: string | null;
  region: string | null;
  country: string | null;
  postalCode: string | null;
}

export interface StoredName extends StoredFieldMeta {
  value: string;
  rawValue: string | null;
  normalized: string;
}

export interface StoredLocation extends StoredFieldMeta, StoredLocationValue {
  rawValue: string | null;
  regionKey: string | null;
  localityKey: string | null;
  lgaKey: string | null;
  alternatives: StoredAlternative<StoredLocationValue>[];
}

export interface StoredWebsite extends StoredFieldMeta {
  value: string;
  rawValue: string | null;
  domain: string;
  alternatives: StoredAlternative<string>[];
}

export interface StoredWhatsApp {
  status: WhatsAppStatus;
  evidenceObservationId: ObjectId | null;
  assertedByUserId: string | null;
  assertedAt: Date | null;
}

export interface StoredPhone extends StoredFieldMeta {
  e164: string;
  raw: string | null;
  national: string | null;
  international: string | null;
  country: string | null;
  type: PhoneType;
  whatsapp: StoredWhatsApp;
}

export interface StoredEmail extends StoredFieldMeta {
  address: string;
  raw: string | null;
  domain: string;
  verification: { method: string; result: string; checkedAt: Date } | null;
}

export interface StoredSocial extends StoredFieldMeta {
  platform: SocialPlatform;
  url: string;
  handle: string | null;
  raw: string | null;
}

export interface StoredCategory {
  value: string;
  key: string;
  taxonomy: CategoryTaxonomy;
  observationIds: ObjectId[];
  /** Retention end when the category came only from a retention-limited source. */
  expiresAt?: Date | null;
}

/** A source record the business is linked to (Google place ID, Overture GERS id). */
export interface StoredExternalRef {
  source: SourceKey;
  externalId: string;
  lastFetchedAt: Date;
  expiresAt: Date | null;
  /**
   * Other keys of the same real place (Overture: `gers:<id>` of every duplicate and the upstream
   * `up:<dataset>:<record id>`). A later record with any of these keys is the same place.
   */
  matchKeys?: string[];
  /** Discovery job that first linked the record (records it links are not "already in the directory" for it). */
  discoveryJobId?: ObjectId | null;
  /** Open-data provenance (Overture): release, upstream dataset and record, licence. */
  release?: string | null;
  dataset?: string | null;
  recordId?: string | null;
  license?: DataLicenseId | null;
}

/** Score snapshot (PRODUCT_REQUIREMENTS section 7): fit and data confidence are separate numbers. */
export interface StoredScore {
  fit: number;
  dataConfidence: number;
  computedAt: Date;
  profileId: ObjectId;
  profileVersion: number;
  breakdown: Array<{
    signal: ScoringSignal;
    weight: number;
    value: number;
    points: number;
    detail: string;
  }>;
  dataConfidenceFields: Array<{
    field: "name" | "website" | "phone" | "email" | "location";
    state: FieldState;
    confidence: number;
    quality: number;
  }>;
  summary: string;
}

/** Latest website analysis, embedded for scoring and the directory. */
export interface StoredAnalysisSummary {
  analysisId: ObjectId;
  status: AnalysisStatus;
  analyzedAt: Date | null;
  /** Opportunity keys with confidence of at least 0.7 (scoring signal). */
  opportunities: OpportunityKey[];
}

export interface BusinessDocument {
  _id: ObjectId;
  organizationId: string;
  name: StoredName;
  slug: string;
  categories: StoredCategory[];
  location: StoredLocation;
  website: StoredWebsite | null;
  phones: StoredPhone[];
  emails: StoredEmail[];
  socials: StoredSocial[];
  externalRefs: StoredExternalRef[];
  /** First and last time each source contributed an observation. */
  sourceSeen: Partial<Record<SourceKey, { firstSeenAt: Date; lastSeenAt: Date }>>;
  sources: SourceKey[];
  importIds: ObjectId[];
  whatsappStatus: WhatsAppStatus;
  lastVerifiedAt: Date | null;
  lastObservedAt: Date | null;
  /** Derived snapshot; written without bumping `version` (see BusinessRepository.setScore). */
  score: StoredScore | null;
  latestAnalysis?: StoredAnalysisSummary | null;
  dedup: {
    status: "unique" | "has_candidates" | "merged_into";
    mergedIntoId: ObjectId | null;
    candidateCount: number;
    /** Businesses merged into this one; their observations are listed with it. */
    absorbedIds?: ObjectId[];
  };
  /** Similarity blocking keys (`<name token>|l:<locality>` and `|g:<lga>`), derived on every write. */
  dedupKeys?: string[];
  flags: {
    suppressed: boolean;
    suppressedReason: string | null;
    suppressedAt: Date | null;
    suppressedByUserId: string | null;
    doNotContact: boolean;
  };
  search: { tokens: string[] };
  createdVia: {
    kind: "import" | "manual" | "discovery" | "seed";
    importId: ObjectId | null;
    userId: string | null;
    discoveryJobId?: ObjectId | null;
  };
  /** Earliest `expiresAt` across stored values; drives the retention purge. Null when nothing expires. */
  retention?: { nextExpiryAt: Date | null };
  /** Optimistic concurrency: every replace must match the version it read. */
  version: number;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

/** Observation cap per field (docs/DATABASE_DESIGN.md section 2). */
export const OBSERVATION_IDS_CAP = 50;
