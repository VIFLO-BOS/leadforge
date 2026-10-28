"use client";

import type { ColumnDef, SortingState } from "@tanstack/react-table";
import { Ban, Building2, ListPlus } from "lucide-react";
import { useMemo, useState } from "react";
import {
  Button,
  Chip,
  Combobox,
  ConfirmDialog,
  DataTable,
  EmptyState,
  ErrorState,
  FieldStatus,
  FilterBar,
  Pagination,
  SearchField,
  SegmentedControl,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  toast,
  type ActiveFilter,
} from "@leadforge/ui";
import { Chart } from "@leadforge/ui/charts";
import {
  CITY_OPTIONS,
  INDUSTRY_OPTIONS,
  SAMPLE_BUSINESSES,
  type SampleBusiness,
} from "./sample-data";
import { Demo, GallerySection } from "./section";

type TableState = "data" | "loading" | "empty" | "error";

export function DataTableSection() {
  const [sorting, setSorting] = useState<SortingState>([{ id: "score", desc: true }]);
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(10);
  const [state, setState] = useState<TableState>("data");
  const [sticky, setSticky] = useState<"on" | "off">("on");
  const [confirm, setConfirm] = useState<{ ids: string[]; clear: () => void } | null>(null);

  // Simulates server-side sorting and cursor paging over the sample set.
  const sorted = useMemo(() => {
    const s = sorting[0];
    if (!s) return SAMPLE_BUSINESSES;
    const key = s.id as keyof SampleBusiness;
    return [...SAMPLE_BUSINESSES].sort((a, b) => {
      const av = a[key] ?? "";
      const bv = b[key] ?? "";
      const cmp =
        typeof av === "number" && typeof bv === "number"
          ? av - bv
          : String(av).localeCompare(String(bv));
      return s.desc ? -cmp : cmp;
    });
  }, [sorting]);
  const rows = sorted.slice(page * pageSize, page * pageSize + pageSize);

  const columns = useMemo<ColumnDef<SampleBusiness>[]>(
    () => [
      {
        id: "name",
        accessorKey: "name",
        header: "Business",
        meta: { label: "Business", mobileTitle: true },
        enableHiding: false,
        cell: ({ row }) => (
          <span className="flex min-w-0 flex-col">
            <span className="break-anywhere font-medium">{row.original.name}</span>
            <span className="text-muted-foreground text-xs">{row.original.industry}</span>
          </span>
        ),
      },
      { id: "city", accessorKey: "city", header: "Location", meta: { label: "Location" } },
      {
        id: "phone",
        header: "Phone",
        enableSorting: false,
        meta: { label: "Phone" },
        cell: ({ row }) => <FieldStatus state={row.original.phone} />,
      },
      {
        id: "email",
        header: "Email",
        enableSorting: false,
        meta: { label: "Email" },
        cell: ({ row }) => <FieldStatus state={row.original.email} />,
      },
      {
        id: "website",
        header: "Website",
        enableSorting: false,
        meta: { label: "Website", hideOnMobile: true },
        cell: ({ row }) =>
          row.original.website ? (
            <span className="break-anywhere">{row.original.website}</span>
          ) : (
            <span className="text-muted-foreground">No website was detected</span>
          ),
      },
      {
        id: "source",
        accessorKey: "source",
        header: "Source",
        enableSorting: false,
        meta: { label: "Source" },
        cell: ({ row }) => (
          <span className="text-muted-foreground whitespace-nowrap">{row.original.source}</span>
        ),
      },
      {
        id: "score",
        accessorKey: "score",
        header: "Fit score",
        meta: { label: "Fit score", align: "end" },
      },
    ],
    [],
  );

  return (
    <GallerySection
      id="data-table"
      title="DataTable and Pagination"
      description="Server-side TanStack table: labelled focusable scroll region with edge fades, sticky first column, density, column visibility, selection with a bulk-action bar, and stacked cards under 480px."
    >
      <Demo label="Demo controls">
        <SegmentedControl
          aria-label="Table state"
          size="sm"
          showCheck={false}
          value={state}
          onValueChange={setState}
          options={[
            { value: "data", label: "Data" },
            { value: "loading", label: "Loading" },
            { value: "empty", label: "Empty" },
            { value: "error", label: "Error" },
          ]}
        />
        <SegmentedControl
          aria-label="Sticky first column"
          size="sm"
          showCheck={false}
          value={sticky}
          onValueChange={setSticky}
          options={[
            { value: "on", label: "Sticky on" },
            { value: "off", label: "Sticky off" },
          ]}
        />
      </Demo>
      <DataTable
        caption="Businesses (Sample)"
        columns={columns}
        data={state === "data" ? rows : []}
        getRowId={(b) => b.id}
        loading={state === "loading"}
        error={
          state === "error" ? (
            <ErrorState
              message="The directory could not be loaded."
              requestId="req_SAMPLE_42"
              onRetry={() => setState("data")}
            />
          ) : undefined
        }
        empty={
          <EmptyState
            size="compact"
            icon={Building2}
            title="No businesses match"
            description="Try removing a filter, or import a CSV."
          />
        }
        sorting={sorting}
        onSortingChange={(u) => {
          setSorting(u);
          setPage(0);
        }}
        enableRowSelection
        bulkActions={({ ids, clear }) => (
          <>
            <Button
              size="sm"
              variant="tonal"
              onClick={() => toast("Add to list arrives in a later release (Sample).")}
            >
              <ListPlus aria-hidden /> Add to list
            </Button>
            <Button size="sm" variant="destructive" onClick={() => setConfirm({ ids, clear })}>
              <Ban aria-hidden /> Suppress
            </Button>
          </>
        )}
        stickyFirstColumn={sticky === "on"}
        mobileCards
        toolbar={
          <p className="text-muted-foreground text-xs">
            Sources shown per row. All records are fictional (Sample).
          </p>
        }
        footer={
          <Pagination
            hasPrevious={page > 0}
            hasNext={(page + 1) * pageSize < sorted.length}
            onPrevious={() => setPage((p) => Math.max(0, p - 1))}
            onNext={() => setPage((p) => p + 1)}
            pageSize={pageSize}
            onPageSizeChange={(n) => {
              setPageSize(n);
              setPage(0);
            }}
            pageSizeOptions={[5, 10, 25]}
            pageCount={state === "data" ? rows.length : 0}
            itemLabel="businesses"
          />
        }
      />
      <ConfirmDialog
        open={Boolean(confirm)}
        onOpenChange={(o) => !o && setConfirm(null)}
        title={`Suppress ${confirm?.ids.length ?? 0} businesses?`}
        description="Suppressed businesses are excluded from discovery and export for every workspace member."
        confirmPhrase={`SUPPRESS ${confirm?.ids.length ?? 0}`}
        confirmLabel="Suppress"
        destructive
        onConfirm={() => {
          toast.success(
            `Suppressed ${confirm?.ids.length ?? 0} sample records (nothing was changed).`,
          );
          confirm?.clear();
          setConfirm(null);
        }}
      >
        <p className="text-muted-foreground text-sm">This is a gallery demo; no records change.</p>
      </ConfirmDialog>
    </GallerySection>
  );
}

export function FilterBarSection() {
  const [industry, setIndustry] = useState<string | null>("bakery");
  const [city, setCity] = useState<string>("ikeja");
  const [verifiedOnly, setVerifiedOnly] = useState(true);
  const [query, setQuery] = useState("");

  const filters: ActiveFilter[] = [
    industry
      ? {
          id: "industry",
          label: `Industry: ${INDUSTRY_OPTIONS.find((o) => o.value === industry)?.label ?? industry}`,
          onRemove: () => setIndustry(null),
        }
      : null,
    city
      ? {
          id: "city",
          label: `Location: ${CITY_OPTIONS.find((o) => o.value === city)?.label ?? city}`,
          onRemove: () => setCity(""),
        }
      : null,
    verifiedOnly
      ? { id: "verified", label: "Phone: Verified", onRemove: () => setVerifiedOnly(false) }
      : null,
  ].filter((f): f is ActiveFilter => f !== null);

  return (
    <GallerySection
      id="filter-bar"
      title="FilterBar"
      description="Inline controls and removable chips from 768px; a Filters (n) button that opens a sheet below 768px."
    >
      <FilterBar
        filters={filters}
        onClearAll={() => {
          setIndustry(null);
          setCity("");
          setVerifiedOnly(false);
        }}
        search={
          <SearchField
            onDebouncedChange={setQuery}
            label="Search businesses"
            placeholder="Search businesses"
          />
        }
      >
        <Combobox
          aria-label="Industry"
          options={INDUSTRY_OPTIONS}
          value={industry}
          onValueChange={setIndustry}
          placeholder="Industry"
          className="w-full md:w-48"
        />
        <Select value={city || undefined} onValueChange={setCity}>
          <SelectTrigger aria-label="Location" className="w-full md:w-48">
            <SelectValue placeholder="Location" />
          </SelectTrigger>
          <SelectContent>
            {CITY_OPTIONS.map((o) => (
              <SelectItem key={o.value} value={o.value}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Chip variant="filter" selected={verifiedOnly} onClick={() => setVerifiedOnly((v) => !v)}>
          Verified phone
        </Chip>
      </FilterBar>
      <p className="text-muted-foreground text-xs" aria-live="polite">
        Search: {query ? `"${query}"` : "(empty)"} · {filters.length} filter
        {filters.length === 1 ? "" : "s"} applied
      </p>
    </GallerySection>
  );
}

const SOURCE_DATA = [
  { source: "Places API (Sample)", records: 412 },
  { source: "Business website (Sample)", records: 268 },
  { source: "CSV import (Sample)", records: 97 },
];

const JOBS_DATA = [
  { week: "Week 1", completed: 4, failed: 1 },
  { week: "Week 2", completed: 6, failed: 0 },
  { week: "Week 3", completed: 5, failed: 2 },
  { week: "Week 4", completed: 9, failed: 1 },
  { week: "Week 5", completed: 8, failed: 0 },
  { week: "Week 6", completed: 11, failed: 1 },
];

const CREDITS_DATA = [
  { day: "Mon", credits: 120 },
  { day: "Tue", credits: 180 },
  { day: "Wed", credits: 95 },
  { day: "Thu", credits: 210 },
  { day: "Fri", credits: 260 },
  { day: "Sat", credits: 40 },
  { day: "Sun", credits: 25 },
];

const QUALITY_DATA = [
  { band: "0 to 20", verified: 12, unverified: 30 },
  { band: "21 to 40", verified: 28, unverified: 41 },
  { band: "41 to 60", verified: 64, unverified: 52 },
  { band: "61 to 80", verified: 88, unverified: 37 },
  { band: "81 to 100", verified: 41, unverified: 9 },
];

export function ChartsSection() {
  return (
    <GallerySection
      id="charts"
      title="Charts"
      description="Recharts with a Chart or Table switch, compact under 480px. All values below are sample data."
      className="grid grid-cols-1 gap-4 xl:grid-cols-2"
    >
      <Chart
        type="bar"
        layout="horizontal"
        title="Records by source (Sample)"
        description="Business records produced per source in the last 30 days."
        data={SOURCE_DATA}
        xKey="source"
        xLabel="Source"
        series={[{ key: "records", label: "Records" }]}
        footnote="Sample data for the gallery. Real charts cite their source and time range."
      />
      <Chart
        type="line"
        title="Discovery jobs over time (Sample)"
        data={JOBS_DATA}
        xKey="week"
        xLabel="Week"
        series={[
          { key: "completed", label: "Completed" },
          { key: "failed", label: "Failed" },
        ]}
        footnote="Sample data."
      />
      <Chart
        type="area"
        title="Credits used per day (Sample)"
        data={CREDITS_DATA}
        xKey="day"
        xLabel="Day"
        series={[{ key: "credits", label: "Credits" }]}
        footnote="Sample data."
      />
      <Chart
        type="bar"
        stacked
        title="Lead quality distribution (Sample)"
        description="Businesses per fit-score band, split by phone verification."
        data={QUALITY_DATA}
        xKey="band"
        xLabel="Fit score band"
        series={[
          { key: "verified", label: "Verified phone" },
          { key: "unverified", label: "Unverified phone" },
        ]}
        footnote="Sample data."
      />
      <Chart
        type="bar"
        title="Empty chart"
        data={[]}
        xKey="x"
        series={[{ key: "y", label: "Value" }]}
      />
      <Chart
        type="line"
        title="Loading chart"
        data={[]}
        xKey="x"
        series={[{ key: "y", label: "Value" }]}
        loading
      />
    </GallerySection>
  );
}
