"use client";

import type {
  DiscoveryIssue,
  DiscoveryJob,
  DiscoverySourceOption,
  DiscoverySourceOutcome,
} from "@leadforge/contracts";
import Link from "next/link";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  CopyableValue,
  Progress,
  StatusIndicator,
  type StatusTone,
} from "@leadforge/ui";
import {
  discoverySourceName,
  isDiscoveryActive,
  issueLabel,
  locationSummary,
} from "@/lib/discovery";
import { formatDateTime, formatNumber, formatRelative } from "@/lib/format";
import { countryName } from "@/lib/geo";

function Count({ label, value, hint }: { label: string; value: number; hint?: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <dt className="text-muted-foreground text-xs">{label}</dt>
      <dd className="text-foreground text-xl font-normal tabular-nums leading-7">
        {formatNumber(value)}
      </dd>
      {hint ? <dd className="text-muted-foreground text-xs">{hint}</dd> : null}
    </div>
  );
}

/**
 * Live counts from the worker's item records. No percentage: the number of places a source will
 * return is not known in advance, so a bar would be invented. While the job runs an
 * indeterminate bar says so.
 */
export function ProgressPanel({ job }: { job: DiscoveryJob }) {
  const p = job.progress;
  const active = isDiscoveryActive(job);
  return (
    <Card className="h-full" data-testid="job-progress">
      <CardHeader>
        <CardTitle>Progress</CardTitle>
        <CardDescription>
          Counted from the items the worker has written. Billable records are new businesses plus
          existing ones that gained new details.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex min-w-0 flex-col gap-5">
        {active ? (
          <Progress
            label={
              job.status === "queued"
                ? "Queued: waiting for a worker"
                : job.cancelRequested
                  ? "Stopping before the next page"
                  : "Running"
            }
            showLabel
            size="sm"
          />
        ) : null}
        <dl className="grid min-w-0 grid-cols-2 gap-x-4 gap-y-4 min-[640px]:grid-cols-4">
          <Count label="Processed" value={p.processed} />
          <Count label="New businesses" value={p.created} />
          <Count label="Updated" value={p.updated} />
          <Count label="Billable" value={p.billable} hint={`of at most ${formatNumber(p.limit)}`} />
          <Count label="Duplicates" value={p.duplicates} />
          <Count label="Skipped" value={p.skipped} />
          <Count label="Failed" value={p.failed} />
          <Count label="Pages fetched" value={p.pagesFetched} />
        </dl>
        <p className="text-muted-foreground border-border border-t pt-3 text-xs">
          From discovery item records
          {p.lastEventAt ? ` · last event ${formatRelative(p.lastEventAt)}` : " · no events yet"}
          {active ? " · refreshes every 2 seconds" : ""}
        </p>
      </CardContent>
    </Card>
  );
}

export function CreditsPanel({ job, canSeeLedger }: { job: DiscoveryJob; canSeeLedger: boolean }) {
  const c = job.credits;
  return (
    <Card className="h-full" data-testid="job-credits">
      <CardHeader>
        <CardTitle>Credits</CardTitle>
        <CardDescription>
          Held when the job was queued; captured for produced records and the rest released when it
          settles.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex min-w-0 flex-col gap-4">
        <dl className="grid min-w-0 grid-cols-3 gap-3">
          <Count label="Held" value={c.held} />
          <Count label="Charged" value={c.captured} />
          <Count label="Released" value={c.released} />
        </dl>
        <StatusIndicator
          tone={c.settled ? "success" : "info"}
          size="sm"
          label={
            c.settled
              ? `Settled ${c.settledAt ? formatDateTime(c.settledAt) : ""}`.trim()
              : "Not settled yet: settles when the job finishes"
          }
        />
        <p className="text-muted-foreground border-border border-t pt-3 text-xs">
          {job.estimate.basis}
          {canSeeLedger ? (
            <>
              {" "}
              <Link href={`/app/usage?referenceId=${job.id}`} className="link-inline rounded-xs">
                View ledger entries
              </Link>
            </>
          ) : null}
        </p>
      </CardContent>
    </Card>
  );
}

const OUTCOME_STATUS: Record<
  DiscoverySourceOutcome["status"],
  { label: string; tone: StatusTone }
> = {
  pending: { label: "Pending", tone: "neutral" },
  running: { label: "Running", tone: "info" },
  completed: { label: "Completed", tone: "success" },
  failed: { label: "Failed", tone: "destructive" },
  cancelled: { label: "Cancelled", tone: "neutral" },
};

export function SourceOutcomesPanel({
  job,
  sources,
}: {
  job: DiscoveryJob;
  sources: DiscoverySourceOption[] | undefined;
}) {
  return (
    <Card data-testid="job-source-outcomes">
      <CardHeader>
        <CardTitle>Source outcomes</CardTitle>
        <CardDescription>
          What each source returned, including errors that were retried.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {job.sourceOutcomes.length ? (
          <ul className="divide-border flex min-w-0 flex-col divide-y">
            {job.sourceOutcomes.map((o) => {
              const s = OUTCOME_STATUS[o.status] ?? { label: o.status, tone: "neutral" as const };
              return (
                <li
                  key={o.source}
                  className="flex min-w-0 flex-col gap-2 py-3 first:pt-0 last:pb-0"
                >
                  <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
                    <span className="break-anywhere text-sm font-medium">
                      {discoverySourceName(o.source, sources)}
                    </span>
                    <StatusIndicator variant="badge" tone={s.tone} label={s.label} />
                  </div>
                  <p className="text-muted-foreground text-xs tabular-nums">
                    {formatNumber(o.pages)} {o.pages === 1 ? "page" : "pages"} ·{" "}
                    {formatNumber(o.records)} {o.records === 1 ? "record" : "records"} returned
                    {o.rateLimited
                      ? ` · ${formatNumber(o.rateLimited)} requests delayed by our rate limit`
                      : ""}
                  </p>
                  {o.errors.length ? (
                    <ul className="flex min-w-0 flex-col gap-1">
                      {o.errors.map((e) => (
                        <li key={e.code} className="min-w-0 text-xs">
                          <StatusIndicator
                            tone="warning"
                            size="sm"
                            label={`${issueLabel(e.code)}${e.count > 1 ? ` (${formatNumber(e.count)} times)` : ""}: ${e.message}`}
                          />
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="text-muted-foreground text-sm">No source has started yet.</p>
        )}
      </CardContent>
    </Card>
  );
}

function IssueList({
  issues,
  tone,
  sources,
}: {
  issues: DiscoveryIssue[];
  tone: StatusTone;
  sources: DiscoverySourceOption[] | undefined;
}) {
  return (
    <ul className="flex min-w-0 flex-col gap-3">
      {issues.map((i, n) => (
        <li key={`${i.code}-${i.at}-${n}`} className="flex min-w-0 flex-col gap-0.5">
          <StatusIndicator tone={tone} size="sm" label={issueLabel(i.code)} />
          <span className="break-anywhere pl-5 text-sm">{i.message}</span>
          <span className="text-muted-foreground pl-5 text-xs">
            {i.source ? `${discoverySourceName(i.source, sources)} · ` : ""}
            {formatDateTime(i.at)}
          </span>
        </li>
      ))}
    </ul>
  );
}

export function IssuesPanel({
  job,
  sources,
}: {
  job: DiscoveryJob;
  sources: DiscoverySourceOption[] | undefined;
}) {
  const none = job.errors.length === 0 && job.warnings.length === 0;
  return (
    <Card data-testid="job-issues">
      <CardHeader>
        <CardTitle>Errors and warnings</CardTitle>
        <CardDescription>
          Final job-level problems. Item problems are in the items table.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex min-w-0 flex-col gap-4">
        {none ? <p className="text-muted-foreground text-sm">None reported.</p> : null}
        {job.errors.length ? (
          <section aria-label="Errors" className="flex min-w-0 flex-col gap-2">
            <IssueList issues={job.errors} tone="destructive" sources={sources} />
          </section>
        ) : null}
        {job.warnings.length ? (
          <section aria-label="Warnings" className="flex min-w-0 flex-col gap-2">
            <IssueList issues={job.warnings} tone="warning" sources={sources} />
          </section>
        ) : null}
      </CardContent>
    </Card>
  );
}

const PRIORITY: Record<string, string> = {
  phone: "Phone",
  website: "Website",
  email: "Email",
  whatsapp: "WhatsApp",
};

export function JobDetailsPanel({
  job,
  sources,
}: {
  job: DiscoveryJob;
  sources: DiscoverySourceOption[] | undefined;
}) {
  const s = job.spec;
  const rows: { label: string; value: React.ReactNode }[] = [
    { label: "Sources", value: s.sources.map((k) => discoverySourceName(k, sources)).join(", ") },
    { label: "Categories", value: s.categories.join(", ") },
    {
      label: "Place",
      value: [locationSummary(s.location), countryName(s.location.country)]
        .filter(Boolean)
        .join(", "),
    },
    { label: "Record limit", value: formatNumber(s.maxRecords) },
  ];
  const honours = (flag: "priorityFields" | "confidence" | "requireContact") =>
    s.sources.some((k) => sources?.find((o) => o.key === k)?.specSupport?.[flag]);
  if (honours("priorityFields")) {
    rows.push({
      label: "Contact fields",
      value: s.priorityFields.map((f) => PRIORITY[f] ?? f).join(", ") || "None",
    });
  }
  if (honours("confidence")) {
    rows.push({ label: "Place confidence", value: s.confidence === "high" ? "High" : "Standard" });
  }
  if (honours("requireContact")) {
    rows.push({
      label: "Contact required",
      value: s.requireContact ? "Only places with a phone, email or website" : "No",
    });
  }
  for (const r of job.sourceReleases ?? []) {
    rows.push({ label: `${discoverySourceName(r.source, sources)} release`, value: r.release });
  }
  if (s.domainsInclude.length)
    rows.push({ label: "Only domains", value: s.domainsInclude.join(", ") });
  if (s.domainsExclude.length)
    rows.push({ label: "Skipped domains", value: s.domainsExclude.join(", ") });
  const times: { label: string; at: string | null }[] = [
    { label: "Created", at: job.createdAt },
    { label: "Queued", at: job.queuedAt },
    { label: "Started", at: job.startedAt },
    { label: "Finished", at: job.finishedAt },
    { label: "Cancelled", at: job.cancelledAt },
  ];
  return (
    <Card data-testid="job-details">
      <CardHeader>
        <CardTitle>Job details</CardTitle>
      </CardHeader>
      <CardContent className="flex min-w-0 flex-col gap-4">
        <dl className="flex min-w-0 flex-col gap-2.5 text-sm">
          {rows.map((r) => (
            <div key={r.label} className="flex min-w-0 flex-col gap-0.5">
              <dt className="text-muted-foreground text-xs">{r.label}</dt>
              <dd className="break-anywhere">{r.value}</dd>
            </div>
          ))}
          {times
            .filter((t) => t.at)
            .map((t) => (
              <div key={t.label} className="flex min-w-0 flex-col gap-0.5">
                <dt className="text-muted-foreground text-xs">{t.label}</dt>
                <dd>
                  <time dateTime={t.at ?? undefined}>{formatDateTime(t.at)}</time>
                </dd>
              </div>
            ))}
          {job.round > 0 ? (
            <div className="flex min-w-0 flex-col gap-0.5">
              <dt className="text-muted-foreground text-xs">Retry rounds</dt>
              <dd>{formatNumber(job.round)}</dd>
            </div>
          ) : null}
          <div className="flex min-w-0 flex-col gap-0.5">
            <dt className="text-muted-foreground text-xs">Job ID</dt>
            <dd>
              <CopyableValue value={job.id} label="job ID" mono />
            </dd>
          </div>
        </dl>
      </CardContent>
    </Card>
  );
}
