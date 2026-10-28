"use client";

import {
  BulkItemOutcome,
  EXPIRED_NAME_LABEL,
  type BulkOperation,
  type BulkOperationItem,
} from "@leadforge/contracts";
import type { ColumnDef } from "@tanstack/react-table";
import { ArrowLeft, Kanban, ListChecks, SearchX, Workflow } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import {
  Banner,
  Breadcrumbs,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  DataTable,
  EmptyState,
  ErrorState,
  FilterBar,
  FilterMenu,
  Heading,
  HeadingLevel,
  JobStatus,
  LiveAnnouncement,
  MEDIA,
  PageHeader,
  Pagination,
  Progress,
  Skeleton,
  StatusIndicator,
  useMediaQuery,
  type ActiveFilter,
} from "@leadforge/ui";
import { useWorkspace } from "@/components/app/app-shell";
import { CellBox, renderBreadcrumbLink } from "@/components/app/businesses/shared";
import { isApiError } from "@/lib/api";
import {
  BULK_STATUS_LABELS,
  bulkActionLabel,
  bulkFailureMessage,
  bulkJobState,
  bulkOutcomeMeta,
  isBulkActive,
} from "@/lib/bulk";
import { stageLabel } from "@/lib/crm";
import { friendlyMessage, requestIdOf } from "@/lib/errors";
import { formatDateTime, formatNumber, formatRelative, plural } from "@/lib/format";
import { useBulkItems, useBulkOperation } from "@/lib/hooks/use-bulk";
import { useLeadList } from "@/lib/hooks/use-lists";
import { useMemberNames } from "@/lib/hooks/use-members";
import { usePipelineConfig } from "@/lib/hooks/use-pipeline";

/** The operation's title from its action and target: "Assign to Bisi", "Add to list “Lagos”". */
export function useBulkTitle(op: BulkOperation | undefined): string {
  const { me } = useWorkspace();
  const list = useLeadList(op?.params.listId ?? null);
  const config = usePipelineConfig();
  const member = useMemberNames();
  if (!op) return "Bulk operation";
  switch (op.action) {
    case "add_to_list":
      return `Add to list “${list.data?.name ?? "…"}”`;
    case "remove_from_list":
      return `Remove from list “${list.data?.name ?? "…"}”`;
    case "assign":
      return op.params.assignedToUserId
        ? `Assign to ${op.params.assignedToUserId === me.user.id ? "you" : member(op.params.assignedToUserId)}`
        : "Unassign leads";
    case "move_stage":
      return `Move to ${stageLabel(config.data, op.params.stageKey)}`;
    default:
      return bulkActionLabel(op.action);
  }
}

/** Said once per status change (never on every poll). */
export function bulkAnnouncement(op: BulkOperation | undefined): string {
  if (!op) return "";
  const p = op.progress;
  switch (op.status) {
    case "queued":
      return "Bulk operation queued.";
    case "running":
      return "Bulk operation running.";
    case "completed":
      return `Bulk operation completed: ${p.changed} changed, ${p.unchanged} already done, ${p.skipped} skipped.`;
    case "completed_with_errors":
      return `Bulk operation completed with errors: ${p.changed} changed, ${p.failed} failed.`;
    case "failed":
      return `Bulk operation failed. ${bulkFailureMessage(op.error)}`;
    default:
      return "";
  }
}

/**
 * The business by name (Stage 8: `businessName` on each item). A name that expired under its
 * source's terms reads as the expired label in italics; when the API sends neither (the business
 * is not in this organization, outcome `not_found`) the id stays as the fallback.
 */
function ItemBusiness({ item }: { item: BulkOperationItem }) {
  const name = item.businessName ?? null;
  const expired = !name && item.businessNameState === "expired";
  const href = item.outcome === "not_found" ? null : `/app/businesses/${item.businessId}`;
  const label = name ? (
    <span className="break-words">{name}</span>
  ) : expired ? (
    <span
      className="text-muted-foreground italic"
      title="The name expired under its source's terms"
    >
      {EXPIRED_NAME_LABEL}
    </span>
  ) : (
    <span className="font-mono text-xs">Business …{item.businessId.slice(-6)}</span>
  );
  return (
    <CellBox width="12rem">
      {href ? (
        <Link
          href={href}
          className="text-primary rounded-xs hover:underline"
          title={item.businessId}
          data-testid="bulk-item-business"
        >
          {label}
        </Link>
      ) : (
        <span title={item.businessId} data-testid="bulk-item-business">
          {label}
        </span>
      )}
    </CellBox>
  );
}

const ITEM_COLUMNS: ColumnDef<BulkOperationItem>[] = [
  {
    id: "business",
    header: "Business",
    meta: { mobileTitle: true },
    cell: ({ row }) => <ItemBusiness item={row.original} />,
  },
  {
    id: "outcome",
    header: "Result",
    cell: ({ row }) => {
      const meta = bulkOutcomeMeta(row.original.outcome);
      return (
        <CellBox width="13rem">
          <StatusIndicator tone={meta.tone} label={meta.label} title={meta.description} size="sm" />
        </CellBox>
      );
    },
  },
  {
    id: "message",
    header: "Detail",
    cell: ({ row }) => (
      <CellBox width="16rem" className="text-muted-foreground text-xs">
        {row.original.message ?? bulkOutcomeMeta(row.original.outcome).description}
      </CellBox>
    ),
  },
  {
    id: "processedAt",
    header: "Processed",
    cell: ({ row }) => (
      <CellBox width="9rem">
        <time dateTime={row.original.processedAt}>{formatDateTime(row.original.processedAt)}</time>
      </CellBox>
    ),
  },
];

/**
 * One bulk operation (/app/jobs/bulk/[id]): status and progress polled every 1.5 s while it runs,
 * the outcome breakdown, and every business's result (kept 30 days) with an outcome filter.
 */
export function BulkJobPage({ id }: { id: string }) {
  const op = useBulkOperation(id);
  const title = useBulkTitle(op.data);
  const compact = useMediaQuery(MEDIA.belowMd);
  const [outcomes, setOutcomes] = useState<string[]>([]);
  const [cursors, setCursors] = useState<(string | null)[]>([null]);
  const cursor = cursors[cursors.length - 1] ?? null;
  const active = op.data ? isBulkActive(op.data) : false;
  const items = useBulkItems(
    id,
    { outcome: outcomes.length ? outcomes : undefined, pageSize: 25, cursor: cursor ?? undefined },
    active,
  );
  const announcement = useMemo(() => bulkAnnouncement(op.data), [op.data?.status]);

  if (op.isPending) {
    return (
      <div
        role="status"
        aria-busy="true"
        aria-label="Loading bulk operation"
        className="flex flex-col gap-6"
      >
        <Skeleton className="h-4 w-40" />
        <Skeleton className="h-8 w-72 max-w-full" />
        <Skeleton className="h-48 rounded-lg" />
      </div>
    );
  }
  if (op.isError && !op.data) {
    const notFound =
      isApiError(op.error) && (op.error.status === 404 || op.error.code === "VALIDATION_FAILED");
    return (
      <div className="flex flex-col gap-6">
        <Breadcrumbs
          items={[{ label: "Background jobs", href: "/app/jobs" }, { label: "Not found" }]}
          renderLink={renderBreadcrumbLink}
        />
        <PageHeader title={notFound ? "Bulk operation not found" : "Bulk operation"} />
        {notFound ? (
          <EmptyState
            icon={SearchX}
            title="We could not find this bulk operation"
            description="The link may be wrong, or it belongs to another workspace."
            action={
              <Button asChild>
                <Link href="/app/jobs">
                  <ArrowLeft aria-hidden /> All background jobs
                </Link>
              </Button>
            }
          />
        ) : (
          <ErrorState
            title="Could not load the bulk operation"
            message={friendlyMessage(op.error)}
            requestId={requestIdOf(op.error)}
            onRetry={() => void op.refetch()}
          />
        )}
      </div>
    );
  }
  const o = op.data!;
  const p = o.progress;
  const breakdown = o.breakdown.filter((b) => b.count > 0);
  const rows = items.data?.data ?? [];
  const itemsError = items.isError && !items.data ? items.error : null;

  const applied: ActiveFilter[] = outcomes.map((v) => ({
    id: v,
    label: `Result: ${bulkOutcomeMeta(v).label}`,
    onRemove: () => {
      setOutcomes(outcomes.filter((x) => x !== v));
      setCursors([null]);
    },
  }));

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <PageHeader
        breadcrumbs={
          <Breadcrumbs
            items={[{ label: "Background jobs", href: "/app/jobs" }, { label: "Bulk operation" }]}
            renderLink={renderBreadcrumbLink}
          />
        }
        eyebrow="Bulk operation"
        title={title}
        description={`${plural(p.total, "business", "businesses")} from ${o.selection.kind === "ids" ? "selected rows" : "the directory filters at the time"}. Requested ${formatDateTime(o.createdAt)}.`}
        actions={
          <>
            {o.params.listId ? (
              <Button asChild variant="outline">
                <Link href={`/app/lists/${o.params.listId}`}>
                  <ListChecks aria-hidden /> Open the list
                </Link>
              </Button>
            ) : null}
            {o.action === "assign" || o.action === "move_stage" ? (
              <Button asChild variant="outline">
                <Link
                  href={
                    o.params.assignedToUserId
                      ? `/app/pipeline?assignedToUserId=${o.params.assignedToUserId}`
                      : "/app/pipeline"
                  }
                >
                  <Kanban aria-hidden /> Open the pipeline
                </Link>
              </Button>
            ) : null}
          </>
        }
      />
      <LiveAnnouncement message={announcement} data-testid="bulk-announcer" />

      <Card>
        <CardHeader className="flex-row flex-wrap items-center justify-between gap-2">
          <CardTitle>Progress</CardTitle>
          <JobStatus
            state={bulkJobState(o.status)}
            label={BULK_STATUS_LABELS[o.status]}
            data-testid="bulk-status"
          />
        </CardHeader>
        <CardContent className="flex min-w-0 flex-col gap-4">
          {active ? (
            <Progress
              label={
                o.status === "queued"
                  ? "Queued: waiting for a worker"
                  : `Processing ${formatNumber(p.processed)} of ${formatNumber(p.total)}`
              }
              value={p.percent}
              max={100}
              valueText={`${p.percent}%`}
              showLabel
            />
          ) : null}
          <dl
            className="grid min-w-0 grid-cols-2 gap-3 text-sm sm:grid-cols-5"
            data-testid="bulk-counts"
          >
            {[
              ["Businesses", p.total],
              ["Changed", p.changed],
              ["Already done", p.unchanged],
              ["Skipped", p.skipped],
              ["Failed", p.failed],
            ].map(([label, value]) => (
              <div
                key={label as string}
                className="bg-surface-container-low flex min-w-0 flex-col gap-0.5 rounded-md px-3 py-2"
              >
                <dt className="text-muted-foreground text-xs">{label}</dt>
                <dd className="text-lg tabular-nums">{formatNumber(value as number)}</dd>
              </div>
            ))}
          </dl>
          {o.status === "failed" ? (
            <Banner
              tone="destructive"
              title="The operation failed"
              description={bulkFailureMessage(o.error)}
            />
          ) : o.status === "completed_with_errors" ? (
            <Banner
              tone="warning"
              title="Some businesses failed"
              description="The others were processed. Filter the results by Failed to see which, then try those again."
            />
          ) : null}
          {breakdown.length ? (
            <ul className="flex min-w-0 flex-col gap-2" aria-label="Results by outcome">
              {breakdown.map((b) => {
                const meta = bulkOutcomeMeta(b.outcome);
                return (
                  <li key={b.outcome} className="flex min-w-0 items-start justify-between gap-3">
                    <span className="flex min-w-0 flex-col gap-0.5">
                      <StatusIndicator tone={meta.tone} label={meta.label} size="sm" />
                      <span className="text-muted-foreground text-xs">{meta.description}</span>
                    </span>
                    <span className="shrink-0 tabular-nums">{formatNumber(b.count)}</span>
                  </li>
                );
              })}
            </ul>
          ) : null}
          <p className="text-muted-foreground text-xs">
            {o.finishedAt
              ? `Finished ${formatDateTime(o.finishedAt)}`
              : o.startedAt
                ? `Started ${formatRelative(o.startedAt)} · refreshing every 1.5 seconds`
                : "Waiting to start · refreshing every 1.5 seconds"}
            . The selection was fixed when it was confirmed, so a retry never applies it twice.
          </p>
        </CardContent>
      </Card>

      <section aria-labelledby="bulk-items-title" className="flex min-w-0 flex-col gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <Heading id="bulk-items-title" className="text-base font-medium">
            Results per business
          </Heading>
          <p className="text-muted-foreground text-sm">Kept for 30 days.</p>
        </div>
        <HeadingLevel>
          <DataTable
            caption="Results per business"
            columns={ITEM_COLUMNS}
            data={rows}
            getRowId={(r) => r.businessId}
            loading={items.isPending}
            skeletonRows={4}
            error={
              itemsError ? (
                <ErrorState
                  title="Could not load the results"
                  message={friendlyMessage(itemsError)}
                  requestId={requestIdOf(itemsError)}
                  onRetry={() => void items.refetch()}
                />
              ) : undefined
            }
            empty={
              <EmptyState
                size="compact"
                icon={Workflow}
                title={
                  outcomes.length ? "No results match" : active ? "No results yet" : "No results"
                }
                description={
                  outcomes.length
                    ? "No business has that result."
                    : active
                      ? "Results appear here as businesses are processed."
                      : "This operation recorded no per-business results."
                }
              />
            }
            mobileCards
            toolbar={
              <FilterBar
                filters={applied}
                onClearAll={
                  applied.length
                    ? () => {
                        setOutcomes([]);
                        setCursors([null]);
                      }
                    : undefined
                }
                sheetTitle="Filter results"
              >
                <FilterMenu
                  label="Result"
                  appearance={compact ? "field" : "chip"}
                  sections={[
                    {
                      id: "outcome",
                      type: "multiple",
                      options: BulkItemOutcome.options.map((v) => ({
                        value: v,
                        label: bulkOutcomeMeta(v).label,
                        count: o.breakdown.find((b) => b.outcome === v)?.count,
                      })),
                      value: outcomes,
                      onValueChange: (v) => {
                        setOutcomes(v);
                        setCursors([null]);
                      },
                    },
                  ]}
                />
              </FilterBar>
            }
            footer={
              itemsError || (rows.length === 0 && cursors.length === 1) ? null : (
                <Pagination
                  hasPrevious={cursors.length > 1}
                  hasNext={Boolean(items.data?.meta.nextCursor)}
                  onPrevious={() => setCursors(cursors.slice(0, -1))}
                  onNext={() => {
                    const next = items.data?.meta.nextCursor;
                    if (next) setCursors([...cursors, next]);
                  }}
                  pageSize={25}
                  pageCount={rows.length}
                  loading={items.isFetching && items.isPlaceholderData}
                  itemLabel="results"
                />
              )
            }
          />
        </HeadingLevel>
      </section>
    </div>
  );
}
