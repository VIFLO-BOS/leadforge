import type { Readable } from "node:stream";

export const OBJECT_STORAGE = Symbol("OBJECT_STORAGE");

export interface StoredObjectStream {
  stream: Readable;
  /** Size in bytes when the driver knows it. */
  bytes: number | null;
}

/**
 * Where export files live. The API and the worker must reach the same storage: the worker
 * writes, the API streams downloads after checking the signed link. Keys are relative paths
 * of letters, digits, `/`, `_`, `.` and `-` (validated by every driver).
 */
export interface ObjectStorage {
  readonly driver: "local" | "s3";
  put(key: string, body: Buffer, contentType: string): Promise<{ bytes: number }>;
  /** Null when the object does not exist. */
  get(key: string): Promise<StoredObjectStream | null>;
  /** Idempotent: deleting a missing object succeeds. */
  delete(key: string): Promise<void>;
}

const KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9/_.-]{0,511}$/;

/** Throws for keys that could escape the storage root or are not plain relative paths. */
export function assertStorageKey(key: string): void {
  if (
    !KEY_PATTERN.test(key) ||
    key.split("/").some((part) => part === "" || part === "." || part === "..")
  ) {
    throw new Error(`Invalid storage key: ${JSON.stringify(key)}`);
  }
}
