import { createHash } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import type { Redis } from "ioredis";
import { ObjectId, type WithId } from "@leadforge/db-mongo";
import {
  DISCOVERY_LIMITS,
  DISCOVERY_TERMINAL_STATUSES,
  type DiscoveryBlocker,
  type DiscoveryEstimate,
  type DiscoveryItemsQuery,
  type DiscoveryJob,
  type DiscoveryJobItem,
  type DiscoveryJobListQuery,
  type DiscoveryJobSpec,
  type DiscoverySourceEstimate,
  type DiscoverySourceKey,
  type ErrorDetail,
  type JobStatus,
  type JobSummary,
  type ServerEnv,
} from "@leadforge/contracts";
import { ENV } from "../config/env.module.js";
import { REDIS } from "../redis/redis.module.js";
import { AppError } from "../common/errors/app.error.js";
import { withCursor } from "../common/pagination/cursor.js";
import { AuditService, type AuditContext } from "../audit/audit.service.js";
import { QueueService } from "../queue/queue.service.js";
import { BusinessesService } from "../businesses/businesses.service.js";
import { normalizeRegion } from "../normalization/index.js";
import { CreditsService, jobCreditKeys } from "../credits/credits.service.js";
import { SourcesService } from "../sources/sources.service.js";
import { EntitlementsService } from "../entitlements/entitlements.service.js";
import { toDiscoveryItemView, toDiscoveryJobView } from "./discovery-view.js";
import { DiscoveryRunner } from "./discovery.runner.js";
import type { DiscoveryJobDocument, DiscoveryUnit } from "./discovery.types.js";
import { sourceOrgContext } from "./discovery-context.js";
import { DiscoveryJobRepository } from "./repositories/discovery-job.repository.js";
import { DiscoveryItemRepository } from "./repositories/discovery-item.repository.js";

const RETRY_BATCH_SIZE = 20;
const HOUR_MS = 60 * 60 * 1000;

const BASIS =
  "1 credit per business record produced (a new record, or an existing record that gains new observations). The hold is the most the job can produce: the lower of maxRecords and what the sources can return (for Overture, the exact number of matching places not already in your directory). Unused credits are returned when the job finishes; places already in your directory and items that fail on our side are never charged.";

/**
 * Discovery jobs as the API sees them: estimate, create (credit hold, queue), list, detail,
 * items, cancel and retry-failed. Processing lives in DiscoveryRunner (worker).
 * Cross-database flow per ARCHITECTURE section 6: mint the job id, PG hold keyed
 * `job:<id>:hold`, Mongo insert, enqueue; a failure after the hold releases it.
 */
@Injectable()
export class DiscoveryService {
  constructor(
    private readonly jobs: DiscoveryJobRepository,
    private readonly items: DiscoveryItemRepository,
    private readonly sources: SourcesService,
    private readonly credits: CreditsService,
    private readonly businesses: BusinessesService,
    private readonly runner: DiscoveryRunner,
    private readonly queue: QueueService,
    private readonly audit: AuditService,
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(ENV) private readonly env: ServerEnv,
    private readonly entitlements: EntitlementsService,
  ) {}

  /** Canonical spec: Nigerian state spellings normalized so equal searches compare equal. */
  normalizeSpec(spec: DiscoveryJobSpec): DiscoveryJobSpec {
    return {
      ...spec,
      location: {
        ...spec.location,
        ...(spec.location.region
          ? { region: normalizeRegion(spec.location.region, spec.location.country) }
          : {}),
      },
    };
  }

  private attributions(spec: DiscoveryJobSpec): string[] {
    return [
      ...new Set(
        spec.sources
          .map((s) => this.sources.adapter(s)?.policy.attribution)
          .filter((a): a is string => Boolean(a)),
      ),
    ];
  }

  private view(job: DiscoveryJobDocument): DiscoveryJob {
    return toDiscoveryJobView(job, this.attributions(job.spec));
  }

  async estimate(organizationId: string, rawSpec: DiscoveryJobSpec): Promise<DiscoveryEstimate> {
    const spec = this.normalizeSpec(rawSpec);
    const blockers: DiscoveryBlocker[] = [];
    const sources: DiscoverySourceEstimate[] = [];
    for (const key of spec.sources) {
      const r = await this.sources.runnability(organizationId, key);
      const d = r.adapter.describe();
      const est = r.runnable
        ? await r.adapter.estimate(
            spec,
            sourceOrgContext(this.businesses, organizationId, key, null),
          )
        : await r.adapter.estimate(spec);
      const problems = r.adapter.validateSpec(spec);
      if (problems.length)
        blockers.push({
          code: "VALIDATION_FAILED",
          source: key,
          message: problems.map((p) => p.message).join("; "),
        });
      if (r.blocker) blockers.push(r.blocker);
      sources.push({
        source: key,
        name: d.name,
        status: r.adapter.policy.blockedByTerms ? "not_available" : d.status,
        enabled: r.enabled,
        runnable: r.runnable && problems.length === 0,
        queries: est.queries,
        maxResults: est.maxResults,
        maxRequests: est.maxRequests,
        providerSku: est.providerSku,
        fields: est.fields,
        warnings: est.warnings,
        exact: est.exact ?? false,
        alreadyInDirectory: est.alreadyInDirectory ?? 0,
      });
    }
    const maxRecords = Math.min(
      spec.maxRecords,
      sources.filter((s) => s.runnable).reduce((s, x) => s + x.maxResults, 0),
    );
    const { balance } = await this.credits.balance(organizationId);
    const sufficient = balance >= maxRecords;
    // Phase 6: the plan must include discovery, and a negative balance (after a refund) blocks new jobs.
    if (!(await this.entitlements.discoveryEnabled(organizationId))) {
      blockers.push({
        code: "ENTITLEMENT_REQUIRED",
        source: null,
        message: "Your plan does not include discovery. Change the plan on the Billing page.",
      });
    }
    if (balance < 0) {
      blockers.push({
        code: "CREDIT_BALANCE_NEGATIVE",
        source: null,
        message: `The credit balance is ${balance} after a refund or reversal. Buy credits to bring it above zero.`,
      });
    } else if (!sufficient) {
      blockers.push({
        code: "INSUFFICIENT_CREDITS",
        source: null,
        message: `This job holds up to ${maxRecords} credits; ${balance} available.`,
      });
    }
    const warnings = [...new Set(sources.flatMap((s) => s.warnings))];
    return {
      estimateAvailable: sources.some((s) => s.runnable),
      credits: { perRecord: 1, hold: maxRecords, balance, sufficient },
      maxRecords,
      sources,
      basis: BASIS,
      warnings,
      blockers,
    };
  }

  /** Fixed one-hour window per organization (DISCOVERY_JOBS_PER_HOUR, default 30). */
  private async consumeCreateBudget(organizationId: string): Promise<void> {
    const bucket = Math.floor(Date.now() / HOUR_MS);
    const key = `lf:rate:discovery-create:${organizationId}:${bucket}`;
    const count = await this.redis.incr(key);
    if (count === 1) await this.redis.pexpire(key, HOUR_MS + 60_000);
    if (count > this.env.DISCOVERY_JOBS_PER_HOUR) {
      throw new AppError(
        "RATE_LIMITED",
        `At most ${this.env.DISCOVERY_JOBS_PER_HOUR} discovery jobs per hour per organization. Try again later.`,
      );
    }
  }

  async create(
    organizationId: string,
    userId: string,
    rawSpec: DiscoveryJobSpec,
    idempotencyKey: string,
    auditCtx: AuditContext,
  ): Promise<{ job: DiscoveryJob; replayed: boolean }> {
    const spec = this.normalizeSpec(rawSpec);
    const specHash = createHash("sha256").update(JSON.stringify(spec)).digest("hex");

    const existing = await this.jobs.findByIdempotencyKey(organizationId, userId, idempotencyKey);
    if (existing) {
      if (existing.specHash !== specHash)
        throw AppError.conflict("This Idempotency-Key was already used for a different job");
      return { job: this.view(existing), replayed: true };
    }

    await this.entitlements.assertDiscoveryEnabled(organizationId);
    const problems: ErrorDetail[] = [];
    let maxResults = 0;
    const sourceReleases: NonNullable<DiscoveryJobDocument["sourceReleases"]> = [];
    for (const key of spec.sources) {
      const adapter = await this.sources.requireRunnable(organizationId, key);
      problems.push(...adapter.validateSpec(spec));
      if (problems.length) continue;
      maxResults += (
        await adapter.estimate(spec, sourceOrgContext(this.businesses, organizationId, key, null))
      ).maxResults;
      const release = adapter.describe().snapshot?.release;
      if (release) sourceReleases.push({ source: key, release });
    }
    if (problems.length) throw AppError.validation(problems);
    if (maxResults === 0) {
      throw AppError.validation([
        {
          path: "sources",
          message:
            "No places match this search (or every match is already in your directory). Widen the location or categories.",
        },
      ]);
    }
    await this.consumeCreateBudget(organizationId);

    const limit = Math.max(1, Math.min(spec.maxRecords, maxResults));
    const id = new ObjectId();
    const hex = id.toHexString();
    const keys = jobCreditKeys(hex, 0);
    const hold = await this.credits.hold(organizationId, {
      units: limit,
      key: keys.hold,
      referenceType: "discovery_job",
      referenceId: hex,
      referenceName: spec.name,
      actorUserId: userId,
      description: `Hold for discovery job "${spec.name}" (up to ${limit} records)`,
    });

    const now = new Date();
    const doc: DiscoveryJobDocument = {
      _id: id,
      organizationId,
      name: spec.name,
      status: "queued",
      spec,
      specHash,
      idempotencyKey,
      limit,
      estimate: { maxRecords: limit, hold: limit, basis: BASIS },
      sourceReleases,
      round: 0,
      roundMode: "search",
      units: spec.sources.map((s): DiscoveryUnit => ({ key: `search-${s}`, source: s })),
      pendingUnits: spec.sources.map((s) => `search-${s}`),
      credits: {
        rounds: [
          {
            round: 0,
            holdKey: keys.hold,
            holdId: hold.entry.id,
            heldUnits: limit,
            capturedUnits: 0,
            releasedUnits: 0,
            settledAt: null,
          },
        ],
        settledAt: null,
      },
      progress: {
        processed: 0,
        created: 0,
        updated: 0,
        duplicates: 0,
        skipped: 0,
        failed: 0,
        billable: 0,
        pagesFetched: 0,
        lastEventAt: null,
      },
      pageKeys: [],
      sourceOutcomes: spec.sources.map((s) => ({
        source: s,
        status: "pending",
        pages: 0,
        records: 0,
        rateLimited: 0,
        errors: [],
      })),
      errors: [],
      warnings: [],
      cancelRequested: false,
      createdByUserId: userId,
      createdAt: now,
      updatedAt: now,
      queuedAt: now,
      startedAt: null,
      finishedAt: null,
      cancelledAt: null,
      timeoutAt: null,
    };

    let inserted: boolean;
    try {
      inserted = await this.jobs.insert(organizationId, doc);
    } catch (err) {
      await this.credits.releaseHold(organizationId, {
        holdKey: keys.hold,
        releaseKey: keys.release,
        description: "Job could not be saved; hold returned",
      });
      throw err;
    }
    if (!inserted) {
      // A concurrent request with the same Idempotency-Key created the job first.
      await this.credits.releaseHold(organizationId, {
        holdKey: keys.hold,
        releaseKey: keys.release,
        description: "Duplicate submission; hold returned",
      });
      const winner = await this.jobs.findByIdempotencyKey(organizationId, userId, idempotencyKey);
      if (winner && winner.specHash === specHash) return { job: this.view(winner), replayed: true };
      throw AppError.conflict("This Idempotency-Key was already used for a different job");
    }

    try {
      await this.queue.enqueueDiscoveryRun({
        organizationId,
        jobId: hex,
        round: 0,
        reason: "start",
      });
    } catch (err) {
      await this.runner.finalize(organizationId, id, 0, {
        kind: "failed",
        code: "ENQUEUE_FAILED",
        message: "The job could not be queued; credits were returned.",
      });
      throw err;
    }

    await this.audit.record(
      {
        organizationId,
        actorUserId: userId,
        actorType: "user",
        action: "discovery.created",
        resourceType: "discovery_job",
        resourceId: hex,
        after: {
          name: spec.name,
          sources: spec.sources,
          categories: spec.categories,
          maxRecords: spec.maxRecords,
          hold: limit,
        },
      },
      auditCtx,
    );
    return { job: this.view(doc), replayed: false };
  }

  /** 404 for unknown and other-organization ids. */
  async requireJob(organizationId: string, id: string): Promise<WithId<DiscoveryJobDocument>> {
    const job = await this.jobs.findById(organizationId, id);
    if (!job) throw AppError.notFound("Discovery job");
    return job;
  }

  async get(organizationId: string, id: string): Promise<DiscoveryJob> {
    return this.view(await this.requireJob(organizationId, id));
  }

  async list(
    organizationId: string,
    query: DiscoveryJobListQuery,
  ): Promise<{ items: DiscoveryJob[]; nextCursor: string | null }> {
    const page = await withCursor(() =>
      this.jobs.page(
        organizationId,
        { statuses: query.status, source: query.source },
        { pageSize: query.pageSize, cursor: query.cursor ?? null },
      ),
    );
    return { items: page.items.map((j) => this.view(j)), nextCursor: page.nextCursor };
  }

  async listItems(
    organizationId: string,
    id: string,
    query: DiscoveryItemsQuery,
  ): Promise<{ items: DiscoveryJobItem[]; nextCursor: string | null }> {
    const job = await this.requireJob(organizationId, id);
    const page = await withCursor(() =>
      this.items.page(organizationId, job._id, query.outcome, {
        pageSize: query.pageSize,
        cursor: query.cursor ?? null,
      }),
    );
    const ids = page.items.map((i) => i.businessId).filter((b): b is ObjectId => b !== null);
    const summaries = await this.businesses.summaries(organizationId, ids);
    return {
      items: page.items.map((i) =>
        toDiscoveryItemView(
          i,
          i.businessId ? summaries.get(i.businessId.toHexString()) : undefined,
        ),
      ),
      nextCursor: page.nextCursor,
    };
  }

  /**
   * Queued: cancelled at once and the whole hold released. Running: `cancelRequested` is set
   * and a cancel job stops further pages; items finished before the stop are captured.
   */
  async cancel(
    organizationId: string,
    userId: string,
    id: string,
    auditCtx: AuditContext,
  ): Promise<DiscoveryJob> {
    const job = await this.requireJob(organizationId, id);
    if (DISCOVERY_TERMINAL_STATUSES.includes(job.status)) {
      throw new AppError(
        "JOB_NOT_CANCELLABLE",
        `The job is already ${job.status.replace(/_/g, " ")}`,
      );
    }
    if (job.status === "queued") {
      const done = await this.runner.finalize(
        organizationId,
        job._id,
        job.round,
        { kind: "cancelled" },
        { from: ["queued"] },
      );
      if (done) {
        await this.audit.record(
          {
            organizationId,
            actorUserId: userId,
            actorType: "user",
            action: "discovery.cancelled",
            resourceType: "discovery_job",
            resourceId: id,
            after: { while: "queued" },
          },
          auditCtx,
        );
        return this.get(organizationId, id);
      }
    }
    const updated = await this.jobs.update(
      organizationId,
      job._id,
      { $set: { cancelRequested: true, updatedAt: new Date() } },
      { status: { $in: ["queued", "running"] } },
    );
    if (!updated)
      throw new AppError("JOB_NOT_CANCELLABLE", "The job finished before it could be cancelled");
    await this.queue.enqueueDiscoveryRun({
      organizationId,
      jobId: id,
      round: updated.round,
      reason: "cancel",
    });
    await this.audit.record(
      {
        organizationId,
        actorUserId: userId,
        actorType: "user",
        action: "discovery.cancel_requested",
        resourceType: "discovery_job",
        resourceId: id,
        after: { round: updated.round },
      },
      auditCtx,
    );
    return this.view(updated);
  }

  /**
   * Re-queues the failed items of a finished, settled job as a new round with its own hold
   * (`job:<id>:retry:<n>:hold`). Items succeed or fail again; only successes are captured.
   */
  async retryFailed(
    organizationId: string,
    userId: string,
    id: string,
    auditCtx: AuditContext,
  ): Promise<DiscoveryJob> {
    const job = await this.requireJob(organizationId, id);
    if (!DISCOVERY_TERMINAL_STATUSES.includes(job.status)) {
      throw new AppError(
        "JOB_NOT_RETRYABLE",
        "Wait until the job finishes before retrying failed items",
      );
    }
    if (!job.credits.rounds.every((r) => r.settledAt)) {
      throw new AppError(
        "JOB_NOT_RETRYABLE",
        "The job's credits are still being settled; try again in a few minutes",
      );
    }
    const failed = await this.items.failedItems(
      organizationId,
      job._id,
      DISCOVERY_LIMITS.maxRetryItems,
    );
    if (failed.length === 0)
      throw new AppError("JOB_NOT_RETRYABLE", "This job has no failed items to retry");
    const sources = [...new Set(failed.map((f) => f.source))] as DiscoverySourceKey[];
    await this.entitlements.assertDiscoveryEnabled(organizationId);
    for (const s of sources) await this.sources.requireRunnable(organizationId, s);

    const round = job.round + 1;
    const keys = jobCreditKeys(id, round);
    const hold = await this.credits.hold(organizationId, {
      units: failed.length,
      key: keys.hold,
      referenceType: "discovery_job",
      referenceId: id,
      referenceName: `${job.name} (retry ${round})`,
      actorUserId: userId,
      description: `Hold for retrying ${failed.length} failed items of discovery job "${job.name}"`,
    });
    const units: DiscoveryUnit[] = [];
    for (const s of sources) {
      const ids = failed.filter((f) => f.source === s).map((f) => f.externalId);
      for (let i = 0; i < ids.length; i += RETRY_BATCH_SIZE) {
        units.push({
          key: `retry-${s}-${i / RETRY_BATCH_SIZE}`,
          source: s,
          externalIds: ids.slice(i, i + RETRY_BATCH_SIZE),
        });
      }
    }
    const now = new Date();
    const reopened = await this.jobs.transition(
      organizationId,
      job._id,
      [job.status],
      {
        $set: {
          status: "queued",
          round,
          roundMode: "retry",
          units,
          pendingUnits: units.map((u) => u.key),
          limit: failed.length,
          cancelRequested: false,
          queuedAt: now,
          finishedAt: null,
          cancelledAt: null,
          timeoutAt: null,
          "credits.settledAt": null,
          updatedAt: now,
        },
        $push: {
          "credits.rounds": {
            round,
            holdKey: keys.hold,
            holdId: hold.entry.id,
            heldUnits: failed.length,
            capturedUnits: 0,
            releasedUnits: 0,
            settledAt: null,
          },
        },
      },
      { round: job.round },
    );
    if (!reopened) {
      await this.credits.releaseHold(organizationId, {
        holdKey: keys.hold,
        releaseKey: keys.release,
        description: "Retry was not started; hold returned",
      });
      throw AppError.conflict("The job changed while retrying; reload and try again");
    }
    try {
      await this.queue.enqueueDiscoveryRun({ organizationId, jobId: id, round, reason: "start" });
    } catch (err) {
      await this.runner.finalize(organizationId, job._id, round, {
        kind: "failed",
        code: "ENQUEUE_FAILED",
        message: "The retry could not be queued; credits were returned.",
      });
      throw err;
    }
    await this.audit.record(
      {
        organizationId,
        actorUserId: userId,
        actorType: "user",
        action: "discovery.retry_requested",
        resourceType: "discovery_job",
        resourceId: id,
        after: { round, items: failed.length },
      },
      auditCtx,
    );
    return this.view(reopened);
  }

  /** Jobs created per UTC day in [from, to), split by status (reports and usage). */
  jobsPerDay(organizationId: string, from: Date, to: Date) {
    return this.jobs.aggregateByDay(organizationId, {
      dateField: "createdAt",
      from,
      to,
      groupField: "status",
    });
  }

  /** All-jobs page: discovery jobs older than `before`, newest first. */
  async jobSummariesBefore(
    organizationId: string,
    statuses: JobStatus[] | undefined,
    before: { createdAt: Date; id: ObjectId } | null,
    limit: number,
  ): Promise<Array<{ createdAt: Date; id: ObjectId; summary: JobSummary }>> {
    const docs = await this.jobs.pageBefore(organizationId, { statuses }, before, limit);
    return docs.map((j) => ({
      createdAt: j.createdAt,
      id: j._id,
      summary: {
        id: j._id.toHexString(),
        kind: "discovery",
        name: j.name,
        status: j.status,
        kindStatus: j.status,
        progress: { processed: j.progress.processed, total: null, failed: j.progress.failed },
        createdByUserId: j.createdByUserId,
        createdAt: j.createdAt.toISOString(),
        startedAt: j.startedAt?.toISOString() ?? null,
        finishedAt: j.finishedAt?.toISOString() ?? null,
        href: `/app/discovery/${j._id.toHexString()}`,
      },
    }));
  }

  async overviewSummary(organizationId: string, since: Date) {
    const [total, inProgress, completedInPeriod, failedInPeriod, recent] = await Promise.all([
      this.jobs.countByStatus(organizationId),
      this.jobs.countByStatus(organizationId, ["queued", "running"]),
      this.jobs.countByStatus(organizationId, ["completed", "completed_with_warnings"], since),
      this.jobs.countByStatus(organizationId, ["failed"], since),
      this.jobs.page(organizationId, {}, { pageSize: 5 }),
    ]);
    return {
      total,
      inProgress,
      completedInPeriod,
      failedInPeriod,
      recent: recent.items.map((j) => {
        const v = this.view(j);
        return {
          id: v.id,
          name: v.name,
          status: v.status,
          progress: v.progress,
          createdAt: v.createdAt,
          finishedAt: v.finishedAt,
        };
      }),
    };
  }
}
