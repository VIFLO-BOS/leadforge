"use client";

import {
  BULK_LIMITS,
  EXPIRED_NAME_LABEL,
  type BulkAction,
  type BulkSelection,
  type BusinessListItem,
  type CreateExportRequest,
  type ImportJob,
  type PagedEnvelope,
} from "@leadforge/contracts";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { RowSelectionState, SortingState, VisibilityState } from "@tanstack/react-table";
import {
  ArrowRightLeft,
  Building2,
  ChevronDown,
  Compass,
  CopyCheck,
  Download,
  EyeOff,
  FileUp,
  Globe,
  ListMinus,
  ListPlus,
  Plus,
  SearchX,
  UserPlus,
} from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import {
  Button,
  DataTable,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
  EmptyState,
  ErrorState,
  FieldStatus,
  PageHeader,
  Pagination,
  toast,
  type DataTableDensity,
} from "@leadforge/ui";
import { useWorkspace } from "@/components/app/app-shell";
import { BulkAnalyzeDialog } from "@/components/app/analysis/bulk-analyze-dialog";
import { BulkActionDialog, selectionPhrase } from "@/components/app/bulk/bulk-action-dialog";
import { ExportDialog } from "@/components/app/exports/export-dialog";
import { apiFetch } from "@/lib/api";
import {
  PAGE_SIZES,
  activeFilterCount,
  clearedFilters,
  isSortField,
  parseDirectoryParams,
  serializeDirectoryState,
  toListQuery,
  toRequestFilter,
  DEFAULT_SORT,
  type DirectoryState,
} from "@/lib/business-filters";
import { friendlyMessage, isForbidden, requestIdOf } from "@/lib/errors";
import { formatDate, formatNumber, formatRelative, plural } from "@/lib/format";
import { useBusinessFacets, useBusinessList } from "@/lib/hooks/use-businesses";
import { usePermissions } from "@/lib/hooks/use-permissions";
import { useUrlState } from "@/lib/hooks/use-url-state";
import { sourceLabel } from "@/lib/labels";
import { queryKeys } from "@/lib/query-keys";
import { AddBusinessDialog } from "../add-business-dialog";
import { WhatsAppIndicator, shortLocation } from "../shared";
import { BulkSuppressDialog } from "./bulk-suppress-dialog";
import { DEFAULT_HIDDEN_COLUMNS, RowActions, businessColumns } from "./business-columns";
import { DirectoryFilters } from "./directory-filters";

/** What a bulk action or export applies to: the selected rows, or every row the filters match. */
type Target = { kind: "ids"; ids: string[]; clear: () => void } | { kind: "filter" };

const BULK_ACTIONS: { action: BulkAction; label: string; icon: typeof ListPlus }[] = [
  { action: "add_to_list", label: "Add to list…", icon: ListPlus },
  { action: "remove_from_list", label: "Remove from list…", icon: ListMinus },
  { action: "assign", label: "Assign…", icon: UserPlus },
  { action: "move_stage", label: "Move to stage…", icon: ArrowRightLeft },
];

function BusinessCard({ row, actions }: { row: BusinessListItem; actions: React.ReactNode }) {
  const location = shortLocation(row.location);
  const contact = [
    {
      label: "Phone",
      value: row.phone?.international ?? row.phone?.value ?? null,
      state: row.states.phone,
    },
    { label: "Email", value: row.email?.value ?? null, state: row.states.email },
    {
      label: "Website",
      value: row.website?.domain ?? row.website?.value ?? null,
      state: row.states.website,
    },
  ];
  return (
    <div className="flex min-w-0 flex-col gap-2.5">
      <div className="flex min-w-0 items-start gap-2">
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <Link
            href={`/app/businesses/${row.id}`}
            className="break-anywhere rounded-xs text-sm font-medium hover:underline"
          >
            {row.states.name === "expired" ? EXPIRED_NAME_LABEL : row.name}
          </Link>
          {row.categories.length ? (
            <span className="text-muted-foreground break-anywhere text-xs">
              {row.categories.slice(0, 3).join(" · ")}
            </span>
          ) : null}
          {location ? <span className="break-anywhere text-xs">{location}</span> : null}
        </div>
        <span className="-mr-1 -mt-1 shrink-0">{actions}</span>
      </div>
      <dl className="grid min-w-0 grid-cols-1 gap-2 text-[13px]">
        {contact.map((c) => (
          <div key={c.label} className="flex min-w-0 flex-col gap-0.5">
            <dt className="text-muted-foreground text-xs">{c.label}</dt>
            <dd className="flex min-w-0 flex-col gap-0.5">
              {c.state === "missing" ? (
                <span className="text-muted-foreground">No {c.label.toLowerCase()}</span>
              ) : (
                <>
                  {c.value ? <span className="break-anywhere">{c.value}</span> : null}
                  <FieldStatus state={c.state} size="sm" />
                </>
              )}
            </dd>
          </div>
        ))}
      </dl>
      <p className="text-[13px] tabular-nums" data-testid="card-scores">
        {row.score ? (
          <>
            Fit {row.score.fit}
            <span className="text-muted-foreground"> / 100</span> · Data confidence{" "}
            {row.score.dataConfidence}
            <span className="text-muted-foreground"> / 100</span>
          </>
        ) : (
          <span className="text-muted-foreground">Not scored yet</span>
        )}
      </p>
      {row.whatsapp !== "unknown" || row.suppressed ? (
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          {row.whatsapp !== "unknown" ? (
            <WhatsAppIndicator status={row.whatsapp} size="sm" />
          ) : null}
          {row.suppressed ? (
            <span className="text-warning inline-flex items-center gap-1 text-xs font-medium">
              <EyeOff aria-hidden className="size-3.5" /> Suppressed
            </span>
          ) : null}
        </div>
      ) : null}
      <p className="text-muted-foreground break-anywhere text-xs">
        {row.sources.map((src) => sourceLabel(src, true)).join(", ") || "No sources"} · Updated{" "}
        {formatDate(row.updatedAt)}
      </p>
    </div>
  );
}

const DENSITY_KEY = "lf.directory.density";
const COLUMNS_KEY = "lf.directory.columns";

function readStored<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function writeStored(key: string, value: unknown) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage unavailable: the preference lasts for this visit only */
  }
}

/**
 * Business directory (/app/businesses): server-side cursor pagination and sorting, debounced
 * search and facet filters mirrored in the URL, row selection with export and suppress, and
 * loading, empty, error and success states. Never loads more than one page into the browser.
 */
export function BusinessDirectory() {
  const { org } = useWorkspace();
  const {
    can,
    canWriteBusinesses,
    canExport,
    canRunAnalysis,
    canManageLists,
    canAssignLeads,
    canWorkLeads,
  } = usePermissions();
  const allowed = (a: BulkAction) =>
    a === "assign" ? canAssignLeads : a === "move_stage" ? canWorkLeads : canManageLists;
  const bulkActions = BULK_ACTIONS.filter((b) => allowed(b.action));
  const queryClient = useQueryClient();
  const searchParams = useSearchParams();
  const [state, setState] = useUrlState(parseDirectoryParams, serializeDirectoryState);

  // Cursor stack per view: changing a filter, the sort or the page size starts at page one in the
  // same render, so a cursor is never replayed under a different sort.
  const viewKey = JSON.stringify(toListQuery(state));
  const [pager, setPager] = useState<{ key: string; cursors: (string | null)[] }>({
    key: viewKey,
    cursors: [null],
  });
  const cursors = pager.key === viewKey ? pager.cursors : [null];
  const cursor = cursors[cursors.length - 1] ?? null;

  const [selection, setSelection] = useState<{ key: string; value: RowSelectionState }>({
    key: viewKey,
    value: {},
  });
  const rowSelection = selection.key === viewKey ? selection.value : {};

  const [density, setDensity] = useState<DataTableDensity>("comfortable");
  const [visibility, setVisibility] = useState<VisibilityState>({ ...DEFAULT_HIDDEN_COLUMNS });
  useEffect(() => {
    setDensity(readStored<DataTableDensity>(DENSITY_KEY, "comfortable"));
    setVisibility(readStored<VisibilityState>(COLUMNS_KEY, { ...DEFAULT_HIDDEN_COLUMNS }));
  }, []);

  const [suppressIds, setSuppressIds] = useState<string[] | null>(null);
  const [analyze, setAnalyze] = useState<{ ids: string[]; clear: () => void } | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [bulk, setBulk] = useState<{ action: BulkAction; target: Target } | null>(null);
  const [exportTarget, setExportTarget] = useState<Target | null>(null);

  // /app/businesses?add=1 (from the page search) opens the Add dialog for roles that can write.
  const addParam = searchParams.get("add") === "1";
  useEffect(() => {
    if (!addParam) return;
    if (canWriteBusinesses) setAddOpen(true);
    const qs = serializeDirectoryState(state).toString();
    window.history.replaceState(null, "", qs ? `/app/businesses?${qs}` : "/app/businesses");
  }, [addParam, canWriteBusinesses, state]);

  const listQuery = toListQuery(state, cursor);
  const list = useBusinessList(listQuery);
  const facets = useBusinessFacets();
  const importJob = useQuery({
    queryKey: queryKeys.imports.detail(org.id, state.importId ?? "none"),
    queryFn: () => apiFetch<ImportJob>(`/imports/${state.importId}`),
    enabled: Boolean(state.importId),
    retry: false,
  });

  const firstPage =
    cursor === null
      ? list.data
      : queryClient.getQueryData<PagedEnvelope<BusinessListItem>>(
          queryKeys.businesses.list(org.id, toListQuery(state, null)),
        );
  const total = firstPage?.meta.total;
  const totalApprox = firstPage?.meta.totalApprox;
  const rows = list.data?.data ?? [];
  const filtersApplied = activeFilterCount(state) > 0 || Boolean(state.q);

  const sorting: SortingState = [{ id: state.sort.field, desc: state.sort.direction === "desc" }];
  const onSortingChange = (updater: SortingState | ((old: SortingState) => SortingState)) => {
    const next = typeof updater === "function" ? updater(sorting) : updater;
    const first = next[0];
    setState({
      ...state,
      sort:
        first && isSortField(first.id)
          ? { field: first.id, direction: first.desc ? "desc" : "asc" }
          : DEFAULT_SORT,
    });
  };

  const canSelect = canWriteBusinesses || canExport || canRunAnalysis || bulkActions.length > 0;
  const names = useMemo(
    () =>
      Object.fromEntries(
        rows.map((r) => [r.id, r.states.name === "expired" ? EXPIRED_NAME_LABEL : r.name]),
      ),
    [rows],
  );
  const columns = useMemo(
    () =>
      businessColumns({
        canSuppress: canWriteBusinesses,
        onSuppress: (row) => setSuppressIds([row.id]),
      }),
    [canWriteBusinesses],
  );

  const knownCount = typeof total === "number" ? total : null;
  /** Bulk selections by id go up to 1,000 per request; larger ones use "all results" (the filters). */
  const openBulk = (action: BulkAction, target: Target) => {
    if (target.kind === "ids" && target.ids.length > BULK_LIMITS.idsPerRequest) {
      toast.error(`Select at most ${formatNumber(BULK_LIMITS.idsPerRequest)} businesses`, {
        description:
          "Or narrow the filters and use Act on all results, which applies to every match.",
      });
      return;
    }
    setBulk({ action, target });
  };
  const bulkSelection: BulkSelection | null = bulk
    ? bulk.target.kind === "ids"
      ? { ids: bulk.target.ids }
      : { filter: toRequestFilter(state) }
    : null;
  const exportRequest: CreateExportRequest | null = exportTarget
    ? exportTarget.kind === "ids"
      ? { kind: "selection", ids: exportTarget.ids }
      : { kind: "directory", filter: toRequestFilter(state) }
    : null;

  const listError = list.isError && !list.data ? list.error : null;
  const facetsSummary = facets.data
    ? facets.data.sources
        .map((s) => `${sourceLabel(s.value)} (${formatNumber(s.count)})`)
        .join(", ")
    : null;

  const empty = filtersApplied ? (
    <EmptyState
      size="compact"
      icon={SearchX}
      title="No businesses match"
      description={
        state.q
          ? `Nothing matches “${state.q}” with these filters. Search matches the start of words in names, places, domains, emails and phone digits.`
          : "Try removing a filter. Suppressed businesses stay hidden unless you include them."
      }
      action={
        activeFilterCount(state) > 0 ? (
          <Button variant="outline" onClick={() => setState(clearedFilters(state))}>
            Clear filters
          </Button>
        ) : undefined
      }
    />
  ) : (
    <EmptyState
      icon={Building2}
      title="No businesses yet"
      description={
        canWriteBusinesses
          ? "Create a discovery job, import a CSV of businesses you already have, or add one by hand. Every value keeps its source, so you can see where each contact detail came from."
          : "Businesses appear here once a researcher or administrator discovers, imports or adds them."
      }
      action={
        canWriteBusinesses ? (
          <>
            {can("discovery:run") ? (
              <Button asChild>
                <Link href="/app/discovery/new">
                  <Compass aria-hidden /> Create discovery job
                </Link>
              </Button>
            ) : null}
            <Button asChild variant={can("discovery:run") ? "outline" : "primary"}>
              <Link href="/app/businesses/import">
                <FileUp aria-hidden /> Import CSV
              </Link>
            </Button>
            <Button variant="outline" onClick={() => setAddOpen(true)}>
              <Plus aria-hidden /> Add business
            </Button>
          </>
        ) : undefined
      }
    />
  );

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <PageHeader
        eyebrow="Workspace"
        title="Businesses"
        description={`Every business in ${org.name}, with the state and source of each contact detail.`}
        actions={
          <>
            <Button asChild variant="outline">
              <Link href="/app/businesses/duplicates">
                <CopyCheck aria-hidden /> Review duplicates
              </Link>
            </Button>
            {bulkActions.length ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" disabled={rows.length === 0}>
                    Act on all results <ChevronDown aria-hidden />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuLabel>
                    {knownCount !== null
                      ? `All ${plural(knownCount, "matching business", "matching businesses")}`
                      : "Every business the filters match"}
                  </DropdownMenuLabel>
                  {bulkActions.map((b) => (
                    <DropdownMenuItem
                      key={b.action}
                      onSelect={() => openBulk(b.action, { kind: "filter" })}
                    >
                      <b.icon aria-hidden /> {b.label}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            ) : null}
            {canExport ? (
              <Button
                variant="outline"
                onClick={() => setExportTarget({ kind: "filter" })}
                disabled={rows.length === 0 && !list.isPending}
              >
                <Download aria-hidden /> Export
              </Button>
            ) : null}
            {canWriteBusinesses ? (
              <>
                <Button asChild variant="outline">
                  <Link href="/app/businesses/import">
                    <FileUp aria-hidden /> Import CSV
                  </Link>
                </Button>
                <Button onClick={() => setAddOpen(true)}>
                  <Plus aria-hidden /> Add business
                </Button>
              </>
            ) : null}
          </>
        }
      />

      <DataTable
        caption="Businesses"
        columns={columns}
        data={rows}
        getRowId={(r) => r.id}
        loading={list.isPending}
        skeletonRows={8}
        error={
          listError ? (
            <ErrorState
              title={
                isForbidden(listError) ? "You cannot view businesses" : "Could not load businesses"
              }
              message={friendlyMessage(listError)}
              requestId={requestIdOf(listError)}
              onRetry={isForbidden(listError) ? undefined : () => void list.refetch()}
            />
          ) : undefined
        }
        empty={empty}
        sorting={sorting}
        onSortingChange={onSortingChange}
        enableRowSelection={canSelect}
        rowSelection={rowSelection}
        onRowSelectionChange={(updater) =>
          setSelection({
            key: viewKey,
            value: typeof updater === "function" ? updater(rowSelection) : updater,
          })
        }
        bulkActions={({ ids, clear }) => (
          <>
            {canManageLists ? (
              <Button
                variant="outline"
                size="sm"
                className="border-secondary-foreground/40 text-secondary-foreground"
                onClick={() => openBulk("add_to_list", { kind: "ids", ids, clear })}
              >
                <ListPlus aria-hidden /> Add to list
              </Button>
            ) : null}
            {bulkActions.some((b) => b.action !== "add_to_list") ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="outline"
                    size="sm"
                    className="border-secondary-foreground/40 text-secondary-foreground"
                  >
                    Lead actions <ChevronDown aria-hidden />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start">
                  {bulkActions
                    .filter((b) => b.action !== "add_to_list")
                    .map((b) => (
                      <DropdownMenuItem
                        key={b.action}
                        onSelect={() => openBulk(b.action, { kind: "ids", ids, clear })}
                      >
                        <b.icon aria-hidden /> {b.label}
                      </DropdownMenuItem>
                    ))}
                </DropdownMenuContent>
              </DropdownMenu>
            ) : null}
            {canRunAnalysis ? (
              <Button
                variant="outline"
                size="sm"
                className="border-secondary-foreground/40 text-secondary-foreground"
                onClick={() => setAnalyze({ ids, clear })}
              >
                <Globe aria-hidden /> Analyze websites
              </Button>
            ) : null}
            {canExport ? (
              <Button
                variant="outline"
                size="sm"
                className="border-secondary-foreground/40 text-secondary-foreground"
                onClick={() => setExportTarget({ kind: "ids", ids, clear })}
              >
                <Download aria-hidden /> Export selected
              </Button>
            ) : null}
            {canWriteBusinesses ? (
              <Button variant="destructive" size="sm" onClick={() => setSuppressIds(ids)}>
                <EyeOff aria-hidden /> Suppress
              </Button>
            ) : null}
          </>
        )}
        columnVisibility={visibility}
        onColumnVisibilityChange={(updater) => {
          const next = typeof updater === "function" ? updater(visibility) : updater;
          setVisibility(next);
          writeStored(COLUMNS_KEY, next);
        }}
        density={density}
        onDensityChange={(d) => {
          setDensity(d);
          writeStored(DENSITY_KEY, d);
        }}
        stickyFirstColumn
        mobileCards={{
          render: (row) => (
            <BusinessCard
              row={row}
              actions={
                <RowActions
                  row={row}
                  handlers={{
                    canSuppress: canWriteBusinesses,
                    onSuppress: (r) => setSuppressIds([r.id]),
                  }}
                />
              }
            />
          ),
        }}
        toolbar={
          <div className="flex min-w-0 flex-col gap-2">
            <DirectoryFilters
              state={state}
              onChange={(next: DirectoryState) => setState(next)}
              facets={facets.data}
              facetsLoading={facets.isPending}
              importLabel={importJob.data?.fileName ?? null}
            />
            <p className="text-muted-foreground min-w-0 text-xs" aria-live="polite">
              {typeof total === "number"
                ? `${plural(total, "business", "businesses")}${filtersApplied ? " match" : ""}`
                : totalApprox
                  ? `More than ${formatNumber(totalApprox)} businesses match`
                  : list.isPending
                    ? "Loading businesses"
                    : null}
              {facetsSummary ? ` · Sources: ${facetsSummary}` : null}
              {facets.data ? ` · Counts as of ${formatRelative(facets.data.generatedAt)}` : null}
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
              onPageSizeChange={(pageSize) => setState({ ...state, pageSize })}
              pageCount={rows.length}
              totalCount={typeof total === "number" ? total : null}
              loading={list.isFetching && list.isPlaceholderData}
              itemLabel="businesses"
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

      {canRunAnalysis ? (
        <BulkAnalyzeDialog
          ids={analyze?.ids ?? []}
          names={names}
          open={analyze !== null}
          onOpenChange={(o) => !o && setAnalyze(null)}
          onDone={() => analyze?.clear()}
        />
      ) : null}

      {canWriteBusinesses ? (
        <>
          <AddBusinessDialog open={addOpen} onOpenChange={setAddOpen} />
          <BulkSuppressDialog
            ids={suppressIds ?? []}
            open={suppressIds !== null}
            onOpenChange={(o) => !o && setSuppressIds(null)}
            onDone={(done) => {
              const next = { ...rowSelection };
              for (const id of done) delete next[id];
              setSelection({ key: viewKey, value: next });
            }}
          />
        </>
      ) : null}

      {bulk && bulkSelection ? (
        <BulkActionDialog
          open
          onOpenChange={(o) => !o && setBulk(null)}
          action={bulk.action}
          selection={bulkSelection}
          count={bulk.target.kind === "ids" ? bulk.target.ids.length : knownCount}
          onCreated={() => {
            if (bulk.target.kind === "ids") bulk.target.clear();
          }}
        />
      ) : null}

      {canExport ? (
        <ExportDialog
          open={exportTarget !== null}
          onOpenChange={(o) => !o && setExportTarget(null)}
          request={exportRequest}
          what={
            exportTarget?.kind === "ids"
              ? selectionPhrase({ ids: exportTarget.ids }, null)
              : selectionPhrase({ filter: toRequestFilter(state) }, knownCount)
          }
          count={
            exportTarget?.kind === "ids"
              ? exportTarget.ids.length
              : (knownCount ?? totalApprox ?? null)
          }
        />
      ) : null}
    </div>
  );
}
