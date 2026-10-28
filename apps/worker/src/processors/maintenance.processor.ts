import { Injectable } from "@nestjs/common";
import type { Job } from "bullmq";
import {
  BulkRunner,
  EnrichmentService,
  ExportBuilder,
  OrganizationExportBuilder,
  OrganizationLifecycleService,
  OrganizationPurgeService,
  QueueNames,
  RetentionService,
  ScoringService,
  USAGE_ROLLUP_RECENT_DAYS,
  UsageService,
} from "@leadforge/core";
import type { QueueProcessor } from "../worker.runtime.js";
import { OvertureSyncRunner } from "../overture/overture-sync.runner.js";

/**
 * Maintenance queue (each repeatable every 10 minutes): `purge-expired-content` (source
 * retention), `refresh-scores` (scores older than a day, so freshness follows the calendar) and
 * `recover-enrichment` (stuck enrichment runs). `overture-sync` (daily when scheduled) loads a new
 * Overture Maps release into the staging catalogue when the STAC catalogue names one. Phase 5:
 * `cleanup-exports` (expired export files, stuck exports), `recover-crm-jobs` (stuck bulk
 * operations) and `rollup-usage` (usage_daily; the latest 2 days every 10 minutes, 90 days daily).
 * Stage 10: `scan-organization-deletions` (reminders 3 days before, then one `purge-organization`
 * job per organization past its 14-day grace) and `purge-organization`; `cleanup-exports` also
 * expires organization data export files.
 */
@Injectable()
export class MaintenanceProcessor implements QueueProcessor {
  readonly queueName = QueueNames.maintenance;
  readonly concurrency = 1;

  constructor(
    private readonly retention: RetentionService,
    private readonly scoring: ScoringService,
    private readonly enrichment: EnrichmentService,
    private readonly overture: OvertureSyncRunner,
    private readonly exports: ExportBuilder,
    private readonly bulk: BulkRunner,
    private readonly usage: UsageService,
    private readonly lifecycle: OrganizationLifecycleService,
    private readonly purge: OrganizationPurgeService,
    private readonly orgExports: OrganizationExportBuilder,
  ) {}

  async process(job: Job): Promise<unknown> {
    if (job.name === "purge-expired-content") return this.retention.purgeExpired();
    if (job.name === "refresh-scores")
      return { refreshed: await this.scoring.refreshStaleScores() };
    if (job.name === "recover-enrichment") return this.enrichment.recoverStuck();
    if (job.name === "overture-sync") {
      const data = (job.data ?? {}) as { force?: boolean; release?: string };
      const outcome = await this.overture.run({
        trigger: "schedule",
        force: data.force === true,
        release: data.release,
      });
      return outcome.status === "loaded"
        ? { status: outcome.run.status, release: outcome.run.release, counts: outcome.run.counts }
        : outcome;
    }
    if (job.name === "cleanup-exports")
      return {
        exports: await this.exports.cleanup(),
        organizationExports: await this.orgExports.cleanup(),
      };
    if (job.name === "scan-organization-deletions") return this.lifecycle.scan();
    if (job.name === "purge-organization") return this.purge.handle(job);
    if (job.name === "recover-crm-jobs") return this.bulk.recoverStuck();
    if (job.name === "rollup-usage") {
      const days = Number((job.data as { days?: unknown } | undefined)?.days);
      return this.usage.rollupAll(
        Number.isInteger(days) && days > 0 && days <= 400 ? days : USAGE_ROLLUP_RECENT_DAYS,
      );
    }
    throw new Error(`Unknown maintenance job ${job.name}`);
  }
}
