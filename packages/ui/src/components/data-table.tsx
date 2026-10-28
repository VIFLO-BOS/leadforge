"use client";

import * as React from "react";
import {
  flexRender,
  getCoreRowModel,
  useReactTable,
  type Cell,
  type ColumnDef,
  type Header,
  type OnChangeFn,
  type Row,
  type RowData,
  type RowSelectionState,
  type SortingState,
  type VisibilityState,
} from "@tanstack/react-table";
import { ArrowDown, ArrowUp, ArrowUpDown, Columns3, Rows3, X } from "lucide-react";
import { cn } from "../lib/cn";
import { MEDIA, useMediaQuery } from "../hooks/use-media-query";
import { Button } from "./button";
import { Checkbox } from "./toggles";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "./dropdown-menu";
import { Skeleton } from "./states";

declare module "@tanstack/react-table" {
  // Generic parameters must match the library's declaration.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  interface ColumnMeta<TData extends RowData, TValue> {
    /** Plain-text name for the column menu and mobile cards when the header is not a string. */
    label?: string;
    align?: "start" | "center" | "end";
    /** Leave this column out of the stacked mobile card. */
    hideOnMobile?: boolean;
    /** Use this column as the mobile card title. Defaults to the first visible data column. */
    mobileTitle?: boolean;
    /** Render this column (row actions) unlabelled at the end of the mobile card. */
    mobileActions?: boolean;
    headerClassName?: string;
    cellClassName?: string;
  }
}

export type DataTableDensity = "comfortable" | "compact";

export interface DataTableBulkContext<TData> {
  /** Every selected row ID, including rows on other pages (server-side selection). */
  ids: string[];
  /** Selected rows present in the current page of data. */
  rows: TData[];
  clear: () => void;
}

export interface DataTableMobileCards<TData> {
  /** Custom card body. Defaults to a label/value list of the visible columns. */
  render?: (row: TData) => React.ReactNode;
}

export interface DataTableProps<TData> {
  // TanStack column definitions are invariant in their value type; `any` is the library's own
  // recommendation for heterogeneous column arrays.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  columns: ColumnDef<TData, any>[];
  data: TData[];
  getRowId: (row: TData) => string;
  /** Accessible name of the table and its scroll region, for example "Businesses". */
  caption: string;
  loading?: boolean;
  skeletonRows?: number;
  /** Rendered instead of rows when the request failed (use ErrorState). */
  error?: React.ReactNode;
  /** Rendered when there are no rows and nothing is loading (use EmptyState). */
  empty?: React.ReactNode;

  /** Server-side sorting: the table reports the requested sort; the caller refetches. */
  sorting?: SortingState;
  onSortingChange?: OnChangeFn<SortingState>;

  enableRowSelection?: boolean | ((row: Row<TData>) => boolean);
  rowSelection?: RowSelectionState;
  onRowSelectionChange?: OnChangeFn<RowSelectionState>;
  /** Actions shown in the bulk-action bar while rows are selected. */
  bulkActions?: (context: DataTableBulkContext<TData>) => React.ReactNode;

  columnVisibility?: VisibilityState;
  onColumnVisibilityChange?: OnChangeFn<VisibilityState>;
  enableColumnVisibility?: boolean;

  density?: DataTableDensity;
  onDensityChange?: (density: DataTableDensity) => void;
  enableDensityToggle?: boolean;

  /** Keep the first data column (and the selection column) visible while scrolling sideways. */
  stickyFirstColumn?: boolean;
  /** Under 480px render each row as a stacked card instead of a scrolling table. */
  mobileCards?: boolean | DataTableMobileCards<TData>;

  /** Left side of the toolbar: search, FilterBar. */
  toolbar?: React.ReactNode;
  /** Below the table: Pagination. */
  footer?: React.ReactNode;
  className?: string;
}

const SELECT_COLUMN_ID = "__select";

function columnLabel<TData>(
  header: Header<TData, unknown> | undefined,
  id: string,
  meta?: { label?: string },
) {
  if (meta?.label) return meta.label;
  const h = header?.column.columnDef.header;
  return typeof h === "string" ? h : id;
}

/**
 * Server-side data table on TanStack Table.
 * - The table sits in a focusable, labelled scroll region with edge fades that show when more
 *   columns are off-screen; the page itself never scrolls sideways.
 * - Sorting, selection, visibility and density are controllable; selection keeps IDs across pages.
 * - With `mobileCards`, rows become stacked cards under 480px.
 * No row animations: tables update in place.
 */
export function DataTable<TData>({
  columns,
  data,
  getRowId,
  caption,
  loading = false,
  skeletonRows = 6,
  error,
  empty,
  sorting,
  onSortingChange,
  enableRowSelection = false,
  rowSelection: rowSelectionProp,
  onRowSelectionChange,
  bulkActions,
  columnVisibility: visibilityProp,
  onColumnVisibilityChange,
  enableColumnVisibility = true,
  density: densityProp,
  onDensityChange,
  enableDensityToggle = true,
  stickyFirstColumn = false,
  mobileCards = false,
  toolbar,
  footer,
  className,
}: DataTableProps<TData>) {
  const narrow = useMediaQuery(MEDIA.narrow);
  const [innerSelection, setInnerSelection] = React.useState<RowSelectionState>({});
  const [innerVisibility, setInnerVisibility] = React.useState<VisibilityState>({});
  const [innerDensity, setInnerDensity] = React.useState<DataTableDensity>("comfortable");
  const rowSelection = rowSelectionProp ?? innerSelection;
  const columnVisibility = visibilityProp ?? innerVisibility;
  const density = densityProp ?? innerDensity;
  const setDensity = (d: DataTableDensity) => {
    if (densityProp === undefined) setInnerDensity(d);
    onDensityChange?.(d);
  };

  const selectable = enableRowSelection !== false;

  const allColumns = React.useMemo<ColumnDef<TData, unknown>[]>(() => {
    if (!selectable) return columns;
    const selectColumn: ColumnDef<TData, unknown> = {
      id: SELECT_COLUMN_ID,
      enableSorting: false,
      enableHiding: false,
      // The fixed-width wrappers keep this column exactly 48px (16px padding + 32px) even when the
      // table overflows and auto layout shrinks columns to min-content; stickyFirstColumn offsets
      // the next column by that 48px.
      header: ({ table }) => (
        <span className="flex w-8 items-center">
          <Checkbox
            aria-label="Select all rows on this page"
            checked={
              table.getIsAllPageRowsSelected()
                ? true
                : table.getIsSomePageRowsSelected()
                  ? "indeterminate"
                  : false
            }
            onCheckedChange={(v) => table.toggleAllPageRowsSelected(v === true)}
          />
        </span>
      ),
      cell: ({ row }) => (
        <span className="flex w-8 items-center">
          <Checkbox
            aria-label={`Select row ${row.index + 1}`}
            checked={row.getIsSelected()}
            disabled={!row.getCanSelect()}
            onCheckedChange={(v) => row.toggleSelected(v === true)}
          />
        </span>
      ),
    };
    return [selectColumn, ...columns];
  }, [columns, selectable]);

  const table = useReactTable({
    data,
    columns: allColumns,
    getRowId,
    getCoreRowModel: getCoreRowModel(),
    manualSorting: true,
    manualPagination: true,
    manualFiltering: true,
    enableSortingRemoval: true,
    enableRowSelection,
    state: {
      sorting: sorting ?? [],
      rowSelection,
      columnVisibility,
    },
    onSortingChange,
    onRowSelectionChange: (updater) => {
      if (rowSelectionProp === undefined) setInnerSelection(updater);
      onRowSelectionChange?.(updater);
    },
    onColumnVisibilityChange: (updater) => {
      if (visibilityProp === undefined) setInnerVisibility(updater);
      onColumnVisibilityChange?.(updater);
    },
  });

  const selectedIds = Object.keys(rowSelection).filter((k) => rowSelection[k]);
  const selectedRows = table.getSelectedRowModel().rows.map((r) => r.original);
  const clearSelection = () => table.resetRowSelection(true);

  const hideable = table.getAllLeafColumns().filter((c) => c.getCanHide());
  const headerGroup = table.getHeaderGroups()[0];
  const headerById = new Map(headerGroup?.headers.map((h) => [h.column.id, h]) ?? []);
  const visibleColumns = table.getVisibleLeafColumns();
  const dataColumns = visibleColumns.filter((c) => c.id !== SELECT_COLUMN_ID);
  const firstDataColumnId = dataColumns[0]?.id;

  const showCards = Boolean(mobileCards) && narrow;
  const showToolbar =
    Boolean(toolbar) ||
    (!showCards && (enableDensityToggle || (enableColumnVisibility && hideable.length > 0)));
  const isEmpty = !loading && !error && data.length === 0;

  const viewControls = (
    <div className="flex shrink-0 items-center gap-1">
      {enableDensityToggle && !showCards ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" aria-label="Row density">
              <Rows3 aria-hidden />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuLabel>Row density</DropdownMenuLabel>
            <DropdownMenuRadioGroup
              value={density}
              onValueChange={(v) => setDensity(v as DataTableDensity)}
            >
              <DropdownMenuRadioItem value="comfortable">Comfortable</DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="compact">Compact</DropdownMenuRadioItem>
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
      {enableColumnVisibility && hideable.length > 0 && !showCards ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" aria-label="Show or hide columns">
              <Columns3 aria-hidden />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuLabel>Columns</DropdownMenuLabel>
            <DropdownMenuSeparator />
            {hideable.map((column) => (
              <DropdownMenuCheckboxItem
                key={column.id}
                checked={column.getIsVisible()}
                onCheckedChange={(v) => column.toggleVisibility(v === true)}
                onSelect={(e) => e.preventDefault()}
              >
                {columnLabel(
                  headerById.get(column.id) as Header<TData, unknown> | undefined,
                  column.id,
                  column.columnDef.meta,
                )}
              </DropdownMenuCheckboxItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
    </div>
  );

  return (
    <div className={cn("flex min-w-0 flex-col gap-3", className)}>
      {showToolbar ? (
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <div className="min-w-0 flex-1">{toolbar}</div>
          {viewControls}
        </div>
      ) : null}

      {selectable && selectedIds.length > 0 ? (
        <div
          role="region"
          aria-label="Bulk actions"
          // Under 480px rows are tall cards, so the bar sticks below the 56px top app bar and
          // stays reachable while the user selects further down the list.
          className="bg-secondary text-secondary-foreground max-[479.98px]:shadow-2 flex min-w-0 flex-col gap-2 rounded-lg px-3 py-2 max-[479.98px]:sticky max-[479.98px]:top-16 max-[479.98px]:z-20 min-[480px]:flex-row min-[480px]:items-center"
        >
          <div className="flex min-w-0 items-center gap-1">
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={clearSelection}
              aria-label="Clear selection"
              className="text-secondary-foreground"
            >
              <X aria-hidden />
            </Button>
            <p className="text-sm font-medium" aria-live="polite">
              {selectedIds.length} selected
            </p>
          </div>
          {bulkActions ? (
            <div className="flex min-w-0 flex-col gap-2 min-[480px]:ml-auto min-[480px]:flex-row min-[480px]:flex-wrap min-[480px]:items-center [&>*]:w-full min-[480px]:[&>*]:w-auto">
              {bulkActions({ ids: selectedIds, rows: selectedRows, clear: clearSelection })}
            </div>
          ) : null}
        </div>
      ) : null}

      {showCards ? (
        <MobileCards
          table={table}
          caption={caption}
          loading={loading}
          skeletonRows={skeletonRows}
          error={error}
          empty={isEmpty ? empty : null}
          render={typeof mobileCards === "object" ? mobileCards.render : undefined}
          headerById={headerById as Map<string, Header<TData, unknown>>}
        />
      ) : (
        // "<caption> table": the enclosing page section often carries the caption as its name.
        <ScrollRegion label={`${caption} table`}>
          <table
            className={cn(
              "w-full min-w-full border-separate border-spacing-0 text-left",
              density === "compact" ? "text-xs" : "text-[13px]",
            )}
            aria-busy={loading || undefined}
            aria-rowcount={loading ? undefined : data.length + 1}
          >
            <caption className="sr-only">{caption}</caption>
            <thead>
              <tr>
                {headerGroup?.headers.map((header) => {
                  const meta = header.column.columnDef.meta;
                  const sorted = header.column.getIsSorted();
                  const canSort = header.column.getCanSort() && Boolean(onSortingChange);
                  const sticky = stickyClass(
                    header.column.id,
                    firstDataColumnId,
                    selectable,
                    stickyFirstColumn,
                  );
                  return (
                    <th
                      key={header.id}
                      scope="col"
                      aria-sort={
                        canSort
                          ? sorted === "asc"
                            ? "ascending"
                            : sorted === "desc"
                              ? "descending"
                              : "none"
                          : undefined
                      }
                      className={cn(
                        "bg-surface-container-low text-muted-foreground border-border h-11 whitespace-nowrap border-b px-3 text-xs font-medium first:pl-4 last:pr-4",
                        header.column.id === SELECT_COLUMN_ID && "w-12 pr-0",
                        meta?.align === "end" && "text-right",
                        meta?.align === "center" && "text-center",
                        sticky,
                        meta?.headerClassName,
                      )}
                    >
                      {header.isPlaceholder ? null : canSort ? (
                        <button
                          type="button"
                          onClick={header.column.getToggleSortingHandler()}
                          className={cn(
                            "hover:text-foreground rounded-xs -mx-1.5 inline-flex items-center gap-1 px-1.5 py-1",
                            sorted && "text-foreground",
                            meta?.align === "end" && "flex-row-reverse",
                          )}
                        >
                          {flexRender(header.column.columnDef.header, header.getContext())}
                          {sorted === "asc" ? (
                            <ArrowUp aria-hidden className="size-3.5" />
                          ) : sorted === "desc" ? (
                            <ArrowDown aria-hidden className="size-3.5" />
                          ) : (
                            <ArrowUpDown aria-hidden className="size-3.5 opacity-60" />
                          )}
                        </button>
                      ) : (
                        flexRender(header.column.columnDef.header, header.getContext())
                      )}
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody
              key={loading ? "loading" : "ready"}
              className={cn(
                !loading && "animate-in fade-in-0 duration-300 motion-reduce:animate-none",
              )}
            >
              {loading ? (
                Array.from({ length: skeletonRows }).map((_, i) => (
                  <tr key={`skeleton-${i}`}>
                    {visibleColumns.map((c) => (
                      <td
                        key={c.id}
                        className={cn(
                          "border-border border-b px-3 first:pl-4 last:pr-4",
                          density === "compact" ? "h-10" : "h-[52px]",
                        )}
                      >
                        <Skeleton
                          className={
                            c.id === SELECT_COLUMN_ID ? "size-[18px]" : "h-4 w-full max-w-40"
                          }
                        />
                      </td>
                    ))}
                  </tr>
                ))
              ) : error || isEmpty ? (
                <tr>
                  <td colSpan={visibleColumns.length} className="p-4">
                    {error ?? empty ?? (
                      <p className="text-muted-foreground py-6 text-center text-sm">No rows.</p>
                    )}
                  </td>
                </tr>
              ) : (
                table.getRowModel().rows.map((row) => (
                  <tr
                    key={row.id}
                    data-state={row.getIsSelected() ? "selected" : undefined}
                    className="group/row"
                  >
                    {row.getVisibleCells().map((cell) => (
                      <BodyCell
                        key={cell.id}
                        cell={cell}
                        density={density}
                        sticky={stickyClass(
                          cell.column.id,
                          firstDataColumnId,
                          selectable,
                          stickyFirstColumn,
                        )}
                      />
                    ))}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </ScrollRegion>
      )}

      {footer}
    </div>
  );
}

function stickyClass(
  columnId: string,
  firstDataColumnId: string | undefined,
  selectable: boolean,
  enabled: boolean,
): string | undefined {
  if (!enabled) return undefined;
  if (columnId === SELECT_COLUMN_ID) return "sticky left-0 z-[2]";
  if (columnId === firstDataColumnId)
    return cn(
      "sticky z-[2] shadow-[inset_-1px_0_0_var(--border)]",
      selectable ? "left-12" : "left-0",
    );
  return undefined;
}

function BodyCell<TData>({
  cell,
  density,
  sticky,
}: {
  cell: Cell<TData, unknown>;
  density: DataTableDensity;
  sticky?: string;
}) {
  const meta = cell.column.columnDef.meta;
  return (
    <td
      className={cn(
        "border-border bg-surface group-hover/row:bg-surface-container-low group-data-[state=selected]/row:bg-primary-subtle border-b px-3 align-middle first:pl-4 last:pr-4",
        density === "compact" ? "h-10 py-1.5" : "h-[52px] py-2.5",
        cell.column.id === SELECT_COLUMN_ID && "w-12 pr-0",
        meta?.align === "end" && "text-right tabular-nums",
        meta?.align === "center" && "text-center",
        sticky,
        meta?.cellClassName,
      )}
    >
      {flexRender(cell.column.columnDef.cell, cell.getContext())}
    </td>
  );
}

/**
 * Focusable, labelled horizontal scroll container with edge fades that appear only when content
 * extends past that edge. Keyboard users can focus it and scroll with arrow keys.
 */
export function ScrollRegion({
  label,
  children,
  className,
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  const ref = React.useRef<HTMLDivElement>(null);
  const [edges, setEdges] = React.useState({ start: false, end: false });

  React.useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => {
      const max = el.scrollWidth - el.clientWidth;
      setEdges({ start: el.scrollLeft > 1, end: el.scrollLeft < max - 1 });
    };
    update();
    el.addEventListener("scroll", update, { passive: true });
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(update) : null;
    ro?.observe(el);
    if (el.firstElementChild) ro?.observe(el.firstElementChild);
    return () => {
      el.removeEventListener("scroll", update);
      ro?.disconnect();
    };
  }, []);

  return (
    <div
      className={cn(
        "border-border bg-surface relative min-w-0 overflow-hidden rounded-lg border",
        className,
      )}
    >
      <div
        ref={ref}
        role="region"
        aria-label={label}
        tabIndex={0}
        data-scroll-start={edges.start || undefined}
        data-scroll-end={edges.end || undefined}
        className="scrollbar-thin min-w-0 overflow-x-auto focus-visible:outline-offset-[-2px]"
      >
        {children}
      </div>
      <span
        aria-hidden
        className={cn(
          "from-surface pointer-events-none absolute inset-y-0 left-0 z-[3] w-6 bg-gradient-to-r to-transparent transition-opacity duration-150",
          edges.start ? "opacity-100" : "opacity-0",
        )}
      />
      <span
        aria-hidden
        className={cn(
          "from-surface pointer-events-none absolute inset-y-0 right-0 z-[3] w-8 bg-gradient-to-l to-transparent transition-opacity duration-150",
          edges.end ? "opacity-100" : "opacity-0",
        )}
      />
    </div>
  );
}

function MobileCards<TData>({
  table,
  caption,
  loading,
  skeletonRows,
  error,
  empty,
  render,
  headerById,
}: {
  table: ReturnType<typeof useReactTable<TData>>;
  caption: string;
  loading: boolean;
  skeletonRows: number;
  error?: React.ReactNode;
  empty?: React.ReactNode;
  render?: (row: TData) => React.ReactNode;
  headerById: Map<string, Header<TData, unknown>>;
}) {
  // Cards present on the first data render stagger in once; rows added later (polling) do not.
  const initialIds = React.useRef<Set<string> | null>(null);
  if (!loading && !error && initialIds.current === null) {
    initialIds.current = new Set(table.getRowModel().rows.map((r) => r.id));
  }
  if (loading) {
    return (
      <div role="status" aria-busy="true" aria-label={caption} className="flex flex-col gap-2">
        {Array.from({ length: Math.min(skeletonRows, 4) }).map((_, i) => (
          <Skeleton key={i} className="h-28 rounded-lg" />
        ))}
      </div>
    );
  }
  if (error) return <>{error}</>;
  if (empty) return <>{empty}</>;

  return (
    <ul aria-label={caption} className="flex min-w-0 flex-col gap-2">
      {table.getRowModel().rows.map((row, rowIndex) => {
        const cells = row.getVisibleCells();
        const entering = initialIds.current?.has(row.id) ?? false;
        const selectCell = cells.find((c) => c.column.id === SELECT_COLUMN_ID);
        const dataCells = cells.filter(
          (c) => c.column.id !== SELECT_COLUMN_ID && !c.column.columnDef.meta?.hideOnMobile,
        );
        const actionCells = dataCells.filter((c) => c.column.columnDef.meta?.mobileActions);
        const fieldCells = dataCells.filter((c) => !c.column.columnDef.meta?.mobileActions);
        const titleCell =
          fieldCells.find((c) => c.column.columnDef.meta?.mobileTitle) ?? fieldCells[0];
        const rest = fieldCells.filter((c) => c !== titleCell);
        return (
          <li
            key={row.id}
            data-state={row.getIsSelected() ? "selected" : undefined}
            style={entering ? { animationDelay: `${Math.min(rowIndex, 8) * 60}ms` } : undefined}
            className={cn(
              "border-border bg-surface data-[state=selected]:bg-primary-subtle transition-ui min-w-0 rounded-lg border p-3",
              entering &&
                "animate-in fade-in-0 slide-in-from-bottom-3 fill-mode-backwards duration-500 motion-reduce:animate-none",
            )}
          >
            <div className="flex min-w-0 items-start gap-3">
              {selectCell ? (
                <span className="flex h-6 items-center">
                  {flexRender(selectCell.column.columnDef.cell, selectCell.getContext())}
                </span>
              ) : null}
              <div className="flex min-w-0 flex-1 flex-col gap-2">
                {render ? (
                  render(row.original)
                ) : (
                  <>
                    {titleCell ? (
                      <div className="break-anywhere min-w-0 text-sm font-medium">
                        {flexRender(titleCell.column.columnDef.cell, titleCell.getContext())}
                      </div>
                    ) : null}
                    {rest.length > 0 ? (
                      <dl className="grid min-w-0 grid-cols-1 gap-x-3 gap-y-1.5 text-[13px]">
                        {rest.map((cell) => (
                          <div key={cell.id} className="flex min-w-0 flex-col">
                            <dt className="text-muted-foreground text-xs">
                              {columnLabel(
                                headerById.get(cell.column.id),
                                cell.column.id,
                                cell.column.columnDef.meta,
                              )}
                            </dt>
                            <dd className="break-anywhere min-w-0">
                              {flexRender(cell.column.columnDef.cell, cell.getContext())}
                            </dd>
                          </div>
                        ))}
                      </dl>
                    ) : null}
                    {actionCells.length > 0 ? (
                      <div className="flex min-w-0 flex-wrap items-center gap-2 empty:hidden">
                        {actionCells.map((cell) => (
                          <React.Fragment key={cell.id}>
                            {flexRender(cell.column.columnDef.cell, cell.getContext())}
                          </React.Fragment>
                        ))}
                      </div>
                    ) : null}
                  </>
                )}
              </div>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
