"use client";

import type { OverviewMetrics } from "@leadforge/contracts";
import { Chart } from "@leadforge/ui/charts";
import Link from "next/link";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Heading,
  HeadingLevel,
  JobStatus,
  Timeline,
  type TimelineItem,
} from "@leadforge/ui";
import { activityIcon, useActivityText } from "@/components/app/crm/activity-feed";
import { hasJobPage, jobProgress } from "@/components/app/jobs/jobs-page";
import { activityBusinessName, isSystemActivity } from "@/lib/crm";
import { formatDateTime, formatNumber, formatRelative, plural } from "@/lib/format";
import { jobKindLabel, jobState } from "@/lib/labels";
import { histogramRows } from "@/lib/reports";

type Metrics = Partial<Pick<OverviewMetrics, "pipeline" | "jobs" | "activity" | "quality">> & {
  generatedAt: string;
};

/** Open, qualified and unassigned leads, and leads won and lost in the period. */
export function PipelineCard({ m, periodLong }: { m: Metrics; periodLong: string }) {
  const p = m.pipeline;
  if (!p) return null;
  const rows: { label: string; value: number; href?: string }[] = [
    { label: "Open leads", value: p.openLeads, href: "/app/pipeline" },
    { label: "Qualified (past the first stage)", value: p.qualifiedLeads },
    {
      label: "Open and unassigned",
      value: p.unassignedOpenLeads,
      href: "/app/pipeline?unassigned=true",
    },
    { label: `Won in the ${periodLong}`, value: p.wonInPeriod },
    { label: `Lost in the ${periodLong}`, value: p.lostInPeriod },
  ];
  return (
    <Card className="h-full" data-testid="overview-pipeline">
      <CardHeader className="flex-row items-start justify-between gap-2">
        <div className="flex min-w-0 flex-col gap-1">
          <CardTitle>Pipeline</CardTitle>
          <CardDescription>
            Lead stages, kept apart from business details and scores.
          </CardDescription>
        </div>
        <Button asChild variant="text" size="sm" className="shrink-0">
          <Link href="/app/pipeline">Open pipeline</Link>
        </Button>
      </CardHeader>
      <CardContent>
        <dl className="divide-border flex min-w-0 flex-col divide-y">
          {rows.map((r) => (
            <div
              key={r.label}
              className="flex min-w-0 items-baseline justify-between gap-3 py-2 first:pt-0 last:pb-0"
            >
              <dt className="text-muted-foreground min-w-0 text-sm">
                {r.href ? (
                  <Link href={r.href} className="hover:text-primary rounded-xs hover:underline">
                    {r.label}
                  </Link>
                ) : (
                  r.label
                )}
              </dt>
              <dd className="text-base tabular-nums">{formatNumber(r.value)}</dd>
            </div>
          ))}
        </dl>
        <p className="text-muted-foreground mt-3 text-xs">
          From lead records · generated {formatRelative(m.generatedAt)}
        </p>
      </CardContent>
    </Card>
  );
}

/** The five newest background jobs of any kind, with active and failed counts. */
export function RecentJobsCard({ m, periodLong }: { m: Metrics; periodLong: string }) {
  const j = m.jobs;
  if (!j) return null;
  return (
    <Card className="h-full" data-testid="overview-jobs">
      <CardHeader className="flex-row items-start justify-between gap-2">
        <div className="flex min-w-0 flex-col gap-1">
          <CardTitle>Background jobs</CardTitle>
          <CardDescription>
            {formatNumber(j.active)} running or queued · {formatNumber(j.failedInPeriod)} failed in
            the {periodLong}
          </CardDescription>
        </div>
        <Button asChild variant="text" size="sm" className="shrink-0">
          <Link href={j.failedInPeriod ? "/app/jobs?status=failed" : "/app/jobs"}>
            {j.failedInPeriod ? "Review failures" : "All jobs"}
          </Link>
        </Button>
      </CardHeader>
      <CardContent>
        {j.recent.length ? (
          <ul className="divide-border flex min-w-0 flex-col divide-y">
            {j.recent.map((job) => (
              <li
                key={`${job.kind}-${job.id}`}
                className="flex min-w-0 flex-col gap-1 py-2.5 first:pt-0 last:pb-0"
              >
                {hasJobPage(job.href) ? (
                  <Link
                    href={job.href}
                    className="break-anywhere rounded-xs hover:text-primary text-sm font-medium hover:underline"
                  >
                    {job.name}
                  </Link>
                ) : (
                  <span className="break-anywhere text-sm font-medium">{job.name}</span>
                )}
                <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
                  <Badge variant="neutral">{jobKindLabel(job.kind)}</Badge>
                  <JobStatus state={jobState(job.status)} size="sm" />
                  <span className="text-muted-foreground text-xs tabular-nums">
                    {jobProgress(job)} · {formatRelative(job.createdAt)}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-muted-foreground text-sm">No background jobs yet.</p>
        )}
      </CardContent>
    </Card>
  );
}

/** The ten newest activities of any type. */
export function RecentActivityCard({ m, periodLong }: { m: Metrics; periodLong: string }) {
  const text = useActivityText();
  const a = m.activity;
  if (!a) return null;
  const items: TimelineItem[] = a.recent.map((act) => ({
    id: act.id,
    icon: activityIcon(act.type),
    tone: isSystemActivity(act) ? "neutral" : "primary",
    timestamp: act.occurredAt,
    timestampLabel: formatRelative(act.occurredAt),
    title: text.summary(act),
    description: (
      <Link
        href={`/app/businesses/${act.businessId}?tab=activities`}
        className="hover:text-primary rounded-xs hover:underline"
      >
        {activityBusinessName(act)}
      </Link>
    ),
    meta: `${isSystemActivity(act) ? "By" : "Logged by"} ${text.member(act.authorUserId)} · ${formatDateTime(act.occurredAt)}`,
  }));
  return (
    <Card className="h-full" data-testid="overview-activity">
      <CardHeader className="flex-row items-start justify-between gap-2">
        <div className="flex min-w-0 flex-col gap-1">
          <CardTitle>Recent activity</CardTitle>
          <CardDescription>
            {plural(a.loggedInPeriod, "activity", "activities")} logged in the {periodLong}
          </CardDescription>
        </div>
        <Button asChild variant="text" size="sm" className="shrink-0">
          <Link href="/app/activities">All activity</Link>
        </Button>
      </CardHeader>
      <CardContent>
        {items.length ? (
          <Timeline items={items} density="compact" aria-label="Recent activity" />
        ) : (
          <p className="text-muted-foreground text-sm">
            Nothing logged yet. Calls, messages, notes and stage changes appear here.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

/** Fit and data confidence distributions: two charts, never one combined measure. */
export function QualitySection({ m }: { m: Metrics }) {
  const q = m.quality;
  if (!q) return null;
  return (
    <section
      aria-labelledby="quality-title"
      className="flex min-w-0 flex-col gap-3"
      data-testid="overview-quality"
    >
      <div className="flex min-w-0 flex-wrap items-baseline justify-between gap-2">
        <div className="flex min-w-0 flex-col gap-1">
          <Heading id="quality-title" className="text-base font-medium">
            Lead quality
          </Heading>
          <p className="text-muted-foreground text-sm">
            Fit and data confidence are separate measures and are never added together.{" "}
            {formatNumber(q.unscored)} of {formatNumber(q.total)} businesses are not scored yet.
          </p>
        </div>
        <Button asChild variant="text" size="sm">
          <Link href="/app/reports">Open reports</Link>
        </Button>
      </div>
      <HeadingLevel>
        <div className="grid min-w-0 grid-cols-1 gap-4 xl:grid-cols-2">
          <Chart
            type="bar"
            title="Fit score"
            data={histogramRows(q.fit)}
            xKey="range"
            xLabel="Fit score"
            series={[{ key: "businesses", label: "Businesses" }]}
            height={200}
            emptyMessage="No scored businesses yet."
          />
          <Chart
            type="bar"
            title="Data confidence"
            data={histogramRows(q.dataConfidence)}
            xKey="range"
            xLabel="Data confidence"
            series={[{ key: "businesses", label: "Businesses", slot: 3 }]}
            height={200}
            emptyMessage="No scored businesses yet."
          />
        </div>
      </HeadingLevel>
    </section>
  );
}
