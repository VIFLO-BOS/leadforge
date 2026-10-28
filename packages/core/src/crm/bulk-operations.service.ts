import { createHash } from "node:crypto";
import { Injectable } from "@nestjs/common";
import { ObjectId, type WithId } from "@leadforge/db-mongo";
import {
  BULK_CHANGE_OUTCOMES,
  BULK_LIMITS,
  BulkItemOutcome,
  type BulkOperation,
  type BulkOperationItem,
  type BulkOperationItemsQuery,
  type BulkOperationListQuery,
  type BulkOperationRequest,
  type BulkPreview,
  type BulkSelection,
  type BulkStatus,
  type JobStatus,
  type JobSummary,
  type ListItemOutcome,
} from "@leadforge/contracts";
import { AppError } from "../common/errors/app.error.js";
import { withCursor } from "../common/pagination/cursor.js";
import { AuditService, type AuditContext } from "../audit/audit.service.js";
import { QueueService } from "../queue/queue.service.js";
import { BusinessesService } from "../businesses/businesses.service.js";
import {
  can,
  type BulkOperationDocument,
  type CrmActor,
  type LeadListDocument,
} from "./crm.types.js";
import { progressFrom, toBulkView } from "./crm-view.js";
import { LeadsService, type ItemResult } from "./leads.service.js";
import { ListsService } from "./lists.service.js";
import {
  BulkItemRepository,
  BulkOperationRepository,
} from "./repositories/bulk-operation.repository.js";

/** Businesses handled per write batch (and per $in query). */
export const BULK_CHUNK_SIZE = 200;

const LIST_TO_BULK: Record<ListItemOutcome, BulkItemOutcome> = {
  added: "added",
  removed: "removed",
  already_in_list: "unchanged",
  not_in_list: "unchanged",
  not_found: "not_found",
  suppressed: "suppressed",
  list_full: "list_full",
};

const FROM_JOB_STATUS: Record<JobStatus, BulkStatus[]> = {
  draft: [],
  queued: ["queued"],
  running: ["running"],
  completed: ["completed"],
  completed_with_warnings: ["completed_with_errors"],
  failed: ["failed"],
  cancelled: [],
};

export function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

function breakdownOf(
  results: Iterable<ItemResult>,
): Array<{ outcome: BulkItemOutcome; count: number }> {
  const counts = new Map<BulkItemOutcome, number>();
  for (const r of results) counts.set(r.outcome, (counts.get(r.outcome) ?? 0) + 1);
  return BulkItemOutcome.options
    .filter((o) => counts.has(o))
    .map((outcome) => ({ outcome, count: counts.get(outcome)! }));
}

/**
 * Bulk operations: preview (counts, nothing written), create (Idempotency-Key, selection
 * resolved and frozen, queued) and read. The worker (BulkRunner) applies them in chunks and
 * records one result per business.
 */
@Injectable()
export class BulkOperationsService {
  constructor(
    private readonly ops: BulkOperationRepository,
    private readonly items: BulkItemRepository,
    private readonly leads: LeadsService,
    private readonly lists: ListsService,
    private readonly businesses: BusinessesService,
    private readonly queue: QueueService,
    private readonly audit: AuditService,
  ) {}

  /** 403 unless the role allows the action at all (list ownership is checked with the list). */
  assertPermitted(actor: CrmActor, action: BulkOperationRequest["action"]): void {
    const ok =
      action === "assign"
        ? can(actor, "leads:assign")
        : action === "move_stage"
          ? can(actor, "pipeline:write")
          : can(actor, "lists:manage") || can(actor, "lists:manage_own");
    if (!ok) throw AppError.forbidden("Your role cannot run this bulk action");
  }

  /** Validates the action's parameters (404 list, 403 list owner, INVALID_ASSIGNEE, 400 stage). */
  async validateParams(
    organizationId: string,
    actor: CrmActor,
    req: BulkOperationRequest,
  ): Promise<WithId<LeadListDocument> | null> {
    if (req.action === "add_to_list" || req.action === "remove_from_list") {
      const list = await this.lists.requireList(organizationId, req.listId);
      this.lists.assertCanManage(actor, list);
      return list;
    }
    if (req.action === "assign" && req.assignedToUserId)
      await this.leads.assertAssignable(organizationId, req.assignedToUserId);
    if (req.action === "move_stage")
      await this.leads.requireActiveStage(organizationId, req.stageKey);
    return null;
  }

  /** Selected ids (deduplicated, in order) or the filter's matches (ascending id), with the full match count. */
  async resolve(
    organizationId: string,
    selection: BulkSelection,
  ): Promise<{ ids: ObjectId[]; matched: number }> {
    if (selection.ids) {
      const seen = new Set<string>();
      const ids = selection.ids
        .map((i) => i.toLowerCase())
        .filter((i) => (seen.has(i) ? false : (seen.add(i), true)))
        .map((i) => new ObjectId(i));
      return { ids, matched: ids.length };
    }
    const ids = await this.businesses.matchingIds(
      organizationId,
      selection.filter ?? {},
      BULK_LIMITS.maxItems + 1,
    );
    const matched =
      ids.length > BULK_LIMITS.maxItems
        ? await this.businesses.countMatchingFilter(organizationId, selection.filter ?? {})
        : ids.length;
    return { ids, matched };
  }

  /** Outcome per business for an operation; writes only with `apply`. */
  async execute(
    organizationId: string,
    actor: CrmActor,
    op: {
      action: BulkOperationRequest["action"];
      listId: ObjectId | null;
      assignedToUserId: string | null;
      stageKey: string | null;
    },
    list: WithId<LeadListDocument> | null,
    ids: ObjectId[],
    apply: boolean,
    operationId?: ObjectId,
  ): Promise<Map<string, ItemResult>> {
    switch (op.action) {
      case "add_to_list":
      case "remove_from_list": {
        const outcomes =
          op.action === "add_to_list"
            ? await this.lists.addBusinesses(organizationId, list!, actor.userId, ids, apply)
            : await this.lists.removeBusinesses(organizationId, list!, ids, apply);
        return new Map(
          [...outcomes].map(([id, o]) => [id, { outcome: LIST_TO_BULK[o], message: null }]),
        );
      }
      case "assign":
        return this.leads.bulkAssign(organizationId, actor, op.assignedToUserId, ids, {
          apply,
          operationId,
        });
      case "move_stage":
        return this.leads.bulkMove(organizationId, actor, op.stageKey!, ids, {
          apply,
          operationId,
        });
    }
  }

  private static params(req: BulkOperationRequest) {
    return {
      action: req.action,
      listId: "listId" in req ? new ObjectId(req.listId) : null,
      assignedToUserId: "assignedToUserId" in req ? req.assignedToUserId : null,
      stageKey: "stageKey" in req ? req.stageKey : null,
    };
  }

  async preview(
    organizationId: string,
    actor: CrmActor,
    req: BulkOperationRequest,
  ): Promise<BulkPreview> {
    this.assertPermitted(actor, req.action);
    const list = await this.validateParams(organizationId, actor, req);
    const { ids, matched } = await this.resolve(organizationId, req.selection);
    const considered = ids.slice(0, BULK_LIMITS.maxItems);
    const results: ItemResult[] = [];
    for (const part of chunk(considered, 1000)) {
      results.push(
        ...(
          await this.execute(
            organizationId,
            actor,
            BulkOperationsService.params(req),
            list,
            part,
            false,
          )
        ).values(),
      );
    }
    const breakdown = breakdownOf(results);
    return {
      action: req.action,
      matched,
      cap: BULK_LIMITS.maxItems,
      overCap: matched > BULK_LIMITS.maxItems,
      willChange: breakdown
        .filter((b) => (BULK_CHANGE_OUTCOMES as readonly string[]).includes(b.outcome))
        .reduce((n, b) => n + b.count, 0),
      breakdown,
    };
  }

  private static nameOf(
    req: BulkOperationRequest,
    count: number,
    list: LeadListDocument | null,
  ): string {
    const n = `${count} business${count === 1 ? "" : "es"}`;
    switch (req.action) {
      case "add_to_list":
        return `Add ${n} to "${list?.name ?? "list"}"`;
      case "remove_from_list":
        return `Remove ${n} from "${list?.name ?? "list"}"`;
      case "assign":
        return req.assignedToUserId ? `Assign ${n}` : `Unassign ${n}`;
      case "move_stage":
        return `Move ${n} to stage ${req.stageKey}`;
    }
  }

  async create(
    organizationId: string,
    actor: CrmActor,
    req: BulkOperationRequest,
    idempotencyKey: string,
    auditCtx: AuditContext,
  ): Promise<{ operation: BulkOperation; replayed: boolean }> {
    this.assertPermitted(actor, req.action);
    const requestHash = createHash("sha256").update(JSON.stringify(req)).digest("hex");
    const existing = await this.ops.findByIdempotencyKey(
      organizationId,
      actor.userId,
      idempotencyKey,
    );
    if (existing) {
      if (existing.requestHash !== requestHash)
        throw AppError.conflict(
          "This Idempotency-Key was already used for a different bulk operation",
        );
      return { operation: toBulkView(existing), replayed: true };
    }
    const list = await this.validateParams(organizationId, actor, req);
    const { ids, matched } = await this.resolve(organizationId, req.selection);
    if (matched > BULK_LIMITS.maxItems) {
      throw new AppError(
        "BULK_LIMIT_EXCEEDED",
        `This selection matches ${matched.toLocaleString("en")} businesses; a bulk operation handles at most ${BULK_LIMITS.maxItems.toLocaleString("en")}. Narrow the filters.`,
        [
          { path: "selection.matched", message: String(matched) },
          { path: "selection.cap", message: String(BULK_LIMITS.maxItems) },
        ],
      );
    }
    if (ids.length === 0)
      throw AppError.validation([
        { path: "selection", message: "The selection matches no businesses" },
      ]);

    const now = new Date();
    const p = BulkOperationsService.params(req);
    const doc: BulkOperationDocument = {
      _id: new ObjectId(),
      organizationId,
      action: req.action,
      name: BulkOperationsService.nameOf(req, ids.length, list),
      params: { listId: p.listId, assignedToUserId: p.assignedToUserId, stageKey: p.stageKey },
      selection: {
        kind: req.selection.ids ? "ids" : "filter",
        filter: req.selection.filter ?? null,
      },
      targetIds: ids,
      status: "queued",
      progress: {
        total: ids.length,
        processed: 0,
        changed: 0,
        unchanged: 0,
        skipped: 0,
        failed: 0,
      },
      breakdown: [],
      error: null,
      idempotencyKey,
      requestHash,
      requestedByUserId: actor.userId,
      createdAt: now,
      updatedAt: now,
      startedAt: null,
      finishedAt: null,
    };
    if (!(await this.ops.insert(organizationId, doc))) {
      const winner = await this.ops.findByIdempotencyKey(
        organizationId,
        actor.userId,
        idempotencyKey,
      );
      if (winner && winner.requestHash === requestHash)
        return { operation: toBulkView(winner), replayed: true };
      throw AppError.conflict(
        "This Idempotency-Key was already used for a different bulk operation",
      );
    }
    try {
      await this.queue.enqueueBulkOperation({ organizationId, operationId: doc._id.toHexString() });
    } catch (err) {
      await this.ops.update(organizationId, doc._id, {
        status: "failed",
        error: {
          code: "ENQUEUE_FAILED",
          message: "The operation could not be queued; nothing was changed.",
        },
        finishedAt: new Date(),
      });
      throw err;
    }
    await this.audit.record(
      {
        organizationId,
        actorUserId: actor.userId,
        actorType: "user",
        action: "bulk.requested",
        resourceType: "bulk_operation",
        resourceId: doc._id.toHexString(),
        after: {
          action: req.action,
          params: {
            listId: p.listId?.toHexString() ?? null,
            assignedToUserId: p.assignedToUserId,
            stageKey: p.stageKey,
          },
          selection: req.selection.ids ? { ids: ids.length } : { filter: req.selection.filter },
          total: ids.length,
        },
      },
      auditCtx,
    );
    return { operation: toBulkView(doc), replayed: false };
  }

  async requireOperation(
    organizationId: string,
    id: string,
  ): Promise<WithId<BulkOperationDocument>> {
    const doc = await this.ops.findById(organizationId, id);
    if (!doc) throw AppError.notFound("Bulk operation");
    return doc;
  }

  async get(organizationId: string, id: string): Promise<BulkOperation> {
    return toBulkView(await this.requireOperation(organizationId, id));
  }

  async list(
    organizationId: string,
    query: BulkOperationListQuery,
  ): Promise<{ items: BulkOperation[]; nextCursor: string | null }> {
    const filter = {
      ...(query.status?.length ? { status: { $in: query.status } } : {}),
      ...(query.action?.length ? { action: { $in: query.action } } : {}),
    };
    const page = await withCursor(() =>
      this.ops.page(organizationId, filter, {
        pageSize: query.pageSize,
        cursor: query.cursor ?? null,
      }),
    );
    return { items: page.items.map(toBulkView), nextCursor: page.nextCursor };
  }

  async listItems(
    organizationId: string,
    id: string,
    query: BulkOperationItemsQuery,
  ): Promise<{ items: BulkOperationItem[]; nextCursor: string | null }> {
    const op = await this.requireOperation(organizationId, id);
    const page = await withCursor(() =>
      this.items.page(organizationId, op._id, query.outcome, {
        pageSize: query.pageSize,
        cursor: query.cursor ?? null,
      }),
    );
    // Names are joined on read, not stored on the items: one projected, organization-scoped
    // `_id $in` lookup per page (at most pageSize ids). Storing a copy would mean a heavier write
    // for up to 5,000 items per operation, and a name kept outside the business that would escape
    // source-retention purges, corrections and merges. Expired names come back null.
    const names = await this.businesses.summaries(
      organizationId,
      page.items.map((i) => i.businessId),
    );
    return {
      items: page.items.map((i) => {
        const businessId = i.businessId.toHexString();
        const summary = names.get(businessId);
        return {
          businessId,
          businessName: summary?.name ?? null,
          businessNameState: summary?.nameState ?? null,
          outcome: i.outcome,
          message: i.message,
          processedAt: i.processedAt.toISOString(),
        };
      }),
      nextCursor: page.nextCursor,
    };
  }

  /** All-jobs page: operations created before `before`, newest first. */
  async jobSummariesBefore(
    organizationId: string,
    statuses: JobStatus[] | undefined,
    before: { createdAt: Date; id: ObjectId } | null,
    limit: number,
  ): Promise<Array<{ createdAt: Date; id: ObjectId; summary: JobSummary }>> {
    const raw = statuses ? statuses.flatMap((s) => FROM_JOB_STATUS[s]) : undefined;
    if (raw && raw.length === 0) return [];
    const docs = await this.ops.pageBefore(organizationId, raw, before, limit);
    return docs.map((op) => ({
      createdAt: op.createdAt,
      id: op._id,
      summary: {
        id: op._id.toHexString(),
        kind: "bulk",
        name: op.name,
        status: op.status === "completed_with_errors" ? "completed_with_warnings" : op.status,
        kindStatus: op.status,
        progress: {
          processed: op.progress.processed,
          total: op.progress.total,
          failed: op.progress.failed,
        },
        createdByUserId: op.requestedByUserId,
        createdAt: op.createdAt.toISOString(),
        startedAt: op.startedAt?.toISOString() ?? null,
        finishedAt: op.finishedAt?.toISOString() ?? null,
        href: `/app/jobs/bulk/${op._id.toHexString()}`,
      },
    }));
  }

  /** Bulk operations created per UTC day, split by status (reports). */
  jobsPerDay(organizationId: string, from: Date, to: Date) {
    return this.ops.aggregateByDay(organizationId, {
      dateField: "createdAt",
      from,
      to,
      groupField: "status",
    });
  }

  /** Progress counters and breakdown from the recorded results. */
  async refreshProgress(
    organizationId: string,
    op: BulkOperationDocument,
  ): Promise<Pick<BulkOperationDocument, "progress" | "breakdown">> {
    const counts = await this.items.countsByOutcome(organizationId, op._id);
    return {
      progress: progressFrom(op.targetIds.length, counts),
      breakdown: BulkItemOutcome.options
        .filter((o) => counts.has(o))
        .map((outcome) => ({ outcome, count: counts.get(outcome)! })),
    };
  }
}
