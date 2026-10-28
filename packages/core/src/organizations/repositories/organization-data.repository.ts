import { Injectable } from "@nestjs/common";
import {
  Collections,
  MongoService,
  ObjectId,
  organizationPurgePlan,
  type Document,
  type OrganizationPurgePlan,
} from "@leadforge/db-mongo";

/** Job-like collections and the statuses in which their work can still run or start. */
const ACTIVE_WORK: ReadonlyArray<{
  collection: string;
  active: string[];
  stopped: string;
  activeFlag?: boolean;
}> = [
  {
    collection: Collections.discoveryJobs,
    active: ["draft", "queued", "running"],
    stopped: "cancelled",
  },
  {
    collection: Collections.importJobs,
    active: ["uploaded", "queued", "processing"],
    stopped: "failed",
  },
  {
    collection: Collections.enrichmentRuns,
    active: ["queued", "running"],
    stopped: "failed",
    activeFlag: true,
  },
  {
    collection: Collections.websiteAnalyses,
    active: ["queued", "running"],
    stopped: "failed",
    activeFlag: true,
  },
  { collection: Collections.bulkOperations, active: ["queued", "running"], stopped: "failed" },
  { collection: Collections.exportJobs, active: ["queued", "running"], stopped: "failed" },
  {
    collection: Collections.organizationDataExports,
    active: ["queued", "running"],
    stopped: "failed",
    activeFlag: true,
  },
];

/**
 * Stage 10: whole-organization MongoDB access for the organization purge and the organization data
 * export. Every method takes the organization id and filters on that exact value (never null), so
 * global documents (platform suppression entries and source switches with `organizationId: null`,
 * the Overture catalogue without the field) are never read or touched.
 */
@Injectable()
export class OrganizationDataRepository {
  constructor(private readonly mongo: MongoService) {}

  private static scope(organizationId: string): Document {
    if (!organizationId) throw new Error("organizationId is required");
    return { organizationId };
  }

  /** The purge plan from the schema registry (see @leadforge/db-mongo organizationPurgePlan). */
  plan(): OrganizationPurgePlan {
    return organizationPurgePlan();
  }

  /** Marks the organization's unfinished jobs as stopped, so a worker that is mid-job stops at its next check. */
  async stopActiveWork(organizationId: string, now: Date): Promise<Record<string, number>> {
    const out: Record<string, number> = {};
    for (const w of ACTIVE_WORK) {
      const set: Document = { status: w.stopped, updatedAt: now };
      if (w.activeFlag) set.active = false;
      const res = await this.mongo
        .collection(w.collection)
        .updateMany(
          { ...OrganizationDataRepository.scope(organizationId), status: { $in: w.active } },
          { $set: set },
        );
      if (res.modifiedCount) out[w.collection] = res.modifiedCount;
    }
    return out;
  }

  /** Object-storage keys of the organization's export files (async exports and organization data exports). */
  async exportFileKeys(organizationId: string): Promise<string[]> {
    const keys = new Set<string>();
    for (const name of [Collections.exportJobs, Collections.organizationDataExports]) {
      const docs = await this.mongo
        .collection(name)
        .find(
          { ...OrganizationDataRepository.scope(organizationId), "file.key": { $type: "string" } },
          { projection: { "file.key": 1 } },
        )
        .toArray();
      for (const d of docs) {
        const key = (d.file as { key?: unknown } | undefined)?.key;
        if (typeof key === "string") keys.add(key);
      }
    }
    return [...keys].sort();
  }

  /** Deletes the organization's documents from each collection; returns the count per collection. */
  async deleteOrganizationDocuments(
    organizationId: string,
    collections: readonly string[],
  ): Promise<Record<string, number>> {
    const out: Record<string, number> = {};
    for (const name of collections) {
      const res = await this.mongo
        .collection(name)
        .deleteMany(OrganizationDataRepository.scope(organizationId));
      out[name] = res.deletedCount;
    }
    return out;
  }

  /** Documents of the organization in any collection of the database (purge tests and the runbook check). */
  async countEverywhere(organizationId: string): Promise<Record<string, number>> {
    const names = (await this.mongo.database.listCollections({}, { nameOnly: true }).toArray())
      .map((c) => c.name)
      .sort();
    const out: Record<string, number> = {};
    for (const name of names) {
      const n = await this.mongo
        .collection(name)
        .countDocuments(OrganizationDataRepository.scope(organizationId));
      if (n) out[name] = n;
    }
    return out;
  }

  /**
   * The organization's documents of one collection in `_id` order, in batches (organization data
   * export). `filter` narrows further (for example live businesses only).
   */
  async *iterate(
    collection: string,
    organizationId: string,
    options: { batchSize?: number; filter?: Document; projection?: Document } = {},
  ): AsyncGenerator<Document[]> {
    const batchSize = options.batchSize ?? 500;
    let after: ObjectId | null = null;
    for (;;) {
      const filter: Document = {
        ...(options.filter ?? {}),
        ...OrganizationDataRepository.scope(organizationId),
      };
      if (after) filter._id = { $gt: after };
      const docs: Document[] = await this.mongo
        .collection(collection)
        .find(filter, options.projection ? { projection: options.projection } : {})
        .sort({ _id: 1 })
        .limit(batchSize)
        .toArray();
      if (docs.length === 0) return;
      yield docs;
      if (docs.length < batchSize) return;
      after = docs[docs.length - 1]!._id as ObjectId;
    }
  }
}
