"use client";

import { EXPIRED_NAME_LABEL, type WebsiteAnalysis } from "@leadforge/contracts";
import { ArrowLeft, FileSearch, Info, RotateCcw, SearchX } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import {
  Banner,
  Breadcrumbs,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  CopyableValue,
  EmptyState,
  ErrorState,
  JobStatus,
  PageHeader,
  Progress,
  Skeleton,
  StatusIndicator,
} from "@leadforge/ui";
import { renderBreadcrumbLink } from "@/components/app/businesses/shared";
import { isApiError } from "@/lib/api";
import {
  ANALYSIS_STATUS_LABELS,
  analysisJobState,
  failureLabel,
  gapCount,
  hostOf,
  isAnalysisActive,
  isAnalysisTerminal,
} from "@/lib/analysis";
import { friendlyMessage, requestIdOf } from "@/lib/errors";
import { formatBytes, formatDateTime, formatNumber, formatRelative, plural } from "@/lib/format";
import { useAnalysis } from "@/lib/hooks/use-analysis";
import { usePermissions } from "@/lib/hooks/use-permissions";
import { DetectionItem, OpportunityItem, PageLink, STATIC_HTML_NOTE } from "./evidence";
import { RunAnalysisDialog } from "./run-analysis-dialog";

export function AnalysisDetailSkeleton() {
  return (
    <div
      className="flex flex-col gap-6"
      role="status"
      aria-busy="true"
      aria-label="Loading website analysis"
    >
      <Skeleton className="h-4 w-40" />
      <div className="flex flex-col gap-2">
        <Skeleton className="h-8 w-72 max-w-full" />
        <Skeleton className="h-4 w-96 max-w-full" />
      </div>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <Skeleton className="h-96 rounded-lg" />
        <Skeleton className="h-64 rounded-lg" />
      </div>
    </div>
  );
}

function isNotFound(err: unknown): boolean {
  return isApiError(err) && (err.status === 404 || err.code === "VALIDATION_FAILED");
}

export function businessNameOf(a: Pick<WebsiteAnalysis, "business">): string {
  if (!a.business) return "Business no longer in the directory";
  return (
    a.business.name ??
    (a.business.nameState === "expired" ? EXPIRED_NAME_LABEL : "Unnamed business")
  );
}

/** One sentence for the visible status line and the polite live region. */
export function analysisStatusSentence(a: WebsiteAnalysis): string {
  if (a.status === "queued") return "Queued: waiting for a worker. 1 credit is held.";
  if (a.status === "running") {
    return "Running: fetching the website. An analysis usually takes 10 to 20 seconds once it starts.";
  }
  if (!a.credits.settled) return `${ANALYSIS_STATUS_LABELS[a.status]}. Settling the credit.`;
  if (a.status === "completed") {
    return `Completed: ${plural(gapCount(a), "gap", "gaps")} observed, ${plural(a.opportunities.length, "opportunity", "opportunities")} suggested, ${plural(a.credits.captured, "credit", "credits")} charged.`;
  }
  return `Failed: ${a.error ? failureLabel(a.error.code) : "the analysis did not finish"}. ${a.credits.released ? "The credit was released." : "No credit was charged."}`;
}

function useStatusAnnouncement(a: WebsiteAnalysis | undefined): string {
  const [message, setMessage] = useState("");
  const last = useRef<string | null>(null);
  const signature = a ? `${a.status}|${a.credits.settled}` : null;
  useEffect(() => {
    if (!a || signature === null) return;
    if (last.current !== null && last.current !== signature) setMessage(analysisStatusSentence(a));
    last.current = signature;
    // Announce on status or settlement changes only, never on every poll.
  }, [signature]);
  return message;
}

/**
 * Website analysis detail (/app/analysis/[id]): status polled every 2 seconds until the analysis
 * is finished and its credit settled, every detection with its observed state, confidence and
 * evidence, opportunities linked to their detections, what was fetched (robots, pages, TLS),
 * errors and the credit.
 */
export function AnalysisDetail({ id }: { id: string }) {
  const analysis = useAnalysis(id);
  const announcement = useStatusAnnouncement(analysis.data);

  if (analysis.isPending) return <AnalysisDetailSkeleton />;
  if (analysis.isError && !analysis.data) {
    if (isNotFound(analysis.error)) {
      return (
        <div className="flex flex-col gap-6">
          <Breadcrumbs
            items={[{ label: "Website analysis", href: "/app/analysis" }, { label: "Not found" }]}
            renderLink={renderBreadcrumbLink}
          />
          <PageHeader title="Website analysis not found" />
          <EmptyState
            icon={SearchX}
            title="We could not find this website analysis"
            description="The link may be wrong, or the analysis belongs to another workspace. Switch workspace from the top bar if you expected to see it."
            action={
              <Button asChild>
                <Link href="/app/analysis">
                  <ArrowLeft aria-hidden /> Back to website analyses
                </Link>
              </Button>
            }
          />
        </div>
      );
    }
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title="Website analysis" />
        <ErrorState
          title="Could not load this website analysis"
          message={friendlyMessage(analysis.error)}
          requestId={requestIdOf(analysis.error)}
          onRetry={() => void analysis.refetch()}
        />
      </div>
    );
  }
  return (
    <AnalysisView
      analysis={analysis.data}
      announcement={announcement}
      refreshError={analysis.isError ? analysis.error : null}
      lastUpdated={analysis.dataUpdatedAt}
    />
  );
}

function AnalysisView({
  analysis: a,
  announcement,
  refreshError,
  lastUpdated,
}: {
  analysis: WebsiteAnalysis;
  announcement: string;
  refreshError: unknown;
  lastUpdated: number;
}) {
  const router = useRouter();
  const { can, canRunAnalysis } = usePermissions();
  const [rerun, setRerun] = useState(false);
  const active = isAnalysisActive(a);
  const host = hostOf(a.finalUrl ?? a.url);
  const name = businessNameOf(a);
  const yes = a.detections.filter((d) => d.observed === "yes").length;
  const unknown = a.detections.filter((d) => d.observed === "unknown").length;

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <PageHeader
        breadcrumbs={
          <Breadcrumbs
            items={[{ label: "Website analysis", href: "/app/analysis" }, { label: host }]}
            renderLink={renderBreadcrumbLink}
          />
        }
        eyebrow={
          <span className="flex flex-wrap items-center gap-2">
            Website analysis
            <JobStatus
              state={analysisJobState(a.status)}
              variant="badge"
              data-testid="analysis-status"
            />
          </span>
        }
        title={<span className="break-anywhere">{host}</span>}
        description={
          <>
            For{" "}
            {a.business ? (
              <Link href={`/app/businesses/${a.businessId}`} className="link-inline rounded-xs">
                {name}
              </Link>
            ) : (
              name
            )}
            {a.analyzedAt
              ? ` · analyzed ${formatDateTime(a.analyzedAt)}`
              : ` · requested ${formatDateTime(a.createdAt)}`}
          </>
        }
        actions={
          canRunAnalysis && isAnalysisTerminal(a) && a.business ? (
            <Button variant="outline" onClick={() => setRerun(true)}>
              <RotateCcw aria-hidden /> Analyze again
            </Button>
          ) : undefined
        }
      />

      <div className="flex min-w-0 flex-col gap-1">
        <p className="text-sm" data-testid="analysis-status-line">
          {analysisStatusSentence(a)}
        </p>
        <p className="text-muted-foreground text-xs">
          Updated {formatRelative(new Date(lastUpdated).toISOString())}
          {active || !a.credits.settled ? " · refreshing every 2 seconds" : ""}
        </p>
        <p
          className="sr-only"
          aria-live="polite"
          aria-atomic="true"
          data-testid="analysis-live-region"
        >
          {announcement}
        </p>
      </div>

      {a.status === "failed" && a.error ? (
        <Banner
          tone="destructive"
          title={`This analysis failed: ${failureLabel(a.error.code)}`}
          description={
            <span className="flex flex-col gap-1">
              <span className="break-anywhere">{a.error.message}</span>
              <span className="text-xs">Code {a.error.code}. Failed analyses are not charged.</span>
            </span>
          }
        />
      ) : null}
      {refreshError ? (
        <Banner
          tone="warning"
          title="Could not refresh this analysis"
          description={`${friendlyMessage(refreshError)} Showing the last loaded state; retrying automatically.`}
        />
      ) : null}
      <Banner
        tone="info"
        icon={Info}
        title="Static HTML only"
        description={STATIC_HTML_NOTE}
        data-testid="static-html-note"
      />

      {active ? (
        <Card>
          <CardContent className="pt-6">
            <Progress
              label={
                a.status === "queued" ? "Queued: waiting for a worker" : "Running: fetching pages"
              }
              showLabel
              size="sm"
            />
          </CardContent>
        </Card>
      ) : null}

      <div className="grid min-w-0 grid-cols-1 items-start gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <div className="flex min-w-0 flex-col gap-4">
          <Card data-testid="analysis-opportunities">
            <CardHeader>
              <CardTitle>Opportunities</CardTitle>
              <CardDescription>
                Suggestions follow from gaps the analysis observed. Each one links to the detection
                and evidence it rests on.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex min-w-0 flex-col gap-3">
              {a.opportunities.length ? (
                <ul className="divide-border flex min-w-0 flex-col divide-y">
                  {a.opportunities.map((o) => (
                    <OpportunityItem key={o.key} opportunity={o} analysis={a} inPage />
                  ))}
                </ul>
              ) : (
                <p className="text-muted-foreground text-sm">
                  {a.status === "completed"
                    ? "No opportunities were suggested: the analysis observed no gaps on the pages it checked."
                    : a.status === "failed"
                      ? "The analysis did not finish, so no opportunities were suggested."
                      : "Opportunities appear when the analysis completes."}
                </p>
              )}
              <Footnote analysis={a} />
            </CardContent>
          </Card>

          <Card data-testid="analysis-detections">
            <CardHeader>
              <CardTitle>Detections</CardTitle>
              <CardDescription>
                {a.detections.length
                  ? `${plural(a.detections.length, "check", "checks")}: ${plural(yes, "gap", "gaps")} observed${unknown ? `, ${formatNumber(unknown)} could not be checked` : ""}. Each shows what was observed, how confident the analysis is, and the evidence.`
                  : "What the analysis checked, with evidence."}
              </CardDescription>
            </CardHeader>
            <CardContent className="flex min-w-0 flex-col gap-3">
              {a.detections.length ? (
                <ul
                  className="divide-border flex min-w-0 flex-col divide-y"
                  aria-label="Detections"
                >
                  {a.detections.map((d) => (
                    <DetectionItem key={d.key} detection={d} />
                  ))}
                </ul>
              ) : (
                <EmptyState
                  size="compact"
                  icon={FileSearch}
                  title={
                    active ? "Checks run once the pages are fetched" : "No checks were recorded"
                  }
                  description={
                    active
                      ? "This page refreshes every 2 seconds."
                      : "The analysis ended before it could check the pages."
                  }
                />
              )}
              <Footnote analysis={a} />
            </CardContent>
          </Card>
        </div>

        <div className="flex min-w-0 flex-col gap-4">
          <CreditsCard analysis={a} canSeeLedger={can("usage:read")} />
          <FetchCard analysis={a} />
          <PagesCard analysis={a} />
          <DetailsCard analysis={a} />
        </div>
      </div>

      {canRunAnalysis && a.business ? (
        <RunAnalysisDialog
          businessId={a.businessId}
          website={a.url}
          open={rerun}
          onOpenChange={setRerun}
          title="Analyze this website again?"
          onStarted={(next) => router.push(`/app/analysis/${next.id}`)}
        />
      ) : null}
    </div>
  );
}

/** Source and timestamp line on every panel. */
function Footnote({ analysis: a }: { analysis: WebsiteAnalysis }) {
  return (
    <p className="text-muted-foreground border-border border-t pt-3 text-xs">
      Source: the business website <span className="break-anywhere">{a.finalUrl ?? a.url}</span> ·{" "}
      {a.analyzedAt ? (
        <>
          analyzed <time dateTime={a.analyzedAt}>{formatDateTime(a.analyzedAt)}</time>
        </>
      ) : (
        <>
          requested <time dateTime={a.createdAt}>{formatDateTime(a.createdAt)}</time>
        </>
      )}
    </p>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <dt className="text-muted-foreground text-xs">{label}</dt>
      <dd className="min-w-0 text-sm">{children}</dd>
    </div>
  );
}

function CreditsCard({
  analysis: a,
  canSeeLedger,
}: {
  analysis: WebsiteAnalysis;
  canSeeLedger: boolean;
}) {
  const c = a.credits;
  return (
    <Card data-testid="analysis-credits">
      <CardHeader>
        <CardTitle>Credits</CardTitle>
        <CardDescription>
          1 credit is held when the analysis is queued, charged when it completes and released if it
          fails.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex min-w-0 flex-col gap-4">
        <dl className="grid min-w-0 grid-cols-3 gap-3">
          {(
            [
              ["Held", c.held],
              ["Charged", c.captured],
              ["Released", c.released],
            ] as const
          ).map(([label, value]) => (
            <div key={label} className="flex min-w-0 flex-col gap-0.5">
              <dt className="text-muted-foreground text-xs">{label}</dt>
              <dd className="text-xl tabular-nums leading-7">{formatNumber(value)}</dd>
            </div>
          ))}
        </dl>
        <StatusIndicator
          tone={c.settled ? "success" : "info"}
          size="sm"
          label={c.settled ? "Settled" : "Not settled yet: settles when the analysis finishes"}
        />
        {canSeeLedger ? (
          <p className="text-muted-foreground border-border border-t pt-3 text-xs">
            <Link href={`/app/usage?referenceId=${a.id}`} className="link-inline rounded-xs">
              View ledger entries
            </Link>
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}

function FetchCard({ analysis: a }: { analysis: WebsiteAnalysis }) {
  const f = a.fetched;
  const tls = f?.tls;
  return (
    <Card data-testid="analysis-fetch">
      <CardHeader>
        <CardTitle>What was fetched</CardTitle>
        <CardDescription>
          The home page request, its security and the site&apos;s robots.txt.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex min-w-0 flex-col gap-4">
        <dl className="flex min-w-0 flex-col gap-3">
          <Row label="Website on record">
            <CopyableValue value={a.url} label="website" mono={false} />
          </Row>
          {a.finalUrl && a.finalUrl !== a.url ? (
            <Row label="Final address after redirects">
              <PageLink url={a.finalUrl} />
            </Row>
          ) : null}
          <Row label="robots.txt">
            {a.robots.fetched
              ? a.robots.allowed === false
                ? "Found: it does not allow fetching the home page, so nothing was analyzed"
                : a.robots.allowed
                  ? "Found: fetching is allowed"
                  : "Found"
              : "Not found or not readable: the analysis treats the site as allowing access"}
          </Row>
          {f ? (
            <>
              <Row label="Home page response">
                {f.status !== null ? `HTTP ${f.status}` : "No response"}
                {f.contentType ? ` · ${f.contentType}` : ""}
                {` · ${formatBytes(f.bytes)} in ${formatNumber(f.durationMs)} ms`}
              </Row>
              {f.redirects.length ? (
                <Row label="Redirects">
                  <ol className="flex min-w-0 flex-col gap-1">
                    {f.redirects.map((r, i) => (
                      <li key={`${r.url}-${i}`} className="flex min-w-0 flex-col">
                        <span className="text-muted-foreground text-xs">HTTP {r.status}</span>
                        <span className="break-anywhere text-[13px]">{r.url}</span>
                      </li>
                    ))}
                  </ol>
                </Row>
              ) : null}
              <Row label="HTTPS and certificate">
                {tls ? (
                  <span className="flex min-w-0 flex-col gap-0.5">
                    <StatusIndicator
                      size="sm"
                      tone={
                        tls.secure && tls.valid
                          ? "success"
                          : tls.secure && tls.valid === false
                            ? "warning"
                            : "neutral"
                      }
                      label={
                        !tls.secure
                          ? "Served over plain HTTP"
                          : tls.valid
                            ? "Valid certificate"
                            : tls.valid === false
                              ? "Certificate not valid"
                              : "Certificate not checked"
                      }
                    />
                    {tls.issuer ? (
                      <span className="text-muted-foreground text-xs">Issuer: {tls.issuer}</span>
                    ) : null}
                    {tls.validTo ? (
                      <span className="text-muted-foreground text-xs">
                        Valid until: {tls.validTo}
                      </span>
                    ) : null}
                    {tls.error ? (
                      <span className="text-muted-foreground break-anywhere text-xs">
                        Error: {tls.error}
                      </span>
                    ) : null}
                  </span>
                ) : (
                  "Not checked"
                )}
              </Row>
            </>
          ) : (
            <Row label="Home page response">
              {a.status === "queued" || a.status === "running" ? "Not fetched yet" : "Not fetched"}
            </Row>
          )}
        </dl>
      </CardContent>
    </Card>
  );
}

const PAGE_KIND: Record<string, string> = {
  home: "Home",
  contact: "Contact",
  about: "About",
  services: "Services",
  booking: "Booking",
};

function PagesCard({ analysis: a }: { analysis: WebsiteAnalysis }) {
  return (
    <Card data-testid="analysis-pages">
      <CardHeader>
        <CardTitle>Pages visited</CardTitle>
        <CardDescription>The home page plus up to 4 linked pages on the same site.</CardDescription>
      </CardHeader>
      <CardContent>
        {a.pagesVisited.length ? (
          <ul className="divide-border flex min-w-0 flex-col divide-y">
            {a.pagesVisited.map((p, i) => (
              <li
                key={`${p.url}-${i}`}
                className="flex min-w-0 flex-col gap-0.5 py-2 first:pt-0 last:pb-0"
              >
                <span className="text-xs font-medium">
                  {PAGE_KIND[p.kind] ?? p.kind}
                  <span className="text-muted-foreground font-normal">
                    {" "}
                    · {p.status !== null ? `HTTP ${p.status}` : "no response"}
                  </span>
                </span>
                <PageLink url={p.finalUrl ?? p.url} className="text-[13px]" />
                {p.error ? (
                  <span className="text-destructive break-anywhere text-xs">
                    Not analyzed: {p.error}
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-muted-foreground text-sm">
            {isAnalysisActive(a) ? "No pages fetched yet." : "No pages were fetched."}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

const TRIGGER_LABELS: Record<string, string> = {
  single: "Requested for this business",
  bulk: "Part of a bulk request",
  refresh: "Requested by a refresh",
};

function DetailsCard({ analysis: a }: { analysis: WebsiteAnalysis }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Details</CardTitle>
      </CardHeader>
      <CardContent>
        <dl className="flex min-w-0 flex-col gap-3">
          <Row label="Status">{ANALYSIS_STATUS_LABELS[a.status] ?? a.status}</Row>
          <Row label="How it started">
            {TRIGGER_LABELS[a.trigger] ?? a.trigger}
            {a.batchId ? (
              <>
                {" "}
                <Link
                  href={`/app/analysis?batchId=${a.batchId}`}
                  className="link-inline rounded-xs"
                >
                  View the batch
                </Link>
              </>
            ) : null}
          </Row>
          <Row label="Requested">{formatDateTime(a.createdAt)}</Row>
          <Row label="Started">{a.startedAt ? formatDateTime(a.startedAt) : "Not started"}</Row>
          <Row label="Analyzed">{a.analyzedAt ? formatDateTime(a.analyzedAt) : "Not yet"}</Row>
          <Row label="Finished">{a.finishedAt ? formatDateTime(a.finishedAt) : "Not yet"}</Row>
          <Row label="Analysis ID">
            <CopyableValue value={a.id} label="analysis ID" mono />
          </Row>
        </dl>
      </CardContent>
    </Card>
  );
}
