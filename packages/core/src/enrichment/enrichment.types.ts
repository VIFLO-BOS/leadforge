import type { ObjectId } from "@leadforge/db-mongo";
import type {
  EmailCheckResult,
  EnrichmentRunKind,
  EnrichmentRunStatus,
} from "@leadforge/contracts";

/** `enrichment_runs`: one website-contacts extraction or one email check. */
export interface EnrichmentRunDocument {
  _id: ObjectId;
  organizationId: string;
  businessId: ObjectId;
  kind: EnrichmentRunKind;
  status: EnrichmentRunStatus;
  /** Present (true) while queued or running; one active run per business and kind. */
  active?: true;
  trigger: "manual" | "refresh";
  input: { url: string | null; address: string | null };
  output: {
    pagesVisited: Array<{ url: string; status: number | null; error: string | null }>;
    observationIds: ObjectId[];
    found: { phones: number; emails: number; socials: number; whatsapp: number };
    phonesVerified: number;
    whatsappConfirmed: number;
    emailChecks: Array<{ address: string; result: EmailCheckResult }>;
    ownSite: boolean | null;
  };
  error: { code: string; message: string } | null;
  attempts: number;
  requestedByUserId: string;
  createdAt: Date;
  updatedAt: Date;
  startedAt: Date | null;
  finishedAt: Date | null;
}

export function emptyRunOutput(): EnrichmentRunDocument["output"] {
  return {
    pagesVisited: [],
    observationIds: [],
    found: { phones: 0, emails: 0, socials: 0, whatsapp: 0 },
    phonesVerified: 0,
    whatsappConfirmed: 0,
    emailChecks: [],
    ownSite: null,
  };
}
