import { Inject, Injectable } from "@nestjs/common";
import type { Redis } from "ioredis";
import { ObjectId, type WithId } from "@leadforge/db-mongo";
import type {
  EnrichmentRun,
  EnrichmentRunKind,
  EnrichmentRunListQuery,
  EnrichmentRunStatus,
  JobStatus,
  JobSummary,
  RefreshResponse,
} from "@leadforge/contracts";
import { REDIS } from "../redis/redis.module.js";
import { AppError } from "../common/errors/app.error.js";
import { withCursor } from "../common/pagination/cursor.js";
import { AuditService, type AuditContext } from "../audit/audit.service.js";
import { QueueService } from "../queue/queue.service.js";
import { BusinessesService } from "../businesses/businesses.service.js";
import type { BusinessDocument } from "../businesses/business.types.js";
import { normalizeEmail } from "../normalization/email.js";
import { ProvenanceService } from "../provenance/provenance.service.js";
import { WebsiteAnalysisService } from "../website-analysis/website-analysis.service.js";
import { emptyRunOutput, type EnrichmentRunDocument } from "./enrichment.types.js";
import { EnrichmentRunner } from "./enrichment.runner.js";
import { EnrichmentRunRepository } from "./repositories/enrichment-run.repository.js";

const FROM_JOB_STATUS: Record<JobStatus, EnrichmentRunStatus[]> = {
  draft: [],
  queued: ["queued"],
  running: ["running"],
  completed: ["completed"],
  completed_with_warnings: [],
  failed: ["failed"],
  cancelled: [],
};

/** Enrichment runs per organization per hour (they cost no credits, so they are rate limited instead). */
export const ENRICHMENT_RUNS_PER_HOUR = 600;
const HOUR_MS = 60 * 60 * 1000;

export function toEnrichmentRunView(
  r: EnrichmentRunDocument,
  observationIds?: ObjectId[],
): EnrichmentRun {
  return {
    id: r._id.toHexString(),
    businessId: r.businessId.toHexString(),
    kind: r.kind,
    status: r.status,
    trigger: r.trigger,
    input: { url: r.input.url, address: r.input.address },
    output: {
      pagesVisited: r.output.pagesVisited.map((p) => ({ ...p })),
      observationIds: (observationIds ?? r.output.observationIds).map((id) => id.toHexString()),
      found: { ...r.output.found },
      phonesVerified: r.output.phonesVerified,
      whatsappConfirmed: r.output.whatsappConfirmed,
      emailChecks: r.output.emailChecks.map((c) => ({ ...c })),
      ownSite: r.output.ownSite,
    },
    error: r.error,
    requestedByUserId: r.requestedByUserId,
    createdAt: r.createdAt.toISOString(),
    startedAt: r.startedAt?.toISOString() ?? null,
    finishedAt: r.finishedAt?.toISOString() ?? null,
  };
}

/**
 * Enrichment requests (website contacts, email checks) and the per-business refresh. Runs are
 * free: release 1 email checks cost nothing (PRODUCT_REQUIREMENTS section 8) and website
 * contacts extraction is enrichment of the business's own site. A business has at most one
 * queued or running run per kind; asking again returns it.
 */
@Injectable()
export class EnrichmentService {
  constructor(
    private readonly runs: EnrichmentRunRepository,
    private readonly businesses: BusinessesService,
    private readonly provenance: ProvenanceService,
    private readonly analyses: WebsiteAnalysisService,
    private readonly runner: EnrichmentRunner,
    private readonly queue: QueueService,
    private readonly audit: AuditService,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  private async consumeBudget(organizationId: string): Promise<void> {
    const key = `lf:rate:enrichment:${organizationId}:${Math.floor(Date.now() / HOUR_MS)}`;
    const count = await this.redis.incr(key);
    if (count === 1) await this.redis.pexpire(key, HOUR_MS + 60_000);
    if (count > ENRICHMENT_RUNS_PER_HOUR) {
      throw new AppError(
        "RATE_LIMITED",
        `At most ${ENRICHMENT_RUNS_PER_HOUR} enrichment runs per hour per organization. Try again later.`,
      );
    }
  }

  private requireWebsite(doc: BusinessDocument): string {
    const url = WebsiteAnalysisService.websiteOf(doc);
    if (!url)
      throw new AppError(
        "WEBSITE_MISSING",
        "This business has no website on record to collect contacts from",
        [{ path: "businessId", message: doc._id.toHexString() }],
      );
    if (doc.flags.suppressed)
      throw new AppError("CONFLICT", "The business is suppressed; its website is not fetched");
    return url;
  }

  private async start(
    organizationId: string,
    userId: string,
    doc: BusinessDocument,
    kind: EnrichmentRunKind,
    input: EnrichmentRunDocument["input"],
    trigger: EnrichmentRunDocument["trigger"],
  ): Promise<{ run: EnrichmentRunDocument; created: boolean }> {
    const active = await this.runs.findActive(organizationId, doc._id, kind);
    if (active) return { run: active, created: false };
    await this.consumeBudget(organizationId);
    const now = new Date();
    const run: EnrichmentRunDocument = {
      _id: new ObjectId(),
      organizationId,
      businessId: doc._id,
      kind,
      status: "queued",
      active: true,
      trigger,
      input,
      output: emptyRunOutput(),
      error: null,
      attempts: 0,
      requestedByUserId: userId,
      createdAt: now,
      updatedAt: now,
      startedAt: null,
      finishedAt: null,
    };
    if (!(await this.runs.insert(organizationId, run))) {
      const winner = await this.runs.findActive(organizationId, doc._id, kind);
      if (winner) return { run: winner, created: false };
      throw AppError.conflict("The run changed while it was being queued; try again");
    }
    try {
      await this.queue.enqueueEnrichment(
        kind === "website_contacts" ? "website-contacts" : "verify-contact",
        { organizationId, runId: run._id.toHexString() },
      );
    } catch (err) {
      await this.runner.finalize(organizationId, run._id, {
        kind: "failed",
        code: "ENQUEUE_FAILED",
        message: "The run could not be queued.",
      });
      throw err;
    }
    return { run, created: true };
  }

  async requestWebsiteContacts(
    organizationId: string,
    userId: string,
    businessId: string,
    auditCtx: AuditContext,
  ): Promise<{ run: EnrichmentRun; created: boolean }> {
    const doc = await this.businesses.requireBusiness(organizationId, businessId);
    const url = this.requireWebsite(doc);
    const { run, created } = await this.start(
      organizationId,
      userId,
      doc,
      "website_contacts",
      { url, address: null },
      "manual",
    );
    if (created) {
      await this.audit.record(
        {
          organizationId,
          actorUserId: userId,
          actorType: "user",
          action: "enrichment.requested",
          resourceType: "business",
          resourceId: businessId,
          after: { kind: "website_contacts", runId: run._id.toHexString() },
        },
        auditCtx,
      );
    }
    return { run: toEnrichmentRunView(run), created };
  }

  async requestEmailCheck(
    organizationId: string,
    userId: string,
    businessId: string,
    rawAddress: string,
    auditCtx: AuditContext,
  ): Promise<{ run: EnrichmentRun; created: boolean }> {
    const doc = await this.businesses.requireBusiness(organizationId, businessId);
    const parsed = normalizeEmail(rawAddress);
    const address = parsed.ok ? parsed.address : rawAddress.trim().toLowerCase();
    if (!doc.emails.some((e) => e.address === address)) {
      throw AppError.validation([
        { path: "address", message: "That email address is not on this business" },
      ]);
    }
    const { run, created } = await this.start(
      organizationId,
      userId,
      doc,
      "email_check",
      { url: null, address },
      "manual",
    );
    if (created) {
      await this.audit.record(
        {
          organizationId,
          actorUserId: userId,
          actorType: "user",
          action: "enrichment.requested",
          resourceType: "business",
          resourceId: businessId,
          after: { kind: "email_check", runId: run._id.toHexString() },
        },
        auditCtx,
      );
    }
    return { run: toEnrichmentRunView(run), created };
  }

  /**
   * Refresh: re-collect website contacts and re-analyze the website. The analysis holds 1
   * credit (or reuses an analysis already in progress); contacts collection is free. A
   * business without a usable website is 422 WEBSITE_MISSING.
   */
  async refresh(
    organizationId: string,
    userId: string,
    businessId: string,
    auditCtx: AuditContext,
  ): Promise<RefreshResponse> {
    const doc = await this.businesses.requireBusiness(organizationId, businessId);
    const url = this.requireWebsite(doc);
    const analysis = await this.analyses.request(
      organizationId,
      userId,
      { businessId },
      "refresh",
      auditCtx,
    );
    const { run } = await this.start(
      organizationId,
      userId,
      doc,
      "website_contacts",
      { url, address: null },
      "refresh",
    );
    await this.audit.record(
      {
        organizationId,
        actorUserId: userId,
        actorType: "user",
        action: "business.refresh_requested",
        resourceType: "business",
        resourceId: businessId,
        after: {
          analysisId: analysis.analyses[0]?.id ?? null,
          enrichmentRunId: run._id.toHexString(),
          creditsHeld: analysis.credits.held,
        },
      },
      auditCtx,
    );
    return {
      enrichmentRun: toEnrichmentRunView(run),
      analysis: analysis.analyses[0]!,
      analysisAlreadyInProgress: analysis.alreadyInProgress.length > 0,
    };
  }

  async requireRun(organizationId: string, id: string): Promise<WithId<EnrichmentRunDocument>> {
    const run = await this.runs.findById(organizationId, id);
    if (!run) throw AppError.notFound("Enrichment run");
    return run;
  }

  async get(organizationId: string, id: string): Promise<EnrichmentRun> {
    const run = await this.requireRun(organizationId, id);
    return toEnrichmentRunView(run);
  }

  async listForBusiness(
    organizationId: string,
    businessId: string,
    query: EnrichmentRunListQuery,
  ): Promise<{ items: EnrichmentRun[]; nextCursor: string | null }> {
    const doc = await this.businesses.requireBusiness(organizationId, businessId);
    const page = await withCursor(() =>
      this.runs.pageForBusiness(
        organizationId,
        doc._id,
        { kinds: query.kind, statuses: query.status },
        { pageSize: query.pageSize, cursor: query.cursor ?? null },
      ),
    );
    return { items: page.items.map((r) => toEnrichmentRunView(r)), nextCursor: page.nextCursor };
  }

  /** Jobs created per UTC day in [from, to), split by status (reports and usage). */
  jobsPerDay(organizationId: string, from: Date, to: Date) {
    return this.runs.aggregateByDay(organizationId, {
      dateField: "createdAt",
      from,
      to,
      groupField: "status",
    });
  }

  /** All-jobs page: enrichment runs older than `before`, newest first. */
  async jobSummariesBefore(
    organizationId: string,
    statuses: JobStatus[] | undefined,
    before: { createdAt: Date; id: ObjectId } | null,
    limit: number,
  ): Promise<Array<{ createdAt: Date; id: ObjectId; summary: JobSummary }>> {
    const raw = statuses ? statuses.flatMap((s) => FROM_JOB_STATUS[s]) : undefined;
    if (raw && raw.length === 0) return [];
    const docs = await this.runs.pageBefore(organizationId, raw, before, limit);
    return docs.map((r) => {
      const finished = r.status === "completed" || r.status === "failed";
      return {
        createdAt: r.createdAt,
        id: r._id,
        summary: {
          id: r._id.toHexString(),
          kind: "enrichment",
          name:
            r.kind === "website_contacts"
              ? "Website contacts"
              : `Email check: ${r.input.address ?? ""}`.trim(),
          status: r.status,
          kindStatus:
            r.kind === "website_contacts"
              ? `website_contacts:${r.status}`
              : `email_check:${r.status}`,
          progress: {
            processed: finished ? 1 : 0,
            total: 1,
            failed: r.status === "failed" ? 1 : 0,
          },
          createdByUserId: r.requestedByUserId,
          createdAt: r.createdAt.toISOString(),
          startedAt: r.startedAt?.toISOString() ?? null,
          finishedAt: r.finishedAt?.toISOString() ?? null,
          href: `/app/businesses/${r.businessId.toHexString()}`,
        },
      };
    });
  }

  /** Maintenance: runs stuck in running (30 min) are failed; queued ones (15 min) are re-enqueued. */
  async recoverStuck(now: Date = new Date()): Promise<{ failed: number; requeued: number }> {
    let failed = 0;
    let requeued = 0;
    for (const r of await this.runs.findStale(
      "running",
      new Date(now.getTime() - 30 * 60_000),
      100,
    )) {
      if (
        await this.runner.finalize(r.organizationId, r._id, {
          kind: "failed",
          code: "RUN_TIMEOUT",
          message: "The run took longer than 30 minutes and was stopped.",
        })
      )
        failed += 1;
    }
    for (const r of await this.runs.findStale(
      "queued",
      new Date(now.getTime() - 15 * 60_000),
      100,
    )) {
      await this.queue.enqueueEnrichment(
        r.kind === "website_contacts" ? "website-contacts" : "verify-contact",
        { organizationId: r.organizationId, runId: r._id.toHexString() },
      );
      await this.runs.touch(r.organizationId, r._id, now);
      requeued += 1;
    }
    return { failed, requeued };
  }

  /** For tests and diagnostics: observations a run recorded. */
  observationIds(organizationId: string, runId: ObjectId): Promise<ObjectId[]> {
    return this.provenance.enrichmentObservationIds(organizationId, runId);
  }
}
