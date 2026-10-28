import {
  CRM_LIMITS,
  type PipelineConfig,
  type PipelineStageKind,
  type UpdatePipelineConfigRequest,
} from "@leadforge/contracts";
import { isApiError } from "./api";

/*
 * Pipeline stage settings (Phase 5 gap, "configurable stages"). The draft is the full stage list
 * in board order, edited locally and saved in one PUT /pipeline/config with the loaded `version`.
 * Rules mirror the API's (each is also a 400 with a per-stage path there): existing stages are
 * archived, never removed; won and lost cannot be archived and stay put; at least one active open
 * stage; at most 12 active stages and 20 in all; active labels unique (case-insensitive); labels
 * 1 to 40 characters.
 */

export interface StageDraft {
  /** The stage key for existing stages, a temporary id for new ones. */
  id: string;
  key?: string;
  label: string;
  kind: PipelineStageKind;
  archived: boolean;
  isNew: boolean;
}

export const STAGE_LIMITS = {
  activeMax: CRM_LIMITS.activeStagesMax,
  totalMax: CRM_LIMITS.stagesMax,
  labelMax: CRM_LIMITS.stageLabelMax,
} as const;

export function draftFromConfig(config: PipelineConfig): StageDraft[] {
  return [...config.stages]
    .sort((a, b) => a.order - b.order)
    .map((s) => ({
      id: s.key,
      key: s.key,
      label: s.label,
      kind: s.kind,
      archived: s.archived,
      isNew: false,
    }));
}

let seq = 0;
export function newStageId(): string {
  seq += 1;
  return `new-${Date.now().toString(36)}-${seq}`;
}

/** Won and Lost close a lead: never archived, never moved. */
export function isFixed(s: Pick<StageDraft, "kind">): boolean {
  return s.kind !== "open";
}

export function activeCount(draft: readonly StageDraft[]): number {
  return draft.filter((s) => !s.archived).length;
}

/** New leads enter the first active open stage. */
export function entryStageId(draft: readonly StageDraft[]): string | null {
  return draft.find((s) => s.kind === "open" && !s.archived)?.id ?? null;
}

/**
 * Index the stage can move to, or null when it cannot: a fixed stage never moves, and an open
 * stage never crosses Won or Lost (it swaps with open neighbours only).
 */
export function moveTarget(
  draft: readonly StageDraft[],
  id: string,
  direction: "up" | "down",
): number | null {
  const i = draft.findIndex((s) => s.id === id);
  if (i < 0 || isFixed(draft[i]!)) return null;
  const j = direction === "up" ? i - 1 : i + 1;
  const neighbour = draft[j];
  if (!neighbour || isFixed(neighbour)) return null;
  return j;
}

export function moveStage(
  draft: readonly StageDraft[],
  id: string,
  direction: "up" | "down",
): StageDraft[] {
  const i = draft.findIndex((s) => s.id === id);
  const j = moveTarget(draft, id, direction);
  if (i < 0 || j === null) return [...draft];
  const next = [...draft];
  [next[i], next[j]] = [next[j]!, next[i]!];
  return next;
}

export function renameStage(draft: readonly StageDraft[], id: string, label: string): StageDraft[] {
  return draft.map((s) => (s.id === id ? { ...s, label } : s));
}

/** Archive an existing open stage (a new, unsaved stage is removed instead). */
export function archiveStage(draft: readonly StageDraft[], id: string): StageDraft[] {
  const s = draft.find((x) => x.id === id);
  if (!s || isFixed(s)) return [...draft];
  if (s.isNew) return draft.filter((x) => x.id !== id);
  return draft.map((x) => (x.id === id ? { ...x, archived: true } : x));
}

export function restoreStage(draft: readonly StageDraft[], id: string): StageDraft[] {
  return draft.map((x) => (x.id === id ? { ...x, archived: false } : x));
}

/** Whether another stage can be added (limits on active and total stages). */
export function canAddStage(draft: readonly StageDraft[]): boolean {
  return activeCount(draft) < STAGE_LIMITS.activeMax && draft.length < STAGE_LIMITS.totalMax;
}

/** A new open stage, placed after the last open stage (before Won and Lost). */
export function addStage(
  draft: readonly StageDraft[],
  label = "",
): { draft: StageDraft[]; id: string } {
  const id = newStageId();
  const stage: StageDraft = { id, label, kind: "open", archived: false, isNew: true };
  let at = draft.length;
  for (let i = draft.length - 1; i >= 0; i--) {
    if (draft[i]!.kind === "open") {
      at = i + 1;
      break;
    }
    at = i;
  }
  const next = [...draft];
  next.splice(at, 0, stage);
  return { draft: next, id };
}

export interface DraftProblems {
  /** Per-stage messages keyed by draft id. */
  rows: Record<string, string>;
  /** A rule about the whole list. */
  form: string | null;
}

export function validateDraft(draft: readonly StageDraft[]): DraftProblems {
  const rows: Record<string, string> = {};
  const seen = new Map<string, string>();
  for (const s of draft) {
    const label = s.label.trim();
    if (!label) rows[s.id] = "Give the stage a name.";
    else if (label.length > STAGE_LIMITS.labelMax)
      rows[s.id] = `Keep the name to ${STAGE_LIMITS.labelMax} characters.`;
    else if (!s.archived) {
      const k = label.toLocaleLowerCase();
      const other = seen.get(k);
      if (other) rows[s.id] = `Another active stage is already called “${label}”.`;
      else seen.set(k, s.id);
    }
  }
  let form: string | null = null;
  const active = activeCount(draft);
  if (!draft.some((s) => s.kind === "open" && !s.archived))
    form = "Keep at least one active stage before Won and Lost.";
  else if (active > STAGE_LIMITS.activeMax)
    form = `At most ${STAGE_LIMITS.activeMax} stages can be active; archive ${active - STAGE_LIMITS.activeMax} first.`;
  else if (draft.length > STAGE_LIMITS.totalMax)
    form = `A pipeline holds at most ${STAGE_LIMITS.totalMax} stages, archived ones included.`;
  else if (draft.length < 3) form = "A pipeline needs at least 3 stages.";
  return { rows, form };
}

export function hasProblems(p: DraftProblems): boolean {
  return Boolean(p.form) || Object.keys(p.rows).length > 0;
}

export function toRequest(
  draft: readonly StageDraft[],
  version: number,
): UpdatePipelineConfigRequest {
  return {
    version,
    stages: draft.map((s) => ({
      ...(s.key ? { key: s.key } : {}),
      label: s.label.trim(),
      archived: s.archived,
    })),
  };
}

/** Whether the draft differs from the saved configuration (names, order, archived). */
export function isDirty(draft: readonly StageDraft[], config: PipelineConfig | undefined): boolean {
  if (!config) return false;
  const saved = draftFromConfig(config);
  if (saved.length !== draft.length) return true;
  return draft.some((s, i) => {
    const o = saved[i]!;
    return s.key !== o.key || s.label.trim() !== o.label || s.archived !== o.archived;
  });
}

/** Maps 400 `stages.<i>.label` (and other per-stage paths) back onto draft rows. */
export function serverRowErrors(err: unknown, draft: readonly StageDraft[]): DraftProblems {
  const out: DraftProblems = { rows: {}, form: null };
  if (!isApiError(err) || err.code !== "VALIDATION_FAILED") return out;
  for (const d of err.details ?? []) {
    const m = /^stages\.(\d+)/.exec(d.path);
    const row = m ? draft[Number(m[1])] : undefined;
    if (row) out.rows[row.id] ??= d.message;
    else out.form ??= d.message;
  }
  return out;
}

/** `stageKey` and lead count from a 409 STAGE_NOT_EMPTY. */
export function stageNotEmptyDetails(
  err: unknown,
): { stageKey: string | null; leads: number | null } | null {
  if (!isApiError(err) || err.code !== "STAGE_NOT_EMPTY") return null;
  const get = (p: string) => err.details?.find((d) => d.path === p)?.message;
  const leads = Number(get("leads"));
  return { stageKey: get("stageKey") ?? null, leads: Number.isFinite(leads) ? leads : null };
}
