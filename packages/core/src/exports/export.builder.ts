import { createHash } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import { UnrecoverableError, type Job } from "bullmq";
import { Logger } from "nestjs-pino";
import { z } from "zod";
import { ObjectId, type WithId } from "@leadforge/db-mongo";
import { ObjectIdString, ROLE_PERMISSIONS, UuidString, type ServerEnv } from "@leadforge/contracts";
import { ENV } from "../config/env.module.js";
import { AppError } from "../common/errors/app.error.js";
import { AuditService } from "../audit/audit.service.js";
import { BusinessesService } from "../businesses/businesses.service.js";
import { OrganizationsService } from "../organizations/organizations.service.js";
import { NotificationsService } from "../notifications/notifications.service.js";
import { csvLine } from "../normalization/csv-safety.js";
import { OBJECT_STORAGE, type ObjectStorage } from "../storage/object-storage.js";
import { buildZip } from "../storage/zip.js";
import type { CrmActor } from "../crm/crm.types.js";
import { AttributionCollector, csvRows, exportArchiveEntries } from "./export-format.js";
import { ExportsService, exportScope } from "./exports.service.js";
import {
  ExportJobRepository,
  type ExportJobDocument,
} from "./repositories/export-job.repository.js";

const Payload = z.object({ organizationId: UuidString, exportId: ObjectIdString });
const PAGE_SIZE = 500;
const TERMINAL = new Set(["completed", "failed", "expired"]);

class ExportGone extends Error {}

function describeSelection(doc: ExportJobDocument): string {
  if (doc.kind === "list")
    return `lead list "${doc.selection.listName ?? doc.selection.listId?.toHexString()}"`;
  if (doc.kind === "selection") return `${doc.selection.ids?.length ?? 0} selected businesses`;
  return `directory filters ${JSON.stringify(doc.selection.filter ?? {})}`;
}

/**
 * Worker side of async exports (queue `exports`, job `build-export`). Re-checks that the
 * requester is still a member allowed to export (a demotion to Sales Representative narrows the
 * scope to assigned leads, never widens it), reads the rows in pages, writes the ZIP once to
 * object storage and records the file. Retries rebuild from the start; the stored key is the
 * same, so a retry overwrites rather than duplicates.
 */
@Injectable()
export class ExportBuilder {
  constructor(
    private readonly jobs: ExportJobRepository,
    private readonly exports: ExportsService,
    private readonly businesses: BusinessesService,
    private readonly organizations: OrganizationsService,
    private readonly notifications: NotificationsService,
    private readonly audit: AuditService,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage,
    @Inject(ENV) private readonly env: ServerEnv,
  ) {}

  async build(payload: {
    organizationId: string;
    exportId: string;
  }): Promise<{ status: string; rowCount: number }> {
    const { organizationId } = payload;
    const doc = await this.jobs.findById(organizationId, payload.exportId);
    if (!doc)
      throw new ExportGone(
        `Export ${payload.exportId} not found in organization ${organizationId}`,
      );
    if (TERMINAL.has(doc.status)) return { status: doc.status, rowCount: doc.rowCount ?? 0 };

    const member = await this.organizations.isActiveMember(organizationId, doc.requestedByUserId);
    let scope: "all" | "assigned";
    try {
      if (!member.active || !member.role) throw AppError.forbidden();
      const actor: CrmActor = {
        userId: doc.requestedByUserId,
        permissions: ROLE_PERMISSIONS[member.role],
      };
      scope = doc.scope === "assigned" ? "assigned" : exportScope(actor);
    } catch (err) {
      if (!(err instanceof AppError)) throw err;
      await this.finish(doc, "failed", {
        code: "ACCESS_REVOKED",
        message: "The requester can no longer export from this organization.",
      });
      return { status: "failed", rowCount: 0 };
    }

    const started = await this.jobs.update(
      organizationId,
      doc._id,
      { status: "running", startedAt: doc.startedAt ?? new Date(), scope },
      ["queued", "running"],
    );
    if (!started) return { status: "unknown", rowCount: 0 };
    let restrict: ObjectId[][];
    try {
      restrict = await this.exports.restrictionsFor(organizationId, { ...doc, scope });
    } catch (err) {
      if (err instanceof AppError && err.code === "NOT_FOUND") {
        await this.finish(doc, "failed", {
          code: "LIST_DELETED",
          message: "The list was deleted before the export ran.",
        });
        return { status: "failed", rowCount: 0 };
      }
      throw err;
    }
    const filter = await this.businesses.exportFilter(organizationId, {
      filter: doc.selection.filter ?? {},
      restrictIds: restrict,
    });
    const matched = await this.businesses.countForExport(organizationId, filter, doc.rowCap + 1);
    const total = Math.min(matched, doc.rowCap);
    await this.jobs.update(organizationId, doc._id, { progress: { processed: 0, total } });

    const origin = this.exports.apiOrigin();
    const attributions = new AttributionCollector();
    let csv = "\uFEFF" + csvLine(doc.columns);
    let processed = 0;
    let afterId: ObjectId | null = null;
    while (processed < doc.rowCap) {
      const page: Awaited<ReturnType<BusinessesService["exportRowsAfter"]>> =
        await this.businesses.exportRowsAfter(
          organizationId,
          filter,
          afterId,
          Math.min(PAGE_SIZE, doc.rowCap - processed),
        );
      if (page.rows.length === 0) break;
      csv += csvRows(page.rows, doc.columns, origin);
      attributions.add(page.rows);
      processed += page.rows.length;
      afterId = page.lastId;
      await this.jobs.update(organizationId, doc._id, { progress: { processed, total } });
      if (page.rows.length < PAGE_SIZE) break;
    }

    const now = new Date();
    const stamp = now.toISOString().slice(0, 19).replace(/[:T]/g, "-");
    const base = `leadforge-${doc.kind}-${stamp}`;
    const zip = buildZip(
      exportArchiveEntries(`${base}.csv`, csv, attributions, {
        exportId: doc._id.toHexString(),
        generatedAt: now,
        rowCount: processed,
        truncated: matched > doc.rowCap,
        rowCap: doc.rowCap,
        selection: describeSelection(doc),
        scope,
        apiOrigin: origin,
      }),
      now,
    );
    const key = `exports/${organizationId}/${doc._id.toHexString()}/${base}.zip`;
    await this.storage.put(key, zip, "application/zip");
    const file: NonNullable<ExportJobDocument["file"]> = {
      key,
      name: `${base}.zip`,
      bytes: zip.length,
      sha256: createHash("sha256").update(zip).digest("hex"),
      contentType: "application/zip",
      expiresAt: new Date(now.getTime() + this.env.EXPORT_FILE_TTL_HOURS * 60 * 60 * 1000),
      deletedAt: null,
      licenses: [...attributions.licenses].sort(),
    };
    await this.finish(doc, "completed", null, {
      rowCount: processed,
      truncated: matched > doc.rowCap,
      file,
      progress: { processed, total },
    });
    // Stage 10: the organization was purged (or the export stopped) while this build ran: the file
    // must not outlive its record.
    const recorded = await this.jobs.findById(organizationId, doc._id);
    if (recorded?.status !== "completed" || recorded.file?.key !== key) {
      await this.storage.delete(key);
      return { status: recorded?.status ?? "gone", rowCount: 0 };
    }
    return { status: "completed", rowCount: processed };
  }

  /**
   * Notification and audit, then the terminal status last, so a client that sees a terminal
   * status also finds the notice (deduplicated by key if two attempts ever finish together).
   */
  async finish(
    doc: WithId<ExportJobDocument>,
    status: "completed" | "failed",
    error: { code: string; message: string } | null,
    result?: Pick<ExportJobDocument, "rowCount" | "truncated" | "file" | "progress">,
  ): Promise<void> {
    const current = await this.jobs.findById(doc.organizationId, doc._id);
    if (!current || TERMINAL.has(current.status)) return;
    const rowCount = result?.rowCount ?? current.rowCount ?? 0;
    await this.notifications.exportFinished({
      organizationId: doc.organizationId,
      userId: doc.requestedByUserId,
      exportId: doc._id.toHexString(),
      status,
      rowCount,
      reason: error?.message ?? null,
    });
    await this.audit.record({
      organizationId: doc.organizationId,
      actorUserId: doc.requestedByUserId,
      actorType: "system",
      action: "export.finished",
      resourceType: "export",
      resourceId: doc._id.toHexString(),
      after: {
        status,
        rowCount,
        truncated: result?.truncated ?? false,
        bytes: result?.file?.bytes ?? null,
        licenses: result?.file?.licenses ?? [],
        error,
      },
    });
    await this.jobs.update(
      doc.organizationId,
      doc._id,
      { status, error, finishedAt: new Date(), ...(result ?? {}) },
      ["queued", "running"],
    );
  }

  async failAfterRetries(organizationId: string, exportId: string, message: string): Promise<void> {
    const doc = await this.jobs.findById(organizationId, exportId);
    if (!doc || TERMINAL.has(doc.status)) return;
    await this.finish(doc, "failed", { code: "EXPORT_ERROR", message });
  }

  /**
   * Maintenance (`cleanup-exports`): deletes files past their retention and marks the exports
   * expired; fails exports stuck without progress for an hour.
   */
  async cleanup(now: Date = new Date()): Promise<{ expired: number; failed: number }> {
    let expired = 0;
    for (const due of await this.jobs.findExpiredFiles(now, 200)) {
      if (due.file?.key) await this.storage.delete(due.file.key);
      const updated = await this.jobs.update(
        due.organizationId,
        due._id,
        { status: "expired", file: due.file ? { ...due.file, deletedAt: now } : null },
        ["completed"],
      );
      if (updated) expired += 1;
    }
    let failed = 0;
    for (const stuck of await this.jobs.findStuck(new Date(now.getTime() - 60 * 60 * 1000), 100)) {
      const doc = await this.jobs.findById(stuck.organizationId, stuck._id);
      if (!doc || TERMINAL.has(doc.status)) continue;
      await this.finish(doc, "failed", {
        code: "TIMED_OUT",
        message: "The export stopped making progress; run it again.",
      });
      failed += 1;
    }
    return { expired, failed };
  }

  static isPayloadError(err: unknown): boolean {
    return err instanceof ExportGone;
  }
}

/** BullMQ glue for `exports`, shared by apps/worker and the API test harness. */
@Injectable()
export class ExportQueueHandler {
  constructor(
    private readonly builder: ExportBuilder,
    private readonly logger: Logger,
  ) {}

  async handle(job: Job): Promise<unknown> {
    if (job.name !== "build-export")
      throw new UnrecoverableError(`Unknown exports job ${job.name}`);
    const parsed = Payload.safeParse(job.data);
    if (!parsed.success) throw new UnrecoverableError("Invalid build-export payload");
    try {
      return await this.builder.build(parsed.data);
    } catch (err) {
      if (ExportBuilder.isPayloadError(err)) throw new UnrecoverableError((err as Error).message);
      const maxAttempts = job.opts.attempts ?? 1;
      if (job.attemptsMade + 1 >= maxAttempts) {
        this.logger.error(
          { err, exportId: parsed.data.exportId },
          "Export failed on its last attempt",
        );
        await this.builder.failAfterRetries(
          parsed.data.organizationId,
          parsed.data.exportId,
          "The export could not be built after retries.",
        );
      }
      throw err;
    }
  }
}
