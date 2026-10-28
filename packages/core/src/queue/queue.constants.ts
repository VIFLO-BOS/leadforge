import type { MailMessage } from "../mail/mail.service.js";

export const QueueNames = {
  mail: "mail",
  imports: "imports",
  discovery: "discovery",
  enrichment: "enrichment",
  websiteAnalysis: "website-analysis",
  dedup: "dedup",
  scoring: "scoring",
  exports: "exports",
  /** Phase 5: bulk operations (add to or remove from a list, assign, move stage). */
  bulk: "bulk",
  billing: "billing",
  maintenance: "maintenance",
} as const;
export type QueueName = (typeof QueueNames)[keyof typeof QueueNames];

export interface SendEmailJob {
  message: MailMessage;
  /** Stable key so re-enqueues do not send twice. */
  idempotencyKey: string;
}

/** Commit a staged CSV import. One BullMQ job per import (job id `import-<importId>`). */
export interface CommitImportJob {
  organizationId: string;
  importId: string;
  requestedByUserId: string;
}

/**
 * Discovery orchestrator: starts a round (`start`), or stops it (`cancel`, `timeout`).
 * Job ids: `discovery-<jobId>-r<round>-start|cancel|timeout`.
 */
export interface RunDiscoveryJob {
  organizationId: string;
  jobId: string;
  round: number;
  reason: "start" | "cancel" | "timeout";
}

export type DiscoveryUnitCursor =
  | { kind: "search"; queryIndex: number; pageIndex: number; pageToken: string | null }
  | { kind: "items"; externalIds: string[] };

/** One page of one source (search), or one batch of failed items to re-fetch (retry round). */
export interface FetchSourcePageJob {
  organizationId: string;
  jobId: string;
  round: number;
  source: string;
  /** Unit of work in the round; the round finishes when every unit has finished. */
  unit: string;
  cursor: DiscoveryUnitCursor;
}

/** Repeatable every 10 minutes: settles unsettled jobs and orphan holds. */
export interface ReconcileCreditsJob {
  requestedAt?: string;
}

/** Phase 6 billing jobs (billing queue). */
export interface ProcessWebhookJob {
  /** payment_webhook_events.id (job id `webhook-<eventId>-a<attempt>`). */
  eventId: string;
}
export interface VerifyPaymentJob {
  paymentId: string;
  trigger?: "webhook" | "return" | "reconcile" | "renewal";
}
export interface GenerateInvoicePdfJob {
  organizationId: string;
  invoiceId: string;
}

/** Repeatable every 10 minutes: redacts and removes values past their source's retention. */
export interface PurgeExpiredContentJob {
  requestedAt?: string;
}

/**
 * Overture Maps Places sync (maintenance queue, repeatable, daily by default): resolves the
 * latest release from the STAC catalogue and loads it once, when it is new. `force` reloads.
 */
export interface OvertureSyncJob {
  force?: boolean;
  /** Pin a release instead of STAC `latest`. */
  release?: string;
}

/** Build one async export (job id `export-<exportId>`). */
export interface BuildExportJob {
  organizationId: string;
  exportId: string;
}

/** Stage 10: build one whole-organization data export (job id `org-export-<exportId>`). */
export interface BuildOrganizationExportJob {
  organizationId: string;
  exportId: string;
}

/** Stage 10: scan for deletion reminders and organizations past their purge date (repeatable). */
export interface ScanOrganizationDeletionsJob {
  requestedAt?: string;
}

/** Stage 10: purge one organization past its purge date (job id `purge-org-<organizationId>`). */
export interface PurgeOrganizationJob {
  organizationId: string;
}

/** Run one bulk operation (job id `bulk-<operationId>`). */
export interface RunBulkOperationJob {
  organizationId: string;
  operationId: string;
}

/** Usage rollup: recompute the last `days` UTC days of usage_daily for every organization. */
export interface RollupUsageJob {
  days?: number;
}

/** Default BullMQ key prefix (QUEUE_PREFIX). */
export const DEFAULT_QUEUE_PREFIX = "leadforge";

/**
 * Prefix every BullMQ queue and worker uses. Producers (API) and workers must agree, so both
 * read QUEUE_PREFIX; separate stacks on one Redis use different prefixes.
 */
export function queuePrefix(env: { QUEUE_PREFIX?: string }): string {
  return env.QUEUE_PREFIX?.trim() || DEFAULT_QUEUE_PREFIX;
}

/** One website analysis (job id `analysis-<analysisId>`). */
export interface AnalyzeWebsiteJob {
  organizationId: string;
  analysisId: string;
}

/** One enrichment run: `website-contacts` or `verify-contact` (job id `enrichment-<runId>`). */
export interface EnrichmentRunJob {
  organizationId: string;
  runId: string;
}

/** Recompute every score of an organization after a profile change (job id `scoring-<org>-v<version>`). */
export interface RecomputeScoresJob {
  organizationId: string;
  profileVersion: number;
}

/** Recompute the scores of specific businesses after their data changed. */
export interface ScoreBusinessesJob {
  organizationId: string;
  businessIds: string[];
}

/** Find duplicate candidates for specific businesses, or the whole organization (`businessIds: null`). */
export interface FindDuplicatesJob {
  organizationId: string;
  businessIds: string[] | null;
}

export interface QueueJobMap {
  [QueueNames.mail]: { "send-email": SendEmailJob };
  [QueueNames.imports]: { "commit-import": CommitImportJob };
  [QueueNames.discovery]: {
    "run-discovery-job": RunDiscoveryJob;
    "fetch-source-page": FetchSourcePageJob;
  };
  [QueueNames.billing]: {
    "reconcile-credits": ReconcileCreditsJob;
    "reconcile-billing": ReconcileCreditsJob;
    "process-webhook": ProcessWebhookJob;
    "verify-payment": VerifyPaymentJob;
    "generate-invoice-pdf": GenerateInvoicePdfJob;
  };
  [QueueNames.maintenance]: {
    "purge-expired-content": PurgeExpiredContentJob;
    "refresh-scores": PurgeExpiredContentJob;
    "recover-enrichment": PurgeExpiredContentJob;
    "overture-sync": OvertureSyncJob;
    "cleanup-exports": PurgeExpiredContentJob;
    "recover-crm-jobs": PurgeExpiredContentJob;
    "rollup-usage": RollupUsageJob;
    "scan-organization-deletions": ScanOrganizationDeletionsJob;
    "purge-organization": PurgeOrganizationJob;
  };
  [QueueNames.exports]: {
    "build-export": BuildExportJob;
    "build-organization-export": BuildOrganizationExportJob;
  };
  [QueueNames.bulk]: { "run-bulk-operation": RunBulkOperationJob };
  [QueueNames.websiteAnalysis]: { "analyze-website": AnalyzeWebsiteJob };
  [QueueNames.enrichment]: {
    "website-contacts": EnrichmentRunJob;
    "verify-contact": EnrichmentRunJob;
  };
  [QueueNames.scoring]: {
    "recompute-scores": RecomputeScoresJob;
    "score-businesses": ScoreBusinessesJob;
  };
  [QueueNames.dedup]: { "find-duplicates": FindDuplicatesJob };
}

/** Website analysis: 2 retries (ARCHITECTURE section 8) for failures on our side. */
export const ANALYSIS_JOB_OPTIONS = {
  attempts: 3,
  backoff: { type: "exponential", delay: 15_000 },
} as const;
export const ENRICHMENT_JOB_OPTIONS = {
  attempts: 3,
  backoff: { type: "exponential", delay: 15_000 },
} as const;
export const SCORING_JOB_OPTIONS = {
  attempts: 3,
  backoff: { type: "exponential", delay: 10_000 },
} as const;
export const DEDUP_JOB_OPTIONS = {
  attempts: 2,
  backoff: { type: "exponential", delay: 10_000 },
} as const;
/** Export builds: 2 retries (a build restarts from the beginning; the file is written once at the end). */
export const EXPORT_JOB_OPTIONS = {
  attempts: 3,
  backoff: { type: "exponential", delay: 15_000 },
} as const;
/** Organization data exports rebuild from the start on retry; the file is written once at the end. */
export const ORGANIZATION_EXPORT_JOB_OPTIONS = {
  attempts: 3,
  backoff: { type: "exponential", delay: 15_000 },
} as const;
/**
 * The purge resumes after its last recorded step. A failed job is removed, so the next scan (every
 * 10 minutes) enqueues it again until it completes.
 */
export const ORGANIZATION_PURGE_JOB_OPTIONS = {
  attempts: 3,
  backoff: { type: "exponential", delay: 60_000 },
  removeOnComplete: true,
  removeOnFail: true,
} as const;
/** Queues whose jobs carry an `organizationId` (the purge removes the waiting and delayed ones). */
export const ORGANIZATION_SCOPED_QUEUES = [
  "imports",
  "discovery",
  "enrichment",
  "website-analysis",
  "dedup",
  "scoring",
  "exports",
  "bulk",
] as const;

/** Bulk operations resume after the last recorded business, so a retry never applies twice. */
export const BULK_JOB_OPTIONS = {
  attempts: 3,
  backoff: { type: "exponential", delay: 10_000 },
} as const;
/** Usage rollup windows: the latest days every 10 minutes, 90 days once a day. */
export const USAGE_ROLLUP_RECENT_DAYS = 2;
export const USAGE_ROLLUP_FULL_DAYS = 90;

/** Custom backoff type resolved by the discovery worker (capped exponential, ARCHITECTURE section 8). */
export const DISCOVERY_BACKOFF_TYPE = "discovery-capped-exponential";

/** Delay before retry n (1-based): base * 2^(n-1), capped. Defaults: 30 s, 60 s, 120 s ... at most 10 min. */
export function discoveryBackoffDelay(attemptsMade: number, baseMs: number, maxMs: number): number {
  const n = Math.max(1, attemptsMade);
  return Math.min(maxMs, baseMs * 2 ** (n - 1));
}

export const MAINTENANCE_INTERVAL_MS = 10 * 60 * 1000;

export const DEFAULT_JOB_OPTIONS = {
  attempts: 5,
  backoff: { type: "exponential", delay: 10_000 },
  removeOnComplete: { age: 60 * 60 * 24, count: 1000 },
  removeOnFail: { age: 60 * 60 * 24 * 14 },
} as const;

/** Imports resume from the first unprocessed row, so a retry never duplicates work. */
export const IMPORT_JOB_OPTIONS = {
  attempts: 3,
  backoff: { type: "exponential", delay: 30_000 },
} as const;
