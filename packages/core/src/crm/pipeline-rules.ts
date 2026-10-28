import {
  CRM_LIMITS,
  DEFAULT_PIPELINE_STAGES,
  type ErrorDetail,
  type UpdatePipelineConfigRequest,
} from "@leadforge/contracts";
import type { PipelineStageDoc } from "./crm.types.js";

export function defaultStages(): PipelineStageDoc[] {
  return DEFAULT_PIPELINE_STAGES.map((s, order) => ({ ...s, order, archived: false }));
}

export function sortedStages(stages: PipelineStageDoc[]): PipelineStageDoc[] {
  return [...stages].sort((a, b) => a.order - b.order);
}

export function activeStages(stages: PipelineStageDoc[]): PipelineStageDoc[] {
  return sortedStages(stages).filter((s) => !s.archived);
}

/** New leads start in the first active open stage. */
export function entryStage(stages: PipelineStageDoc[]): PipelineStageDoc {
  const entry = activeStages(stages).find((s) => s.kind === "open");
  if (!entry) throw new Error("Pipeline has no active open stage");
  return entry;
}

/** The next or previous active stage in board order, or null at either end. */
export function neighbourStage(
  stages: PipelineStageDoc[],
  currentKey: string,
  direction: "next" | "previous",
): PipelineStageDoc | null {
  const active = activeStages(stages);
  const all = sortedStages(stages);
  const current = all.find((s) => s.key === currentKey);
  if (!current) return direction === "next" ? (active[0] ?? null) : null;
  if (direction === "next") return active.find((s) => s.order > current.order) ?? null;
  return [...active].reverse().find((s) => s.order < current.order) ?? null;
}

/** Stage key from a label: lowercase words joined by underscores, unique among `taken`. */
export function stageKeyFromLabel(label: string, taken: Set<string>): string {
  let base = label
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 32);
  if (!/^[a-z]/.test(base)) base = `stage_${base}`.replace(/_+$/g, "").slice(0, 32);
  if (base === "stage" || base.length === 0) base = "stage";
  let key = base;
  for (let n = 2; taken.has(key); n++) key = `${base}_${n}`;
  return key;
}

export type PipelinePlan =
  | { ok: true; stages: PipelineStageDoc[]; archivedNow: string[] }
  | { ok: false; details: ErrorDetail[] };

/**
 * Validates a full stage list against the current one and returns the stages to store.
 * Rules: every existing stage stays (archive instead of removing); unknown or repeated keys are
 * refused; won and lost keep their kind and cannot be archived; at least one active open stage;
 * at most CRM_LIMITS.activeStagesMax active stages; active labels are unique (case-insensitive);
 * a new stage cannot start archived. Board order is the order of the request.
 */
export function planPipelineUpdate(
  current: PipelineStageDoc[],
  req: UpdatePipelineConfigRequest,
): PipelinePlan {
  const details: ErrorDetail[] = [];
  const byKey = new Map(current.map((s) => [s.key, s]));
  const seen = new Set<string>();
  const taken = new Set(current.map((s) => s.key));
  const next: PipelineStageDoc[] = [];

  req.stages.forEach((input, index) => {
    if (input.key !== undefined) {
      const existing = byKey.get(input.key);
      if (!existing) {
        details.push({
          path: `stages.${index}.key`,
          message: `Unknown stage key "${input.key}"; omit the key to add a stage`,
        });
        return;
      }
      if (seen.has(input.key)) {
        details.push({
          path: `stages.${index}.key`,
          message: `Stage "${input.key}" is listed twice`,
        });
        return;
      }
      seen.add(input.key);
      if (existing.kind !== "open" && input.archived) {
        details.push({
          path: `stages.${index}.archived`,
          message: `The ${existing.kind} stage cannot be archived; every pipeline keeps one won and one lost stage`,
        });
      }
      next.push({
        key: existing.key,
        label: input.label,
        kind: existing.kind,
        order: index,
        archived: input.archived,
      });
    } else {
      if (input.archived)
        details.push({
          path: `stages.${index}.archived`,
          message: "A new stage cannot start archived",
        });
      const key = stageKeyFromLabel(input.label, taken);
      taken.add(key);
      next.push({ key, label: input.label, kind: "open", order: index, archived: false });
    }
  });

  for (const stage of current) {
    if (!seen.has(stage.key)) {
      details.push({
        path: "stages",
        message: `Stage "${stage.label}" (${stage.key}) is missing; archive it instead of removing it`,
      });
    }
  }

  const active = next.filter((s) => !s.archived);
  if (active.length > CRM_LIMITS.activeStagesMax)
    details.push({
      path: "stages",
      message: `At most ${CRM_LIMITS.activeStagesMax} active stages`,
    });
  if (!active.some((s) => s.kind === "open"))
    details.push({ path: "stages", message: "Keep at least one active open stage for new leads" });
  const labels = new Map<string, number>();
  active.forEach((s) => {
    const label = s.label.trim().toLowerCase();
    const index = next.indexOf(s);
    if (labels.has(label))
      details.push({
        path: `stages.${index}.label`,
        message: `Another active stage is already called "${s.label}"`,
      });
    labels.set(label, index);
  });

  if (details.length) return { ok: false, details };
  const archivedNow = next
    .filter((s) => s.archived && byKey.get(s.key)?.archived === false)
    .map((s) => s.key);
  return { ok: true, stages: next, archivedNow };
}
