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
import type { LeadListDocument, LeadListItemDocument } from "../crm.types.js";

@Injectable()
export class LeadListRepository extends OrgScopedRepository<LeadListDocument> {
  constructor(mongo: MongoService) {
    super(mongo, Collections.leadLists);
  }

  /** False when the organization already has a list with this name. */
  async insert(organizationId: string, doc: LeadListDocument): Promise<boolean> {
    if (doc.organizationId !== organizationId) throw new Error("organizationId mismatch");
    try {
      await this.collection.insertOne(doc as WithId<LeadListDocument>);
      return true;
    } catch (err) {
      if (isDuplicateKeyError(err)) return false;
      throw err;
    }
  }

  /** Null when the list does not exist; throws a duplicate-key error on a name clash. */
  update(
    organizationId: string,
    id: ObjectId,
    set: Partial<LeadListDocument>,
  ): Promise<WithId<LeadListDocument> | null> {
    return this.collection.findOneAndUpdate(
      this.scoped(organizationId, { _id: id } as Filter<LeadListDocument>),
      { $set: set },
      { returnDocument: "after" },
    );
  }

  async remove(organizationId: string, id: ObjectId): Promise<boolean> {
    const res = await this.collection.deleteOne(
      this.scoped(organizationId, { _id: id } as Filter<LeadListDocument>),
    );
    return res.deletedCount === 1;
  }

  page(
    organizationId: string,
    filter: Document,
    opts: { pageSize: number; cursor?: string | null; sortField: string; direction: 1 | -1 },
  ): Promise<CursorPage<WithId<LeadListDocument>>> {
    return this.findPage(organizationId, filter as Filter<LeadListDocument>, opts);
  }
}

@Injectable()
export class LeadListItemRepository extends OrgScopedRepository<LeadListItemDocument> {
  constructor(mongo: MongoService) {
    super(mongo, Collections.leadListItems);
  }

  /** Adds the businesses that are not on the list yet; returns the ids actually added. */
  async addMany(
    organizationId: string,
    listId: ObjectId,
    businessIds: ObjectId[],
    userId: string,
    at: Date,
  ): Promise<Set<string>> {
    if (businessIds.length === 0) return new Set();
    const ops: Array<AnyBulkWriteOperation<LeadListItemDocument>> = businessIds.map(
      (businessId) => ({
        updateOne: {
          filter: this.scoped(organizationId, {
            listId,
            businessId,
          } as Filter<LeadListItemDocument>),
          update: {
            $setOnInsert: {
              _id: new ObjectId(),
              organizationId,
              listId,
              businessId,
              addedByUserId: userId,
              addedAt: at,
            },
          },
          upsert: true,
        },
      }),
    );
    try {
      const res = await this.collection.bulkWrite(ops, { ordered: false });
      return new Set(
        Object.keys(res.upsertedIds).map((index) => businessIds[Number(index)]!.toHexString()),
      );
    } catch (err) {
      // A concurrent add of the same business loses the race on the unique index: it is on the
      // list either way, and the other request reports it as added.
      if (!isDuplicateKeyError(err)) throw err;
      const result = (err as { result?: { upsertedIds?: Record<string, unknown> } }).result;
      return new Set(
        Object.keys(result?.upsertedIds ?? {}).map((index) =>
          businessIds[Number(index)]!.toHexString(),
        ),
      );
    }
  }

  /** Removes the businesses from the list; returns the ids that were on it. */
  async removeMany(
    organizationId: string,
    listId: ObjectId,
    businessIds: ObjectId[],
  ): Promise<Set<string>> {
    if (businessIds.length === 0) return new Set();
    const present = await this.membersAmong(organizationId, listId, businessIds);
    if (present.size === 0) return present;
    await this.collection.deleteMany(
      this.scoped(organizationId, {
        listId,
        businessId: { $in: businessIds },
      } as Filter<LeadListItemDocument>),
    );
    return present;
  }

  /** Which of these businesses are on the list. */
  async membersAmong(
    organizationId: string,
    listId: ObjectId,
    businessIds: ObjectId[],
  ): Promise<Set<string>> {
    if (businessIds.length === 0) return new Set();
    const rows = await this.collection
      .find(
        this.scoped(organizationId, {
          listId,
          businessId: { $in: businessIds },
        } as Filter<LeadListItemDocument>),
        {
          projection: { businessId: 1 },
        },
      )
      .toArray();
    return new Set(rows.map((r) => r.businessId.toHexString()));
  }

  countForList(organizationId: string, listId: ObjectId): Promise<number> {
    return this.count(organizationId, { listId } as Filter<LeadListItemDocument>);
  }

  page(
    organizationId: string,
    listId: ObjectId,
    opts: { pageSize: number; cursor?: string | null },
  ): Promise<CursorPage<WithId<LeadListItemDocument>>> {
    return this.findPage(organizationId, { listId } as Filter<LeadListItemDocument>, {
      ...opts,
      sortField: "addedAt",
      direction: -1,
    });
  }

  /** Business ids on a list, at most `limit`. */
  async businessIds(organizationId: string, listId: ObjectId, limit: number): Promise<ObjectId[]> {
    const rows = await this.collection
      .find(this.scoped(organizationId, { listId } as Filter<LeadListItemDocument>), {
        projection: { businessId: 1 },
      })
      .limit(limit)
      .toArray();
    return rows.map((r) => r.businessId);
  }

  /** Lists that contain the business. */
  async listIdsFor(
    organizationId: string,
    businessId: ObjectId,
    limit = 1000,
  ): Promise<ObjectId[]> {
    const rows = await this.collection
      .find(this.scoped(organizationId, { businessId } as Filter<LeadListItemDocument>), {
        projection: { listId: 1 },
      })
      .limit(limit)
      .toArray();
    return rows.map((r) => r.listId);
  }

  async removeList(organizationId: string, listId: ObjectId): Promise<number> {
    const res = await this.collection.deleteMany(
      this.scoped(organizationId, { listId } as Filter<LeadListItemDocument>),
    );
    return res.deletedCount;
  }
}
