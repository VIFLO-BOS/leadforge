"use client";

import type { BusinessDetail, WebsiteAnalysis } from "@leadforge/contracts";
import { ArrowRight, Globe, Info, Lightbulb, Play } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import {
  Banner,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  EmptyState,
  ErrorState,
  JobStatus,
  LiveAnnouncement,
  Progress,
  Skeleton,
} from "@leadforge/ui";
import {
  OpportunityItem,
  ObservedStatus,
  STATIC_HTML_NOTE,
} from "@/components/app/analysis/evidence";
import { RunAnalysisDialog } from "@/components/app/analysis/run-analysis-dialog";
import {
  analysisJobState,
  failureLabel,
  gapCount,
  hostOf,
  isAnalysisActive,
  shouldPollAnalysis,
} from "@/lib/analysis";
import { friendlyMessage, requestIdOf } from "@/lib/errors";
import { formatDateTime, plural } from "@/lib/format";
import {
  useActiveBusinessAnalysis,
  useAnalysis,
  useBusinessAnalysis,
} from "@/lib/hooks/use-analysis";
import { usePermissions } from "@/lib/hooks/use-permissions";

/** Why a business cannot be analyzed right now, or null when it can. */
export function analysisBlocker(detail: BusinessDetail): string | null {
  if (detail.suppression.suppressed) return "Suppressed businesses are never fetched.";
  if (detail.website.state === "missing" || !detail.website.value) {
    return detail.website.state === "expired"
      ? "The website on record expired under its source's terms, so there is nothing to fetch."
      : "No website is on record. Add one with Correct details to analyze it.";
  }
  return null;
}

/**
 * The business's latest analysis plus any newer one that is still running, polled every 2 seconds
 * until it settles. From Phase 6 the business detail names the active one
 * (`latestAnalysis.activeAnalysisId`), so no second query is needed; older responses (the field
 * absent) fall back to GET /analysis/websites?businessId&status=queued&status=running.
 */
function useAnalysisState(detail: BusinessDetail) {
  const businessId = detail.id;
  const summary = detail.latestAnalysis;
  const known = summary === null || summary.activeAnalysisId !== undefined;
  const latest = useBusinessAnalysis(businessId);
  const active = useActiveBusinessAnalysis(businessId, !known);
  const activeId =
    (known ? (summary?.activeAnalysisId ?? null) : (active.data?.id ?? null)) ??
    (latest.data && isAnalysisActive(latest.data) ? latest.data.id : null);
  const polled = useAnalysis(activeId);
  // Shown as running until it settles; then the refreshed latest analysis takes over.
  const running =
    polled.data && activeId && polled.data.id === activeId && shouldPollAnalysis(polled.data)
      ? polled.data
      : null;
  return { latest, running, loading: latest.isPending };
}

function RunButton({
  detail,
  onRun,
  disabled,
}: {
  detail: BusinessDetail;
  onRun: () => void;
  disabled?: boolean;
}) {
  const blocker = analysisBlocker(detail);
  return (
    <div className="flex w-full min-w-0 flex-col items-start gap-1 min-[360px]:w-auto">
      <Button
        onClick={onRun}
        disabled={Boolean(blocker) || disabled}
        aria-describedby={blocker ? "analysis-blocker" : undefined}
        className="h-auto min-h-10 w-full whitespace-normal py-2 min-[360px]:w-auto"
      >
        <Play aria-hidden /> Run website analysis
      </Button>
      {blocker ? (
        <p id="analysis-blocker" className="text-muted-foreground text-xs">
          {blocker}
        </p>
      ) : (
        <p className="text-muted-foreground text-xs">1 credit, charged only when it completes.</p>
      )}
    </div>
  );
}

function RunningCard({ analysis }: { analysis: WebsiteAnalysis }) {
  return (
    <Card data-testid="analysis-running">
      <CardContent className="flex min-w-0 flex-col gap-3 pt-6">
        <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
          <JobStatus state={analysisJobState(analysis.status)} />
          <Button asChild variant="text" size="sm">
            <Link href={`/app/analysis/${analysis.id}`}>
              Watch progress <ArrowRight aria-hidden />
            </Link>
          </Button>
        </div>
        <Progress
          label={
            analysis.status === "queued"
              ? "Queued: waiting for a worker"
              : "Running: fetching the website"
          }
          showLabel
          size="sm"
        />
        <p className="text-muted-foreground text-xs">
          Analyzing {hostOf(analysis.url)} · requested {formatDateTime(analysis.createdAt)} ·
          refreshing every 2 seconds. 1 credit is held.
        </p>
      </CardContent>
    </Card>
  );
}

/**
 * Website analysis tab: the latest analysis summary with its detections, a run action (1 credit,
 * confirmed), live progress of a running analysis, and a link to the full analysis.
 */
export function AnalysisTab({ detail }: { detail: BusinessDetail }) {
  const { canRunAnalysis } = usePermissions();
  const [confirm, setConfirm] = useState(false);
  const { latest, running } = useAnalysisState(detail);
  const analysis = latest.data && !isAnalysisActive(latest.data) ? latest.data : null;

  const header = (
    <CardHeader className="flex-row flex-wrap items-start justify-between gap-3">
      <div className="flex min-w-0 flex-col gap-1">
        <CardTitle>Website analysis</CardTitle>
        <CardDescription>
          What LeadForge observed on this business&apos;s own website, with evidence. Static HTML
          only.
        </CardDescription>
      </div>
      {canRunAnalysis ? (
        <RunButton detail={detail} onRun={() => setConfirm(true)} disabled={Boolean(running)} />
      ) : null}
    </CardHeader>
  );

  let body: React.ReactNode;
  if (latest.isPending) {
    body = <Skeleton className="h-40" />;
  } else if (latest.isError) {
    body = (
      <ErrorState
        title="Could not load the website analysis"
        message={friendlyMessage(latest.error)}
        requestId={requestIdOf(latest.error)}
        onRetry={() => void latest.refetch()}
      />
    );
  } else if (!analysis) {
    body = running ? null : (
      <EmptyState
        size="compact"
        icon={Globe}
        title="No website analysis yet"
        description={
          analysisBlocker(detail) ??
          "An analysis fetches the home page and up to 4 linked pages, then reports what it observed: contact forms, booking and ordering flows, WhatsApp links, HTTPS, mobile layout hints, platform version and basic SEO."
        }
      />
    );
  } else {
    body = <AnalysisSummary analysis={analysis} />;
  }

  return (
    <div className="flex min-w-0 flex-col gap-4" data-testid="analysis-tab">
      {/* Announces queued -> running -> completed or failed, not every poll. */}
      <LiveAnnouncement
        data-testid="analysis-tab-live-region"
        message={
          running
            ? `Website analysis ${running.status === "queued" ? "queued" : "running"}`
            : latest.data
              ? `Website analysis ${latest.data.status}`
              : ""
        }
      />
      {running ? <RunningCard analysis={running} /> : null}
      <Card>
        {header}
        <CardContent className="flex min-w-0 flex-col gap-4">{body}</CardContent>
      </Card>
      {canRunAnalysis ? (
        <RunAnalysisDialog
          businessId={detail.id}
          website={detail.website.value}
          open={confirm}
          onOpenChange={setConfirm}
        />
      ) : null}
    </div>
  );
}

function AnalysisSummary({ analysis: a }: { analysis: WebsiteAnalysis }) {
  const seen = a.detections.filter((d) => d.observed === "no").length;
  const unknown = a.detections.filter((d) => d.observed === "unknown").length;
  return (
    <div className="flex min-w-0 flex-col gap-4">
      <div className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-2">
        <JobStatus state={analysisJobState(a.status)} size="sm" />
        <span className="text-muted-foreground text-xs">
          {a.analyzedAt
            ? `Analyzed ${formatDateTime(a.analyzedAt)}`
            : `Requested ${formatDateTime(a.createdAt)}`}{" "}
          · <span className="break-anywhere">{a.finalUrl ?? a.url}</span>
        </span>
      </div>
      {a.status === "failed" ? (
        <Banner
          tone="destructive"
          title={`The last analysis failed: ${a.error ? failureLabel(a.error.code) : "it did not finish"}`}
          description={
            a.error ? <span className="break-anywhere">{a.error.message}</span> : undefined
          }
        />
      ) : (
        <dl className="grid min-w-0 grid-cols-3 gap-3">
          {(
            [
              ["Gaps observed", gapCount(a)],
              ["Features seen", seen],
              ["Not checked", unknown],
            ] as const
          ).map(([label, value]) => (
            <div
              key={label}
              className="bg-surface-container-low dark:bg-surface-container-high flex min-w-0 flex-col gap-0.5 rounded-md p-3"
            >
              <dt className="text-muted-foreground text-xs">{label}</dt>
              <dd className="text-xl tabular-nums leading-7">{value}</dd>
            </div>
          ))}
        </dl>
      )}
      {a.detections.length ? (
        <ul className="divide-border flex min-w-0 flex-col divide-y" aria-label="Detections">
          {a.detections.map((d) => (
            <li
              key={d.key}
              className="flex min-w-0 flex-col gap-1 py-2.5 first:pt-0 last:pb-0 min-[480px]:flex-row min-[480px]:items-center min-[480px]:justify-between min-[480px]:gap-3"
            >
              <Link
                href={`/app/analysis/${a.id}#detection-${d.key}`}
                className="hover:text-primary break-anywhere rounded-xs min-w-0 text-sm hover:underline"
              >
                {d.label}
              </Link>
              <span className="shrink-0">
                <ObservedStatus observed={d.observed} />
              </span>
            </li>
          ))}
        </ul>
      ) : null}
      <Banner tone="info" icon={Info} title="Static HTML only" description={STATIC_HTML_NOTE} />
      <div className="border-border flex min-w-0 flex-wrap items-center justify-between gap-2 border-t pt-3">
        <p className="text-muted-foreground text-xs">
          Source: the business website ·{" "}
          {a.analyzedAt
            ? `analyzed ${formatDateTime(a.analyzedAt)}`
            : `requested ${formatDateTime(a.createdAt)}`}
        </p>
        <Button asChild variant="outline" size="sm">
          <Link href={`/app/analysis/${a.id}`}>
            Open full analysis <ArrowRight aria-hidden />
          </Link>
        </Button>
      </div>
    </div>
  );
}

/**
 * Opportunities tab: the suggestions from the latest completed analysis, each with its rationale,
 * confidence and the evidence of the detections it rests on.
 */
export function OpportunitiesTab({ detail }: { detail: BusinessDetail }) {
  const latest = useBusinessAnalysis(detail.id);
  const a = latest.data && latest.data.status === "completed" ? latest.data : null;
  return (
    <Card data-testid="opportunities-tab">
      <CardHeader>
        <CardTitle>Opportunities</CardTitle>
        <CardDescription>
          Suggestions for services this business might need, each based on a gap the website
          analysis observed. Evidence first: check it before you pitch.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex min-w-0 flex-col gap-4">
        {latest.isPending ? (
          <Skeleton className="h-40" />
        ) : latest.isError ? (
          <ErrorState
            title="Could not load the opportunities"
            message={friendlyMessage(latest.error)}
            requestId={requestIdOf(latest.error)}
            onRetry={() => void latest.refetch()}
          />
        ) : !a ? (
          <EmptyState
            size="compact"
            icon={Lightbulb}
            title="No opportunities yet"
            description="Opportunities come from a completed website analysis. Run one from the Website analysis tab."
            action={
              <Button asChild variant="outline">
                <Link href={`/app/businesses/${detail.id}?tab=analysis`}>
                  Go to website analysis
                </Link>
              </Button>
            }
          />
        ) : a.opportunities.length === 0 ? (
          <EmptyState
            size="compact"
            icon={Lightbulb}
            title="No opportunities were suggested"
            description={`The analysis of ${formatDateTime(a.analyzedAt)} observed no gaps on the pages it checked. That does not prove the site has every feature; it reads static HTML only.`}
          />
        ) : (
          <>
            <p className="text-muted-foreground text-xs">
              {plural(a.opportunities.length, "suggestion", "suggestions")}, highest confidence
              first. Those with confidence of at least 70% count toward the fit score&apos;s website
              opportunity signal.
            </p>
            <ul className="divide-border flex min-w-0 flex-col divide-y">
              {a.opportunities.map((o) => (
                <OpportunityItem key={o.key} opportunity={o} analysis={a} showEvidence />
              ))}
            </ul>
          </>
        )}
        {a ? (
          <p className="text-muted-foreground border-border border-t pt-3 text-xs">
            Source: website analysis of{" "}
            <span className="break-anywhere">{a.finalUrl ?? a.url}</span> · analyzed{" "}
            {formatDateTime(a.analyzedAt)} ·{" "}
            <Link href={`/app/analysis/${a.id}`} className="link-inline rounded-xs">
              Full analysis
            </Link>
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}
