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

export interface PageOptions {
  pageSize: number;
  cursor?: string | null;
  /** Dotted path of the sort field; `_id` when omitted. */
  sortField?: string;
  /** -1 (default) for descending, 1 for ascending. Ties always break on `_id` in the same direction. */
  direction?: 1 | -1;
  projection?: Document;
}

/** Thrown when a cursor is malformed or was issued for a different sort. */
export class InvalidCursorError extends Error {
  constructor() {
    super("Invalid or expired cursor");
    this.name = "InvalidCursorError";
  }
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
    const _id = toObjectId(id);
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

  async count(organizationId: string, filter: Filter<T> = {}, limit?: number): Promise<number> {
    return this.collection.countDocuments(
      this.scoped(organizationId, filter),
      limit ? { limit } : {},
    );
  }

  /**
   * Cursor pagination over `[sortField, _id]` in one direction. The cursor encodes the last
   * row's sort value, its `_id` and the sort it was issued for, so pages are stable under
   * concurrent writes and ties never repeat or skip rows. Null sort values are handled the way
   * MongoDB orders them: nulls sort before every other value ascending and after them
   * descending.
   */
  async findPage(
    organizationId: string,
    filter: Filter<T>,
    opts: PageOptions,
  ): Promise<CursorPage<WithId<T>>> {
    const sortField = opts.sortField ?? "_id";
    const direction = opts.direction ?? -1;
    const tag = cursorTag(sortField, direction);

    let pageFilter: Filter<T> = this.scoped(organizationId, filter);
    if (opts.cursor) {
      const decoded = decodeCursor(opts.cursor);
      if (!decoded || (decoded[2] ?? cursorTag("_id", -1)) !== tag) throw new InvalidCursorError();
      const [rawValue, idHex] = decoded;
      const clause = afterClause(
        sortField,
        direction,
        reviveSortValue(rawValue),
        new ObjectId(idHex),
      );
      pageFilter = { $and: [pageFilter, clause] } as Filter<T>;
    }

    const sort: Sort =
      sortField === "_id" ? { _id: direction } : { [sortField]: direction, _id: direction };
    const docs = await this.collection
      .find(pageFilter, opts.projection ? { projection: opts.projection } : {})
      .sort(sort)
      .limit(opts.pageSize + 1)
      .toArray();

    const hasMore = docs.length > opts.pageSize;
    const items = hasMore ? docs.slice(0, opts.pageSize) : docs;
    const last = items[items.length - 1];
    const nextCursor =
      hasMore && last
        ? encodeCursor(
            sortField === "_id" ? null : getPath(last as Document, sortField),
            last._id as ObjectId,
            tag,
          )
        : null;
    return { items, nextCursor };
  }

  /**
   * Documents per UTC day of `dateField` in [from, to), optionally split by `groupField` and
   * summing `sumField`. Scoped to the organization; callers pick date fields that lead an
   * `{ organizationId, <dateField> }` index so the range is an index scan.
   */
  async aggregateByDay(
    organizationId: string,
    opts: {
      dateField: string;
      from: Date;
      to: Date;
      filter?: Filter<T>;
      groupField?: string;
      sumField?: string;
    },
  ): Promise<DailyBucket[]> {
    const match = this.scoped(organizationId, {
      ...(opts.filter ?? {}),
      [opts.dateField]: { $gte: opts.from, $lt: opts.to },
    } as Filter<T>);
    const rows = await this.collection
      .aggregate<{ _id: { day: string; group: unknown }; count: number; sum: number }>([
        { $match: match },
        {
          $group: {
            _id: {
              day: {
                $dateToString: { format: "%Y-%m-%d", date: `$${opts.dateField}`, timezone: "UTC" },
              },
              group: opts.groupField ? `$${opts.groupField}` : null,
            },
            count: { $sum: 1 },
            sum: { $sum: opts.sumField ? { $ifNull: [`$${opts.sumField}`, 0] } : 0 },
          },
        },
      ])
      .toArray();
    return rows.map((r) => ({
      day: r._id.day,
      group: r._id.group ?? null,
      count: r.count,
      sum: Number(r.sum),
    }));
  }
}

export interface DailyBucket {
  /** UTC day, yyyy-mm-dd. */
  day: string;
  /** Value of `groupField` (null without one). */
  group: unknown;
  count: number;
  /** Sum of `sumField` (0 without one). */
  sum: number;
}

export function toObjectId(id: string | ObjectId): ObjectId | null {
  if (typeof id !== "string") return id;
  return /^[a-f0-9]{24}$/i.test(id) ? new ObjectId(id) : null;
}

function cursorTag(sortField: string, direction: 1 | -1): string {
  return `${sortField}:${direction === 1 ? "asc" : "desc"}`;
}

/** Filter selecting the rows strictly after (value, id) in the given order. */
function afterClause(sortField: string, direction: 1 | -1, value: unknown, id: ObjectId): Document {
  const cmp = direction === -1 ? "$lt" : "$gt";
  if (sortField === "_id") return { _id: { [cmp]: id } };
  const isNull = value === null || value === undefined;
  if (direction === -1) {
    // Descending: non-null values high to low, then nulls.
    if (isNull) return { [sortField]: null, _id: { $lt: id } };
    return {
      $or: [
        { [sortField]: { $lt: value } },
        { [sortField]: value, _id: { $lt: id } },
        { [sortField]: null },
      ],
    };
  }
  // Ascending: nulls first, then non-null values low to high.
  if (isNull)
    return { $or: [{ [sortField]: null, _id: { $gt: id } }, { [sortField]: { $ne: null } }] };
  return {
    $or: [{ [sortField]: { $gt: value } }, { [sortField]: value, _id: { $gt: id } }],
  };
}

export function getPath(doc: Document, path: string): unknown {
  let current: unknown = doc;
  for (const part of path.split(".")) {
    if (current === null || current === undefined || typeof current !== "object") return null;
    current = (current as Record<string, unknown>)[part];
  }
  return current ?? null;
}

export function encodeCursor(sortValue: unknown, id: ObjectId, tag?: string): string {
  const payload: unknown[] = [serializeSortValue(sortValue), id.toHexString()];
  if (tag) payload.push(tag);
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

/** Returns [sortValue, idHex, sortTag?] or null for anything malformed. Never throws. */
export function decodeCursor(cursor: string): [unknown, string, string?] | null {
  try {
    const parsed = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as unknown;
    if (!Array.isArray(parsed) || parsed.length < 2 || parsed.length > 3) return null;
    const [value, id, tag] = parsed as [unknown, unknown, unknown];
    if (typeof id !== "string" || !/^[a-f0-9]{24}$/i.test(id)) return null;
    if (tag !== undefined && typeof tag !== "string") return null;
    if (value !== null && typeof value === "object" && !isDateBox(value)) return null;
    return tag === undefined ? [value, id] : [value, id, tag];
  } catch {
    return null;
  }
}

function isDateBox(value: object): boolean {
  const keys = Object.keys(value);
  return (
    keys.length === 1 &&
    keys[0] === "$date" &&
    typeof (value as { $date: unknown }).$date === "string"
  );
}

function serializeSortValue(value: unknown): unknown {
  if (value instanceof Date) return { $date: value.toISOString() };
  return value ?? null;
}

function reviveSortValue(value: unknown): unknown {
  if (value && typeof value === "object" && "$date" in (value as Record<string, unknown>)) {
    const date = new Date(String((value as Record<string, unknown>).$date));
    if (Number.isNaN(date.getTime())) throw new InvalidCursorError();
    return date;
  }
  return value;
}
