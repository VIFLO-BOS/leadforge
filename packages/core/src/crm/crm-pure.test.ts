import { describe, expect, it } from "vitest";
import { ObjectId } from "@leadforge/db-mongo";
import type { UpdatePipelineConfigRequest } from "@leadforge/contracts";
import {
  activeStages,
  defaultStages,
  entryStage,
  neighbourStage,
  planPipelineUpdate,
  stageKeyFromLabel,
} from "./pipeline-rules.js";
import { progressFrom, toBulkView } from "./crm-view.js";
import type { BulkOperationDocument } from "./crm.types.js";

const keep = (
  overrides: Partial<Record<string, { label?: string; archived?: boolean }>> = {},
): UpdatePipelineConfigRequest["stages"] =>
  defaultStages().map((s) => ({
    key: s.key,
    label: overrides[s.key]?.label ?? s.label,
    archived: overrides[s.key]?.archived ?? false,
  }));

const plan = (stages: UpdatePipelineConfigRequest["stages"]) =>
  planPipelineUpdate(defaultStages(), { version: 1, stages });

describe("default pipeline", () => {
  it("has the seven default stages with one won and one lost, New first", () => {
    const stages = defaultStages();
    expect(stages.map((s) => s.label)).toEqual([
      "New",
      "Qualified",
      "Contacted",
      "Interested",
      "Opportunity",
      "Won",
      "Lost",
    ]);
    expect(stages.filter((s) => s.kind === "won").map((s) => s.key)).toEqual(["won"]);
    expect(stages.filter((s) => s.kind === "lost").map((s) => s.key)).toEqual(["lost"]);
    expect(entryStage(stages).key).toBe("new");
  });
});

describe("pipeline config validation", () => {
  it("renames, reorders and adds stages; won and lost keep their kind", () => {
    const stages = keep({ new: { label: "Inbox" } });
    const [first, second, ...rest] = stages;
    const result = plan([second!, first!, { label: "Proposal sent", archived: false }, ...rest]);
    if (!result.ok) throw new Error(JSON.stringify(result.details));
    expect(result.stages.map((s) => [s.key, s.label, s.order])).toEqual([
      ["qualified", "Qualified", 0],
      ["new", "Inbox", 1],
      ["proposal_sent", "Proposal sent", 2],
      ["contacted", "Contacted", 3],
      ["interested", "Interested", 4],
      ["opportunity", "Opportunity", 5],
      ["won", "Won", 6],
      ["lost", "Lost", 7],
    ]);
    expect(result.stages.find((s) => s.key === "won")!.kind).toBe("won");
    expect(result.stages.find((s) => s.key === "proposal_sent")!.kind).toBe("open");
    // The entry stage follows the order: the first active open stage.
    expect(entryStage(result.stages).key).toBe("qualified");
  });

  it("archives an open stage and lists it as newly archived", () => {
    const result = plan(keep({ interested: { archived: true } }));
    if (!result.ok) throw new Error(JSON.stringify(result.details));
    expect(result.archivedNow).toEqual(["interested"]);
    expect(activeStages(result.stages).map((s) => s.key)).not.toContain("interested");
  });

  it("refuses a missing stage, an unknown or repeated key and archiving won or lost", () => {
    const missing = plan(keep().filter((s) => s.key !== "contacted"));
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.details[0]!.message).toMatch(/Contacted.*archive it instead/);

    const unknown = plan([...keep(), { key: "ghost", label: "Ghost", archived: false }]);
    expect(unknown.ok || unknown.details.map((d) => d.path)).toEqual(["stages.7.key"]);

    const repeated = plan([...keep(), { key: "new", label: "New again", archived: false }]);
    expect(repeated.ok || repeated.details.map((d) => d.message).join()).toMatch(/listed twice/);

    const won = plan(keep({ won: { archived: true } }));
    expect(won.ok || won.details).toEqual([
      { path: "stages.5.archived", message: expect.stringMatching(/won stage cannot be archived/) },
    ]);
    const lost = plan(keep({ lost: { archived: true } }));
    expect(lost.ok || lost.details.map((d) => d.path)).toEqual(["stages.6.archived"]);
  });

  it("refuses duplicate active labels, too many active stages, no open stage and new archived stages", () => {
    const dup = plan(keep({ qualified: { label: "new" } }));
    expect(dup.ok || dup.details.map((d) => d.path)).toEqual(["stages.1.label"]);
    // An archived stage may share a label with an active one.
    expect(plan(keep({ qualified: { label: "New", archived: true } })).ok).toBe(true);

    const extra = Array.from({ length: 6 }, (_, i) => ({
      label: `Extra ${i + 1}`,
      archived: false,
    }));
    const tooMany = plan([...keep(), ...extra]);
    expect(tooMany.ok || tooMany.details.map((d) => d.message).join()).toMatch(
      /At most 12 active stages/,
    );

    const noOpen = plan(
      keep({
        new: { archived: true },
        qualified: { archived: true },
        contacted: { archived: true },
        interested: { archived: true },
        opportunity: { archived: true },
      }),
    );
    expect(noOpen.ok || noOpen.details.map((d) => d.message).join()).toMatch(
      /at least one active open stage/,
    );

    const newArchived = plan([...keep(), { label: "Later", archived: true }]);
    expect(newArchived.ok || newArchived.details.map((d) => d.path)).toEqual(["stages.7.archived"]);
  });

  it("derives unique stage keys from labels", () => {
    const taken = new Set(["new", "proposal"]);
    expect(stageKeyFromLabel("Proposal", taken)).toBe("proposal_2");
    expect(stageKeyFromLabel("  Démo booked! ", taken)).toBe("demo_booked");
    expect(stageKeyFromLabel("2nd call", taken)).toBe("stage_2nd_call");
    expect(stageKeyFromLabel("!!!", taken)).toBe("stage");
  });
});

describe("keyboard stage moves", () => {
  it("moves to the next or previous active stage, skipping archived ones, and stops at the ends", () => {
    const stages = defaultStages().map((s) =>
      s.key === "contacted" ? { ...s, archived: true } : s,
    );
    expect(neighbourStage(stages, "qualified", "next")!.key).toBe("interested");
    expect(neighbourStage(stages, "interested", "previous")!.key).toBe("qualified");
    expect(neighbourStage(stages, "new", "previous")).toBeNull();
    expect(neighbourStage(stages, "lost", "next")).toBeNull();
    // A lead sitting in an archived stage can still move on.
    expect(neighbourStage(stages, "contacted", "next")!.key).toBe("interested");
  });
});

describe("bulk progress", () => {
  it("splits counts into changed, unchanged, skipped and failed with a percentage", () => {
    const counts = new Map<string, number>([
      ["added", 3],
      ["unchanged", 2],
      ["not_found", 1],
      ["suppressed", 1],
      ["failed", 1],
    ]);
    const progress = progressFrom(10, counts);
    expect(progress).toEqual({
      total: 10,
      processed: 8,
      changed: 3,
      unchanged: 2,
      skipped: 2,
      failed: 1,
    });
    const now = new Date();
    const doc = {
      _id: new ObjectId(),
      organizationId: "o",
      action: "add_to_list",
      name: "x",
      params: { listId: null, assignedToUserId: null, stageKey: null },
      selection: { kind: "ids", filter: null },
      status: "running",
      progress,
      breakdown: [],
      error: null,
      idempotencyKey: "k",
      requestHash: "h",
      requestedByUserId: "u",
      createdAt: now,
      updatedAt: now,
      startedAt: null,
      finishedAt: null,
    } as unknown as BulkOperationDocument;
    expect(toBulkView(doc).progress.percent).toBe(80);
  });
});
