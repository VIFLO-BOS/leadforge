"use client";

import type { DiscoveryJob } from "@leadforge/contracts";
import { ArrowLeft, Ban, RotateCcw, SearchX } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import {
  Banner,
  Breadcrumbs,
  Button,
  ConfirmDialog,
  EmptyState,
  ErrorState,
  JobStatus,
  PageHeader,
  Skeleton,
  toast,
} from "@leadforge/ui";
import { renderBreadcrumbLink } from "@/components/app/businesses/shared";
import { isApiError } from "@/lib/api";
import {
  DISCOVERY_STATUS_LABELS,
  isDiscoveryActive,
  isDiscoveryTerminal,
  issueLabel,
  specSummary,
} from "@/lib/discovery";
import { creditShortfall, friendlyMessage, requestIdOf } from "@/lib/errors";
import { isPendingDeletion } from "@/lib/org-lifecycle";
import { PENDING_DELETION_TITLE } from "@/components/app/pending-deletion-notice";
import { formatNumber, formatRelative, plural } from "@/lib/format";
import {
  useCancelDiscoveryJob,
  useDiscoveryJob,
  useDiscoverySources,
  useRetryFailedItems,
} from "@/lib/hooks/use-discovery";
import { usePermissions } from "@/lib/hooks/use-permissions";
import { jobState } from "@/lib/labels";
import { JobItemsTable } from "./job-items-table";
import {
  CreditsPanel,
  IssuesPanel,
  JobDetailsPanel,
  ProgressPanel,
  SourceOutcomesPanel,
} from "./job-panels";

export function JobDetailSkeleton() {
  return (
    <div
      className="flex flex-col gap-6"
      role="status"
      aria-busy="true"
      aria-label="Loading discovery job"
    >
      <Skeleton className="h-4 w-40" />
      <div className="flex flex-col gap-2">
        <Skeleton className="h-8 w-72 max-w-full" />
        <Skeleton className="h-4 w-96 max-w-full" />
      </div>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <Skeleton className="h-64 rounded-lg" />
        <Skeleton className="h-64 rounded-lg" />
      </div>
      <Skeleton className="h-72 rounded-lg" />
    </div>
  );
}

function isNotFound(err: unknown): boolean {
  return isApiError(err) && (err.status === 404 || err.code === "VALIDATION_FAILED");
}

/** One sentence for the polite live region and the visible status line. */
export function statusSentence(job: DiscoveryJob): string {
  const label = DISCOVERY_STATUS_LABELS[job.status];
  if (job.status === "running" && job.cancelRequested)
    return "Running: cancel requested, stopping before the next page.";
  if (job.status === "queued") return "Queued: waiting for a worker.";
  if (job.status === "running")
    return `Running: ${plural(job.progress.processed, "item", "items")} processed so far.`;
  if (isDiscoveryTerminal(job) && !job.credits.settled) return `${label}. Settling credits.`;
  if (job.status === "completed" || job.status === "completed_with_warnings") {
    return `${label}: ${formatNumber(job.progress.created)} new, ${formatNumber(job.progress.updated)} updated, ${formatNumber(job.credits.captured)} credits charged.`;
  }
  return `${label}.`;
}

/**
 * Announces status changes (not the first render) in a polite live region. Progress counts are
 * not announced on every poll; only the status, a cancel request and settlement are.
 */
function useStatusAnnouncement(job: DiscoveryJob | undefined): string {
  const [message, setMessage] = useState("");
  const last = useRef<string | null>(null);
  const signature = job
    ? `${job.status}|${job.cancelRequested}|${job.credits.settled}|${job.round}`
    : null;
  useEffect(() => {
    if (!job || signature === null) return;
    if (last.current !== null && last.current !== signature) setMessage(statusSentence(job));
    last.current = signature;
    // Announce on signature changes only, not on every poll.
  }, [signature]);
  return message;
}

/**
 * Discovery job detail (/app/discovery/[id]): status with cancel and retry-failed, live progress
 * polled every 2 seconds until the job is finished and its credits are settled, the credit hold,
 * the items table, source outcomes, job errors and the attribution the results require.
 */
export function DiscoveryJobDetail({ id }: { id: string }) {
  const job = useDiscoveryJob(id);
  const announcement = useStatusAnnouncement(job.data);

  if (job.isPending) return <JobDetailSkeleton />;
  if (job.isError && !job.data) {
    if (isNotFound(job.error)) {
      return (
        <div className="flex flex-col gap-6">
          <Breadcrumbs
            items={[{ label: "Discovery", href: "/app/discovery" }, { label: "Not found" }]}
            renderLink={renderBreadcrumbLink}
          />
          <PageHeader title="Discovery job not found" />
          <EmptyState
            icon={SearchX}
            title="We could not find this discovery job"
            description="The link may be wrong, or the job belongs to another workspace. Switch workspace from the top bar if you expected to see it."
            action={
              <Button asChild>
                <Link href="/app/discovery">
                  <ArrowLeft aria-hidden /> Back to discovery jobs
                </Link>
              </Button>
            }
          />
        </div>
      );
    }
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title="Discovery job" />
        <ErrorState
          title="Could not load this discovery job"
          message={friendlyMessage(job.error)}
          requestId={requestIdOf(job.error)}
          onRetry={() => void job.refetch()}
        />
      </div>
    );
  }

  return (
    <JobView
      job={job.data}
      announcement={announcement}
      refreshError={job.isError ? job.error : null}
      lastUpdated={job.dataUpdatedAt}
    />
  );
}

function JobView({
  job,
  announcement,
  refreshError,
  lastUpdated,
}: {
  job: DiscoveryJob;
  announcement: string;
  refreshError: unknown;
  lastUpdated: number;
}) {
  const { can } = usePermissions();
  const canRun = can("discovery:run");
  const sources = useDiscoverySources();
  const cancel = useCancelDiscoveryJob(job.id);
  const retry = useRetryFailedItems(job.id);
  const [confirm, setConfirm] = useState<"cancel" | "retry" | null>(null);
  const active = isDiscoveryActive(job);
  const canCancel = canRun && active && !job.cancelRequested;
  const canRetry =
    canRun && isDiscoveryTerminal(job) && job.credits.settled && job.retryableItems > 0;

  const doCancel = () =>
    cancel.mutate(undefined, {
      onSuccess: (j) => {
        setConfirm(null);
        toast.success(j.status === "cancelled" ? "Job cancelled" : "Cancel requested", {
          description:
            j.status === "cancelled"
              ? "Nothing ran, and the whole hold was released."
              : "The job stops before its next page. Records already produced are charged; the rest of the hold is released.",
        });
      },
      onError: (err) => {
        setConfirm(null);
        toast.error(
          isApiError(err) && err.code === "JOB_NOT_CANCELLABLE"
            ? "This job already finished"
            : "Could not cancel the job",
          { description: friendlyMessage(err) },
        );
      },
    });

  const doRetry = () =>
    retry.mutate(undefined, {
      onSuccess: () => {
        setConfirm(null);
        toast.success("Failed items queued again", {
          description: "Progress for the retry round appears below.",
        });
      },
      onError: (err) => {
        setConfirm(null);
        const shortfall = creditShortfall(err);
        toast.error(
          isApiError(err) && err.code === "JOB_NOT_RETRYABLE"
            ? "Nothing to retry right now"
            : isPendingDeletion(err)
              ? PENDING_DELETION_TITLE
              : shortfall
                ? "Not enough credits to retry"
                : "Could not retry the failed items",
          { description: friendlyMessage(err) },
        );
      },
    });

  const failed = job.status === "failed";
  const firstError = job.errors[0];

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <PageHeader
        breadcrumbs={
          <Breadcrumbs
            items={[{ label: "Discovery", href: "/app/discovery" }, { label: job.name }]}
            renderLink={renderBreadcrumbLink}
          />
        }
        eyebrow={
          <span className="flex flex-wrap items-center gap-2">
            Discovery job
            <JobStatus state={jobState(job.status)} variant="badge" data-testid="job-status" />
          </span>
        }
        title={job.name}
        description={specSummary(job.spec)}
        actions={
          canCancel || canRetry ? (
            <>
              {canRetry ? (
                <Button variant="outline" onClick={() => setConfirm("retry")}>
                  <RotateCcw aria-hidden /> Retry{" "}
                  {plural(job.retryableItems, "failed item", "failed items")}
                </Button>
              ) : null}
              {canCancel ? (
                <Button variant="outline" onClick={() => setConfirm("cancel")}>
                  <Ban aria-hidden /> Cancel job
                </Button>
              ) : null}
            </>
          ) : undefined
        }
      />

      <div className="flex min-w-0 flex-col gap-1">
        <p className="text-sm" data-testid="job-status-line">
          {statusSentence(job)}
        </p>
        <p className="text-muted-foreground text-xs">
          Updated {formatRelative(new Date(lastUpdated).toISOString())}
          {active || !job.credits.settled ? " · refreshing every 2 seconds" : ""}
        </p>
        <p className="sr-only" aria-live="polite" aria-atomic="true" data-testid="job-live-region">
          {announcement}
        </p>
      </div>

      {failed && firstError ? (
        <Banner
          tone="destructive"
          title={`This job failed: ${issueLabel(firstError.code)}`}
          description={firstError.message}
        />
      ) : null}
      {refreshError ? (
        <Banner
          tone="warning"
          title="Could not refresh this job"
          description={`${friendlyMessage(refreshError)} Showing the last loaded state; retrying automatically.`}
        />
      ) : null}

      <div className="grid min-w-0 grid-cols-1 gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <ProgressPanel job={job} />
        <CreditsPanel job={job} canSeeLedger={can("usage:read")} />
      </div>

      <JobItemsTable job={job} sources={sources.data} />

      <div className="grid min-w-0 grid-cols-1 items-start gap-4 lg:grid-cols-3">
        <SourceOutcomesPanel job={job} sources={sources.data} />
        <IssuesPanel job={job} sources={sources.data} />
        <JobDetailsPanel job={job} sources={sources.data} />
      </div>

      <ConfirmDialog
        open={confirm === "cancel"}
        onOpenChange={(o) => !o && setConfirm(null)}
        title="Cancel this discovery job?"
        description={
          job.status === "queued"
            ? "It has not started, so it is cancelled at once and the whole credit hold is released."
            : "It stops before fetching its next page. Records it already produced stay and are charged; the rest of the hold is released."
        }
        confirmLabel="Cancel job"
        cancelLabel="Keep running"
        destructive
        loading={cancel.isPending}
        onConfirm={doCancel}
      />
      <ConfirmDialog
        open={confirm === "retry"}
        onOpenChange={(o) => !o && setConfirm(null)}
        title={`Retry ${plural(job.retryableItems, "failed item", "failed items")}?`}
        description={`They are fetched again from the source as round ${job.round + 1}. Up to ${plural(job.retryableItems, "credit is", "credits are")} held; only items that succeed are charged.`}
        confirmLabel="Retry failed items"
        loading={retry.isPending}
        onConfirm={doRetry}
      />
    </div>
  );
}
