/**
 * Text helpers shared by every normalizer. Pure functions, no I/O.
 */

const ZERO_WIDTH = /[\u200B-\u200D\u2060\uFEFF]/g;
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001F\u007F]/g;

/** Trims, removes zero-width and control characters, collapses whitespace. */
export function cleanText(value: string): string {
  return value.replace(ZERO_WIDTH, "").replace(CONTROL, " ").replace(/\s+/g, " ").trim();
}

/** Removes combining diacritics (Yoruba tone marks, accents) so keys match plain spellings. */
export function foldDiacritics(value: string): string {
  return value.normalize("NFKD").replace(/[\u0300-\u036F]/g, "");
}

/** Lowercase, diacritic-free, whitespace-collapsed key for matching and filtering. */
export function normalizeKey(value: string): string {
  return foldDiacritics(cleanText(value)).toLowerCase();
}

/** Title-cases text that is entirely upper or lower case; mixed case is kept as typed. */
export function titleCaseIfUniform(value: string): string {
  const hasLetters = /\p{L}/u.test(value);
  if (!hasLetters) return value;
  if (value !== value.toLowerCase() && value !== value.toUpperCase()) return value;
  return value
    .toLowerCase()
    .replace(/(^|[\s\-/'(])(\p{L})/gu, (_m, sep: string, ch: string) => sep + ch.toUpperCase());
}

/** Values that spreadsheets use for "no value". They are treated as blank cells. */
const PLACEHOLDERS = new Set([
  "-",
  "--",
  "---",
  "n/a",
  "na",
  "n.a.",
  "none",
  "nil",
  "null",
  "undefined",
  "not available",
  "unknown",
  "#n/a",
]);

export function isBlankOrPlaceholder(value: string): boolean {
  const cleaned = cleanText(value).toLowerCase();
  return cleaned.length === 0 || PLACEHOLDERS.has(cleaned);
}

/** Lowercase alphanumeric words for prefix search. */
export function searchWords(value: string | null | undefined): string[] {
  if (!value) return [];
  return normalizeKey(value)
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w.length > 0);
}

/** Escapes a string for literal use inside a RegExp. */
export function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Splits a multi-valued cell ("0803..., 0812..." or "a@x.ng; b@x.ng"). */
export function splitMultiValue(value: string): string[] {
  return value
    .split(/\s*(?:[;,|\n]|\s\/\s|\/(?=\s*[+0-9]))\s*/)
    .map((v) => cleanText(v))
    .filter((v) => v.length > 0);
}
