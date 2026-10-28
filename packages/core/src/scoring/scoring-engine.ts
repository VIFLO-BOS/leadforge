import {
  ANALYSIS_LIMITS,
  SCORE_EXPLANATION,
  SCORING_SIGNAL_LABELS,
  SCORING_SIGNALS,
  type FieldState,
  type ScoringSignal,
  type SourceKey,
} from "@leadforge/contracts";
import type { ObjectId } from "@leadforge/db-mongo";
import { SOURCE_CONFIDENCE, isExpired, locationHasValue } from "../businesses/business-model.js";
import type { BusinessDocument, StoredScore } from "../businesses/business.types.js";
import { bestState, deriveFieldState, type StateContext } from "../businesses/field-state.js";

/**
 * Lead scoring (PRODUCT_REQUIREMENTS section 7). Pure and deterministic: the same business,
 * profile and `now` always give the same snapshot.
 *
 * Fit score = sum over the seven signals of weight x signal (each signal 0 to 1), 0 to 100.
 * Data confidence is a separate number about the record itself; the two are never combined.
 */

export interface ScoringProfileInput {
  id: ObjectId;
  version: number;
  weights: Record<ScoringSignal, number>;
  /** ICP category keys (lowercase, diacritic-free). */
  categoryKeys: string[];
  categoryLabels: string[];
  /** ICP locations as filter keys; every given part must match. */
  locations: Array<{
    country: string | null;
    regionKey: string | null;
    localityKey: string | null;
    label: string;
  }>;
}

/** Trust per source for the source-reliability signal (the base confidence of its observations). */
export const SOURCE_TRUST: Record<SourceKey, number> = SOURCE_CONFIDENCE;

/** Records observed within this many days get the full freshness signal. */
export const FRESH_FULL_DAYS = 30;
/** Opportunity count that gives the full website-opportunity signal. */
export const OPPORTUNITY_CAP = 3;

const STATE_FACTOR: Record<FieldState, number> = {
  verified: 1,
  unverified: 0.8,
  stale: 0.5,
  conflicting: 0.4,
  expired: 0,
  missing: 0,
};

const DAY_MS = 24 * 60 * 60 * 1000;

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function list(items: string[]): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

interface FieldPresence {
  field: "phone" | "email" | "website" | "address";
  present: boolean;
  state: FieldState;
}

function contactFields(doc: BusinessDocument, ctx: StateContext): FieldPresence[] {
  const phoneState = bestState(doc.phones.map((p) => deriveFieldState(p, true, ctx)));
  const emailState = bestState(doc.emails.map((e) => deriveFieldState(e, true, ctx)));
  const websiteState = deriveFieldState(doc.website, Boolean(doc.website), ctx);
  const addressState = deriveFieldState(doc.location, locationHasValue(doc.location), ctx);
  const live = (s: FieldState) => s !== "missing" && s !== "expired";
  return [
    { field: "phone", present: live(phoneState), state: phoneState },
    { field: "email", present: live(emailState), state: emailState },
    { field: "website", present: live(websiteState), state: websiteState },
    { field: "address", present: live(addressState), state: addressState },
  ];
}

function signalValues(
  doc: BusinessDocument,
  profile: ScoringProfileInput,
  ctx: StateContext,
): Record<ScoringSignal, { value: number; detail: string }> {
  const fields = contactFields(doc, ctx);
  const present = fields.filter((f) => f.present);
  const verified = present.filter((f) => f.state === "verified");

  const analysis = doc.latestAnalysis;
  const opportunities = analysis?.status === "completed" ? analysis.opportunities : [];

  const categoryKeys = doc.categories
    .filter((c) => !isExpired(c.expiresAt, ctx.now))
    .map((c) => c.key);
  const matchedCategory = doc.categories.find(
    (c) => !isExpired(c.expiresAt, ctx.now) && profile.categoryKeys.includes(c.key),
  );

  const locLive = locationHasValue(doc.location) && !isExpired(doc.location.expiresAt, ctx.now);
  const matchedLocation = locLive
    ? profile.locations.find(
        (l) =>
          (l.country === null || l.country === doc.location.country) &&
          (l.regionKey === null || l.regionKey === doc.location.regionKey) &&
          (l.localityKey === null || l.localityKey === doc.location.localityKey),
      )
    : undefined;

  const freshest = Math.max(doc.lastObservedAt?.getTime() ?? 0, doc.lastVerifiedAt?.getTime() ?? 0);
  const ageDays = freshest > 0 ? Math.max(0, (ctx.now.getTime() - freshest) / DAY_MS) : null;
  let freshness = 0;
  if (ageDays !== null) {
    if (ageDays <= FRESH_FULL_DAYS) freshness = 1;
    else if (ctx.freshnessDays <= FRESH_FULL_DAYS || ageDays >= ctx.freshnessDays) freshness = 0;
    else freshness = 1 - (ageDays - FRESH_FULL_DAYS) / (ctx.freshnessDays - FRESH_FULL_DAYS);
  }

  const trusted = doc.sources
    .map((s) => ({ source: s, trust: SOURCE_TRUST[s] ?? 0 }))
    .sort((a, b) => b.trust - a.trust || a.source.localeCompare(b.source));
  const top = trusted[0];

  return {
    contactCompleteness: {
      value: present.length / fields.length,
      detail: `${present.length} of 4 present${present.length ? `: ${list(present.map((f) => f.field))}` : ""}${present.length < 4 ? ` (missing: ${list(fields.filter((f) => !f.present).map((f) => f.field))})` : ""}`,
    },
    contactVerification: {
      value: present.length ? verified.length / present.length : 0,
      detail: present.length
        ? `${verified.length} of ${present.length} present field${present.length === 1 ? "" : "s"} verified${verified.length ? ` (${list(verified.map((f) => f.field))})` : ""}`
        : "No contact fields to verify",
    },
    websiteOpportunity: {
      value: Math.min(opportunities.length, OPPORTUNITY_CAP) / OPPORTUNITY_CAP,
      detail:
        analysis?.status === "completed"
          ? opportunities.length
            ? `${opportunities.length} opportunit${opportunities.length === 1 ? "y" : "ies"} with confidence of at least ${ANALYSIS_LIMITS.opportunityConfidence} in the website analysis of ${analysis.analyzedAt?.toISOString().slice(0, 10) ?? "an unknown date"}: ${list(opportunities)}`
            : `The website analysis of ${analysis.analyzedAt?.toISOString().slice(0, 10) ?? "an unknown date"} found no opportunity with confidence of at least ${ANALYSIS_LIMITS.opportunityConfidence}`
          : "No completed website analysis",
    },
    industryMatch: {
      value: matchedCategory ? 1 : 0,
      detail:
        profile.categoryKeys.length === 0
          ? "No ICP categories are configured"
          : matchedCategory
            ? `Category ${matchedCategory.value} is in your ICP`
            : categoryKeys.length
              ? `No category matches your ICP (${list(profile.categoryLabels.slice(0, 5))})`
              : "The business has no category",
    },
    locationMatch: {
      value: matchedLocation ? 1 : 0,
      detail:
        profile.locations.length === 0
          ? "No ICP locations are configured"
          : matchedLocation
            ? `Location matches ICP location ${matchedLocation.label}`
            : locLive
              ? "Location is outside your ICP locations"
              : "The business has no location",
    },
    freshness: {
      value: Math.max(0, Math.min(1, freshness)),
      detail:
        ageDays === null
          ? "Never observed"
          : `Last observed or verified ${Math.floor(ageDays)} day${Math.floor(ageDays) === 1 ? "" : "s"} ago (freshness window ${ctx.freshnessDays} days)`,
    },
    sourceReliability: {
      value: top ? top.trust : 0,
      detail: top
        ? `Most reliable source: ${top.source.replace(/_/g, " ")} (trust ${top.trust})`
        : "No sources",
    },
  };
}

function dataConfidence(
  doc: BusinessDocument,
  ctx: StateContext,
): { value: number; fields: StoredScore["dataConfidenceFields"] } {
  const pick = <T extends { confidence: number }>(items: T[], stateOf: (x: T) => FieldState) =>
    items.reduce<{ state: FieldState; confidence: number; quality: number }>(
      (best, x) => {
        const state = stateOf(x);
        const quality = round2(x.confidence * STATE_FACTOR[state]);
        return quality > best.quality ? { state, confidence: x.confidence, quality } : best;
      },
      { state: "missing", confidence: 0, quality: 0 },
    );
  const nameState = deriveFieldState(
    doc.name,
    Boolean(doc.name.value) && Boolean(doc.name.normalized),
    ctx,
  );
  const websiteState = deriveFieldState(doc.website, Boolean(doc.website), ctx);
  const locationState = deriveFieldState(doc.location, locationHasValue(doc.location), ctx);
  const fields: StoredScore["dataConfidenceFields"] = [
    {
      field: "name",
      state: nameState,
      confidence: doc.name.confidence,
      quality: round2(doc.name.confidence * STATE_FACTOR[nameState]),
    },
    {
      field: "website",
      state: websiteState,
      confidence: doc.website?.confidence ?? 0,
      quality: round2((doc.website?.confidence ?? 0) * STATE_FACTOR[websiteState]),
    },
    { field: "phone", ...pick(doc.phones, (p) => deriveFieldState(p, true, ctx)) },
    { field: "email", ...pick(doc.emails, (e) => deriveFieldState(e, true, ctx)) },
    {
      field: "location",
      state: locationState,
      confidence: doc.location.confidence,
      quality: round2(doc.location.confidence * STATE_FACTOR[locationState]),
    },
  ];
  const mean = fields.reduce((s, f) => s + f.quality, 0) / fields.length;
  return { value: Math.round(mean * 100), fields };
}

export function computeScore(
  doc: BusinessDocument,
  profile: ScoringProfileInput,
  ctx: StateContext,
): StoredScore {
  const values = signalValues(doc, profile, ctx);
  const breakdown = SCORING_SIGNALS.map((signal) => {
    const weight = profile.weights[signal];
    const value = round2(values[signal].value);
    return { signal, weight, value, points: round2(weight * value), detail: values[signal].detail };
  });
  const fit = Math.max(
    0,
    Math.min(100, Math.round(breakdown.reduce((s, b) => s + b.weight * b.value, 0))),
  );
  const dc = dataConfidence(doc, ctx);
  const contributing = [...breakdown]
    .filter((b) => b.points > 0)
    .sort((a, b) => b.points - a.points || a.signal.localeCompare(b.signal));
  const summary = contributing.length
    ? `Fit ${fit} of 100 from ${list(contributing.map((b) => `${SCORING_SIGNAL_LABELS[b.signal].toLowerCase()} (${b.points} of ${b.weight})`))}.`
    : `Fit ${fit} of 100: no signal contributed.`;
  return {
    fit,
    dataConfidence: dc.value,
    computedAt: ctx.now,
    profileId: profile.id,
    profileVersion: profile.version,
    breakdown,
    dataConfidenceFields: dc.fields,
    summary,
  };
}

export { SCORE_EXPLANATION };
