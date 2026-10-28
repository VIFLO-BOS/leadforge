import type { ObjectId } from "@leadforge/db-mongo";
import type {
  AnalysisStatus,
  AnalysisTrigger,
  DetectionKey,
  DetectionObserved,
  EvidenceType,
  OpportunityKey,
} from "@leadforge/contracts";

export interface StoredDetection {
  key: DetectionKey;
  label: string;
  observed: DetectionObserved;
  confidence: number;
  evidence: Array<{ type: EvidenceType; value: string; page: string | null }>;
  observedValue: string | null;
  analyzedAt: Date;
}

export interface StoredOpportunity {
  key: OpportunityKey;
  title: string;
  rationale: string;
  confidence: number;
  detectionKeys: DetectionKey[];
}

export interface AnalysisPageRecord {
  url: string;
  finalUrl: string | null;
  kind: "home" | "contact" | "about" | "services" | "booking";
  status: number | null;
  error: string | null;
}

/** `website_analyses` (docs/DATABASE_DESIGN.md). Page content is never stored, only evidence snippets. */
export interface WebsiteAnalysisDocument {
  _id: ObjectId;
  organizationId: string;
  businessId: ObjectId;
  url: string;
  finalUrl: string | null;
  status: AnalysisStatus;
  /** Present (true) while queued or running; one active analysis per business (partial unique index). */
  active?: true;
  trigger: AnalysisTrigger;
  batchId: ObjectId | null;
  fetched: {
    status: number | null;
    redirects: Array<{ url: string; status: number }>;
    bytes: number;
    contentType: string | null;
    durationMs: number;
    tls: {
      secure: boolean;
      valid: boolean | null;
      issuer: string | null;
      validTo: string | null;
      error: string | null;
    };
  } | null;
  robots: { fetched: boolean; allowed: boolean | null };
  pagesVisited: AnalysisPageRecord[];
  detections: StoredDetection[];
  opportunities: StoredOpportunity[];
  credits: {
    holdKey: string;
    holdId: string | null;
    held: number;
    captured: number;
    released: number;
    settledAt: Date | null;
  };
  error: { code: string; message: string } | null;
  attempts: number;
  requestedByUserId: string;
  createdAt: Date;
  updatedAt: Date;
  queuedAt: Date;
  startedAt: Date | null;
  analyzedAt: Date | null;
  finishedAt: Date | null;
}
