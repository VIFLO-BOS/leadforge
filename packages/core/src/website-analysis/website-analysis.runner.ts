import { Inject, Injectable } from "@nestjs/common";
import { Logger } from "nestjs-pino";
import type { ObjectId, WithId } from "@leadforge/db-mongo";
import {
  ANALYSIS_LIMITS,
  ObjectIdString,
  roleHasPermission,
  UuidString,
  type ServerEnv,
} from "@leadforge/contracts";
import { ENV } from "../config/env.module.js";
import { OrganizationsService } from "../organizations/organizations.service.js";
import { BusinessesService } from "../businesses/businesses.service.js";
import { CreditsService, analysisCreditKeys } from "../credits/credits.service.js";
import { NotificationsService } from "../notifications/notifications.service.js";
import { SiteCrawler, type CrawlResult } from "../safe-fetch/site-crawler.js";
import type { AnalyzeWebsiteJob } from "../queue/queue.constants.js";
import { buildOpportunities, runDetections, UNREACHABLE_CODES } from "./detectors.js";
import type { WebsiteAnalysisDocument } from "./analysis.types.js";
import { WebsiteAnalysisRepository } from "./repositories/website-analysis.repository.js";

export type AnalysisOutcome =
  | { kind: "completed"; crawl: CrawlResult }
  | { kind: "failed"; code: string; message: string; crawl?: CrawlResult };

/** A payload that must not be retried: malformed, or an analysis that is not in the payload's organization. */
export class AnalysisPayloadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AnalysisPayloadError";
  }
}

/** Our side could not run the analysis right now (rate limit wait too long); the job is retried. */
export class AnalysisRetryableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AnalysisRetryableError";
  }
}

export const ANALYSIS_FOLLOW: Array<"contact" | "about" | "services" | "booking"> = [
  "contact",
  "about",
  "services",
  "booking",
];

/**
 * Runs website analyses in the worker (queue `website-analysis`). The crawl goes through
 * SafeFetch (SSRF policy, robots.txt, rate limits). Failures caused by policy (robots
 * disallow, a denied address, content we do not read) fail the analysis and release its
 * credit; an unreachable website is itself a finding (`website_unreachable`), so that analysis
 * completes and is charged. Finalization is a guarded transition, so it happens once.
 */
@Injectable()
export class WebsiteAnalysisRunner {
  constructor(
    private readonly analyses: WebsiteAnalysisRepository,
    private readonly businesses: BusinessesService,
    private readonly credits: CreditsService,
    private readonly notifications: NotificationsService,
    private readonly organizations: OrganizationsService,
    private readonly crawler: SiteCrawler,
    private readonly logger: Logger,
    @Inject(ENV) private readonly env: ServerEnv,
  ) {}

  private async load(
    organizationId: string,
    analysisId: string,
  ): Promise<WithId<WebsiteAnalysisDocument>> {
    if (
      !UuidString.safeParse(organizationId).success ||
      !ObjectIdString.safeParse(analysisId).success
    ) {
      throw new AnalysisPayloadError("Invalid analysis payload");
    }
    const doc = await this.analyses.findById(organizationId, analysisId);
    if (!doc) throw new AnalysisPayloadError("Analysis not found in the payload's organization");
    return doc;
  }

  private async accessProblem(doc: WebsiteAnalysisDocument): Promise<string | null> {
    const member = await this.organizations.isActiveMember(
      doc.organizationId,
      doc.requestedByUserId,
    );
    if (!member.active || !member.role)
      return "The organization is no longer active, or the user who requested this analysis is no longer a member.";
    if (!roleHasPermission(member.role, "analysis:run"))
      return "The user who requested this analysis no longer has permission to run analyses.";
    return null;
  }

  async run(payload: AnalyzeWebsiteJob): Promise<{ status: string }> {
    const doc = await this.load(payload.organizationId, payload.analysisId);
    const org = doc.organizationId;
    if (doc.status === "completed" || doc.status === "failed") {
      await this.settle(org, doc._id);
      return { status: `noop: ${doc.status}` };
    }
    const problem = await this.accessProblem(doc);
    if (problem) {
      await this.finalize(org, doc._id, {
        kind: "failed",
        code: "ACCESS_REVOKED",
        message: problem,
      });
      return { status: "failed" };
    }
    const business = await this.businesses.findAny(org, doc.businessId);
    if (!business || business.deletedAt) {
      await this.finalize(org, doc._id, {
        kind: "failed",
        code: "BUSINESS_GONE",
        message: "The business was deleted or merged before the analysis ran.",
      });
      return { status: "failed" };
    }
    if (business.flags.suppressed) {
      await this.finalize(org, doc._id, {
        kind: "failed",
        code: "SUPPRESSED",
        message: "The business was suppressed before the analysis ran.",
      });
      return { status: "failed" };
    }
    const now = new Date();
    const started = await this.analyses.transition(org, doc._id, ["queued", "running"], {
      $set: { status: "running", startedAt: doc.startedAt ?? now, updatedAt: now },
      $inc: { attempts: 1 },
    });
    if (!started) return { status: "noop: already finished" };

    const crawl = await this.crawler.crawl(doc.url, {
      maxPages: ANALYSIS_LIMITS.maxPages,
      follow: ANALYSIS_FOLLOW,
      retries: 2,
      retryDelayMs: this.env.SAFE_FETCH_RETRY_DELAY_MS,
    });
    const failure = crawl.homeFailure;
    if (failure?.code === "RATE_LIMITED") throw new AnalysisRetryableError(failure.message);
    if (failure && !UNREACHABLE_CODES.has(failure.code)) {
      await this.finalize(org, doc._id, {
        kind: "failed",
        code: failure.code,
        message: failure.message,
        crawl,
      });
      return { status: "failed" };
    }
    await this.finalize(org, doc._id, { kind: "completed", crawl });
    return { status: "completed" };
  }

  /** Moves the analysis to its terminal status once, settles its credit, and updates the business. */
  async finalize(organizationId: string, id: ObjectId, outcome: AnalysisOutcome): Promise<boolean> {
    const now = new Date();
    const crawl = outcome.crawl;
    const set: Record<string, unknown> = {
      status: outcome.kind === "completed" ? "completed" : "failed",
      updatedAt: now,
      finishedAt: now,
    };
    if (crawl) {
      const home = crawl.home?.response ?? null;
      set.finalUrl = crawl.home?.finalUrl ?? null;
      set.robots = crawl.robots;
      set.pagesVisited = crawl.pages.map((p) => ({
        url: p.url,
        finalUrl: p.finalUrl,
        kind: p.kind,
        status: p.status,
        error: p.error ? `${p.error.code}: ${p.error.message}` : null,
      }));
      set.fetched = {
        status: home?.status ?? crawl.homeFailure?.status ?? null,
        redirects: home?.redirects ?? [],
        bytes: home?.bytes ?? 0,
        contentType: home?.contentType ?? null,
        durationMs: home?.durationMs ?? 0,
        tls: {
          secure: Boolean(home?.tls.secure),
          valid: home?.tls.secure
            ? true
            : crawl.httpsFailure?.code === "TLS_INVALID" || crawl.httpsProbe?.code === "TLS_INVALID"
              ? false
              : null,
          issuer: home?.tls.issuer ?? null,
          validTo: home?.tls.validTo ?? null,
          error:
            crawl.httpsFailure?.detail ??
            (crawl.httpsProbe && !crawl.httpsProbe.ok ? crawl.httpsProbe.detail : null),
        },
      };
    }
    let opportunityKeys: string[] = [];
    if (outcome.kind === "completed") {
      const detections = runDetections(outcome.crawl);
      const opportunities = buildOpportunities(detections);
      set.detections = detections.map((d) => ({ ...d, analyzedAt: now }));
      set.opportunities = opportunities;
      set.analyzedAt = now;
      set.error = null;
      opportunityKeys = opportunities
        .filter((o) => o.confidence >= ANALYSIS_LIMITS.opportunityConfidence)
        .map((o) => o.key);
    } else {
      set.error = { code: outcome.code, message: outcome.message.slice(0, 500) };
    }
    const done = await this.analyses.transition(organizationId, id, ["queued", "running"], {
      $set: set,
      $unset: { active: "" },
    });
    await this.settle(organizationId, id);
    if (!done) return false;

    if (done.status === "completed") {
      await this.businesses.setLatestAnalysis(organizationId, done.businessId, {
        analysisId: done._id,
        status: "completed",
        analyzedAt: done.analyzedAt,
        opportunities: opportunityKeys as WebsiteAnalysisDocument["opportunities"][number]["key"][],
      });
    }
    if (done.batchId) await this.notifyBatchIfFinished(organizationId, done);
    this.logger.log(
      {
        organizationId,
        analysisId: id.toHexString(),
        status: done.status,
        error: done.error?.code ?? null,
      },
      "Website analysis finished",
    );
    return true;
  }

  /** Captures 1 credit for a completed analysis, releases it for a failed one. Idempotent. */
  async settle(organizationId: string, id: ObjectId): Promise<void> {
    const doc = await this.analyses.findById(organizationId, id);
    if (!doc || doc.credits.settledAt) return;
    if (doc.status !== "completed" && doc.status !== "failed") return;
    const keys = analysisCreditKeys(id.toHexString());
    const captured = doc.status === "completed" ? doc.credits.held : 0;
    const res = await this.credits.settle(organizationId, {
      holdKey: doc.credits.holdKey,
      captureKey: keys.capture,
      releaseKey: keys.release,
      capturedUnits: captured,
      description:
        doc.status === "completed"
          ? "Website analysis completed"
          : `Website analysis failed (${doc.error?.code ?? "error"}); credit returned`,
    });
    await this.analyses.update(organizationId, id, {
      $set: {
        "credits.captured": res.captured,
        "credits.released": res.released,
        "credits.settledAt": new Date(),
        updatedAt: new Date(),
      },
    });
  }

  private async notifyBatchIfFinished(
    organizationId: string,
    doc: WebsiteAnalysisDocument,
  ): Promise<void> {
    const batchId = doc.batchId!;
    const open = await this.analyses.countBatch(organizationId, batchId, ["queued", "running"]);
    if (open > 0) return;
    const [completed, failed] = await Promise.all([
      this.analyses.countBatch(organizationId, batchId, ["completed"]),
      this.analyses.countBatch(organizationId, batchId, ["failed"]),
    ]);
    await this.notifications.analysisBatchFinished({
      organizationId,
      batchId: batchId.toHexString(),
      userId: doc.requestedByUserId,
      completed,
      failed,
    });
  }
}
