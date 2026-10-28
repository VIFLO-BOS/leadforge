import { z } from "zod";
import { IsoDateTime, UuidString } from "../common/ids.js";
import { SourceKey } from "../businesses/fields.js";
import { ImportJob } from "../imports/schemas.js";
import { DiscoveryJob } from "../discovery/schemas.js";
import { JobSummary } from "../jobs/schemas.js";
import { Activity, ActivityType, PipelineStageKind, StageKey } from "../crm/schemas.js";

export const OverviewPeriod = z.enum(["7d", "30d", "90d"]);
export type OverviewPeriod = z.infer<typeof OverviewPeriod>;

export const OverviewQuery = z.object({ period: OverviewPeriod.default("30d") });
export type OverviewQuery = z.infer<typeof OverviewQuery>;

/** Score range [min, max]; the last bucket is 90 to 100. */
export const HistogramBucket = z.object({
  min: z.number().int(),
  max: z.number().int(),
  count: z.number().int(),
});
export type HistogramBucket = z.infer<typeof HistogramBucket>;

export const QualityHistograms = z.object({
  /** Businesses considered (live, non-suppressed). */
  total: z.number().int(),
  /** Not scored yet; in neither histogram. */
  unscored: z.number().int(),
  /** Ten buckets of 10 points each. Fit and data confidence are separate measures; never add them. */
  fit: z.array(HistogramBucket),
  dataConfidence: z.array(HistogramBucket),
});
export type QualityHistograms = z.infer<typeof QualityHistograms>;

/**
 * Overview metrics from real records only. Subscription metrics arrive with billing (Phase 6);
 * they are absent rather than zero.
 */
export const OverviewMetrics = z.object({
  period: OverviewPeriod,
  periodStart: IsoDateTime,
  generatedAt: IsoDateTime,
  freshnessDays: z.number().int(),
  businesses: z.object({
    /** All non-deleted businesses, including suppressed ones. */
    total: z.number().int(),
    suppressed: z.number().int(),
    addedInPeriod: z.number().int(),
  }),
  /** Counts of non-suppressed businesses with at least one value / one verified, fresh value. */
  contacts: z.object({
    withPhone: z.number().int(),
    withEmail: z.number().int(),
    withWebsite: z.number().int(),
    verifiedPhone: z.number().int(),
    verifiedEmail: z.number().int(),
    verifiedWebsite: z.number().int(),
    whatsappConfirmed: z.number().int(),
    whatsappUserAsserted: z.number().int(),
  }),
  /** Non-suppressed businesses per source (a business can appear under several sources). */
  sources: z.array(z.object({ source: SourceKey, businesses: z.number().int() })),
  imports: z.object({
    total: z.number().int(),
    inProgress: z.number().int(),
    recent: z.array(
      ImportJob.pick({
        id: true,
        status: true,
        fileName: true,
        rowCount: true,
        progress: true,
        createdAt: true,
        finishedAt: true,
      }),
    ),
  }),
  /** Discovery job counts (all time) and outcomes in the period, from job records. */
  discovery: z.object({
    total: z.number().int(),
    inProgress: z.number().int(),
    completedInPeriod: z.number().int(),
    failedInPeriod: z.number().int(),
    recent: z.array(
      DiscoveryJob.pick({
        id: true,
        name: true,
        status: true,
        progress: true,
        createdAt: true,
        finishedAt: true,
      }),
    ),
  }),
  /** Credit balance from the PostgreSQL ledger; `usedInPeriod` is credits captured in the period (Phase 5). */
  credits: z.object({
    balance: z.number().int(),
    held: z.number().int(),
    usedInPeriod: z.number().int().optional(),
  }),
  /**
   * Phase 5 additions. Always sent from Phase 5 on; typed optional so older clients and fixtures
   * still compile. Subscription status arrives with billing (Phase 6).
   */
  pipeline: z
    .object({
      /** Leads in open stages. */
      openLeads: z.number().int(),
      /** Open leads past the entry stage ("Qualified" and later open stages). */
      qualifiedLeads: z.number().int(),
      unassignedOpenLeads: z.number().int(),
      wonInPeriod: z.number().int(),
      lostInPeriod: z.number().int(),
    })
    .optional(),
  /** Background jobs of every kind: queued or running now, and failed in the period. */
  jobs: z
    .object({
      active: z.number().int(),
      failedInPeriod: z.number().int(),
      /** The 5 newest jobs of any kind. */
      recent: z.array(JobSummary),
    })
    .optional(),
  activity: z
    .object({
      /** Activities logged in the period (system stage changes and assignments excluded). */
      loggedInPeriod: z.number().int(),
      /** The 10 newest activities of any type. */
      recent: z.array(Activity),
    })
    .optional(),
  /** Lead-quality distribution of live, non-suppressed businesses (fit and data confidence kept separate). */
  quality: QualityHistograms.optional(),
});
export type OverviewMetrics = z.infer<typeof OverviewMetrics>;

// ---------------------------------------------------------------------------
// Reports (Phase 5)
// ---------------------------------------------------------------------------

/** `all` covers every record; the others start that many days ago. */
export const ReportPeriod = z.enum(["7d", "30d", "90d", "all"]);
export type ReportPeriod = z.infer<typeof ReportPeriod>;

export const ReportQuery = z.object({ period: ReportPeriod.default("30d") });
export type ReportQuery = z.infer<typeof ReportQuery>;

/** Timelines need a bounded window. */
export const TimelineQuery = z.object({ period: OverviewPeriod.default("30d") });
export type TimelineQuery = z.infer<typeof TimelineQuery>;

const reportHeader = {
  period: ReportPeriod,
  /** Null for `all`. */
  periodStart: IsoDateTime.nullable(),
  generatedAt: IsoDateTime,
};

/** `GET /reports/source-breakdown`: live, non-suppressed businesses per source. */
export const SourceBreakdown = z.object({
  ...reportHeader,
  /** Live, non-suppressed businesses (in the period: created in it). */
  totalBusinesses: z.number().int(),
  /** A business observed from several sources counts under each. */
  sources: z.array(
    z.object({ source: SourceKey, businesses: z.number().int(), share: z.number() }),
  ),
});
export type SourceBreakdown = z.infer<typeof SourceBreakdown>;

/** `GET /reports/quality-distribution` (period: businesses created in it). */
export const QualityDistribution = z.object({ ...reportHeader, ...QualityHistograms.shape });
export type QualityDistribution = z.infer<typeof QualityDistribution>;

const int = z.number().int();
export const JobKindCounts = z.object({
  discovery: int,
  import: int,
  analysis: int,
  enrichment: int,
  export: int,
  bulk: int,
});
export type JobKindCounts = z.infer<typeof JobKindCounts>;

/** `GET /reports/jobs-timeline`: jobs created and failed per UTC day, per kind. */
export const JobsTimeline = z.object({
  period: OverviewPeriod,
  periodStart: IsoDateTime,
  generatedAt: IsoDateTime,
  days: z.array(z.object({ day: z.string(), created: JobKindCounts, failed: JobKindCounts })),
  totals: z.object({ created: JobKindCounts, failed: JobKindCounts }),
});
export type JobsTimeline = z.infer<typeof JobsTimeline>;

/** `GET /reports/pipeline-funnel`: stages in board order. */
export const PipelineFunnel = z.object({
  ...reportHeader,
  stages: z.array(
    z.object({
      key: StageKey,
      label: z.string(),
      kind: PipelineStageKind,
      order: int,
      archived: z.boolean(),
      /** Leads in the stage now. */
      current: int,
      /** Leads moved into the stage during the period (from stage-change activities; `all`: ever). */
      entered: int,
    }),
  ),
  totals: z.object({
    leads: int,
    open: int,
    won: int,
    lost: int,
    /** Won / (won + lost) among leads closed in the period; null when none closed. */
    winRate: z.number().nullable(),
    /** Sum of won values in minor units for leads won in the period, by currency. */
    wonValue: z.array(z.object({ currency: z.string(), valueMinor: int })),
  }),
});
export type PipelineFunnel = z.infer<typeof PipelineFunnel>;

/** `GET /reports/activity-summary`: logged activities by type and by author. */
export const ActivitySummary = z.object({
  ...reportHeader,
  total: int,
  byType: z.array(z.object({ type: ActivityType, count: int })),
  byUser: z.array(
    z.object({
      userId: UuidString,
      /** Null when the user is no longer a member. */
      name: z.string().nullable(),
      total: int,
      byType: z.array(z.object({ type: ActivityType, count: int })),
    }),
  ),
});
export type ActivitySummary = z.infer<typeof ActivitySummary>;
