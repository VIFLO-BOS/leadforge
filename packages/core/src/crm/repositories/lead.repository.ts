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
  type UpdateFilter,
  type WithId,
} from "@leadforge/db-mongo";
import type { LeadDocument } from "../crm.types.js";

/** Pipeline state, one document per business per organization. */
@Injectable()
export class LeadRepository extends OrgScopedRepository<LeadDocument> {
  constructor(mongo: MongoService) {
    super(mongo, Collections.leads);
  }

  /** False when the business already has a lead (unique organizationId + businessId). */
  async insert(organizationId: string, doc: LeadDocument): Promise<boolean> {
    if (doc.organizationId !== organizationId) throw new Error("organizationId mismatch");
    try {
      await this.collection.insertOne(doc as WithId<LeadDocument>);
      return true;
    } catch (err) {
      if (isDuplicateKeyError(err)) return false;
      throw err;
    }
  }

  findByBusiness(
    organizationId: string,
    businessId: ObjectId,
  ): Promise<WithId<LeadDocument> | null> {
    return this.findOne(organizationId, { businessId } as Filter<LeadDocument>);
  }

  async findByBusinessIds(
    organizationId: string,
    businessIds: ObjectId[],
  ): Promise<Array<WithId<LeadDocument>>> {
    if (businessIds.length === 0) return [];
    return this.collection
      .find(
        this.scoped(organizationId, { businessId: { $in: businessIds } } as Filter<LeadDocument>),
      )
      .toArray();
  }

  /**
   * Optimistic write: applies `$set` (and bumps `version`) only when the lead is still at
   * `expectedVersion`. Null when it changed or does not exist.
   */
  updateIfVersion(
    organizationId: string,
    id: ObjectId,
    expectedVersion: number,
    set: Partial<LeadDocument>,
  ): Promise<WithId<LeadDocument> | null> {
    return this.collection.findOneAndUpdate(
      this.scoped(organizationId, { _id: id, version: expectedVersion } as Filter<LeadDocument>),
      { $set: set, $inc: { version: 1 } } as UpdateFilter<LeadDocument>,
      { returnDocument: "after" },
    );
  }

  /** Activity timestamps are derived data: no version bump, so they never make a UI move conflict. */
  async touchActivity(organizationId: string, businessId: ObjectId, at: Date): Promise<void> {
    await this.collection.updateOne(
      this.scoped(organizationId, { businessId } as Filter<LeadDocument>),
      { $max: { lastActivityAt: at } },
    );
  }

  page(
    organizationId: string,
    filter: Document,
    opts: { pageSize: number; cursor?: string | null; sortField: string; direction: 1 | -1 },
  ): Promise<CursorPage<WithId<LeadDocument>>> {
    return this.findPage(organizationId, filter as Filter<LeadDocument>, opts);
  }

  countMatching(organizationId: string, filter: Document): Promise<number> {
    return this.count(organizationId, filter as Filter<LeadDocument>);
  }

  /** Lead counts per stage key. */
  async countByStage(organizationId: string, filter: Document = {}): Promise<Map<string, number>> {
    const rows = await this.collection
      .aggregate<{ _id: string; n: number }>([
        { $match: this.scoped(organizationId, filter as Filter<LeadDocument>) },
        { $group: { _id: "$stageKey", n: { $sum: 1 } } },
      ])
      .toArray();
    return new Map(rows.map((r) => [r._id, r.n]));
  }

  /** Businesses whose lead is assigned to the user (export scope of Sales Representatives). */
  async businessIdsAssignedTo(
    organizationId: string,
    userId: string,
    limit: number,
  ): Promise<ObjectId[]> {
    const rows = await this.collection
      .find(this.scoped(organizationId, { assignedToUserId: userId } as Filter<LeadDocument>), {
        projection: { businessId: 1 },
      })
      .limit(limit)
      .toArray();
    return rows.map((r) => r.businessId);
  }

  /** Leads closed (won or lost) since `since` (ever when null), with summed won values per currency. */
  async closedSince(
    organizationId: string,
    since: Date | null,
  ): Promise<
    Array<{ kind: "won" | "lost"; currency: string | null; value: number; count: number }>
  > {
    const match: Document = { closedAt: since ? { $gte: since } : { $ne: null } };
    const rows = await this.collection
      .aggregate<{
        _id: { kind: "won" | "lost"; currency: string | null };
        value: number;
        count: number;
      }>([
        { $match: this.scoped(organizationId, match as Filter<LeadDocument>) },
        {
          $group: {
            _id: { kind: "$closedKind", currency: "$currency" },
            value: { $sum: { $ifNull: ["$wonValueMinor", 0] } },
            count: { $sum: 1 },
          },
        },
      ])
      .toArray();
    return rows.map((r) => ({
      kind: r._id.kind,
      currency: r._id.currency ?? null,
      value: Number(r.value),
      count: r.count,
    }));
  }
}
