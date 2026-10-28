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
import type { BusinessDocument, StoredAnalysisSummary, StoredScore } from "../business.types.js";

export interface IdentifierLookup {
  domain: string | null;
  phones: string[];
  emails: string[];
}

export interface FacetRow {
  _id: string | null;
  label: string | null;
  count: number;
}

export interface FacetResult {
  total: Array<{ n: number }>;
  categories: FacetRow[];
  regions: FacetRow[];
  localities: FacetRow[];
  sources: FacetRow[];
  whatsapp: FacetRow[];
}

/**
 * Canonical business profiles. Every method takes organizationId first and adds it to the
 * filter; no method can read or write across organizations.
 */
@Injectable()
export class BusinessRepository extends OrgScopedRepository<BusinessDocument> {
  constructor(mongo: MongoService) {
    super(mongo, Collections.businesses);
  }

  async findLive(
    organizationId: string,
    id: string | ObjectId,
  ): Promise<WithId<BusinessDocument> | null> {
    const doc = await this.findById(organizationId, id);
    return doc && !doc.deletedAt ? doc : null;
  }

  async findLiveByIds(
    organizationId: string,
    ids: ObjectId[],
  ): Promise<Array<WithId<BusinessDocument>>> {
    if (ids.length === 0) return [];
    return this.collection
      .find(
        this.scoped(organizationId, {
          _id: { $in: ids },
          deletedAt: null,
        } as Filter<BusinessDocument>),
      )
      .toArray();
  }

  /** Any records by id, including merged (soft-deleted) ones. */
  async findByIds(
    organizationId: string,
    ids: ObjectId[],
  ): Promise<Array<WithId<BusinessDocument>>> {
    if (ids.length === 0) return [];
    return this.collection
      .find(this.scoped(organizationId, { _id: { $in: ids } } as Filter<BusinessDocument>))
      .toArray();
  }

  async insert(organizationId: string, doc: BusinessDocument): Promise<void> {
    if (doc.organizationId !== organizationId) throw new Error("organizationId mismatch");
    await this.collection.insertOne(doc as WithId<BusinessDocument>);
  }

  /** Optimistic write: succeeds only if nobody changed the document since it was read. */
  async replaceIfVersion(
    organizationId: string,
    doc: BusinessDocument,
    expectedVersion: number,
  ): Promise<boolean> {
    if (doc.organizationId !== organizationId) throw new Error("organizationId mismatch");
    const res = await this.collection.replaceOne(
      this.scoped(organizationId, {
        _id: doc._id,
        version: expectedVersion,
      } as Filter<BusinessDocument>),
      { ...doc, version: expectedVersion + 1 },
    );
    return res.matchedCount === 1;
  }

  async page(
    organizationId: string,
    filter: Document,
    opts: { pageSize: number; cursor?: string | null; sortField: string; direction: 1 | -1 },
  ): Promise<CursorPage<WithId<BusinessDocument>>> {
    return this.findPage(organizationId, filter as Filter<BusinessDocument>, opts);
  }

  /**
   * Counts matching businesses (up to `limit`). Text searches pass the search-token index as a
   * hint: the planner otherwise may count a multi-word search by walking another index over
   * every business (measured at 100k: 1.2 s unhinted, 53 ms hinted).
   */
  async countMatching(
    organizationId: string,
    filter: Document,
    limit?: number,
    options: { searchHint?: boolean } = {},
  ): Promise<number> {
    if (!options.searchHint)
      return this.count(organizationId, filter as Filter<BusinessDocument>, limit);
    return this.collection.countDocuments(
      this.scoped(organizationId, filter as Filter<BusinessDocument>),
      {
        ...(limit ? { limit } : {}),
        hint: { organizationId: 1, "search.tokens": 1 },
      },
    );
  }

  async findMatching(
    organizationId: string,
    filter: Document,
    sort: { field: string; direction: 1 | -1 },
    limit: number,
  ): Promise<Array<WithId<BusinessDocument>>> {
    return this.collection
      .find(this.scoped(organizationId, filter as Filter<BusinessDocument>))
      .sort({ [sort.field]: sort.direction, _id: sort.direction })
      .limit(limit)
      .toArray();
  }

  /** Exact-identifier candidates for ingest dedup (domain, phone, email), live records only. */
  async findByIdentifiers(
    organizationId: string,
    lookup: IdentifierLookup,
    limit = 25,
  ): Promise<Array<WithId<BusinessDocument>>> {
    const or: Document[] = [];
    if (lookup.domain) or.push({ "website.domain": lookup.domain });
    if (lookup.phones.length) or.push({ "phones.e164": { $in: lookup.phones } });
    if (lookup.emails.length) or.push({ "emails.address": { $in: lookup.emails } });
    if (or.length === 0) return [];
    return this.collection
      .find(this.scoped(organizationId, { $or: or, deletedAt: null } as Filter<BusinessDocument>))
      .limit(limit)
      .toArray();
  }

  /**
   * Businesses linked to any of these source records (Google place IDs, Overture GERS ids), or
   * carrying any of these match keys (other keys of the same real place), live records only.
   */
  async findByExternalRefs(
    organizationId: string,
    source: string,
    externalIds: string[],
    matchKeys: string[] = [],
  ): Promise<Array<WithId<BusinessDocument>>> {
    if (externalIds.length === 0 && matchKeys.length === 0) return [];
    const or: Document[] = [];
    if (externalIds.length > 0)
      or.push({
        externalRefs: { $elemMatch: { source, externalId: { $in: [...new Set(externalIds)] } } },
      });
    if (matchKeys.length > 0)
      or.push({ "externalRefs.matchKeys": { $in: [...new Set(matchKeys)] } });
    return this.collection
      .find(this.scoped(organizationId, { $or: or, deletedAt: null } as Filter<BusinessDocument>))
      .limit((externalIds.length + matchKeys.length) * 2 + 10)
      .toArray();
  }

  /** Match keys of one source's links to live businesses, or null when there are more than `limit`. */
  async linkedMatchKeys(
    organizationId: string,
    source: string,
    limit: number,
  ): Promise<string[] | null> {
    const rows = await this.collection
      .aggregate<{ _id: string }>([
        {
          $match: this.scoped(organizationId, {
            "externalRefs.source": source,
            deletedAt: null,
          } as Filter<BusinessDocument>),
        },
        { $project: { externalRefs: 1 } },
        { $unwind: "$externalRefs" },
        { $match: { "externalRefs.source": source } },
        { $unwind: "$externalRefs.matchKeys" },
        { $group: { _id: "$externalRefs.matchKeys" } },
        { $limit: limit + 1 },
      ])
      .toArray();
    return rows.length > limit ? null : rows.map((r) => r._id);
  }

  /** Ids matching a filter in ascending _id order (bulk selections), at most `limit`. */
  async findIds(organizationId: string, filter: Document, limit: number): Promise<ObjectId[]> {
    const rows = await this.collection
      .find(this.scoped(organizationId, filter as Filter<BusinessDocument>), {
        projection: { _id: 1 },
      })
      .sort({ _id: 1 })
      .limit(limit)
      .toArray();
    return rows.map((r) => r._id);
  }

  /** Keyset page in ascending _id order after `afterId` (export builds). */
  async findAfterId(
    organizationId: string,
    filter: Document,
    afterId: ObjectId | null,
    limit: number,
  ): Promise<Array<WithId<BusinessDocument>>> {
    const scoped = afterId ? { $and: [filter, { _id: { $gt: afterId } }] } : filter;
    return this.collection
      .find(this.scoped(organizationId, scoped as Filter<BusinessDocument>))
      .sort({ _id: 1 })
      .limit(limit)
      .toArray();
  }

  /** Name and field-state material for item lists (discovery results). */
  async findSummaries(
    organizationId: string,
    ids: ObjectId[],
  ): Promise<Array<WithId<BusinessDocument>>> {
    if (ids.length === 0) return [];
    return this.collection
      .find(this.scoped(organizationId, { _id: { $in: ids } } as Filter<BusinessDocument>), {
        projection: { name: 1, organizationId: 1 },
      })
      .toArray();
  }

  /**
   * Maintenance only (retention purge): businesses in any organization with a value whose
   * retention has passed. Returns ids with their organization; every later read and write
   * goes through the organization-scoped methods.
   */
  async findDueForRetentionPurge(
    now: Date,
    limit: number,
  ): Promise<Array<{ _id: ObjectId; organizationId: string }>> {
    return this.collection
      .find(
        {
          "retention.nextExpiryAt": { $type: "date", $lte: now },
          deletedAt: null,
        } as Filter<BusinessDocument>,
        {
          projection: { _id: 1, organizationId: 1 },
        },
      )
      .limit(limit)
      .toArray();
  }

  /** Batch form of findByIdentifiers for ingest. */
  async findByIdentifiersMany(
    organizationId: string,
    lookup: { domains: string[]; phones: string[]; emails: string[] },
    limit = 5000,
  ): Promise<Array<WithId<BusinessDocument>>> {
    const or: Document[] = [];
    if (lookup.domains.length) or.push({ "website.domain": { $in: lookup.domains } });
    if (lookup.phones.length) or.push({ "phones.e164": { $in: lookup.phones } });
    if (lookup.emails.length) or.push({ "emails.address": { $in: lookup.emails } });
    if (or.length === 0) return [];
    return this.collection
      .find(this.scoped(organizationId, { $or: or, deletedAt: null } as Filter<BusinessDocument>))
      .limit(limit)
      .toArray();
  }

  async existingSlugs(organizationId: string, slugs: string[]): Promise<string[]> {
    if (slugs.length === 0) return [];
    const docs = await this.collection
      .find(
        this.scoped(organizationId, {
          slug: { $in: [...new Set(slugs)] },
        } as Filter<BusinessDocument>),
        {
          projection: { slug: 1 },
        },
      )
      .toArray();
    return docs.map((d) => d.slug);
  }

  /** Unordered insert; returns the documents that failed with their errors. */
  async insertManyUnordered(
    organizationId: string,
    docs: BusinessDocument[],
  ): Promise<Array<{ doc: BusinessDocument; error: unknown }>> {
    if (docs.length === 0) return [];
    if (docs.some((d) => d.organizationId !== organizationId))
      throw new Error("organizationId mismatch");
    try {
      await this.collection.insertMany(docs as Array<WithId<BusinessDocument>>, { ordered: false });
      return [];
    } catch (err) {
      const writeErrors = (err as { writeErrors?: unknown[] }).writeErrors;
      if (!Array.isArray(writeErrors) || writeErrors.length === 0) throw err;
      return writeErrors.map((we) => {
        type RawWriteError = { code?: number; keyPattern?: unknown; errmsg?: string };
        const raw = we as RawWriteError & { index: number; err?: RawWriteError };
        const error = {
          code: raw.err?.code ?? raw.code,
          keyPattern: raw.err?.keyPattern ?? raw.keyPattern,
          errmsg: raw.err?.errmsg ?? raw.errmsg,
        };
        return { doc: docs[raw.index]!, error };
      });
    }
  }

  /** Sets the suppression flag on every live business matching the filter. */
  async setSuppressed(
    organizationId: string,
    filter: Document,
    flags: BusinessDocument["flags"],
  ): Promise<number> {
    const res = await this.collection.updateMany(
      this.scoped(organizationId, { ...filter, deletedAt: null } as Filter<BusinessDocument>),
      { $set: { flags, updatedAt: new Date() }, $inc: { version: 1 } },
    );
    return res.modifiedCount;
  }

  async facets(organizationId: string, limit = 25): Promise<FacetResult> {
    const group = (key: string, label: string) => [
      { $group: { _id: key, label: { $first: label }, count: { $sum: 1 } } },
      { $match: { _id: { $ne: null } } },
      { $sort: { count: -1, _id: 1 } },
      { $limit: limit },
    ];
    const [result] = await this.collection
      .aggregate<FacetResult>([
        {
          $match: this.scoped(organizationId, {
            deletedAt: null,
            "flags.suppressed": false,
          } as Filter<BusinessDocument>),
        },
        {
          $project: {
            categories: 1,
            sources: 1,
            whatsappStatus: 1,
            "location.regionKey": 1,
            "location.region": 1,
            "location.localityKey": 1,
            "location.locality": 1,
          },
        },
        {
          $facet: {
            total: [{ $count: "n" }],
            categories: [
              { $unwind: "$categories" },
              ...group("$categories.key", "$categories.value"),
            ],
            regions: group("$location.regionKey", "$location.region"),
            localities: group("$location.localityKey", "$location.locality"),
            sources: [{ $unwind: "$sources" }, ...group("$sources", "$sources")],
            whatsapp: group("$whatsappStatus", "$whatsappStatus"),
          },
        },
      ])
      .toArray();
    return (
      result ?? {
        total: [],
        categories: [],
        regions: [],
        localities: [],
        sources: [],
        whatsapp: [],
      }
    );
  }

  /** Live, non-suppressed businesses per source; with `since`, only those created since then. */
  async countBySource(
    organizationId: string,
    since: Date | null = null,
  ): Promise<Array<{ _id: string; count: number }>> {
    return this.collection
      .aggregate<{ _id: string; count: number }>([
        {
          $match: this.scoped(organizationId, {
            deletedAt: null,
            "flags.suppressed": false,
            ...(since ? { createdAt: { $gte: since } } : {}),
          } as Filter<BusinessDocument>),
        },
        { $project: { sources: 1 } },
        { $unwind: "$sources" },
        { $group: { _id: "$sources", count: { $sum: 1 } } },
        { $sort: { count: -1, _id: 1 } },
      ])
      .toArray();
  }

  /**
   * Score snapshots are derived data: they are written without bumping `version`, so scoring
   * never makes a concurrent data write retry, and a data write that races a score write carries
   * the older score and enqueues a recompute for the business.
   */
  async setScores(
    organizationId: string,
    entries: Array<{ id: ObjectId; score: StoredScore }>,
  ): Promise<number> {
    if (entries.length === 0) return 0;
    const res = await this.collection.bulkWrite(
      entries.map((e) => ({
        updateOne: {
          filter: this.scoped(organizationId, {
            _id: e.id,
            deletedAt: null,
          } as Filter<BusinessDocument>),
          update: { $set: { score: e.score } },
        },
      })),
      { ordered: false },
    );
    return res.modifiedCount;
  }

  /** Latest completed analysis; only a newer analysis replaces an older one. A data write (version bump). */
  async setLatestAnalysis(
    organizationId: string,
    id: ObjectId,
    summary: StoredAnalysisSummary,
  ): Promise<boolean> {
    const newer: Document[] = [
      { latestAnalysis: null },
      { latestAnalysis: { $exists: false } },
      { "latestAnalysis.analysisId": summary.analysisId },
    ];
    if (summary.analyzedAt)
      newer.push({ "latestAnalysis.analyzedAt": { $lt: summary.analyzedAt } });
    const res = await this.collection.updateOne(
      this.scoped(organizationId, {
        _id: id,
        deletedAt: null,
        $or: newer,
      } as Filter<BusinessDocument>),
      { $set: { latestAnalysis: summary, updatedAt: new Date() }, $inc: { version: 1 } },
    );
    return res.modifiedCount === 1;
  }

  /** Live businesses after `afterId` in _id order (recompute and organization-wide scans). */
  async pageLive(
    organizationId: string,
    afterId: ObjectId | null,
    limit: number,
  ): Promise<Array<WithId<BusinessDocument>>> {
    return this.collection
      .find(
        this.scoped(organizationId, {
          deletedAt: null,
          ...(afterId ? { _id: { $gt: afterId } } : {}),
        } as Filter<BusinessDocument>),
      )
      .sort({ _id: 1 })
      .limit(limit)
      .toArray();
  }

  /** Live businesses sharing any similarity blocking key (dedup stage 4). */
  async findByDedupKeys(
    organizationId: string,
    keys: string[],
    excludeId: ObjectId,
    limit: number,
  ): Promise<Array<WithId<BusinessDocument>>> {
    if (keys.length === 0) return [];
    return this.collection
      .find(
        this.scoped(organizationId, {
          dedupKeys: { $in: keys },
          _id: { $ne: excludeId },
          deletedAt: null,
        } as Filter<BusinessDocument>),
      )
      .limit(limit)
      .toArray();
  }

  /** Candidate count and status for the business (derived; no version bump). Merged records are left alone. */
  async setDedupSummary(
    organizationId: string,
    id: ObjectId,
    candidateCount: number,
  ): Promise<void> {
    await this.collection.updateOne(
      this.scoped(organizationId, {
        _id: id,
        "dedup.status": { $ne: "merged_into" },
      } as Filter<BusinessDocument>),
      {
        $set: {
          "dedup.candidateCount": candidateCount,
          "dedup.status": candidateCount > 0 ? "has_candidates" : "unique",
        },
      },
    );
  }

  /** Backfills blocking keys on records written before they existed (derived; no version bump). */
  async setDedupKeys(organizationId: string, id: ObjectId, keys: string[]): Promise<void> {
    await this.collection.updateOne(
      this.scoped(organizationId, { _id: id } as Filter<BusinessDocument>),
      { $set: { dedupKeys: keys } },
    );
  }

  /** Maintenance only (any organization): live businesses whose score is older than `cutoff`. */
  async findScoresOlderThan(
    cutoff: Date,
    limit: number,
  ): Promise<Array<{ _id: ObjectId; organizationId: string }>> {
    return this.collection
      .find({ "score.computedAt": { $lt: cutoff }, deletedAt: null } as Filter<BusinessDocument>, {
        projection: { _id: 1, organizationId: 1 },
      })
      .limit(limit)
      .toArray();
  }

  /** Query plan for tests and diagnostics (index use). */
  async explainFind(organizationId: string, filter: Document, sort: Document): Promise<Document> {
    return this.collection
      .find(this.scoped(organizationId, filter as Filter<BusinessDocument>))
      .sort(sort)
      .limit(26)
      .explain("queryPlanner");
  }
}
