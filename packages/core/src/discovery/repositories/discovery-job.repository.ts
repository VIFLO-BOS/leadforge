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
import type { DiscoveryJobStatus, DiscoverySourceKey } from "@leadforge/contracts";
import type { DiscoveryJobDocument } from "../discovery.types.js";

const TERMINAL: DiscoveryJobStatus[] = [
  "completed",
  "completed_with_warnings",
  "failed",
  "cancelled",
];

@Injectable()
export class DiscoveryJobRepository extends OrgScopedRepository<DiscoveryJobDocument> {
  constructor(mongo: MongoService) {
    super(mongo, Collections.discoveryJobs);
  }

  /** Inserts; returns false when the (creator, Idempotency-Key) pair already exists. */
  async insert(organizationId: string, doc: DiscoveryJobDocument): Promise<boolean> {
    if (doc.organizationId !== organizationId) throw new Error("organizationId mismatch");
    try {
      await this.collection.insertOne(doc as WithId<DiscoveryJobDocument>);
      return true;
    } catch (err) {
      if (isDuplicateKeyError(err, "idempotencyKey")) return false;
      throw err;
    }
  }

  findByIdempotencyKey(
    organizationId: string,
    userId: string,
    key: string,
  ): Promise<WithId<DiscoveryJobDocument> | null> {
    return this.findOne(organizationId, {
      createdByUserId: userId,
      idempotencyKey: key,
    } as Filter<DiscoveryJobDocument>);
  }

  async page(
    organizationId: string,
    filter: {
      statuses?: DiscoveryJobStatus[] | undefined;
      source?: DiscoverySourceKey | undefined;
    },
    opts: { pageSize: number; cursor?: string | null },
  ): Promise<CursorPage<WithId<DiscoveryJobDocument>>> {
    const query: Document = {};
    if (filter.statuses?.length) query.status = { $in: filter.statuses };
    if (filter.source) query["spec.sources"] = filter.source;
    return this.findPage(organizationId, query as Filter<DiscoveryJobDocument>, {
      ...opts,
      sortField: "createdAt",
      direction: -1,
    });
  }

  /** Rows strictly older than (createdAt, _id), newest first, for the all-jobs merge. */
  async pageBefore(
    organizationId: string,
    filter: { statuses?: DiscoveryJobStatus[] | undefined },
    before: { createdAt: Date; id: ObjectId } | null,
    limit: number,
  ): Promise<Array<WithId<DiscoveryJobDocument>>> {
    const and: Document[] = [];
    if (filter.statuses?.length) and.push({ status: { $in: filter.statuses } });
    if (before)
      and.push({
        $or: [
          { createdAt: { $lt: before.createdAt } },
          { createdAt: before.createdAt, _id: { $lt: before.id } },
        ],
      });
    return this.collection
      .find(
        this.scoped(
          organizationId,
          (and.length ? { $and: and } : {}) as Filter<DiscoveryJobDocument>,
        ),
      )
      .sort({ createdAt: -1, _id: -1 })
      .limit(limit)
      .toArray();
  }

  /** Atomic status transition; null when the job is not in one of `from` (or `extra` does not match). */
  async transition(
    organizationId: string,
    id: ObjectId,
    from: DiscoveryJobStatus[],
    update: UpdateFilter<DiscoveryJobDocument>,
    extra: Document = {},
    arrayFilters?: Document[],
  ): Promise<WithId<DiscoveryJobDocument> | null> {
    return this.collection.findOneAndUpdate(
      this.scoped(organizationId, {
        _id: id,
        status: { $in: from },
        ...extra,
      } as Filter<DiscoveryJobDocument>),
      update,
      { returnDocument: "after", ...(arrayFilters ? { arrayFilters } : {}) },
    );
  }

  async update(
    organizationId: string,
    id: ObjectId,
    update: UpdateFilter<DiscoveryJobDocument>,
    extra: Document = {},
    arrayFilters?: Document[],
  ): Promise<WithId<DiscoveryJobDocument> | null> {
    return this.collection.findOneAndUpdate(
      this.scoped(organizationId, { _id: id, ...extra } as Filter<DiscoveryJobDocument>),
      update,
      { returnDocument: "after", ...(arrayFilters ? { arrayFilters } : {}) },
    );
  }

  /** Marks a unit of the round finished exactly once; null when it was already finished. */
  async finishUnit(
    organizationId: string,
    id: ObjectId,
    round: number,
    unit: string,
    set: Document,
    arrayFilters?: Document[],
  ): Promise<WithId<DiscoveryJobDocument> | null> {
    return this.collection.findOneAndUpdate(
      this.scoped(organizationId, {
        _id: id,
        round,
        pendingUnits: unit,
      } as Filter<DiscoveryJobDocument>),
      {
        $pull: { pendingUnits: unit },
        $set: { updatedAt: new Date(), ...set },
      } as UpdateFilter<DiscoveryJobDocument>,
      { returnDocument: "after", ...(arrayFilters ? { arrayFilters } : {}) },
    );
  }

  /** Counts a page once; returns true the first time this page key is seen. */
  async countPage(
    organizationId: string,
    id: ObjectId,
    pageKey: string,
    source: string,
    records: number,
  ): Promise<boolean> {
    const res = await this.collection.updateOne(
      this.scoped(organizationId, {
        _id: id,
        pageKeys: { $ne: pageKey },
      } as Filter<DiscoveryJobDocument>),
      {
        $addToSet: { pageKeys: pageKey },
        $inc: {
          "progress.pagesFetched": 1,
          "sourceOutcomes.$[s].pages": 1,
          "sourceOutcomes.$[s].records": records,
        },
      } as UpdateFilter<DiscoveryJobDocument>,
      { arrayFilters: [{ "s.source": source }] },
    );
    return res.modifiedCount === 1;
  }

  countByStatus(
    organizationId: string,
    statuses?: DiscoveryJobStatus[],
    finishedSince?: Date,
  ): Promise<number> {
    const filter: Document = {};
    if (statuses) filter.status = { $in: statuses };
    if (finishedSince) filter.finishedAt = { $gte: finishedSince };
    return this.count(organizationId, filter as Filter<DiscoveryJobDocument>);
  }

  /** Maintenance only (reconciliation): terminal jobs not settled, finished before `cutoff`. */
  async findUnsettled(
    cutoff: Date,
    limit: number,
  ): Promise<Array<{ _id: ObjectId; organizationId: string }>> {
    return this.collection
      .find(
        {
          "credits.settledAt": null,
          status: { $in: TERMINAL },
          finishedAt: { $lt: cutoff },
        } as Filter<DiscoveryJobDocument>,
        {
          projection: { _id: 1, organizationId: 1 },
        },
      )
      .limit(limit)
      .toArray();
  }

  /** Maintenance only: running jobs past their timeout (the timeout job may have been lost). */
  async findTimedOut(
    now: Date,
    limit: number,
  ): Promise<Array<{ _id: ObjectId; organizationId: string }>> {
    return this.collection
      .find({ status: "running", timeoutAt: { $lt: now } } as Filter<DiscoveryJobDocument>, {
        projection: { _id: 1, organizationId: 1 },
      })
      .limit(limit)
      .toArray();
  }

  /** Maintenance only: queued jobs whose start job never ran (for example after a Redis loss). */
  async findStuckQueued(
    cutoff: Date,
    limit: number,
  ): Promise<Array<{ _id: ObjectId; organizationId: string; round: number }>> {
    return this.collection
      .find({ status: "queued", queuedAt: { $lt: cutoff } } as Filter<DiscoveryJobDocument>, {
        projection: { _id: 1, organizationId: 1, round: 1 },
      })
      .limit(limit)
      .toArray();
  }

  /** The job a ledger hold references, in the hold's organization. */
  findForHold(organizationId: string, jobId: string): Promise<WithId<DiscoveryJobDocument> | null> {
    return ObjectId.isValid(jobId) ? this.findById(organizationId, jobId) : Promise.resolve(null);
  }
}
