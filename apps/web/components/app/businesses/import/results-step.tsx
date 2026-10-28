"use client";

import type { ImportJob, ImportRowResult } from "@leadforge/contracts";
import type { ColumnDef } from "@tanstack/react-table";
import { Building2, CircleCheck, FileUp } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import {
  Banner,
  Button,
  DataTable,
  EmptyState,
  ErrorState,
  Heading,
  HeadingLevel,
  JobStatus,
  Pagination,
  Progress,
  Stat,
} from "@leadforge/ui";
import { friendlyMessage, requestIdOf } from "@/lib/errors";
import { formatDate, formatDateTime, formatNumber, formatRelative, plural } from "@/lib/format";
import { useImportRows } from "@/lib/hooks/use-imports";
import { IMPORT_STATUS_LABELS, importJobState } from "@/lib/labels";
import { CellBox } from "../shared";
import { IssueList } from "./review-step";

/** Live progress while the worker processes the import. Values update in place, never animated. */
export function ProgressStep({ job }: { job: ImportJob }) {
  const p = job.progress;
  const queued = job.status === "queued";
  return (
    // Not a live region: counts change on every poll. The wizard announces status transitions.
    <div className="flex min-w-0 flex-col gap-5">
      <div className="flex min-w-0 flex-wrap items-center gap-3">
        <JobStatus state={importJobState(job.status)} label={IMPORT_STATUS_LABELS[job.status]} />
        <span className="text-muted-foreground text-xs">
          {queued
            ? `Queued ${formatRelative(job.queuedAt ?? job.updatedAt)}`
            : `Started ${formatRelative(job.startedAt ?? job.updatedAt)}`}
        </span>
      </div>
      <Progress
        label={`Importing ${job.fileName}`}
        value={queued ? null : p.processed}
        max={p.total || job.rowCount || 1}
        valueText={
          queued
            ? "Waiting for a worker"
            : `${formatNumber(p.processed)} of ${formatNumber(p.total || job.rowCount)} rows (${p.percent}%)`
        }
        showLabel
      />
      <div className="grid min-w-0 grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Created" value={formatNumber(p.created)} />
        <Stat label="Updated" value={formatNumber(p.updated)} />
        <Stat label="Skipped as suppressed" value={formatNumber(p.suppressed)} />
        <Stat label="Failed" value={formatNumber(p.failed)} />
      </div>
      <p className="text-muted-foreground text-sm">
        The import runs in the background in batches of 200 rows. You can leave this page; come back
        from Recent imports to see the results.
      </p>
    </div>
  );
}

const failedColumns = (headers: string[]): ColumnDef<ImportRowResult>[] => [
  {
    id: "row",
    header: "Row",
    meta: { label: "Row", align: "end", cellClassName: "w-16" },
    cell: ({ row }) => <span className="tabular-nums">{row.original.rowNumber}</span>,
  },
  {
    id: "values",
    header: "Values in the file",
    meta: {
      label: "Values in the file",
      mobileTitle: true,
    },
    cell: ({ row }) => {
      const cells = row.original.cells
        .map((c, i) => ({ header: headers[i] || `Column ${i + 1}`, value: c }))
        .filter((c) => c.value.trim());
      return cells.length ? (
        <CellBox width="16rem">
          <dl className="flex flex-col gap-0.5">
            {cells.slice(0, 6).map((c, i) => (
              <div key={i} className="flex min-w-0 gap-1.5">
                <dt className="text-muted-foreground shrink-0 text-xs">{c.header}:</dt>
                <dd className="min-w-0 text-xs">{c.value}</dd>
              </div>
            ))}
          </dl>
          {cells.length > 6 ? (
            <p className="text-muted-foreground text-xs">+{cells.length - 6} more</p>
          ) : null}
        </CellBox>
      ) : (
        <span className="text-muted-foreground">Empty row</span>
      );
    },
  },
  {
    id: "issues",
    header: "Why it failed",
    meta: { label: "Why it failed" },
    cell: ({ row }) => (
      <CellBox width="17rem">
        <IssueList errors={row.original.errors} warnings={row.original.warnings} />
      </CellBox>
    ),
  },
];

function FailedRows({ job }: { job: ImportJob }) {
  const [cursors, setCursors] = useState<(string | undefined)[]>([undefined]);
  const cursor = cursors[cursors.length - 1];
  const rows = useImportRows(job.id, { outcome: "failed", cursor, pageSize: 25 });
  const data = rows.data?.data ?? [];
  return (
    <section aria-labelledby="failed-rows-title" className="flex min-w-0 flex-col gap-3">
      <div className="flex min-w-0 flex-col gap-1">
        <Heading id="failed-rows-title" className="text-base font-medium">
          Failed rows
        </Heading>
        <p className="text-muted-foreground text-sm">
          Row numbers match the spreadsheet (the header is row 1). Fix these rows in the file and
          import it again; rows that already imported will merge instead of duplicating.
        </p>
      </div>
      <HeadingLevel>
        <DataTable
          caption="Failed rows"
          columns={failedColumns(job.headers)}
          data={data}
          getRowId={(r) => String(r.rowNumber)}
          loading={rows.isPending}
          skeletonRows={4}
          mobileCards
          enableDensityToggle={false}
          enableColumnVisibility={false}
          error={
            rows.isError ? (
              <ErrorState
                title="Could not load failed rows"
                message={friendlyMessage(rows.error)}
                requestId={requestIdOf(rows.error)}
                onRetry={() => void rows.refetch()}
              />
            ) : undefined
          }
          empty={
            <EmptyState
              size="compact"
              icon={CircleCheck}
              title="No failed rows"
              description="Every row was created, updated or skipped as suppressed."
            />
          }
          footer={
            data.length || cursors.length > 1 ? (
              <Pagination
                hasPrevious={cursors.length > 1}
                hasNext={Boolean(rows.data?.meta.nextCursor)}
                onPrevious={() => setCursors((c) => c.slice(0, -1))}
                onNext={() => {
                  const next = rows.data?.meta.nextCursor;
                  if (next) setCursors((c) => [...c, next]);
                }}
                pageSize={25}
                pageCount={data.length}
                totalCount={
                  cursors.length === 1 && !rows.data?.meta.nextCursor ? data.length : null
                }
                loading={rows.isFetching && rows.isPlaceholderData}
                itemLabel="failed rows"
              />
            ) : null
          }
        />
      </HeadingLevel>
    </section>
  );
}

/** Final counts, the failed-rows report and next actions. */
export function ResultsStep({
  job,
  onImportAnother,
}: {
  job: ImportJob;
  onImportAnother: () => void;
}) {
  const p = job.progress;
  const imported = p.created + p.updated;
  return (
    <div className="flex min-w-0 flex-col gap-6">
      {job.status === "failed" ? (
        <Banner
          tone="destructive"
          title="The import stopped"
          description={`${job.error?.message ?? "The worker could not finish the import."} ${
            p.processed
              ? `${plural(p.processed, "row was", "rows were")} processed before it stopped and are kept.`
              : ""
          }`}
        />
      ) : job.status === "completed_with_errors" ? (
        <Banner
          tone="warning"
          title={`Imported with ${plural(p.failed, "failed row", "failed rows")}`}
          description="The rows below were not imported. Everything else was."
        />
      ) : (
        <Banner
          tone="success"
          title="Import complete"
          description={`${plural(p.total, "row", "rows")} processed without errors.`}
        />
      )}

      <div className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-2">
        <JobStatus state={importJobState(job.status)} label={IMPORT_STATUS_LABELS[job.status]} />
        <span className="text-muted-foreground break-anywhere text-xs">
          {job.fileName} · finished{" "}
          {job.finishedAt ? formatDateTime(job.finishedAt) : "time unknown"}
        </span>
      </div>

      <Progress
        label="Rows processed"
        value={p.processed}
        max={p.total || 1}
        valueText={`${formatNumber(p.processed)} of ${formatNumber(p.total)} rows`}
        showLabel
        tone={job.status === "failed" ? "destructive" : "primary"}
      />

      <div className="grid min-w-0 grid-cols-1 gap-3 min-[480px]:grid-cols-2 lg:grid-cols-4">
        <Stat label="Created" value={formatNumber(p.created)} hint="New businesses" />
        <Stat
          label="Updated"
          value={formatNumber(p.updated)}
          hint="Merged into existing businesses"
        />
        <Stat
          label="Skipped as suppressed"
          value={formatNumber(p.suppressed)}
          hint="Matched a suppression entry"
        />
        <Stat label="Failed" value={formatNumber(p.failed)} hint="Listed below" />
      </div>

      <div className="flex min-w-0 flex-col gap-2 min-[480px]:flex-row min-[480px]:flex-wrap [&>*]:h-auto [&>*]:min-h-10 [&>*]:whitespace-normal [&>*]:py-2 [&>*]:text-center">
        {imported > 0 ? (
          <Button asChild>
            <Link href={`/app/businesses?importId=${job.id}`}>
              <Building2 aria-hidden /> View imported businesses
            </Link>
          </Button>
        ) : null}
        <Button variant="outline" onClick={onImportAnother}>
          <FileUp aria-hidden /> Import another file
        </Button>
      </div>

      {p.failed > 0 || job.status === "failed" ? <FailedRows job={job} /> : null}

      <p className="text-muted-foreground text-xs">
        Row-level results are kept until {formatDate(job.rowsExpireAt)}. The businesses and their
        provenance stay after that.
      </p>
    </div>
  );
}
