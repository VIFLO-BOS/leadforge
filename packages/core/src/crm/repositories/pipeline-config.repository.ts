import { Injectable } from "@nestjs/common";
import {
  Collections,
  isDuplicateKeyError,
  MongoService,
  ObjectId,
  OrgScopedRepository,
  type Filter,
  type WithId,
} from "@leadforge/db-mongo";
import type { PipelineConfigDocument, PipelineStageDoc } from "../crm.types.js";

/** One pipeline configuration per organization (unique on organizationId). */
@Injectable()
export class PipelineConfigRepository extends OrgScopedRepository<PipelineConfigDocument> {
  constructor(mongo: MongoService) {
    super(mongo, Collections.pipelineConfigs);
  }

  /** The organization's config, created from `defaults` on first use (concurrent first reads create one). */
  async findOrCreate(
    organizationId: string,
    defaults: PipelineStageDoc[],
  ): Promise<WithId<PipelineConfigDocument>> {
    const existing = await this.findOne(organizationId, {});
    if (existing) return existing;
    const now = new Date();
    try {
      const created = await this.collection.findOneAndUpdate(
        this.scoped(organizationId),
        {
          $setOnInsert: {
            _id: new ObjectId(),
            organizationId,
            version: 1,
            stages: defaults,
            createdAt: now,
            updatedAt: now,
            updatedByUserId: null,
          } as Partial<PipelineConfigDocument>,
        },
        { upsert: true, returnDocument: "after" },
      );
      if (created) return created;
    } catch (err) {
      if (!isDuplicateKeyError(err)) throw err;
    }
    const winner = await this.findOne(organizationId, {});
    if (!winner) throw new Error("Pipeline config could not be created");
    return winner;
  }

  /** Writes the stages only if the version still matches; null when someone changed it first. */
  replaceStages(
    organizationId: string,
    expectedVersion: number,
    stages: PipelineStageDoc[],
    userId: string,
  ): Promise<WithId<PipelineConfigDocument> | null> {
    return this.collection.findOneAndUpdate(
      this.scoped(organizationId, { version: expectedVersion } as Filter<PipelineConfigDocument>),
      { $set: { stages, updatedAt: new Date(), updatedByUserId: userId }, $inc: { version: 1 } },
      { returnDocument: "after" },
    );
  }
}
