"use client";

import type { ImportJob } from "@leadforge/contracts";
import type { ColumnDef } from "@tanstack/react-table";
import { FileClock } from "lucide-react";
import Link from "next/link";
import { DataTable, EmptyState, ErrorState, Heading, HeadingLevel, JobStatus } from "@leadforge/ui";
import { friendlyMessage, requestIdOf } from "@/lib/errors";
import { formatDateTime, formatNumber } from "@/lib/format";
import { useRecentImports } from "@/lib/hooks/use-imports";
import { IMPORT_STATUS_LABELS, importJobState } from "@/lib/labels";
import { CellBox } from "../shared";

const columns: ColumnDef<ImportJob>[] = [
  {
    id: "file",
    header: "File",
    meta: { label: "File", mobileTitle: true },
    cell: ({ row }) => (
      <CellBox width="15rem">
        <Link
          href={`/app/businesses/import?id=${row.original.id}`}
          className="rounded-xs hover:text-primary font-medium hover:underline"
        >
          {row.original.fileName}
        </Link>
      </CellBox>
    ),
  },
  {
    id: "status",
    header: "Status",
    meta: { label: "Status" },
    cell: ({ row }) => (
      <JobStatus
        state={importJobState(row.original.status)}
        label={IMPORT_STATUS_LABELS[row.original.status]}
        size="sm"
      />
    ),
  },
  {
    id: "rows",
    header: "Rows",
    meta: { label: "Rows", align: "end" },
    cell: ({ row }) => formatNumber(row.original.rowCount),
  },
  {
    id: "results",
    header: "Created · updated · failed",
    meta: { label: "Created · updated · failed", align: "end" },
    cell: ({ row }) => {
      const p = row.original.progress;
      return row.original.status === "uploaded" ? (
        <span className="text-muted-foreground">Not imported</span>
      ) : (
        <span className="whitespace-nowrap">
          {formatNumber(p.created)} · {formatNumber(p.updated)} · {formatNumber(p.failed)}
        </span>
      );
    },
  },
  {
    id: "uploaded",
    header: "Uploaded",
    meta: { label: "Uploaded" },
    cell: ({ row }) => (
      <time dateTime={row.original.createdAt} className="text-muted-foreground whitespace-nowrap">
        {formatDateTime(row.original.createdAt)}
      </time>
    ),
  },
];

/** The ten newest imports in this workspace (GET /imports). */
export function RecentImports() {
  const imports = useRecentImports(10);
  return (
    <section aria-labelledby="recent-imports-title" className="flex min-w-0 flex-col gap-3">
      <Heading id="recent-imports-title" className="text-base font-medium">
        Recent imports
      </Heading>
      <HeadingLevel>
        <DataTable
          caption="Recent imports"
          columns={columns}
          data={imports.data?.data ?? []}
          getRowId={(j) => j.id}
          loading={imports.isPending}
          skeletonRows={3}
          mobileCards
          enableDensityToggle={false}
          enableColumnVisibility={false}
          error={
            imports.isError ? (
              <ErrorState
                title="Could not load recent imports"
                message={friendlyMessage(imports.error)}
                requestId={requestIdOf(imports.error)}
                onRetry={() => void imports.refetch()}
              />
            ) : undefined
          }
          empty={
            <EmptyState
              size="compact"
              icon={FileClock}
              title="No imports yet"
              description="Files you upload appear here with their status and results for 30 days."
            />
          }
        />
      </HeadingLevel>
    </section>
  );
}
