/**
 * Name similarity and blocking keys for duplicate candidates (dedup stages 4 and 5). Pure,
 * deterministic, linear or quadratic in the (short) name length only.
 */

/** Words that say little about which business a name refers to. */
const STOPWORDS = new Set([
  "the",
  "and",
  "of",
  "for",
  "in",
  "at",
  "on",
  "by",
  "to",
  "a",
  "an",
  "nig",
  "nigeria",
  "ng",
  "global",
  "international",
  "intl",
  "group",
  "enterprise",
  "enterprises",
  "venture",
  "ventures",
  "services",
  "service",
  "solutions",
  "concept",
  "concepts",
  "store",
  "stores",
  "shop",
  "nigltd",
  "ltd",
  "limited",
  "plc",
  "inc",
  "llc",
  "co",
  "company",
  "and co",
]);

/** Distinctive lowercase tokens of a normalized name (stopwords and one-letter tokens dropped). */
export function nameTokens(normalizedName: string): string[] {
  const out: string[] = [];
  for (const t of normalizedName.split(/[^\p{L}\p{N}]+/u)) {
    if (t.length < 2 || STOPWORDS.has(t) || out.includes(t)) continue;
    out.push(t);
  }
  return out;
}

/** Dice coefficient over token sets (0 to 1). */
export function tokenDice(a: string[], b: string[]): number {
  if (a.length === 0 || b.length === 0) return 0;
  const setB = new Set(b);
  const shared = new Set(a.filter((t) => setB.has(t))).size;
  return (2 * shared) / (new Set(a).size + setB.size);
}

/** Jaro-Winkler similarity (0 to 1) with the standard 0.1 prefix scale over up to 4 characters. */
export function jaroWinkler(a: string, b: string): number {
  if (a === b) return a.length === 0 ? 0 : 1;
  if (a.length === 0 || b.length === 0) return 0;
  const s1 = a.slice(0, 200);
  const s2 = b.slice(0, 200);
  const range = Math.max(0, Math.floor(Math.max(s1.length, s2.length) / 2) - 1);
  const m1 = new Array<boolean>(s1.length).fill(false);
  const m2 = new Array<boolean>(s2.length).fill(false);
  let matches = 0;
  for (let i = 0; i < s1.length; i++) {
    const lo = Math.max(0, i - range);
    const hi = Math.min(i + range + 1, s2.length);
    for (let j = lo; j < hi; j++) {
      if (m2[j] || s1[i] !== s2[j]) continue;
      m1[i] = true;
      m2[j] = true;
      matches++;
      break;
    }
  }
  if (matches === 0) return 0;
  let k = 0;
  let transpositions = 0;
  for (let i = 0; i < s1.length; i++) {
    if (!m1[i]) continue;
    while (!m2[k]) k++;
    if (s1[i] !== s2[k]) transpositions++;
    k++;
  }
  const jaro =
    (matches / s1.length + matches / s2.length + (matches - transpositions / 2) / matches) / 3;
  let prefix = 0;
  while (prefix < 4 && prefix < s1.length && prefix < s2.length && s1[prefix] === s2[prefix])
    prefix++;
  return jaro + prefix * 0.1 * (1 - jaro);
}

/** Two tokens count as the same word at or above this Jaro-Winkler similarity ("kitchen" and "kitchens"). */
export const TOKEN_MATCH = 0.88;

/**
 * Similarity of two normalized names (0 to 1): a one-to-one soft match of distinctive tokens
 * (each token pairs with its most similar unused token when Jaro-Winkler reaches TOKEN_MATCH),
 * scored like a Dice coefficient. Names that differ only in spacing ("mamaput" and "mama put")
 * score 1. 0 when either name has no distinctive token, so an expired or generic name never
 * looks similar.
 */
export function nameSimilarity(normalizedA: string, normalizedB: string): number {
  const ta = nameTokens(normalizedA);
  const tb = nameTokens(normalizedB);
  if (ta.length === 0 || tb.length === 0) return 0;
  if (ta.join("") === tb.join("")) return 1;
  const used = new Set<number>();
  let matched = 0;
  for (const x of ta) {
    let best = -1;
    let bestSim = 0;
    tb.forEach((y, j) => {
      if (used.has(j)) return;
      const sim = x === y ? 1 : jaroWinkler(x, y);
      if (sim > bestSim) {
        bestSim = sim;
        best = j;
      }
    });
    if (best >= 0 && bestSim >= TOKEN_MATCH) {
      used.add(best);
      matched += bestSim;
    }
  }
  return Math.round(((2 * matched) / (ta.length + tb.length)) * 1000) / 1000;
}

export const MAX_BLOCKING_TOKENS = 4;

/**
 * Blocking keys: each distinctive name token paired with the locality key and with the LGA key.
 * Two businesses can only become candidates through these keys (or a shared phone, email or
 * domain), so a name match in a different place is never even compared. Bounded at
 * MAX_BLOCKING_TOKENS tokens x 2 places.
 */
export function blockingKeys(
  normalizedName: string,
  localityKey: string | null,
  lgaKey: string | null,
): string[] {
  if (!localityKey && !lgaKey) return [];
  const tokens = nameTokens(normalizedName)
    .slice()
    .sort((x, y) => y.length - x.length || x.localeCompare(y))
    .slice(0, MAX_BLOCKING_TOKENS);
  const keys: string[] = [];
  for (const t of tokens) {
    if (localityKey) keys.push(`${t}|l:${localityKey}`);
    if (lgaKey) keys.push(`${t}|g:${lgaKey}`);
  }
  return keys;
}
