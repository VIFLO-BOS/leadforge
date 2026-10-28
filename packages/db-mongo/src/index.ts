import { BSON, type Document as BsonDocument } from "mongodb";
export * from "./mongo.service.js";
export * from "./mongo.module.js";
export * from "./collections.js";
export * from "./org-scoped.repository.js";
export * from "./schemas/index.js";
export * from "./organization-scope.js";
export * from "./sync.js";
export { ObjectId, MongoServerError } from "mongodb";

/** Extended JSON with type wrappers ($oid, $date), for exact comparisons in tests. */
export const EJSON = BSON.EJSON;

/** Deep copy through BSON, keeping ObjectIds and dates (snapshots for merge history). */
export function cloneBson<T>(doc: T): T {
  return BSON.deserialize(BSON.serialize(doc as unknown as BsonDocument)) as T;
}
export type {
  AnyBulkWriteOperation,
  Collection,
  Db,
  Document,
  Filter,
  FindOptions,
  Sort,
  UpdateFilter,
  WithId,
  WriteConcernSettings,
} from "mongodb";

/** True for a duplicate-key error (E11000), optionally on a specific index key. */
export function isDuplicateKeyError(err: unknown, key?: string): boolean {
  const e = err as {
    code?: unknown;
    keyPattern?: Record<string, unknown>;
    errmsg?: string;
    message?: string;
  } | null;
  if (!e || e.code !== 11000) return false;
  if (!key) return true;
  if (e.keyPattern) return key in e.keyPattern;
  const msg = e.errmsg ?? e.message ?? "";
  return key === "_id" ? msg.includes("index: _id_") : msg.includes(key);
}
