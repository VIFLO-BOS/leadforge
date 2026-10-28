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

  /**
   * Events of one action per UTC day in [from, to), with `sumField` summed (usage rollup:
   * synchronous exports and their rows). Range scan on `{ organizationId, occurredAt }`.
   */
  async perDay(
    organizationId: string,
    action: string,
    from: Date,
    to: Date,
    sumField?: string,
  ): Promise<Array<{ day: string; count: number; sum: number }>> {
    if (!organizationId) throw new Error("organizationId is required");
    const rows = await this.collection
      .aggregate<{ _id: string; count: number; sum: number }>([
        { $match: { organizationId, occurredAt: { $gte: from, $lt: to }, action } },
        {
          $group: {
            _id: { $dateToString: { format: "%Y-%m-%d", date: "$occurredAt", timezone: "UTC" } },
            count: { $sum: 1 },
            sum: { $sum: sumField ? { $ifNull: [`$${sumField}`, 0] } : 0 },
          },
        },
      ])
      .toArray();
    return rows.map((r) => ({ day: r._id, count: r.count, sum: Number(r.sum) }));
  }

  async listForUser(actorUserId: string, limit = 50) {
    return this.collection.find({ actorUserId }).sort({ occurredAt: -1 }).limit(limit).toArray();
  }
}
