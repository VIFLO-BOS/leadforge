import { Injectable } from "@nestjs/common";
import {
  Collections,
  isDuplicateKeyError,
  MongoService,
  ObjectId,
  OrgScopedRepository,
  type AnyBulkWriteOperation,
  type CursorPage,
  type Filter,
  type WithId,
} from "@leadforge/db-mongo";
import type { DiscoveryItemOutcome } from "@leadforge/contracts";
import type { DiscoveryItemDocument } from "../discovery.types.js";

export type ItemWrite = Pick<
  DiscoveryItemDocument,
  | "source"
  | "externalId"
  | "round"
  | "outcome"
  | "billable"
  | "businessId"
  | "duplicateOfId"
  | "error"
  | "warnings"
>;

export interface ItemCounts {
  processed: number;
  created: number;
  updated: number;
  duplicates: number;
  skipped: number;
  failed: number;
  billable: number;
}

/**
 * Per-item results of a discovery job. One document per (job, source, external id), enforced
 * by a unique index, so reprocessing a page updates the same item instead of adding one.
 */
@Injectable()
export class DiscoveryItemRepository extends OrgScopedRepository<DiscoveryItemDocument> {
  constructor(mongo: MongoService) {
    super(mongo, Collections.discoveryJobItems);
  }

  async findByExternalIds(
    organizationId: string,
    jobId: ObjectId,
    source: string,
    externalIds: string[],
  ): Promise<Map<string, WithId<DiscoveryItemDocument>>> {
    if (externalIds.length === 0) return new Map();
    const docs = await this.collection
      .find(
        this.scoped(organizationId, {
          jobId,
          source,
          externalId: { $in: [...new Set(externalIds)] },
        } as Filter<DiscoveryItemDocument>),
      )
      .toArray();
    return new Map(docs.map((d) => [d.externalId, d]));
  }

  /** Items of this job that already produced one of these businesses (duplicate detection). */
  async producedBusinesses(
    organizationId: string,
    jobId: ObjectId,
    businessIds: ObjectId[],
  ): Promise<Array<{ externalId: string; businessId: ObjectId }>> {
    if (businessIds.length === 0) return [];
    const docs = await this.collection
      .find(
        this.scoped(organizationId, {
          jobId,
          businessId: { $in: businessIds },
          outcome: { $in: ["created", "updated"] },
        } as Filter<DiscoveryItemDocument>),
        { projection: { externalId: 1, businessId: 1 } },
      )
      .toArray();
    return docs
      .filter((d) => d.businessId)
      .map((d) => ({ externalId: d.externalId, businessId: d.businessId! }));
  }

  /**
   * Upserts outcomes by (job, source, external id). `attempts` counts every processing attempt.
   * A concurrent first insert of the same item is retried once as an update.
   */
  async writeOutcomes(
    organizationId: string,
    jobId: ObjectId,
    writes: ItemWrite[],
    now: Date = new Date(),
  ): Promise<void> {
    if (writes.length === 0) return;
    const ops: Array<AnyBulkWriteOperation<DiscoveryItemDocument>> = writes.map((w) => ({
      updateOne: {
        filter: {
          organizationId,
          jobId,
          source: w.source,
          externalId: w.externalId,
        } as Filter<DiscoveryItemDocument>,
        update: {
          $set: {
            round: w.round,
            outcome: w.outcome,
            billable: w.billable,
            businessId: w.businessId,
            duplicateOfId: w.duplicateOfId,
            error: w.error,
            warnings: w.warnings.slice(0, 10),
            processedAt: now,
            updatedAt: now,
          },
          $inc: { attempts: 1 },
          $setOnInsert: {
            _id: new ObjectId(),
            organizationId,
            jobId,
            source: w.source,
            externalId: w.externalId,
            createdAt: now,
          },
        },
        upsert: true,
      },
    }));
    try {
      await this.collection.bulkWrite(ops, { ordered: false });
    } catch (err) {
      if (
        !isDuplicateKeyError(err) &&
        !(err as { writeErrors?: unknown[] }).writeErrors?.every?.((e) => isDuplicateKeyError(e))
      )
        throw err;
      await this.collection.bulkWrite(ops, { ordered: false });
    }
  }

  async counts(organizationId: string, jobId: ObjectId): Promise<ItemCounts> {
    const rows = await this.collection
      .aggregate<{ _id: DiscoveryItemOutcome; n: number; billable: number }>([
        { $match: this.scoped(organizationId, { jobId } as Filter<DiscoveryItemDocument>) },
        {
          $group: {
            _id: "$outcome",
            n: { $sum: 1 },
            billable: { $sum: { $cond: ["$billable", 1, 0] } },
          },
        },
      ])
      .toArray();
    const by = Object.fromEntries(rows.map((r) => [r._id, r])) as Partial<
      Record<DiscoveryItemOutcome, { n: number; billable: number }>
    >;
    const n = (k: DiscoveryItemOutcome) => by[k]?.n ?? 0;
    return {
      processed: rows.reduce((s, r) => s + r.n, 0),
      created: n("created"),
      updated: n("updated"),
      duplicates: n("duplicate"),
      skipped: n("skipped"),
      failed: n("failed"),
      billable: rows.reduce((s, r) => s + r.billable, 0),
    };
  }

  /** Billable items that reached their outcome in this round: what the round's settlement captures. */
  billableInRound(organizationId: string, jobId: ObjectId, round: number): Promise<number> {
    return this.count(organizationId, {
      jobId,
      round,
      billable: true,
    } as Filter<DiscoveryItemDocument>);
  }

  async failedItems(
    organizationId: string,
    jobId: ObjectId,
    limit: number,
  ): Promise<Array<{ source: DiscoveryItemDocument["source"]; externalId: string }>> {
    const docs = await this.collection
      .find(
        this.scoped(organizationId, { jobId, outcome: "failed" } as Filter<DiscoveryItemDocument>),
        {
          projection: { source: 1, externalId: 1 },
        },
      )
      .sort({ _id: 1 })
      .limit(limit)
      .toArray();
    return docs.map((d) => ({ source: d.source, externalId: d.externalId }));
  }

  async page(
    organizationId: string,
    jobId: ObjectId,
    outcomes: DiscoveryItemOutcome[] | undefined,
    opts: { pageSize: number; cursor?: string | null },
  ): Promise<CursorPage<WithId<DiscoveryItemDocument>>> {
    const filter = {
      jobId,
      ...(outcomes?.length ? { outcome: { $in: outcomes } } : {}),
    } as Filter<DiscoveryItemDocument>;
    return this.findPage(organizationId, filter, { ...opts, direction: 1 });
  }
}
