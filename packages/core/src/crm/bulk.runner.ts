import { Injectable } from "@nestjs/common";
import { UnrecoverableError, type Job } from "bullmq";
import { Logger } from "nestjs-pino";
import { z } from "zod";
import { ObjectId, type WithId } from "@leadforge/db-mongo";
import { ObjectIdString, ROLE_PERMISSIONS, UuidString } from "@leadforge/contracts";
import { AppError } from "../common/errors/app.error.js";
import { AuditService } from "../audit/audit.service.js";
import { OrganizationsService } from "../organizations/organizations.service.js";
import { NotificationsService } from "../notifications/notifications.service.js";
import type {
  BulkItemDocument,
  BulkOperationDocument,
  CrmActor,
  LeadListDocument,
} from "./crm.types.js";
import { BulkOperationsService, BULK_CHUNK_SIZE, chunk } from "./bulk-operations.service.js";
import { ListsService } from "./lists.service.js";
import {
  BulkItemRepository,
  BulkOperationRepository,
} from "./repositories/bulk-operation.repository.js";

const Payload = z.object({ organizationId: UuidString, operationId: ObjectIdString });
const ITEM_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const TERMINAL = new Set(["completed", "completed_with_errors", "failed"]);

class OperationGone extends Error {}

/**
 * Worker side of bulk operations (queue `bulk`, job `run-bulk-operation`). Re-checks that the
 * requester is still an active member allowed to run the action, then applies the frozen
 * selection in chunks of 200, recording one result per business. A retried job skips the
 * businesses that already have a result, and every action is a no-op when its state is already
 * applied, so retries never add, assign, move or log twice.
 */
@Injectable()
export class BulkRunner {
  constructor(
    private readonly ops: BulkOperationRepository,
    private readonly items: BulkItemRepository,
    private readonly bulk: BulkOperationsService,
    private readonly lists: ListsService,
    private readonly organizations: OrganizationsService,
    private readonly notifications: NotificationsService,
    private readonly audit: AuditService,
  ) {}

  async run(payload: {
    organizationId: string;
    operationId: string;
  }): Promise<{ status: string; processed: number }> {
    const { organizationId } = payload;
    const op = await this.ops.findById(organizationId, payload.operationId);
    if (!op)
      throw new OperationGone(
        `Bulk operation ${payload.operationId} not found in organization ${organizationId}`,
      );
    if (TERMINAL.has(op.status)) return { status: op.status, processed: op.progress.processed };

    const member = await this.organizations.isActiveMember(organizationId, op.requestedByUserId);
    const actor: CrmActor | null =
      member.active && member.role
        ? { userId: op.requestedByUserId, permissions: ROLE_PERMISSIONS[member.role] }
        : null;
    let list: WithId<LeadListDocument> | null = null;
    try {
      if (!actor)
        throw new AppError("FORBIDDEN", "The requester is no longer a member of the organization");
      this.bulk.assertPermitted(actor, op.action);
      if (op.params.listId) {
        list = await this.lists.requireList(organizationId, op.params.listId);
        this.lists.assertCanManage(actor, list);
      }
    } catch (err) {
      if (!(err instanceof AppError)) throw err;
      const code = err.code === "NOT_FOUND" ? "LIST_DELETED" : "ACCESS_REVOKED";
      const message =
        err.code === "NOT_FOUND"
          ? "The list was deleted before the operation ran."
          : "The requester can no longer run this action.";
      await this.finish(op, "failed", { code, message });
      return { status: "failed", processed: op.progress.processed };
    }

    if (op.status === "queued")
      await this.ops.update(organizationId, op._id, {
        status: "running",
        startedAt: op.startedAt ?? new Date(),
      });
    const params = {
      action: op.action,
      listId: op.params.listId,
      assignedToUserId: op.params.assignedToUserId,
      stageKey: op.params.stageKey,
    };
    for (const part of chunk(op.targetIds, BULK_CHUNK_SIZE)) {
      const done = await this.items.recordedAmong(organizationId, op._id, part);
      const todo = part.filter((id) => !done.has(id.toHexString()));
      if (todo.length === 0) continue;
      const results = await this.bulk.execute(
        organizationId,
        actor!,
        params,
        list,
        todo,
        true,
        op._id,
      );
      const now = new Date();
      const docs: BulkItemDocument[] = todo.map((id) => {
        const r = results.get(id.toHexString()) ?? {
          outcome: "failed" as const,
          message: "No result",
        };
        return {
          _id: new ObjectId(),
          organizationId,
          operationId: op._id,
          businessId: id,
          outcome: r.outcome,
          message: r.message,
          processedAt: now,
          expiresAt: new Date(now.getTime() + ITEM_TTL_MS),
        };
      });
      await this.items.record(organizationId, docs);
      await this.ops.update(
        organizationId,
        op._id,
        await this.bulk.refreshProgress(organizationId, op),
      );
    }
    const final = await this.bulk.refreshProgress(organizationId, op);
    const status = final.progress.failed > 0 ? "completed_with_errors" : "completed";
    await this.finish(op, status, null, final);
    return { status, processed: final.progress.processed };
  }

  /**
   * List recount, notifications and audit, then the terminal status last, so a client that sees
   * a terminal status also finds the notice. Notices are deduplicated by key, so a rare second
   * finisher (a retry racing the stuck-job recovery) never notifies twice.
   */
  async finish(
    op: WithId<BulkOperationDocument>,
    status: "completed" | "completed_with_errors" | "failed",
    error: { code: string; message: string } | null,
    counters?: Pick<BulkOperationDocument, "progress" | "breakdown">,
  ): Promise<void> {
    const { organizationId } = op;
    const current = await this.ops.findById(organizationId, op._id);
    if (!current || TERMINAL.has(current.status)) return; // another attempt finished it
    const totals = counters ?? (await this.bulk.refreshProgress(organizationId, op));
    if (op.params.listId)
      await this.lists.recount(organizationId, op.params.listId).catch(() => null);
    const p = totals.progress;
    await this.notifications.bulkFinished({
      organizationId,
      userId: op.requestedByUserId,
      operationId: op._id.toHexString(),
      action: op.action,
      status,
      changed: p.changed,
      unchanged: p.unchanged,
      skipped: p.skipped,
      failed: p.failed,
      reason: error?.message ?? null,
    });
    if (op.action === "assign" && op.params.assignedToUserId) {
      const count = await this.items.countWithOutcomes(organizationId, op._id, [
        "assigned",
        "created_and_assigned",
      ]);
      await this.notifications.leadAssigned({
        organizationId,
        assigneeUserId: op.params.assignedToUserId,
        assignedByUserId: op.requestedByUserId,
        count,
        businessName: null,
        dedupeKey: `bulk-assign:${op._id.toHexString()}`,
      });
    }
    await this.audit.record({
      organizationId,
      actorUserId: op.requestedByUserId,
      actorType: "system",
      action: "bulk.finished",
      resourceType: "bulk_operation",
      resourceId: op._id.toHexString(),
      after: { action: op.action, status, progress: p, breakdown: totals.breakdown, error },
    });
    await this.ops.update(
      organizationId,
      op._id,
      { status, error, finishedAt: new Date(), ...totals },
      ["queued", "running"],
    );
  }

  /** Last attempt failed on our side: close the operation with what was recorded. */
  async failAfterRetries(
    organizationId: string,
    operationId: string,
    message: string,
  ): Promise<void> {
    const op = await this.ops.findById(organizationId, operationId);
    if (!op || TERMINAL.has(op.status)) return;
    await this.finish(op, "failed", { code: "BULK_ERROR", message });
  }

  /** Maintenance: operations stuck in queued or running for an hour are failed (the queue lost them). */
  async recoverStuck(now: Date = new Date()): Promise<{ failed: number }> {
    const stuck = await this.ops.findStuck(new Date(now.getTime() - 60 * 60 * 1000), 100);
    let failed = 0;
    for (const s of stuck) {
      const op = await this.ops.findById(s.organizationId, s._id);
      if (!op || TERMINAL.has(op.status)) continue;
      await this.finish(op, "failed", {
        code: "TIMED_OUT",
        message:
          "The operation stopped making progress; results so far were kept. Run it again for the rest.",
      });
      failed += 1;
    }
    return { failed };
  }

  static isPayloadError(err: unknown): boolean {
    return err instanceof OperationGone;
  }
}

/** BullMQ glue for `bulk`, shared by apps/worker and the API test harness. */
@Injectable()
export class BulkQueueHandler {
  constructor(
    private readonly runner: BulkRunner,
    private readonly logger: Logger,
  ) {}

  async handle(job: Job): Promise<unknown> {
    if (job.name !== "run-bulk-operation")
      throw new UnrecoverableError(`Unknown bulk job ${job.name}`);
    const parsed = Payload.safeParse(job.data);
    if (!parsed.success) throw new UnrecoverableError("Invalid run-bulk-operation payload");
    try {
      return await this.runner.run(parsed.data);
    } catch (err) {
      if (BulkRunner.isPayloadError(err)) throw new UnrecoverableError((err as Error).message);
      const maxAttempts = job.opts.attempts ?? 1;
      if (job.attemptsMade + 1 >= maxAttempts) {
        this.logger.error(
          { err, operationId: parsed.data.operationId },
          "Bulk operation failed on its last attempt",
        );
        await this.runner.failAfterRetries(
          parsed.data.organizationId,
          parsed.data.operationId,
          "The operation stopped after repeated errors; results so far were kept.",
        );
      }
      throw err;
    }
  }
}
