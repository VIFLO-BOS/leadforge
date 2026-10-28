import { Inject, Injectable } from "@nestjs/common";
import { Logger } from "nestjs-pino";
import type { ObjectId, WithId } from "@leadforge/db-mongo";
import {
  DISCOVERY_TERMINAL_STATUSES,
  ObjectIdString,
  roleHasPermission,
  UuidString,
  type DiscoveryJobStatus,
  type DiscoverySourceKey,
  type ServerEnv,
} from "@leadforge/contracts";
import { ENV } from "../config/env.module.js";
import { AuditService } from "../audit/audit.service.js";
import { QueueService } from "../queue/queue.service.js";
import type { FetchSourcePageJob, RunDiscoveryJob } from "../queue/queue.constants.js";
import { OrganizationsService } from "../organizations/organizations.service.js";
import {
  BusinessesService,
  type IngestItem,
  type IngestResult,
} from "../businesses/businesses.service.js";
import { SOURCE_CONFIDENCE } from "../businesses/business-model.js";
import { deterministicObjectId } from "../provenance/provenance.types.js";
import { CreditsService, jobCreditKeys } from "../credits/credits.service.js";
import { NotificationsService } from "../notifications/notifications.service.js";
import { SourcesService } from "../sources/sources.service.js";
import { SourceRateLimiter } from "../sources/source-rate-limiter.js";
import {
  SourceError,
  type MappedRecord,
  type SearchCursor,
  type SourceAdapter,
} from "../sources/source-adapter.js";
import type { DiscoveryJobDocument } from "./discovery.types.js";
import { sourceOrgContext } from "./discovery-context.js";
import { DiscoveryJobRepository } from "./repositories/discovery-job.repository.js";
import {
  DiscoveryItemRepository,
  type ItemWrite,
} from "./repositories/discovery-item.repository.js";

export type FinalizeReason =
  { kind: "completed" } | { kind: "cancelled" } | { kind: "failed"; code: string; message: string };

export type RunResult =
  | { status: "noop"; reason: string }
  | { status: "continued" }
  | { status: "unit_done" }
  | { status: "finalized"; jobStatus: DiscoveryJobStatus | null }
  | { status: "rate_limited"; retryAfterMs: number };

/** A payload that must not be retried: malformed, or a job id that is not in the payload's organization. */
export class DiscoveryPayloadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DiscoveryPayloadError";
  }
}

/** Some items failed on our side; the page job is retried (finished items are skipped). */
export class RetryableItemsError extends Error {
  constructor(readonly failedItems: number) {
    super(`${failedItems} item(s) failed to save; the page will be retried`);
    this.name = "RetryableItemsError";
  }
}

const TERMINAL: readonly DiscoveryJobStatus[] = DISCOVERY_TERMINAL_STATUSES;
const RETRY_DETAILS_WAIT_CAP_MS = 2_000;

/**
 * Runs discovery jobs in the worker (queue `discovery`).
 *
 * - run(start): re-verifies the organization, the creator's membership and `discovery:run`,
 *   moves the round to `running`, sets the timeout, and enqueues one page job per unit.
 * - processUnit: one page (or retry batch) per job: rate limit, fetch through the adapter,
 *   map, filter, ingest through BusinessesService (exact dedup, provenance), write item
 *   outcomes idempotently, update progress, then enqueue the next page or finish the unit.
 * - finalize: terminal status (once), credit settlement, notification, audit.
 *
 * Every step is safe to repeat: page jobs have deterministic ids, items are unique per
 * (job, source, external id), business and observation ids derive from the job and the place,
 * and ledger writes are keyed.
 */
@Injectable()
export class DiscoveryRunner {
  constructor(
    private readonly jobs: DiscoveryJobRepository,
    private readonly items: DiscoveryItemRepository,
    private readonly businesses: BusinessesService,
    private readonly sources: SourcesService,
    private readonly limiter: SourceRateLimiter,
    private readonly credits: CreditsService,
    private readonly notifications: NotificationsService,
    private readonly organizations: OrganizationsService,
    private readonly queue: QueueService,
    private readonly audit: AuditService,
    private readonly logger: Logger,
    @Inject(ENV) private readonly env: ServerEnv,
  ) {}

  // -------------------------------------------------------------------------
  // Payloads
  // -------------------------------------------------------------------------

  /** Loads the job in the payload's organization; anything else is rejected before work starts. */
  private async load(organizationId: string, jobId: string): Promise<WithId<DiscoveryJobDocument>> {
    if (!UuidString.safeParse(organizationId).success || !ObjectIdString.safeParse(jobId).success) {
      throw new DiscoveryPayloadError("Invalid discovery payload");
    }
    const job = await this.jobs.findById(organizationId, jobId);
    if (!job)
      throw new DiscoveryPayloadError("Discovery job not found in the payload's organization");
    return job;
  }

  private async accessProblem(job: DiscoveryJobDocument): Promise<string | null> {
    const member = await this.organizations.isActiveMember(job.organizationId, job.createdByUserId);
    if (!member.active || !member.role)
      return "The organization is no longer active, or the user who started this job is no longer a member.";
    if (!roleHasPermission(member.role, "discovery:run"))
      return "The user who started this job no longer has permission to run discovery.";
    return null;
  }

  // -------------------------------------------------------------------------
  // Orchestrator: run-discovery-job
  // -------------------------------------------------------------------------

  async run(payload: RunDiscoveryJob): Promise<RunResult> {
    const job = await this.load(payload.organizationId, payload.jobId);
    if (TERMINAL.includes(job.status)) return { status: "noop", reason: `job is ${job.status}` };
    if (job.round !== payload.round) return { status: "noop", reason: "stale round" };
    const org = job.organizationId;

    if (payload.reason === "cancel") {
      const done = await this.finalize(org, job._id, job.round, { kind: "cancelled" });
      return { status: "finalized", jobStatus: done ? "cancelled" : null };
    }
    if (payload.reason === "timeout") {
      if (
        job.status !== "running" ||
        !job.timeoutAt ||
        job.timeoutAt.getTime() > Date.now() + 1_000
      ) {
        return { status: "noop", reason: "not timed out" };
      }
      await this.finalize(org, job._id, job.round, {
        kind: "failed",
        code: "JOB_TIMEOUT",
        message: "The job ran longer than its time limit and was stopped.",
      });
      return { status: "finalized", jobStatus: "failed" };
    }

    if (job.status === "running") {
      // A repeated start (crash after the transition): page jobs have fixed ids, so this is a no-op if they exist.
      await this.enqueueUnits(job);
      return { status: "continued" };
    }

    const problem = await this.accessProblem(job);
    if (problem) {
      await this.finalize(org, job._id, job.round, {
        kind: "failed",
        code: "ACCESS_REVOKED",
        message: problem,
      });
      return { status: "finalized", jobStatus: "failed" };
    }
    if (job.cancelRequested) {
      await this.finalize(org, job._id, job.round, { kind: "cancelled" });
      return { status: "finalized", jobStatus: "cancelled" };
    }
    for (const source of new Set(job.units.map((u) => u.source))) {
      const r = await this.sources.runnability(org, source);
      if (r.blocker) {
        await this.finalize(org, job._id, job.round, {
          kind: "failed",
          code: r.blocker.code,
          message: r.blocker.message,
        });
        return { status: "finalized", jobStatus: "failed" };
      }
    }

    const now = new Date();
    const timeoutAt = new Date(now.getTime() + this.env.DISCOVERY_JOB_TIMEOUT_MS);
    const sources = [...new Set(job.units.map((u) => u.source))];
    const started = await this.jobs.transition(
      org,
      job._id,
      ["queued"],
      {
        $set: {
          status: "running",
          startedAt: job.startedAt ?? now,
          timeoutAt,
          updatedAt: now,
          "sourceOutcomes.$[s].status": "running",
        },
      },
      { round: job.round },
      [{ "s.source": { $in: sources } }],
    );
    if (!started) return { status: "noop", reason: "already started or cancelled" };
    await this.enqueueUnits(started);
    await this.queue.enqueueDiscoveryRun(
      { organizationId: org, jobId: job._id.toHexString(), round: job.round, reason: "timeout" },
      {
        delayMs: this.env.DISCOVERY_JOB_TIMEOUT_MS,
      },
    );
    this.logger.log(
      {
        organizationId: org,
        jobId: job._id.toHexString(),
        round: job.round,
        units: started.pendingUnits.length,
      },
      "Discovery round started",
    );
    return { status: "continued" };
  }

  private async enqueueUnits(job: DiscoveryJobDocument): Promise<void> {
    for (const unit of job.units) {
      if (!job.pendingUnits.includes(unit.key)) continue;
      await this.queue.enqueueDiscoveryPage({
        organizationId: job.organizationId,
        jobId: job._id.toHexString(),
        round: job.round,
        source: unit.source,
        unit: unit.key,
        cursor: unit.externalIds
          ? { kind: "items", externalIds: unit.externalIds }
          : { kind: "search", queryIndex: 0, pageIndex: 0, pageToken: null },
      });
    }
  }

  // -------------------------------------------------------------------------
  // Page processor: fetch-source-page
  // -------------------------------------------------------------------------

  async processUnit(
    payload: FetchSourcePageJob,
    attempt: { attemptsMade: number; maxAttempts: number },
  ): Promise<RunResult> {
    const job = await this.load(payload.organizationId, payload.jobId);
    if (TERMINAL.includes(job.status)) return { status: "noop", reason: `job is ${job.status}` };
    if (job.round !== payload.round || job.status !== "running")
      return { status: "noop", reason: "not running in this round" };
    if (!job.pendingUnits.includes(payload.unit))
      return { status: "noop", reason: "unit already finished" };
    const org = job.organizationId;

    const problem = await this.accessProblem(job);
    if (problem) {
      await this.finalize(org, job._id, job.round, {
        kind: "failed",
        code: "ACCESS_REVOKED",
        message: problem,
      });
      return { status: "finalized", jobStatus: "failed" };
    }
    if (job.cancelRequested) {
      await this.finalize(org, job._id, job.round, { kind: "cancelled" });
      return { status: "finalized", jobStatus: "cancelled" };
    }
    if (job.timeoutAt && job.timeoutAt.getTime() <= Date.now()) {
      await this.finalize(org, job._id, job.round, {
        kind: "failed",
        code: "JOB_TIMEOUT",
        message: "The job ran longer than its time limit and was stopped.",
      });
      return { status: "finalized", jobStatus: "failed" };
    }

    const source = payload.source as DiscoverySourceKey;
    const adapter = this.sources.adapter(source);
    // A worker that just started has not loaded snapshot state yet (Overture): refresh before checking.
    await adapter?.refreshState?.();
    if (adapter?.policy.blockedByTerms) {
      await this.recordSourceError(
        job,
        source,
        new SourceError("SOURCE_POLICY_BLOCKED", adapter.policy.blockedByTerms.detail, false),
        true,
      );
      return this.completeUnit(job, payload.unit, source, "failed");
    }
    if (!adapter || adapter.describe().status !== "configured") {
      await this.recordSourceError(
        job,
        source,
        new SourceError("SOURCE_NOT_CONFIGURED", "The source is not configured", false),
        true,
      );
      return this.completeUnit(job, payload.unit, source, "failed");
    }

    const wait = await this.limiter.acquire(source, adapter.policy.rateLimit);
    if (wait > 0) {
      await this.jobs.update(org, job._id, { $inc: { "sourceOutcomes.$[s].rateLimited": 1 } }, {}, [
        { "s.source": source },
      ]);
      return { status: "rate_limited", retryAfterMs: wait };
    }

    const collectedAt = new Date();
    let records: unknown[] = [];
    let next: SearchCursor | null = null;
    const missing: string[] = [];
    try {
      if (payload.cursor.kind === "search") {
        const from: SearchCursor = {
          queryIndex: payload.cursor.queryIndex,
          pageIndex: payload.cursor.pageIndex,
          pageToken: payload.cursor.pageToken,
        };
        const context = sourceOrgContext(this.businesses, org, source, job._id);
        const iterator = adapter.search(job.spec, { from, context })[Symbol.asyncIterator]();
        const first = await iterator.next();
        await iterator.return?.(undefined);
        if (!first.done) {
          records = first.value.records;
          next = first.value.nextCursor;
          await this.jobs.countPage(
            org,
            job._id,
            `${source}:${from.queryIndex}:${from.pageIndex}`,
            source,
            records.length,
          );
        }
      } else {
        for (const externalId of payload.cursor.externalIds) {
          const extra = await this.limiter.acquire(source, adapter.policy.rateLimit);
          if (extra > 0) await sleep(Math.min(extra, RETRY_DETAILS_WAIT_CAP_MS));
          const record = await adapter.fetchRecord(externalId, job.spec);
          if (record) records.push(record);
          else missing.push(externalId);
        }
      }
    } catch (err) {
      if (err instanceof SourceError) {
        if (err.retryable && attempt.attemptsMade + 1 < attempt.maxAttempts) {
          await this.recordSourceError(job, source, err, false);
          throw err;
        }
        await this.recordSourceError(job, source, err, true);
        return this.completeUnit(job, payload.unit, source, "failed");
      }
      throw err;
    }

    if (missing.length) {
      await this.items.writeOutcomes(
        org,
        job._id,
        missing.map((externalId) => ({
          source,
          externalId,
          round: job.round,
          outcome: "skipped",
          billable: false,
          businessId: null,
          duplicateOfId: null,
          error: {
            code: "PLACE_NOT_FOUND",
            message: "The source no longer returns this record",
            retryable: false,
          },
          warnings: [],
        })),
      );
    }

    const outcome = await this.processRecords(job, source, adapter, records, collectedAt);
    await this.refreshProgress(job);
    if (outcome.retryableFailures > 0 && attempt.attemptsMade + 1 < attempt.maxAttempts) {
      throw new RetryableItemsError(outcome.retryableFailures);
    }
    if (payload.cursor.kind === "search" && next && !outcome.limitReached) {
      await this.queue.enqueueDiscoveryPage({ ...payload, cursor: { kind: "search", ...next } });
      return { status: "continued" };
    }
    return this.completeUnit(job, payload.unit, source, "completed");
  }

  /** The last attempt failed with an unexpected error: record it and finish the unit so the job can end. */
  async failUnit(payload: FetchSourcePageJob, err: unknown): Promise<void> {
    let job: WithId<DiscoveryJobDocument>;
    try {
      job = await this.load(payload.organizationId, payload.jobId);
    } catch {
      return;
    }
    if (TERMINAL.includes(job.status) || job.round !== payload.round) return;
    const source = payload.source as DiscoverySourceKey;
    const message =
      err instanceof RetryableItemsError
        ? err.message
        : "Processing failed repeatedly; items not saved are marked failed and can be retried.";
    if (!(err instanceof RetryableItemsError)) {
      await this.recordSourceError(
        job,
        source,
        new SourceError("SOURCE_ERROR", message, false),
        false,
      );
    }
    await this.refreshProgress(job);
    await this.completeUnit(
      job,
      payload.unit,
      source,
      err instanceof RetryableItemsError ? "completed" : "failed",
    );
  }

  private async processRecords(
    job: WithId<DiscoveryJobDocument>,
    source: DiscoverySourceKey,
    adapter: SourceAdapter,
    records: unknown[],
    collectedAt: Date,
  ): Promise<{ retryableFailures: number; limitReached: boolean }> {
    const org = job.organizationId;
    const mapped: MappedRecord[] = [];
    const seen = new Set<string>();
    for (const record of records) {
      const m = adapter.mapToObservations(record, { spec: job.spec, collectedAt });
      if (seen.has(m.externalId)) continue; // the source repeated a record within the page
      seen.add(m.externalId);
      mapped.push(m);
    }
    const prior = await this.items.findByExternalIds(
      org,
      job._id,
      source,
      mapped.map((m) => m.externalId),
    );
    // Finished items are never processed again (idempotent reprocessing); failed ones are retried.
    const todo = mapped.filter((m) => {
      const p = prior.get(m.externalId);
      return !p || p.outcome === "failed";
    });

    const include = new Set(job.spec.domainsInclude);
    const exclude = new Set(job.spec.domainsExclude);
    const skips: ItemWrite[] = [];
    const toIngest: MappedRecord[] = [];
    for (const m of todo) {
      if (m.skip || !m.input) {
        skips.push(
          itemWrite(job, source, m, "skipped", {
            error: m.skip ? { ...m.skip, retryable: false } : null,
          }),
        );
        continue;
      }
      const domain = m.input.website?.domain ?? null;
      if (include.size > 0 && (!domain || !include.has(domain))) {
        skips.push(
          itemWrite(job, source, m, "skipped", {
            error: {
              code: "DOMAIN_NOT_INCLUDED",
              message: "The website is not on the job's domain list",
              retryable: false,
            },
          }),
        );
        continue;
      }
      if (domain && exclude.has(domain)) {
        skips.push(
          itemWrite(job, source, m, "skipped", {
            error: {
              code: "DOMAIN_EXCLUDED",
              message: `The website domain ${domain} is excluded by the job`,
              retryable: false,
            },
          }),
        );
        continue;
      }
      toIngest.push(m);
    }
    await this.items.writeOutcomes(org, job._id, skips);

    let billable = await this.items.billableInRound(org, job._id, job.round);
    let retryableFailures = 0;
    let index = 0;
    while (index < toIngest.length && billable < job.limit) {
      const chunk = toIngest.slice(index, index + (job.limit - billable));
      index += chunk.length;
      const results = await this.ingest(job, source, chunk, collectedAt);
      const businessIds = results
        .filter((r): r is IngestResult => !(r instanceof Error) && r.businessId !== null)
        .map((r) => r.businessId!);
      const produced = new Map(
        (await this.items.producedBusinesses(org, job._id, businessIds)).map((p) => [
          p.businessId.toHexString(),
          p.externalId,
        ]),
      );
      const writes: ItemWrite[] = chunk.map((m, i) => {
        const r = results[i]!;
        if (r instanceof Error) {
          retryableFailures += 1;
          return itemWrite(job, source, m, "failed", {
            error: {
              code: "INGEST_FAILED",
              message:
                "Saving this record failed on our side; it is not charged and can be retried",
              retryable: true,
            },
          });
        }
        const warnings = r.warnings.map((w) => ({ code: w.code, message: w.message }));
        if (r.outcome === "suppressed") {
          return itemWrite(job, source, m, "skipped", {
            businessId: r.businessId,
            warnings,
            error: {
              code: "SUPPRESSED",
              message: r.warnings[0]?.message ?? "Matches a suppression entry",
              retryable: false,
            },
          });
        }
        const businessId = r.businessId!;
        if (r.linkedBefore) {
          // Already in the directory from an earlier job (same record, or the same upstream place): never charged twice.
          return itemWrite(job, source, m, "duplicate", {
            businessId,
            duplicateOfId: businessId,
            warnings: [
              ...warnings,
              {
                code: "ALREADY_IN_DIRECTORY",
                message: "This place is already in your directory; it was refreshed, not charged",
              },
            ],
          });
        }
        const owner = produced.get(businessId.toHexString());
        if (owner && owner !== m.externalId) {
          return itemWrite(job, source, m, "duplicate", {
            businessId,
            duplicateOfId: businessId,
            warnings,
          });
        }
        produced.set(businessId.toHexString(), m.externalId);
        return itemWrite(job, source, m, r.outcome === "created" ? "created" : "updated", {
          businessId,
          warnings,
          billable: true,
        });
      });
      await this.items.writeOutcomes(org, job._id, writes);
      billable = await this.items.billableInRound(org, job._id, job.round);
    }
    return { retryableFailures, limitReached: billable >= job.limit || index < toIngest.length };
  }

  /** Ingests a chunk; if the batch write fails, each item is retried alone so one bad record cannot fail the others. */
  private async ingest(
    job: WithId<DiscoveryJobDocument>,
    source: DiscoverySourceKey,
    chunk: MappedRecord[],
    collectedAt: Date,
  ): Promise<Array<IngestResult | Error>> {
    const hex = job._id.toHexString();
    const items: IngestItem[] = chunk.map((m) => ({
      input: m.input!,
      newId: deterministicObjectId(
        `discovery:${hex}:${source}:${m.externalId}:business`,
        job.createdAt,
      ),
      createdVia: {
        kind: "discovery",
        importId: null,
        userId: job.createdByUserId,
        discoveryJobId: job._id,
      },
      ctx: {
        source,
        collectionMethod: m.provenance.collectionMethod ?? "api",
        sourceRef: m.provenance.sourceRef,
        collectedAt,
        observedAt: m.provenance.observedAt ?? null,
        confidence: m.provenance.confidence ?? SOURCE_CONFIDENCE[source],
        actor: { type: "system", userId: job.createdByUserId },
        importId: null,
        note: null,
        metadata: { round: job.round, ...(m.provenance.metadata ?? {}) },
        idSeed: `discovery:${hex}:${source}:${m.externalId}`,
        idTime: job.createdAt,
        expiresAt: m.provenance.expiresAt,
        sourceExternalId: m.externalId,
        discoveryJobId: job._id,
        categoryTaxonomy: m.provenance.categoryTaxonomy,
        externalRef: {
          source,
          externalId: m.externalId,
          expiresAt: m.provenance.externalIdExpiresAt,
          ...(m.provenance.matchKeys ? { matchKeys: m.provenance.matchKeys } : {}),
          ...(m.provenance.ref ? { ...m.provenance.ref } : {}),
        },
        attribution: m.provenance.attribution,
      },
    }));
    try {
      return await this.businesses.ingestBatch(job.organizationId, items);
    } catch (batchError) {
      this.logger.warn(
        { err: batchError, jobId: hex, items: items.length },
        "Batch ingest failed; retrying items one by one",
      );
      const out: Array<IngestResult | Error> = [];
      for (const item of items) {
        try {
          const [r] = await this.businesses.ingestBatch(job.organizationId, [item]);
          out.push(r ?? new Error("No ingest result"));
        } catch (err) {
          out.push(err instanceof Error ? err : new Error(String(err)));
        }
      }
      return out;
    }
  }

  private async refreshProgress(job: DiscoveryJobDocument): Promise<void> {
    const c = await this.items.counts(job.organizationId, job._id);
    await this.jobs.update(job.organizationId, job._id, {
      $set: {
        "progress.processed": c.processed,
        "progress.created": c.created,
        "progress.updated": c.updated,
        "progress.duplicates": c.duplicates,
        "progress.skipped": c.skipped,
        "progress.failed": c.failed,
        "progress.billable": c.billable,
        "progress.lastEventAt": new Date(),
        updatedAt: new Date(),
      },
    });
  }

  private async recordSourceError(
    job: DiscoveryJobDocument,
    source: DiscoverySourceKey,
    err: SourceError,
    final: boolean,
  ): Promise<void> {
    const now = new Date();
    await this.jobs.update(
      job.organizationId,
      job._id,
      {
        $push: {
          "sourceOutcomes.$[s].errors": {
            $each: [{ code: err.code, message: err.message.slice(0, 500), count: 1 }],
            $slice: -20,
          },
          ...(final
            ? {
                errors: {
                  $each: [{ code: err.code, message: err.message.slice(0, 500), at: now, source }],
                  $slice: -50,
                },
              }
            : {}),
        },
        $set: { updatedAt: now, ...(final ? { "sourceOutcomes.$[s].status": "failed" } : {}) },
      },
      {},
      [{ "s.source": source }],
    );
    this.logger.warn(
      {
        organizationId: job.organizationId,
        jobId: job._id.toHexString(),
        source,
        code: err.code,
        retryable: err.retryable,
        final,
      },
      "Discovery source error",
    );
  }

  private async completeUnit(
    job: DiscoveryJobDocument,
    unit: string,
    source: DiscoverySourceKey,
    status: "completed" | "failed",
  ): Promise<RunResult> {
    const setStatus = job.roundMode === "search" || status === "failed";
    const doc = await this.jobs.finishUnit(
      job.organizationId,
      job._id,
      job.round,
      unit,
      setStatus ? { "sourceOutcomes.$[s].status": status } : {},
      setStatus ? [{ "s.source": source, "s.status": { $ne: "failed" } }] : undefined,
    );
    if (!doc) return { status: "noop", reason: "unit already finished" };
    if (doc.pendingUnits.length > 0) return { status: "unit_done" };
    const done = await this.finalize(job.organizationId, job._id, job.round, { kind: "completed" });
    return {
      status: "finalized",
      jobStatus: done
        ? ((await this.jobs.findById(job.organizationId, job._id))?.status ?? null)
        : null,
    };
  }

  // -------------------------------------------------------------------------
  // Finalize and settle
  // -------------------------------------------------------------------------

  /**
   * Moves the round to its terminal status (once), then settles its credits. Returns true when
   * this call made the transition. Settlement also runs when another caller already finalized,
   * so a crash between the two steps is repaired by the next call or by reconciliation.
   */
  async finalize(
    organizationId: string,
    jobId: ObjectId,
    round: number,
    reason: FinalizeReason,
    options: { from?: DiscoveryJobStatus[] } = {},
  ): Promise<boolean> {
    const job = await this.jobs.findById(organizationId, jobId);
    if (!job || job.round !== round) return false;
    const counts = await this.items.counts(organizationId, jobId);
    const sourceFailed = job.sourceOutcomes.some((s) => s.status === "failed");
    let status: DiscoveryJobStatus;
    if (reason.kind === "cancelled") status = "cancelled";
    else if (reason.kind === "failed") status = "failed";
    else if (sourceFailed && counts.billable === 0 && job.roundMode === "search") status = "failed";
    else status = counts.failed > 0 || sourceFailed ? "completed_with_warnings" : "completed";

    const now = new Date();
    const outcomeStatus =
      status === "cancelled" ? "cancelled" : status === "failed" ? "failed" : "completed";
    const transitioned = await this.jobs.transition(
      organizationId,
      jobId,
      options.from ?? ["queued", "running"],
      {
        $set: {
          status,
          finishedAt: now,
          updatedAt: now,
          pendingUnits: [],
          "progress.processed": counts.processed,
          "progress.created": counts.created,
          "progress.updated": counts.updated,
          "progress.duplicates": counts.duplicates,
          "progress.skipped": counts.skipped,
          "progress.failed": counts.failed,
          "progress.billable": counts.billable,
          "progress.lastEventAt": now,
          "sourceOutcomes.$[open].status": outcomeStatus,
          ...(status === "cancelled" ? { cancelledAt: now, cancelRequested: true } : {}),
        },
        ...(reason.kind === "failed"
          ? {
              $push: {
                errors: {
                  $each: [{ code: reason.code, message: reason.message, at: now, source: null }],
                  $slice: -50,
                },
              },
            }
          : {}),
      },
      { round },
      [{ "open.status": { $in: ["pending", "running"] } }],
    );

    await this.settle(organizationId, jobId, round);

    if (transitioned) {
      const hex = jobId.toHexString();
      const failure =
        reason.kind === "failed"
          ? reason.message
          : (transitioned.errors[transitioned.errors.length - 1]?.message ?? null);
      await this.audit.record({
        organizationId,
        actorUserId: job.createdByUserId,
        actorType: "system",
        action: "discovery.finished",
        resourceType: "discovery_job",
        resourceId: hex,
        after: { status, round, ...counts, error: reason.kind === "failed" ? reason.code : null },
      });
      if (status !== "cancelled") {
        await this.notifications.discoveryFinished({
          organizationId,
          jobId: hex,
          round,
          name: job.name,
          status,
          userId: job.createdByUserId,
          created: counts.created,
          updated: counts.updated,
          failed: counts.failed,
          reason: status === "failed" ? failure : null,
        });
      }
      this.logger.log(
        { organizationId, jobId: hex, round, status, ...counts },
        "Discovery round finished",
      );
    }
    return Boolean(transitioned);
  }

  /**
   * Captures the round's billable items (created or updated, never failed, skipped or
   * duplicate) and releases the rest of its hold. Never settles a round that is still live.
   */
  async settle(organizationId: string, jobId: ObjectId, round: number): Promise<void> {
    const job = await this.jobs.findById(organizationId, jobId);
    if (!job) return;
    if (job.round === round && !TERMINAL.includes(job.status)) return;
    const rc = job.credits.rounds.find((r) => r.round === round);
    if (!rc || rc.settledAt) return;
    const billable = await this.items.billableInRound(organizationId, jobId, round);
    const keys = jobCreditKeys(jobId.toHexString(), round);
    const res = await this.credits.settle(organizationId, {
      holdKey: rc.holdKey,
      captureKey: keys.capture,
      releaseKey: keys.release,
      capturedUnits: billable,
      description: `Discovery job "${job.name}"${round > 0 ? ` retry ${round}` : ""}: ${billable} record${billable === 1 ? "" : "s"} produced`,
    });
    const now = new Date();
    await this.jobs.update(
      organizationId,
      jobId,
      {
        $set: {
          "credits.rounds.$[r].capturedUnits": res.captured,
          "credits.rounds.$[r].releasedUnits": res.released,
          "credits.rounds.$[r].settledAt": now,
          ...(round === job.round ? { "credits.settledAt": now } : {}),
          updatedAt: now,
        },
      },
      {},
      [{ "r.round": round }],
    );
  }

  /** Settles every unsettled round of a finished job (reconciliation). */
  async settleAll(organizationId: string, jobId: ObjectId): Promise<number> {
    const job = await this.jobs.findById(organizationId, jobId);
    if (!job) return 0;
    let settled = 0;
    for (const rc of job.credits.rounds) {
      if (rc.settledAt) continue;
      if (rc.round === job.round && !TERMINAL.includes(job.status)) continue;
      await this.settle(organizationId, jobId, rc.round);
      settled += 1;
    }
    return settled;
  }
}

function itemWrite(
  job: DiscoveryJobDocument,
  source: DiscoverySourceKey,
  m: MappedRecord,
  outcome: ItemWrite["outcome"],
  extra: Partial<
    Pick<ItemWrite, "businessId" | "duplicateOfId" | "error" | "billable" | "warnings">
  > = {},
): ItemWrite {
  return {
    source,
    externalId: m.externalId,
    round: job.round,
    outcome,
    billable: extra.billable ?? false,
    businessId: extra.businessId ?? null,
    duplicateOfId: extra.duplicateOfId ?? null,
    error: extra.error ?? null,
    warnings: [...m.warnings, ...(extra.warnings ?? [])],
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
