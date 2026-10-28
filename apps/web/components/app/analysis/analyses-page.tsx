"use client";

import { AnalysisStatus, type OpportunityKey, type WebsiteAnalysis } from "@leadforge/contracts";
import type { ColumnDef } from "@tanstack/react-table";
import { Building2, Globe, Layers, SearchX } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import {
  Badge,
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
  ANALYSIS_PAGE_SIZES,
  ANALYSIS_STATUS_LABELS,
  OPPORTUNITY_KEYS,
  analysisJobState,
  failureLabel,
  gapCount,
  hostOf,
  opportunityName,
  parseAnalysisListParams,
  serializeAnalysisListState,
  shouldPollAnalysis,
  type AnalysisListState,
} from "@/lib/analysis";
import { friendlyMessage, isForbidden, requestIdOf } from "@/lib/errors";
import { formatDate, formatNumber, formatRelative, plural } from "@/lib/format";
import { useAnalyses } from "@/lib/hooks/use-analysis";
import { usePermissions } from "@/lib/hooks/use-permissions";
import { useUrlState } from "@/lib/hooks/use-url-state";
import { businessNameOf } from "./analysis-detail";

function WebsiteCell({ a }: { a: WebsiteAnalysis }) {
  return (
    <CellBox width="16rem" className="flex flex-col gap-0.5">
      <Link
        href={`/app/analysis/${a.id}`}
        className="text-foreground hover:text-primary break-anywhere rounded-xs font-medium hover:underline"
      >
        {hostOf(a.finalUrl ?? a.url)}
      </Link>
      {a.business ? (
        <Link
          href={`/app/businesses/${a.businessId}`}
          className="text-muted-foreground hover:text-primary rounded-xs break-words text-xs hover:underline"
        >
          {businessNameOf(a)}
        </Link>
      ) : (
        <span className="text-muted-foreground text-xs">{businessNameOf(a)}</span>
      )}
    </CellBox>
  );
}

function StatusCell({ a }: { a: WebsiteAnalysis }) {
  return (
    <CellBox width="10rem" className="flex flex-col gap-0.5">
      <JobStatus state={analysisJobState(a.status)} size="sm" />
      {a.status === "failed" && a.error ? (
        <span className="text-muted-foreground break-words text-xs">
          {failureLabel(a.error.code)}
        </span>
      ) : null}
    </CellBox>
  );
}

/** Findings summary: gaps observed and the suggested opportunities. */
export function findingsLine(a: WebsiteAnalysis): string {
  if (a.status === "queued" || a.status === "running") return "Not finished yet";
  if (a.status === "failed") return "No findings: the analysis did not finish";
  const gaps = gapCount(a);
  if (gaps === 0) return "No gaps observed";
  return `${plural(gaps, "gap", "gaps")} observed`;
}

function FindingsCell({ a }: { a: WebsiteAnalysis }) {
  return (
    <CellBox width="15rem" className="flex flex-col gap-1">
      <span>{findingsLine(a)}</span>
      {a.opportunities.length ? (
        <ul className="flex min-w-0 flex-wrap gap-1" aria-label="Opportunities">
          {a.opportunities.slice(0, 3).map((o) => (
            <li key={o.key}>
              <Badge variant="neutral">{opportunityName(o.key)}</Badge>
            </li>
          ))}
          {a.opportunities.length > 3 ? (
            <li className="text-muted-foreground self-center text-xs">
              +{a.opportunities.length - 3}
            </li>
          ) : null}
        </ul>
      ) : null}
    </CellBox>
  );
}

export function creditLine(a: WebsiteAnalysis): string {
  const c = a.credits;
  if (!c.settled) return `${formatNumber(c.held)} held`;
  if (c.captured) return `${formatNumber(c.captured)} charged`;
  return c.released ? `${formatNumber(c.released)} released` : "Not charged";
}

const COLUMNS: ColumnDef<WebsiteAnalysis>[] = [
  {
    id: "website",
    header: "Website",
    meta: { mobileTitle: true, label: "Website" },
    cell: ({ row }) => <WebsiteCell a={row.original} />,
  },
  {
    id: "status",
    header: "Status",
    meta: { label: "Status" },
    cell: ({ row }) => <StatusCell a={row.original} />,
  },
  {
    id: "findings",
    header: "Findings",
    meta: { label: "Findings" },
    cell: ({ row }) => <FindingsCell a={row.original} />,
  },
  {
    id: "credits",
    header: "Credits",
    meta: { label: "Credits" },
    cell: ({ row }) => (
      <CellBox width="7rem" className="tabular-nums">
        {creditLine(row.original)}
      </CellBox>
    ),
  },
  {
    id: "dates",
    header: "Requested",
    meta: { label: "Requested" },
    cell: ({ row }) => (
      <CellBox width="9rem" className="flex flex-col gap-0.5">
        <span>{formatDate(row.original.createdAt)}</span>
        <span className="text-muted-foreground text-xs">
          {row.original.analyzedAt
            ? `Analyzed ${formatRelative(row.original.analyzedAt)}`
            : formatRelative(row.original.createdAt)}
        </span>
      </CellBox>
    ),
  },
];

function AnalysisCard({ a }: { a: WebsiteAnalysis }) {
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <div className="flex min-w-0 flex-col gap-0.5">
        <Link
          href={`/app/analysis/${a.id}`}
          className="break-anywhere rounded-xs text-sm font-medium hover:underline"
        >
          {hostOf(a.finalUrl ?? a.url)}
        </Link>
        {a.business ? (
          <Link
            href={`/app/businesses/${a.businessId}`}
            className="text-muted-foreground break-anywhere rounded-xs text-xs hover:underline"
          >
            {businessNameOf(a)}
          </Link>
        ) : null}
      </div>
      <JobStatus state={analysisJobState(a.status)} size="sm" />
      <p className="text-[13px]">{findingsLine(a)}</p>
      {a.opportunities.length ? (
        <p className="text-muted-foreground break-anywhere text-xs">
          {a.opportunities.map((o) => opportunityName(o.key)).join(" · ")}
        </p>
      ) : null}
      <p className="text-muted-foreground text-xs tabular-nums">
        {creditLine(a)} · Requested {formatDate(a.createdAt)}
      </p>
    </div>
  );
}

/**
 * Website analyses (/app/analysis): every analysis in the workspace, newest first, with status,
 * opportunity, business and bulk-batch filters in the URL. Analyses are requested from
 * businesses (one from a business page, up to 50 from the directory); bulk-completion
 * notifications land here with `?batchId=`.
 */
export function AnalysesPage() {
  const { canRunAnalysis } = usePermissions();
  const compact = useMediaQuery(MEDIA.belowMd);
  const [state, setState] = useUrlState(parseAnalysisListParams, serializeAnalysisListState);
  const viewKey = JSON.stringify(state);
  const [pager, setPager] = useState<{ key: string; cursors: (string | null)[] }>({
    key: viewKey,
    cursors: [null],
  });
  const cursors = pager.key === viewKey ? pager.cursors : [null];
  const cursor = cursors[cursors.length - 1] ?? null;
  const list = useAnalyses({
    status: state.status.length ? state.status : undefined,
    opportunity: state.opportunity.length ? state.opportunity : undefined,
    businessId: state.businessId,
    batchId: state.batchId,
    pageSize: state.pageSize,
    cursor: cursor ?? undefined,
  });
  const rows = useMemo(() => list.data?.data ?? [], [list.data]);
  const anyActive = rows.some(shouldPollAnalysis);
  const set = (next: Partial<AnalysisListState>) => setState({ ...state, ...next });
  const filtered =
    state.status.length > 0 ||
    state.opportunity.length > 0 ||
    Boolean(state.businessId) ||
    Boolean(state.batchId);
  const appearance = compact ? "field" : "chip";
  const listError = list.isError && !list.data ? list.error : null;
  const businessName = state.businessId
    ? rows.find((r) => r.businessId === state.businessId)
    : undefined;
  const cleared: Partial<AnalysisListState> = {
    status: [],
    opportunity: [],
    businessId: undefined,
    batchId: undefined,
  };

  const applied: ActiveFilter[] = [
    ...state.status.map((s) => ({
      id: `status-${s}`,
      label: `Status: ${ANALYSIS_STATUS_LABELS[s]}`,
      onRemove: () => set({ status: state.status.filter((x) => x !== s) }),
    })),
    ...state.opportunity.map((o) => ({
      id: `opportunity-${o}`,
      label: `Opportunity: ${opportunityName(o)}`,
      onRemove: () => set({ opportunity: state.opportunity.filter((x) => x !== o) }),
    })),
    ...(state.businessId
      ? [
          {
            id: "business",
            label: `Business: ${businessName ? businessNameOf(businessName) : state.businessId.slice(-8)}`,
            onRemove: () => set({ businessId: undefined }),
          },
        ]
      : []),
    ...(state.batchId
      ? [
          {
            id: "batch",
            label: `Bulk request: ${state.batchId.slice(-8)}`,
            onRemove: () => set({ batchId: undefined }),
          },
        ]
      : []),
  ];

  const batchSummary =
    state.batchId && rows.length && !list.data?.meta.nextCursor ? summarize(rows) : null;

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <PageHeader
        eyebrow="Workspace"
        title="Website analysis"
        description="What LeadForge observed on each business's own website, with evidence and the opportunities that follow. Analyses read static HTML only and cost 1 credit each."
        actions={
          <Button asChild variant="outline">
            <Link href="/app/businesses">
              <Building2 aria-hidden /> Choose businesses
            </Link>
          </Button>
        }
      />

      {state.batchId ? (
        <Banner
          tone="info"
          icon={Layers}
          title="Showing one bulk request"
          description={
            batchSummary
              ? `${plural(batchSummary.total, "analysis", "analyses")}: ${formatNumber(batchSummary.completed)} completed, ${formatNumber(batchSummary.failed)} failed, ${formatNumber(batchSummary.active)} still running.`
              : "These analyses were requested together from the directory."
          }
          actions={
            <Button variant="outline" size="sm" onClick={() => set({ batchId: undefined })}>
              Show all analyses
            </Button>
          }
          data-testid="batch-banner"
        />
      ) : null}

      <DataTable
        caption="Website analyses"
        columns={COLUMNS}
        data={rows}
        getRowId={(r) => r.id}
        loading={list.isPending}
        skeletonRows={6}
        error={
          listError ? (
            <ErrorState
              title={
                isForbidden(listError)
                  ? "You cannot view website analyses"
                  : "Could not load website analyses"
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
              title="No analyses match"
              description="Try another status or opportunity, or show every analysis."
              action={
                <Button variant="outline" onClick={() => set(cleared)}>
                  Clear filters
                </Button>
              }
            />
          ) : (
            <EmptyState
              icon={Globe}
              title="No website analyses yet"
              description={
                canRunAnalysis
                  ? "Analyses are requested from businesses: open a business and choose Run website analysis, or select up to 50 in the directory and choose Analyze websites. Each costs 1 credit, charged only when it completes."
                  : "Analyses appear here once an owner, administrator or researcher requests one from a business."
              }
              action={
                <Button asChild>
                  <Link href="/app/businesses">
                    <Building2 aria-hidden /> Go to businesses
                  </Link>
                </Button>
              }
            />
          )
        }
        mobileCards={{ render: (row) => <AnalysisCard a={row} /> }}
        toolbar={
          <div className="flex min-w-0 flex-col gap-2">
            <FilterBar
              filters={applied}
              onClearAll={applied.length ? () => set(cleared) : undefined}
              sheetTitle="Filter website analyses"
            >
              <FilterMenu
                label="Status"
                appearance={appearance}
                sections={[
                  {
                    id: "status",
                    type: "multiple",
                    options: AnalysisStatus.options.map((s) => ({
                      value: s,
                      label: ANALYSIS_STATUS_LABELS[s],
                    })),
                    value: state.status,
                    onValueChange: (v) => set({ status: v as AnalysisListState["status"] }),
                  },
                ]}
              />
              <FilterMenu
                label="Opportunity"
                appearance={appearance}
                sections={[
                  {
                    id: "opportunity",
                    type: "multiple",
                    options: OPPORTUNITY_KEYS.map((o) => ({ value: o, label: opportunityName(o) })),
                    value: state.opportunity,
                    onValueChange: (v) => set({ opportunity: v as OpportunityKey[] }),
                  },
                ]}
              />
            </FilterBar>
            <p className="text-muted-foreground min-w-0 text-xs" aria-live="polite">
              {list.isPending
                ? "Loading website analyses"
                : rows.length
                  ? `Newest first${anyActive ? " · refreshing while an analysis runs" : ""} · updated ${formatRelative(new Date(list.dataUpdatedAt).toISOString())}`
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
              pageSizeOptions={[...ANALYSIS_PAGE_SIZES]}
              onPageSizeChange={(pageSize) => set({ pageSize })}
              pageCount={rows.length}
              loading={list.isFetching && list.isPlaceholderData}
              itemLabel={rows.length === 1 ? "analysis" : "analyses"}
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

function summarize(rows: WebsiteAnalysis[]) {
  return {
    total: rows.length,
    completed: rows.filter((r) => r.status === "completed").length,
    failed: rows.filter((r) => r.status === "failed").length,
    active: rows.filter((r) => r.status === "queued" || r.status === "running").length,
  };
}
