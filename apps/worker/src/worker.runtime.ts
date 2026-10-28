import { Inject, Injectable, type OnApplicationShutdown, type OnModuleInit } from "@nestjs/common";
import { UnrecoverableError, Worker, type Job, type WorkerOptions } from "bullmq";
import type { Redis } from "ioredis";
import { Logger } from "nestjs-pino";
import type { ServerEnv } from "@leadforge/contracts";
import {
  createRedis,
  DISCOVERY_BACKOFF_TYPE,
  discoveryBackoffDelay,
  ENV,
  MetricsService,
  QueueNames,
  QueueService,
  queuePrefix,
  type QueueName,
} from "@leadforge/core";
import { MailProcessor } from "./processors/mail.processor.js";
import { ImportProcessor } from "./processors/import.processor.js";
import { DiscoveryProcessor } from "./processors/discovery.processor.js";
import { BillingProcessor } from "./processors/billing.processor.js";
import { MaintenanceProcessor } from "./processors/maintenance.processor.js";
import { AnalysisProcessor } from "./processors/analysis.processor.js";
import { EnrichmentProcessor } from "./processors/enrichment.processor.js";
import { ScoringProcessor } from "./processors/scoring.processor.js";
import { DedupProcessor } from "./processors/dedup.processor.js";
import { ExportProcessor } from "./processors/export.processor.js";
import { BulkProcessor } from "./processors/bulk.processor.js";

export interface QueueProcessor {
  readonly queueName: QueueName;
  readonly concurrency: number;
  process(job: Job, token?: string): Promise<unknown>;
}

const SHUTDOWN_GRACE_MS = 30_000;

/**
 * Starts one BullMQ Worker per registered processor, honoring the WORKER_QUEUES
 * allowlist so deployments can dedicate processes to specific workloads. Discovery jobs use a
 * capped exponential backoff (30 s doubling up to 10 min by default; ARCHITECTURE section 8).
 * The repeatable reconciliation and retention purge are registered on start.
 */
@Injectable()
export class WorkerRuntime implements OnModuleInit, OnApplicationShutdown {
  private readonly workers: Worker[] = [];
  private readonly connection: Redis;

  constructor(
    @Inject(ENV) private readonly env: ServerEnv,
    private readonly logger: Logger,
    private readonly queues: QueueService,
    private readonly mail: MailProcessor,
    private readonly importer: ImportProcessor,
    private readonly discovery: DiscoveryProcessor,
    private readonly billing: BillingProcessor,
    private readonly maintenance: MaintenanceProcessor,
    private readonly analysis: AnalysisProcessor,
    private readonly enrichment: EnrichmentProcessor,
    private readonly scoring: ScoringProcessor,
    private readonly dedup: DedupProcessor,
    private readonly exportsProcessor: ExportProcessor,
    private readonly bulk: BulkProcessor,
    private readonly metrics: MetricsService,
  ) {
    this.connection = createRedis(env.REDIS_URL, "worker");
  }

  private processors(): QueueProcessor[] {
    return [
      this.mail,
      this.importer,
      this.discovery,
      this.billing,
      this.maintenance,
      this.analysis,
      this.enrichment,
      this.scoring,
      this.dedup,
      this.exportsProcessor,
      this.bulk,
    ];
  }

  private optionsFor(processor: QueueProcessor): WorkerOptions {
    const options: WorkerOptions = {
      connection: this.connection,
      // Same prefix as the producers (QUEUE_PREFIX), so separate stacks on one Redis never share jobs.
      prefix: queuePrefix(this.env),
      concurrency: processor.concurrency,
      // Website fetches wait on per-host rate limits (1 request per 2 s), so those jobs hold their lock longer;
      // the maintenance queue runs the Overture sync, which reads a release for a minute or more.
      lockDuration:
        processor.queueName === QueueNames.websiteAnalysis ||
        processor.queueName === QueueNames.enrichment
          ? 180_000
          : processor.queueName === QueueNames.maintenance
            ? 600_000
            : processor.queueName === QueueNames.exports ||
                processor.queueName === QueueNames.bulk ||
                processor.queueName === QueueNames.billing
              ? 300_000
              : 60_000,
    };
    if (processor.queueName === QueueNames.discovery) {
      options.settings = {
        backoffStrategy: (attemptsMade: number, type?: string) =>
          type === DISCOVERY_BACKOFF_TYPE
            ? discoveryBackoffDelay(
                attemptsMade,
                this.env.DISCOVERY_RETRY_BASE_MS,
                this.env.DISCOVERY_RETRY_MAX_MS,
              )
            : 0,
      };
    }
    return options;
  }

  async onModuleInit(): Promise<void> {
    const allow = new Set(this.env.WORKER_QUEUES);
    for (const processor of this.processors()) {
      if (allow.size > 0 && !allow.has(processor.queueName)) continue;
      const worker = new Worker(
        processor.queueName,
        (job, token) => this.instrumented(processor, job, token),
        this.optionsFor(processor),
      );
      worker.on("failed", (job, err) => {
        if (err?.name === "DelayedError") return;
        this.logger.error(
          { queue: processor.queueName, jobId: job?.id, attempts: job?.attemptsMade, err },
          "Job failed",
        );
      });
      worker.on("error", (err) =>
        this.logger.error({ queue: processor.queueName, err }, "Worker error"),
      );
      this.workers.push(worker);
      this.logger.log(
        {
          queue: processor.queueName,
          concurrency: processor.concurrency,
          prefix: queuePrefix(this.env),
        },
        "Worker registered",
      );
    }
    if (this.workers.length === 0)
      this.logger.warn("No queues enabled for this worker; check WORKER_QUEUES");
    if (allow.size === 0 || allow.has(QueueNames.billing) || allow.has(QueueNames.maintenance)) {
      await this.queues.ensureMaintenanceSchedules();
      this.logger.log(
        "Maintenance schedules registered (every 10 minutes: credit reconciliation, billing reconciliation, retention purge, score refresh, enrichment recovery, export cleanup, bulk recovery, usage rollup, organization deletion scan; daily: 90-day usage rollup)",
      );
      const overture = await this.queues.ensureOvertureSyncSchedule();
      this.logger.log(
        { overtureSync: overture, everyMs: this.env.OVERTURE_SYNC_INTERVAL_MS },
        overture
          ? "Overture sync scheduled (loads a release once, when the STAC catalogue names a new one)"
          : "Overture sync schedule off (OVERTURE_SYNC_SCHEDULE); load releases with pnpm overture:sync",
      );
    }
  }

  /**
   * Runs one attempt and records it for Prometheus: wait time before the first attempt, duration,
   * and the outcome (completed; retrying; failed when no attempt is left or the error is
   * unrecoverable; delayed when a rate-limited job put itself back).
   */
  private async instrumented(
    processor: QueueProcessor,
    job: Job,
    token?: string,
  ): Promise<unknown> {
    const queue = processor.queueName;
    const started = Date.now();
    if (job.attemptsMade === 0)
      this.metrics.observeJobWait(queue, (started - job.timestamp - (job.opts.delay ?? 0)) / 1000);
    try {
      const result = await processor.process(job, token);
      this.metrics.observeJob(queue, job.name, "completed", (Date.now() - started) / 1000);
      return result;
    } catch (err) {
      const name = (err as { name?: string } | null)?.name;
      const outcome =
        name === "DelayedError"
          ? "delayed"
          : err instanceof UnrecoverableError ||
              name === "UnrecoverableError" ||
              job.attemptsMade + 1 >= (job.opts.attempts ?? 1)
            ? "failed"
            : "retrying";
      this.metrics.observeJob(queue, job.name, outcome, (Date.now() - started) / 1000);
      throw err;
    }
  }

  async onApplicationShutdown(signal?: string): Promise<void> {
    this.logger.log({ signal }, "Worker shutting down; waiting for active jobs");
    const timeout = new Promise<void>((resolve) => setTimeout(resolve, SHUTDOWN_GRACE_MS));
    await Promise.race([Promise.all(this.workers.map((w) => w.close())), timeout]);
    await this.connection.quit().catch(() => this.connection.disconnect());
  }
}
