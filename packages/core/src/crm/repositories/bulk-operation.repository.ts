import { Injectable } from "@nestjs/common";
import {
  Collections,
  isDuplicateKeyError,
  MongoService,
  ObjectId,
  OrgScopedRepository,
  type AnyBulkWriteOperation,
  type CursorPage,
  type Document,
  type Filter,
  type WithId,
} from "@leadforge/db-mongo";
import type { BulkItemOutcome, BulkStatus } from "@leadforge/contracts";
import type { BulkItemDocument, BulkOperationDocument } from "../crm.types.js";

@Injectable()
export class BulkOperationRepository extends OrgScopedRepository<BulkOperationDocument> {
  constructor(mongo: MongoService) {
    super(mongo, Collections.bulkOperations);
  }

  /** False when the requester already used this Idempotency-Key. */
  async insert(organizationId: string, doc: BulkOperationDocument): Promise<boolean> {
    if (doc.organizationId !== organizationId) throw new Error("organizationId mismatch");
    try {
      await this.collection.insertOne(doc as WithId<BulkOperationDocument>);
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
  ): Promise<WithId<BulkOperationDocument> | null> {
    return this.findOne(organizationId, {
      requestedByUserId: userId,
      idempotencyKey: key,
    } as Filter<BulkOperationDocument>);
  }

  update(
    organizationId: string,
    id: ObjectId,
    set: Partial<BulkOperationDocument>,
    onlyIfStatus?: BulkStatus[],
  ): Promise<WithId<BulkOperationDocument> | null> {
    return this.collection.findOneAndUpdate(
      this.scoped(organizationId, {
        _id: id,
        ...(onlyIfStatus ? { status: { $in: onlyIfStatus } } : {}),
      } as Filter<BulkOperationDocument>),
      { $set: { ...set, updatedAt: new Date() } },
      { returnDocument: "after" },
    );
  }

  page(
    organizationId: string,
    filter: Document,
    opts: { pageSize: number; cursor?: string | null },
  ): Promise<CursorPage<WithId<BulkOperationDocument>>> {
    return this.findPage(organizationId, filter as Filter<BulkOperationDocument>, {
      ...opts,
      sortField: "createdAt",
      direction: -1,
      projection: { targetIds: 0 },
    });
  }

  /** All-jobs listing: operations created before the cursor, newest first (no target ids). */
  pageBefore(
    organizationId: string,
    statuses: BulkStatus[] | undefined,
    before: { createdAt: Date; id: ObjectId } | null,
    limit: number,
  ) {
    const filter: Document = {
      ...(statuses ? { status: { $in: statuses } } : {}),
      ...(before
        ? {
            $or: [
              { createdAt: { $lt: before.createdAt } },
              { createdAt: before.createdAt, _id: { $lt: before.id } },
            ],
          }
        : {}),
    };
    return this.collection
      .find(this.scoped(organizationId, filter as Filter<BulkOperationDocument>), {
        projection: { targetIds: 0 },
      })
      .sort({ createdAt: -1, _id: -1 })
      .limit(limit)
      .toArray();
  }

  /** Maintenance: operations of any organization still queued or running since before `cutoff`. */
  findStuck(
    cutoff: Date,
    limit: number,
  ): Promise<Array<{ _id: ObjectId; organizationId: string; status: BulkStatus }>> {
    return this.collection
      .find(
        {
          status: { $in: ["queued", "running"] },
          updatedAt: { $lt: cutoff },
        } as Filter<BulkOperationDocument>,
        {
          projection: { _id: 1, organizationId: 1, status: 1 },
        },
      )
      .limit(limit)
      .toArray();
  }
}

@Injectable()
export class BulkItemRepository extends OrgScopedRepository<BulkItemDocument> {
  constructor(mongo: MongoService) {
    super(mongo, Collections.bulkOperationItems);
  }

  /** Records results; a business already recorded for the operation keeps its first result. */
  async record(organizationId: string, items: BulkItemDocument[]): Promise<void> {
    if (items.length === 0) return;
    if (items.some((i) => i.organizationId !== organizationId))
      throw new Error("organizationId mismatch");
    const ops: Array<AnyBulkWriteOperation<BulkItemDocument>> = items.map((item) => ({
      updateOne: {
        filter: this.scoped(organizationId, {
          operationId: item.operationId,
          businessId: item.businessId,
        } as Filter<BulkItemDocument>),
        update: { $setOnInsert: item },
        upsert: true,
      },
    }));
    try {
      await this.collection.bulkWrite(ops, { ordered: false });
    } catch (err) {
      if (!isDuplicateKeyError(err)) throw err;
    }
  }

  /** Businesses of this chunk that already have a result (a retried job skips them). */
  async recordedAmong(
    organizationId: string,
    operationId: ObjectId,
    businessIds: ObjectId[],
  ): Promise<Set<string>> {
    if (businessIds.length === 0) return new Set();
    const rows = await this.collection
      .find(
        this.scoped(organizationId, {
          operationId,
          businessId: { $in: businessIds },
        } as Filter<BulkItemDocument>),
        {
          projection: { businessId: 1 },
        },
      )
      .toArray();
    return new Set(rows.map((r) => r.businessId.toHexString()));
  }

  async countsByOutcome(
    organizationId: string,
    operationId: ObjectId,
  ): Promise<Map<BulkItemOutcome, number>> {
    const rows = await this.collection
      .aggregate<{ _id: BulkItemOutcome; n: number }>([
        { $match: this.scoped(organizationId, { operationId } as Filter<BulkItemDocument>) },
        { $group: { _id: "$outcome", n: { $sum: 1 } } },
      ])
      .toArray();
    return new Map(rows.map((r) => [r._id, r.n]));
  }

  /** Businesses that got one of these outcomes (assignment notifications count them). */
  countWithOutcomes(
    organizationId: string,
    operationId: ObjectId,
    outcomes: BulkItemOutcome[],
  ): Promise<number> {
    return this.count(organizationId, {
      operationId,
      outcome: { $in: outcomes },
    } as Filter<BulkItemDocument>);
  }

  page(
    organizationId: string,
    operationId: ObjectId,
    outcomes: BulkItemOutcome[] | undefined,
    opts: { pageSize: number; cursor?: string | null },
  ): Promise<CursorPage<WithId<BulkItemDocument>>> {
    return this.findPage(
      organizationId,
      {
        operationId,
        ...(outcomes?.length ? { outcome: { $in: outcomes } } : {}),
      } as Filter<BulkItemDocument>,
      { ...opts, sortField: "_id", direction: 1 },
    );
  }
}
