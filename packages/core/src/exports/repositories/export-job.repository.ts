import { Injectable } from "@nestjs/common";
import {
  Collections,
  isDuplicateKeyError,
  MongoService,
  ObjectId,
  OrgScopedRepository,
  type CursorPage,
  type Document,
  type Filter,
  type WithId,
} from "@leadforge/db-mongo";
import type {
  BusinessListFilter,
  ExportColumn,
  ExportKind,
  ExportStatus,
} from "@leadforge/contracts";

export interface ExportJobDocument {
  _id: ObjectId;
  organizationId: string;
  kind: ExportKind;
  status: ExportStatus;
  /** `assigned`: only businesses whose lead is assigned to the requester. */
  scope: "all" | "assigned";
  selection: {
    filter: BusinessListFilter | null;
    listId: ObjectId | null;
    listName: string | null;
    ids: ObjectId[] | null;
  };
  columns: ExportColumn[];
  rowCap: number;
  matchedAtRequest: number;
  rowCount: number | null;
  truncated: boolean;
  progress: { processed: number; total: number | null };
  file: {
    key: string;
    name: string;
    bytes: number;
    sha256: string;
    contentType: string;
    expiresAt: Date;
    deletedAt: Date | null;
    licenses: string[];
  } | null;
  error: { code: string; message: string } | null;
  idempotencyKey: string | null;
  requestHash: string;
  requestedByUserId: string;
  createdAt: Date;
  updatedAt: Date;
  startedAt: Date | null;
  finishedAt: Date | null;
}

@Injectable()
export class ExportJobRepository extends OrgScopedRepository<ExportJobDocument> {
  constructor(mongo: MongoService) {
    super(mongo, Collections.exportJobs);
  }

  /** False when the requester already used this Idempotency-Key. */
  async insert(organizationId: string, doc: ExportJobDocument): Promise<boolean> {
    if (doc.organizationId !== organizationId) throw new Error("organizationId mismatch");
    try {
      await this.collection.insertOne(doc as WithId<ExportJobDocument>);
      return true;
    } catch (err) {
      if (isDuplicateKeyError(err)) return false;
      throw err;
    }
  }

  findByIdempotencyKey(
    organizationId: string,
    userId: string,
    key: string,
  ): Promise<WithId<ExportJobDocument> | null> {
    return this.findOne(organizationId, {
      requestedByUserId: userId,
      idempotencyKey: key,
    } as Filter<ExportJobDocument>);
  }

  /** Updates only while the export is in one of `onlyIfStatus` (when given); null otherwise. */
  update(
    organizationId: string,
    id: ObjectId,
    set: Partial<ExportJobDocument>,
    onlyIfStatus?: ExportStatus[],
  ): Promise<WithId<ExportJobDocument> | null> {
    return this.collection.findOneAndUpdate(
      this.scoped(organizationId, {
        _id: id,
        ...(onlyIfStatus ? { status: { $in: onlyIfStatus } } : {}),
      } as Filter<ExportJobDocument>),
      { $set: { ...set, updatedAt: new Date() } },
      { returnDocument: "after" },
    );
  }

  page(
    organizationId: string,
    filter: Document,
    opts: { pageSize: number; cursor?: string | null },
  ): Promise<CursorPage<WithId<ExportJobDocument>>> {
    return this.findPage(organizationId, filter as Filter<ExportJobDocument>, {
      ...opts,
      sortField: "createdAt",
      direction: -1,
      projection: { "selection.ids": 0 },
    });
  }

  pageBefore(
    organizationId: string,
    filter: Document,
    before: { createdAt: Date; id: ObjectId } | null,
    limit: number,
  ) {
    const and: Document[] = [filter];
    if (before)
      and.push({
        $or: [
          { createdAt: { $lt: before.createdAt } },
          { createdAt: before.createdAt, _id: { $lt: before.id } },
        ],
      });
    return this.collection
      .find(this.scoped(organizationId, { $and: and } as Filter<ExportJobDocument>), {
        projection: { "selection.ids": 0 },
      })
      .sort({ createdAt: -1, _id: -1 })
      .limit(limit)
      .toArray();
  }

  /** Maintenance: completed exports of any organization whose file is past its retention. */
  findExpiredFiles(
    now: Date,
    limit: number,
  ): Promise<Array<{ _id: ObjectId; organizationId: string; file: ExportJobDocument["file"] }>> {
    return this.collection
      .find({ status: "completed", "file.expiresAt": { $lte: now } } as Filter<ExportJobDocument>, {
        projection: { _id: 1, organizationId: 1, file: 1 },
      })
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
        } as Filter<ExportJobDocument>,
        { projection: { _id: 1, organizationId: 1 } },
      )
      .limit(limit)
      .toArray();
  }

  /** Completed exports and their rows per UTC day of completion (usage rollup). */
  completedPerDay(organizationId: string, from: Date, to: Date) {
    return this.aggregateByDay(organizationId, {
      dateField: "finishedAt",
      from,
      to,
      filter: { status: { $in: ["completed", "expired"] } } as Filter<ExportJobDocument>,
      sumField: "rowCount",
    });
  }
}
