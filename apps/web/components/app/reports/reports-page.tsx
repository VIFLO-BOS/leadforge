"use client";

import type { ActivitySummary, JobKindCounts, ReportPeriod } from "@leadforge/contracts";
import { Chart, type ChartRow, type ChartSeries } from "@leadforge/ui/charts";
import { CircleCheck, CircleX, Kanban, Percent, Wallet } from "lucide-react";
import {
  ErrorState,
  Heading,
  HeadingLevel,
  PageHeader,
  SegmentedControl,
  Stat,
} from "@leadforge/ui";
import { activityTypeLabel } from "@/lib/crm";
import { friendlyMessage, requestIdOf } from "@/lib/errors";
import { formatDateTime, formatNumber, formatRelative } from "@/lib/format";
import { timelinePeriod, useReport } from "@/lib/hooks/use-reports";
import { useUrlState } from "@/lib/hooks/use-url-state";
import { jobKindLabel, sourceLabel } from "@/lib/labels";
import { formatDay, histogramRows } from "@/lib/reports";

const PERIODS: { value: ReportPeriod; label: string; short: string; long: string }[] = [
  { value: "7d", label: "7 days", short: "7d", long: "the last 7 days" },
  { value: "30d", label: "30 days", short: "30d", long: "the last 30 days" },
  { value: "90d", label: "90 days", short: "90d", long: "the last 90 days" },
  { value: "all", label: "All time", short: "All", long: "all time" },
];

export const parseReportPeriod = (p: URLSearchParams): ReportPeriod => {
  const v = p.get("period");
  return v === "7d" || v === "90d" || v === "all" ? v : "30d";
};
const serializeReportPeriod = (v: ReportPeriod) =>
  new URLSearchParams(v === "30d" ? {} : { period: v });

/** Job kinds in a fixed order with pinned chart slots, so a kind keeps its colour everywhere. */
const KINDS: (keyof JobKindCounts)[] = [
  "discovery",
  "import",
  "analysis",
  "enrichment",
  "export",
  "bulk",
];
const KIND_SERIES: ChartSeries[] = KINDS.map((k, i) => ({
  key: k,
  label: jobKindLabel(k),
  slot: i + 1,
}));

const LOGGED_TYPES = ["note", "call", "whatsapp", "email", "meeting"] as const;
/** Short names fit the category axis ("WhatsApp message" would be dropped by tick spacing). */
const TYPE_SHORT: Record<string, string> = { whatsapp: "WhatsApp" };
const typeShort = (t: string) => TYPE_SHORT[t] ?? activityTypeLabel(t);
const TYPE_SERIES: ChartSeries[] = LOGGED_TYPES.map((t, i) => ({
  key: t,
  label: typeShort(t),
  slot: i + 1,
}));

function money(valueMinor: number, currency: string): string {
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency }).format(
      valueMinor / 100,
    );
  } catch {
    return `${formatNumber(valueMinor / 100)} ${currency}`;
  }
}

function Section({
  id,
  title,
  description,
  children,
}: {
  id: string;
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <section
      aria-labelledby={id}
      className="flex min-w-0 flex-col gap-3"
      data-testid={`report-${id}`}
    >
      <div className="flex min-w-0 flex-col gap-1">
        <Heading id={id} className="text-base font-medium">
          {title}
        </Heading>
        <p className="text-muted-foreground text-sm">{description}</p>
      </div>
      <HeadingLevel>{children}</HeadingLevel>
    </section>
  );
}

function ReportError({
  title,
  error,
  onRetry,
}: {
  title: string;
  error: unknown;
  onRetry: () => void;
}) {
  return (
    <ErrorState
      title={title}
      message={friendlyMessage(error)}
      requestId={requestIdOf(error)}
      onRetry={onRetry}
    />
  );
}

function generated(at: string | undefined) {
  return at ? `generated ${formatRelative(at)} (${formatDateTime(at)})` : "";
}

/**
 * Reports (/app/reports): lead sources, lead quality (fit and data confidence as two separate
 * histograms, never combined), jobs over time, the pipeline funnel and activity by type and
 * person. Every chart has a Chart | Table switch and a compact variant under 480px; the period
 * is in the URL. Every figure comes from the reports API.
 */
export function ReportsPage() {
  const [period, setPeriod] = useUrlState(parseReportPeriod, serializeReportPeriod);
  const periodLong = PERIODS.find((p) => p.value === period)?.long ?? "the last 30 days";
  const sources = useReport("source-breakdown", period);
  const quality = useReport("quality-distribution", period);
  const jobs = useReport("jobs-timeline", period);
  const funnel = useReport("pipeline-funnel", period);
  const activity = useReport("activity-summary", period);
  const tPeriod = timelinePeriod(period);

  const s = sources.data;
  const q = quality.data;
  const j = jobs.data;
  const f = funnel.data;
  const a = activity.data;

  const sourceRows: ChartRow[] = (s?.sources ?? []).map((x) => ({
    source: sourceLabel(x.source),
    businesses: x.businesses,
  }));
  const created: ChartRow[] =
    j && KINDS.some((k) => j.totals.created[k] > 0)
      ? j.days.map((d) => ({ day: d.day, ...d.created }))
      : [];
  const failed: ChartRow[] =
    j && KINDS.some((k) => j.totals.failed[k] > 0)
      ? j.days.map((d) => ({ day: d.day, ...d.failed }))
      : [];
  const funnelRows: ChartRow[] =
    f && f.stages.some((st) => st.current > 0 || st.entered > 0)
      ? f.stages.map((st) => ({
          stage: st.archived ? `${st.label} (archived)` : st.label,
          current: st.current,
          entered: st.entered,
        }))
      : [];
  const typeRows: ChartRow[] =
    a && a.total > 0 ? a.byType.map((t) => ({ type: typeShort(t.type), activities: t.count })) : [];
  const userRows: ChartRow[] =
    a && a.byUser.length
      ? a.byUser.map((u) => ({
          person: u.name ?? "Former member",
          ...Object.fromEntries(
            LOGGED_TYPES.map((t) => [t, u.byType.find((x) => x.type === t)?.count ?? 0]),
          ),
        }))
      : [];

  return (
    <div className="flex min-w-0 flex-col gap-10">
      <PageHeader
        eyebrow="Workspace"
        title="Reports"
        description="Where your businesses come from, how they score, what ran, how leads move and what your team logged. Every figure comes from your workspace's records."
        actions={
          <SegmentedControl<ReportPeriod>
            aria-label="Period"
            size="sm"
            value={period}
            onValueChange={(v) => setPeriod(v)}
            options={PERIODS.map((p) => ({
              value: p.value,
              ariaLabel: p.label,
              label: (
                <>
                  <span className="min-[400px]:hidden">{p.short}</span>
                  <span className="max-[399.98px]:hidden">{p.label}</span>
                </>
              ),
            }))}
          />
        }
      />

      <Section
        id="sources"
        title="Lead sources"
        description={`Businesses (not suppressed) by the source they came from, created in ${periodLong}. A business found by several sources counts under each.`}
      >
        {sources.isError && !s ? (
          <ReportError
            title="Could not load the source breakdown"
            error={sources.error}
            onRetry={() => void sources.refetch()}
          />
        ) : (
          <Chart
            type="bar"
            layout="horizontal"
            title="Businesses by source"
            data={sourceRows}
            xKey="source"
            xLabel="Source"
            series={[{ key: "businesses", label: "Businesses" }]}
            loading={sources.isPending}
            emptyMessage="No businesses in this period yet."
            height={Math.max(160, sourceRows.length * 44)}
            footnote={
              s
                ? `${formatNumber(s.totalBusinesses)} businesses · ${generated(s.generatedAt)}`
                : undefined
            }
          />
        )}
      </Section>

      <Section
        id="quality"
        title="Lead quality"
        description="Fit score and data confidence are separate measures, shown as separate distributions and never added together. Fit reflects your configured criteria; it is not a prediction of purchase intent."
      >
        {quality.isError && !q ? (
          <ReportError
            title="Could not load the quality distribution"
            error={quality.error}
            onRetry={() => void quality.refetch()}
          />
        ) : (
          <>
            <div className="grid min-w-0 grid-cols-1 gap-4 xl:grid-cols-2">
              <Chart
                type="bar"
                title="Fit score distribution"
                description="Businesses per 10-point band of fit score."
                data={q ? histogramRows(q.fit) : []}
                xKey="range"
                xLabel="Fit score"
                series={[{ key: "businesses", label: "Businesses" }]}
                loading={quality.isPending}
                emptyMessage="No scored businesses in this period yet."
                footnote={q ? `From scored businesses · ${generated(q.generatedAt)}` : undefined}
                data-testid="chart-fit"
              />
              <Chart
                type="bar"
                title="Data confidence distribution"
                description="Businesses per 10-point band of data confidence."
                data={q ? histogramRows(q.dataConfidence) : []}
                xKey="range"
                xLabel="Data confidence"
                series={[{ key: "businesses", label: "Businesses", slot: 3 }]}
                loading={quality.isPending}
                emptyMessage="No scored businesses in this period yet."
                footnote={q ? `From scored businesses · ${generated(q.generatedAt)}` : undefined}
                data-testid="chart-confidence"
              />
            </div>
            {q ? (
              <p className="text-muted-foreground text-xs">
                {formatNumber(q.total)} businesses considered · {formatNumber(q.unscored)} not
                scored yet (in neither chart).
              </p>
            ) : null}
          </>
        )}
      </Section>

      <Section
        id="jobs"
        title="Jobs over time"
        description={`Background jobs created per day, by kind, over ${period === "all" ? "the last 90 days (the longest window this report covers)" : periodLong}.`}
      >
        {jobs.isError && !j ? (
          <ReportError
            title="Could not load jobs over time"
            error={jobs.error}
            onRetry={() => void jobs.refetch()}
          />
        ) : (
          <div className="grid min-w-0 grid-cols-1 gap-4 xl:grid-cols-2">
            <Chart
              type="bar"
              stacked
              title="Jobs created"
              data={created}
              xKey="day"
              xLabel="Day (UTC)"
              xFormatter={formatDay}
              series={KIND_SERIES}
              loading={jobs.isPending}
              emptyMessage="No jobs were created in this window."
              footnote={
                j
                  ? `${formatNumber(KINDS.reduce((n, k) => n + j.totals.created[k], 0))} jobs · ${tPeriod} · ${generated(j.generatedAt)}`
                  : undefined
              }
            />
            <Chart
              type="bar"
              stacked
              title="Jobs that failed"
              description="By the day they were created."
              data={failed}
              xKey="day"
              xLabel="Day (UTC)"
              xFormatter={formatDay}
              series={KIND_SERIES}
              loading={jobs.isPending}
              emptyMessage="No job failed in this window."
              footnote={
                j
                  ? `${formatNumber(KINDS.reduce((n, k) => n + j.totals.failed[k], 0))} failed · ${generated(j.generatedAt)}`
                  : undefined
              }
            />
          </div>
        )}
      </Section>

      <Section
        id="funnel"
        title="Pipeline funnel"
        description={`Leads in each stage now, and leads that entered each stage in ${periodLong}. Lead stages are separate from business details and scores.`}
      >
        {funnel.isError && !f ? (
          <ReportError
            title="Could not load the pipeline funnel"
            error={funnel.error}
            onRetry={() => void funnel.refetch()}
          />
        ) : (
          <>
            <div className="grid min-w-0 grid-cols-1 gap-3 min-[480px]:grid-cols-2 xl:grid-cols-4">
              <Stat
                label="Open leads"
                icon={Kanban}
                value={f ? formatNumber(f.totals.open) : null}
                hint={f ? `${formatNumber(f.totals.leads)} leads in total` : undefined}
                loading={funnel.isPending}
              />
              <Stat
                label="Won"
                icon={CircleCheck}
                value={f ? formatNumber(f.totals.won) : null}
                hint="Leads in the won stage now"
                loading={funnel.isPending}
              />
              <Stat
                label="Lost"
                icon={CircleX}
                value={f ? formatNumber(f.totals.lost) : null}
                hint="Leads in the lost stage now"
                loading={funnel.isPending}
              />
              <Stat
                label="Win rate"
                icon={Percent}
                value={
                  f && f.totals.winRate !== null ? `${Math.round(f.totals.winRate * 100)}%` : null
                }
                hint={
                  f
                    ? f.totals.winRate === null
                      ? "No lead closed in this period"
                      : "Won of leads closed in this period"
                    : undefined
                }
                loading={funnel.isPending}
              />
            </div>
            {f && f.totals.wonValue.length ? (
              <p className="text-muted-foreground flex items-center gap-1.5 text-sm">
                <Wallet aria-hidden className="size-4" /> Won value in this period:{" "}
                {f.totals.wonValue.map((v) => money(v.valueMinor, v.currency)).join(", ")}
              </p>
            ) : null}
            <Chart
              type="bar"
              layout="horizontal"
              title="Leads per stage"
              data={funnelRows}
              xKey="stage"
              xLabel="Stage"
              series={[
                { key: "current", label: "Leads now", slot: 1 },
                { key: "entered", label: "Entered in period", slot: 2 },
              ]}
              loading={funnel.isPending}
              emptyMessage="No leads in the pipeline yet."
              height={Math.max(200, funnelRows.length * 52)}
              footnote={f ? `In board order · ${generated(f.generatedAt)}` : undefined}
            />
          </>
        )}
      </Section>

      <Section
        id="activity"
        title="Activity"
        description={`Notes, calls, WhatsApp messages, emails and meetings logged in ${periodLong}, by type and by person. Stage changes and assignments are not counted.`}
      >
        {activity.isError && !a ? (
          <ReportError
            title="Could not load the activity summary"
            error={activity.error}
            onRetry={() => void activity.refetch()}
          />
        ) : (
          <div className="grid min-w-0 grid-cols-1 gap-4 xl:grid-cols-2">
            <Chart
              type="bar"
              title="Activities by type"
              data={typeRows}
              xKey="type"
              xLabel="Type"
              series={[{ key: "activities", label: "Activities" }]}
              loading={activity.isPending}
              emptyMessage="Nothing was logged in this period."
              footnote={
                a ? `${formatNumber(a.total)} activities · ${generated(a.generatedAt)}` : undefined
              }
            />
            <Chart
              type="bar"
              layout="horizontal"
              stacked
              title="Activities by person"
              data={userRows}
              xKey="person"
              xLabel="Person"
              series={TYPE_SERIES}
              loading={activity.isPending}
              emptyMessage="Nothing was logged in this period."
              height={Math.max(200, userRows.length * 48)}
              footnote={a ? activityFootnote(a) : undefined}
            />
          </div>
        )}
      </Section>
    </div>
  );
}

function activityFootnote(a: ActivitySummary): string {
  return `${a.byUser.length} ${a.byUser.length === 1 ? "person" : "people"} · ${generated(a.generatedAt)}`;
}
