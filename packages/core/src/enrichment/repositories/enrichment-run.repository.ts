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
import type { EnrichmentRunKind, EnrichmentRunStatus } from "@leadforge/contracts";
import type { EnrichmentRunDocument } from "../enrichment.types.js";

@Injectable()
export class EnrichmentRunRepository extends OrgScopedRepository<EnrichmentRunDocument> {
  constructor(mongo: MongoService) {
    super(mongo, Collections.enrichmentRuns);
  }

  /** Inserts; false when the business already has an active run of this kind. */
  async insert(organizationId: string, doc: EnrichmentRunDocument): Promise<boolean> {
    if (doc.organizationId !== organizationId) throw new Error("organizationId mismatch");
    try {
      await this.collection.insertOne(doc as WithId<EnrichmentRunDocument>);
      return true;
    } catch (err) {
      if (isDuplicateKeyError(err, "kind") || isDuplicateKeyError(err, "businessId")) return false;
      throw err;
    }
  }

  findActive(
    organizationId: string,
    businessId: ObjectId,
    kind: EnrichmentRunKind,
  ): Promise<WithId<EnrichmentRunDocument> | null> {
    return this.findOne(organizationId, {
      businessId,
      kind,
      active: true,
    } as Filter<EnrichmentRunDocument>);
  }

  async pageForBusiness(
    organizationId: string,
    businessId: ObjectId,
    filter: {
      kinds?: EnrichmentRunKind[] | undefined;
      statuses?: EnrichmentRunStatus[] | undefined;
    },
    opts: { pageSize: number; cursor?: string | null },
  ): Promise<CursorPage<WithId<EnrichmentRunDocument>>> {
    const query: Document = { businessId };
    if (filter.kinds?.length) query.kind = { $in: filter.kinds };
    if (filter.statuses?.length) query.status = { $in: filter.statuses };
    return this.findPage(organizationId, query as Filter<EnrichmentRunDocument>, {
      ...opts,
      sortField: "createdAt",
      direction: -1,
    });
  }

  async transition(
    organizationId: string,
    id: ObjectId,
    from: EnrichmentRunStatus[],
    update: UpdateFilter<EnrichmentRunDocument>,
  ): Promise<WithId<EnrichmentRunDocument> | null> {
    return this.collection.findOneAndUpdate(
      this.scoped(organizationId, {
        _id: id,
        status: { $in: from },
      } as Filter<EnrichmentRunDocument>),
      update,
      { returnDocument: "after" },
    );
  }

  async pageBefore(
    organizationId: string,
    statuses: EnrichmentRunStatus[] | undefined,
    before: { createdAt: Date; id: ObjectId } | null,
    limit: number,
  ): Promise<Array<WithId<EnrichmentRunDocument>>> {
    const and: Document[] = [];
    if (statuses?.length) and.push({ status: { $in: statuses } });
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
          (and.length ? { $and: and } : {}) as Filter<EnrichmentRunDocument>,
        ),
      )
      .sort({ createdAt: -1, _id: -1 })
      .limit(limit)
      .toArray();
  }

  /** Maintenance only (any organization): runs stuck in `status` since before `cutoff`. */
  async findStale(
    status: EnrichmentRunStatus,
    cutoff: Date,
    limit: number,
  ): Promise<Array<{ _id: ObjectId; organizationId: string; kind: EnrichmentRunKind }>> {
    return this.collection
      .find({ status, updatedAt: { $lt: cutoff } } as Filter<EnrichmentRunDocument>, {
        projection: { _id: 1, organizationId: 1, kind: 1 },
      })
      .limit(limit)
      .toArray();
  }

  touch(organizationId: string, id: ObjectId, at: Date): Promise<unknown> {
    return this.collection.updateOne(
      this.scoped(organizationId, { _id: id } as Filter<EnrichmentRunDocument>),
      { $set: { updatedAt: at } },
    );
  }

  static newId(): ObjectId {
    return new ObjectId();
  }
}
