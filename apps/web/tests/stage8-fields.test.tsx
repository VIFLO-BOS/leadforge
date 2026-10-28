import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EXPIRED_NAME_LABEL } from "@leadforge/contracts";
import { BillingPage } from "@/components/app/billing/billing-page";
import { BulkJobPage } from "@/components/app/bulk/bulk-job-page";
import {
  ListsPage,
  parseListsParams,
  serializeListsState,
} from "@/components/app/lists/lists-page";
import { PipelinePage } from "@/components/app/pipeline/pipeline-page";
import { invoiceDownloadErrorFrom } from "@/lib/billing";
import { MEMBERS } from "../e2e/fixtures";
import { INVOICES } from "../e2e/fixtures-phase6";
import {
  BULK_DONE,
  BULK_ITEMS,
  LEADS,
  LISTS,
  LIST_ID,
  PIPELINE_CONFIG,
} from "../e2e/fixtures-phase5";
import { mockMatchMedia } from "./helpers";
import { renderWithQuery, stubApi } from "./phase2-helpers";
import { setLocation } from "./phase3-helpers";

vi.mock("next/navigation", async () => (await import("./phase3-helpers")).navigationMock());

let role: "owner" | "admin" | "researcher" | "sales_rep" | "analyst" = "owner";
vi.mock("@/components/app/app-shell", async () => {
  const { workspace } = await import("./phase2-helpers");
  return { useWorkspace: () => workspace(role) };
});

beforeEach(() => {
  role = "owner";
  mockMatchMedia([]);
});
afterEach(() => vi.unstubAllGlobals());

const ok = (data: unknown) => ({ status: 200, body: { data } });
const page = <T,>(data: T[]) => ({ data, meta: { nextCursor: null, pageSize: 25 } });

describe("invoice links that failed in the browser (?downloadError=)", () => {
  it("accepts the documented codes only", () => {
    expect(invoiceDownloadErrorFrom("DOWNLOAD_LINK_EXPIRED")).toBe("DOWNLOAD_LINK_EXPIRED");
    expect(invoiceDownloadErrorFrom("DOWNLOAD_LINK_INVALID")).toBe("DOWNLOAD_LINK_INVALID");
    expect(invoiceDownloadErrorFrom("<b>nope</b>")).toBeNull();
    expect(invoiceDownloadErrorFrom(null)).toBeNull();
  });

  it("explains an expired link once, opens Invoices and drops the parameter", async () => {
    setLocation("/app/billing?downloadError=DOWNLOAD_LINK_EXPIRED");
    stubApi((url) => (url.pathname === "/billing/invoices" ? { body: page(INVOICES) } : undefined));
    renderWithQuery(<BillingPage />);
    const problem = await screen.findByTestId("invoice-link-problem");
    expect(problem).toHaveTextContent("That download link expired");
    expect(problem).toHaveTextContent("Download the invoice again");
    await waitFor(() => expect(window.location.search).toBe("?tab=invoices"));
    expect(await screen.findByText("LF-2026-000002")).toBeVisible();
    expect(screen.getByRole("tab", { name: "Invoices" })).toHaveAttribute("aria-selected", "true");
  });
});

describe("bulk results by business name", () => {
  it("shows names, the expired label, and the id only for businesses outside the workspace", async () => {
    setLocation(`/app/jobs/bulk/${BULK_DONE.id}`);
    stubApi((url) => {
      if (url.pathname === `/bulk-operations/${BULK_DONE.id}`) return ok(BULK_DONE);
      if (url.pathname === `/bulk-operations/${BULK_DONE.id}/items`)
        return { body: page(BULK_ITEMS) };
      if (url.pathname === "/pipeline/config") return ok(PIPELINE_CONFIG);
      if (url.pathname === "/organizations/current/members") return { body: MEMBERS };
      if (url.pathname.startsWith("/lists/")) return ok(LISTS[0]);
      return undefined;
    });
    renderWithQuery(<BulkJobPage id={BULK_DONE.id} />);
    const table = await screen.findByRole("table", { name: /results/i });
    const names = within(table).getAllByTestId("bulk-item-business");
    expect(names[0]).toHaveTextContent("Mama Put Kitchen (Sample)");
    expect(names[0]!.closest("a")).toHaveAttribute(
      "href",
      `/app/businesses/${BULK_ITEMS[0]!.businessId}`,
    );
    const expired = names.find((n) => n.textContent === EXPIRED_NAME_LABEL);
    expect(expired).toBeDefined();
    const missing = names.at(-1)!;
    expect(missing).toHaveTextContent(/^Business …[0-9a-f]{6}$/);
    expect(missing.closest("a")).toBeNull();
  });
});

describe("lead lists owner filter", () => {
  it("round-trips the owner filter in the URL", () => {
    const s = parseListsParams(new URLSearchParams("owner=all&q=lag"));
    expect(s.owner).toBe("all");
    expect(serializeListsState(s).toString()).toBe("q=lag&owner=all");
    expect(parseListsParams(new URLSearchParams("owner=bogus")).owner).toBeUndefined();
  });

  it("sales representatives start on My lists and can clear it to see every list", async () => {
    role = "sales_rep";
    setLocation("/app/lists");
    const queries: string[] = [];
    stubApi((url) => {
      if (url.pathname === "/lists") {
        queries.push(url.search);
        return { body: page(LISTS) };
      }
      if (url.pathname === "/organizations/current/members") return { body: MEMBERS };
      return undefined;
    });
    const user = userEvent.setup();
    renderWithQuery(<ListsPage />);
    const chip = await screen.findByTestId("my-lists-filter");
    expect(chip).toHaveAttribute("aria-pressed", "true");
    await waitFor(() => expect(queries.at(-1)).toContain("ownerUserId="));
    await user.click(chip);
    await waitFor(() => expect(queries.at(-1)).not.toContain("ownerUserId="));
    expect(window.location.search).toBe("?owner=all");
    expect(chip).toHaveAttribute("aria-pressed", "false");
  });
});

describe("pipeline board filtered by list", () => {
  it("makes one board request with listId", async () => {
    setLocation(`/app/pipeline?listId=${LIST_ID}`);
    const paths: string[] = [];
    stubApi((url) => {
      paths.push(url.pathname + url.search);
      if (url.pathname === "/pipeline/board") {
        return ok({
          config: PIPELINE_CONFIG,
          columns: PIPELINE_CONFIG.stages.map((stage) => {
            const leads = LEADS.filter((l) => l.stageKey === stage.key);
            return { stage, count: leads.length, leads, nextCursor: null };
          }),
        });
      }
      if (url.pathname === "/organizations/current/members") return { body: MEMBERS };
      if (url.pathname === "/lists") return { body: page(LISTS) };
      if (url.pathname === `/lists/${LIST_ID}`) return ok(LISTS[0]);
      return undefined;
    });
    renderWithQuery(<PipelinePage />);
    await screen.findAllByText("Mama Put Kitchen (Sample)");
    const boards = paths.filter((p) => p.startsWith("/pipeline/board"));
    expect(boards).toHaveLength(1);
    expect(boards[0]).toContain(`listId=${LIST_ID}`);
    expect(paths.some((p) => p.startsWith("/pipeline/leads"))).toBe(false);
  });
});
