import { z } from "zod";

/**
 * Query-string helpers. Express parses `?a=1&a=2` into an array and `?a=1` into a string;
 * JSON bodies (for example export filters) carry real arrays and booleans. These helpers
 * accept both so one schema serves the directory query and the export body.
 */

/** Repeated query parameter (`?category=a&category=b`) or a JSON array. Max 20 values. */
export function queryArray<T extends z.ZodTypeAny>(item: T, max = 20) {
  return z.preprocess((value) => {
    if (value === undefined || value === null || value === "") return undefined;
    return Array.isArray(value) ? value : [value];
  }, z.array(item).max(max).optional());
}

/**
 * A list of values sent as one comma-separated parameter (`?ids=a,b`), repeated parameters
 * (`?ids=a&ids=b`), both, or a JSON array. Parts are trimmed and empty parts dropped; nothing
 * left means "no filter". More than `max` values is a validation error (counted before
 * de-duplication, so the limit is what the client sent).
 */
export function queryList<T extends z.ZodTypeAny>(item: T, max: number) {
  return z.preprocess(
    (value) => {
      if (value === undefined || value === null || value === "") return undefined;
      const parts = (Array.isArray(value) ? value : [value])
        .flatMap((v) => (typeof v === "string" ? v.split(",") : [v]))
        .map((v) => (typeof v === "string" ? v.trim() : v))
        .filter((v) => v !== "");
      return parts.length ? parts : undefined;
    },
    z.array(item).max(max, `At most ${max} values`).optional(),
  );
}

/** `true`/`false` (also `1`/`0`) from a query string, or a JSON boolean. */
export const queryBoolean = z.preprocess((value) => {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value === "boolean") return value;
  if (value === "true" || value === "1") return true;
  if (value === "false" || value === "0") return false;
  return value;
}, z.boolean().optional());
