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
import type { NotificationType } from "@leadforge/contracts";

export interface NotificationDocument {
  _id: ObjectId;
  organizationId: string;
  userId: string;
  type: NotificationType;
  title: string;
  body: string | null;
  href: string | null;
  readAt: Date | null;
  /** One notification per event: a replayed event finds the existing one. */
  dedupeKey: string | null;
  createdAt: Date;
}

/** In-app notifications, always scoped to the organization and the recipient. */
@Injectable()
export class NotificationRepository extends OrgScopedRepository<NotificationDocument> {
  constructor(mongo: MongoService) {
    super(mongo, Collections.notifications);
  }

  /** Inserts unless a notification with the same dedupe key exists. Returns true when inserted. */
  async insertOnce(organizationId: string, doc: NotificationDocument): Promise<boolean> {
    if (doc.organizationId !== organizationId) throw new Error("organizationId mismatch");
    try {
      await this.collection.insertOne(doc as WithId<NotificationDocument>);
      return true;
    } catch (err) {
      if (isDuplicateKeyError(err)) return false;
      throw err;
    }
  }

  async page(
    organizationId: string,
    userId: string,
    filter: { unread?: boolean | undefined },
    opts: { pageSize: number; cursor?: string | null },
  ): Promise<CursorPage<WithId<NotificationDocument>>> {
    const query: Filter<NotificationDocument> = {
      userId,
      ...(filter.unread ? { readAt: null } : {}),
    };
    return this.findPage(organizationId, query, { ...opts, sortField: "createdAt", direction: -1 });
  }

  countUnread(organizationId: string, userId: string): Promise<number> {
    return this.count(
      organizationId,
      { userId, readAt: null } as Filter<NotificationDocument>,
      1000,
    );
  }

  async markRead(
    organizationId: string,
    userId: string,
    id: ObjectId,
    at: Date,
  ): Promise<WithId<NotificationDocument> | null> {
    const existing = await this.findOne(organizationId, {
      _id: id,
      userId,
    } as Filter<NotificationDocument>);
    if (!existing) return null;
    if (existing.readAt) return existing;
    return this.collection.findOneAndUpdate(
      this.scoped(organizationId, { _id: id, userId } as Filter<NotificationDocument>),
      { $set: { readAt: at } },
      { returnDocument: "after" },
    );
  }

  async markAllRead(organizationId: string, userId: string, at: Date): Promise<number> {
    const res = await this.collection.updateMany(
      this.scoped(organizationId, { userId, readAt: null } as Filter<NotificationDocument>),
      { $set: { readAt: at } },
    );
    return res.modifiedCount;
  }
}
