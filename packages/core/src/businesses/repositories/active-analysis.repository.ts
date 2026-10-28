import { Injectable } from "@nestjs/common";
import { Collections, MongoService, type Collection, type ObjectId } from "@leadforge/db-mongo";

interface ActiveAnalysisDoc {
  _id: ObjectId;
  organizationId: string;
  businessId: ObjectId;
  status: "queued" | "running" | "completed" | "failed";
  active?: boolean;
  createdAt: Date;
}

/**
 * Read-only view of `website_analyses` for business detail: the queued or running analysis of a
 * business (one at most, by the partial unique index on organizationId + businessId where active).
 * The website-analysis module owns the collection; this avoids a module cycle.
 */
@Injectable()
export class ActiveAnalysisRepository {
  private readonly collection: Collection<ActiveAnalysisDoc>;

  constructor(mongo: MongoService) {
    this.collection = mongo.collection<ActiveAnalysisDoc>(Collections.websiteAnalyses);
  }

  findActive(organizationId: string, businessId: ObjectId): Promise<ActiveAnalysisDoc | null> {
    return this.collection.findOne(
      { organizationId, businessId, active: true },
      { projection: { _id: 1, status: 1, createdAt: 1, organizationId: 1, businessId: 1 } },
    );
  }
}
