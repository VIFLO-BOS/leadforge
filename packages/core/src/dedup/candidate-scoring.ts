import type { CandidateSignal, DuplicateCandidate } from "@leadforge/contracts";
import { isExpired, locationHasValue } from "../businesses/business-model.js";
import type { BusinessDocument } from "../businesses/business.types.js";
import { nameSimilarity } from "../normalization/similarity.js";

/**
 * Candidate match scoring (dedup stage 5). A pair becomes a review candidate only with
 * corroboration beyond the name: a shared phone, email or website domain, or the same locality
 * or LGA. A name match alone, however close, never produces a candidate, and no candidate is
 * ever merged automatically.
 */

/** Name similarity needed when an identifier (phone, email, domain) is shared. */
export const NAME_THRESHOLD_WITH_IDENTIFIER = 0.5;
/** Name similarity needed when only the place (same locality or LGA) corroborates. */
export const NAME_THRESHOLD_WITH_LOCATION = 0.85;

export const SCORE_WEIGHTS = { name: 0.55, identifier: 0.3, location: 0.15 } as const;

export interface PairEvaluation {
  stage: DuplicateCandidate["stage"];
  score: number;
  signals: CandidateSignal[];
  reasons: string[];
}

function liveName(doc: BusinessDocument, now: Date): string {
  return isExpired(doc.name.expiresAt, now) ? "" : doc.name.normalized;
}

export function evaluatePair(
  a: BusinessDocument,
  b: BusinessDocument,
  now: Date = new Date(),
): PairEvaluation | null {
  if (a._id.equals(b._id)) return null;
  const signals: CandidateSignal[] = [];
  const reasons: string[] = [];

  const aDomain = a.website && !isExpired(a.website.expiresAt, now) ? a.website.domain : null;
  const bDomain = b.website && !isExpired(b.website.expiresAt, now) ? b.website.domain : null;
  const sharedDomain = aDomain !== null && aDomain === bDomain ? aDomain : null;
  const bPhones = new Set(b.phones.filter((p) => !isExpired(p.expiresAt, now)).map((p) => p.e164));
  const sharedPhones = a.phones
    .filter((p) => !isExpired(p.expiresAt, now) && bPhones.has(p.e164))
    .map((p) => p.e164);
  const bEmails = new Set(
    b.emails.filter((e) => !isExpired(e.expiresAt, now)).map((e) => e.address),
  );
  const sharedEmails = a.emails
    .filter((e) => !isExpired(e.expiresAt, now) && bEmails.has(e.address))
    .map((e) => e.address);

  const locLive = (d: BusinessDocument) =>
    locationHasValue(d.location) && !isExpired(d.location.expiresAt, now);
  const sameLocality =
    locLive(a) &&
    locLive(b) &&
    a.location.localityKey !== null &&
    a.location.localityKey === b.location.localityKey;
  const sameLga =
    locLive(a) &&
    locLive(b) &&
    a.location.lgaKey !== null &&
    a.location.lgaKey === b.location.lgaKey;

  const identifier = sharedDomain !== null || sharedPhones.length > 0 || sharedEmails.length > 0;
  const place = sameLocality || sameLga;
  // Name-only matches never become candidates.
  if (!identifier && !place) return null;

  const similarity = nameSimilarity(liveName(a, now), liveName(b, now));
  const threshold = identifier ? NAME_THRESHOLD_WITH_IDENTIFIER : NAME_THRESHOLD_WITH_LOCATION;
  if (similarity < threshold) return null;

  signals.push({ kind: "name_similarity", aValue: a.name.value, bValue: b.name.value, similarity });
  reasons.push(
    `Names are ${Math.round(similarity * 100)}% similar ("${a.name.value}" and "${b.name.value}")`,
  );
  if (sharedDomain) {
    signals.push({
      kind: "shared_domain",
      aValue: sharedDomain,
      bValue: sharedDomain,
      similarity: 1,
    });
    reasons.push(`Both use the website domain ${sharedDomain}`);
  }
  for (const p of sharedPhones.slice(0, 3)) {
    signals.push({ kind: "shared_phone", aValue: p, bValue: p, similarity: 1 });
    reasons.push(`Both list the phone ${p}`);
  }
  for (const e of sharedEmails.slice(0, 3)) {
    signals.push({ kind: "shared_email", aValue: e, bValue: e, similarity: 1 });
    reasons.push(`Both list the email ${e}`);
  }
  if (sameLocality) {
    signals.push({
      kind: "same_locality",
      aValue: a.location.locality,
      bValue: b.location.locality,
      similarity: 1,
    });
    reasons.push(`Both are in ${a.location.locality ?? "the same locality"}`);
  }
  if (sameLga) {
    signals.push({
      kind: "same_lga",
      aValue: a.location.lga,
      bValue: b.location.lga,
      similarity: 1,
    });
    reasons.push(`Both are in the ${a.location.lga ?? "same"} LGA`);
  }
  const score = Math.min(
    1,
    SCORE_WEIGHTS.name * similarity +
      (identifier ? SCORE_WEIGHTS.identifier : 0) +
      (place ? SCORE_WEIGHTS.location : 0),
  );
  const stage: PairEvaluation["stage"] = sharedDomain
    ? "domain"
    : sharedPhones.length
      ? "phone"
      : sharedEmails.length
        ? "email"
        : "name_location";
  // Strongest reasons first: shared identifiers, then place, then the name.
  const ordered = [...reasons.slice(1), reasons[0]!];
  return { stage, score: Math.round(score * 100) / 100, signals, reasons: ordered };
}

/** Pair key with ids in a fixed order, so (a, b) and (b, a) are the same candidate. */
export function pairKey(a: string, b: string): { key: string; ids: [string, string] } {
  const ids: [string, string] = a < b ? [a, b] : [b, a];
  return { key: `${ids[0]}:${ids[1]}`, ids };
}
