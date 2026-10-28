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
import type { VerificationEventDocument } from "../provenance.types.js";

@Injectable()
export class VerificationEventRepository extends OrgScopedRepository<VerificationEventDocument> {
  constructor(mongo: MongoService) {
    super(mongo, Collections.verificationEvents);
  }

  /** Inserts; an event with the same id (a retried job) is kept once. */
  async insert(organizationId: string, doc: VerificationEventDocument): Promise<void> {
    if (doc.organizationId !== organizationId) throw new Error("organizationId mismatch");
    try {
      await this.collection.insertOne(doc as WithId<VerificationEventDocument>);
    } catch (err) {
      if (!isDuplicateKeyError(err, "_id")) throw err;
    }
  }

  async pageForBusiness(
    organizationId: string,
    businessId: ObjectId | ObjectId[],
    opts: { pageSize: number; cursor?: string | null },
  ): Promise<CursorPage<WithId<VerificationEventDocument>>> {
    const filter = Array.isArray(businessId)
      ? { businessId: businessId.length === 1 ? businessId[0] : { $in: businessId } }
      : { businessId };
    return this.findPage(organizationId, filter as Filter<VerificationEventDocument>, {
      ...opts,
      sortField: "occurredAt",
      direction: -1,
    });
  }
}
