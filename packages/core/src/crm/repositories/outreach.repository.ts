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
import type { OutreachChannel } from "@leadforge/contracts";
import type { OutreachDocument } from "../crm.types.js";

/** Outreach records: one per business and channel. */
@Injectable()
export class OutreachRepository extends OrgScopedRepository<OutreachDocument> {
  constructor(mongo: MongoService) {
    super(mongo, Collections.outreachRecords);
  }

  /** False when the business already has a record for the channel. */
  async insert(organizationId: string, doc: OutreachDocument): Promise<boolean> {
    if (doc.organizationId !== organizationId) throw new Error("organizationId mismatch");
    try {
      await this.collection.insertOne(doc as WithId<OutreachDocument>);
      return true;
    } catch (err) {
      if (isDuplicateKeyError(err)) return false;
      throw err;
    }
  }

  findFor(
    organizationId: string,
    businessId: ObjectId,
    channel: OutreachChannel,
  ): Promise<WithId<OutreachDocument> | null> {
    return this.findOne(organizationId, { businessId, channel } as Filter<OutreachDocument>);
  }

  updateIfVersion(
    organizationId: string,
    id: ObjectId,
    expectedVersion: number,
    update: { $set?: Partial<OutreachDocument>; $inc?: Partial<Record<"attempts", number>> },
  ): Promise<WithId<OutreachDocument> | null> {
    return this.collection.findOneAndUpdate(
      this.scoped(organizationId, {
        _id: id,
        version: expectedVersion,
      } as Filter<OutreachDocument>),
      {
        ...(update.$set ? { $set: update.$set } : {}),
        $inc: { version: 1, ...(update.$inc ?? {}) },
      } as UpdateFilter<OutreachDocument>,
      { returnDocument: "after" },
    );
  }

  page(
    organizationId: string,
    filter: Document,
    opts: { pageSize: number; cursor?: string | null },
  ): Promise<CursorPage<WithId<OutreachDocument>>> {
    return this.findPage(organizationId, filter as Filter<OutreachDocument>, {
      ...opts,
      sortField: "updatedAt",
      direction: -1,
    });
  }
}
