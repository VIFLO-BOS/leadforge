import type { Collection, Document, Filter, FindOptions, Sort, WithId } from "mongodb";
import { ObjectId } from "mongodb";
import type { MongoService } from "./mongo.service.js";

export interface OrgScopedDocument extends Document {
  organizationId: string;
}

export interface CursorPage<T> {
  items: T[];
  nextCursor: string | null;
}

/**
 * Base repository that forces organization scoping on every read and write.
 * Subclasses must never expose a method that omits organizationId.
 */
export abstract class OrgScopedRepository<T extends OrgScopedDocument> {
  protected readonly collection: Collection<T>;

  protected constructor(mongo: MongoService, collectionName: string) {
    this.collection = mongo.collection<T>(collectionName);
  }

  protected scoped(organizationId: string, filter: Filter<T> = {}): Filter<T> {
    if (!organizationId) throw new Error("organizationId is required");
    return { ...filter, organizationId } as Filter<T>;
  }

  async findById(organizationId: string, id: string | ObjectId): Promise<WithId<T> | null> {
    const _id = typeof id === "string" ? (ObjectId.isValid(id) ? new ObjectId(id) : null) : id;
    if (!_id) return null;
    return this.collection.findOne(this.scoped(organizationId, { _id } as Filter<T>));
  }

  async findOne(
    organizationId: string,
    filter: Filter<T>,
    options?: FindOptions,
  ): Promise<WithId<T> | null> {
    return this.collection.findOne(this.scoped(organizationId, filter), options);
  }

  async count(organizationId: string, filter: Filter<T> = {}): Promise<number> {
    return this.collection.countDocuments(this.scoped(organizationId, filter));
  }

  /**
   * Cursor pagination over a sort of [sortField desc/asc, _id desc]. The cursor encodes
   * the last seen sort value and _id so pages are stable under concurrent writes.
   */
  async findPage(
    organizationId: string,
    filter: Filter<T>,
    opts: { pageSize: number; cursor?: string | null; sortField?: string; direction?: 1 | -1 },
  ): Promise<CursorPage<WithId<T>>> {
    const sortField = opts.sortField ?? "_id";
    const direction = opts.direction ?? -1;
    const cmp = direction === -1 ? "$lt" : "$gt";

    let pageFilter: Filter<T> = this.scoped(organizationId, filter);
    if (opts.cursor) {
      const decoded = decodeCursor(opts.cursor);
      if (decoded) {
        const [sortValue, idHex] = decoded;
        const id = new ObjectId(idHex);
        const value = reviveSortValue(sortValue);
        const cursorClause =
          sortField === "_id"
            ? ({ _id: { [cmp]: id } } as Filter<T>)
            : ({
                $or: [
                  { [sortField]: { [cmp]: value } },
                  { [sortField]: value, _id: { [cmp]: id } },
                ],
              } as Filter<T>);
        pageFilter = { $and: [pageFilter, cursorClause] } as Filter<T>;
      }
    }

    const sort: Sort =
      sortField === "_id" ? { _id: direction } : { [sortField]: direction, _id: direction };
    const docs = await this.collection
      .find(pageFilter)
      .sort(sort)
      .limit(opts.pageSize + 1)
      .toArray();

    const hasMore = docs.length > opts.pageSize;
    const items = hasMore ? docs.slice(0, opts.pageSize) : docs;
    const last = items[items.length - 1];
    const nextCursor =
      hasMore && last
        ? encodeCursor(
            sortField === "_id" ? null : (last as Document)[sortField],
            last._id as ObjectId,
          )
        : null;
    return { items, nextCursor };
  }
}

export function encodeCursor(sortValue: unknown, id: ObjectId): string {
  const payload = JSON.stringify([serializeSortValue(sortValue), id.toHexString()]);
  return Buffer.from(payload, "utf8").toString("base64url");
}

export function decodeCursor(cursor: string): [unknown, string] | null {
  try {
    const parsed = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as unknown;
    if (!Array.isArray(parsed) || parsed.length !== 2) return null;
    const [value, id] = parsed as [unknown, unknown];
    if (typeof id !== "string" || !ObjectId.isValid(id)) return null;
    return [value, id];
  } catch {
    return null;
  }
}

function serializeSortValue(value: unknown): unknown {
  if (value instanceof Date) return { $date: value.toISOString() };
  return value ?? null;
}

function reviveSortValue(value: unknown): unknown {
  if (value && typeof value === "object" && "$date" in (value as Record<string, unknown>)) {
    return new Date(String((value as Record<string, unknown>).$date));
  }
  return value;
}
