import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DiscoveryJob } from "@leadforge/contracts";
import { Toaster } from "@leadforge/ui";
import { DiscoveryJobDetail } from "@/components/app/discovery/detail/discovery-job-detail";
import { hasJobPage, parseJobsParams } from "@/components/app/jobs/jobs-page";
import { ledgerAmount } from "@/components/app/usage/usage-page";
import {
  NotificationCenter,
  NotificationPanel,
  notificationVisual,
  unreadBadge,
} from "@/components/app/notifications/notification-center";
import { parseDiscoveryListParams, shouldPollDiscoveryJob } from "@/lib/discovery";
import {
  COMPLETED_JOB,
  DISCOVERY_SOURCES,
  ITEMS,
  LEDGER,
  NOTIFICATIONS,
  RUNNING_JOB,
  WARNINGS_JOB,
} from "../e2e/fixtures-discovery";
import { BELOW_MD, NARROW, mockMatchMedia } from "./helpers";
import { renderWithQuery, stubApi } from "./phase2-helpers";
import { setLocation } from "./phase3-helpers";

vi.mock("next/navigation", async () => (await import("./phase3-helpers")).navigationMock());

vi.mock("@/components/app/app-shell", async () => {
  const { workspace } = await import("./phase2-helpers");
  return { useWorkspace: () => workspace("researcher") };
});

beforeEach(() => setLocation("/app/discovery/x"));
afterEach(() => vi.unstubAllGlobals());

const page = <T,>(data: T[]) => ({ data, meta: { nextCursor: null, pageSize: 25 } });

describe("polling stop condition", () => {
  const base = { credits: { settled: false } };
  it("polls while queued or running, and while a finished job is not settled", () => {
    expect(shouldPollDiscoveryJob({ ...base, status: "queued" })).toBe(true);
    expect(shouldPollDiscoveryJob({ ...base, status: "running" })).toBe(true);
    expect(shouldPollDiscoveryJob({ ...base, status: "completed" })).toBe(true);
    expect(shouldPollDiscoveryJob({ status: "completed", credits: { settled: true } })).toBe(false);
    expect(shouldPollDiscoveryJob({ status: "failed", credits: { settled: true } })).toBe(false);
    expect(shouldPollDiscoveryJob({ status: "cancelled", credits: { settled: true } })).toBe(false);
    expect(shouldPollDiscoveryJob({ status: "draft", credits: { settled: false } })).toBe(false);
  });

  it("polls the job every 2 seconds, stops once finished and settled, and announces the change", async () => {
    const finishedUnsettled: DiscoveryJob = {
      ...RUNNING_JOB,
      status: "completed",
      progress: { ...RUNNING_JOB.progress, processed: 41 },
      credits: { held: 100, captured: 0, released: 0, settled: false, settledAt: null },
    };
    const settled: DiscoveryJob = {
      ...finishedUnsettled,
      credits: {
        held: 100,
        captured: 33,
        released: 67,
        settled: true,
        settledAt: RUNNING_JOB.updatedAt,
      },
    };
    const sequence = [RUNNING_JOB, finishedUnsettled, settled];
    let detailCalls = 0;
    stubApi((url) => {
      if (url.pathname === `/discovery/jobs/${RUNNING_JOB.id}`) {
        const job = sequence[Math.min(detailCalls, sequence.length - 1)];
        detailCalls++;
        return { body: { data: job } };
      }
      if (url.pathname === `/discovery/jobs/${RUNNING_JOB.id}/items`) return { body: page(ITEMS) };
      if (url.pathname === "/discovery/sources") return { body: page(DISCOVERY_SOURCES) };
      return undefined;
    });
    renderWithQuery(<DiscoveryJobDetail id={RUNNING_JOB.id} />);
    expect(await screen.findByRole("heading", { level: 1, name: RUNNING_JOB.name })).toBeVisible();
    expect(screen.getByTestId("job-status-line")).toHaveTextContent(
      "Running: 40 items processed so far.",
    );
    // Counts are real numbers; there is no percentage anywhere.
    expect(screen.getByTestId("job-progress")).not.toHaveTextContent("%");
    expect(screen.getByRole("button", { name: /Cancel job/ })).toBeVisible();

    await waitFor(() => expect(detailCalls).toBe(3), { timeout: 8_000 });
    await waitFor(() =>
      expect(screen.getByTestId("job-live-region")).toHaveTextContent(
        "Completed: 31 new, 2 updated, 33 credits charged.",
      ),
    );
    expect(screen.queryByRole("button", { name: /Cancel job/ })).toBeNull();
    // Settled: no further polling.
    await new Promise((r) => setTimeout(r, 2_600));
    expect(detailCalls).toBe(3);
  }, 20_000);
});

describe("job detail", () => {
  it("shows items with expired names, outcomes, attribution and the retry action", async () => {
    mockMatchMedia([]);
    stubApi((url) => {
      if (url.pathname === `/discovery/jobs/${WARNINGS_JOB.id}`)
        return { body: { data: WARNINGS_JOB } };
      if (url.pathname === `/discovery/jobs/${WARNINGS_JOB.id}/items`) return { body: page(ITEMS) };
      if (url.pathname === "/discovery/sources") return { body: page(DISCOVERY_SOURCES) };
      return undefined;
    });
    renderWithQuery(<DiscoveryJobDetail id={WARNINGS_JOB.id} />);
    const table = await screen.findByRole("table", { name: "Discovery job items" });
    await waitFor(() =>
      expect(within(table).getByText("Name expired under source terms")).toBeVisible(),
    );
    expect(within(table).getAllByText("New business").length).toBeGreaterThan(0);
    expect(within(table).getByText("Could not be saved")).toBeVisible();
    expect(screen.getByTestId("items-attribution")).toHaveTextContent("Overture Maps Foundation");
    expect(screen.getByRole("button", { name: "Retry 3 failed items" })).toBeVisible();
    expect(screen.getByTestId("job-credits")).toHaveTextContent("Settled");
  });

  it("confirms before cancelling and handles a job that already finished", async () => {
    mockMatchMedia([NARROW, BELOW_MD]);
    const user = userEvent.setup();
    const api = stubApi((url, init) => {
      if ((init.method ?? "GET") === "POST" && url.pathname.endsWith("/cancel")) {
        return {
          status: 409,
          body: { error: { code: "JOB_NOT_CANCELLABLE", message: "Finished", requestId: "r3" } },
        };
      }
      if (url.pathname === `/discovery/jobs/${RUNNING_JOB.id}`)
        return { body: { data: RUNNING_JOB } };
      if (url.pathname === `/discovery/jobs/${RUNNING_JOB.id}/items`) return { body: page([]) };
      if (url.pathname === "/discovery/sources") return { body: page(DISCOVERY_SOURCES) };
      return undefined;
    });
    renderWithQuery(
      <>
        <DiscoveryJobDetail id={RUNNING_JOB.id} />
        <Toaster />
      </>,
    );
    await user.click(await screen.findByRole("button", { name: /Cancel job/ }));
    const dialog = await screen.findByRole("alertdialog", { name: "Cancel this discovery job?" });
    expect(dialog).toHaveTextContent("Records it already produced stay and are charged");
    await user.click(within(dialog).getByRole("button", { name: "Cancel job" }));
    await waitFor(() =>
      expect(api.calls.some((c) => c.method === "POST" && c.path.endsWith("/cancel"))).toBe(true),
    );
    expect(await screen.findByText("This job already finished")).toBeInTheDocument();
  });
});

describe("notifications", () => {
  function stubNotifications() {
    return stubApi((url, init) => {
      const method = (init.method ?? "GET").toUpperCase();
      if (url.pathname === "/notifications/unread-count") return { body: { data: { unread: 2 } } };
      if (url.pathname === "/notifications") {
        const unread = url.searchParams.get("unread") === "true";
        return { body: page(NOTIFICATIONS.filter((n) => !unread || !n.readAt)) };
      }
      if (method === "POST" && url.pathname.endsWith("/read")) {
        const n = NOTIFICATIONS.find((x) => url.pathname.includes(x.id))!;
        return { body: { data: { ...n, readAt: "2026-10-25T09:00:00.000Z" } } };
      }
      if (method === "POST" && url.pathname === "/notifications/read-all")
        return { body: { data: { updated: 2 } } };
      return undefined;
    });
  }

  it("lists notifications, marks one read and marks all read", async () => {
    const api = stubNotifications();
    const user = userEvent.setup();
    renderWithQuery(<NotificationPanel onClose={() => {}} enabled />);
    const list = await screen.findByRole("list", { name: "Notifications" });
    expect(within(list).getAllByRole("listitem")).toHaveLength(3);
    expect(within(list).getAllByText(/^Unread\./)).toHaveLength(2);
    const failed = NOTIFICATIONS[0]!;
    const link = within(list)
      .getAllByRole("link")
      .find((a) => a.textContent?.includes(failed.title));
    expect(link).toHaveAttribute("href", failed.href!);
    await user.click(screen.getByRole("button", { name: `Mark as read: ${failed.title}` }));
    await waitFor(() =>
      expect(
        api.calls.some((c) => c.method === "POST" && c.path === `/notifications/${failed.id}/read`),
      ).toBe(true),
    );
    await waitFor(() => expect(within(list).getAllByText(/^Unread\./)).toHaveLength(1));
    await user.click(screen.getByRole("button", { name: /Mark all read/ }));
    await waitFor(() =>
      expect(
        api.calls.some((c) => c.method === "POST" && c.path === "/notifications/read-all"),
      ).toBe(true),
    );
  });

  it("filters to unread and shows an empty state", async () => {
    stubApi((url) => {
      if (url.pathname === "/notifications/unread-count") return { body: { data: { unread: 0 } } };
      if (url.pathname === "/notifications") return { body: page([]) };
      return undefined;
    });
    renderWithQuery(<NotificationPanel onClose={() => {}} enabled />);
    expect(await screen.findByText("No notifications yet")).toBeVisible();
    expect(screen.getByRole("button", { name: /Mark all read/ })).toBeDisabled();
  });

  it("the bell names the unread count", async () => {
    mockMatchMedia([]);
    stubNotifications();
    renderWithQuery(<NotificationCenter open={false} onOpenChange={() => {}} />);
    expect(await screen.findByRole("button", { name: "Notifications, 2 unread" })).toBeVisible();
    expect(unreadBadge(150)).toBe("99+");
    expect(notificationVisual("discovery.failed").label).toBe("Discovery failed");
    expect(notificationVisual("import.completed_with_errors").label).toBe(
      "Import finished with failed rows",
    );
    // Phase 5 types: named, with the matching tone; an unknown type falls back by suffix.
    expect(notificationVisual("lead.assigned").label).toBe("Assigned to you");
    expect(notificationVisual("export.completed").label).toBe("Export ready");
    expect(notificationVisual("bulk.completed_with_errors").className).toBe("text-warning");
    expect(notificationVisual("future.thing_failed").label).toBe("Failed");
  });
});

describe("list helpers", () => {
  it("parses list filters with the contracts' schemas and drops what fails", () => {
    expect(
      parseDiscoveryListParams(new URLSearchParams("status=running&status=bogus&source=nope")),
    ).toEqual({
      status: [],
      source: undefined,
      pageSize: 25,
    });
    expect(
      parseDiscoveryListParams(new URLSearchParams("status=running&source=overture_places")),
    ).toEqual({
      status: ["running"],
      source: "overture_places",
      pageSize: 25,
    });
    expect(parseJobsParams(new URLSearchParams("kind=import&status=failed&pageSize=50"))).toEqual({
      kind: ["import"],
      status: ["failed"],
      pageSize: 50,
    });
  });

  it("links only to job pages this build has", () => {
    expect(hasJobPage(`/app/discovery/${COMPLETED_JOB.id}`)).toBe(true);
    expect(hasJobPage("/app/businesses?importId=6add8b76520012303c6420a3")).toBe(true);
    expect(hasJobPage("/app/analysis/6add8b76520012303c64a001")).toBe(true);
    expect(hasJobPage("/app/analysis?batchId=6add8b76520012303c64b001")).toBe(true);
    expect(hasJobPage("/app/businesses/6add8b76520012303c641f9f")).toBe(true);
    expect(hasJobPage("/app/exports/6add8b76520012303c64a001")).toBe(false);
  });

  it("shows a capture as a charge from the hold, not a second debit", () => {
    const capture = LEDGER.find((e) => e.entryType === "capture")!;
    expect(ledgerAmount(capture)).toEqual({ text: "0", detail: "27 charged from the hold" });
    const hold = LEDGER.find((e) => e.entryType === "hold")!;
    expect(ledgerAmount(hold).text).toBe("−100");
  });
});
