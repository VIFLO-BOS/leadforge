import { Injectable } from "@nestjs/common";
import {
  Collections,
  MongoService,
  ObjectId,
  OrgScopedRepository,
  type CursorPage,
  type Filter,
  type UpdateFilter,
  type WithId,
} from "@leadforge/db-mongo";
import type { ImportMappingEntry, ImportStatus } from "@leadforge/contracts";

export interface ImportProgressCounts {
  total: number;
  processed: number;
  created: number;
  updated: number;
  suppressed: number;
  failed: number;
}

export interface ImportJobDocument {
  _id: ObjectId;
  organizationId: string;
  status: ImportStatus;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  sha256: string;
  encoding: string;
  delimiter: "," | ";" | "\t";
  headers: string[];
  rowCount: number;
  blankRowsSkipped: number;
  sampleRows: string[][];
  suggestedMapping: ImportMappingEntry[];
  mapping: ImportMappingEntry[] | null;
  defaultCountry: string | null;
  attestation: { userId: string; at: Date } | null;
  progress: ImportProgressCounts;
  error: { code: string; message: string } | null;
  createdByUserId: string;
  committedByUserId: string | null;
  createdAt: Date;
  updatedAt: Date;
  queuedAt: Date | null;
  startedAt: Date | null;
  finishedAt: Date | null;
  rowsExpireAt: Date;
  queue: { jobId: string | null };
}

@Injectable()
export class ImportJobRepository extends OrgScopedRepository<ImportJobDocument> {
  constructor(mongo: MongoService) {
    super(mongo, Collections.importJobs);
  }

  async insert(organizationId: string, doc: ImportJobDocument): Promise<void> {
    if (doc.organizationId !== organizationId) throw new Error("organizationId mismatch");
    await this.collection.insertOne(doc as WithId<ImportJobDocument>);
  }

  async page(
    organizationId: string,
    statuses: ImportStatus[] | undefined,
    opts: { pageSize: number; cursor?: string | null },
  ): Promise<CursorPage<WithId<ImportJobDocument>>> {
    const filter: Filter<ImportJobDocument> = statuses?.length ? { status: { $in: statuses } } : {};
    return this.findPage(organizationId, filter, {
      ...opts,
      sortField: "createdAt",
      direction: -1,
    });
  }

  /** Rows strictly older than (createdAt, _id), newest first, for the all-jobs merge. */
  async pageBefore(
    organizationId: string,
    statuses: ImportStatus[] | undefined,
    before: { createdAt: Date; id: ObjectId } | null,
    limit: number,
  ): Promise<Array<WithId<ImportJobDocument>>> {
    const and: Array<Filter<ImportJobDocument>> = [];
    if (statuses?.length) and.push({ status: { $in: statuses } } as Filter<ImportJobDocument>);
    if (before) {
      and.push({
        $or: [
          { createdAt: { $lt: before.createdAt } },
          { createdAt: before.createdAt, _id: { $lt: before.id } },
        ],
      } as Filter<ImportJobDocument>);
    }
    return this.collection
      .find(
        this.scoped(organizationId, (and.length ? { $and: and } : {}) as Filter<ImportJobDocument>),
      )
      .sort({ createdAt: -1, _id: -1 })
      .limit(limit)
      .toArray();
  }

  /** Atomic status transition; null when the job is not in one of the `from` states. */
  async transition(
    organizationId: string,
    id: ObjectId,
    from: ImportStatus[],
    update: UpdateFilter<ImportJobDocument>,
  ): Promise<WithId<ImportJobDocument> | null> {
    return this.collection.findOneAndUpdate(
      this.scoped(organizationId, { _id: id, status: { $in: from } } as Filter<ImportJobDocument>),
      update,
      { returnDocument: "after" },
    );
  }

  async update(
    organizationId: string,
    id: ObjectId,
    update: UpdateFilter<ImportJobDocument>,
  ): Promise<void> {
    await this.collection.updateOne(
      this.scoped(organizationId, { _id: id } as Filter<ImportJobDocument>),
      update,
    );
  }

  async countByStatus(organizationId: string, statuses?: ImportStatus[]): Promise<number> {
    return this.count(
      organizationId,
      statuses ? ({ status: { $in: statuses } } as Filter<ImportJobDocument>) : {},
    );
  }
}
