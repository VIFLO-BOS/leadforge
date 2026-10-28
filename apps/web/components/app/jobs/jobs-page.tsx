"use client";

import {
  JobKind,
  JobListQuery,
  JobStatus as JobStatusEnum,
  PAGE_SIZE_DEFAULT,
  type JobSummary,
} from "@leadforge/contracts";
import type { ColumnDef } from "@tanstack/react-table";
import { SearchX, Workflow } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import {
  Badge,
  Button,
  DataTable,
  EmptyState,
  ErrorState,
  FilterBar,
  FilterMenu,
  JobStatus,
  MEDIA,
  PageHeader,
  Pagination,
  useMediaQuery,
  type ActiveFilter,
} from "@leadforge/ui";
import { CellBox } from "@/components/app/businesses/shared";
import { DISCOVERY_STATUS_LABELS } from "@/lib/discovery";
import { friendlyMessage, isForbidden, requestIdOf } from "@/lib/errors";
import { formatDate, formatNumber, formatRelative } from "@/lib/format";
import { useAllJobs } from "@/lib/hooks/use-credits";
import { usePermissions } from "@/lib/hooks/use-permissions";
import { useUrlState } from "@/lib/hooks/use-url-state";
import { jobKindLabel, jobState } from "@/lib/labels";

type Kind = JobSummary["kind"];
type Status = JobSummary["status"];

interface JobsState {
  kind: Kind[];
  status: Status[];
  pageSize: number;
}

const PAGE_SIZES = [25, 50, 100] as const;

export function parseJobsParams(params: URLSearchParams): JobsState {
  const raw: Record<string, unknown> = {};
  for (const key of ["kind", "status"] as const) {
    const values = params.getAll(key).filter(Boolean);
    if (values.length) raw[key] = values;
  }
  const pageSize = params.get("pageSize");
  if (pageSize) raw.pageSize = pageSize;
  let parsed = JobListQuery.safeParse(raw);
  for (let i = 0; !parsed.success && i < 5; i++) {
    for (const issue of parsed.error.issues) delete raw[String(issue.path[0])];
    parsed = JobListQuery.safeParse(raw);
  }
  const q = parsed.success ? parsed.data : { kind: [], status: [], pageSize: PAGE_SIZE_DEFAULT };
  return {
    kind: q.kind ?? [],
    status: q.status ?? [],
    pageSize: PAGE_SIZES.includes(q.pageSize as 25) ? q.pageSize : PAGE_SIZE_DEFAULT,
  };
}

export function serializeJobsState(state: JobsState): URLSearchParams {
  const out = new URLSearchParams();
  for (const k of state.kind) out.append("kind", k);
  for (const s of state.status) out.append("status", s);
  if (state.pageSize !== PAGE_SIZE_DEFAULT) out.set("pageSize", String(state.pageSize));
  return out;
}

/**
 * Dashboard routes this build implements. The API gives every job an `href`: discovery jobs,
 * imports (the directory filtered by import), website analyses and enrichment runs (the business).
 * A job whose page has not shipped yet is listed without a link rather than linking to a dead
 * route.
 */
export function hasJobPage(href: string): boolean {
  const [path = "", query] = href.split("?", 2);
  if (/^\/app\/discovery\/[a-f0-9]{24}$/i.test(path)) return query === undefined;
  if (/^\/app\/analysis\/[a-f0-9]{24}$/i.test(path)) return query === undefined;
  if (/^\/app\/jobs\/(exports|bulk)\/[a-f0-9]{24}$/i.test(path)) return query === undefined;
  if (path === "/app/analysis") return true;
  return path === "/app/businesses" || /^\/app\/businesses\/[a-f0-9]{24}$/i.test(path);
}

function JobName({ job }: { job: JobSummary }) {
  return (
    <CellBox width="17rem" className="flex flex-col gap-0.5">
      {hasJobPage(job.href) ? (
        <Link
          href={job.href}
          className="text-foreground hover:text-primary rounded-xs break-words font-medium hover:underline"
        >
          {job.name}
        </Link>
      ) : (
        <span
          className="break-words font-medium"
          title="This job's page arrives in a later release"
        >
          {job.name}
        </span>
      )}
      {!hasJobPage(job.href) ? (
        <span className="text-muted-foreground text-xs">Detail page coming soon</span>
      ) : null}
    </CellBox>
  );
}

export function jobProgress(job: JobSummary): string {
  const p = job.progress;
  const done =
    p.total !== null
      ? `${formatNumber(p.processed)} of ${formatNumber(p.total)} processed`
      : `${formatNumber(p.processed)} processed`;
  return p.failed ? `${done} · ${formatNumber(p.failed)} failed` : done;
}

const COLUMNS: ColumnDef<JobSummary>[] = [
  {
    id: "name",
    header: "Job",
    meta: { mobileTitle: true },
    cell: ({ row }) => <JobName job={row.original} />,
  },
  {
    id: "kind",
    header: "Kind",
    cell: ({ row }) => <Badge variant="neutral">{jobKindLabel(row.original.kind)}</Badge>,
  },
  {
    id: "status",
    header: "Status",
    cell: ({ row }) => (
      <CellBox width="11rem">
        <JobStatus
          state={jobState(row.original.status)}
          size="sm"
          title={`Status reported by the ${jobKindLabel(row.original.kind).toLowerCase()} job: ${row.original.kindStatus}`}
        />
      </CellBox>
    ),
  },
  {
    id: "progress",
    header: "Progress",
    cell: ({ row }) => (
      <CellBox width="12rem" className="tabular-nums">
        {jobProgress(row.original)}
      </CellBox>
    ),
  },
  {
    id: "created",
    header: "Created",
    cell: ({ row }) => (
      <CellBox width="8rem" className="flex flex-col gap-0.5">
        <span>{formatDate(row.original.createdAt)}</span>
        <span className="text-muted-foreground text-xs">
          {formatRelative(row.original.createdAt)}
        </span>
      </CellBox>
    ),
  },
  {
    id: "finished",
    header: "Finished",
    cell: ({ row }) => (
      <CellBox width="8rem" className="flex flex-col gap-0.5">
        {row.original.finishedAt ? (
          <>
            <span>{formatDate(row.original.finishedAt)}</span>
            <span className="text-muted-foreground text-xs">
              {formatRelative(row.original.finishedAt)}
            </span>
          </>
        ) : (
          <span className="text-muted-foreground">
            {row.original.startedAt ? "Still running" : "Not started"}
          </span>
        )}
      </CellBox>
    ),
  },
];

function JobCard({ job }: { job: JobSummary }) {
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <JobName job={job} />
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <Badge variant="neutral">{jobKindLabel(job.kind)}</Badge>
        <JobStatus state={jobState(job.status)} size="sm" />
      </div>
      <p className="text-[13px] tabular-nums">{jobProgress(job)}</p>
      <p className="text-muted-foreground text-xs">Created {formatDate(job.createdAt)}</p>
    </div>
  );
}

/**
 * All background jobs (/app/jobs): discovery jobs, CSV imports, website analyses and enrichment
 * runs with statuses normalized across kinds. Each links to its own page where one exists.
 */
export function JobsPage() {
  const { can } = usePermissions();
  const compact = useMediaQuery(MEDIA.belowMd);
  const [state, setState] = useUrlState(parseJobsParams, serializeJobsState);
  const viewKey = JSON.stringify(state);
  const [pager, setPager] = useState<{ key: string; cursors: (string | null)[] }>({
    key: viewKey,
    cursors: [null],
  });
  const cursors = pager.key === viewKey ? pager.cursors : [null];
  const cursor = cursors[cursors.length - 1] ?? null;
  const list = useAllJobs({
    kind: state.kind.length ? state.kind : undefined,
    status: state.status.length ? state.status : undefined,
    pageSize: state.pageSize,
    cursor: cursor ?? undefined,
  });
  const rows = list.data?.data ?? [];
  const filtered = state.kind.length > 0 || state.status.length > 0;
  const set = (next: Partial<JobsState>) => setState({ ...state, ...next });
  const listError = list.isError && !list.data ? list.error : null;
  const appearance = compact ? "field" : "chip";

  const applied: ActiveFilter[] = [
    ...state.kind.map((k) => ({
      id: `kind-${k}`,
      label: `Kind: ${jobKindLabel(k)}`,
      onRemove: () => set({ kind: state.kind.filter((x) => x !== k) }),
    })),
    ...state.status.map((s) => ({
      id: `status-${s}`,
      label: `Status: ${DISCOVERY_STATUS_LABELS[s]}`,
      onRemove: () => set({ status: state.status.filter((x) => x !== s) }),
    })),
  ];

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <PageHeader
        eyebrow="Automation"
        title="Background jobs"
        description="Discovery jobs, CSV imports, website analyses, contact collection, exports and bulk operations, newest first. Statuses use one vocabulary across every kind."
        actions={
          can("discovery:run") ? (
            <Button asChild variant="outline">
              <Link href="/app/discovery/new">Create discovery job</Link>
            </Button>
          ) : undefined
        }
      />
      <DataTable
        caption="Background jobs"
        columns={COLUMNS}
        data={rows}
        getRowId={(r) => `${r.kind}-${r.id}`}
        loading={list.isPending}
        skeletonRows={6}
        error={
          listError ? (
            <ErrorState
              title={isForbidden(listError) ? "You cannot view jobs" : "Could not load jobs"}
              message={friendlyMessage(listError)}
              requestId={requestIdOf(listError)}
              onRetry={isForbidden(listError) ? undefined : () => void list.refetch()}
            />
          ) : undefined
        }
        empty={
          filtered ? (
            <EmptyState
              size="compact"
              icon={SearchX}
              title="No jobs match"
              description="Try another kind or status."
              action={
                <Button variant="outline" onClick={() => set({ kind: [], status: [] })}>
                  Clear filters
                </Button>
              }
            />
          ) : (
            <EmptyState
              icon={Workflow}
              title="No background jobs yet"
              description="Discovery jobs, CSV imports, website analyses, contact collection runs, exports and bulk operations appear here while they run and after they finish."
              action={
                can("discovery:run") ? (
                  <Button asChild>
                    <Link href="/app/discovery/new">Create discovery job</Link>
                  </Button>
                ) : undefined
              }
            />
          )
        }
        mobileCards={{ render: (row) => <JobCard job={row} /> }}
        toolbar={
          <div className="flex min-w-0 flex-col gap-2">
            <FilterBar
              filters={applied}
              onClearAll={applied.length ? () => set({ kind: [], status: [] }) : undefined}
              sheetTitle="Filter jobs"
            >
              <FilterMenu
                label="Kind"
                appearance={appearance}
                sections={[
                  {
                    id: "kind",
                    type: "multiple",
                    options: JobKind.options.map((k) => ({ value: k, label: jobKindLabel(k) })),
                    value: state.kind,
                    onValueChange: (v) => set({ kind: v as Kind[] }),
                  },
                ]}
              />
              <FilterMenu
                label="Status"
                appearance={appearance}
                sections={[
                  {
                    id: "status",
                    type: "multiple",
                    options: JobStatusEnum.options.map((s) => ({
                      value: s,
                      label: DISCOVERY_STATUS_LABELS[s],
                    })),
                    value: state.status,
                    onValueChange: (v) => set({ status: v as Status[] }),
                  },
                ]}
              />
            </FilterBar>
            <p className="text-muted-foreground min-w-0 text-xs" aria-live="polite">
              {list.isPending
                ? "Loading jobs"
                : rows.length
                  ? `Newest first · updated ${formatRelative(new Date(list.dataUpdatedAt).toISOString())}`
                  : null}
            </p>
          </div>
        }
        footer={
          listError || (rows.length === 0 && cursors.length === 1) ? null : (
            <Pagination
              hasPrevious={cursors.length > 1}
              hasNext={Boolean(list.data?.meta.nextCursor)}
              onPrevious={() => setPager({ key: viewKey, cursors: cursors.slice(0, -1) })}
              onNext={() => {
                const next = list.data?.meta.nextCursor;
                if (next) setPager({ key: viewKey, cursors: [...cursors, next] });
              }}
              pageSize={state.pageSize}
              pageSizeOptions={[...PAGE_SIZES]}
              onPageSizeChange={(pageSize) => set({ pageSize })}
              pageCount={rows.length}
              loading={list.isFetching && list.isPlaceholderData}
              itemLabel="jobs"
            />
          )
        }
      />
      <p className="text-muted-foreground text-xs">
        Scheduled jobs arrive in a later release. Exports are listed for the person who requested
        them and for owners and administrators.
      </p>
    </div>
  );
}
