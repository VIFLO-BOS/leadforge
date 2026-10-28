import { Injectable } from "@nestjs/common";
import {
  Collections,
  isDuplicateKeyError,
  MongoService,
  type AnyBulkWriteOperation,
  type Collection,
  type Document,
  type Filter,
} from "@leadforge/db-mongo";
import type { WriteConcernSettings } from "@leadforge/db-mongo";
import type { NormalizedPlace } from "../overture-normalize.js";
import type { OverturePlaceDocument, OvertureSyncSummary } from "../overture.types.js";

/** Characters of the content hash compared to detect changed places. */
export const HASH_PREFIX = 16;

/** Fields the duplicate grouping reads for every live place. */
export interface GroupingRow {
  _id: string;
  upstreamKey: string | null;
  socialKeys: string[];
  nameKey: string;
  confidence: number;
  contacts: { score: number };
  rootSource: { dataset: string | null };
  canonicalId: string;
  isCanonical: boolean;
  groupKeys: string[];
  offerable: boolean;
  closed: boolean;
}

/**
 * Overture Maps Places staging catalogue (`overture_places`).
 *
 * Deliberate exception to the organization-scoping rule (docs/DATABASE_DESIGN.md): this is
 * platform-level reference data, the same for every organization, loaded only by the Overture
 * sync. It never holds organization data, and organizations never write to it. Discovery reads it
 * to find places; what an organization keeps is copied into its own `businesses` and
 * `source_observations` through the normal org-scoped ingest. Reads here are therefore not
 * filtered by organizationId, and the collection is listed as exempt in the db-mongo index test.
 */
@Injectable()
export class OverturePlaceRepository {
  private readonly collection: Collection<OverturePlaceDocument>;

  constructor(mongo: MongoService) {
    this.collection = mongo.collection<OverturePlaceDocument>(Collections.overturePlaces);
  }

  /** Content hash and retirement of every stored place (about 160k small rows for Nigeria). */
  async hashIndex(): Promise<Map<string, { contentHash: string; retired: boolean }>> {
    const out = new Map<string, { contentHash: string; retired: boolean }>();
    // A 64-bit prefix of the content hash is plenty to spot changes and halves what crosses the wire.
    const cursor = this.collection.aggregate<{ _id: string; h: string; r: boolean }>(
      [
        {
          $project: {
            h: { $substrCP: ["$contentHash", 0, HASH_PREFIX] },
            r: { $gt: ["$retiredAt", null] },
          },
        },
      ],
      { batchSize: 5000 },
    );
    for await (const d of cursor) out.set(d._id, { contentHash: d.h, retired: d.r });
    return out;
  }

  async bulkWrite(
    ops: Array<AnyBulkWriteOperation<OverturePlaceDocument>>,
    writeConcern?: WriteConcernSettings,
  ): Promise<{ upserted: number; modified: number }> {
    if (ops.length === 0) return { upserted: 0, modified: 0 };
    const res = await this.collection.bulkWrite(ops, {
      ordered: false,
      ...(writeConcern ? { writeConcern } : {}),
    });
    return { upserted: res.upsertedCount, modified: res.modifiedCount };
  }

  /**
   * Inserts new places in one unordered batch (much faster than upserts). Places another writer
   * inserted first come back so the caller can update them instead.
   */
  async insertNew(
    docs: OverturePlaceDocument[],
    writeConcern?: WriteConcernSettings,
  ): Promise<OverturePlaceDocument[]> {
    if (docs.length === 0) return [];
    try {
      await this.collection.insertMany(docs, {
        ordered: false,
        ...(writeConcern ? { writeConcern } : {}),
      });
      return [];
    } catch (err) {
      const writeErrors = (
        err as {
          writeErrors?:
            | Array<{ index: number; code?: number; err?: { index?: number } }>
            | { index: number; code?: number };
        }
      ).writeErrors;
      const list = Array.isArray(writeErrors) ? writeErrors : writeErrors ? [writeErrors] : [];
      if (list.length === 0 || !list.every((e) => e.code === 11000) || !isDuplicateKeyError(err))
        throw err;
      return list.map((e) => docs[e.index]!).filter(Boolean);
    }
  }

  /** Changed places: the normalized payload and release bookkeeping, one unordered batch. */
  async updateChanged(
    items: Array<{ place: NormalizedPlace; set: Partial<OverturePlaceDocument> }>,
    writeConcern?: WriteConcernSettings,
  ): Promise<void> {
    if (items.length === 0) return;
    await this.collection.bulkWrite(
      items.map(({ place, set }) => {
        const { _id, ...fields } = place;
        return {
          updateOne: {
            filter: { _id } as Filter<OverturePlaceDocument>,
            update: { $set: { ...fields, ...set } },
          },
        };
      }),
      { ordered: false, ...(writeConcern ? { writeConcern } : {}) },
    );
  }

  /** Puts places that are alone in their duplicate group back to their own defaults (pipeline update, no per-row round trip). */
  async resetSingletons(ids: string[], writeConcern?: WriteConcernSettings): Promise<void> {
    if (ids.length === 0) return;
    await this.collection.updateMany(
      { _id: { $in: ids } } as Filter<OverturePlaceDocument>,
      [
        {
          $set: {
            canonicalId: "$_id",
            isCanonical: true,
            offerable: { $not: ["$closed"] },
            groupKeys: {
              $sortArray: {
                input: {
                  $concatArrays: [
                    [{ $concat: ["gers:", "$_id"] }],
                    {
                      $cond: [{ $eq: [{ $type: "$upstreamKey" }, "string"] }, ["$upstreamKey"], []],
                    },
                  ],
                },
                sortBy: 1,
              },
            },
          },
        },
      ],
      writeConcern ? { writeConcern } : {},
    );
  }

  /** Places a release no longer contains: kept, marked retired, and no longer offered. */
  async retire(ids: string[], release: string, now: Date): Promise<number> {
    if (ids.length === 0) return 0;
    const res = await this.collection.updateMany(
      { _id: { $in: ids }, retiredAt: null } as Filter<OverturePlaceDocument>,
      {
        $set: {
          retiredAt: now,
          retiredInRelease: release,
          offerable: false,
          isCanonical: false,
          updatedAt: now,
        },
      },
    );
    return res.modifiedCount;
  }

  /**
   * Live places that share an upstream record, or a numeric Facebook page (at most 50 places on one
   * page; more is a platform page, not a duplicate), with another live place. Computed server-side.
   */
  async sharedKeyCandidates(): Promise<string[]> {
    const shared = (field: "upstreamKey" | "socialKeys") => [
      {
        $match: {
          retiredAt: null,
          [field]: field === "upstreamKey" ? { $type: "string" } : { $exists: true, $ne: [] },
        },
      },
      ...(field === "socialKeys" ? [{ $unwind: "$socialKeys" }] : []),
      { $group: { _id: "$" + field, ids: { $push: "$_id" }, n: { $sum: 1 } } },
      { $match: { n: { $gt: 1, $lte: 50 } } },
      { $unwind: "$ids" },
      { $group: { _id: null, ids: { $addToSet: "$ids" } } },
    ];
    const [up, social] = await Promise.all([
      this.collection
        .aggregate<{ ids: string[] }>(shared("upstreamKey"), { allowDiskUse: true })
        .toArray(),
      this.collection
        .aggregate<{ ids: string[] }>(shared("socialKeys"), { allowDiskUse: true })
        .toArray(),
    ]);
    return [...new Set([...(up[0]?.ids ?? []), ...(social[0]?.ids ?? [])])];
  }

  /** Grouping fields of these live places. */
  async groupingRowsFor(ids: string[]): Promise<GroupingRow[]> {
    const out: GroupingRow[] = [];
    for (let i = 0; i < ids.length; i += 5000) {
      out.push(...(await this.groupingRows({ _id: { $in: ids.slice(i, i + 5000) } })));
    }
    return out;
  }

  /**
   * Live places outside `exclude` whose stored group fields are not those of a place alone in its
   * group (for example one whose duplicate was retired). Computed server-side.
   */
  async singletonMismatches(exclude: string[]): Promise<string[]> {
    const docs = await this.collection
      .find(
        {
          retiredAt: null,
          ...(exclude.length > 0 ? { _id: { $nin: exclude } } : {}),
          $expr: {
            $or: [
              { $ne: ["$canonicalId", "$_id"] },
              { $ne: ["$isCanonical", true] },
              { $ne: ["$offerable", { $not: ["$closed"] }] },
              {
                $ne: [
                  { $size: { $ifNull: ["$groupKeys", []] } },
                  { $cond: [{ $eq: [{ $type: "$upstreamKey" }, "string"] }, 2, 1] },
                ],
              },
            ],
          },
        } as Filter<OverturePlaceDocument>,
        { projection: { _id: 1 } },
      )
      .toArray();
    return docs.map((d) => d._id);
  }

  /** Every live (not retired) place matching `filter`, projected for duplicate grouping. */
  async groupingRows(filter: Document = {}): Promise<GroupingRow[]> {
    return (await this.collection
      .find({ ...filter, retiredAt: null } as Filter<OverturePlaceDocument>, {
        projection: {
          _id: 1,
          upstreamKey: 1,
          socialKeys: 1,
          nameKey: 1,
          confidence: 1,
          "contacts.score": 1,
          "rootSource.dataset": 1,
          canonicalId: 1,
          isCanonical: 1,
          groupKeys: 1,
          offerable: 1,
          closed: 1,
        },
        batchSize: 5000,
      })
      .toArray()) as unknown as GroupingRow[];
  }

  async countLive(): Promise<number> {
    return this.collection.countDocuments({ retiredAt: null } as Filter<OverturePlaceDocument>);
  }

  async countOfferable(): Promise<number> {
    return this.collection.countDocuments({ offerable: true } as Filter<OverturePlaceDocument>);
  }

  async count(filter: Document, limit?: number): Promise<number> {
    return this.collection.countDocuments(
      filter as Filter<OverturePlaceDocument>,
      limit ? { limit } : {},
    );
  }

  /** Discovery page: places matching the filter in (confidence desc, contact score desc, id asc) order. */
  async findOrdered(filter: Document, limit: number): Promise<OverturePlaceDocument[]> {
    return this.collection
      .find(filter as Filter<OverturePlaceDocument>)
      .sort({ confidence: -1, "contacts.score": -1, _id: 1 })
      .limit(limit)
      .toArray() as Promise<OverturePlaceDocument[]>;
  }

  async findByIds(ids: string[]): Promise<OverturePlaceDocument[]> {
    if (ids.length === 0) return [];
    return this.collection
      .find({ _id: { $in: ids } } as Filter<OverturePlaceDocument>)
      .toArray() as Promise<OverturePlaceDocument[]>;
  }

  /** Retirement state of these places (business detail shows linked records the source dropped). */
  async retirementOf(ids: string[]): Promise<Map<string, { retired: boolean; release: string }>> {
    if (ids.length === 0) return new Map();
    const docs = await this.collection
      .find({ _id: { $in: ids } } as Filter<OverturePlaceDocument>, {
        projection: { _id: 1, retiredAt: 1, release: 1 },
      })
      .toArray();
    return new Map(docs.map((d) => [d._id, { retired: Boolean(d.retiredAt), release: d.release }]));
  }

  /** Offerable places per state and LGA, and per taxonomy node (wizard catalogues). */
  async summary(): Promise<OvertureSyncSummary> {
    const offerable = { offerable: true, "contacts.any": true, confidence: { $gte: 0.5 } };
    const [byLga, byNode] = await Promise.all([
      this.collection
        .aggregate<{
          _id: {
            stateKey: string | null;
            stateName: string | null;
            stateCode: string | null;
            lgaKey: string | null;
            lgaName: string | null;
          };
          n: number;
        }>([
          { $match: offerable },
          {
            $group: {
              _id: {
                stateKey: "$admin.stateKey",
                stateName: "$admin.stateName",
                stateCode: "$admin.stateCode",
                lgaKey: "$admin.lgaKey",
                lgaName: "$admin.lgaName",
              },
              n: { $sum: 1 },
            },
          },
        ])
        .toArray(),
      this.collection
        .aggregate<{ _id: string; n: number }>([
          { $match: offerable },
          { $unwind: "$categoryNodes" },
          { $group: { _id: "$categoryNodes", n: { $sum: 1 } } },
          { $sort: { n: -1, _id: 1 } },
        ])
        .toArray(),
    ]);
    const states = new Map<string, OvertureSyncSummary["states"][number]>();
    for (const row of byLga) {
      if (!row._id.stateKey || !row._id.stateName) continue;
      const state = states.get(row._id.stateKey) ?? {
        key: row._id.stateKey,
        name: row._id.stateName,
        code: row._id.stateCode,
        places: 0,
        lgas: [],
      };
      state.places += row.n;
      if (row._id.lgaKey && row._id.lgaName)
        state.lgas.push({ key: row._id.lgaKey, name: row._id.lgaName, places: row.n });
      states.set(row._id.stateKey, state);
    }
    const sorted = [...states.values()].sort((a, b) => a.name.localeCompare(b.name));
    for (const s of sorted) s.lgas.sort((a, b) => a.name.localeCompare(b.name));
    return { states: sorted, categories: byNode.map((r) => ({ node: r._id, places: r.n })) };
  }

  /** Explain plan for a discovery filter (index tests). */
  async explain(filter: Document): Promise<Document> {
    return this.collection
      .find(filter as Filter<OverturePlaceDocument>)
      .sort({ confidence: -1, "contacts.score": -1, _id: 1 })
      .limit(100)
      .explain("queryPlanner");
  }
}
