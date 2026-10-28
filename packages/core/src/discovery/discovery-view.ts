import {
  DISCOVERY_TERMINAL_STATUSES,
  type DiscoveryJob,
  type DiscoveryJobItem,
  type DiscoveryIssue,
} from "@leadforge/contracts";
import type { BusinessSummary } from "../businesses/businesses.service.js";
import type {
  DiscoveryIssueDocument,
  DiscoveryItemDocument,
  DiscoveryJobDocument,
} from "./discovery.types.js";

const iso = (d: Date | null | undefined): string | null => (d ? d.toISOString() : null);

function issue(i: DiscoveryIssueDocument): DiscoveryIssue {
  return { code: i.code, message: i.message, at: i.at.toISOString(), source: i.source };
}

export function toDiscoveryJobView(
  job: DiscoveryJobDocument,
  attributions: string[],
): DiscoveryJob {
  const rounds = job.credits.rounds;
  const sum = (k: "heldUnits" | "capturedUnits" | "releasedUnits") =>
    rounds.reduce((s, r) => s + r[k], 0);
  const settled = rounds.length > 0 && rounds.every((r) => r.settledAt);
  const terminal = DISCOVERY_TERMINAL_STATUSES.includes(job.status);
  return {
    id: job._id.toHexString(),
    name: job.name,
    status: job.status,
    spec: job.spec,
    estimate: job.estimate,
    credits: {
      held: sum("heldUnits"),
      captured: sum("capturedUnits"),
      released: sum("releasedUnits"),
      settled,
      settledAt: settled ? iso(job.credits.settledAt) : null,
    },
    progress: {
      processed: job.progress.processed,
      created: job.progress.created,
      updated: job.progress.updated,
      duplicates: job.progress.duplicates,
      skipped: job.progress.skipped,
      failed: job.progress.failed,
      billable: job.progress.billable,
      pagesFetched: job.progress.pagesFetched,
      limit: job.limit,
      lastEventAt: iso(job.progress.lastEventAt),
    },
    sourceOutcomes: job.sourceOutcomes.map((s) => ({
      source: s.source,
      status: s.status,
      pages: s.pages,
      records: s.records,
      rateLimited: s.rateLimited,
      errors: s.errors,
    })),
    errors: job.errors.map(issue),
    warnings: job.warnings.map(issue),
    cancelRequested: job.cancelRequested,
    round: job.round,
    retryableItems: terminal && settled ? job.progress.failed : 0,
    attributions,
    sourceReleases: job.sourceReleases ?? [],
    createdByUserId: job.createdByUserId,
    createdAt: job.createdAt.toISOString(),
    updatedAt: job.updatedAt.toISOString(),
    queuedAt: iso(job.queuedAt),
    startedAt: iso(job.startedAt),
    finishedAt: iso(job.finishedAt),
    cancelledAt: iso(job.cancelledAt),
    timeoutAt: iso(job.timeoutAt),
  };
}

export function toDiscoveryItemView(
  item: DiscoveryItemDocument,
  business: BusinessSummary | undefined,
): DiscoveryJobItem {
  return {
    id: item._id.toHexString(),
    source: item.source,
    externalId: item.externalId,
    outcome: item.outcome,
    billable: item.billable,
    attempts: item.attempts,
    round: item.round,
    error: item.error,
    warnings: item.warnings,
    business: business
      ? { id: business.id, name: business.name, nameState: business.nameState }
      : null,
    duplicateOfId: item.duplicateOfId?.toHexString() ?? null,
    processedAt: iso(item.processedAt),
  };
}
