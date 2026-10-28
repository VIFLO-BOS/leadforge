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
import type { AnalysisStatus, OpportunityKey } from "@leadforge/contracts";
import type { WebsiteAnalysisDocument } from "../analysis.types.js";

const TERMINAL: AnalysisStatus[] = ["completed", "failed"];

@Injectable()
export class WebsiteAnalysisRepository extends OrgScopedRepository<WebsiteAnalysisDocument> {
  constructor(mongo: MongoService) {
    super(mongo, Collections.websiteAnalyses);
  }

  /** Inserts; returns false when the business already has an active analysis. */
  async insert(organizationId: string, doc: WebsiteAnalysisDocument): Promise<boolean> {
    if (doc.organizationId !== organizationId) throw new Error("organizationId mismatch");
    try {
      await this.collection.insertOne(doc as WithId<WebsiteAnalysisDocument>);
      return true;
    } catch (err) {
      if (
        isDuplicateKeyError(err, "active_analysis_per_business") ||
        isDuplicateKeyError(err, "businessId")
      )
        return false;
      throw err;
    }
  }

  findActive(
    organizationId: string,
    businessIds: ObjectId[],
  ): Promise<Array<WithId<WebsiteAnalysisDocument>>> {
    if (businessIds.length === 0) return Promise.resolve([]);
    return this.collection
      .find(
        this.scoped(organizationId, {
          businessId: { $in: businessIds },
          active: true,
        } as Filter<WebsiteAnalysisDocument>),
      )
      .toArray();
  }

  async page(
    organizationId: string,
    filter: {
      statuses?: AnalysisStatus[] | undefined;
      opportunities?: OpportunityKey[] | undefined;
      businessId?: ObjectId | undefined;
      batchId?: ObjectId | undefined;
    },
    opts: { pageSize: number; cursor?: string | null },
  ): Promise<CursorPage<WithId<WebsiteAnalysisDocument>>> {
    const query: Document = {};
    if (filter.statuses?.length) query.status = { $in: filter.statuses };
    if (filter.opportunities?.length) query["opportunities.key"] = { $in: filter.opportunities };
    if (filter.businessId) query.businessId = filter.businessId;
    if (filter.batchId) query.batchId = filter.batchId;
    return this.findPage(organizationId, query as Filter<WebsiteAnalysisDocument>, {
      ...opts,
      sortField: "createdAt",
      direction: -1,
    });
  }

  /** Latest analysis of a business (any status). */
  async latestForBusiness(
    organizationId: string,
    businessId: ObjectId,
    statuses?: AnalysisStatus[],
  ): Promise<WithId<WebsiteAnalysisDocument> | null> {
    return this.collection.findOne(
      this.scoped(organizationId, {
        businessId,
        ...(statuses ? { status: { $in: statuses } } : {}),
      } as Filter<WebsiteAnalysisDocument>),
      { sort: { createdAt: -1, _id: -1 } },
    );
  }

  /** Atomic status transition; null when the analysis is not in one of `from`. */
  async transition(
    organizationId: string,
    id: ObjectId,
    from: AnalysisStatus[],
    update: UpdateFilter<WebsiteAnalysisDocument>,
  ): Promise<WithId<WebsiteAnalysisDocument> | null> {
    return this.collection.findOneAndUpdate(
      this.scoped(organizationId, {
        _id: id,
        status: { $in: from },
      } as Filter<WebsiteAnalysisDocument>),
      update,
      { returnDocument: "after" },
    );
  }

  async update(
    organizationId: string,
    id: ObjectId,
    update: UpdateFilter<WebsiteAnalysisDocument>,
  ): Promise<WithId<WebsiteAnalysisDocument> | null> {
    return this.collection.findOneAndUpdate(
      this.scoped(organizationId, { _id: id } as Filter<WebsiteAnalysisDocument>),
      update,
      { returnDocument: "after" },
    );
  }

  countBatch(
    organizationId: string,
    batchId: ObjectId,
    statuses: AnalysisStatus[],
  ): Promise<number> {
    return this.count(organizationId, {
      batchId,
      status: { $in: statuses },
    } as Filter<WebsiteAnalysisDocument>);
  }

  /** Rows strictly older than (createdAt, _id), newest first, for the all-jobs merge. */
  async pageBefore(
    organizationId: string,
    statuses: AnalysisStatus[] | undefined,
    before: { createdAt: Date; id: ObjectId } | null,
    limit: number,
  ): Promise<Array<WithId<WebsiteAnalysisDocument>>> {
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
          (and.length ? { $and: and } : {}) as Filter<WebsiteAnalysisDocument>,
        ),
        {
          projection: { detections: 0, opportunities: 0, pagesVisited: 0 },
        },
      )
      .sort({ createdAt: -1, _id: -1 })
      .limit(limit)
      .toArray();
  }

  /** Maintenance only (any organization): analyses in `status` not updated since `cutoff`. */
  async findStale(
    status: AnalysisStatus,
    cutoff: Date,
    limit: number,
  ): Promise<Array<{ _id: ObjectId; organizationId: string }>> {
    return this.collection
      .find({ status, updatedAt: { $lt: cutoff } } as Filter<WebsiteAnalysisDocument>, {
        projection: { _id: 1, organizationId: 1 },
      })
      .limit(limit)
      .toArray();
  }

  /** Maintenance only: finished analyses whose credits were never settled. */
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
        } as Filter<WebsiteAnalysisDocument>,
        {
          projection: { _id: 1, organizationId: 1 },
        },
      )
      .limit(limit)
      .toArray();
  }

  /** The analysis a ledger hold references, in the hold's organization. */
  findForHold(organizationId: string, id: string): Promise<WithId<WebsiteAnalysisDocument> | null> {
    return ObjectId.isValid(id) ? this.findById(organizationId, id) : Promise.resolve(null);
  }
}
