import { Injectable } from "@nestjs/common";
import {
  Collections,
  MongoService,
  ObjectId,
  type Collection,
  type Document,
  type Filter,
  type WithId,
} from "@leadforge/db-mongo";
import type { SuppressionScope } from "@leadforge/contracts";

export interface SuppressionEntryDocument {
  _id: ObjectId;
  /** null for the platform-wide do-not-collect list maintained by operators. */
  organizationId: string | null;
  kind: SuppressionScope;
  value: string;
  reason: string;
  sourceBusinessId?: ObjectId;
  createdByUserId: string | null;
  createdAt: Date;
}

export interface SuppressionLookup {
  businessId?: ObjectId | null;
  domain?: string | null;
  phones?: string[];
  emails?: string[];
}

/**
 * Suppression entries. Reads include the platform-wide list (organizationId null) alongside
 * the organization's own entries; writes and deletes touch only the organization's entries.
 */
@Injectable()
export class SuppressionRepository {
  private readonly collection: Collection<SuppressionEntryDocument>;

  constructor(mongo: MongoService) {
    this.collection = mongo.collection<SuppressionEntryDocument>(Collections.suppressionEntries);
  }

  private matchClause(lookup: SuppressionLookup): Document[] {
    const or: Document[] = [];
    if (lookup.businessId) or.push({ kind: "business", value: lookup.businessId.toHexString() });
    if (lookup.domain) or.push({ kind: "domain", value: lookup.domain });
    if (lookup.phones?.length) or.push({ kind: "phone", value: { $in: lookup.phones } });
    if (lookup.emails?.length) or.push({ kind: "email", value: { $in: lookup.emails } });
    return or;
  }

  async findMatching(
    organizationId: string,
    lookup: SuppressionLookup,
  ): Promise<Array<WithId<SuppressionEntryDocument>>> {
    if (!organizationId) throw new Error("organizationId is required");
    const or = this.matchClause(lookup);
    if (or.length === 0) return [];
    return this.collection
      .find({
        organizationId: { $in: [organizationId, null] },
        $or: or,
      } as Filter<SuppressionEntryDocument>)
      .sort({ createdAt: -1 })
      .limit(50)
      .toArray();
  }

  /** Batch lookup for ingest: any entry matching any of the identifiers. */
  async findMatchingMany(
    organizationId: string,
    lookup: { domains: string[]; phones: string[]; emails: string[] },
  ): Promise<Array<WithId<SuppressionEntryDocument>>> {
    if (!organizationId) throw new Error("organizationId is required");
    const or: Document[] = [];
    if (lookup.domains.length) or.push({ kind: "domain", value: { $in: lookup.domains } });
    if (lookup.phones.length) or.push({ kind: "phone", value: { $in: lookup.phones } });
    if (lookup.emails.length) or.push({ kind: "email", value: { $in: lookup.emails } });
    if (or.length === 0) return [];
    return this.collection
      .find({
        organizationId: { $in: [organizationId, null] },
        $or: or,
      } as Filter<SuppressionEntryDocument>)
      .toArray();
  }

  /** Inserts the entry or returns the existing one with the same kind and value. */
  async upsert(
    organizationId: string,
    entry: Omit<SuppressionEntryDocument, "_id" | "organizationId" | "createdAt">,
  ): Promise<WithId<SuppressionEntryDocument>> {
    if (!organizationId) throw new Error("organizationId is required");
    const res = await this.collection.findOneAndUpdate(
      { organizationId, kind: entry.kind, value: entry.value },
      { $setOnInsert: { ...entry, organizationId, createdAt: new Date() } },
      { upsert: true, returnDocument: "after" },
    );
    if (!res) throw new Error("Suppression upsert returned nothing");
    return res;
  }

  async listCreatedFromBusiness(
    organizationId: string,
    businessId: ObjectId,
  ): Promise<Array<WithId<SuppressionEntryDocument>>> {
    if (!organizationId) throw new Error("organizationId is required");
    return this.collection.find({ organizationId, sourceBusinessId: businessId }).toArray();
  }

  async deleteByIds(organizationId: string, ids: ObjectId[]): Promise<number> {
    if (!organizationId) throw new Error("organizationId is required");
    if (ids.length === 0) return 0;
    const res = await this.collection.deleteMany({ organizationId, _id: { $in: ids } });
    return res.deletedCount;
  }
}
