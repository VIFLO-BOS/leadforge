import { createHash } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import { ObjectId, type WithId } from "@leadforge/db-mongo";
import {
  DATA_LICENSES_PATH,
  DEFAULT_EXPORT_COLUMNS,
  EXPORT_SYNC_ROW_CAP,
  ROLE_PERMISSIONS,
  type CreateExportRequest,
  type ExportBusinessesRequest,
  type ExportDownloadLink,
  type ExportDownloadQuery,
  type ExportJob,
  type ExportListQuery,
  type ExportStatus,
  type JobStatus,
  type JobSummary,
  type ServerEnv,
} from "@leadforge/contracts";
import { ENV } from "../config/env.module.js";
import { AppError } from "../common/errors/app.error.js";
import { withCursor } from "../common/pagination/cursor.js";
import { AuditService, type AuditContext } from "../audit/audit.service.js";
import { BusinessesService } from "../businesses/businesses.service.js";
import { ImportsService } from "../imports/imports.service.js";
import { QueueService } from "../queue/queue.service.js";
import { OrganizationsService } from "../organizations/organizations.service.js";
import { EntitlementsService } from "../entitlements/entitlements.service.js";
import { LeadsService } from "../crm/leads.service.js";
import { ListsService } from "../crm/lists.service.js";
import { can, isManager, type CrmActor } from "../crm/crm.types.js";
import { DownloadSigner } from "../storage/download-signer.js";
import {
  OBJECT_STORAGE,
  type ObjectStorage,
  type StoredObjectStream,
} from "../storage/object-storage.js";
import { csvLine } from "../normalization/csv-safety.js";
import { csvRows } from "./export-format.js";
import {
  ExportJobRepository,
  type ExportJobDocument,
} from "./repositories/export-job.repository.js";

/** Leads assigned to one member that an assigned-only export can reach. */
export const ASSIGNED_SCOPE_MAX = 100_000;

export interface CsvExport {
  fileName: string;
  content: string;
  rowCount: number;
  /** Set when rows carry openly licensed data: where the licence texts and attributions are (sent as a Link header). */
  licensesUrl: string | null;
}

export interface DownloadStream extends StoredObjectStream {
  fileName: string;
  contentType: string;
}

const FROM_JOB_STATUS: Record<JobStatus, ExportStatus[]> = {
  draft: [],
  queued: ["queued"],
  running: ["running"],
  completed: ["completed", "expired"],
  completed_with_warnings: [],
  failed: ["failed"],
  cancelled: [],
};

/** Export scope for a role: everything (`exports:create`) or only assigned leads (`exports:create_assigned`). */
export function exportScope(actor: CrmActor): "all" | "assigned" {
  if (can(actor, "exports:create")) return "all";
  if (can(actor, "exports:create_assigned")) return "assigned";
  throw AppError.forbidden("Your role cannot export");
}

/**
 * Exports. Synchronous CSV (up to 1,000 rows) and asynchronous export jobs built in the worker
 * (ZIP with the CSV, attribution and licence texts), stored through ObjectStorage and downloaded
 * through short-lived signed links. Filters are re-evaluated under the requester's organization
 * and permissions; suppressed businesses are never exported; Sales Representatives export only
 * businesses whose lead is assigned to them; every cell is neutralized against formula injection.
 */
@Injectable()
export class ExportsService {
  constructor(
    private readonly businesses: BusinessesService,
    private readonly imports: ImportsService,
    private readonly audit: AuditService,
    private readonly jobs: ExportJobRepository,
    private readonly leads: LeadsService,
    private readonly lists: ListsService,
    private readonly entitlements: EntitlementsService,
    private readonly organizations: OrganizationsService,
    private readonly queue: QueueService,
    private readonly signer: DownloadSigner,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage,
    @Inject(ENV) private readonly env: ServerEnv,
  ) {}

  /** API origin for absolute licence and download URLs (API_URL without a trailing slash or path). */
  apiOrigin(): string {
    try {
      return new URL(this.env.API_URL).origin;
    } catch {
      return "";
    }
  }

  // -------------------------------------------------------------------------
  // Synchronous CSV
  // -------------------------------------------------------------------------

  async exportBusinesses(
    organizationId: string,
    actor: CrmActor,
    req: ExportBusinessesRequest,
    auditCtx: AuditContext,
  ): Promise<CsvExport> {
    const scope = exportScope(actor);
    // A foreign import id must 404, not export an empty file.
    if (req.filter.importId) await this.imports.requireJob(organizationId, req.filter.importId);
    const columns = req.columns ?? [...DEFAULT_EXPORT_COLUMNS];
    const restrictIds =
      scope === "assigned"
        ? await this.leads.businessIdsAssignedTo(organizationId, actor.userId, ASSIGNED_SCOPE_MAX)
        : undefined;
    const rows = await this.businesses.exportRows(
      organizationId,
      { ids: req.ids, filter: req.filter, restrictIds },
      EXPORT_SYNC_ROW_CAP,
    );

    // UTF-8 BOM so Excel opens non-ASCII names correctly.
    const origin = this.apiOrigin();
    const content = "\uFEFF" + csvLine(columns) + csvRows(rows, columns, origin);
    const licensed = rows.some((r) => r.attributions.some((a) => a.licenses.length > 0));

    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
    const fileName = `leadforge-businesses-${stamp}.csv`;
    await this.audit.record(
      {
        organizationId,
        actorUserId: actor.userId,
        actorType: "user",
        action: "export.created",
        resourceType: "export",
        resourceId: null,
        after: {
          kind: "businesses",
          format: "csv",
          mode: "sync",
          scope,
          rowCount: rows.length,
          columns,
          selection: req.ids ? { ids: req.ids.length } : { filter: req.filter },
        },
      },
      auditCtx,
    );
    return {
      fileName,
      content,
      rowCount: rows.length,
      licensesUrl: licensed ? `${origin}${DATA_LICENSES_PATH}` : null,
    };
  }

  // -------------------------------------------------------------------------
  // Async export jobs
  // -------------------------------------------------------------------------

  /**
   * Restrictions on the business ids for a job: the list's items, the selected ids and, for the
   * assigned-only scope, the requester's assigned leads (all intersected with the filter).
   */
  async restrictionsFor(
    organizationId: string,
    job: Pick<ExportJobDocument, "kind" | "selection" | "scope" | "requestedByUserId">,
  ): Promise<ObjectId[][]> {
    const restrict: ObjectId[][] = [];
    if (job.kind === "list")
      restrict.push(
        (await this.lists.businessIdsOf(organizationId, job.selection.listId!.toHexString())).ids,
      );
    if (job.kind === "selection") restrict.push(job.selection.ids ?? []);
    if (job.scope === "assigned")
      restrict.push(
        await this.leads.businessIdsAssignedTo(
          organizationId,
          job.requestedByUserId,
          ASSIGNED_SCOPE_MAX,
        ),
      );
    return restrict;
  }

  async createJob(
    organizationId: string,
    actor: CrmActor,
    req: CreateExportRequest,
    idempotencyKey: string | undefined,
    auditCtx: AuditContext,
  ): Promise<{ job: ExportJob; replayed: boolean }> {
    const scope = exportScope(actor);
    const requestHash = createHash("sha256").update(JSON.stringify(req)).digest("hex");
    if (idempotencyKey) {
      const existing = await this.jobs.findByIdempotencyKey(
        organizationId,
        actor.userId,
        idempotencyKey,
      );
      if (existing) {
        if (existing.requestHash !== requestHash)
          throw AppError.conflict("This Idempotency-Key was already used for a different export");
        return { job: this.view(existing), replayed: true };
      }
    }
    const filter = req.kind === "directory" ? req.filter : null;
    if (filter?.importId) await this.imports.requireJob(organizationId, filter.importId);
    const list =
      req.kind === "list" ? await this.lists.requireList(organizationId, req.listId) : null;
    const ids =
      req.kind === "selection"
        ? [...new Set(req.ids.map((i) => i.toLowerCase()))].map((i) => new ObjectId(i))
        : null;

    const draft: Pick<ExportJobDocument, "kind" | "selection" | "scope" | "requestedByUserId"> = {
      kind: req.kind,
      scope,
      requestedByUserId: actor.userId,
      selection: { filter, listId: list?._id ?? null, listName: list?.name ?? null, ids },
    };
    const rowCap = await this.entitlements.exportRowCap(organizationId);
    const mongoFilter = await this.businesses.exportFilter(organizationId, {
      filter: filter ?? {},
      restrictIds: await this.restrictionsFor(organizationId, draft),
    });
    const matched = await this.businesses.countForExport(organizationId, mongoFilter, rowCap + 1);
    if (matched > rowCap) {
      throw new AppError(
        "EXPORT_TOO_LARGE",
        `This export matches more than ${rowCap.toLocaleString("en")} businesses, your plan's export row cap. Narrow the filters or export a smaller list.`,
        [
          { path: "rowCap", message: String(rowCap) },
          { path: "matched", message: `>${rowCap}` },
        ],
      );
    }
    const now = new Date();
    const doc: ExportJobDocument = {
      _id: new ObjectId(),
      organizationId,
      ...draft,
      status: "queued",
      columns: req.columns ?? [...DEFAULT_EXPORT_COLUMNS],
      rowCap,
      matchedAtRequest: matched,
      rowCount: null,
      truncated: false,
      progress: { processed: 0, total: matched },
      file: null,
      error: null,
      idempotencyKey: idempotencyKey ?? null,
      requestHash,
      createdAt: now,
      updatedAt: now,
      startedAt: null,
      finishedAt: null,
    };
    if (!(await this.jobs.insert(organizationId, doc))) {
      const winner = idempotencyKey
        ? await this.jobs.findByIdempotencyKey(organizationId, actor.userId, idempotencyKey)
        : null;
      if (winner && winner.requestHash === requestHash)
        return { job: this.view(winner), replayed: true };
      throw AppError.conflict("This Idempotency-Key was already used for a different export");
    }
    try {
      await this.queue.enqueueExport({ organizationId, exportId: doc._id.toHexString() });
    } catch (err) {
      await this.jobs.update(organizationId, doc._id, {
        status: "failed",
        error: { code: "ENQUEUE_FAILED", message: "The export could not be queued." },
        finishedAt: new Date(),
      });
      throw err;
    }
    await this.audit.record(
      {
        organizationId,
        actorUserId: actor.userId,
        actorType: "user",
        action: "export.requested",
        resourceType: "export",
        resourceId: doc._id.toHexString(),
        after: {
          kind: req.kind,
          format: "zip",
          mode: "async",
          scope,
          rowCap,
          matched,
          columns: doc.columns,
          selection:
            req.kind === "directory"
              ? { filter }
              : req.kind === "list"
                ? { listId: req.listId }
                : { ids: ids!.length },
        },
      },
      auditCtx,
    );
    return { job: this.view(doc), replayed: false };
  }

  view(doc: ExportJobDocument): ExportJob {
    return {
      id: doc._id.toHexString(),
      kind: doc.kind,
      status: doc.status,
      format: "zip",
      scope: doc.scope,
      selection: {
        listId: doc.selection.listId?.toHexString() ?? null,
        listName: doc.selection.listName,
        idsCount:
          doc.kind === "selection" ? (doc.selection.ids?.length ?? doc.matchedAtRequest) : null,
        filter: doc.selection.filter,
      },
      columns: doc.columns,
      rowCap: doc.rowCap,
      matchedAtRequest: doc.matchedAtRequest,
      rowCount: doc.rowCount,
      truncated: doc.truncated,
      progress: { ...doc.progress },
      file: doc.file
        ? {
            name: doc.file.name,
            bytes: doc.file.bytes,
            sha256: doc.file.sha256,
            expiresAt: doc.file.expiresAt.toISOString(),
            available: doc.status === "completed" && !doc.file.deletedAt,
            licenses: doc.file.licenses,
          }
        : null,
      error: doc.error,
      requestedByUserId: doc.requestedByUserId,
      createdAt: doc.createdAt.toISOString(),
      startedAt: doc.startedAt?.toISOString() ?? null,
      finishedAt: doc.finishedAt?.toISOString() ?? null,
    };
  }

  /** Owners and administrators see every export; others only their own (others' ids are 404). */
  private visibility(actor: CrmActor): Record<string, unknown> {
    return isManager(actor) ? {} : { requestedByUserId: actor.userId };
  }

  async requireVisible(
    organizationId: string,
    actor: CrmActor,
    id: string,
  ): Promise<WithId<ExportJobDocument>> {
    const doc = await this.jobs.findById(organizationId, id);
    if (!doc || (!isManager(actor) && doc.requestedByUserId !== actor.userId))
      throw AppError.notFound("Export");
    return doc;
  }

  async getJob(organizationId: string, actor: CrmActor, id: string): Promise<ExportJob> {
    return this.view(await this.requireVisible(organizationId, actor, id));
  }

  async listJobs(
    organizationId: string,
    actor: CrmActor,
    query: ExportListQuery,
  ): Promise<{ items: ExportJob[]; nextCursor: string | null }> {
    const filter = {
      ...this.visibility(actor),
      ...(query.status?.length ? { status: { $in: query.status } } : {}),
    };
    const page = await withCursor(() =>
      this.jobs.page(organizationId, filter, {
        pageSize: query.pageSize,
        cursor: query.cursor ?? null,
      }),
    );
    return { items: page.items.map((d) => this.view(d)), nextCursor: page.nextCursor };
  }

  private static assertDownloadable(doc: ExportJobDocument): void {
    if (doc.status === "expired" || (doc.status === "completed" && doc.file?.deletedAt)) {
      throw new AppError(
        "EXPORT_EXPIRED",
        "This export's file was deleted after its retention period; run the export again.",
      );
    }
    if (doc.status !== "completed" || !doc.file) {
      throw new AppError(
        "EXPORT_NOT_READY",
        doc.status === "failed"
          ? "This export failed; there is no file to download."
          : "This export is still being built; try again when it has completed.",
        [{ path: "status", message: doc.status }],
      );
    }
  }

  /** A download link valid for EXPORT_DOWNLOAD_URL_TTL_SECONDS, bound to the caller, the organization and the export. */
  async downloadLink(
    organizationId: string,
    actor: CrmActor,
    id: string,
    now: Date = new Date(),
  ): Promise<ExportDownloadLink> {
    exportScope(actor);
    const doc = await this.requireVisible(organizationId, actor, id);
    ExportsService.assertDownloadable(doc);
    const expires = Math.floor(now.getTime() / 1000) + this.env.EXPORT_DOWNLOAD_URL_TTL_SECONDS;
    const sig = this.signer.sign({
      organizationId,
      exportId: doc._id.toHexString(),
      userId: actor.userId,
      expires,
    });
    const query = new URLSearchParams({ org: organizationId, expires: String(expires), sig });
    return {
      url: `${this.apiOrigin()}/api/v1/exports/${doc._id.toHexString()}/download?${query.toString()}`,
      expiresAt: new Date(expires * 1000).toISOString(),
    };
  }

  /**
   * Checks a signed link for the signed-in user (signature, expiry, membership and export
   * permission now, visibility, file still there) and opens the file. Audited.
   */
  async openDownload(
    userId: string,
    exportId: string,
    query: ExportDownloadQuery,
    auditCtx: AuditContext,
  ): Promise<DownloadStream> {
    const check = this.signer.verify(
      { organizationId: query.org, exportId, userId, expires: query.expires },
      query.sig,
    );
    if (!check.ok && check.reason === "invalid")
      throw new AppError(
        "DOWNLOAD_LINK_INVALID",
        "This download link is not valid for you. Request a new link from the export page.",
      );
    if (!check.ok)
      throw new AppError(
        "DOWNLOAD_LINK_EXPIRED",
        "This download link has expired. Request a new link from the export page.",
      );
    const member = await this.organizations.isActiveMember(query.org, userId);
    if (!member.active || !member.role) throw new AppError("ORG_FORBIDDEN");
    const actor: CrmActor = { userId, permissions: ROLE_PERMISSIONS[member.role] };
    exportScope(actor);
    const doc = await this.requireVisible(query.org, actor, exportId);
    ExportsService.assertDownloadable(doc);
    const stream = await this.storage.get(doc.file!.key);
    if (!stream)
      throw new AppError(
        "EXPORT_EXPIRED",
        "This export's file is no longer available; run the export again.",
      );
    await this.audit.record(
      {
        organizationId: query.org,
        actorUserId: userId,
        actorType: "user",
        action: "export.downloaded",
        resourceType: "export",
        resourceId: exportId,
        after: { fileName: doc.file!.name, bytes: doc.file!.bytes, rowCount: doc.rowCount },
      },
      auditCtx,
    );
    return { ...stream, fileName: doc.file!.name, contentType: doc.file!.contentType };
  }

  /** All-jobs page: exports created before `before`, newest first (viewer's visibility applies). */
  async jobSummariesBefore(
    organizationId: string,
    viewer: CrmActor | null,
    statuses: JobStatus[] | undefined,
    before: { createdAt: Date; id: ObjectId } | null,
    limit: number,
  ): Promise<Array<{ createdAt: Date; id: ObjectId; summary: JobSummary }>> {
    const raw = statuses ? statuses.flatMap((s) => FROM_JOB_STATUS[s]) : undefined;
    if (raw && raw.length === 0) return [];
    const filter = {
      ...(viewer ? this.visibility(viewer) : {}),
      ...(raw ? { status: { $in: raw } } : {}),
    };
    const docs = await this.jobs.pageBefore(organizationId, filter, before, limit);
    return docs.map((d) => ({
      createdAt: d.createdAt,
      id: d._id,
      summary: {
        id: d._id.toHexString(),
        kind: "export",
        name:
          d.kind === "list"
            ? `Export of list "${d.selection.listName ?? "list"}"`
            : d.kind === "selection"
              ? `Export of ${d.matchedAtRequest} selected business${d.matchedAtRequest === 1 ? "" : "es"}`
              : "Export of directory results",
        status: d.status === "expired" ? "completed" : d.status,
        kindStatus: d.status,
        progress: { processed: d.progress.processed, total: d.progress.total, failed: 0 },
        createdByUserId: d.requestedByUserId,
        createdAt: d.createdAt.toISOString(),
        startedAt: d.startedAt?.toISOString() ?? null,
        finishedAt: d.finishedAt?.toISOString() ?? null,
        href: `/app/jobs/exports/${d._id.toHexString()}`,
      },
    }));
  }

  /** Export jobs created per UTC day, split by status (reports). */
  jobsPerDay(organizationId: string, from: Date, to: Date) {
    return this.jobs.aggregateByDay(organizationId, {
      dateField: "createdAt",
      from,
      to,
      groupField: "status",
    });
  }

  /** Completed exports and rows per UTC day (usage rollup). */
  completedPerDay(organizationId: string, from: Date, to: Date) {
    return this.jobs.completedPerDay(organizationId, from, to);
  }
}
