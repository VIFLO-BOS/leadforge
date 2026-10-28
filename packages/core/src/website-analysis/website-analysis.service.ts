import { Injectable } from "@nestjs/common";
import { ObjectId, type WithId } from "@leadforge/db-mongo";
import {
  ANALYSIS_LIMITS,
  type AnalysisListQuery,
  type AnalysisStatus,
  type AnalysisTrigger,
  type CreateAnalysisRequest,
  type CreateAnalysisResponse,
  type JobStatus,
  type JobSummary,
  type WebsiteAnalysis,
} from "@leadforge/contracts";
import { AppError } from "../common/errors/app.error.js";
import { withCursor } from "../common/pagination/cursor.js";
import { AuditService, type AuditContext } from "../audit/audit.service.js";
import { QueueService } from "../queue/queue.service.js";
import { BusinessesService } from "../businesses/businesses.service.js";
import { isExpired } from "../businesses/business-model.js";
import type { BusinessDocument } from "../businesses/business.types.js";
import {
  CreditsService,
  analysisCreditKeys,
  negativeBalanceError,
} from "../credits/credits.service.js";
import { EntitlementsService } from "../entitlements/entitlements.service.js";
import { toAnalysisView } from "./analysis-view.js";
import type { WebsiteAnalysisDocument } from "./analysis.types.js";
import { WebsiteAnalysisRunner } from "./website-analysis.runner.js";
import { WebsiteAnalysisRepository } from "./repositories/website-analysis.repository.js";

type Skip = CreateAnalysisResponse["skipped"][number];

/** Job statuses (all-jobs page) to analysis statuses. */
const FROM_JOB_STATUS: Record<JobStatus, AnalysisStatus[]> = {
  draft: [],
  queued: ["queued"],
  running: ["running"],
  completed: ["completed"],
  completed_with_warnings: [],
  failed: ["failed"],
  cancelled: [],
};

/**
 * Website analyses as the API sees them. Each analysis holds 1 credit when it is queued
 * (`analysis:<id>:hold`), captures it when the analysis completes and releases it when the
 * analysis fails (PRODUCT_REQUIREMENTS section 8). A business has at most one queued or
 * running analysis: asking again returns that one and holds nothing.
 */
@Injectable()
export class WebsiteAnalysisService {
  constructor(
    private readonly analyses: WebsiteAnalysisRepository,
    private readonly businesses: BusinessesService,
    private readonly credits: CreditsService,
    private readonly runner: WebsiteAnalysisRunner,
    private readonly queue: QueueService,
    private readonly audit: AuditService,
    private readonly entitlements: EntitlementsService,
  ) {}

  /** The website to analyze, or why there is none. */
  static websiteOf(doc: BusinessDocument, now: Date = new Date()): string | null {
    if (!doc.website || isExpired(doc.website.expiresAt, now)) return null;
    return doc.website.value;
  }

  async request(
    organizationId: string,
    userId: string,
    req: CreateAnalysisRequest,
    trigger: AnalysisTrigger,
    auditCtx: AuditContext,
  ): Promise<CreateAnalysisResponse> {
    // Phase 6: the plan must include website analysis.
    await this.entitlements.assertWebsiteAnalysisEnabled(organizationId);
    const bulk = "businessIds" in req;
    const ids = bulk ? req.businessIds : [req.businessId];
    const docs = await this.businesses.findLiveByIds(
      organizationId,
      ids.map((id) => new ObjectId(id)),
    );
    const byId = new Map(docs.map((d) => [d._id.toHexString(), d]));
    const skipped: Skip[] = [];
    const eligible: Array<WithId<BusinessDocument>> = [];
    for (const raw of ids) {
      const id = raw.toLowerCase();
      const doc = byId.get(id);
      if (!doc) skipped.push({ businessId: id, code: "NOT_FOUND", message: "Business not found" });
      else if (doc.flags.suppressed)
        skipped.push({
          businessId: id,
          code: "SUPPRESSED",
          message: "The business is suppressed; its website is not fetched",
        });
      else if (!WebsiteAnalysisService.websiteOf(doc))
        skipped.push({
          businessId: id,
          code: "WEBSITE_MISSING",
          message: "The business has no website on record",
        });
      else eligible.push(doc);
    }

    if (!bulk && skipped[0]) {
      const s = skipped[0];
      if (s.code === "NOT_FOUND") throw AppError.notFound("Business");
      if (s.code === "WEBSITE_MISSING")
        throw new AppError("WEBSITE_MISSING", "This business has no website on record to analyze", [
          { path: "businessId", message: s.businessId },
        ]);
      throw new AppError("CONFLICT", s.message, [{ path: "businessId", message: s.businessId }]);
    }

    const active = await this.analyses.findActive(
      organizationId,
      eligible.map((d) => d._id),
    );
    const activeByBusiness = new Map(active.map((a) => [a.businessId.toHexString(), a]));
    const toCreate = eligible.filter((d) => !activeByBusiness.has(d._id.toHexString()));

    if (toCreate.length > 0) {
      const { balance } = await this.credits.balance(organizationId);
      if (balance < 0) throw negativeBalanceError(balance);
      if (balance < toCreate.length * ANALYSIS_LIMITS.creditsPerAnalysis) {
        throw new AppError(
          "INSUFFICIENT_CREDITS",
          `This needs ${toCreate.length} credits; ${Math.max(0, balance)} available.`,
          [
            {
              path: "credits.required",
              message: String(toCreate.length * ANALYSIS_LIMITS.creditsPerAnalysis),
            },
            { path: "credits.available", message: String(Math.max(0, balance)) },
          ],
        );
      }
    }

    const batchId = bulk && toCreate.length > 0 ? new ObjectId() : null;
    const created: WebsiteAnalysisDocument[] = [];
    const reused: WebsiteAnalysisDocument[] = [...active];
    for (const doc of toCreate) {
      try {
        const result = await this.createOne(
          organizationId,
          userId,
          doc,
          bulk ? "bulk" : trigger,
          batchId,
        );
        (result.created ? created : reused).push(result.analysis);
      } catch (err) {
        if (
          err instanceof AppError &&
          err.code === "INSUFFICIENT_CREDITS" &&
          (created.length > 0 || bulk)
        ) {
          skipped.push({
            businessId: doc._id.toHexString(),
            code: "INSUFFICIENT_CREDITS",
            message: err.message,
          });
          continue;
        }
        throw err;
      }
    }

    await this.audit.record(
      {
        organizationId,
        actorUserId: userId,
        actorType: "user",
        action: bulk ? "analysis.bulk_requested" : "analysis.requested",
        resourceType: bulk ? "analysis_batch" : "website_analysis",
        resourceId: bulk
          ? (batchId?.toHexString() ?? null)
          : ((created[0] ?? reused[0])?._id.toHexString() ?? null),
        after: {
          trigger: bulk ? "bulk" : trigger,
          requested: ids.length,
          created: created.length,
          alreadyInProgress: reused.length,
          skipped: skipped.map((s) => ({ businessId: s.businessId, code: s.code })),
          creditsHeld: created.length,
        },
      },
      auditCtx,
    );

    const summaries = await this.businesses.summaries(
      organizationId,
      [...created, ...reused].map((a) => a.businessId),
    );
    return {
      analyses: [...created, ...reused].map((a) =>
        toAnalysisView(a, summaries.get(a.businessId.toHexString())),
      ),
      alreadyInProgress: reused.map((a) => a._id.toHexString()),
      skipped,
      batchId: batchId?.toHexString() ?? null,
      credits: { held: created.length * ANALYSIS_LIMITS.creditsPerAnalysis },
    };
  }

  /** Hold, insert, enqueue. A concurrent request for the same business wins once; the loser's hold is returned. */
  private async createOne(
    organizationId: string,
    userId: string,
    business: BusinessDocument,
    trigger: AnalysisTrigger,
    batchId: ObjectId | null,
  ): Promise<{ analysis: WebsiteAnalysisDocument; created: boolean }> {
    const id = new ObjectId();
    const hex = id.toHexString();
    const keys = analysisCreditKeys(hex);
    const url = WebsiteAnalysisService.websiteOf(business)!;
    const hold = await this.credits.hold(organizationId, {
      units: ANALYSIS_LIMITS.creditsPerAnalysis,
      key: keys.hold,
      referenceType: "website_analysis",
      referenceId: hex,
      referenceName: `Website analysis: ${business.website?.domain ?? url}`,
      actorUserId: userId,
      description: `Hold for website analysis of ${business.website?.domain ?? url}`,
    });
    const now = new Date();
    const doc: WebsiteAnalysisDocument = {
      _id: id,
      organizationId,
      businessId: business._id,
      url,
      finalUrl: null,
      status: "queued",
      active: true,
      trigger,
      batchId,
      fetched: null,
      robots: { fetched: false, allowed: null },
      pagesVisited: [],
      detections: [],
      opportunities: [],
      credits: {
        holdKey: keys.hold,
        holdId: hold.entry.id,
        held: ANALYSIS_LIMITS.creditsPerAnalysis,
        captured: 0,
        released: 0,
        settledAt: null,
      },
      error: null,
      attempts: 0,
      requestedByUserId: userId,
      createdAt: now,
      updatedAt: now,
      queuedAt: now,
      startedAt: null,
      analyzedAt: null,
      finishedAt: null,
    };
    let inserted: boolean;
    try {
      inserted = await this.analyses.insert(organizationId, doc);
    } catch (err) {
      await this.credits.releaseHold(organizationId, {
        holdKey: keys.hold,
        releaseKey: keys.release,
        description: "Analysis could not be saved; hold returned",
      });
      throw err;
    }
    if (!inserted) {
      await this.credits.releaseHold(organizationId, {
        holdKey: keys.hold,
        releaseKey: keys.release,
        description: "Analysis already in progress; hold returned",
      });
      const [winner] = await this.analyses.findActive(organizationId, [business._id]);
      if (winner) return { analysis: winner, created: false };
      throw AppError.conflict("The analysis changed while it was being queued; try again");
    }
    try {
      await this.queue.enqueueAnalysis({ organizationId, analysisId: hex });
    } catch (err) {
      await this.runner.finalize(organizationId, id, {
        kind: "failed",
        code: "ENQUEUE_FAILED",
        message: "The analysis could not be queued; the credit was returned.",
      });
      throw err;
    }
    return { analysis: doc, created: true };
  }

  async requireAnalysis(
    organizationId: string,
    id: string,
  ): Promise<WithId<WebsiteAnalysisDocument>> {
    const doc = await this.analyses.findById(organizationId, id);
    if (!doc) throw AppError.notFound("Website analysis");
    return doc;
  }

  async get(organizationId: string, id: string): Promise<WebsiteAnalysis> {
    const doc = await this.requireAnalysis(organizationId, id);
    const summaries = await this.businesses.summaries(organizationId, [doc.businessId]);
    return toAnalysisView(doc, summaries.get(doc.businessId.toHexString()));
  }

  async list(
    organizationId: string,
    query: AnalysisListQuery,
  ): Promise<{ items: WebsiteAnalysis[]; nextCursor: string | null }> {
    if (query.businessId) await this.businesses.requireBusiness(organizationId, query.businessId);
    const page = await withCursor(() =>
      this.analyses.page(
        organizationId,
        {
          statuses: query.status,
          opportunities: query.opportunity,
          businessId: query.businessId ? new ObjectId(query.businessId) : undefined,
          batchId: query.batchId ? new ObjectId(query.batchId) : undefined,
        },
        { pageSize: query.pageSize, cursor: query.cursor ?? null },
      ),
    );
    const summaries = await this.businesses.summaries(
      organizationId,
      page.items.map((a) => a.businessId),
    );
    return {
      items: page.items.map((a) => toAnalysisView(a, summaries.get(a.businessId.toHexString()))),
      nextCursor: page.nextCursor,
    };
  }

  /** Latest analysis of a business: the newest completed one, else the newest of any status; null when none. */
  async latestForBusiness(
    organizationId: string,
    businessId: string,
  ): Promise<WebsiteAnalysis | null> {
    const business = await this.businesses.requireBusiness(organizationId, businessId);
    const doc =
      (await this.analyses.latestForBusiness(organizationId, business._id, ["completed"])) ??
      (await this.analyses.latestForBusiness(organizationId, business._id));
    if (!doc) return null;
    const summaries = await this.businesses.summaries(organizationId, [doc.businessId]);
    return toAnalysisView(doc, summaries.get(doc.businessId.toHexString()));
  }

  /** Jobs created per UTC day in [from, to), split by status (reports and usage). */
  jobsPerDay(organizationId: string, from: Date, to: Date) {
    return this.analyses.aggregateByDay(organizationId, {
      dateField: "createdAt",
      from,
      to,
      groupField: "status",
    });
  }

  /** All-jobs page: analyses older than `before`, newest first. */
  async jobSummariesBefore(
    organizationId: string,
    statuses: JobStatus[] | undefined,
    before: { createdAt: Date; id: ObjectId } | null,
    limit: number,
  ): Promise<Array<{ createdAt: Date; id: ObjectId; summary: JobSummary }>> {
    const raw = statuses ? statuses.flatMap((s) => FROM_JOB_STATUS[s]) : undefined;
    if (raw && raw.length === 0) return [];
    const docs = await this.analyses.pageBefore(organizationId, raw, before, limit);
    return docs.map((a) => {
      let host = a.url;
      try {
        host = new URL(a.url).hostname.replace(/^www\./, "");
      } catch {
        // keep the URL
      }
      const finished = a.status === "completed" || a.status === "failed";
      return {
        createdAt: a.createdAt,
        id: a._id,
        summary: {
          id: a._id.toHexString(),
          kind: "analysis",
          name: `Website analysis: ${host}`,
          status: a.status,
          kindStatus: a.status,
          progress: {
            processed: finished ? 1 : 0,
            total: 1,
            failed: a.status === "failed" ? 1 : 0,
          },
          createdByUserId: a.requestedByUserId,
          createdAt: a.createdAt.toISOString(),
          startedAt: a.startedAt?.toISOString() ?? null,
          finishedAt: a.finishedAt?.toISOString() ?? null,
          href: `/app/analysis/${a._id.toHexString()}`,
        },
      };
    });
  }
}
