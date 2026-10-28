"use client";

import type { CreateExportRequest, ExportJob } from "@leadforge/contracts";
import { ArrowLeft, Download, FileArchive, RotateCcw, SearchX, TimerOff } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";
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
  LiveAnnouncement,
  PageHeader,
  Progress,
  Skeleton,
} from "@leadforge/ui";
import { renderBreadcrumbLink } from "@/components/app/businesses/shared";
import { isApiError } from "@/lib/api";
import { licenseAnchor } from "@/lib/data-licenses";
import { friendlyMessage, requestIdOf } from "@/lib/errors";
import {
  DOWNLOAD_LINK_MINUTES,
  EXPORT_RETENTION_DAYS,
  EXPORT_STATUS_LABELS,
  downloadErrorMessage,
  exportJobState,
  exportSelectionLabel,
  isExportActive,
} from "@/lib/exports";
import { formatBytes, formatDateTime, formatNumber, formatRelative, plural } from "@/lib/format";
import { useDownloadExport, useExportJob } from "@/lib/hooks/use-exports";
import { ExportDialog } from "./export-dialog";

/** Said once per status change. */
export function exportAnnouncement(job: ExportJob | undefined): string {
  if (!job) return "";
  switch (job.status) {
    case "queued":
      return "Export queued.";
    case "running":
      return "Building the export file.";
    case "completed":
      return `Export ready to download: ${plural(job.rowCount ?? 0, "row", "rows")}.`;
    case "failed":
      return "The export failed.";
    case "expired":
      return "The export file has expired.";
    default:
      return "";
  }
}

/** The same export again (lists and directory filters; a past selection's ids are not kept). */
function againRequest(job: ExportJob): CreateExportRequest | null {
  if (job.kind === "list" && job.selection.listId)
    return { kind: "list", listId: job.selection.listId, columns: job.columns };
  if (job.kind === "directory" && job.selection.filter)
    return { kind: "directory", filter: job.selection.filter, columns: job.columns };
  return null;
}

/**
 * One export (/app/jobs/exports/[id]): polls every 2 s while queued or running, then offers the
 * ZIP. Download asks for a fresh signed link (valid 15 minutes, bound to you, this workspace and
 * this export) and sends the browser to it. Explains not-ready, expired and invalid-link states,
 * including `?downloadError=<code>` when a link failed after the browser opened it.
 */
export function ExportJobPage({
  id,
  navigate,
}: {
  id: string;
  /** Where the browser goes for the download (tests pass a spy); defaults to location.assign. */
  navigate?: (url: string) => void;
}) {
  const job = useExportJob(id);
  const params = useSearchParams();
  const download = useDownloadExport(navigate);
  const [againOpen, setAgainOpen] = useState(false);
  const j = job.data;
  const announcement = useMemo(() => exportAnnouncement(j), [j?.status]);
  const linkError = params.get("downloadError");

  if (job.isPending) {
    return (
      <div
        role="status"
        aria-busy="true"
        aria-label="Loading export"
        className="flex flex-col gap-6"
      >
        <Skeleton className="h-4 w-40" />
        <Skeleton className="h-8 w-72 max-w-full" />
        <Skeleton className="h-48 rounded-lg" />
      </div>
    );
  }
  if (job.isError && !j) {
    const notFound =
      isApiError(job.error) && (job.error.status === 404 || job.error.code === "VALIDATION_FAILED");
    return (
      <div className="flex flex-col gap-6">
        <Breadcrumbs
          items={[{ label: "Background jobs", href: "/app/jobs" }, { label: "Not found" }]}
          renderLink={renderBreadcrumbLink}
        />
        <PageHeader title={notFound ? "Export not found" : "Export"} />
        {notFound ? (
          <EmptyState
            icon={SearchX}
            title="We could not find this export"
            description="The link may be wrong, the export belongs to someone else, or it is in another workspace. You can see your own exports; owners and administrators see everyone's."
            action={
              <Button asChild>
                <Link href="/app/jobs?kind=export">
                  <ArrowLeft aria-hidden /> All exports
                </Link>
              </Button>
            }
          />
        ) : (
          <ErrorState
            title="Could not load the export"
            message={friendlyMessage(job.error)}
            requestId={requestIdOf(job.error)}
            onRetry={() => void job.refetch()}
          />
        )}
      </div>
    );
  }

  const e = j!;
  const active = isExportActive(e);
  const ready = e.status === "completed" && Boolean(e.file?.available);
  const again = againRequest(e);
  const downloadCode = isApiError(download.error) ? download.error.code : null;
  const problem = downloadErrorMessage(downloadCode) ?? downloadErrorMessage(linkError);

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <PageHeader
        breadcrumbs={
          <Breadcrumbs
            items={[{ label: "Background jobs", href: "/app/jobs" }, { label: "Export" }]}
            renderLink={renderBreadcrumbLink}
          />
        }
        eyebrow="Export"
        title={`Export of ${exportSelectionLabel(e)
          .replace(/^List/, "list")
          .replace(/^Directory/, "directory")}`}
        description={`Requested ${formatDateTime(e.createdAt)}. A ZIP with the CSV, ATTRIBUTION.txt and the licences of the open data it contains.`}
        actions={
          <>
            {ready ? (
              <Button
                loading={download.isPending}
                onClick={() => download.mutate(e.id)}
                data-testid="export-download"
              >
                <Download aria-hidden /> Download ZIP
              </Button>
            ) : null}
            {again && (e.status === "expired" || e.status === "failed") ? (
              <Button variant={ready ? "outline" : "primary"} onClick={() => setAgainOpen(true)}>
                <RotateCcw aria-hidden /> Export again
              </Button>
            ) : null}
          </>
        }
      />
      <LiveAnnouncement message={announcement} data-testid="export-announcer" />

      {problem ? (
        <Banner
          tone="warning"
          title="The download did not start"
          description={problem}
          data-testid="download-problem"
        />
      ) : download.isError ? (
        <ErrorState
          title="Could not get a download link"
          message={friendlyMessage(download.error)}
          requestId={requestIdOf(download.error)}
        />
      ) : null}
      {e.status === "failed" ? (
        <Banner
          tone="destructive"
          title="The export failed"
          description={`${e.error?.message ?? "The file could not be built."}${again ? " Export again to retry." : " Select the businesses again in the directory to retry."}`}
        />
      ) : e.status === "expired" || (e.status === "completed" && e.file && !e.file.available) ? (
        <Banner
          tone="info"
          icon={TimerOff}
          title="This export has expired"
          description={`Files are deleted ${EXPORT_RETENTION_DAYS} days after they are built.${again ? " Export again for a fresh file." : ""}`}
        />
      ) : null}
      {e.truncated ? (
        <Banner
          tone="warning"
          title="Stopped at the row limit"
          description={`More businesses matched when the file was built than this workspace's limit of ${formatNumber(e.rowCap)} rows, so the file has the first ${formatNumber(e.rowCount ?? e.rowCap)}. Narrow the filters or split the export to get the rest.`}
        />
      ) : null}

      <div className="grid min-w-0 grid-cols-1 items-start gap-4 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
        <Card>
          <CardHeader className="flex-row flex-wrap items-center justify-between gap-2">
            <CardTitle>Status</CardTitle>
            <JobStatus
              state={exportJobState(e.status)}
              label={EXPORT_STATUS_LABELS[e.status]}
              data-testid="export-status"
            />
          </CardHeader>
          <CardContent className="flex min-w-0 flex-col gap-4">
            {active ? (
              <Progress
                label={e.status === "queued" ? "Queued: waiting for a worker" : "Writing rows"}
                value={e.progress.total ? e.progress.processed : undefined}
                max={e.progress.total ?? undefined}
                valueText={
                  e.progress.total
                    ? `${formatNumber(e.progress.processed)} of ${formatNumber(e.progress.total)} rows`
                    : `${formatNumber(e.progress.processed)} rows`
                }
                showLabel
              />
            ) : null}
            <dl className="grid min-w-0 grid-cols-1 gap-3 text-sm min-[480px]:grid-cols-2">
              <Fact label="What">{exportSelectionLabel(e)}</Fact>
              <Fact label="Scope">
                {e.scope === "assigned"
                  ? "Only leads assigned to the requester (sales representative)"
                  : "Everything selected"}
              </Fact>
              <Fact label="Matched when requested">
                {plural(e.matchedAtRequest, "business", "businesses")}
              </Fact>
              <Fact label="Rows in the file">
                {e.rowCount !== null ? formatNumber(e.rowCount) : "Not built yet"}
              </Fact>
              <Fact label="Row limit">{formatNumber(e.rowCap)}</Fact>
              <Fact label="Columns">{e.columns.length}</Fact>
            </dl>
            <p className="text-muted-foreground text-xs">
              Suppressed businesses are never exported.{" "}
              {e.finishedAt
                ? `Finished ${formatRelative(e.finishedAt)}.`
                : "Refreshing every 2 seconds."}
            </p>
          </CardContent>
        </Card>

        <Card data-testid="export-file">
          <CardHeader>
            <CardTitle>File</CardTitle>
            <CardDescription>What the ZIP contains, and how long it is kept.</CardDescription>
          </CardHeader>
          <CardContent className="flex min-w-0 flex-col gap-4">
            {e.file ? (
              <dl className="flex min-w-0 flex-col gap-3 text-sm">
                <Fact label="File">
                  <span className="flex min-w-0 items-center gap-2">
                    <FileArchive aria-hidden className="text-muted-foreground size-4 shrink-0" />
                    <span className="break-anywhere font-mono text-[13px]">{e.file.name}</span>
                  </span>
                </Fact>
                <Fact label="Size">{formatBytes(e.file.bytes)}</Fact>
                <Fact label="SHA-256">
                  <CopyableValue value={e.file.sha256} label="SHA-256 checksum" />
                </Fact>
                <Fact label={e.file.available ? "Deleted on" : "Deleted"}>
                  {formatDateTime(e.file.expiresAt)}
                </Fact>
              </dl>
            ) : (
              <p className="text-muted-foreground text-sm">
                {active ? "The file appears here when it is built." : "No file was built."}
              </p>
            )}
            <div className="flex min-w-0 flex-col gap-1.5 text-sm">
              <p className="font-medium">Inside the ZIP</p>
              <ul className="text-muted-foreground flex list-disc flex-col gap-1 pl-5">
                <li>The businesses as a CSV (UTF-8, spreadsheet formulas neutralized).</li>
                <li>
                  <span className="text-foreground font-mono text-[13px]">ATTRIBUTION.txt</span>:
                  the sources, the attribution every dataset requires, what LeadForge changed, and
                  the disclaimer.
                </li>
                <li>
                  {e.file?.licenses.length ? (
                    <>
                      <span className="text-foreground font-mono text-[13px]">LICENSES/</span>: the
                      licence texts that apply (
                      {e.file.licenses.map((l, i) => (
                        <span key={l}>
                          {i > 0 ? ", " : ""}
                          <Link href={licenseAnchor(l)} className="link-inline rounded-xs">
                            {l}
                          </Link>
                        </span>
                      ))}
                      ).
                    </>
                  ) : (
                    <>
                      <span className="text-foreground font-mono text-[13px]">LICENSES/</span>:
                      licence texts, when rows carry open data (none for this file).
                    </>
                  )}
                </li>
              </ul>
              <p className="text-muted-foreground text-xs">
                Keep ATTRIBUTION.txt and the licences with the data when you share it. Each download
                uses a new link that works for {DOWNLOAD_LINK_MINUTES} minutes, only for you, in
                this workspace.
              </p>
            </div>
          </CardContent>
        </Card>
      </div>

      {again ? (
        <ExportDialog
          open={againOpen}
          onOpenChange={setAgainOpen}
          request={again}
          what={
            e.kind === "list"
              ? `the list “${e.selection.listName ?? "list"}” again`
              : "the same directory filters again"
          }
        />
      ) : null}
    </div>
  );
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <dt className="text-muted-foreground text-xs">{label}</dt>
      <dd className="min-w-0 break-words">{children}</dd>
    </div>
  );
}
