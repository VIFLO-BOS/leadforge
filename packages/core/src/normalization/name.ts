import { cleanText, normalizeKey } from "./text.js";

const LEGAL_SUFFIXES = new Set([
  "ltd",
  "limited",
  "plc",
  "inc",
  "incorporated",
  "llc",
  "llp",
  "co",
  "company",
  "corp",
  "corporation",
]);

export const BUSINESS_NAME_MAX = 200;

/**
 * Display name (whitespace tidied, case kept) and a matching key used by exact dedup:
 * lowercase, no diacritics or punctuation, trailing legal suffixes removed
 * ("Acme Foods Nig. Ltd." and "ACME FOODS NIG" share a key).
 */
export function normalizeBusinessName(raw: string): { value: string; normalized: string } {
  const value = cleanText(raw);
  const words = normalizeKey(value)
    .replace(/&/g, " and ")
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
  while (words.length > 1 && LEGAL_SUFFIXES.has(words[words.length - 1]!)) words.pop();
  return { value, normalized: words.join(" ") };
}

/** URL-safe slug from the name and locality. */
export function slugify(name: string, locality: string | null): string {
  const base = normalizeKey([name, locality].filter(Boolean).join(" "))
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80)
    .replace(/-+$/g, "");
  return base || "business";
}
