import { Inject, Injectable, type OnApplicationShutdown } from "@nestjs/common";
import { Queue, type JobsOptions } from "bullmq";
import type { Redis } from "ioredis";
import type { ServerEnv } from "@leadforge/contracts";
import { ENV } from "../config/env.module.js";
import { createRedis } from "../redis/redis.module.js";
import {
  ANALYSIS_JOB_OPTIONS,
  BULK_JOB_OPTIONS,
  DEDUP_JOB_OPTIONS,
  ENRICHMENT_JOB_OPTIONS,
  EXPORT_JOB_OPTIONS,
  ORGANIZATION_EXPORT_JOB_OPTIONS,
  ORGANIZATION_PURGE_JOB_OPTIONS,
  ORGANIZATION_SCOPED_QUEUES,
  type BuildOrganizationExportJob,
  type PurgeOrganizationJob,
  USAGE_ROLLUP_FULL_DAYS,
  USAGE_ROLLUP_RECENT_DAYS,
  type BuildExportJob,
  type RunBulkOperationJob,
  SCORING_JOB_OPTIONS,
  type AnalyzeWebsiteJob,
  type EnrichmentRunJob,
  type FindDuplicatesJob,
  type RecomputeScoresJob,
  type ScoreBusinessesJob,
  DEFAULT_JOB_OPTIONS,
  DISCOVERY_BACKOFF_TYPE,
  IMPORT_JOB_OPTIONS,
  MAINTENANCE_INTERVAL_MS,
  QueueNames,
  queuePrefix,
  type CommitImportJob,
  type FetchSourcePageJob,
  type QueueName,
  type RunDiscoveryJob,
  type SendEmailJob,
} from "./queue.constants.js";

/**
 * Lazily creates BullMQ queues on a dedicated Redis connection, under the QUEUE_PREFIX key
 * prefix (default "leadforge"). Producers only; workers are created in apps/worker with the
 * same prefix.
 */
@Injectable()
export class QueueService implements OnApplicationShutdown {
  private readonly connection: Redis;
  private readonly queues = new Map<QueueName, Queue>();

  /** BullMQ key prefix shared with the workers. */
  readonly prefix: string;

  constructor(@Inject(ENV) private readonly env: ServerEnv) {
    this.connection = createRedis(env.REDIS_URL, "queue-producer");
    this.prefix = queuePrefix(env);
  }

  queue(name: QueueName): Queue {
    let q = this.queues.get(name);
    if (!q) {
      q = new Queue(name, {
        connection: this.connection,
        prefix: this.prefix,
        defaultJobOptions: DEFAULT_JOB_OPTIONS,
      });
      this.queues.set(name, q);
    }
    return q;
  }

  async enqueueMail(job: SendEmailJob, options?: JobsOptions): Promise<string> {
    const added = await this.queue(QueueNames.mail).add("send-email", job, {
      jobId: `mail:${job.idempotencyKey}`,
      ...options,
    });
    return added.id ?? job.idempotencyKey;
  }

  /** Idempotent: the job id is derived from the import, so a double commit enqueues once. */
  async enqueueImportCommit(job: CommitImportJob): Promise<string> {
    const jobId = `import-${job.importId}`;
    const added = await this.queue(QueueNames.imports).add("commit-import", job, {
      jobId,
      ...IMPORT_JOB_OPTIONS,
    });
    return added.id ?? jobId;
  }

  /** Orchestrator job. Deterministic id per job, round and reason, so a repeat enqueue is ignored. */
  async enqueueDiscoveryRun(
    job: RunDiscoveryJob,
    options: { delayMs?: number } = {},
  ): Promise<string> {
    const jobId = `discovery-${job.jobId}-r${job.round}-${job.reason}`;
    const added = await this.queue(QueueNames.discovery).add("run-discovery-job", job, {
      jobId,
      attempts: 5,
      backoff: { type: DISCOVERY_BACKOFF_TYPE },
      ...(options.delayMs ? { delay: Math.max(0, Math.floor(options.delayMs)) } : {}),
    });
    return added.id ?? jobId;
  }

  /** One page (or retry batch). The id names the page, so re-enqueueing after a crash is a no-op. */
  async enqueueDiscoveryPage(job: FetchSourcePageJob): Promise<string> {
    const position =
      job.cursor.kind === "search" ? `-q${job.cursor.queryIndex}-p${job.cursor.pageIndex}` : "";
    const jobId = `discovery-${job.jobId}-r${job.round}-${job.unit}${position}`;
    const added = await this.queue(QueueNames.discovery).add("fetch-source-page", job, {
      jobId,
      attempts: this.env.DISCOVERY_PAGE_ATTEMPTS,
      backoff: { type: DISCOVERY_BACKOFF_TYPE },
    });
    return added.id ?? jobId;
  }

  /** One analysis; the id names the analysis, so a repeat enqueue (reconciliation) is ignored while it exists. */
  async enqueueAnalysis(job: AnalyzeWebsiteJob): Promise<string> {
    const jobId = `analysis-${job.analysisId}`;
    const added = await this.queue(QueueNames.websiteAnalysis).add("analyze-website", job, {
      jobId,
      ...ANALYSIS_JOB_OPTIONS,
    });
    return added.id ?? jobId;
  }

  async enqueueEnrichment(
    name: "website-contacts" | "verify-contact",
    job: EnrichmentRunJob,
  ): Promise<string> {
    const jobId = `enrichment-${job.runId}`;
    const added = await this.queue(QueueNames.enrichment).add(name, job, {
      jobId,
      ...ENRICHMENT_JOB_OPTIONS,
    });
    return added.id ?? jobId;
  }

  /** One export build; the id names the export, so a repeat enqueue is ignored while the job exists. */
  async enqueueExport(job: BuildExportJob): Promise<string> {
    const jobId = `export-${job.exportId}`;
    const added = await this.queue(QueueNames.exports).add("build-export", job, {
      jobId,
      ...EXPORT_JOB_OPTIONS,
    });
    return added.id ?? jobId;
  }

  /** Stage 10: one organization data export; the id names the export. */
  async enqueueOrganizationExport(job: BuildOrganizationExportJob): Promise<string> {
    const jobId = `org-export-${job.exportId}`;
    const added = await this.queue(QueueNames.exports).add("build-organization-export", job, {
      jobId,
      ...ORGANIZATION_EXPORT_JOB_OPTIONS,
    });
    return added.id ?? jobId;
  }

  /** Stage 10: one purge per organization; a repeat enqueue is ignored while the job exists. */
  async enqueueOrganizationPurge(job: PurgeOrganizationJob): Promise<string> {
    const jobId = `purge-org-${job.organizationId}`;
    const added = await this.queue(QueueNames.maintenance).add("purge-organization", job, {
      jobId,
      ...ORGANIZATION_PURGE_JOB_OPTIONS,
    });
    return added.id ?? jobId;
  }

  /**
   * Stage 10 (organization purge): removes the organization's jobs that have not started (waiting,
   * prioritized, delayed, paused) from every organization-scoped queue. Active jobs keep running
   * until their next check finds the organization closed. Returns the count removed per queue.
   */
  async removeOrganizationJobs(organizationId: string): Promise<Record<string, number>> {
    const removed: Record<string, number> = {};
    const states = ["waiting", "prioritized", "delayed", "paused", "waiting-children"] as const;
    for (const name of ORGANIZATION_SCOPED_QUEUES) {
      const q = this.queue(name);
      // Collect first, then remove: removing while paging would shift the page windows.
      const matching = [];
      for (let start = 0; ; start += 500) {
        const jobs = await q.getJobs([...states], start, start + 499, true);
        for (const job of jobs) {
          if (
            (job?.data as { organizationId?: unknown } | undefined)?.organizationId ===
            organizationId
          )
            matching.push(job);
        }
        if (jobs.length < 500) break;
      }
      let count = 0;
      for (const job of matching) {
        try {
          await job.remove();
          count += 1;
        } catch {
          // Picked up by a worker meanwhile (locked): it stops at its next organization check.
        }
      }
      if (count) removed[name] = count;
    }
    return removed;
  }

  /** One bulk operation; the id names the operation, so a repeat enqueue is ignored while the job exists. */
  async enqueueBulkOperation(job: RunBulkOperationJob): Promise<string> {
    const jobId = `bulk-${job.operationId}`;
    const added = await this.queue(QueueNames.bulk).add("run-bulk-operation", job, {
      jobId,
      ...BULK_JOB_OPTIONS,
    });
    return added.id ?? jobId;
  }

  /** Whole-organization recompute for one profile version (a newer version supersedes it). */
  async enqueueScoreRecompute(job: RecomputeScoresJob, suffix?: string): Promise<string> {
    const jobId = `scoring-${job.organizationId}-v${job.profileVersion}${suffix ? `-${suffix}` : ""}`;
    const added = await this.queue(QueueNames.scoring).add("recompute-scores", job, {
      jobId,
      ...SCORING_JOB_OPTIONS,
    });
    return added.id ?? jobId;
  }

  /** Scores for businesses whose data changed; chunked to at most 500 ids per job. */
  async enqueueScoreBusinesses(job: ScoreBusinessesJob): Promise<void> {
    for (let i = 0; i < job.businessIds.length; i += 500) {
      await this.queue(QueueNames.scoring).add(
        "score-businesses",
        { organizationId: job.organizationId, businessIds: job.businessIds.slice(i, i + 500) },
        SCORING_JOB_OPTIONS,
      );
    }
  }

  /** Duplicate candidates for businesses (chunked) or the whole organization. */
  async enqueueFindDuplicates(job: FindDuplicatesJob): Promise<void> {
    if (job.businessIds === null) {
      await this.queue(QueueNames.dedup).add("find-duplicates", job, DEDUP_JOB_OPTIONS);
      return;
    }
    for (let i = 0; i < job.businessIds.length; i += 500) {
      await this.queue(QueueNames.dedup).add(
        "find-duplicates",
        { organizationId: job.organizationId, businessIds: job.businessIds.slice(i, i + 500) },
        DEDUP_JOB_OPTIONS,
      );
    }
  }

  /** Repeatable maintenance (credit reconciliation, retention purge), registered by the worker. */
  async ensureMaintenanceSchedules(everyMs: number = MAINTENANCE_INTERVAL_MS): Promise<void> {
    await this.queue(QueueNames.billing).upsertJobScheduler(
      "reconcile-credits",
      { every: everyMs },
      {
        name: "reconcile-credits",
        data: {},
        opts: { attempts: 1, removeOnComplete: { count: 100 }, removeOnFail: { count: 500 } },
      },
    );
    // Phase 6: stuck payments, unprocessed webhooks and subscriptions past their period.
    await this.queue(QueueNames.billing).upsertJobScheduler(
      "reconcile-billing",
      { every: everyMs },
      {
        name: "reconcile-billing",
        data: {},
        opts: { attempts: 1, removeOnComplete: { count: 100 }, removeOnFail: { count: 500 } },
      },
    );
    await this.queue(QueueNames.maintenance).upsertJobScheduler(
      "purge-expired-content",
      { every: everyMs },
      {
        name: "purge-expired-content",
        data: {},
        opts: { attempts: 1, removeOnComplete: { count: 100 }, removeOnFail: { count: 500 } },
      },
    );
    // Phase 4: day-old scores are refreshed (freshness follows the calendar) and stuck enrichment runs recovered.
    await this.queue(QueueNames.maintenance).upsertJobScheduler(
      "refresh-scores",
      { every: everyMs },
      {
        name: "refresh-scores",
        data: {},
        opts: { attempts: 1, removeOnComplete: { count: 100 }, removeOnFail: { count: 500 } },
      },
    );
    await this.queue(QueueNames.maintenance).upsertJobScheduler(
      "recover-enrichment",
      { every: everyMs },
      {
        name: "recover-enrichment",
        data: {},
        opts: { attempts: 1, removeOnComplete: { count: 100 }, removeOnFail: { count: 500 } },
      },
    );
    // Phase 5: expired export files are deleted, stuck exports and bulk operations recovered, usage rolled up.
    await this.queue(QueueNames.maintenance).upsertJobScheduler(
      "cleanup-exports",
      { every: everyMs },
      {
        name: "cleanup-exports",
        data: {},
        opts: { attempts: 1, removeOnComplete: { count: 100 }, removeOnFail: { count: 500 } },
      },
    );
    await this.queue(QueueNames.maintenance).upsertJobScheduler(
      "recover-crm-jobs",
      { every: everyMs },
      {
        name: "recover-crm-jobs",
        data: {},
        opts: { attempts: 1, removeOnComplete: { count: 100 }, removeOnFail: { count: 500 } },
      },
    );
    await this.queue(QueueNames.maintenance).upsertJobScheduler(
      "rollup-usage",
      { every: everyMs },
      {
        name: "rollup-usage",
        data: { days: USAGE_ROLLUP_RECENT_DAYS },
        opts: { attempts: 1, removeOnComplete: { count: 100 }, removeOnFail: { count: 500 } },
      },
    );
    // Stage 10: deletion reminders (3 days before) and purges of organizations past their grace.
    await this.queue(QueueNames.maintenance).upsertJobScheduler(
      "scan-organization-deletions",
      { every: everyMs },
      {
        name: "scan-organization-deletions",
        data: {},
        opts: { attempts: 1, removeOnComplete: { count: 100 }, removeOnFail: { count: 500 } },
      },
    );
    await this.queue(QueueNames.maintenance).upsertJobScheduler(
      "rollup-usage-full",
      { every: 24 * 60 * 60 * 1000 },
      {
        name: "rollup-usage",
        data: { days: USAGE_ROLLUP_FULL_DAYS },
        opts: {
          attempts: 2,
          backoff: { type: "fixed", delay: 60_000 },
          removeOnComplete: { count: 30 },
          removeOnFail: { count: 30 },
        },
      },
    );
  }

  /**
   * Overture sync schedule: on (repeatable, OVERTURE_SYNC_INTERVAL_MS) when OVERTURE_SYNC_SCHEDULE is
   * true, or unset in production; otherwise any existing schedule is removed. Returns whether it is on.
   */
  async ensureOvertureSyncSchedule(): Promise<boolean> {
    const enabled = this.env.OVERTURE_SYNC_SCHEDULE ?? this.env.NODE_ENV === "production";
    const q = this.queue(QueueNames.maintenance);
    if (!enabled) {
      await q.removeJobScheduler("overture-sync").catch(() => false);
      return false;
    }
    await q.upsertJobScheduler(
      "overture-sync",
      { every: this.env.OVERTURE_SYNC_INTERVAL_MS },
      {
        name: "overture-sync",
        data: {},
        // A failed load is retried twice, an hour apart (S3 and DNS hiccups); the next scheduled run tries again anyway.
        opts: {
          attempts: 3,
          backoff: { type: "fixed", delay: 60 * 60 * 1000 },
          removeOnComplete: { count: 50 },
          removeOnFail: { count: 100 },
        },
      },
    );
    return true;
  }

  async onApplicationShutdown(): Promise<void> {
    await Promise.all([...this.queues.values()].map((q) => q.close()));
    await this.connection.quit().catch(() => this.connection.disconnect());
  }
}
