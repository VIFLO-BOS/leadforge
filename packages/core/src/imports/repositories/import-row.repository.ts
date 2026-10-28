import { Injectable } from "@nestjs/common";
import {
  Collections,
  MongoService,
  ObjectId,
  OrgScopedRepository,
  type AnyBulkWriteOperation,
  type CursorPage,
  type Filter,
  type WithId,
} from "@leadforge/db-mongo";
import type { ImportRowIssue, ImportRowOutcome } from "@leadforge/contracts";

export interface ImportRowDocument {
  _id: ObjectId;
  organizationId: string;
  importId: ObjectId;
  rowNumber: number;
  cells: string[];
  outcome: ImportRowOutcome | null;
  businessId: ObjectId | null;
  errors: ImportRowIssue[];
  warnings: ImportRowIssue[];
  processedAt: Date | null;
  /** TTL: staged rows and their results are deleted after this time. */
  expiresAt: Date;
}

export interface RowOutcomeWrite {
  rowNumber: number;
  outcome: ImportRowOutcome;
  businessId: ObjectId | null;
  errors: ImportRowIssue[];
  warnings: ImportRowIssue[];
}

@Injectable()
export class ImportRowRepository extends OrgScopedRepository<ImportRowDocument> {
  constructor(mongo: MongoService) {
    super(mongo, Collections.importRows);
  }

  async insertMany(organizationId: string, docs: ImportRowDocument[]): Promise<void> {
    if (docs.some((d) => d.organizationId !== organizationId))
      throw new Error("organizationId mismatch");
    for (let i = 0; i < docs.length; i += 1000) {
      await this.collection.insertMany(
        docs.slice(i, i + 1000) as Array<WithId<ImportRowDocument>>,
        { ordered: false },
      );
    }
  }

  async firstRows(
    organizationId: string,
    importId: ObjectId,
    limit: number,
  ): Promise<Array<WithId<ImportRowDocument>>> {
    return this.collection
      .find(this.scoped(organizationId, { importId } as Filter<ImportRowDocument>))
      .sort({ rowNumber: 1 })
      .limit(limit)
      .toArray();
  }

  /** Next rows still waiting for an outcome, in file order. */
  async pending(
    organizationId: string,
    importId: ObjectId,
    limit: number,
  ): Promise<Array<WithId<ImportRowDocument>>> {
    return this.collection
      .find(this.scoped(organizationId, { importId, outcome: null } as Filter<ImportRowDocument>))
      .sort({ rowNumber: 1 })
      .limit(limit)
      .toArray();
  }

  async writeOutcomes(
    organizationId: string,
    importId: ObjectId,
    rows: RowOutcomeWrite[],
  ): Promise<void> {
    if (rows.length === 0) return;
    const now = new Date();
    const ops: Array<AnyBulkWriteOperation<ImportRowDocument>> = rows.map((r) => ({
      updateOne: {
        filter: this.scoped(organizationId, {
          importId,
          rowNumber: r.rowNumber,
        } as Filter<ImportRowDocument>),
        update: {
          $set: {
            outcome: r.outcome,
            businessId: r.businessId,
            errors: r.errors,
            warnings: r.warnings,
            processedAt: now,
          },
        },
      },
    }));
    await this.collection.bulkWrite(ops, { ordered: false });
  }

  async page(
    organizationId: string,
    importId: ObjectId,
    outcomes: ImportRowOutcome[] | undefined,
    opts: { pageSize: number; cursor?: string | null },
  ): Promise<CursorPage<WithId<ImportRowDocument>>> {
    const filter: Filter<ImportRowDocument> = outcomes?.length
      ? { importId, outcome: { $in: outcomes } }
      : { importId };
    return this.findPage(organizationId, filter, { ...opts, sortField: "rowNumber", direction: 1 });
  }

  async countByOutcome(
    organizationId: string,
    importId: ObjectId,
  ): Promise<Record<string, number>> {
    const rows = await this.collection
      .aggregate<{ _id: string | null; count: number }>([
        { $match: this.scoped(organizationId, { importId } as Filter<ImportRowDocument>) },
        { $group: { _id: "$outcome", count: { $sum: 1 } } },
      ])
      .toArray();
    return Object.fromEntries(rows.map((r) => [r._id ?? "pending", r.count]));
  }
}
