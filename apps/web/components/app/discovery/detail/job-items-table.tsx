"use client";

import {
  EXPIRED_NAME_LABEL,
  type DiscoveryItemOutcome,
  type DiscoveryJob,
  type DiscoveryJobItem,
  type DiscoverySourceOption,
} from "@leadforge/contracts";
import type { ColumnDef } from "@tanstack/react-table";
import { ListX, SearchX } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import {
  Button,
  CopyableValue,
  DataTable,
  EmptyState,
  ErrorState,
  FieldStatus,
  FilterBar,
  FilterMenu,
  Heading,
  HeadingLevel,
  MEDIA,
  Pagination,
  StatusIndicator,
  useMediaQuery,
} from "@leadforge/ui";
import { CellBox } from "@/components/app/businesses/shared";
import {
  OUTCOME_META,
  OUTCOME_ORDER,
  discoverySourceName,
  isDiscoveryActive,
  issueLabel,
  parseItemsParams,
  serializeItemsState,
} from "@/lib/discovery";
import { friendlyMessage, requestIdOf } from "@/lib/errors";
import { formatDateTime, formatNumber } from "@/lib/format";
import { useDiscoveryItems } from "@/lib/hooks/use-discovery";
import { useUrlState } from "@/lib/hooks/use-url-state";

function outcomeCount(job: DiscoveryJob, outcome: DiscoveryItemOutcome): number {
  const p = job.progress;
  switch (outcome) {
    case "created":
      return p.created;
    case "updated":
      return p.updated;
    case "duplicate":
      return p.duplicates;
    case "skipped":
      return p.skipped;
    case "failed":
      return p.failed;
  }
}

/** The resulting business, honest about names hidden under a source's retention terms. */
export function ItemBusiness({ item }: { item: DiscoveryJobItem }) {
  const b = item.business;
  if (!b) {
    return <span className="text-muted-foreground">No business record</span>;
  }
  const expired = b.nameState === "expired" || b.name === null;
  return (
    <span className="flex min-w-0 flex-col gap-0.5">
      <Link
        href={`/app/businesses/${b.id}`}
        className={
          expired
            ? "text-muted-foreground rounded-xs break-words italic hover:underline"
            : "text-foreground hover:text-primary rounded-xs break-words font-medium hover:underline"
        }
      >
        {expired ? EXPIRED_NAME_LABEL : b.name}
      </Link>
      {expired ? <FieldStatus state="expired" size="sm" label="Name expired" /> : null}
    </span>
  );
}

export function ItemOutcome({ item }: { item: DiscoveryJobItem }) {
  const meta = OUTCOME_META[item.outcome];
  return (
    <span className="flex min-w-0 flex-col gap-0.5">
      <StatusIndicator
        tone={meta.tone}
        icon={meta.icon}
        label={meta.label}
        size="sm"
        title={meta.description}
        data-outcome={item.outcome}
      />
      <span className="text-muted-foreground text-xs">
        {item.billable ? "Billed" : "Not billed"}
      </span>
    </span>
  );
}

function ItemDetails({ item }: { item: DiscoveryJobItem }) {
  if (!item.error && item.warnings.length === 0 && !item.duplicateOfId) {
    return <span className="text-muted-foreground">None</span>;
  }
  return (
    <span className="flex min-w-0 flex-col gap-1.5">
      {item.error ? (
        <span className="flex min-w-0 flex-col">
          <span className="font-medium">{issueLabel(item.error.code)}</span>
          <span className="text-muted-foreground break-words text-xs">
            {item.error.message}
            {item.error.retryable ? " Retryable." : ""}
          </span>
        </span>
      ) : null}
      {item.warnings.map((w, i) => (
        <span key={`${w.code}-${i}`} className="flex min-w-0 flex-col">
          <span className="font-medium">{issueLabel(w.code)}</span>
          <span className="text-muted-foreground break-words text-xs">{w.message}</span>
        </span>
      ))}
      {item.duplicateOfId ? (
        <Link
          href={`/app/businesses/${item.duplicateOfId}`}
          className="text-primary rounded-xs text-xs hover:underline"
        >
          Business it duplicates
        </Link>
      ) : null}
    </span>
  );
}

function SourceRecord({
  item,
  sources,
}: {
  item: DiscoveryJobItem;
  sources: DiscoverySourceOption[] | undefined;
}) {
  return (
    <span className="flex min-w-0 flex-col gap-0.5">
      <span className="text-xs">{discoverySourceName(item.source, sources)}</span>
      <CopyableValue value={item.externalId} label="source record ID" mono className="text-xs" />
    </span>
  );
}

function itemColumns(sources: DiscoverySourceOption[] | undefined): ColumnDef<DiscoveryJobItem>[] {
  return [
    {
      id: "business",
      header: "Business",
      meta: { mobileTitle: true },
      cell: ({ row }) => (
        <CellBox width="15rem">
          <ItemBusiness item={row.original} />
        </CellBox>
      ),
    },
    {
      id: "outcome",
      header: "Outcome",
      cell: ({ row }) => (
        <CellBox width="9rem">
          <ItemOutcome item={row.original} />
        </CellBox>
      ),
    },
    {
      id: "source",
      header: "Source record",
      cell: ({ row }) => (
        <CellBox width="14rem">
          <SourceRecord item={row.original} sources={sources} />
        </CellBox>
      ),
    },
    {
      id: "details",
      header: "Errors and warnings",
      cell: ({ row }) => (
        <CellBox width="16rem">
          <ItemDetails item={row.original} />
        </CellBox>
      ),
    },
    {
      id: "processed",
      header: "Processed",
      cell: ({ row }) => (
        <CellBox width="9rem" className="flex flex-col gap-0.5">
          <span>
            {row.original.processedAt ? formatDateTime(row.original.processedAt) : "Pending"}
          </span>
          <span className="text-muted-foreground text-xs tabular-nums">
            {row.original.attempts === 1
              ? "1 attempt"
              : `${formatNumber(row.original.attempts)} attempts`}
            {row.original.round > 0 ? ` · round ${row.original.round}` : ""}
          </span>
        </CellBox>
      ),
    },
  ];
}

function ItemCard({
  item,
  sources,
}: {
  item: DiscoveryJobItem;
  sources: DiscoverySourceOption[] | undefined;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-2 text-[13px]">
      <ItemBusiness item={item} />
      <ItemOutcome item={item} />
      <SourceRecord item={item} sources={sources} />
      {item.error || item.warnings.length || item.duplicateOfId ? (
        <ItemDetails item={item} />
      ) : null}
    </div>
  );
}

/**
 * Items of a discovery job (`GET /discovery/jobs/:id/items`) with an outcome filter in the URL.
 * While the job runs the first page refreshes in place; rows are never animated.
 */
export function JobItemsTable({
  job,
  sources,
}: {
  job: DiscoveryJob;
  sources: DiscoverySourceOption[] | undefined;
}) {
  const compact = useMediaQuery(MEDIA.belowMd);
  const [view, setView] = useUrlState(parseItemsParams, serializeItemsState);
  const viewKey = JSON.stringify(view);
  const [pager, setPager] = useState<{ key: string; cursors: (string | null)[] }>({
    key: viewKey,
    cursors: [null],
  });
  const cursors = pager.key === viewKey ? pager.cursors : [null];
  const cursor = cursors[cursors.length - 1] ?? null;
  const active = isDiscoveryActive(job);
  const items = useDiscoveryItems(
    job.id,
    { outcome: view.outcome.length ? view.outcome : undefined, cursor },
    active,
  );
  const rows = items.data?.data ?? [];
  const cols = useMemo(() => itemColumns(sources), [sources]);
  const error = items.isError && !items.data ? items.error : null;

  const attribution = job.attributions.length ? (
    <p className="text-muted-foreground text-xs" data-testid="items-attribution">
      Source records from {job.attributions.join(", ")}.{" "}
      <Link href="/legal/data-sources" className="link-inline rounded-xs">
        Data sources and licences
      </Link>
    </p>
  ) : null;

  return (
    <section aria-labelledby="job-items-title" className="flex min-w-0 flex-col gap-3">
      <div className="flex min-w-0 flex-col gap-1">
        <Heading id="job-items-title" className="text-base font-medium">
          Items
        </Heading>
        <p className="text-muted-foreground text-sm">
          One row per place the sources returned, in discovery order, with what happened to it.
        </p>
      </div>
      <HeadingLevel>
        <DataTable
          caption="Discovery job items"
          columns={cols}
          data={rows}
          getRowId={(r) => r.id}
          loading={items.isPending}
          skeletonRows={5}
          error={
            error ? (
              <ErrorState
                title="Could not load the items"
                message={friendlyMessage(error)}
                requestId={requestIdOf(error)}
                onRetry={() => void items.refetch()}
              />
            ) : undefined
          }
          empty={
            view.outcome.length ? (
              <EmptyState
                size="compact"
                icon={SearchX}
                title="No items with this outcome"
                action={
                  <Button variant="outline" onClick={() => setView({ outcome: [] })}>
                    Show all items
                  </Button>
                }
              />
            ) : (
              <EmptyState
                size="compact"
                icon={ListX}
                title={active ? "No items yet" : "This job produced no items"}
                description={
                  active
                    ? "Items appear here as the sources return pages."
                    : "The sources returned no places for this search, or the job stopped before the first page."
                }
              />
            )
          }
          mobileCards={{ render: (row) => <ItemCard item={row} sources={sources} /> }}
          toolbar={
            <FilterBar
              filters={view.outcome.map((o) => ({
                id: o,
                label: `Outcome: ${OUTCOME_META[o].label}`,
                onRemove: () => setView({ outcome: view.outcome.filter((x) => x !== o) }),
              }))}
              onClearAll={view.outcome.length ? () => setView({ outcome: [] }) : undefined}
              sheetTitle="Filter items"
            >
              <FilterMenu
                label="Outcome"
                appearance={compact ? "field" : "chip"}
                sections={[
                  {
                    id: "outcome",
                    type: "multiple",
                    options: OUTCOME_ORDER.map((o) => ({
                      value: o,
                      label: OUTCOME_META[o].label,
                      count: outcomeCount(job, o),
                    })),
                    value: view.outcome,
                    onValueChange: (v) => setView({ outcome: v as DiscoveryItemOutcome[] }),
                  },
                ]}
              />
            </FilterBar>
          }
          footer={
            error || (rows.length === 0 && cursors.length === 1) ? (
              attribution
            ) : (
              <div className="flex min-w-0 flex-col gap-3">
                <Pagination
                  hasPrevious={cursors.length > 1}
                  hasNext={Boolean(items.data?.meta.nextCursor)}
                  onPrevious={() => setPager({ key: viewKey, cursors: cursors.slice(0, -1) })}
                  onNext={() => {
                    const next = items.data?.meta.nextCursor;
                    if (next) setPager({ key: viewKey, cursors: [...cursors, next] });
                  }}
                  pageSize={25}
                  pageCount={rows.length}
                  loading={items.isFetching && items.isPlaceholderData}
                  itemLabel="items"
                />
                {attribution}
              </div>
            )
          }
        />
      </HeadingLevel>
    </section>
  );
}
