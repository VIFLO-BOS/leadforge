import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Lead, PipelineBoard } from "@leadforge/contracts";
import { FilterDateRange, Toaster } from "@leadforge/ui";
import { BulkActionDialog } from "@/components/app/bulk/bulk-action-dialog";
import { BulkJobPage, bulkAnnouncement } from "@/components/app/bulk/bulk-job-page";
import {
  LogActivityDialog,
  activityResolver,
  type ActivityFormValues,
} from "@/components/app/crm/log-activity-dialog";
import { ExportJobPage } from "@/components/app/exports/export-job-page";
import {
  PipelinePage,
  parsePipelineParams,
  serializePipelineState,
} from "@/components/app/pipeline/pipeline-page";
import { ReportsPage } from "@/components/app/reports/reports-page";
import { bulkLimitDetails, bulkPhrase } from "@/lib/bulk";
import { ApiError } from "@/lib/api";
import { canEditActivity, conflictVersion, neighbourStage, outcomeError } from "@/lib/crm";
import { dayEndIso, dayStartIso, parseDay } from "@/lib/date-range";
import { exportCapDetails, sameOriginDownloadUrl } from "@/lib/exports";
import { histogramRows } from "@/lib/reports";
import { MEMBERS } from "../e2e/fixtures";
import {
  ACTIVITY_SUMMARY,
  BULK_DONE,
  BULK_ITEMS,
  BULK_RUNNING,
  BULK_RUNNING_FINISHED,
  EXPORT_READY,
  EXPORT_RUNNING,
  FUNNEL,
  JOBS_TIMELINE,
  LEADS,
  LEAD_MAMA_ID,
  LISTS,
  OWNER_ID,
  PIPELINE_CONFIG,
  QUALITY,
  SALES_REP_ID,
  SOURCE_BREAKDOWN,
} from "../e2e/fixtures-phase5";
import { mockMatchMedia } from "./helpers";
import { renderWithQuery, stubApi, type Handler } from "./phase2-helpers";
import { routerPush, setLocation } from "./phase3-helpers";

vi.mock("next/navigation", async () => (await import("./phase3-helpers")).navigationMock());

let role: "owner" | "admin" | "researcher" | "sales_rep" | "analyst" = "owner";
vi.mock("@/components/app/app-shell", async () => {
  const { workspace } = await import("./phase2-helpers");
  return { useWorkspace: () => workspace(role) };
});

beforeEach(() => {
  role = "owner";
  setLocation("/app");
  routerPush.mockReset();
  mockMatchMedia([]);
});
afterEach(() => vi.unstubAllGlobals());

const page = <T,>(data: T[], meta: Record<string, unknown> = {}) => ({
  data,
  meta: { nextCursor: null, pageSize: 25, ...meta },
});
const ok = (data: unknown, status = 200) => ({ status, body: { data } });

function board(leads: Lead[]): PipelineBoard {
  return {
    config: PIPELINE_CONFIG,
    columns: PIPELINE_CONFIG.stages.map((stage) => {
      const inStage = leads.filter((l) => l.stageKey === stage.key);
      return { stage, count: inStage.length, leads: inStage, nextCursor: null };
    }),
  };
}

/** Shared CRM endpoints (config, members, lists) plus the test's own routes. */
function crmApi(own: Handler) {
  return stubApi((url, init) => {
    const mine = own(url, init);
    if (mine) return mine;
    if (url.pathname === "/pipeline/config") return ok(PIPELINE_CONFIG);
    if (url.pathname === "/organizations/current/members") return { body: MEMBERS };
    if (url.pathname === "/lists") return { body: page(LISTS) };
    return undefined;
  });
}

describe("CRM helpers", () => {
  it("keeps outcomes per activity type, as the API does", () => {
    expect(outcomeError("note", "connected")).toBe("Notes have no outcome.");
    expect(outcomeError("call", "connected")).toBeNull();
    expect(outcomeError("whatsapp", "connected")).toMatch(/not an outcome for whatsapp messages/i);
    expect(outcomeError("meeting", "no_show")).toBeNull();
    expect(outcomeError("email", undefined)).toBeNull();
  });

  it("finds neighbouring stages and reads the current version from a conflict", () => {
    expect(neighbourStage(PIPELINE_CONFIG, "new", "next")?.key).toBe("qualified");
    expect(neighbourStage(PIPELINE_CONFIG, "new", "previous")).toBeNull();
    expect(neighbourStage(PIPELINE_CONFIG, "lost", "next")).toBeNull();
    const err = new ApiError({
      code: "VERSION_CONFLICT",
      message: "stale",
      status: 409,
      details: [{ path: "version", message: "7" }],
    });
    expect(conflictVersion(err)).toBe(7);
  });

  it("offers edit and delete to the author, owners and admins, never on system activities", () => {
    const a = { type: "call" as const, authorUserId: "u1" };
    expect(canEditActivity(a, { userId: "u1", role: "sales_rep", canWork: true })).toBe(true);
    expect(canEditActivity(a, { userId: "u2", role: "sales_rep", canWork: true })).toBe(false);
    expect(canEditActivity(a, { userId: "u2", role: "admin", canWork: true })).toBe(true);
    expect(
      canEditActivity(
        { ...a, type: "stage_change" },
        { userId: "u1", role: "owner", canWork: true },
      ),
    ).toBe(false);
  });

  it("parses pipeline filters from the URL, as notification links send them", () => {
    expect(
      parsePipelineParams(new URLSearchParams(`assignedToUserId=${OWNER_ID}&stage=won`)),
    ).toEqual({
      assignedToUserId: OWNER_ID,
      unassigned: false,
      listId: undefined,
      stage: "won",
    });
    expect(
      parsePipelineParams(new URLSearchParams("assignedToUserId=nope&listId=bad&stage=Bad Stage")),
    ).toEqual({
      assignedToUserId: undefined,
      unassigned: false,
      listId: undefined,
      stage: undefined,
    });
    expect(
      serializePipelineState({ unassigned: true, assignedToUserId: OWNER_ID }).toString(),
    ).toBe("unassigned=true");
  });

  it("bulk, export, date and report helpers", () => {
    expect(bulkPhrase("assign", 240)).toBe("ASSIGN 240");
    const limit = new ApiError({
      code: "BULK_LIMIT_EXCEEDED",
      message: "too many",
      status: 422,
      details: [
        { path: "selection.matched", message: "6000" },
        { path: "selection.cap", message: "5000" },
      ],
    });
    expect(bulkLimitDetails(limit)).toEqual({ matched: 6000, cap: 5000 });
    const cap = new ApiError({
      code: "EXPORT_TOO_LARGE",
      message: "x",
      status: 422,
      details: [
        { path: "rowCap", message: "10000" },
        { path: "matched", message: "12400" },
      ],
    });
    expect(exportCapDetails(cap)).toEqual({ rowCap: 10000, matched: 12400 });
    expect(
      sameOriginDownloadUrl(
        "http://api.example.test:4100/api/v1/exports/x/download?sig=a",
        "http://localhost:3300",
      ),
    ).toBe("/api/v1/exports/x/download?sig=a");
    expect(sameOriginDownloadUrl("https://files.example.test/x.zip", "http://localhost:3300")).toBe(
      "https://files.example.test/x.zip",
    );
    expect(parseDay("2026-02-30")).toBeUndefined();
    expect(parseDay("2026-02-28")).toBe("2026-02-28");
    expect(new Date(dayStartIso("2026-02-28")!).getHours()).toBe(0);
    expect(new Date(dayEndIso("2026-02-28")!).getMinutes()).toBe(59);
    expect(histogramRows(QUALITY.fit)).toHaveLength(10);
    expect(histogramRows(QUALITY.fit.map((b) => ({ ...b, count: 0 })))).toEqual([]);
  });
});

describe("pipeline keyboard moves", () => {
  it("moves a card forward with ], sends its version, and announces the move", async () => {
    const calls: { body: unknown }[] = [];
    let leads = LEADS.map((l) => ({ ...l }));
    crmApi((url, init) => {
      if (url.pathname === "/pipeline/board") return ok(board(leads));
      const move = /^\/pipeline\/leads\/([a-f0-9]{24})\/move$/.exec(url.pathname);
      if (move && init.method === "POST") {
        const body = JSON.parse(String(init.body)) as { direction: string; version: number };
        calls.push({ body });
        const l = leads.find((x) => x.id === move[1])!;
        const next = {
          ...l,
          stageKey: "contacted",
          stageKind: "open" as const,
          version: l.version + 1,
        };
        leads = leads.map((x) => (x.id === l.id ? next : x));
        return ok(next);
      }
      return undefined;
    });
    renderWithQuery(<PipelinePage />);
    const card = (
      await screen.findByRole("heading", { name: "Mama Put Kitchen (Sample)" })
    ).closest("article")!;
    const forward = within(card).getByRole("button", {
      name: "Move Mama Put Kitchen (Sample) forward to Contacted",
    });
    forward.focus();
    fireEvent.keyDown(forward, { key: "]" });
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]!.body).toEqual({ direction: "next", version: 3 });
    await waitFor(() =>
      expect(screen.getByTestId("pipeline-announcer")).toHaveTextContent(
        "Moved Mama Put Kitchen (Sample) to Contacted.",
      ),
    );
    // The card now sits in the Contacted column, and focus followed it there.
    const contacted = screen.getByRole("region", { name: /Contacted/ });
    expect(
      within(contacted).getByRole("heading", { name: "Mama Put Kitchen (Sample)" }),
    ).toBeVisible();
    await waitFor(() =>
      expect(document.activeElement).toHaveAccessibleName(
        "Move Mama Put Kitchen (Sample) forward to Interested",
      ),
    );
  });

  it("on 409 VERSION_CONFLICT reads the lead again and retries once with the new version", async () => {
    const bodies: { version: number }[] = [];
    const mama = LEADS.find((l) => l.id === LEAD_MAMA_ID)!;
    crmApi((url, init) => {
      if (url.pathname === "/pipeline/board") return ok(board(LEADS));
      if (url.pathname === `/pipeline/leads/${LEAD_MAMA_ID}` && (init.method ?? "GET") === "GET") {
        return ok({ ...mama, version: 4 });
      }
      if (url.pathname === `/pipeline/leads/${LEAD_MAMA_ID}/move`) {
        const body = JSON.parse(String(init.body)) as { version: number };
        bodies.push(body);
        if (body.version === 3) {
          return {
            status: 409,
            body: {
              error: {
                code: "VERSION_CONFLICT",
                message: "stale",
                details: [{ path: "version", message: "4" }],
                requestId: "r",
              },
            },
          };
        }
        return ok({ ...mama, stageKey: "contacted", version: 5 });
      }
      return undefined;
    });
    renderWithQuery(<PipelinePage />);
    const forward = await screen.findByRole("button", {
      name: "Move Mama Put Kitchen (Sample) forward to Contacted",
    });
    forward.focus();
    fireEvent.keyDown(forward, { key: "]" });
    await waitFor(() => expect(bodies.map((b) => b.version)).toEqual([3, 4]));
    await waitFor(() =>
      expect(screen.getByTestId("pipeline-announcer")).toHaveTextContent(
        /Moved .* to Contacted\. It had changed since it loaded/,
      ),
    );
  });

  it("explains instead of retrying when someone else already moved the lead", async () => {
    let moves = 0;
    const mama = LEADS.find((l) => l.id === LEAD_MAMA_ID)!;
    crmApi((url, init) => {
      if (url.pathname === "/pipeline/board") return ok(board(LEADS));
      if (url.pathname === `/pipeline/leads/${LEAD_MAMA_ID}` && (init.method ?? "GET") === "GET") {
        return ok({ ...mama, stageKey: "won", version: 9 });
      }
      if (url.pathname === `/pipeline/leads/${LEAD_MAMA_ID}/move`) {
        moves += 1;
        return {
          status: 409,
          body: { error: { code: "VERSION_CONFLICT", message: "stale", requestId: "r" } },
        };
      }
      return undefined;
    });
    renderWithQuery(
      <>
        <PipelinePage />
        <Toaster />
      </>,
    );
    const back = await screen.findByRole("button", {
      name: "Move Mama Put Kitchen (Sample) back to New",
    });
    back.focus();
    fireEvent.keyDown(back, { key: "[" });
    await waitFor(() =>
      expect(screen.getByTestId("pipeline-announcer")).toHaveTextContent(
        "Mama Put Kitchen (Sample) was moved to Won by someone else, so it was not moved again.",
      ),
    );
    expect(moves).toBe(1);
  });
});

describe("log activity", () => {
  const business = {
    id: LEADS[0]!.businessId,
    name: "Mama Put Kitchen (Sample)",
    suppressed: false,
    phones: ["+234 803 000 0001"],
    emails: [],
  };

  it("validates outcomes per type and requires text for notes", async () => {
    const base: ActivityFormValues = {
      type: "note",
      direction: "outbound",
      outcome: "__none",
      body: "",
      target: "",
      occurredAt: "",
      overrideReason: "",
    };
    const resolve = activityResolver(business.id, "activity", () => false);
    const note = await resolve(base, undefined, {} as never);
    expect(note.errors.body?.message).toBe("Write the note.");
    const wrong = await resolve(
      { ...base, type: "whatsapp", outcome: "connected" },
      undefined,
      {} as never,
    );
    expect(wrong.errors.outcome?.message).toMatch(/not an outcome/);
    const right = await resolve(
      { ...base, type: "call", outcome: "connected" },
      undefined,
      {} as never,
    );
    expect(right.errors).toEqual({});

    crmApi(() => undefined);
    const user = userEvent.setup();
    renderWithQuery(<LogActivityDialog open onOpenChange={() => {}} business={business} />);
    const dialog = await screen.findByRole("dialog", { name: "Log activity" });
    await user.click(within(dialog).getByRole("button", { name: "Log note" }));
    expect(await within(dialog).findByText("Write the note.")).toBeVisible();
    // A WhatsApp message offers only its own outcomes.
    await user.click(within(dialog).getByLabelText("WhatsApp message"));
    await user.click(within(dialog).getByRole("combobox", { name: /Outcome/ }));
    expect(await screen.findByRole("option", { name: "Delivered" })).toBeVisible();
    expect(screen.queryByRole("option", { name: "Connected" })).toBeNull();
  });

  it("asks for an audited reason on CONTACT_SUPPRESSED and logs with the override", async () => {
    const posts: Record<string, unknown>[] = [];
    crmApi((url, init) => {
      if (url.pathname === "/activities" && init.method === "POST") {
        const body = JSON.parse(String(init.body)) as Record<string, unknown>;
        posts.push(body);
        if (!body.suppressionOverride) {
          return {
            status: 409,
            body: {
              error: {
                code: "CONTACT_SUPPRESSED",
                message: "suppressed",
                details: [{ path: "suppressionOverride.reason", message: "Give a reason" }],
                requestId: "r",
              },
            },
          };
        }
        return { status: 201, body: { data: { activity: { id: "x" }, outreach: null } } };
      }
      return undefined;
    });
    const onOpenChange = vi.fn();
    const user = userEvent.setup();
    renderWithQuery(
      <LogActivityDialog open onOpenChange={onOpenChange} business={business} defaultType="call" />,
    );
    const dialog = await screen.findByRole("dialog", { name: "Log activity" });
    await user.click(within(dialog).getByRole("button", { name: "Log call" }));
    const step = await within(dialog).findByTestId("suppression-override");
    expect(
      within(step).getByRole("heading", { name: "Log contact with a suppressed business?" }),
    ).toHaveFocus();
    expect(within(step).getByText(/written to the audit log/)).toBeVisible();
    await user.click(within(dialog).getByRole("button", { name: "Log with override" }));
    expect(await within(dialog).findByText(/at least 10 characters/)).toBeVisible();
    await user.type(
      within(dialog).getByLabelText(/Reason for logging this contact/),
      "They called us back asking for a quote.",
    );
    await user.click(within(dialog).getByRole("button", { name: "Log with override" }));
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(posts).toHaveLength(2);
    expect(posts[1]).toMatchObject({
      type: "call",
      suppressionOverride: { reason: "They called us back asking for a quote." },
    });
  });
});

describe("bulk operations", () => {
  it("previews the counts, confirms with a typed phrase, creates with an Idempotency-Key and opens the job", async () => {
    let createKey: string | null = null;
    crmApi((url, init) => {
      if (url.pathname === "/bulk-operations/preview") {
        return ok({
          action: "assign",
          matched: 240,
          cap: 5000,
          overCap: false,
          willChange: 238,
          breakdown: [
            { outcome: "assigned", count: 238 },
            { outcome: "suppressed", count: 2 },
          ],
        });
      }
      if (url.pathname === "/bulk-operations" && init.method === "POST") {
        createKey = new Headers(init.headers).get("Idempotency-Key");
        return {
          status: 202,
          body: { data: { ...BULK_DONE, id: "6add8b76520012303c6454aa", status: "queued" } },
        };
      }
      return undefined;
    });
    const user = userEvent.setup();
    renderWithQuery(
      <BulkActionDialog
        open
        onOpenChange={() => {}}
        action="assign"
        selection={{ filter: { suppression: "exclude" } }}
        count={240}
      />,
    );
    const dialog = await screen.findByRole("dialog", { name: "Assign leads" });
    await user.click(await within(dialog).findByLabelText(/Tunde Sales/));
    await user.click(within(dialog).getByRole("button", { name: "Preview changes" }));
    const preview = await within(dialog).findByTestId("bulk-preview");
    expect(preview).toHaveTextContent("240 businesses match");
    expect(within(preview).getByTestId("bulk-will-change")).toHaveTextContent("238 will change");
    expect(within(preview).getByText("Suppressed")).toBeVisible();
    await user.click(within(dialog).getByRole("button", { name: "Continue" }));
    const confirm = await screen.findByRole("alertdialog", { name: "Assign 240 businesses?" });
    const go = within(confirm).getByRole("button", { name: "Assign 240" });
    expect(go).toBeDisabled();
    await user.type(within(confirm).getByLabelText("Confirmation phrase"), "ASSIGN 240");
    await user.click(go);
    await waitFor(() =>
      expect(routerPush).toHaveBeenCalledWith("/app/jobs/bulk/6add8b76520012303c6454aa"),
    );
    expect(createKey).toMatch(/^bulk-/);
  });

  it("explains BULK_LIMIT_EXCEEDED from the preview and does not allow confirming", async () => {
    crmApi((url) =>
      url.pathname === "/bulk-operations/preview"
        ? ok({
            action: "add_to_list",
            matched: 6000,
            cap: 5000,
            overCap: true,
            willChange: 5000,
            breakdown: [{ outcome: "added", count: 5000 }],
          })
        : undefined,
    );
    const user = userEvent.setup();
    renderWithQuery(
      <BulkActionDialog
        open
        onOpenChange={() => {}}
        action="add_to_list"
        selection={{ filter: { suppression: "exclude" } }}
        count={6000}
      />,
    );
    const dialog = await screen.findByRole("dialog", { name: "Add to a list" });
    await user.click(await within(dialog).findByLabelText(/Lagos restaurants/));
    await user.click(within(dialog).getByRole("button", { name: "Preview changes" }));
    expect(await within(dialog).findByText("Too many businesses for one operation")).toBeVisible();
    expect(within(dialog).getByRole("button", { name: "Continue" })).toBeDisabled();
  });

  it("polls progress until finished, announces once, and lists each business's result", async () => {
    let polls = 0;
    crmApi((url) => {
      if (url.pathname === `/bulk-operations/${BULK_RUNNING.id}`) {
        polls += 1;
        return ok(polls > 1 ? BULK_RUNNING_FINISHED : BULK_RUNNING);
      }
      if (url.pathname === `/bulk-operations/${BULK_RUNNING.id}/items`)
        return { body: page(BULK_ITEMS) };
      if (url.pathname === `/lists/${BULK_RUNNING.params.listId}`) return ok(LISTS[0]);
      return undefined;
    });
    renderWithQuery(<BulkJobPage id={BULK_RUNNING.id} />);
    expect(
      await screen.findByRole("heading", {
        level: 1,
        name: "Add to list “Lagos restaurants (Sample)”",
      }),
    ).toBeVisible();
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "42");
    expect(screen.getByTestId("bulk-announcer")).toHaveTextContent("Bulk operation running.");
    await waitFor(() => expect(screen.getByTestId("bulk-status")).toHaveTextContent("Completed"), {
      timeout: 6_000,
    });
    expect(screen.getByTestId("bulk-announcer")).toHaveTextContent(
      "Bulk operation completed: 21 changed, 2 already done, 1 skipped.",
    );
    expect(screen.queryByRole("progressbar")).toBeNull();
    expect(screen.getAllByText("Assigned").length).toBeGreaterThan(0);
    expect(bulkAnnouncement(BULK_DONE)).toMatch(/completed with errors: 21 changed, 1 failed/);
  });
});

describe("async export", () => {
  it("polls until ready, then requests a fresh signed link and navigates to it", async () => {
    let polls = 0;
    const navigate = vi.fn();
    crmApi((url) => {
      if (url.pathname === `/exports/${EXPORT_RUNNING.id}`) {
        polls += 1;
        return ok(
          polls > 1
            ? { ...EXPORT_RUNNING, status: "completed", rowCount: 240, file: EXPORT_READY.file }
            : EXPORT_RUNNING,
        );
      }
      if (url.pathname === `/exports/${EXPORT_RUNNING.id}/download-url`) {
        return ok({
          url: `http://127.0.0.1:4100/api/v1/exports/${EXPORT_RUNNING.id}/download?org=o&expires=1&sig=abcdefghijklmnopqrstuv`,
          expiresAt: "2026-10-25T09:15:00.000Z",
        });
      }
      return undefined;
    });
    const user = userEvent.setup();
    renderWithQuery(<ExportJobPage id={EXPORT_RUNNING.id} navigate={navigate} />);
    expect(await screen.findByTestId("export-status")).toHaveTextContent("Building the file");
    expect(screen.getByTestId("export-file")).toHaveTextContent("ATTRIBUTION.txt");
    const download = await screen.findByRole(
      "button",
      { name: "Download ZIP" },
      { timeout: 6_000 },
    );
    expect(screen.getByTestId("export-announcer")).toHaveTextContent(
      "Export ready to download: 240 rows.",
    );
    await user.click(download);
    await waitFor(() =>
      expect(navigate).toHaveBeenCalledWith(
        `/api/v1/exports/${EXPORT_RUNNING.id}/download?org=o&expires=1&sig=abcdefghijklmnopqrstuv`,
      ),
    );
  });

  it("explains an expired file when the download link is refused", async () => {
    crmApi((url) => {
      if (url.pathname === `/exports/${EXPORT_READY.id}`) return ok(EXPORT_READY);
      if (url.pathname === `/exports/${EXPORT_READY.id}/download-url`) {
        return {
          status: 410,
          body: { error: { code: "EXPORT_EXPIRED", message: "gone", requestId: "r" } },
        };
      }
      return undefined;
    });
    const user = userEvent.setup();
    renderWithQuery(<ExportJobPage id={EXPORT_READY.id} navigate={vi.fn()} />);
    await user.click(await screen.findByRole("button", { name: "Download ZIP" }));
    expect(await screen.findByTestId("download-problem")).toHaveTextContent(
      /deleted after its 7-day retention window/,
    );
  });
});

describe("reports", () => {
  it("shows fit and data confidence as separate charts, each with a table view", async () => {
    crmApi((url) => {
      const reports: Record<string, unknown> = {
        "/reports/source-breakdown": SOURCE_BREAKDOWN,
        "/reports/quality-distribution": QUALITY,
        "/reports/jobs-timeline": JOBS_TIMELINE,
        "/reports/pipeline-funnel": FUNNEL,
        "/reports/activity-summary": ACTIVITY_SUMMARY,
      };
      return url.pathname in reports ? ok(reports[url.pathname]) : undefined;
    });
    const user = userEvent.setup();
    renderWithQuery(<ReportsPage />);
    const fit = await screen.findByTestId("chart-fit");
    const confidence = screen.getByTestId("chart-confidence");
    expect(within(fit).getByRole("heading", { name: "Fit score distribution" })).toBeVisible();
    expect(
      within(confidence).getByRole("heading", { name: "Data confidence distribution" }),
    ).toBeVisible();
    await waitFor(() => expect(within(fit).queryByRole("status")).toBeNull());
    expect(within(fit).queryByRole("table")).toBeNull();
    await user.click(within(fit).getByRole("radio", { name: /Table/ }));
    const table = within(fit).getByRole("table", { name: "Fit score distribution" });
    expect(within(table).getByRole("rowheader", { name: "90–100" })).toBeVisible();
    expect(within(table).getAllByRole("row")).toHaveLength(11);
    // The other chart keeps its own view; nothing adds the two measures.
    expect(within(confidence).queryByRole("table")).toBeNull();
    expect(screen.getByText(/never added together/)).toBeVisible();
    expect(screen.getByText("50%")).toBeVisible();
  });
});

describe("roles", () => {
  it("lets a sales representative move but not assign", async () => {
    role = "sales_rep";
    crmApi((url) =>
      url.pathname === "/pipeline/board"
        ? ok(board(LEADS.filter((l) => l.assignedToUserId === SALES_REP_ID)))
        : undefined,
    );
    const user = userEvent.setup();
    renderWithQuery(<PipelinePage />);
    const more = await screen.findByRole("button", { name: /More actions for Garki/ });
    expect(screen.getByRole("button", { name: /forward to Interested/ })).toBeVisible();
    await user.click(more);
    expect(await screen.findByRole("menuitem", { name: /Log activity/ })).toBeVisible();
    expect(screen.queryByRole("menuitem", { name: /Assign/ })).toBeNull();
    await user.keyboard("{Escape}");
  });
});

describe("FilterDateRange", () => {
  it("applies a day range, refuses a start after the end, and clears", async () => {
    const onApply = vi.fn();
    const user = userEvent.setup();
    renderWithQuery(<FilterDateRange label="Date" value={{}} onApply={onApply} />);
    await user.click(screen.getByRole("button", { name: "Date" }));
    const from = await screen.findByLabelText("From");
    const to = screen.getByLabelText("To");
    fireEvent.change(from, { target: { value: "2026-10-20" } });
    fireEvent.change(to, { target: { value: "2026-10-10" } });
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "The start date is after the end date",
    );
    expect(from).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByRole("button", { name: "Apply" })).toBeDisabled();
    fireEvent.change(to, { target: { value: "2026-10-25" } });
    await user.click(screen.getByRole("button", { name: "Apply" }));
    expect(onApply).toHaveBeenCalledWith({ from: "2026-10-20", to: "2026-10-25" });
  });

  it("names the applied range on the chip", () => {
    renderWithQuery(
      <FilterDateRange
        label="Date"
        value={{ from: "2026-10-20" }}
        onApply={() => {}}
        describe={() => "from 20 Oct"}
      />,
    );
    expect(screen.getByRole("button", { name: "Date: from 20 Oct" })).toBeVisible();
  });
});
