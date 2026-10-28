import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Lead, OutreachRecord, PipelineConfig } from "@leadforge/contracts";
import { Toaster } from "@leadforge/ui";
import { LeadDetailsDialog, leadPatchBody } from "@/components/app/crm/lead-details-dialog";
import { LeadPanel } from "@/components/app/crm/lead-panel";
import { NextAttemptDialog } from "@/components/app/crm/outreach-parts";
import { PipelineSettings } from "@/components/app/settings/pipeline-settings";
import {
  addStage,
  archiveStage,
  draftFromConfig,
  isDirty,
  moveStage,
  moveTarget,
  renameStage,
  restoreStage,
  toRequest,
  validateDraft,
} from "@/lib/pipeline-config";
import { MEMBERS } from "../e2e/fixtures";
import {
  LEADS,
  LEAD_MAMA_ID,
  PIPELINE_CONFIG,
  lead as makeLead,
  outreach as makeOutreach,
} from "../e2e/fixtures-phase5";
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
  setLocation("/app/settings?tab=pipeline");
});
afterEach(() => vi.unstubAllGlobals());

const ok = (data: unknown, status = 200) => ({ status, body: { data } });
const conflict = (version: number) => ({
  status: 409,
  body: {
    error: {
      code: "VERSION_CONFLICT",
      message: "Changed",
      details: [{ path: "version", message: String(version) }],
      requestId: "r",
    },
  },
});

// ---------------------------------------------------------------------------
// Stage configuration model
// ---------------------------------------------------------------------------

describe("stage configuration model", () => {
  const draft = draftFromConfig(PIPELINE_CONFIG);

  it("reorders open stages with Move up and Move down; Won and Lost never move or get crossed", () => {
    expect(moveTarget(draft, "new", "up")).toBeNull();
    expect(moveTarget(draft, "opportunity", "down")).toBeNull();
    expect(moveTarget(draft, "won", "up")).toBeNull();
    expect(moveTarget(draft, "lost", "up")).toBeNull();
    const moved = moveStage(draft, "contacted", "up");
    expect(moved.map((s) => s.key)).toEqual([
      "new",
      "contacted",
      "qualified",
      "interested",
      "opportunity",
      "won",
      "lost",
    ]);
    expect(moveStage(moved, "contacted", "down").map((s) => s.key)).toEqual(
      draft.map((s) => s.key),
    );
    expect(isDirty(moved, PIPELINE_CONFIG)).toBe(true);
  });

  it("archives existing stages, removes unsaved ones and never archives Won or Lost", () => {
    const archived = archiveStage(draft, "interested");
    expect(archived.find((s) => s.key === "interested")?.archived).toBe(true);
    expect(archiveStage(draft, "won")).toEqual(draft);
    const { draft: withNew, id } = addStage(draft, "Proposal sent");
    expect(withNew.map((s) => s.label)).toEqual([
      "New",
      "Qualified",
      "Contacted",
      "Interested",
      "Opportunity",
      "Proposal sent",
      "Won",
      "Lost",
    ]);
    expect(archiveStage(withNew, id)).toHaveLength(draft.length);
    expect(restoreStage(archived, "interested").find((s) => s.key === "interested")?.archived).toBe(
      false,
    );
  });

  it("validates names, duplicates and the active-stage limit like the API", () => {
    expect(validateDraft(renameStage(draft, "new", "  ")).rows.new).toBe("Give the stage a name.");
    expect(validateDraft(renameStage(draft, "contacted", "qualified")).rows.contacted).toMatch(
      /already called/,
    );
    // A duplicate of an archived stage's name is fine.
    expect(
      validateDraft(renameStage(archiveStage(draft, "interested"), "contacted", "Interested")).rows,
    ).toEqual({});
    let many = draft;
    for (let i = 0; i < 6; i++) many = addStage(many, `Extra ${i}`).draft;
    expect(validateDraft(many).form).toMatch(/At most 12 stages can be active/);
    const allArchived = draft.map((s) => (s.kind === "open" ? { ...s, archived: true } : s));
    expect(validateDraft(allArchived).form).toMatch(/at least one active stage/);
  });

  it("sends the full list in board order: keys for existing stages, none for new ones", () => {
    const { draft: d } = addStage(moveStage(draft, "contacted", "up"), " Proposal sent ");
    const body = toRequest(archiveStage(d, "interested"), 4);
    expect(body.version).toBe(4);
    expect(body.stages[1]).toEqual({ key: "contacted", label: "Contacted", archived: false });
    expect(body.stages[3]).toEqual({ key: "interested", label: "Interested", archived: true });
    expect(body.stages[5]).toEqual({ label: "Proposal sent", archived: false });
  });
});

describe("Settings → Pipeline stages", () => {
  function configApi(
    handlers: {
      put?: (
        body: Record<string, unknown>,
        n: number,
      ) => { status?: number; body?: unknown } | undefined;
    } = {},
  ) {
    let config: PipelineConfig = PIPELINE_CONFIG;
    const puts: Record<string, unknown>[] = [];
    stubApi((url, init) => {
      if (url.pathname !== "/pipeline/config") return undefined;
      if (init.method === "PUT") {
        const body = JSON.parse(String(init.body)) as Record<string, unknown>;
        puts.push(body);
        const custom = handlers.put?.(body, puts.length);
        if (custom) {
          if (custom.status === 409 && JSON.stringify(custom.body).includes("VERSION_CONFLICT")) {
            config = {
              ...config,
              version: 2,
              stages: config.stages.map((s) =>
                s.key === "new" ? { ...s, label: "Fresh leads" } : s,
              ),
            };
          }
          return custom;
        }
        const stages = (body.stages as { key?: string; label: string; archived: boolean }[]).map(
          (s, order) => ({
            key: s.key ?? "proposal_sent",
            label: s.label,
            kind: (PIPELINE_CONFIG.stages.find((x) => x.key === s.key)?.kind ?? "open") as "open",
            order,
            archived: s.archived,
          }),
        );
        config = { ...config, version: config.version + 1, stages };
        return ok(config);
      }
      return ok(config);
    });
    return puts;
  }

  it("renames and reorders with the keyboard, keeps focus on the moved stage and saves once", async () => {
    const puts = configApi();
    const user = userEvent.setup();
    renderWithQuery(
      <>
        <PipelineSettings canEdit />
        <Toaster />
      </>,
    );
    const name = await screen.findByLabelText("Stage 3 name");
    await user.clear(name);
    await user.type(name, "Called");
    const up = screen.getByRole("button", { name: "Move Called up" });
    up.focus();
    await user.keyboard("{Enter}");
    expect(screen.getByLabelText("Stage 2 name")).toHaveValue("Called");
    expect(document.activeElement).toHaveAccessibleName("Move Called up");
    expect(screen.getByTestId("stages-announcer")).toHaveTextContent(
      "Moved Called up to position 2 of 7.",
    );
    // The first stage cannot move up; Won and Lost have no move buttons at all.
    expect(screen.getByRole("button", { name: "Move New up" })).toBeDisabled();
    expect(screen.queryByRole("button", { name: /Move Won/ })).toBeNull();
    await user.click(screen.getByRole("button", { name: "Save stages" }));
    await waitFor(() => expect(puts).toHaveLength(1));
    expect(puts[0]).toMatchObject({ version: 1 });
    expect((puts[0]!.stages as { key: string; label: string }[]).slice(0, 3)).toEqual([
      { key: "new", label: "New", archived: false },
      { key: "contacted", label: "Called", archived: false },
      { key: "qualified", label: "Qualified", archived: false },
    ]);
    expect(await screen.findByText("Pipeline stages saved")).toBeVisible();
  });

  it("on a version conflict reloads the latest stages and explains", async () => {
    const puts = configApi({ put: (_b, n) => (n === 1 ? conflict(2) : undefined) });
    const user = userEvent.setup();
    renderWithQuery(<PipelineSettings canEdit />);
    const first = await screen.findByLabelText("Stage 1 name");
    await user.clear(first);
    await user.type(first, "Inbox");
    await user.click(screen.getByRole("button", { name: "Save stages" }));
    const notice = await screen.findByTestId("stages-notice");
    expect(notice).toHaveTextContent("Someone else changed the stages");
    await waitFor(() => expect(screen.getByLabelText("Stage 1 name")).toHaveValue("Fresh leads"));
    expect(puts).toHaveLength(1);
  });

  it("explains STAGE_NOT_EMPTY with the stage and its leads", async () => {
    configApi({
      put: () => ({
        status: 409,
        body: {
          error: {
            code: "STAGE_NOT_EMPTY",
            message: "Not empty",
            details: [
              { path: "stageKey", message: "contacted" },
              { path: "leads", message: "4" },
            ],
            requestId: "r",
          },
        },
      }),
    });
    const user = userEvent.setup();
    renderWithQuery(<PipelineSettings canEdit />);
    await user.click(await screen.findByRole("button", { name: "Archive Contacted" }));
    expect(screen.getByRole("button", { name: "Restore Contacted" })).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Save stages" }));
    const notice = await screen.findByTestId("stages-notice");
    expect(notice).toHaveTextContent("Contacted still holds leads");
    expect(notice).toHaveTextContent("Contacted has 4 leads");
    expect(within(notice).getByRole("link", { name: "pipeline" })).toHaveAttribute(
      "href",
      "/app/pipeline?stage=contacted",
    );
  });

  it("other roles see the stages read only", async () => {
    role = "researcher";
    configApi();
    renderWithQuery(<PipelineSettings canEdit={false} />);
    expect(await screen.findByText("Qualified")).toBeVisible();
    expect(screen.queryByRole("button", { name: "Save stages" })).toBeNull();
    expect(screen.queryByRole("textbox")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Lead fields
// ---------------------------------------------------------------------------

describe("lead field edits", () => {
  const base = LEADS.find((l) => l.id === LEAD_MAMA_ID)!;

  it("sends only what changed, clearing with null", () => {
    const won: Lead = {
      ...base,
      stageKey: "won",
      stageKind: "won",
      priority: "high",
      nextActionAt: null,
    };
    const values = {
      priority: "none" as const,
      nextAction: "",
      wonValue: "250,000.50",
      currency: "NGN",
      lostReason: "",
    };
    expect(leadPatchBody(won, values, { won: true, lost: false })).toEqual({
      body: { priority: null, wonValueMinor: 25000050, currency: "NGN" },
      errors: {},
    });
    expect(
      leadPatchBody(
        won,
        { ...values, priority: "high", wonValue: "abc" },
        { won: true, lost: false },
      ).errors.wonValue,
    ).toMatch(/Enter an amount/);
    const lost: Lead = {
      ...base,
      stageKey: "lost",
      stageKind: "lost",
      lostReason: "Chose a competitor",
    };
    expect(
      leadPatchBody(
        lost,
        { ...values, priority: "high", wonValue: "", lostReason: "  " },
        { won: false, lost: true },
      ).body,
    ).toEqual({ lostReason: null });
  });

  function leadApi(opts: { conflictOnce?: boolean } = {}) {
    let current: Lead = { ...base };
    const patches: Record<string, unknown>[] = [];
    stubApi((url, init) => {
      if (url.pathname === "/organizations/current") return ok({ defaultCurrency: "NGN" });
      if (url.pathname === `/pipeline/leads/${base.id}` && init.method === "PATCH") {
        const body = JSON.parse(String(init.body)) as Record<string, unknown>;
        patches.push(body);
        if (opts.conflictOnce && patches.length === 1) {
          current = { ...current, priority: "low", version: current.version + 1 };
          return conflict(current.version);
        }
        if (body.version !== current.version) return conflict(current.version);
        const { version: _v, ...fields } = body;
        current = { ...current, ...(fields as Partial<Lead>), version: current.version + 1 };
        return ok(current);
      }
      if (url.pathname === `/pipeline/leads/${base.id}`) return ok(current);
      return undefined;
    });
    return patches;
  }

  it("edits priority and the next action with the lead's version", async () => {
    const patches = leadApi();
    const onSaved = vi.fn();
    const user = userEvent.setup();
    renderWithQuery(
      <LeadDetailsDialog
        lead={base}
        config={PIPELINE_CONFIG}
        open
        onOpenChange={() => {}}
        onSaved={onSaved}
      />,
    );
    const dialog = await screen.findByTestId("lead-details-dialog");
    await user.click(within(dialog).getByRole("combobox", { name: /Priority/ }));
    await user.click(await screen.findByRole("option", { name: "Medium priority" }));
    await user.type(within(dialog).getByLabelText("Next action"), "2026-11-02T10:30");
    await user.click(within(dialog).getByRole("button", { name: "Save details" }));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(patches).toHaveLength(1);
    expect(patches[0]).toMatchObject({ version: base.version, priority: "medium" });
    expect(new Date(String(patches[0]!.nextActionAt)).getTime()).toBe(
      new Date("2026-11-02T10:30").getTime(),
    );
  });

  it("on a version conflict loads the latest lead, keeps the edit and saves on the new version", async () => {
    const patches = leadApi({ conflictOnce: true });
    const onSaved = vi.fn();
    const user = userEvent.setup();
    renderWithQuery(
      <LeadDetailsDialog
        lead={base}
        config={PIPELINE_CONFIG}
        open
        onOpenChange={() => {}}
        onSaved={onSaved}
      />,
    );
    const dialog = await screen.findByTestId("lead-details-dialog");
    await user.click(within(dialog).getByRole("combobox", { name: /Priority/ }));
    await user.click(await screen.findByRole("option", { name: "Medium priority" }));
    await user.click(within(dialog).getByRole("button", { name: "Save details" }));
    expect(await within(dialog).findByTestId("lead-changed")).toHaveTextContent("low priority");
    expect(onSaved).not.toHaveBeenCalled();
    await user.click(within(dialog).getByRole("button", { name: "Save details" }));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(patches.map((p) => p.version)).toEqual([base.version, base.version + 1]);
    expect(patches[1]).toMatchObject({ priority: "medium" });
  });

  it("a won lead offers an optional follow-up for its value, which opens on that field", async () => {
    const won = makeLead({
      id: LEAD_MAMA_ID,
      businessId: base.businessId,
      stageKey: "won",
      assignedToUserId: base.assignedToUserId,
    });
    stubApi((url) => {
      if (url.pathname === "/pipeline/leads")
        return { body: { data: [won], meta: { nextCursor: null, pageSize: 1 } } };
      if (url.pathname === "/pipeline/config") return ok(PIPELINE_CONFIG);
      if (url.pathname === "/organizations/current/members") return { body: MEMBERS };
      if (url.pathname === "/organizations/current") return ok({ defaultCurrency: "NGN" });
      return undefined;
    });
    const user = userEvent.setup();
    renderWithQuery(
      <LeadPanel
        businessId={base.businessId}
        businessName="Mama Put Kitchen (Sample)"
        suppressed={false}
      />,
    );
    const followUp = await screen.findByTestId("lead-follow-up");
    expect(followUp).toHaveTextContent("Optional: record what the deal is worth.");
    await user.click(within(followUp).getByRole("button", { name: "Record won value…" }));
    const dialog = await screen.findByTestId("lead-details-dialog");
    await waitFor(() => expect(within(dialog).getByLabelText("Won value")).toHaveFocus());
  });
});

describe("outreach next attempt", () => {
  it("plans the next attempt with the record's version", async () => {
    const record: OutreachRecord = makeOutreach({
      id: "6add8b76520012303c645301",
      businessId: base(),
      channel: "call",
      version: 3,
    });
    const patches: Record<string, unknown>[] = [];
    stubApi((url, init) => {
      if (url.pathname === `/outreach/${record.id}` && init.method === "PATCH") {
        patches.push(JSON.parse(String(init.body)));
        return ok({ ...record, version: 4 });
      }
      return undefined;
    });
    const onOpenChange = vi.fn();
    const user = userEvent.setup();
    renderWithQuery(
      <NextAttemptDialog
        record={record}
        name="Mama Put Kitchen (Sample)"
        open
        onOpenChange={onOpenChange}
      />,
    );
    await user.type(await screen.findByLabelText("Next attempt"), "2026-11-03T09:00");
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(patches[0]).toMatchObject({ version: 3 });
    expect(new Date(String(patches[0]!.nextAttemptAt)).getTime()).toBe(
      new Date("2026-11-03T09:00").getTime(),
    );
  });
});

function base(): string {
  return LEADS[0]!.businessId;
}
