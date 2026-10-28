import { Injectable } from "@nestjs/common";
import {
  Collections,
  isDuplicateKeyError,
  MongoService,
  ObjectId,
  OrgScopedRepository,
  type Filter,
  type UpdateFilter,
  type WithId,
} from "@leadforge/db-mongo";
import {
  DEFAULT_SCORING_WEIGHTS,
  type ScoringRecomputeStatus,
  type ScoringSignal,
} from "@leadforge/contracts";

export interface ScoringProfileDocument {
  _id: ObjectId;
  organizationId: string;
  name: string;
  isDefault: boolean;
  weights: Record<ScoringSignal, number>;
  icp: {
    categories: string[];
    locations: Array<{ country: string | null; region: string | null; locality: string | null }>;
  };
  version: number;
  recompute: {
    status: ScoringRecomputeStatus;
    profileVersion: number | null;
    processed: number;
    total: number | null;
    requestedAt: Date | null;
    startedAt: Date | null;
    finishedAt: Date | null;
    error: string | null;
  };
  updatedByUserId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

@Injectable()
export class ScoringProfileRepository extends OrgScopedRepository<ScoringProfileDocument> {
  constructor(mongo: MongoService) {
    super(mongo, Collections.scoringProfiles);
  }

  /** The organization's default profile, created with the product defaults on first use. */
  async getOrCreateDefault(organizationId: string): Promise<WithId<ScoringProfileDocument>> {
    for (let attempt = 0; attempt < 3; attempt++) {
      const existing = await this.findOne(organizationId, {
        isDefault: true,
      } as Filter<ScoringProfileDocument>);
      if (existing) return existing;
      const now = new Date();
      const doc: ScoringProfileDocument = {
        _id: new ObjectId(),
        organizationId,
        name: "Default",
        isDefault: true,
        weights: { ...DEFAULT_SCORING_WEIGHTS },
        icp: { categories: [], locations: [] },
        version: 1,
        recompute: {
          status: "idle",
          profileVersion: null,
          processed: 0,
          total: null,
          requestedAt: null,
          startedAt: null,
          finishedAt: null,
          error: null,
        },
        updatedByUserId: null,
        createdAt: now,
        updatedAt: now,
      };
      try {
        await this.collection.insertOne(doc as WithId<ScoringProfileDocument>);
        return doc as WithId<ScoringProfileDocument>;
      } catch (err) {
        if (!isDuplicateKeyError(err)) throw err; // a concurrent request created it: read it back
      }
    }
    throw new Error("Could not create the default scoring profile");
  }

  /** Version-checked update; null when the profile changed since `expectedVersion`. */
  async updateIfVersion(
    organizationId: string,
    id: ObjectId,
    expectedVersion: number,
    update: UpdateFilter<ScoringProfileDocument>,
  ): Promise<WithId<ScoringProfileDocument> | null> {
    return this.collection.findOneAndUpdate(
      this.scoped(organizationId, {
        _id: id,
        version: expectedVersion,
      } as Filter<ScoringProfileDocument>),
      update,
      { returnDocument: "after" },
    );
  }

  /** Recompute progress; only for the version being recomputed (a newer request wins). */
  async setRecompute(
    organizationId: string,
    id: ObjectId,
    profileVersion: number,
    set: Partial<ScoringProfileDocument["recompute"]>,
  ): Promise<boolean> {
    const fields = Object.fromEntries(Object.entries(set).map(([k, v]) => [`recompute.${k}`, v]));
    const res = await this.collection.updateOne(
      this.scoped(organizationId, {
        _id: id,
        "recompute.profileVersion": profileVersion,
      } as Filter<ScoringProfileDocument>),
      { $set: fields },
    );
    return res.matchedCount === 1;
  }
}
