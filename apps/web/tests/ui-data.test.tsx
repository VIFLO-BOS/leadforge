import { act, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ColumnDef, SortingState } from "@tanstack/react-table";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import {
  Button,
  DataTable,
  FilterBar,
  Pagination,
  type DataTableBulkContext,
  type DataTableDensity,
} from "@leadforge/ui";
import { BELOW_MD, NARROW, mockMatchMedia } from "./helpers";

interface Biz {
  id: string;
  name: string;
  city: string;
  score: number;
}

const ROWS: Biz[] = [
  { id: "b1", name: "Sample Bakery (Sample)", city: "Ikeja", score: 82 },
  { id: "b2", name: "Sample Clinic (Sample)", city: "Lekki", score: 74 },
  { id: "b3", name: "Sample Laundry (Sample)", city: "Yaba", score: 61 },
];

const COLUMNS: ColumnDef<Biz>[] = [
  { accessorKey: "name", header: "Business", meta: { label: "Business", mobileTitle: true } },
  { accessorKey: "city", header: "City", meta: { label: "City" } },
  { accessorKey: "score", header: "Fit score", meta: { label: "Fit score", align: "end" } },
];

const getRowId = (r: Biz) => r.id;

function SortableTable({ onSort }: { onSort?: (s: SortingState) => void }) {
  const [sorting, setSorting] = useState<SortingState>([]);
  return (
    <DataTable
      caption="Businesses"
      columns={COLUMNS}
      data={ROWS}
      getRowId={getRowId}
      sorting={sorting}
      onSortingChange={(updater) => {
        const next = typeof updater === "function" ? updater(sorting) : updater;
        setSorting(next);
        onSort?.(next);
      }}
    />
  );
}

describe("DataTable", () => {
  it("renders inside a focusable, labelled scroll region with a captioned table", () => {
    render(<DataTable caption="Businesses" columns={COLUMNS} data={ROWS} getRowId={getRowId} />);
    const region = screen.getByRole("region", { name: "Businesses table" });
    expect(region).toHaveAttribute("tabindex", "0");
    const table = within(region).getByRole("table", { name: "Businesses" });
    expect(within(table).getAllByRole("row")).toHaveLength(ROWS.length + 1);
    expect(within(table).getByText("Sample Clinic (Sample)")).toBeInTheDocument();
  });

  it("reports sorting through onSortingChange and reflects it in aria-sort", async () => {
    const user = userEvent.setup();
    const onSort = vi.fn();
    render(<SortableTable onSort={onSort} />);
    const header = screen.getByRole("columnheader", { name: /Business/ });
    expect(header).toHaveAttribute("aria-sort", "none");

    await user.click(within(header).getByRole("button"));
    expect(onSort).toHaveBeenLastCalledWith([{ id: "name", desc: false }]);
    expect(header).toHaveAttribute("aria-sort", "ascending");

    await user.click(within(header).getByRole("button"));
    expect(onSort).toHaveBeenLastCalledWith([{ id: "name", desc: true }]);
    expect(header).toHaveAttribute("aria-sort", "descending");
  });

  it("does not offer sort buttons when the caller cannot sort", () => {
    render(<DataTable caption="Businesses" columns={COLUMNS} data={ROWS} getRowId={getRowId} />);
    const header = screen.getByRole("columnheader", { name: "Business" });
    expect(header).not.toHaveAttribute("aria-sort");
    expect(within(header).queryByRole("button")).toBeNull();
  });

  it("selects rows, shows the bulk-action bar with the selected IDs, and clears", async () => {
    const user = userEvent.setup();
    const seen: DataTableBulkContext<Biz>[] = [];
    render(
      <DataTable
        caption="Businesses"
        columns={COLUMNS}
        data={ROWS}
        getRowId={getRowId}
        enableRowSelection
        bulkActions={(ctx) => {
          seen.push(ctx);
          return (
            <Button size="sm" onClick={ctx.clear}>
              Suppress selected
            </Button>
          );
        }}
      />,
    );
    expect(screen.queryByRole("region", { name: "Bulk actions" })).toBeNull();

    await user.click(screen.getByRole("checkbox", { name: "Select row 1" }));
    const bar = screen.getByRole("region", { name: "Bulk actions" });
    expect(within(bar).getByText("1 selected")).toBeInTheDocument();
    expect(seen.at(-1)?.ids).toEqual(["b1"]);
    expect(screen.getByRole("checkbox", { name: "Select all rows on this page" })).toHaveAttribute(
      "aria-checked",
      "mixed",
    );

    await user.click(screen.getByRole("checkbox", { name: "Select all rows on this page" }));
    expect(within(bar).getByText("3 selected")).toBeInTheDocument();
    expect(seen.at(-1)?.ids.sort()).toEqual(["b1", "b2", "b3"]);
    expect(
      seen
        .at(-1)
        ?.rows.map((r) => r.id)
        .sort(),
    ).toEqual(["b1", "b2", "b3"]);

    await user.click(within(bar).getByRole("button", { name: "Suppress selected" }));
    expect(screen.queryByRole("region", { name: "Bulk actions" })).toBeNull();
    expect(screen.getByRole("checkbox", { name: "Select row 1" })).toHaveAttribute(
      "aria-checked",
      "false",
    );
  });

  it("clears the selection from the bar's close button", async () => {
    const user = userEvent.setup();
    render(
      <DataTable
        caption="Businesses"
        columns={COLUMNS}
        data={ROWS}
        getRowId={getRowId}
        enableRowSelection
      />,
    );
    await user.click(screen.getByRole("checkbox", { name: "Select row 2" }));
    await user.click(screen.getByRole("button", { name: "Clear selection" }));
    expect(screen.queryByRole("region", { name: "Bulk actions" })).toBeNull();
  });

  it("hides a column from the column visibility menu", async () => {
    const user = userEvent.setup();
    render(<DataTable caption="Businesses" columns={COLUMNS} data={ROWS} getRowId={getRowId} />);
    expect(screen.getByRole("columnheader", { name: "City" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Show or hide columns" }));
    await user.click(await screen.findByRole("menuitemcheckbox", { name: "City" }));
    expect(screen.queryByRole("columnheader", { name: "City" })).toBeNull();
    expect(screen.queryByText("Ikeja")).toBeNull();
  });

  it("switches density through the row density menu", async () => {
    const user = userEvent.setup();
    const onDensityChange = vi.fn<(d: DataTableDensity) => void>();
    render(
      <DataTable
        caption="Businesses"
        columns={COLUMNS}
        data={ROWS}
        getRowId={getRowId}
        onDensityChange={onDensityChange}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Row density" }));
    await user.click(await screen.findByRole("menuitemradio", { name: "Compact" }));
    expect(onDensityChange).toHaveBeenCalledWith("compact");
    expect(screen.getByRole("table").className).toContain("text-xs");
  });

  it("marks the table busy and renders skeleton rows while loading", () => {
    render(
      <DataTable
        caption="Businesses"
        columns={COLUMNS}
        data={[]}
        getRowId={getRowId}
        loading
        skeletonRows={4}
      />,
    );
    const table = screen.getByRole("table");
    expect(table).toHaveAttribute("aria-busy", "true");
    expect(within(table).getAllByRole("row")).toHaveLength(5);
  });

  it("renders the empty and error slots", () => {
    const { rerender } = render(
      <DataTable
        caption="Businesses"
        columns={COLUMNS}
        data={[]}
        getRowId={getRowId}
        empty={<p>No businesses yet</p>}
      />,
    );
    expect(screen.getByText("No businesses yet")).toBeInTheDocument();
    rerender(
      <DataTable
        caption="Businesses"
        columns={COLUMNS}
        data={ROWS}
        getRowId={getRowId}
        error={<p role="alert">Could not load businesses</p>}
      />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent("Could not load businesses");
    expect(screen.queryByText("Sample Bakery (Sample)")).toBeNull();
  });

  describe("under 480px", () => {
    it("renders stacked cards with labelled values and working selection, and no table", async () => {
      mockMatchMedia([NARROW]);
      const user = userEvent.setup();
      render(
        <DataTable
          caption="Businesses"
          columns={COLUMNS}
          data={ROWS}
          getRowId={getRowId}
          enableRowSelection
          mobileCards
        />,
      );
      expect(screen.queryByRole("table")).toBeNull();
      const list = screen.getByRole("list", { name: "Businesses" });
      const cards = within(list).getAllByRole("listitem");
      expect(cards).toHaveLength(3);

      const first = cards[0]!;
      expect(within(first).getByText("Sample Bakery (Sample)")).toBeInTheDocument();
      const terms = within(first)
        .getAllByRole("term")
        .map((t) => t.textContent);
      expect(terms).toEqual(["City", "Fit score"]);
      expect(within(first).getAllByRole("definition")).toHaveLength(2);
      expect(within(first).getByText("Ikeja").tagName).toBe("DD");

      await user.click(within(first).getByRole("checkbox", { name: "Select row 1" }));
      expect(screen.getByRole("region", { name: "Bulk actions" })).toHaveTextContent("1 selected");
      expect(first).toHaveAttribute("data-state", "selected");
    });

    it("keeps the scrolling table when mobileCards is not set", () => {
      mockMatchMedia([NARROW]);
      render(<DataTable caption="Businesses" columns={COLUMNS} data={ROWS} getRowId={getRowId} />);
      const region = screen.getByRole("region", { name: "Businesses table" });
      expect(within(region).getByRole("table")).toBeInTheDocument();
    });

    it("uses a custom card renderer when provided", () => {
      mockMatchMedia([NARROW]);
      render(
        <DataTable
          caption="Businesses"
          columns={COLUMNS}
          data={ROWS}
          getRowId={getRowId}
          mobileCards={{ render: (row) => <p>Card for {row.name}</p> }}
        />,
      );
      expect(screen.getByText("Card for Sample Laundry (Sample)")).toBeInTheDocument();
      expect(screen.queryByRole("table")).toBeNull();
    });
  });
});

describe("Pagination", () => {
  it("disables Previous on the first page and calls onNext", async () => {
    const user = userEvent.setup();
    const onNext = vi.fn();
    const onPrevious = vi.fn();
    render(
      <Pagination
        hasPrevious={false}
        hasNext
        onPrevious={onPrevious}
        onNext={onNext}
        pageSize={25}
      />,
    );
    expect(screen.getByRole("navigation", { name: "Pagination" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Previous" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Next" }));
    expect(onNext).toHaveBeenCalledTimes(1);
    expect(onPrevious).not.toHaveBeenCalled();
  });

  it("shows a total only when the server reports one", () => {
    const { rerender } = render(
      <Pagination
        hasPrevious
        hasNext={false}
        onPrevious={() => {}}
        onNext={() => {}}
        pageSize={25}
      />,
    );
    expect(screen.queryByText(/in total/)).toBeNull();
    expect(screen.queryByText(/on this page/)).toBeNull();
    expect(screen.getByRole("button", { name: "Next" })).toBeDisabled();

    rerender(
      <Pagination
        hasPrevious
        hasNext={false}
        onPrevious={() => {}}
        onNext={() => {}}
        pageSize={25}
        totalCount={1234}
        itemLabel="businesses"
      />,
    );
    expect(screen.getByText("1,234 businesses in total")).toBeInTheDocument();
  });

  it("disables both buttons while loading", () => {
    render(
      <Pagination
        hasPrevious
        hasNext
        onPrevious={() => {}}
        onNext={() => {}}
        pageSize={25}
        loading
      />,
    );
    expect(screen.getByRole("button", { name: "Previous" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Next" })).toBeDisabled();
  });

  it("changes the page size", async () => {
    const user = userEvent.setup();
    const onPageSizeChange = vi.fn();
    render(
      <Pagination
        hasPrevious={false}
        hasNext
        onPrevious={() => {}}
        onNext={() => {}}
        pageSize={25}
        onPageSizeChange={onPageSizeChange}
      />,
    );
    await user.click(screen.getByRole("combobox", { name: "Rows per page" }));
    await user.click(await screen.findByRole("option", { name: "50" }));
    expect(onPageSizeChange).toHaveBeenCalledWith(50);
  });
});

describe("FilterBar", () => {
  const filters = (spy: { industry: () => void; city: () => void }) => [
    { id: "industry", label: "Industry: Bakery", onRemove: spy.industry },
    { id: "city", label: "City: Ikeja", onRemove: spy.city },
  ];

  it("shows applied filters as removable chips with Clear all from 768px", async () => {
    const user = userEvent.setup();
    const spy = { industry: vi.fn(), city: vi.fn() };
    const onClearAll = vi.fn();
    render(
      <FilterBar filters={filters(spy)} onClearAll={onClearAll}>
        <button type="button">Industry</button>
      </FilterBar>,
    );
    const group = screen.getByRole("group", { name: "Applied filters" });
    expect(within(group).getByText("Industry: Bakery")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Industry" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Filters/ })).toBeNull();

    await user.click(screen.getByRole("button", { name: "Remove filter Industry: Bakery" }));
    expect(spy.industry).toHaveBeenCalledTimes(1);

    fireEvent.keyDown(screen.getByRole("button", { name: "Remove filter City: Ikeja" }), {
      key: "Backspace",
    });
    expect(spy.city).toHaveBeenCalledTimes(1);

    await user.click(within(group).getByRole("button", { name: "Clear all" }));
    expect(onClearAll).toHaveBeenCalledTimes(1);
  });

  it("collapses into a Filters (n) sheet under 768px", async () => {
    mockMatchMedia([BELOW_MD]);
    const user = userEvent.setup();
    const spy = { industry: vi.fn(), city: vi.fn() };
    render(
      <FilterBar
        filters={filters(spy)}
        onClearAll={() => {}}
        search={<input aria-label="Search businesses" />}
      >
        <button type="button">Industry</button>
      </FilterBar>,
    );
    expect(screen.getByRole("textbox", { name: "Search businesses" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Industry" })).toBeNull();

    await user.click(screen.getByRole("button", { name: "Filters (2)" }));
    const dialog = await screen.findByRole("dialog", { name: "Filters" });
    expect(within(dialog).getByRole("button", { name: "Industry" })).toBeInTheDocument();
    expect(within(dialog).getByText("City: Ikeja")).toBeInTheDocument();

    await user.click(within(dialog).getByRole("button", { name: "Show results" }));
    await act(async () => {});
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("labels the trigger without a count when nothing is applied", () => {
    mockMatchMedia([BELOW_MD]);
    render(
      <FilterBar filters={[]}>
        <button type="button">Industry</button>
      </FilterBar>,
    );
    expect(screen.getByRole("button", { name: "Filters" })).toBeInTheDocument();
  });
});
