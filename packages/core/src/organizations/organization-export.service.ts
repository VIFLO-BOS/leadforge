import { createHash } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import { ObjectId, type WithId } from "@leadforge/db-mongo";
import {
  ORGANIZATION_EXPORT_SECTIONS,
  ROLE_PERMISSIONS,
  type ExportDownloadLink,
  type ExportDownloadQuery,
  type OrganizationDataExport,
  type ServerEnv,
} from "@leadforge/contracts";
import { ENV } from "../config/env.module.js";
import { AppError } from "../common/errors/app.error.js";
import { AuditService, type AuditContext } from "../audit/audit.service.js";
import { QueueService } from "../queue/queue.service.js";
import { DownloadSigner } from "../storage/download-signer.js";
import {
  OBJECT_STORAGE,
  type ObjectStorage,
  type StoredObjectStream,
} from "../storage/object-storage.js";
import { OrganizationsService } from "./organizations.service.js";
import {
  OrganizationExportRepository,
  type OrganizationExportDocument,
} from "./repositories/organization-export.repository.js";

/** Organization exports share the download signer with an `org-export:` namespace (like invoices). */
const claimId = (id: string) => `org-export:${id}`;
/** Every export request has the same body (none), so one hash; a key reused later replays the export. */
const REQUEST_HASH = createHash("sha256").update("organization-data-export:v1").digest("hex");

export interface OrganizationExportDownload extends StoredObjectStream {
  fileName: string;
  contentType: string;
}

/**
 * Stage 10: the whole-organization data export, API side (owner only: the file holds member
 * emails). One export may be queued or running per organization; the worker builds the ZIP
 * (OrganizationExportBuilder); downloads go through 15-minute signed links bound to the owner,
 * the organization and the export, exactly like export and invoice downloads.
 */
@Injectable()
export class OrganizationExportService {
  constructor(
    private readonly exportsRepo: OrganizationExportRepository,
    private readonly organizations: OrganizationsService,
    private readonly audit: AuditService,
    private readonly queue: QueueService,
    private readonly signer: DownloadSigner,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage,
    @Inject(ENV) private readonly env: ServerEnv,
  ) {}

  apiOrigin(): string {
    try {
      return new URL(this.env.API_URL).origin;
    } catch {
      return "";
    }
  }

  view(doc: OrganizationExportDocument): OrganizationDataExport {
    return {
      id: doc._id.toHexString(),
      status: doc.status,
      progress: { ...doc.progress },
      sections: doc.sections.map((s) => ({ key: s.key, rows: s.rows })),
      file: doc.file
        ? {
            name: doc.file.name,
            bytes: doc.file.bytes,
            sha256: doc.file.sha256,
            expiresAt: doc.file.expiresAt.toISOString(),
            available: doc.status === "completed" && !doc.file.deletedAt,
          }
        : null,
      error: doc.error,
      requestedByUserId: doc.requestedByUserId,
      createdAt: doc.createdAt.toISOString(),
      startedAt: doc.startedAt?.toISOString() ?? null,
      finishedAt: doc.finishedAt?.toISOString() ?? null,
    };
  }

  private activeConflict(active: WithId<OrganizationExportDocument>): AppError {
    return new AppError(
      "CONFLICT",
      "An organization export is already being built. Download it when it is ready.",
      [{ path: "activeExportId", message: active._id.toHexString() }],
    );
  }

  async create(
    organizationId: string,
    userId: string,
    idempotencyKey: string | undefined,
    ctx: AuditContext,
  ): Promise<{ job: OrganizationDataExport; replayed: boolean }> {
    if (idempotencyKey) {
      const existing = await this.exportsRepo.findByIdempotencyKey(
        organizationId,
        userId,
        idempotencyKey,
      );
      if (existing) return { job: this.view(existing), replayed: true };
    }
    const active = await this.exportsRepo.findActive(organizationId);
    if (active) throw this.activeConflict(active);
    const now = new Date();
    const doc: OrganizationExportDocument = {
      _id: new ObjectId(),
      organizationId,
      status: "queued",
      active: true,
      requestedByUserId: userId,
      idempotencyKey: idempotencyKey ?? null,
      requestHash: REQUEST_HASH,
      progress: {
        completedSections: 0,
        totalSections: ORGANIZATION_EXPORT_SECTIONS.length,
        currentSection: null,
      },
      sections: [],
      file: null,
      error: null,
      createdAt: now,
      updatedAt: now,
      startedAt: null,
      finishedAt: null,
    };
    const outcome = await this.exportsRepo.insert(organizationId, doc);
    if (outcome === "idempotency_key_used") {
      const winner = await this.exportsRepo.findByIdempotencyKey(
        organizationId,
        userId,
        idempotencyKey!,
      );
      if (winner) return { job: this.view(winner), replayed: true };
    }
    if (outcome !== "inserted") {
      const winner = await this.exportsRepo.findActive(organizationId);
      throw winner
        ? this.activeConflict(winner)
        : AppError.conflict("An organization export is already being built.");
    }
    try {
      await this.queue.enqueueOrganizationExport({
        organizationId,
        exportId: doc._id.toHexString(),
      });
    } catch (err) {
      await this.exportsRepo.update(organizationId, doc._id, {
        status: "failed",
        active: false,
        error: { code: "ENQUEUE_FAILED", message: "The export could not be queued." },
        finishedAt: new Date(),
      });
      throw err;
    }
    await this.audit.record(
      {
        organizationId,
        actorUserId: userId,
        actorType: "user",
        action: "org.data_export_requested",
        resourceType: "organization_export",
        resourceId: doc._id.toHexString(),
      },
      ctx,
    );
    return { job: this.view(doc), replayed: false };
  }

  async list(organizationId: string): Promise<OrganizationDataExport[]> {
    return (await this.exportsRepo.recent(organizationId, 10)).map((d) => this.view(d));
  }

  private async require(
    organizationId: string,
    id: string,
  ): Promise<WithId<OrganizationExportDocument>> {
    const doc = await this.exportsRepo.findById(organizationId, id);
    if (!doc) throw AppError.notFound("Organization export");
    return doc;
  }

  async get(organizationId: string, id: string): Promise<OrganizationDataExport> {
    return this.view(await this.require(organizationId, id));
  }

  private static assertDownloadable(doc: OrganizationExportDocument): void {
    if (doc.status === "expired" || (doc.status === "completed" && doc.file?.deletedAt)) {
      throw new AppError(
        "EXPORT_EXPIRED",
        "This export's file was deleted after its 7-day retention; request a new organization export.",
      );
    }
    if (doc.status !== "completed" || !doc.file) {
      throw new AppError(
        "EXPORT_NOT_READY",
        doc.status === "failed"
          ? "This export failed; there is no file to download."
          : "This export is still being built; try again when it is ready.",
        [{ path: "status", message: doc.status }],
      );
    }
  }

  async downloadLink(
    organizationId: string,
    userId: string,
    id: string,
    now: Date = new Date(),
  ): Promise<ExportDownloadLink> {
    const doc = await this.require(organizationId, id);
    OrganizationExportService.assertDownloadable(doc);
    const expires = Math.floor(now.getTime() / 1000) + this.env.EXPORT_DOWNLOAD_URL_TTL_SECONDS;
    const sig = this.signer.sign({
      organizationId,
      exportId: claimId(doc._id.toHexString()),
      userId,
      expires,
    });
    const query = new URLSearchParams({ org: organizationId, expires: String(expires), sig });
    return {
      url: `${this.apiOrigin()}/api/v1/organizations/current/data-exports/${doc._id.toHexString()}/download?${query.toString()}`,
      expiresAt: new Date(expires * 1000).toISOString(),
    };
  }

  /** Checks a signed link for the signed-in user (signature, expiry, still an owner, file still there) and opens the file. Audited. */
  async openDownload(
    userId: string,
    id: string,
    query: ExportDownloadQuery,
    ctx: AuditContext,
  ): Promise<OrganizationExportDownload> {
    const check = this.signer.verify(
      { organizationId: query.org, exportId: claimId(id), userId, expires: query.expires },
      query.sig,
    );
    if (!check.ok && check.reason === "invalid")
      throw new AppError(
        "DOWNLOAD_LINK_INVALID",
        "This download link is not valid for you. Request a new link in Settings, Organization.",
      );
    if (!check.ok)
      throw new AppError(
        "DOWNLOAD_LINK_EXPIRED",
        "This download link has expired. Request a new link in Settings, Organization.",
      );
    const member = await this.organizations.isActiveMember(query.org, userId);
    if (!member.active || !member.role) throw new AppError("ORG_FORBIDDEN");
    if (!ROLE_PERMISSIONS[member.role].includes("organization:export"))
      throw AppError.forbidden("Only owners can download the organization export");
    const doc = await this.require(query.org, id);
    OrganizationExportService.assertDownloadable(doc);
    const stream = await this.storage.get(doc.file!.key);
    if (!stream)
      throw new AppError(
        "EXPORT_EXPIRED",
        "This export's file is no longer available; request a new organization export.",
      );
    await this.audit.record(
      {
        organizationId: query.org,
        actorUserId: userId,
        actorType: "user",
        action: "org.data_export_downloaded",
        resourceType: "organization_export",
        resourceId: id,
        after: { fileName: doc.file!.name, bytes: doc.file!.bytes },
      },
      ctx,
    );
    return { ...stream, fileName: doc.file!.name, contentType: doc.file!.contentType };
  }
}
