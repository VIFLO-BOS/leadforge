import { Injectable } from "@nestjs/common";
import {
  ActivityType,
  type ActivitySummary,
  type JobKind,
  type JobKindCounts,
  type JobsTimeline,
  type OverviewMetrics,
  type OverviewPeriod,
  type PipelineFunnel,
  type QualityDistribution,
  type ReportPeriod,
  type SourceBreakdown,
  type SourceKey,
} from "@leadforge/contracts";
import type { DailyBucket } from "@leadforge/db-mongo";
import { BusinessesService } from "../businesses/businesses.service.js";
import { ImportsService } from "../imports/imports.service.js";
import { DiscoveryService } from "../discovery/discovery.service.js";
import { CreditsService } from "../credits/credits.service.js";
import { WebsiteAnalysisService } from "../website-analysis/website-analysis.service.js";
import { EnrichmentService } from "../enrichment/enrichment.service.js";
import { ExportsService } from "../exports/exports.service.js";
import { OrganizationsService } from "../organizations/organizations.service.js";
import { JobsService } from "../jobs/jobs.service.js";
import { LeadsService } from "../crm/leads.service.js";
import { ActivitiesService } from "../crm/activities.service.js";
import { BulkOperationsService } from "../crm/bulk-operations.service.js";
import type { CrmActor } from "../crm/crm.types.js";

const DAY_MS = 24 * 60 * 60 * 1000;
const PERIOD_DAYS: Record<Exclude<ReportPeriod, "all">, number> = { "7d": 7, "30d": 30, "90d": 90 };
const JOB_KINDS: readonly JobKind[] = [
  "discovery",
  "import",
  "analysis",
  "enrichment",
  "export",
  "bulk",
];

function periodStart(period: ReportPeriod, now: Date): Date | null {
  return period === "all" ? null : new Date(now.getTime() - PERIOD_DAYS[period] * DAY_MS);
}

const zeroKinds = (): JobKindCounts => ({
  discovery: 0,
  import: 0,
  analysis: 0,
  enrichment: 0,
  export: 0,
  bulk: 0,
});

/**
 * Overview and Reports, computed from real records only (absent rather than zero when a
 * module does not exist yet). Every query is organization-scoped and runs on an index that
 * starts with organizationId (counts and day buckets on createdAt, score ranges, stage keys,
 * activity type and date); usage figures come from the pre-aggregated usage_daily table.
 */
@Injectable()
export class ReportsService {
  constructor(
    private readonly businesses: BusinessesService,
    private readonly imports: ImportsService,
    private readonly discovery: DiscoveryService,
    private readonly credits: CreditsService,
    private readonly analyses: WebsiteAnalysisService,
    private readonly enrichment: EnrichmentService,
    private readonly exports: ExportsService,
    private readonly organizations: OrganizationsService,
    private readonly jobs: JobsService,
    private readonly leads: LeadsService,
    private readonly activities: ActivitiesService,
    private readonly bulk: BulkOperationsService,
  ) {}

  async overview(
    organizationId: string,
    period: OverviewPeriod,
    viewer: CrmActor | null = null,
  ): Promise<OverviewMetrics> {
    const now = new Date();
    const start = periodStart(period, now)!;
    const [
      counts,
      imports,
      discovery,
      balance,
      captured,
      pipeline,
      recentJobs,
      activeJobs,
      timeline,
      loggedInPeriod,
      recentActivity,
      quality,
    ] = await Promise.all([
      this.businesses.overviewCounts(organizationId, start),
      this.imports.overviewSummary(organizationId),
      this.discovery.overviewSummary(organizationId, start),
      this.credits.balance(organizationId),
      this.credits.capturedByDay(organizationId, start, now),
      this.leads.overviewCounts(organizationId, start),
      this.jobs.list(organizationId, { pageSize: 5 }, viewer),
      this.jobs.list(organizationId, { pageSize: 100, status: ["queued", "running"] }, viewer),
      this.jobsPerKind(organizationId, start, now),
      this.activities.countLoggedSince(organizationId, start),
      this.activities.recent(organizationId, 10),
      this.businesses.qualityHistograms(organizationId, null),
    ]);
    const failedInPeriod = JOB_KINDS.reduce((n, k) => n + timeline.failedTotals[k], 0);
    return {
      period,
      periodStart: start.toISOString(),
      generatedAt: now.toISOString(),
      freshnessDays: counts.freshnessDays,
      businesses: counts.businesses,
      contacts: counts.contacts,
      sources: counts.sources as OverviewMetrics["sources"],
      imports,
      discovery,
      credits: {
        balance: balance.balance,
        held: balance.held,
        usedInPeriod: captured.reduce((n, c) => n + c.units, 0),
      },
      pipeline,
      jobs: { active: activeJobs.items.length, failedInPeriod, recent: recentJobs.items },
      activity: { loggedInPeriod, recent: recentActivity },
      quality,
    };
  }

  async sourceBreakdown(organizationId: string, period: ReportPeriod): Promise<SourceBreakdown> {
    const now = new Date();
    const start = periodStart(period, now);
    const result = await this.businesses.sourceBreakdown(organizationId, start);
    return {
      period,
      periodStart: start?.toISOString() ?? null,
      generatedAt: now.toISOString(),
      totalBusinesses: result.total,
      sources: result.sources.map((s) => ({
        source: s.source as SourceKey,
        businesses: s.businesses,
        share: result.total > 0 ? Math.round((s.businesses / result.total) * 1000) / 1000 : 0,
      })),
    };
  }

  async qualityDistribution(
    organizationId: string,
    period: ReportPeriod,
  ): Promise<QualityDistribution> {
    const now = new Date();
    const start = periodStart(period, now);
    const histograms = await this.businesses.qualityHistograms(organizationId, start);
    return {
      period,
      periodStart: start?.toISOString() ?? null,
      generatedAt: now.toISOString(),
      ...histograms,
    };
  }

  /** Jobs created and failed per UTC day and kind in [from, to). */
  private async jobsPerKind(organizationId: string, from: Date, to: Date) {
    const sources: Array<[JobKind, Promise<DailyBucket[]>]> = [
      ["discovery", this.discovery.jobsPerDay(organizationId, from, to)],
      ["import", this.imports.jobsPerDay(organizationId, from, to)],
      ["analysis", this.analyses.jobsPerDay(organizationId, from, to)],
      ["enrichment", this.enrichment.jobsPerDay(organizationId, from, to)],
      ["export", this.exports.jobsPerDay(organizationId, from, to)],
      ["bulk", this.bulk.jobsPerDay(organizationId, from, to)],
    ];
    const created = new Map<string, JobKindCounts>();
    const failed = new Map<string, JobKindCounts>();
    const createdTotals = zeroKinds();
    const failedTotals = zeroKinds();
    const results = await Promise.all(sources.map(([, p]) => p));
    sources.forEach(([kind], i) => {
      for (const b of results[i]!) {
        if (!created.has(b.day)) created.set(b.day, zeroKinds());
        if (!failed.has(b.day)) failed.set(b.day, zeroKinds());
        created.get(b.day)![kind] += b.count;
        createdTotals[kind] += b.count;
        if (b.group === "failed") {
          failed.get(b.day)![kind] += b.count;
          failedTotals[kind] += b.count;
        }
      }
    });
    return { created, failed, createdTotals, failedTotals };
  }

  async jobsTimeline(organizationId: string, period: OverviewPeriod): Promise<JobsTimeline> {
    const now = new Date();
    const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
    const firstDay = new Date(today - (PERIOD_DAYS[period] - 1) * DAY_MS);
    const data = await this.jobsPerKind(organizationId, firstDay, new Date(today + DAY_MS));
    const days: JobsTimeline["days"] = [];
    for (let t = firstDay.getTime(); t <= today; t += DAY_MS) {
      const day = new Date(t).toISOString().slice(0, 10);
      days.push({
        day,
        created: data.created.get(day) ?? zeroKinds(),
        failed: data.failed.get(day) ?? zeroKinds(),
      });
    }
    return {
      period,
      periodStart: firstDay.toISOString(),
      generatedAt: now.toISOString(),
      days,
      totals: { created: data.createdTotals, failed: data.failedTotals },
    };
  }

  async pipelineFunnel(organizationId: string, period: ReportPeriod): Promise<PipelineFunnel> {
    const now = new Date();
    const start = periodStart(period, now);
    const [{ stages, counts }, entered, closed] = await Promise.all([
      this.leads.funnelCounts(organizationId),
      this.activities.stageEntries(organizationId, start),
      this.leads.closedSince(organizationId, start),
    ]);
    const rows = stages
      .filter((s) => !s.archived || (counts.get(s.key) ?? 0) > 0 || (entered.get(s.key) ?? 0) > 0)
      .map((s) => ({
        key: s.key,
        label: s.label,
        kind: s.kind,
        order: s.order,
        archived: s.archived,
        current: counts.get(s.key) ?? 0,
        entered: entered.get(s.key) ?? 0,
      }));
    const total = [...counts.values()].reduce((n, c) => n + c, 0);
    const byKind = (kind: "open" | "won" | "lost") =>
      stages.filter((s) => s.kind === kind).reduce((n, s) => n + (counts.get(s.key) ?? 0), 0);
    const won = closed.filter((c) => c.kind === "won").reduce((n, c) => n + c.count, 0);
    const lost = closed.filter((c) => c.kind === "lost").reduce((n, c) => n + c.count, 0);
    const wonValue = new Map<string, number>();
    for (const c of closed)
      if (c.kind === "won" && c.currency && c.value > 0)
        wonValue.set(c.currency, (wonValue.get(c.currency) ?? 0) + c.value);
    return {
      period,
      periodStart: start?.toISOString() ?? null,
      generatedAt: now.toISOString(),
      stages: rows,
      totals: {
        leads: total,
        open: total - byKind("won") - byKind("lost"),
        won: byKind("won"),
        lost: byKind("lost"),
        winRate: won + lost > 0 ? Math.round((won / (won + lost)) * 1000) / 1000 : null,
        wonValue: [...wonValue].map(([currency, valueMinor]) => ({ currency, valueMinor })),
      },
    };
  }

  async activitySummary(organizationId: string, period: ReportPeriod): Promise<ActivitySummary> {
    const now = new Date();
    const start = periodStart(period, now);
    const [rows, members] = await Promise.all([
      this.activities.countByTypeAndUser(organizationId, start),
      this.organizations.listMembers(organizationId),
    ]);
    const names = new Map(members.map((m) => [m.userId, m.name]));
    const byType = new Map<string, number>();
    const byUser = new Map<string, Map<string, number>>();
    let total = 0;
    for (const r of rows) {
      total += r.count;
      byType.set(r.type, (byType.get(r.type) ?? 0) + r.count);
      const u = byUser.get(r.userId) ?? new Map<string, number>();
      u.set(r.type, (u.get(r.type) ?? 0) + r.count);
      byUser.set(r.userId, u);
    }
    const typed = (m: Map<string, number>) =>
      ActivityType.options.filter((t) => m.has(t)).map((type) => ({ type, count: m.get(type)! }));
    return {
      period,
      periodStart: start?.toISOString() ?? null,
      generatedAt: now.toISOString(),
      total,
      byType: typed(byType),
      byUser: [...byUser]
        .map(([userId, m]) => ({
          userId,
          name: names.get(userId) ?? null,
          total: [...m.values()].reduce((n, c) => n + c, 0),
          byType: typed(m),
        }))
        .sort((a, b) => b.total - a.total),
    };
  }
}
