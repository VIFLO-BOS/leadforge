import { Injectable } from "@nestjs/common";
import {
  Collections,
  isDuplicateKeyError,
  MongoService,
  ObjectId,
  OrgScopedRepository,
  type CursorPage,
  type Filter,
  type WithId,
} from "@leadforge/db-mongo";
import type { ObservationField, SourceKey } from "@leadforge/contracts";
import type { ObservationDocument } from "../provenance.types.js";

/** Append-only. Observations are never updated except by the retention redaction job. */
@Injectable()
export class ObservationRepository extends OrgScopedRepository<ObservationDocument> {
  constructor(mongo: MongoService) {
    super(mongo, Collections.sourceObservations);
  }

  /** Inserts all; existing ids (a retried import row) are skipped, not duplicated. */
  async insertMany(organizationId: string, docs: ObservationDocument[]): Promise<number> {
    if (docs.length === 0) return 0;
    if (docs.some((d) => d.organizationId !== organizationId))
      throw new Error("organizationId mismatch");
    try {
      const res = await this.collection.insertMany(docs as Array<WithId<ObservationDocument>>, {
        ordered: false,
      });
      return res.insertedCount;
    } catch (err) {
      const writeErrors = (err as { writeErrors?: unknown[] }).writeErrors;
      const onlyDuplicates =
        Array.isArray(writeErrors) &&
        writeErrors.length > 0 &&
        writeErrors.every((e) => isDuplicateKeyError(e));
      if (isDuplicateKeyError(err) || onlyDuplicates)
        return (err as { insertedCount?: number }).insertedCount ?? 0;
      throw err;
    }
  }

  /** Observations of a business (and of businesses merged into it), newest first. */
  async pageForBusiness(
    organizationId: string,
    businessId: ObjectId | ObjectId[],
    filter: { field?: ObservationField | undefined; source?: SourceKey | undefined },
    opts: { pageSize: number; cursor?: string | null },
  ): Promise<CursorPage<WithId<ObservationDocument>>> {
    const query: Filter<ObservationDocument> = {
      businessId: idsFilter(businessId),
    } as Filter<ObservationDocument>;
    if (filter.field) query.field = filter.field;
    if (filter.source) query.source = filter.source;
    return this.findPage(organizationId, query, {
      ...opts,
      sortField: "collectedAt",
      direction: -1,
    });
  }

  async countForBusiness(
    organizationId: string,
    businessId: ObjectId | ObjectId[],
  ): Promise<number> {
    return this.count(organizationId, {
      businessId: idsFilter(businessId),
    } as Filter<ObservationDocument>);
  }

  /** Observations an enrichment run recorded (for its result). */
  async idsForEnrichmentRun(
    organizationId: string,
    runId: ObjectId,
    limit = 200,
  ): Promise<ObjectId[]> {
    const docs = await this.collection
      .find(
        this.scoped(organizationId, { enrichmentRunId: runId } as Filter<ObservationDocument>),
        { projection: { _id: 1 } },
      )
      .limit(limit)
      .toArray();
    return docs.map((d) => d._id);
  }

  /**
   * Maintenance only (retention purge, any organization): removes the value of every
   * observation whose source retention has passed. The fact that the field was observed from
   * the source on that date (and the source record id) is kept.
   */
  async redactExpired(now: Date): Promise<number> {
    const res = await this.collection.updateMany(
      { "policy.retainValueUntil": { $lte: now }, redactedAt: null } as Filter<ObservationDocument>,
      { $set: { rawValue: null, normalizedValue: null, fieldKey: null, redactedAt: now } },
    );
    return res.modifiedCount;
  }

  async countsBySource(
    organizationId: string,
    businessId: ObjectId | ObjectId[],
  ): Promise<Array<{ _id: SourceKey; count: number }>> {
    return this.collection
      .aggregate<{ _id: SourceKey; count: number }>([
        {
          $match: this.scoped(organizationId, {
            businessId: idsFilter(businessId),
          } as Filter<ObservationDocument>),
        },
        { $group: { _id: "$source", count: { $sum: 1 } } },
      ])
      .toArray();
  }
}

function idsFilter(ids: ObjectId | ObjectId[]): ObjectId | { $in: ObjectId[] } {
  if (!Array.isArray(ids)) return ids;
  return ids.length === 1 ? ids[0]! : { $in: ids };
}
