import { Injectable } from "@nestjs/common";
import {
  Collections,
  isDuplicateKeyError,
  MongoService,
  ObjectId,
  OrgScopedRepository,
  type Filter,
  type WithId,
} from "@leadforge/db-mongo";
import type { OrganizationDataExportStatus, OrganizationExportSection } from "@leadforge/contracts";

export interface OrganizationExportDocument {
  _id: ObjectId;
  organizationId: string;
  status: OrganizationDataExportStatus;
  /** True exactly while queued or running (one active export per organization, unique partial index). */
  active: boolean;
  requestedByUserId: string;
  idempotencyKey: string | null;
  requestHash: string;
  progress: {
    completedSections: number;
    totalSections: number;
    currentSection: OrganizationExportSection | null;
  };
  sections: Array<{ key: OrganizationExportSection; rows: number }>;
  file: {
    key: string;
    name: string;
    bytes: number;
    sha256: string;
    contentType: string;
    expiresAt: Date;
    deletedAt: Date | null;
  } | null;
  error: { code: string; message: string } | null;
  createdAt: Date;
  updatedAt: Date;
  startedAt: Date | null;
  finishedAt: Date | null;
}

export type InsertOutcome = "inserted" | "idempotency_key_used" | "active_exists";

/** Stage 10: whole-organization data exports (MongoDB `organization_data_exports`). */
@Injectable()
export class OrganizationExportRepository extends OrgScopedRepository<OrganizationExportDocument> {
  constructor(mongo: MongoService) {
    super(mongo, Collections.organizationDataExports);
  }

  async insert(organizationId: string, doc: OrganizationExportDocument): Promise<InsertOutcome> {
    if (doc.organizationId !== organizationId) throw new Error("organizationId mismatch");
    try {
      await this.collection.insertOne(doc as WithId<OrganizationExportDocument>);
      return "inserted";
    } catch (err) {
      if (isDuplicateKeyError(err, "idempotencyKey")) return "idempotency_key_used";
      if (isDuplicateKeyError(err)) return "active_exists";
      throw err;
    }
  }

  findByIdempotencyKey(
    organizationId: string,
    userId: string,
    key: string,
  ): Promise<WithId<OrganizationExportDocument> | null> {
    return this.findOne(organizationId, {
      requestedByUserId: userId,
      idempotencyKey: key,
    } as Filter<OrganizationExportDocument>);
  }

  findActive(organizationId: string): Promise<WithId<OrganizationExportDocument> | null> {
    return this.findOne(organizationId, { active: true } as Filter<OrganizationExportDocument>);
  }

  /** Updates only while the export is in one of `onlyIfStatus` (when given); null otherwise. */
  update(
    organizationId: string,
    id: ObjectId,
    set: Partial<OrganizationExportDocument>,
    onlyIfStatus?: OrganizationDataExportStatus[],
  ): Promise<WithId<OrganizationExportDocument> | null> {
    return this.collection.findOneAndUpdate(
      this.scoped(organizationId, {
        _id: id,
        ...(onlyIfStatus ? { status: { $in: onlyIfStatus } } : {}),
      } as Filter<OrganizationExportDocument>),
      { $set: { ...set, updatedAt: new Date() } },
      { returnDocument: "after" },
    );
  }

  /** The newest exports, newest first. */
  recent(
    organizationId: string,
    limit: number,
  ): Promise<Array<WithId<OrganizationExportDocument>>> {
    return this.collection
      .find(this.scoped(organizationId))
      .sort({ createdAt: -1, _id: -1 })
      .limit(limit)
      .toArray();
  }

  /** Maintenance: completed exports of any organization whose file is past its retention. */
  findExpiredFiles(
    now: Date,
    limit: number,
  ): Promise<
    Array<{ _id: ObjectId; organizationId: string; file: OrganizationExportDocument["file"] }>
  > {
    return this.collection
      .find(
        {
          status: "completed",
          "file.expiresAt": { $lte: now },
        } as Filter<OrganizationExportDocument>,
        { projection: { _id: 1, organizationId: 1, file: 1 } },
      )
      .limit(limit)
      .toArray();
  }

  /** Maintenance: exports of any organization queued or running without progress since `cutoff`. */
  findStuck(
    cutoff: Date,
    limit: number,
  ): Promise<Array<{ _id: ObjectId; organizationId: string }>> {
    return this.collection
      .find(
        {
          status: { $in: ["queued", "running"] },
          updatedAt: { $lt: cutoff },
        } as Filter<OrganizationExportDocument>,
        { projection: { _id: 1, organizationId: 1 } },
      )
      .limit(limit)
      .toArray();
  }
}
