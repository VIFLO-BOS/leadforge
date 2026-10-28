import { Injectable } from "@nestjs/common";
import {
  Collections,
  MongoService,
  ObjectId,
  OrgScopedRepository,
  type CursorPage,
  type Document,
  type Filter,
  type WithId,
} from "@leadforge/db-mongo";
import type { ActivityDocument } from "../crm.types.js";

/** Lead activities (notes, calls, messages, meetings, stage changes, assignments). */
@Injectable()
export class ActivityRepository extends OrgScopedRepository<ActivityDocument> {
  constructor(mongo: MongoService) {
    super(mongo, Collections.leadActivities);
  }

  async insert(organizationId: string, doc: ActivityDocument): Promise<void> {
    if (doc.organizationId !== organizationId) throw new Error("organizationId mismatch");
    await this.collection.insertOne(doc as WithId<ActivityDocument>);
  }

  async insertMany(organizationId: string, docs: ActivityDocument[]): Promise<void> {
    if (docs.length === 0) return;
    if (docs.some((d) => d.organizationId !== organizationId))
      throw new Error("organizationId mismatch");
    await this.collection.insertMany(docs as Array<WithId<ActivityDocument>>, { ordered: false });
  }

  update(
    organizationId: string,
    id: ObjectId,
    set: Partial<ActivityDocument>,
  ): Promise<WithId<ActivityDocument> | null> {
    return this.collection.findOneAndUpdate(
      this.scoped(organizationId, { _id: id } as Filter<ActivityDocument>),
      { $set: set },
      { returnDocument: "after" },
    );
  }

  async remove(organizationId: string, id: ObjectId): Promise<boolean> {
    const res = await this.collection.deleteOne(
      this.scoped(organizationId, { _id: id } as Filter<ActivityDocument>),
    );
    return res.deletedCount === 1;
  }

  page(
    organizationId: string,
    filter: Document,
    opts: { pageSize: number; cursor?: string | null },
  ): Promise<CursorPage<WithId<ActivityDocument>>> {
    return this.findPage(organizationId, filter as Filter<ActivityDocument>, {
      ...opts,
      sortField: "occurredAt",
      direction: -1,
    });
  }

  countMatching(organizationId: string, filter: Document): Promise<number> {
    return this.count(organizationId, filter as Filter<ActivityDocument>);
  }

  /** Counts per type and author in [from, to) (all time when from is null). */
  async countByTypeAndUser(
    organizationId: string,
    from: Date | null,
    types: string[],
  ): Promise<Array<{ type: string; userId: string; count: number }>> {
    const match: Document = {
      type: { $in: types },
      ...(from ? { occurredAt: { $gte: from } } : {}),
    };
    const rows = await this.collection
      .aggregate<{ _id: { type: string; userId: string }; count: number }>([
        { $match: this.scoped(organizationId, match as Filter<ActivityDocument>) },
        { $group: { _id: { type: "$type", userId: "$createdByUserId" }, count: { $sum: 1 } } },
      ])
      .toArray();
    return rows.map((r) => ({ type: r._id.type, userId: r._id.userId, count: r.count }));
  }

  /** Stage-change activities into each stage since `from` (all time when null). */
  async stageEntries(organizationId: string, from: Date | null): Promise<Map<string, number>> {
    const match: Document = {
      type: "stage_change",
      ...(from ? { occurredAt: { $gte: from } } : {}),
    };
    const rows = await this.collection
      .aggregate<{ _id: string; n: number }>([
        { $match: this.scoped(organizationId, match as Filter<ActivityDocument>) },
        { $group: { _id: "$stageChange.toStageKey", n: { $sum: 1 } } },
      ])
      .toArray();
    return new Map(rows.map((r) => [r._id, r.n]));
  }
}
