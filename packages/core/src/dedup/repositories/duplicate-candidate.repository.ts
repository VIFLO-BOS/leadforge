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
import type { CandidateSignal, DuplicateCandidateStatus } from "@leadforge/contracts";
import type { PairEvaluation } from "../candidate-scoring.js";

export interface DuplicateCandidateDocument {
  _id: ObjectId;
  organizationId: string;
  /** Sorted by hex id. */
  businessIds: [ObjectId, ObjectId];
  pairKey: string;
  stage: PairEvaluation["stage"];
  score: number;
  signals: CandidateSignal[];
  reasons: string[];
  status: DuplicateCandidateStatus;
  decidedByUserId: string | null;
  decidedAt: Date | null;
  mergeId: ObjectId | null;
  createdAt: Date;
  updatedAt: Date;
}

const OPEN: DuplicateCandidateStatus[] = ["pending", "deferred"];

@Injectable()
export class DuplicateCandidateRepository extends OrgScopedRepository<DuplicateCandidateDocument> {
  constructor(mongo: MongoService) {
    super(mongo, Collections.duplicateCandidates);
  }

  /**
   * Records a candidate pair. An open pair gets its score and reasons refreshed; a decided pair
   * (merged, rejected, superseded) is left alone, so a rejected pair is never proposed again.
   * Returns true when the pair is open after the call.
   */
  async upsert(
    organizationId: string,
    ids: [ObjectId, ObjectId],
    key: string,
    evaluation: PairEvaluation,
    now: Date,
  ): Promise<boolean> {
    const refreshed = await this.collection.updateOne(
      this.scoped(organizationId, {
        pairKey: key,
        status: { $in: OPEN },
      } as Filter<DuplicateCandidateDocument>),
      {
        $set: {
          stage: evaluation.stage,
          score: evaluation.score,
          signals: evaluation.signals,
          reasons: evaluation.reasons,
          updatedAt: now,
        },
      },
    );
    if (refreshed.matchedCount === 1) return true;
    try {
      await this.collection.insertOne({
        _id: new ObjectId(),
        organizationId,
        businessIds: ids,
        pairKey: key,
        stage: evaluation.stage,
        score: evaluation.score,
        signals: evaluation.signals,
        reasons: evaluation.reasons,
        status: "pending",
        decidedByUserId: null,
        decidedAt: null,
        mergeId: null,
        createdAt: now,
        updatedAt: now,
      } as WithId<DuplicateCandidateDocument>);
      return true;
    } catch (err) {
      if (isDuplicateKeyError(err, "pairKey")) return false; // already decided
      throw err;
    }
  }

  async page(
    organizationId: string,
    filter: {
      statuses: DuplicateCandidateStatus[];
      businessId?: ObjectId | undefined;
      minScore?: number | undefined;
    },
    opts: { pageSize: number; cursor?: string | null },
  ): Promise<CursorPage<WithId<DuplicateCandidateDocument>>> {
    const query: Document = { status: { $in: filter.statuses } };
    if (filter.businessId) query.businessIds = filter.businessId;
    if (filter.minScore !== undefined) query.score = { $gte: filter.minScore };
    return this.findPage(organizationId, query as Filter<DuplicateCandidateDocument>, {
      ...opts,
      sortField: "score",
      direction: -1,
    });
  }

  countOpenFor(organizationId: string, businessId: ObjectId): Promise<number> {
    return this.count(
      organizationId,
      { businessIds: businessId, status: { $in: OPEN } } as Filter<DuplicateCandidateDocument>,
      1000,
    );
  }

  findOpenFor(
    organizationId: string,
    businessId: ObjectId,
  ): Promise<Array<WithId<DuplicateCandidateDocument>>> {
    return this.collection
      .find(
        this.scoped(organizationId, {
          businessIds: businessId,
          status: { $in: OPEN },
        } as Filter<DuplicateCandidateDocument>),
      )
      .limit(500)
      .toArray();
  }

  async transition(
    organizationId: string,
    id: ObjectId,
    from: DuplicateCandidateStatus[],
    update: UpdateFilter<DuplicateCandidateDocument>,
  ): Promise<WithId<DuplicateCandidateDocument> | null> {
    return this.collection.findOneAndUpdate(
      this.scoped(organizationId, {
        _id: id,
        status: { $in: from },
      } as Filter<DuplicateCandidateDocument>),
      update,
      { returnDocument: "after" },
    );
  }

  async setStatus(
    organizationId: string,
    ids: ObjectId[],
    status: DuplicateCandidateStatus,
    extra: Document = {},
  ): Promise<void> {
    if (ids.length === 0) return;
    await this.collection.updateMany(
      this.scoped(organizationId, { _id: { $in: ids } } as Filter<DuplicateCandidateDocument>),
      {
        $set: { status, updatedAt: new Date(), ...extra },
      },
    );
  }

  async restoreStatuses(
    organizationId: string,
    items: Array<{ id: ObjectId; status: DuplicateCandidateStatus }>,
  ): Promise<void> {
    for (const item of items) {
      await this.collection.updateOne(
        this.scoped(organizationId, { _id: item.id } as Filter<DuplicateCandidateDocument>),
        {
          $set: {
            status: item.status,
            updatedAt: new Date(),
            mergeId: null,
            decidedAt: null,
            decidedByUserId: null,
          },
        },
      );
    }
  }
}
