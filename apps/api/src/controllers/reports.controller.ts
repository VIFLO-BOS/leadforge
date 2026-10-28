import { Controller, Get } from "@nestjs/common";
import { ApiCookieAuth, ApiHeader, ApiOperation, ApiTags } from "@nestjs/swagger";
import {
  ActivitySummary,
  JobsTimeline,
  OverviewMetrics,
  OverviewQuery,
  PipelineFunnel,
  QualityDistribution,
  ReportQuery,
  SourceBreakdown,
  TimelineQuery,
} from "@leadforge/contracts";
import {
  ApiZodQuery,
  ApiZodResponse,
  CurrentOrg,
  CurrentUser,
  ReportsService,
  RequirePermission,
  ZodQuery,
  type AuthenticatedUser,
  type OrganizationScope,
} from "@leadforge/core";
import { actorOf } from "../common/actor.js";

// Type-only aliases keep Zod schemas out of Swagger's query-parameter expansion.
type PeriodQuery = OverviewQuery;
type RQuery = ReportQuery;
type TQuery = TimelineQuery;

@ApiTags("reports")
@ApiCookieAuth()
@ApiHeader({
  name: "X-Organization-Id",
  required: true,
  description: "Organization scope; membership is verified server-side",
})
@Controller("reports")
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Get("overview")
  @RequirePermission("businesses:read")
  @ApiOperation({
    summary:
      "Overview metrics: businesses, contacts, sources, imports, discovery, credits, pipeline, jobs, activity and quality",
    description:
      "Every value comes from real records. Subscription status arrives with billing (Phase 6).",
  })
  @ApiZodQuery(OverviewQuery)
  @ApiZodResponse(200, OverviewMetrics)
  overview(
    @CurrentOrg() org: OrganizationScope,
    @CurrentUser() user: AuthenticatedUser,
    @ZodQuery(OverviewQuery) query: PeriodQuery,
  ) {
    return this.reports.overview(org.organizationId, query.period, actorOf(user, org));
  }

  @Get("source-breakdown")
  @RequirePermission("businesses:read")
  @ApiOperation({
    summary:
      "Live, non-suppressed businesses per source (period: created in it; `all`: every business)",
  })
  @ApiZodQuery(ReportQuery)
  @ApiZodResponse(200, SourceBreakdown)
  sourceBreakdown(@CurrentOrg() org: OrganizationScope, @ZodQuery(ReportQuery) query: RQuery) {
    return this.reports.sourceBreakdown(org.organizationId, query.period);
  }

  @Get("quality-distribution")
  @RequirePermission("businesses:read")
  @ApiOperation({
    summary:
      "Fit and data-confidence histograms (ten 10-point buckets each, kept separate) and the unscored count",
  })
  @ApiZodQuery(ReportQuery)
  @ApiZodResponse(200, QualityDistribution)
  qualityDistribution(@CurrentOrg() org: OrganizationScope, @ZodQuery(ReportQuery) query: RQuery) {
    return this.reports.qualityDistribution(org.organizationId, query.period);
  }

  @Get("jobs-timeline")
  @RequirePermission("businesses:read")
  @ApiOperation({
    summary:
      "Jobs created and failed per UTC day and kind (discovery, import, analysis, enrichment, export, bulk)",
  })
  @ApiZodQuery(TimelineQuery)
  @ApiZodResponse(200, JobsTimeline)
  jobsTimeline(@CurrentOrg() org: OrganizationScope, @ZodQuery(TimelineQuery) query: TQuery) {
    return this.reports.jobsTimeline(org.organizationId, query.period);
  }

  @Get("pipeline-funnel")
  @RequirePermission("businesses:read")
  @ApiOperation({
    summary:
      "Pipeline funnel: leads per stage now and entering each stage in the period, win rate and won value",
  })
  @ApiZodQuery(ReportQuery)
  @ApiZodResponse(200, PipelineFunnel)
  pipelineFunnel(@CurrentOrg() org: OrganizationScope, @ZodQuery(ReportQuery) query: RQuery) {
    return this.reports.pipelineFunnel(org.organizationId, query.period);
  }

  @Get("activity-summary")
  @RequirePermission("businesses:read")
  @ApiOperation({ summary: "Logged activities by type and by author in the period" })
  @ApiZodQuery(ReportQuery)
  @ApiZodResponse(200, ActivitySummary)
  activitySummary(@CurrentOrg() org: OrganizationScope, @ZodQuery(ReportQuery) query: RQuery) {
    return this.reports.activitySummary(org.organizationId, query.period);
  }
}
