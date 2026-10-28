import { createHash } from "node:crypto";
import { extname } from "node:path";
import { Injectable } from "@nestjs/common";
import { Logger } from "nestjs-pino";
import { ObjectId, type WithId } from "@leadforge/db-mongo";
import {
  IMPORT_LIMITS,
  roleHasPermission,
  type JobStatus,
  type JobSummary,
  type ImportCommitRequest,
  type ImportJob,
  type ImportListQuery,
  type ImportMappingEntry,
  type ImportPreviewRequest,
  type ImportPreviewResponse,
  type ImportPreviewRow,
  type ImportRowIssue,
  type ImportRowResult,
  type ImportRowsQuery,
  type ImportStatus,
} from "@leadforge/contracts";
import { AppError } from "../common/errors/app.error.js";
import { withCursor } from "../common/pagination/cursor.js";
import { AuditService, type AuditContext } from "../audit/audit.service.js";
import { QueueService } from "../queue/queue.service.js";
import { NotificationsService } from "../notifications/notifications.service.js";
import { OrganizationsService } from "../organizations/organizations.service.js";
import {
  BusinessesService,
  type IngestItem,
  type IngestResult,
} from "../businesses/businesses.service.js";
import { SOURCE_CONFIDENCE } from "../businesses/business-model.js";
import { deterministicObjectId } from "../provenance/provenance.types.js";
import { ImportFileError, parseCsvFile } from "./csv-file.js";
import { suggestMapping } from "./mapping.js";
import { normalizeImportRow, type RowNormalizationResult } from "./row-normalizer.js";
import {
  ImportJobRepository,
  type ImportJobDocument,
} from "./repositories/import-job.repository.js";
import {
  ImportRowRepository,
  type ImportRowDocument,
  type RowOutcomeWrite,
} from "./repositories/import-row.repository.js";

export interface UploadedCsv {
  originalName: string;
  mimeType: string;
  size: number;
  buffer: Buffer;
}

/** MIME types browsers send for CSV and TSV files (Windows reports Excel's type for .csv). */
export const ACCEPTED_CSV_MIME_TYPES = [
  "text/csv",
  "application/csv",
  "text/x-csv",
  "application/x-csv",
  "text/comma-separated-values",
  "text/tab-separated-values",
  "text/plain",
  "application/vnd.ms-excel",
  "application/octet-stream",
] as const;

const PROCESS_BATCH_SIZE = 200;
const SAMPLE_ROWS = 5;
const DAY_MS = 24 * 60 * 60 * 1000;
const TERMINAL: ImportStatus[] = ["completed", "completed_with_errors", "failed"];

/**
 * CSV import of businesses (source `user_import`). Upload parses and stages rows; preview
 * normalizes a sample with the user's mapping; commit queues a BullMQ job and the worker
 * processes the staged rows in batches, writing a per-row outcome. Every row ends as
 * created, updated, suppressed or failed with reasons. None are dropped.
 */
@Injectable()
export class ImportsService {
  constructor(
    private readonly jobs: ImportJobRepository,
    private readonly rows: ImportRowRepository,
    private readonly businesses: BusinessesService,
    private readonly organizations: OrganizationsService,
    private readonly queue: QueueService,
    private readonly audit: AuditService,
    private readonly logger: Logger,
    private readonly notifications: NotificationsService,
  ) {}

  // -------------------------------------------------------------------------
  // Upload, preview, commit
  // -------------------------------------------------------------------------

  async upload(
    organizationId: string,
    userId: string,
    file: UploadedCsv,
    auditCtx: AuditContext,
  ): Promise<ImportJob> {
    const extension = extname(file.originalName).toLowerCase();
    if (!(IMPORT_LIMITS.acceptedExtensions as readonly string[]).includes(extension)) {
      throw new AppError(
        "UNSUPPORTED_MEDIA_TYPE",
        "Upload a .csv file (comma, semicolon or tab separated).",
      );
    }
    const mime = file.mimeType.split(";")[0]!.trim().toLowerCase();
    if (!(ACCEPTED_CSV_MIME_TYPES as readonly string[]).includes(mime)) {
      throw new AppError(
        "UNSUPPORTED_MEDIA_TYPE",
        `Files of type ${mime} are not accepted. Upload a CSV.`,
      );
    }

    let parsed;
    try {
      parsed = parseCsvFile(file.buffer);
    } catch (err) {
      if (err instanceof ImportFileError) {
        throw new AppError(
          err.code,
          err.message,
          err.line ? [{ path: "file", message: `line ${err.line}` }] : undefined,
        );
      }
      throw err;
    }

    const settings = await this.organizations.getDataSettings(organizationId);
    const now = new Date();
    const rowsExpireAt = new Date(now.getTime() + IMPORT_LIMITS.rowRetentionDays * DAY_MS);
    const job: ImportJobDocument = {
      _id: new ObjectId(),
      organizationId,
      status: "uploaded",
      fileName: sanitizeFileName(file.originalName),
      contentType: mime,
      sizeBytes: file.size,
      sha256: createHash("sha256").update(file.buffer).digest("hex"),
      encoding: parsed.encoding,
      delimiter: parsed.delimiter,
      headers: parsed.headers,
      rowCount: parsed.rows.length,
      blankRowsSkipped: parsed.blankRowsSkipped,
      sampleRows: parsed.rows.slice(0, SAMPLE_ROWS).map((r) => r.cells.map((c) => c.slice(0, 200))),
      suggestedMapping: suggestMapping(parsed.headers),
      mapping: null,
      defaultCountry: settings.country,
      attestation: null,
      progress: {
        total: parsed.rows.length,
        processed: 0,
        created: 0,
        updated: 0,
        suppressed: 0,
        failed: 0,
      },
      error: null,
      createdByUserId: userId,
      committedByUserId: null,
      createdAt: now,
      updatedAt: now,
      queuedAt: null,
      startedAt: null,
      finishedAt: null,
      rowsExpireAt,
      queue: { jobId: null },
    };
    await this.jobs.insert(organizationId, job);
    await this.rows.insertMany(
      organizationId,
      parsed.rows.map((r) => ({
        _id: new ObjectId(),
        organizationId,
        importId: job._id,
        rowNumber: r.rowNumber,
        cells: r.cells,
        outcome: null,
        businessId: null,
        errors: [],
        warnings: [],
        processedAt: null,
        expiresAt: rowsExpireAt,
      })),
    );
    await this.audit.record(
      {
        organizationId,
        actorUserId: userId,
        actorType: "user",
        action: "import.uploaded",
        resourceType: "import",
        resourceId: job._id.toHexString(),
        after: {
          fileName: job.fileName,
          sizeBytes: job.sizeBytes,
          rowCount: job.rowCount,
          sha256: job.sha256,
        },
      },
      auditCtx,
    );
    return toImportView(job);
  }

  async get(organizationId: string, id: string): Promise<ImportJob> {
    return toImportView(await this.requireJob(organizationId, id));
  }

  /** 404 for unknown or other-organization imports. */
  async requireJob(organizationId: string, id: string): Promise<WithId<ImportJobDocument>> {
    const job = await this.jobs.findById(organizationId, id);
    if (!job) throw AppError.notFound("Import");
    return job;
  }

  async list(
    organizationId: string,
    query: ImportListQuery,
  ): Promise<{ items: ImportJob[]; nextCursor: string | null }> {
    const page = await withCursor(() =>
      this.jobs.page(organizationId, query.status, {
        pageSize: query.pageSize,
        cursor: query.cursor ?? null,
      }),
    );
    return { items: page.items.map(toImportView), nextCursor: page.nextCursor };
  }

  private assertMappingFits(job: ImportJobDocument, mapping: ImportMappingEntry[]): void {
    const bad = mapping.findIndex((m) => m.column >= job.headers.length);
    if (bad >= 0) {
      throw AppError.validation([
        { path: `mapping.${bad}.column`, message: `The file has ${job.headers.length} columns` },
      ]);
    }
  }

  async preview(
    organizationId: string,
    id: string,
    req: ImportPreviewRequest,
  ): Promise<ImportPreviewResponse> {
    const job = await this.requireJob(organizationId, id);
    if (job.status !== "uploaded")
      throw AppError.conflict("This import has already been committed");
    this.assertMappingFits(job, req.mapping);

    const staged = await this.rows.firstRows(organizationId, job._id, req.limit);
    const normalized = staged.map((r) => ({
      row: r,
      result: normalizeImportRow(r.cells, job.headers, req.mapping, req.defaultCountry),
    }));
    const valid = normalized.filter((n) => n.result.valid && n.result.input);
    const decisions = await this.businesses.ingestBatch(
      organizationId,
      valid.map((n) =>
        this.ingestItem(
          job,
          n.row.rowNumber,
          n.result,
          job.createdByUserId,
          new Date(),
          new ObjectId(),
        ),
      ),
      { dryRun: true },
    );
    const decisionByRow = new Map(valid.map((n, i) => [n.row.rowNumber, decisions[i]!]));

    const rows: ImportPreviewRow[] = normalized.map(({ row, result }) => {
      const decision = decisionByRow.get(row.rowNumber);
      return {
        rowNumber: row.rowNumber,
        valid: result.valid,
        expectedOutcome: !decision
          ? "invalid"
          : decision.outcome === "suppressed"
            ? "suppressed"
            : decision.outcome === "updated"
              ? "update"
              : "create",
        matchedBusinessId:
          decision?.outcome === "updated" ? (decision.businessId?.toHexString() ?? null) : null,
        values: result.preview,
        errors: result.errors,
        warnings: [...result.warnings, ...(decision ? ingestWarnings(decision) : [])],
      };
    });

    await this.jobs.update(organizationId, job._id, {
      $set: { mapping: req.mapping, defaultCountry: req.defaultCountry, updatedAt: new Date() },
    });
    return {
      rows,
      summary: {
        totalRows: job.rowCount,
        checked: rows.length,
        valid: rows.filter((r) => r.valid).length,
        invalid: rows.filter((r) => !r.valid).length,
      },
    };
  }

  async commit(
    organizationId: string,
    userId: string,
    id: string,
    req: ImportCommitRequest,
    auditCtx: AuditContext,
  ): Promise<ImportJob> {
    const job = await this.requireJob(organizationId, id);
    this.assertMappingFits(job, req.mapping);
    const now = new Date();
    const queued = await this.jobs.transition(organizationId, job._id, ["uploaded"], {
      $set: {
        status: "queued",
        mapping: req.mapping,
        defaultCountry: req.defaultCountry,
        attestation: { userId, at: now },
        committedByUserId: userId,
        queuedAt: now,
        updatedAt: now,
      },
    });
    if (!queued) throw AppError.conflict("This import has already been committed");

    try {
      const bullJobId = await this.queue.enqueueImportCommit({
        organizationId,
        importId: job._id.toHexString(),
        requestedByUserId: userId,
      });
      await this.jobs.update(organizationId, job._id, { $set: { "queue.jobId": bullJobId } });
    } catch (err) {
      // Compensate so the user can retry the commit.
      await this.jobs.update(organizationId, job._id, {
        $set: {
          status: "uploaded",
          queuedAt: null,
          attestation: null,
          committedByUserId: null,
          updatedAt: new Date(),
        },
      });
      throw err;
    }

    await this.audit.record(
      {
        organizationId,
        actorUserId: userId,
        actorType: "user",
        action: "import.committed",
        resourceType: "import",
        resourceId: job._id.toHexString(),
        after: {
          rowCount: job.rowCount,
          mapping: req.mapping,
          defaultCountry: req.defaultCountry,
          attestedLawfulBasis: true,
        },
      },
      auditCtx,
    );
    return toImportView(queued);
  }

  async listRows(
    organizationId: string,
    id: string,
    query: ImportRowsQuery,
  ): Promise<{ items: ImportRowResult[]; nextCursor: string | null }> {
    const job = await this.requireJob(organizationId, id);
    const page = await withCursor(() =>
      this.rows.page(organizationId, job._id, query.outcome, {
        pageSize: query.pageSize,
        cursor: query.cursor ?? null,
      }),
    );
    return { items: page.items.map(toRowView), nextCursor: page.nextCursor };
  }

  async overviewSummary(organizationId: string) {
    const [total, inProgress, recent] = await Promise.all([
      this.jobs.countByStatus(organizationId),
      this.jobs.countByStatus(organizationId, ["queued", "processing"]),
      this.jobs.page(organizationId, undefined, { pageSize: 5 }),
    ]);
    return {
      total,
      inProgress,
      recent: recent.items.map((j) => {
        const v = toImportView(j);
        return {
          id: v.id,
          status: v.status,
          fileName: v.fileName,
          rowCount: v.rowCount,
          progress: v.progress,
          createdAt: v.createdAt,
          finishedAt: v.finishedAt,
        };
      }),
    };
  }

  // -------------------------------------------------------------------------
  // Processing (called by the imports processor in apps/worker)
  // -------------------------------------------------------------------------

  private ingestItem(
    job: ImportJobDocument,
    rowNumber: number,
    result: RowNormalizationResult,
    userId: string,
    collectedAt: Date,
    newId: ObjectId,
  ): IngestItem {
    const importHex = job._id.toHexString();
    return {
      input: result.input!,
      newId,
      createdVia: { kind: "import", importId: job._id, userId },
      ctx: {
        source: "user_import",
        collectionMethod: "user_import",
        sourceRef: `import:${importHex}`,
        collectedAt,
        confidence: SOURCE_CONFIDENCE.user_import,
        actor: { type: "user", userId },
        importId: job._id,
        note: null,
        metadata: { rowNumber, fileName: job.fileName },
        idSeed: `import:${importHex}:row:${rowNumber}`,
      },
    };
  }

  /**
   * Processes every row that has no outcome yet, in batches. Safe to retry: business and
   * observation ids are derived from the import and row, so a re-run after a crash never
   * duplicates records, and finished rows are skipped.
   */
  async process(organizationId: string, importId: string): Promise<{ status: ImportStatus }> {
    const job = await this.jobs.findById(organizationId, importId);
    if (!job) throw new Error(`Import ${importId} not found for organization ${organizationId}`);
    if (TERMINAL.includes(job.status)) return { status: job.status };
    if (job.status === "uploaded" || !job.mapping || !job.queuedAt || !job.committedByUserId) {
      throw new Error(`Import ${importId} has not been committed`);
    }

    const member = await this.organizations.isActiveMember(organizationId, job.committedByUserId);
    if (!member.active || !member.role || !roleHasPermission(member.role, "businesses:write")) {
      await this.markFailed(
        organizationId,
        importId,
        "ACCESS_REVOKED",
        "The user who started this import no longer has permission to import.",
      );
      return { status: "failed" };
    }

    const started = await this.jobs.transition(organizationId, job._id, ["queued", "processing"], {
      $set: { status: "processing", startedAt: job.startedAt ?? new Date(), updatedAt: new Date() },
    });
    if (!started)
      return { status: (await this.jobs.findById(organizationId, importId))?.status ?? "failed" };

    const mapping = job.mapping;
    const defaultCountry = job.defaultCountry ?? "NG";
    for (;;) {
      const batch = await this.rows.pending(organizationId, job._id, PROCESS_BATCH_SIZE);
      if (batch.length === 0) break;
      await this.processBatch(job, batch, mapping, defaultCountry);
      await this.refreshProgress(organizationId, job._id, job.rowCount);
    }

    const progress = await this.refreshProgress(organizationId, job._id, job.rowCount);
    const status: ImportStatus = progress.failed > 0 ? "completed_with_errors" : "completed";
    const now = new Date();
    await this.jobs.update(organizationId, job._id, {
      $set: { status, finishedAt: now, updatedAt: now },
    });
    await this.audit.record({
      organizationId,
      actorUserId: job.committedByUserId,
      actorType: "system",
      action: "import.finished",
      resourceType: "import",
      resourceId: importId,
      after: { status, ...progress },
    });
    this.logger.log({ organizationId, importId, status, ...progress }, "Import finished");
    await this.notifications.importFinished({
      organizationId,
      importId,
      fileName: job.fileName,
      status: status === "completed_with_errors" ? "completed_with_errors" : "completed",
      userId: job.committedByUserId,
      created: progress.created,
      updated: progress.updated,
      failed: progress.failed,
    });
    return { status };
  }

  private async processBatch(
    job: WithId<ImportJobDocument>,
    batch: Array<WithId<ImportRowDocument>>,
    mapping: ImportMappingEntry[],
    defaultCountry: string,
  ): Promise<void> {
    const organizationId = job.organizationId;
    const normalized = batch.map((row) => ({
      row,
      result: normalizeImportRow(row.cells, job.headers, mapping, defaultCountry),
    }));
    const valid = normalized.filter((n) => n.result.valid && n.result.input);
    const items = valid.map((n) =>
      this.ingestItem(
        job,
        n.row.rowNumber,
        n.result,
        job.committedByUserId!,
        job.queuedAt!,
        deterministicObjectId(
          `import:${job._id.toHexString()}:row:${n.row.rowNumber}:business`,
          job.createdAt,
        ),
      ),
    );
    const results = await this.businesses.ingestBatch(organizationId, items);
    const byRow = new Map<number, IngestResult>(
      valid.map((n, i) => [n.row.rowNumber, results[i]!]),
    );

    const writes: RowOutcomeWrite[] = normalized.map(({ row, result }) => {
      const ingest = byRow.get(row.rowNumber);
      if (!ingest) {
        return {
          rowNumber: row.rowNumber,
          outcome: "failed",
          businessId: null,
          errors: result.errors,
          warnings: result.warnings,
        };
      }
      return {
        rowNumber: row.rowNumber,
        outcome:
          ingest.outcome === "suppressed"
            ? "suppressed"
            : ingest.outcome === "updated"
              ? "updated"
              : "created",
        businessId: ingest.businessId,
        errors: [],
        warnings: [...result.warnings, ...ingestWarnings(ingest)],
      };
    });
    await this.rows.writeOutcomes(organizationId, job._id, writes);
  }

  private async refreshProgress(organizationId: string, importId: ObjectId, total: number) {
    const counts = await this.rows.countByOutcome(organizationId, importId);
    const progress = {
      total,
      processed: total - (counts.pending ?? 0),
      created: counts.created ?? 0,
      updated: counts.updated ?? 0,
      suppressed: counts.suppressed ?? 0,
      failed: counts.failed ?? 0,
    };
    await this.jobs.update(organizationId, importId, { $set: { progress, updatedAt: new Date() } });
    return progress;
  }

  /** Final failure after retries (or a permission change). Rows already done stay done. */
  async markFailed(
    organizationId: string,
    importId: string,
    code: string,
    message: string,
  ): Promise<void> {
    const id = ObjectId.isValid(importId) ? new ObjectId(importId) : null;
    if (!id) return;
    const now = new Date();
    const updated = await this.jobs.transition(organizationId, id, ["queued", "processing"], {
      $set: { status: "failed", error: { code, message }, finishedAt: now, updatedAt: now },
    });
    if (updated) {
      await this.audit.record({
        organizationId,
        actorUserId: updated.committedByUserId,
        actorType: "system",
        action: "import.finished",
        resourceType: "import",
        resourceId: importId,
        after: { status: "failed", error: code },
      });
      if (updated.committedByUserId) {
        await this.notifications.importFinished({
          organizationId,
          importId,
          fileName: updated.fileName,
          status: "failed",
          userId: updated.committedByUserId,
          created: updated.progress.created,
          updated: updated.progress.updated,
          failed: updated.progress.failed,
        });
      }
    }
  }

  /** Jobs created per UTC day in [from, to), split by status (reports and usage). */
  jobsPerDay(organizationId: string, from: Date, to: Date) {
    return this.jobs.aggregateByDay(organizationId, {
      dateField: "createdAt",
      from,
      to,
      groupField: "status",
    });
  }

  /** All-jobs page: imports older than `before`, newest first, with statuses normalized. */
  async jobSummariesBefore(
    organizationId: string,
    statuses: JobStatus[] | undefined,
    before: { createdAt: Date; id: ObjectId } | null,
    limit: number,
  ): Promise<Array<{ createdAt: Date; id: ObjectId; summary: JobSummary }>> {
    const raw = statuses ? statuses.flatMap((s) => IMPORT_STATUS_FROM_JOB[s]) : undefined;
    if (raw && raw.length === 0) return [];
    const docs = await this.jobs.pageBefore(organizationId, raw, before, limit);
    return docs.map((j) => ({
      createdAt: j.createdAt,
      id: j._id,
      summary: {
        id: j._id.toHexString(),
        kind: "import",
        name: j.fileName,
        status: IMPORT_STATUS_TO_JOB[j.status],
        kindStatus: j.status,
        progress: {
          processed: j.progress.processed,
          total: j.progress.total,
          failed: j.progress.failed,
        },
        createdByUserId: j.createdByUserId,
        createdAt: j.createdAt.toISOString(),
        startedAt: j.startedAt?.toISOString() ?? null,
        finishedAt: j.finishedAt?.toISOString() ?? null,
        href: `/app/businesses?importId=${j._id.toHexString()}`,
      },
    }));
  }
}

const IMPORT_STATUS_TO_JOB: Record<ImportStatus, JobStatus> = {
  uploaded: "draft",
  queued: "queued",
  processing: "running",
  completed: "completed",
  completed_with_errors: "completed_with_warnings",
  failed: "failed",
};

const IMPORT_STATUS_FROM_JOB: Record<JobStatus, ImportStatus[]> = {
  draft: ["uploaded"],
  queued: ["queued"],
  running: ["processing"],
  completed: ["completed"],
  completed_with_warnings: ["completed_with_errors"],
  failed: ["failed"],
  cancelled: [],
};

function ingestWarnings(result: IngestResult): ImportRowIssue[] {
  return result.warnings.map((w) => ({
    column: null,
    header: null,
    field: null,
    code: w.code,
    message: w.message,
  }));
}

function sanitizeFileName(name: string): string {
  // eslint-disable-next-line no-control-regex
  const base = name
    .replace(/[\\/]/g, "_")
    .replace(/[\u0000-\u001F\u007F]/g, "")
    .trim();
  return (base || "upload.csv").slice(0, 255);
}

function toImportView(job: ImportJobDocument): ImportJob {
  const p = job.progress;
  return {
    id: job._id.toHexString(),
    status: job.status,
    fileName: job.fileName,
    sizeBytes: job.sizeBytes,
    encoding: job.encoding,
    delimiter: job.delimiter,
    headers: job.headers,
    rowCount: job.rowCount,
    blankRowsSkipped: job.blankRowsSkipped,
    sampleRows: job.sampleRows,
    suggestedMapping: job.suggestedMapping,
    mapping: job.mapping,
    defaultCountry: job.defaultCountry,
    progress: { ...p, percent: p.total > 0 ? Math.floor((p.processed / p.total) * 100) : 0 },
    error: job.error,
    createdByUserId: job.createdByUserId,
    createdAt: job.createdAt.toISOString(),
    updatedAt: job.updatedAt.toISOString(),
    queuedAt: job.queuedAt?.toISOString() ?? null,
    startedAt: job.startedAt?.toISOString() ?? null,
    finishedAt: job.finishedAt?.toISOString() ?? null,
    rowsExpireAt: job.rowsExpireAt.toISOString(),
  };
}

function toRowView(row: ImportRowDocument): ImportRowResult {
  return {
    rowNumber: row.rowNumber,
    outcome: row.outcome,
    businessId: row.businessId?.toHexString() ?? null,
    cells: row.cells,
    errors: row.errors,
    warnings: row.warnings,
    processedAt: row.processedAt?.toISOString() ?? null,
  };
}
