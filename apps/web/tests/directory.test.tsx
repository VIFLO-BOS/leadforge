import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BusinessDirectory } from "@/components/app/businesses/directory/business-directory";
import { BUSINESS_PAGE, FACETS } from "../e2e/fixtures-businesses";
import { BELOW_MD, NARROW, mockMatchMedia } from "./helpers";
import { renderWithQuery, stubApi } from "./phase2-helpers";

const nav = vi.hoisted(() => ({ search: "", role: "owner" as string }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/app/businesses",
  useSearchParams: () => new URLSearchParams(nav.search),
}));

vi.mock("@/components/app/app-shell", async () => {
  const { workspace: ws } = await import("./phase2-helpers");
  return { useWorkspace: () => ws(nav.role as never) };
});

function apiWith(list: unknown = BUSINESS_PAGE, listStatus = 200) {
  return stubApi((url) => {
    if (url.pathname === "/businesses") return { status: listStatus, body: list };
    if (url.pathname === "/businesses/facets") return { body: { data: FACETS } };
    return undefined;
  });
}

let replaceState: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  nav.search = "";
  nav.role = "owner";
  replaceState = vi.spyOn(window.history, "replaceState");
});
afterEach(() => {
  replaceState.mockRestore();
  vi.unstubAllGlobals();
});

describe("business directory", () => {
  it("renders rows as cards and filters behind a Filters button under 480px", async () => {
    mockMatchMedia([NARROW, BELOW_MD]);
    apiWith();
    renderWithQuery(<BusinessDirectory />);

    const cards = await screen.findByRole("list", { name: "Businesses" });
    expect(screen.queryByRole("table")).toBeNull();
    expect(within(cards).getAllByRole("listitem")).toHaveLength(BUSINESS_PAGE.data.length);
    expect(within(cards).getByRole("link", { name: "Mama Put Kitchen (Sample)" })).toBeVisible();
    // Field states carry text, not colour alone; the WhatsApp tri-state is explicit.
    expect(within(cards).getAllByText("Verified").length).toBeGreaterThan(0);
    expect(within(cards).getByText("WhatsApp confirmed")).toBeVisible();
    expect(within(cards).getByText("WhatsApp team-asserted")).toBeVisible();
    // Filters collapse into a sheet trigger; inline chips are not rendered.
    expect(screen.getByRole("button", { name: "Filters" })).toBeVisible();
    expect(screen.queryByRole("button", { name: "Category" })).toBeNull();
  });

  it("opens the filter sheet with labelled fields for every facet", async () => {
    mockMatchMedia([NARROW, BELOW_MD]);
    apiWith();
    const user = userEvent.setup();
    renderWithQuery(<BusinessDirectory />);
    await screen.findByRole("list", { name: "Businesses" });
    await user.click(screen.getByRole("button", { name: "Filters" }));
    const sheet = await screen.findByRole("dialog", { name: "Filter businesses" });
    for (const label of [
      "Category",
      "Region",
      "City or town",
      "Contact data",
      "WhatsApp",
      "Source",
      "Suppressed",
    ]) {
      // Field triggers are named label plus current value ("Region Any"), so the visible text is
      // part of the name (WCAG 2.5.3).
      expect(
        within(sheet).getByRole("button", { name: (name) => name.startsWith(`${label} `) }),
      ).toBeVisible();
    }
  });

  it("shows the desktop table with sortable headers from 768px", async () => {
    mockMatchMedia([]);
    const { calls } = apiWith();
    const user = userEvent.setup();
    renderWithQuery(<BusinessDirectory />);
    const table = await screen.findByRole("table", { name: "Businesses" });
    expect(within(table).getByRole("columnheader", { name: /Updated/ })).toHaveAttribute(
      "aria-sort",
      "descending",
    );
    await user.click(within(table).getByRole("button", { name: /Business/ }));
    // Sort changes are written to the URL (which drives the query).
    expect(replaceState).toHaveBeenLastCalledWith(null, "", "/app/businesses?sort=name%3Aasc");
    expect(calls[0]?.path).toContain("sort=updatedAt%3Adesc");
  });

  it("writes a facet filter to the URL", async () => {
    mockMatchMedia([]);
    apiWith();
    const user = userEvent.setup();
    renderWithQuery(<BusinessDirectory />);
    await screen.findByRole("table", { name: "Businesses" });
    await user.click(screen.getByRole("button", { name: "Category" }));
    await user.click(await screen.findByRole("menuitemcheckbox", { name: /Pharmacy/ }));
    expect(replaceState).toHaveBeenLastCalledWith(null, "", "/app/businesses?category=pharmacy");
  });

  it("reads the view from the URL and sends it to the API", async () => {
    mockMatchMedia([]);
    nav.search = "region=lagos&phoneState=verified&q=mama";
    const { calls } = apiWith();
    renderWithQuery(<BusinessDirectory />);
    await screen.findByRole("table", { name: "Businesses" });
    const list = calls.find((c) => c.path.startsWith("/businesses?"));
    expect(list?.path).toContain("q=mama");
    expect(list?.path).toContain("region=lagos");
    expect(list?.path).toContain("phoneState=verified");
    // Chip labels use the facet label once facets load ("lagos" becomes "Lagos").
    expect(await screen.findByText("Region: Lagos")).toBeVisible();
    expect(screen.getByText("Phone: verified")).toBeVisible();
  });

  it("shows an error state with retry and the request ID", async () => {
    mockMatchMedia([NARROW, BELOW_MD]);
    apiWith({ error: { code: "INTERNAL_ERROR", message: "boom", requestId: "req-42" } }, 500);
    renderWithQuery(<BusinessDirectory />);
    // Server errors are retried twice with backoff before the error state shows.
    const alert = await screen.findByRole("alert", {}, { timeout: 10_000 });
    expect(within(alert).getByText("Could not load businesses")).toBeVisible();
    expect(within(alert).getByText("req-42")).toBeVisible();
    expect(within(alert).getByRole("button", { name: "Try again" })).toBeVisible();
  });

  it("exports the filtered directory as a background ZIP export with attribution", async () => {
    mockMatchMedia([]);
    nav.search = "region=lagos";
    const { calls } = stubApi((url, init) => {
      if (url.pathname === "/businesses")
        return { body: { ...BUSINESS_PAGE, meta: { ...BUSINESS_PAGE.meta, total: 1500 } } };
      if (url.pathname === "/businesses/facets") return { body: { data: FACETS } };
      if (url.pathname === "/exports" && init.method === "POST") {
        return { status: 202, body: { data: { id: "6add8b76520012303c6455aa" } } };
      }
      return undefined;
    });
    const user = userEvent.setup();
    renderWithQuery(<BusinessDirectory />);
    await screen.findByRole("table", { name: "Businesses" });
    await user.click(screen.getByRole("button", { name: "Export" }));
    const dialog = await screen.findByRole("dialog", { name: "Export businesses" });
    // 1,500 rows is fine now: exports run in the background up to the plan's row limit.
    expect(within(dialog).getByText(/1,500 businesses/)).toBeVisible();
    expect(within(dialog).getByText("ATTRIBUTION.txt")).toBeVisible();
    await user.click(within(dialog).getByRole("button", { name: "Create export" }));
    await waitFor(() =>
      expect(calls.some((c) => c.method === "POST" && c.path === "/exports")).toBe(true),
    );
    const post = calls.find((c) => c.method === "POST" && c.path === "/exports")!;
    expect(post.body).toMatchObject({
      kind: "directory",
      filter: { region: ["lagos"], suppression: "exclude" },
    });
  });

  it("explains EXPORT_TOO_LARGE with the plan's row limit", async () => {
    mockMatchMedia([]);
    stubApi((url) => {
      if (url.pathname === "/businesses")
        return { body: { ...BUSINESS_PAGE, meta: { nextCursor: null, pageSize: 25 } } };
      if (url.pathname === "/businesses/facets") return { body: { data: FACETS } };
      if (url.pathname === "/exports") {
        return {
          status: 422,
          body: {
            error: {
              code: "EXPORT_TOO_LARGE",
              message: "Too many",
              details: [
                { path: "rowCap", message: "10000" },
                { path: "matched", message: "12400" },
              ],
              requestId: "r",
            },
          },
        };
      }
      return undefined;
    });
    const user = userEvent.setup();
    renderWithQuery(<BusinessDirectory />);
    await screen.findByRole("table", { name: "Businesses" });
    await user.click(screen.getByRole("button", { name: "Export" }));
    const dialog = await screen.findByRole("dialog", { name: "Export businesses" });
    await user.click(within(dialog).getByRole("button", { name: "Create export" }));
    expect(await within(dialog).findByText("Too many rows for one export")).toBeVisible();
    expect(
      within(dialog).getByText(/12,400 businesses match, and exports are limited to 10,000 rows/),
    ).toBeVisible();
    expect(within(dialog).getByRole("button", { name: "Create export" })).toBeDisabled();
  });

  it("hides write actions for a read-only analyst; sales reps get lead actions and assigned-only exports", async () => {
    mockMatchMedia([]);
    nav.role = "analyst";
    apiWith();
    const { unmount } = renderWithQuery(<BusinessDirectory />);
    await screen.findByRole("table", { name: "Businesses" });
    expect(screen.getByRole("button", { name: "Export" })).toBeVisible();
    expect(screen.queryByRole("button", { name: "Add business" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Import CSV" })).toBeNull();
    // Analysts cannot change lists or leads.
    expect(screen.queryByRole("button", { name: /Act on all results/ })).toBeNull();
    unmount();

    nav.role = "sales_rep";
    apiWith();
    const user = userEvent.setup();
    renderWithQuery(<BusinessDirectory />);
    await screen.findByRole("table", { name: "Businesses" });
    expect(screen.queryByRole("button", { name: "Add business" })).toBeNull();
    // Sales reps work their own lists and leads, and export only leads assigned to them.
    await user.click(await screen.findByRole("checkbox", { name: "Select row 1" }));
    expect(screen.getByRole("button", { name: "Add to list" })).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Lead actions" }));
    expect(await screen.findByRole("menuitem", { name: /Move to stage/ })).toBeVisible();
    expect(screen.queryByRole("menuitem", { name: /Assign/ })).toBeNull();
    await user.keyboard("{Escape}");
    await user.click(screen.getByRole("button", { name: "Export" }));
    expect(await screen.findByText("Only your assigned leads are exported")).toBeVisible();
  });

  it("offers first actions in an empty workspace", async () => {
    mockMatchMedia([NARROW, BELOW_MD]);
    apiWith({ data: [], meta: { nextCursor: null, pageSize: 25, total: 0 } });
    renderWithQuery(<BusinessDirectory />);
    expect(await screen.findByRole("heading", { name: "No businesses yet" })).toBeVisible();
    await waitFor(() =>
      expect(screen.getAllByRole("link", { name: /Import CSV/ }).length).toBeGreaterThan(0),
    );
  });
});
