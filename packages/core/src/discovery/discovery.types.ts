import type { ObjectId } from "@leadforge/db-mongo";
import type {
  DiscoveryItemOutcome,
  DiscoveryJobSpec,
  DiscoveryJobStatus,
  DiscoverySourceKey,
  DiscoverySourceOutcome,
} from "@leadforge/contracts";

export type DiscoveryRoundMode = "search" | "retry";

/** Credits for one run of the job (round 0) or one retry-failed (round n). */
export interface DiscoveryRoundCredits {
  round: number;
  holdKey: string;
  holdId: string | null;
  heldUnits: number;
  capturedUnits: number;
  releasedUnits: number;
  settledAt: Date | null;
}

/** A unit of work in a round: a source's search chain, or a batch of failed items to re-fetch. */
export interface DiscoveryUnit {
  key: string;
  source: DiscoverySourceKey;
  externalIds?: string[];
}

export interface DiscoveryIssueDocument {
  code: string;
  message: string;
  at: Date;
  source: DiscoverySourceKey | null;
}

export interface DiscoveryJobDocument {
  _id: ObjectId;
  organizationId: string;
  name: string;
  status: DiscoveryJobStatus;
  spec: DiscoveryJobSpec;
  /** Hash of the normalized spec; a replayed Idempotency-Key must carry the same spec. */
  specHash: string;
  idempotencyKey: string | null;
  /** Billable records the current round may produce (and the credits it holds). */
  limit: number;
  estimate: { maxRecords: number; hold: number; basis: string };
  /** Snapshot release each open-data source read from at creation (absent on jobs before Overture). */
  sourceReleases?: Array<{ source: DiscoverySourceKey; release: string }>;
  round: number;
  roundMode: DiscoveryRoundMode;
  units: DiscoveryUnit[];
  /** Unit keys of the current round that have not finished. */
  pendingUnits: string[];
  credits: { rounds: DiscoveryRoundCredits[]; settledAt: Date | null };
  progress: {
    processed: number;
    created: number;
    updated: number;
    duplicates: number;
    skipped: number;
    failed: number;
    billable: number;
    pagesFetched: number;
    lastEventAt: Date | null;
  };
  /** Pages already counted (`<source>:<query>:<page>`), so a retried page is not counted twice. */
  pageKeys: string[];
  sourceOutcomes: Array<Omit<DiscoverySourceOutcome, "source"> & { source: DiscoverySourceKey }>;
  errors: DiscoveryIssueDocument[];
  warnings: DiscoveryIssueDocument[];
  cancelRequested: boolean;
  createdByUserId: string;
  createdAt: Date;
  updatedAt: Date;
  queuedAt: Date | null;
  startedAt: Date | null;
  finishedAt: Date | null;
  cancelledAt: Date | null;
  timeoutAt: Date | null;
}

export interface DiscoveryItemDocument {
  _id: ObjectId;
  organizationId: string;
  jobId: ObjectId;
  source: DiscoverySourceKey;
  /** Source record id (Overture GERS id, or a Google place ID on old jobs). No place content is stored on items. */
  externalId: string;
  /** Round in which the item reached its current outcome. */
  round: number;
  outcome: DiscoveryItemOutcome;
  billable: boolean;
  attempts: number;
  businessId: ObjectId | null;
  duplicateOfId: ObjectId | null;
  error: { code: string; message: string; retryable: boolean } | null;
  warnings: Array<{ code: string; message: string }>;
  processedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}
