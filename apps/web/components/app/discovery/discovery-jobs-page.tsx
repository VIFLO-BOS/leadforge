"use client";

import type { DiscoveryJob, DiscoverySourceOption } from "@leadforge/contracts";
import type { ColumnDef } from "@tanstack/react-table";
import { Compass, Database, Plus, SearchX } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import {
  Banner,
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
import {
  DISCOVERY_FILTER_STATUSES,
  DISCOVERY_PAGE_SIZES,
  DISCOVERY_STATUS_LABELS,
  discoverySourceName,
  parseDiscoveryListParams,
  serializeDiscoveryListState,
  shouldPollDiscoveryJob,
  specSummary,
  type DiscoveryListState,
} from "@/lib/discovery";
import { friendlyMessage, isForbidden, requestIdOf } from "@/lib/errors";
import { formatDate, formatNumber, formatRelative, plural } from "@/lib/format";
import { useDiscoveryJobs, useDiscoverySources } from "@/lib/hooks/use-discovery";
import { usePermissions } from "@/lib/hooks/use-permissions";
import { useUrlState } from "@/lib/hooks/use-url-state";
import { jobState } from "@/lib/labels";

function JobName({ job }: { job: DiscoveryJob }) {
  return (
    <CellBox width="17rem" className="flex flex-col gap-0.5">
      <Link
        href={`/app/discovery/${job.id}`}
        className="text-foreground hover:text-primary rounded-xs break-words font-medium hover:underline"
      >
        {job.name}
      </Link>
      <span className="text-muted-foreground break-words text-xs">{specSummary(job.spec)}</span>
    </CellBox>
  );
}

function StatusCell({ job }: { job: DiscoveryJob }) {
  return (
    <CellBox width="11rem" className="flex flex-col gap-0.5">
      <JobStatus state={jobState(job.status)} size="sm" />
      {job.cancelRequested && job.status === "running" ? (
        <span className="text-muted-foreground text-xs">Cancel requested</span>
      ) : null}
      {job.round > 0 ? (
        <span className="text-muted-foreground text-xs">Retry round {job.round}</span>
      ) : null}
    </CellBox>
  );
}

/** Real counts from item records; no percentages (the total is not known in advance). */
export function progressLine(job: DiscoveryJob): string {
  const p = job.progress;
  if (p.processed === 0) {
    return job.status === "queued" ? "Waiting to start" : "No items yet";
  }
  const parts = [`${formatNumber(p.created)} new`, `${formatNumber(p.updated)} updated`];
  if (p.failed) parts.push(`${formatNumber(p.failed)} failed`);
  return parts.join(" · ");
}

function ProgressCell({ job }: { job: DiscoveryJob }) {
  const p = job.progress;
  return (
    <CellBox width="12rem" className="flex flex-col gap-0.5 tabular-nums">
      <span>{progressLine(job)}</span>
      <span className="text-muted-foreground text-xs">
        {plural(p.processed, "item", "items")} processed · {formatNumber(p.billable)} of at most{" "}
        {formatNumber(p.limit)} billable
      </span>
    </CellBox>
  );
}

export function creditsLine(job: DiscoveryJob): string {
  const c = job.credits;
  if (c.settled) return `${formatNumber(c.captured)} charged`;
  return `${formatNumber(c.held)} held`;
}

function CreditsCell({ job }: { job: DiscoveryJob }) {
  const c = job.credits;
  return (
    <CellBox width="9rem" className="flex flex-col gap-0.5 tabular-nums">
      <span>{creditsLine(job)}</span>
      <span className="text-muted-foreground text-xs">
        {c.settled ? `${formatNumber(c.released)} released` : "Settles when the job finishes"}
      </span>
    </CellBox>
  );
}

function columns(sources: DiscoverySourceOption[] | undefined): ColumnDef<DiscoveryJob>[] {
  return [
    {
      id: "name",
      header: "Job",
      meta: { mobileTitle: true },
      cell: ({ row }) => <JobName job={row.original} />,
    },
    {
      id: "status",
      header: "Status",
      cell: ({ row }) => <StatusCell job={row.original} />,
    },
    {
      id: "sources",
      header: "Sources",
      cell: ({ row }) => (
        <CellBox width="9rem">
          {row.original.spec.sources.map((k) => discoverySourceName(k, sources)).join(", ")}
        </CellBox>
      ),
    },
    {
      id: "progress",
      header: "Progress",
      cell: ({ row }) => <ProgressCell job={row.original} />,
    },
    {
      id: "credits",
      header: "Credits",
      cell: ({ row }) => <CreditsCell job={row.original} />,
    },
    {
      id: "created",
      header: "Created",
      cell: ({ row }) => (
        <CellBox width="8rem" className="flex flex-col gap-0.5">
          <span>{formatDate(row.original.createdAt)}</span>
          <span className="text-muted-foreground text-xs">
            {row.original.finishedAt
              ? `Finished ${formatRelative(row.original.finishedAt)}`
              : formatRelative(row.original.createdAt)}
          </span>
        </CellBox>
      ),
    },
  ];
}

function JobCard({
  job,
  sources,
}: {
  job: DiscoveryJob;
  sources: DiscoverySourceOption[] | undefined;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <div className="flex min-w-0 flex-col gap-0.5">
        <Link
          href={`/app/discovery/${job.id}`}
          className="break-anywhere rounded-xs text-sm font-medium hover:underline"
        >
          {job.name}
        </Link>
        <span className="text-muted-foreground break-anywhere text-xs">
          {specSummary(job.spec)}
        </span>
      </div>
      <JobStatus state={jobState(job.status)} size="sm" />
      <dl className="grid min-w-0 grid-cols-1 gap-1.5 text-[13px]">
        <div className="flex min-w-0 flex-col">
          <dt className="text-muted-foreground text-xs">Progress</dt>
          <dd className="tabular-nums">{progressLine(job)}</dd>
        </div>
        <div className="flex min-w-0 flex-col">
          <dt className="text-muted-foreground text-xs">Credits</dt>
          <dd className="tabular-nums">{creditsLine(job)}</dd>
        </div>
      </dl>
      <p className="text-muted-foreground break-anywhere text-xs">
        {job.spec.sources.map((k) => discoverySourceName(k, sources)).join(", ")} · Created{" "}
        {formatDate(job.createdAt)}
      </p>
    </div>
  );
}

/**
 * Discovery (/app/discovery): the organization's discovery jobs, newest first, with status and
 * source filters in the URL, cursor pagination and live refresh while any listed job is active.
 */
export function DiscoveryJobsPage() {
  const { can } = usePermissions();
  const canRun = can("discovery:run");
  const compact = useMediaQuery(MEDIA.belowMd);
  const [state, setState] = useUrlState(parseDiscoveryListParams, serializeDiscoveryListState);
  const sources = useDiscoverySources();

  const viewKey = JSON.stringify(state);
  const [pager, setPager] = useState<{ key: string; cursors: (string | null)[] }>({
    key: viewKey,
    cursors: [null],
  });
  const cursors = pager.key === viewKey ? pager.cursors : [null];
  const cursor = cursors[cursors.length - 1] ?? null;

  const list = useDiscoveryJobs({
    status: state.status.length ? state.status : undefined,
    source: state.source,
    pageSize: state.pageSize,
    cursor: cursor ?? undefined,
  });
  const rows = list.data?.data ?? [];
  const filtered = state.status.length > 0 || Boolean(state.source);
  const cols = useMemo(() => columns(sources.data), [sources.data]);
  const anyActive = rows.some(shouldPollDiscoveryJob);
  const runnable = sources.data?.filter((s) => s.runnable) ?? [];

  const set = (next: Partial<DiscoveryListState>) => setState({ ...state, ...next });

  const applied: ActiveFilter[] = [
    ...state.status.map((s) => ({
      id: `status-${s}`,
      label: `Status: ${DISCOVERY_STATUS_LABELS[s]}`,
      onRemove: () => set({ status: state.status.filter((x) => x !== s) }),
    })),
    ...(state.source
      ? [
          {
            id: "source",
            label: `Source: ${discoverySourceName(state.source, sources.data)}`,
            onRemove: () => set({ source: undefined }),
          },
        ]
      : []),
  ];

  const appearance = compact ? "field" : "chip";
  const filters = (
    <>
      <FilterMenu
        label="Status"
        appearance={appearance}
        sections={[
          {
            id: "status",
            type: "multiple",
            options: DISCOVERY_FILTER_STATUSES.map((s) => ({
              value: s,
              label: DISCOVERY_STATUS_LABELS[s],
            })),
            value: state.status,
            onValueChange: (v) => set({ status: v as DiscoveryListState["status"] }),
          },
        ]}
      />
      <FilterMenu
        label="Source"
        appearance={appearance}
        loading={sources.isPending}
        emptyMessage="No discovery sources"
        sections={[
          {
            id: "source",
            type: "single",
            anyLabel: "Any source",
            options: (sources.data ?? []).map((s) => ({ value: s.key, label: s.name })),
            value: state.source ? [state.source] : [],
            onValueChange: (v) => set({ source: v[0] }),
          },
        ]}
      />
    </>
  );

  const listError = list.isError && !list.data ? list.error : null;

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <PageHeader
        eyebrow="Workspace"
        title="Discovery"
        description="Jobs that search the sources enabled for this workspace for businesses in a category and a place. Every count comes from the job's own item records."
        actions={
          canRun ? (
            <Button asChild>
              <Link href="/app/discovery/new">
                <Plus aria-hidden /> Create discovery job
              </Link>
            </Button>
          ) : undefined
        }
      />

      {sources.data && runnable.length === 0 ? (
        <Banner
          tone="info"
          icon={Database}
          title="No discovery source can run right now"
          description={
            sources.data.length
              ? sources.data
                  .map(
                    (s) =>
                      `${s.name}: ${s.enabled ? s.statusDetail : "switched off for this workspace."}`,
                  )
                  .join(" ")
              : "No discovery source is registered."
          }
          actions={
            <Button asChild variant="outline" size="sm">
              <Link href="/app/sources">Review sources</Link>
            </Button>
          }
        />
      ) : null}

      <DataTable
        caption="Discovery jobs"
        columns={cols}
        data={rows}
        getRowId={(r) => r.id}
        loading={list.isPending}
        skeletonRows={5}
        error={
          listError ? (
            <ErrorState
              title={
                isForbidden(listError)
                  ? "You cannot view discovery jobs"
                  : "Could not load discovery jobs"
              }
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
              description="Try another status or source."
              action={
                <Button variant="outline" onClick={() => set({ status: [], source: undefined })}>
                  Clear filters
                </Button>
              }
            />
          ) : (
            <EmptyState
              icon={Compass}
              title="No discovery jobs yet"
              description={
                canRun
                  ? "A discovery job searches the enabled sources for businesses in a category and a place. You see an estimate before anything runs, and only records the job produces are charged (1 credit each)."
                  : "Discovery jobs appear here once an owner, administrator or researcher creates one."
              }
              action={
                canRun ? (
                  <Button asChild>
                    <Link href="/app/discovery/new">
                      <Plus aria-hidden /> Create discovery job
                    </Link>
                  </Button>
                ) : undefined
              }
            />
          )
        }
        mobileCards={{ render: (row) => <JobCard job={row} sources={sources.data} /> }}
        toolbar={
          <div className="flex min-w-0 flex-col gap-2">
            <FilterBar
              filters={applied}
              onClearAll={applied.length ? () => set({ status: [], source: undefined }) : undefined}
              sheetTitle="Filter discovery jobs"
            >
              {filters}
            </FilterBar>
            <p className="text-muted-foreground min-w-0 text-xs" aria-live="polite">
              {list.isPending
                ? "Loading discovery jobs"
                : rows.length
                  ? `Newest first${anyActive ? " · refreshing while a job runs" : ""} · updated ${formatRelative(new Date(list.dataUpdatedAt).toISOString())}`
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
              pageSizeOptions={[...DISCOVERY_PAGE_SIZES]}
              onPageSizeChange={(pageSize) => set({ pageSize })}
              pageCount={rows.length}
              loading={list.isFetching && list.isPlaceholderData}
              itemLabel="jobs"
            />
          )
        }
      />
      {list.isError && list.data ? (
        <ErrorState
          title="Could not refresh this page"
          message={friendlyMessage(list.error)}
          requestId={requestIdOf(list.error)}
          onRetry={() => void list.refetch()}
        />
      ) : null}
    </div>
  );
}
