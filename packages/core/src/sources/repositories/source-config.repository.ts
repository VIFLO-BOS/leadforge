import { Injectable } from "@nestjs/common";
import {
  Collections,
  MongoService,
  OrgScopedRepository,
  type Filter,
  type ObjectId,
  type WithId,
} from "@leadforge/db-mongo";

export interface SourceConfigDocument {
  _id?: ObjectId;
  organizationId: string;
  sourceKey: string;
  enabled: boolean;
  updatedAt: Date;
  updatedByUserId: string | null;
}

/** Per-organization source settings (source_configs). Absent means the default (enabled). */
@Injectable()
export class SourceConfigRepository extends OrgScopedRepository<SourceConfigDocument> {
  constructor(mongo: MongoService) {
    super(mongo, Collections.sourceConfigs);
  }

  async listForOrganization(organizationId: string): Promise<Array<WithId<SourceConfigDocument>>> {
    return this.collection.find(this.scoped(organizationId)).limit(50).toArray();
  }

  async findForSource(
    organizationId: string,
    sourceKey: string,
  ): Promise<WithId<SourceConfigDocument> | null> {
    return this.findOne(organizationId, { sourceKey } as Filter<SourceConfigDocument>);
  }

  async setEnabled(
    organizationId: string,
    sourceKey: string,
    enabled: boolean,
    userId: string,
  ): Promise<WithId<SourceConfigDocument>> {
    const updated = await this.collection.findOneAndUpdate(
      this.scoped(organizationId, { sourceKey } as Filter<SourceConfigDocument>),
      {
        $set: { enabled, updatedAt: new Date(), updatedByUserId: userId },
        $setOnInsert: { organizationId, sourceKey },
      },
      { upsert: true, returnDocument: "after" },
    );
    if (!updated) throw new Error("source config upsert returned nothing");
    return updated;
  }
}
