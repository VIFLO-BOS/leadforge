import { Injectable } from "@nestjs/common";
import { Collections, MongoService, type Collection } from "@leadforge/db-mongo";

export interface AuditEventInput {
  organizationId: string | null;
  actorUserId: string | null;
  actorType: "user" | "system" | "platform_admin";
  action: string;
  resourceType: string;
  resourceId: string | null;
  before?: unknown;
  after?: unknown;
  ip: string | null;
  userAgent: string | null;
  requestId: string | null;
  occurredAt: Date;
}

export interface AuditEventDocument extends AuditEventInput {
  organizationId: string | null;
}

/** Append-only. There is intentionally no update or delete method. */
@Injectable()
export class AuditRepository {
  private readonly collection: Collection<AuditEventDocument>;

  constructor(mongo: MongoService) {
    this.collection = mongo.collection<AuditEventDocument>(Collections.auditEvents);
  }

  async insert(event: AuditEventInput): Promise<void> {
    await this.collection.insertOne(event as AuditEventDocument);
  }

  async listForOrganization(organizationId: string, limit = 50) {
    return this.collection.find({ organizationId }).sort({ occurredAt: -1 }).limit(limit).toArray();
  }

  async listForUser(actorUserId: string, limit = 50) {
    return this.collection.find({ actorUserId }).sort({ occurredAt: -1 }).limit(limit).toArray();
  }
}
