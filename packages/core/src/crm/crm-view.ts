import type {
  Activity,
  ActivityBusiness,
  BulkOperation,
  Lead,
  LeadBusiness,
  LeadList,
  OutreachRecord,
  PipelineConfig,
  PipelineStage,
  PipelineStageKind,
} from "@leadforge/contracts";
import { BULK_CHANGE_OUTCOMES } from "@leadforge/contracts";
import type { WithId } from "@leadforge/db-mongo";
import type {
  ActivityDocument,
  BulkOperationDocument,
  LeadDocument,
  LeadListDocument,
  OutreachDocument,
  PipelineConfigDocument,
  PipelineStageDoc,
} from "./crm.types.js";
import { entryStage, sortedStages } from "./pipeline-rules.js";

const iso = (d: Date | null | undefined): string | null => (d ? d.toISOString() : null);

export function toStageView(s: PipelineStageDoc): PipelineStage {
  return { key: s.key, label: s.label, kind: s.kind, order: s.order, archived: s.archived };
}

export function toConfigView(doc: WithId<PipelineConfigDocument>): PipelineConfig {
  return {
    id: doc._id.toHexString(),
    version: doc.version,
    stages: sortedStages(doc.stages).map(toStageView),
    entryStageKey: entryStage(doc.stages).key,
    updatedAt: doc.updatedAt.toISOString(),
    updatedByUserId: doc.updatedByUserId,
  };
}

export function stageKindOf(stages: PipelineStageDoc[], key: string): PipelineStageKind {
  return stages.find((s) => s.key === key)?.kind ?? "open";
}

export function toLeadView(
  doc: LeadDocument,
  stages: PipelineStageDoc[],
  card: LeadBusiness | undefined,
): Lead {
  return {
    id: doc._id.toHexString(),
    businessId: doc.businessId.toHexString(),
    business: card ?? null,
    stageKey: doc.stageKey,
    stageKind: stageKindOf(stages, doc.stageKey),
    stageEnteredAt: doc.stageEnteredAt.toISOString(),
    assignedToUserId: doc.assignedToUserId,
    priority: doc.priority,
    nextActionAt: iso(doc.nextActionAt),
    lastActivityAt: iso(doc.lastActivityAt),
    lostReason: doc.lostReason,
    wonValueMinor: doc.wonValueMinor,
    currency: doc.currency,
    closedAt: iso(doc.closedAt),
    version: doc.version,
    createdByUserId: doc.createdByUserId,
    createdAt: doc.createdAt.toISOString(),
    updatedAt: doc.updatedAt.toISOString(),
  };
}

export function toListView(doc: LeadListDocument): LeadList {
  return {
    id: doc._id.toHexString(),
    name: doc.name,
    description: doc.description,
    ownerUserId: doc.ownerUserId,
    itemCount: doc.itemCount,
    createdByUserId: doc.createdByUserId,
    createdAt: doc.createdAt.toISOString(),
    updatedAt: doc.updatedAt.toISOString(),
  };
}

export function toActivityBusiness(card: LeadBusiness | undefined): ActivityBusiness | null {
  return card ? { id: card.id, name: card.name, nameState: card.nameState } : null;
}

export function toActivityView(doc: ActivityDocument, card: LeadBusiness | undefined): Activity {
  return {
    id: doc._id.toHexString(),
    type: doc.type,
    businessId: doc.businessId.toHexString(),
    business: toActivityBusiness(card),
    leadId: doc.leadId?.toHexString() ?? null,
    outreachId: doc.outreachId?.toHexString() ?? null,
    direction: doc.direction,
    outcome: doc.outcome,
    body: doc.body,
    target: doc.target,
    occurredAt: doc.occurredAt.toISOString(),
    authorUserId: doc.createdByUserId,
    stageChange: doc.stageChange ? { ...doc.stageChange } : null,
    assignment: doc.assignment ? { ...doc.assignment } : null,
    suppressionOverride: doc.suppressionOverride
      ? { reason: doc.suppressionOverride.reason }
      : null,
    editedAt: iso(doc.editedAt),
    createdAt: doc.createdAt.toISOString(),
  };
}

export function toOutreachView(
  doc: OutreachDocument,
  card: LeadBusiness | undefined,
): OutreachRecord {
  return {
    id: doc._id.toHexString(),
    businessId: doc.businessId.toHexString(),
    business: toActivityBusiness(card),
    leadId: doc.leadId?.toHexString() ?? null,
    channel: doc.channel,
    target: doc.target,
    status: doc.status,
    attempts: doc.attempts,
    lastAttemptAt: iso(doc.lastAttemptAt),
    lastOutcome: doc.lastOutcome,
    nextAttemptAt: iso(doc.nextAttemptAt),
    ownerUserId: doc.ownerUserId,
    suppressionOverride: doc.suppressionOverride
      ? {
          reason: doc.suppressionOverride.reason,
          byUserId: doc.suppressionOverride.byUserId,
          at: doc.suppressionOverride.at.toISOString(),
        }
      : null,
    version: doc.version,
    createdAt: doc.createdAt.toISOString(),
    updatedAt: doc.updatedAt.toISOString(),
  };
}

export function toBulkView(
  doc: Omit<BulkOperationDocument, "targetIds"> & { targetIds?: unknown },
): BulkOperation {
  const p = doc.progress;
  return {
    id: doc._id.toHexString(),
    action: doc.action,
    params: {
      listId: doc.params.listId?.toHexString() ?? null,
      assignedToUserId: doc.params.assignedToUserId,
      stageKey: doc.params.stageKey,
    },
    status: doc.status,
    selection: { kind: doc.selection.kind, filter: doc.selection.filter },
    progress: {
      ...p,
      percent: p.total > 0 ? Math.min(100, Math.floor((p.processed / p.total) * 100)) : 100,
    },
    breakdown: doc.breakdown.map((b) => ({ ...b })),
    error: doc.error,
    requestedByUserId: doc.requestedByUserId,
    createdAt: doc.createdAt.toISOString(),
    startedAt: iso(doc.startedAt),
    finishedAt: iso(doc.finishedAt),
  };
}

/** Progress counters from per-outcome counts. */
export function progressFrom(
  total: number,
  counts: Map<string, number>,
): BulkOperationDocument["progress"] {
  let changed = 0;
  let unchanged = 0;
  let skipped = 0;
  let failed = 0;
  for (const [outcome, n] of counts) {
    if ((BULK_CHANGE_OUTCOMES as readonly string[]).includes(outcome)) changed += n;
    else if (outcome === "unchanged") unchanged += n;
    else if (outcome === "failed") failed += n;
    else skipped += n;
  }
  return {
    total,
    processed: changed + unchanged + skipped + failed,
    changed,
    unchanged,
    skipped,
    failed,
  };
}
