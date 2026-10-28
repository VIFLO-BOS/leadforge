"use client";

import type { BusinessDetail, EnrichmentRun } from "@leadforge/contracts";
import { RefreshCw, ScanSearch } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import {
  Banner,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  ConfirmDialog,
  ErrorState,
  JobStatus,
  LiveAnnouncement,
  Skeleton,
  StatusIndicator,
  toast,
} from "@leadforge/ui";
import { analysisRequestError } from "@/components/app/analysis/run-analysis-dialog";
import { isApiError } from "@/lib/api";
import {
  MAILBOX_NOT_CONFIRMED,
  emailCheckMeta,
  foundSummary,
  runFailureLabel,
  runKindLabel,
} from "@/lib/enrichment";
import {
  creditShortfall,
  friendlyMessage,
  isBillingBlock,
  isForbidden,
  requestIdOf,
} from "@/lib/errors";
import { isPendingDeletion } from "@/lib/org-lifecycle";
import { BillingBlockBanner } from "@/components/app/billing/billing-shared";
import { formatDateTime, formatNumber, formatRelative, plural } from "@/lib/format";
import { useCreditBalance } from "@/lib/hooks/use-credits";
import {
  isRunActive,
  useEnrichmentRuns,
  useFindWebsiteContacts,
  useRefreshBusiness,
} from "@/lib/hooks/use-enrichment";
import { analysisBlocker } from "./analysis-tab";

/** Readable reason for a failed enrichment request (the request itself, not a run). */
export function enrichmentRequestError(err: unknown): { title: string; message: string } {
  if (isApiError(err) && err.code === "RATE_LIMITED") {
    return { title: "Too many enrichment runs", message: friendlyMessage(err) };
  }
  if (isApiError(err) && err.code === "VALIDATION_FAILED") {
    return { title: "That address is not on this business", message: friendlyMessage(err) };
  }
  return analysisRequestError(err);
}

function RunItem({ run }: { run: EnrichmentRun }) {
  const o = run.output;
  const done = run.status === "completed";
  return (
    <li
      className="flex min-w-0 flex-col gap-1.5 py-3 first:pt-0 last:pb-0"
      data-run={run.id}
      data-run-kind={run.kind}
      data-run-status={run.status}
    >
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
        <span className="text-sm font-medium">
          {runKindLabel(run.kind)}
          {run.kind === "email_check" && run.input.address ? (
            <span className="text-muted-foreground break-anywhere font-normal">
              {" "}
              · {run.input.address}
            </span>
          ) : null}
        </span>
        <JobStatus
          state={
            run.status === "queued" ||
            run.status === "running" ||
            run.status === "completed" ||
            run.status === "failed"
              ? run.status
              : "queued"
          }
          size="sm"
        />
      </div>
      {done && run.kind === "website_contacts" ? (
        <div className="flex min-w-0 flex-col gap-0.5 text-[13px]">
          <span>{foundSummary(run)}</span>
          <span className="text-muted-foreground text-xs">
            {plural(o.phonesVerified, "phone verified", "phones verified")} (valid and on the
            business&apos;s own site) ·{" "}
            {plural(o.whatsappConfirmed, "WhatsApp number confirmed", "WhatsApp numbers confirmed")}{" "}
            · {plural(o.pagesVisited.length, "page", "pages")} checked
          </span>
          {o.ownSite === false ? (
            <span className="text-warning text-xs">
              The home page ended on another domain, so no phone was marked verified.
            </span>
          ) : null}
        </div>
      ) : null}
      {done && o.emailChecks.length ? (
        <ul className="flex min-w-0 flex-col gap-1" aria-label="Email checks">
          {o.emailChecks.map((c) => {
            const meta = emailCheckMeta(c.result);
            return (
              <li key={c.address} className="flex min-w-0 flex-col gap-0.5">
                <span className="break-anywhere text-[13px]">{c.address}</span>
                <span className="flex flex-wrap items-center gap-x-3 gap-y-0.5">
                  <StatusIndicator tone={meta.tone} label={meta.label} size="sm" />
                  <span className="text-muted-foreground text-xs">{MAILBOX_NOT_CONFIRMED}</span>
                </span>
              </li>
            );
          })}
        </ul>
      ) : null}
      {run.status === "failed" && run.error ? (
        <p className="text-destructive break-anywhere text-xs">
          {runFailureLabel(run.error.code)}: {run.error.message}
        </p>
      ) : null}
      <p className="text-muted-foreground text-xs">
        {run.trigger === "refresh" ? "Part of a refresh · " : ""}
        {run.finishedAt
          ? `Finished ${formatRelative(run.finishedAt)}`
          : run.startedAt
            ? `Started ${formatRelative(run.startedAt)} · refreshing every 2 seconds`
            : `Requested ${formatRelative(run.createdAt)} · refreshing every 2 seconds`}
        {done && o.observationIds.length ? (
          <>
            {" · "}
            {plural(o.observationIds.length, "new observation", "new observations")} in{" "}
            <Link href="?tab=provenance" className="link-inline rounded-xs">
              provenance
            </Link>
          </>
        ) : null}
      </p>
    </li>
  );
}

/**
 * Contact collection: find contacts on the business's own website (free), with the recent runs
 * and their results polled every 2 seconds while one runs. New observations, verified phones,
 * confirmed WhatsApp and email checks appear in the contacts panel when a run finishes.
 */
export function ContactCollectionCard({
  detail,
  canRun,
  onRefresh,
}: {
  detail: BusinessDetail;
  canRun: boolean;
  onRefresh: () => void;
}) {
  const runs = useEnrichmentRuns(detail.id);
  const find = useFindWebsiteContacts(detail.id);
  const blocker = analysisBlocker(detail);
  const rows = runs.data?.data ?? [];
  const activeContacts = rows.some((r) => r.kind === "website_contacts" && isRunActive(r));

  const runFind = () => {
    // The API answers with the run already in progress, if there is one.
    const known = new Set(rows.map((r) => r.id));
    find.mutate(undefined, {
      onSuccess: (run) =>
        toast.success(
          known.has(run.id)
            ? "A run is already in progress"
            : "Looking for contacts on the website",
          {
            description: "Free. Results appear here in about 10 to 20 seconds.",
          },
        ),
      onError: (err) => {
        const e = enrichmentRequestError(err);
        toast.error(e.title, { description: e.message });
      },
    });
  };

  return (
    <Card data-testid="contact-collection">
      <CardHeader className="flex-row flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <CardTitle>Contact collection</CardTitle>
          <CardDescription>
            Collects phones, emails, WhatsApp links and social profiles from the business&apos;s own
            website, with evidence, and checks email addresses. Free.
          </CardDescription>
        </div>
        {canRun ? (
          <div className="flex w-full min-w-0 flex-wrap gap-2 min-[360px]:w-auto">
            <Button
              variant="outline"
              size="sm"
              className="h-auto min-h-8 w-full shrink whitespace-normal py-1.5 min-[360px]:w-auto"
              onClick={runFind}
              loading={find.isPending}
              disabled={Boolean(blocker) || activeContacts}
            >
              <ScanSearch aria-hidden /> Find contacts on website
            </Button>
            <Button variant="text" size="sm" onClick={onRefresh} disabled={Boolean(blocker)}>
              <RefreshCw aria-hidden /> Refresh
            </Button>
          </div>
        ) : null}
      </CardHeader>
      <CardContent className="flex min-w-0 flex-col gap-3">
        {/* The newest run's status: announced when it changes (queued, running, completed). */}
        <LiveAnnouncement
          data-testid="enrichment-live-region"
          message={
            rows[0]
              ? `${rows[0].kind === "email_check" ? "Email check" : "Contact collection"} ${rows[0].status}`
              : ""
          }
        />
        {canRun && blocker ? <p className="text-muted-foreground text-xs">{blocker}</p> : null}
        {runs.isPending ? (
          <Skeleton className="h-16" />
        ) : runs.isError ? (
          <ErrorState
            title="Could not load contact collection runs"
            message={friendlyMessage(runs.error)}
            requestId={requestIdOf(runs.error)}
            onRetry={() => void runs.refetch()}
          />
        ) : rows.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            No contact collection has run for this business yet.
            {canRun && !blocker ? " Find contacts on website to collect them with evidence." : ""}
          </p>
        ) : (
          <ul
            className="divide-border flex min-w-0 flex-col divide-y"
            aria-label="Contact collection runs"
          >
            {rows.slice(0, 5).map((r) => (
              <RunItem key={r.id} run={r} />
            ))}
          </ul>
        )}
        <p className="text-muted-foreground border-border border-t pt-3 text-xs">
          Source: the business website{detail.website.domain ? ` (${detail.website.domain})` : ""} ·{" "}
          {rows[0]
            ? `last run ${formatDateTime(rows[0].finishedAt ?? rows[0].createdAt)}`
            : "never run"}
        </p>
      </CardContent>
    </Card>
  );
}

/**
 * Refresh: re-collects contacts from the business's own website (free) and re-analyzes it (1
 * credit held, charged on completion, released on failure). Values that came only from another
 * source cannot be collected again this way.
 */
export function RefreshDialog({
  detail,
  open,
  onOpenChange,
}: {
  detail: BusinessDetail;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const refresh = useRefreshBusiness(detail.id);
  const balance = useCreditBalance(open);
  const [error, setError] = useState<unknown>(null);
  useEffect(() => {
    if (!open) setError(null);
  }, [open]);
  const failure = error ? enrichmentRequestError(error) : null;

  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Refresh this business?"
      description={
        <>
          LeadForge collects contacts again from{" "}
          <span className="break-anywhere font-medium">
            {detail.website.domain ?? detail.website.value ?? "its website"}
          </span>{" "}
          and runs a new website analysis.
        </>
      }
      confirmLabel="Refresh (1 credit)"
      loading={refresh.isPending}
      confirmDisabled={Boolean(
        creditShortfall(error) || isBillingBlock(error) || isPendingDeletion(error),
      )}
      onConfirm={() => {
        setError(null);
        refresh.mutate(undefined, {
          onSuccess: (res) => {
            onOpenChange(false);
            toast.success("Refresh started", {
              description: res.analysisAlreadyInProgress
                ? "Contacts are being collected (free). An analysis was already running, so no new credit was held."
                : "Contacts are being collected (free) and 1 credit is held for the website analysis.",
            });
          },
          onError: setError,
        });
      }}
    >
      <ul className="text-muted-foreground flex list-disc flex-col gap-1.5 pl-5 text-sm">
        <li>Collecting contacts from the website is free.</li>
        <li>
          The website analysis holds 1 credit, charged when it completes and released if it fails.
          If one is already running, nothing new is held.
        </li>
        <li>
          Values that came only from another source (a CSV import, a discovery source) are not
          collected again by a refresh.
        </li>
        <li>
          Balance:{" "}
          {balance.data ? `${formatNumber(balance.data.balance)} credits available` : "checking"}
        </li>
      </ul>
      {failure && isBillingBlock(error) ? (
        <BillingBlockBanner error={error} />
      ) : failure ? (
        <Banner
          tone="destructive"
          title={isForbidden(error) ? "Your role cannot refresh businesses" : failure.title}
          description={failure.message}
        />
      ) : null}
    </ConfirmDialog>
  );
}
