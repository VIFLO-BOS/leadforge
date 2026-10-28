import { cloneBson, type ObjectId } from "@leadforge/db-mongo";
import type { MergeFieldChoice } from "@leadforge/contracts";
import { combineExpiry, locationHasValue, recomputeDerived } from "../businesses/business-model.js";
import { bestWhatsApp } from "../businesses/field-state.js";
import {
  OBSERVATION_IDS_CAP,
  type BusinessDocument,
  type StoredAlternative,
  type StoredFieldMeta,
  type StoredLocationValue,
} from "../businesses/business.types.js";

/**
 * Merge of two business records (dedup stage 6). Pure: the inputs are not modified. The
 * survivor keeps its id; phones, emails, socials, categories, sources and external references
 * are combined; name, website and location come from the side chosen for each (default: the
 * survivor when it has a value). A differing website or location from the other side is kept
 * as an alternative, so nothing observed is dropped. The merged record is soft-deleted and points
 * to the survivor. Merge history stores both full documents so undo restores them exactly.
 */

export interface MergeChoices {
  name?: MergeFieldChoice | undefined;
  website?: MergeFieldChoice | undefined;
  location?: MergeFieldChoice | undefined;
}

export interface MergeResult {
  survivor: BusinessDocument;
  merged: BusinessDocument;
  fieldDecisions: Array<{ field: "name" | "website" | "location"; chosenFrom: ObjectId }>;
}

function unionIds(a: ObjectId[], b: ObjectId[]): ObjectId[] {
  const out = [...a];
  for (const id of b) if (!out.some((x) => x.equals(id))) out.push(id);
  return out.slice(-OBSERVATION_IDS_CAP);
}

function maxDate(a: Date | null | undefined, b: Date | null | undefined): Date | null {
  if (!a) return b ?? null;
  if (!b) return a;
  return a > b ? a : b;
}

/** Combines the metadata of the same value observed on both records. */
function combineMeta<T extends StoredFieldMeta>(a: T, b: StoredFieldMeta): T {
  const state =
    a.state === "verified" || b.state === "verified"
      ? "verified"
      : a.state === "conflicting" || b.state === "conflicting"
        ? "conflicting"
        : "unverified";
  return {
    ...a,
    state,
    confidence: Math.max(a.confidence, b.confidence),
    observationIds: unionIds(a.observationIds, b.observationIds),
    lastObservedAt: maxDate(a.lastObservedAt, b.lastObservedAt),
    lastVerifiedAt: maxDate(a.lastVerifiedAt, b.lastVerifiedAt),
    expiresAt: combineExpiry(a.expiresAt, b.expiresAt),
  };
}

function unionAlternatives<T>(
  a: StoredAlternative<T>[],
  b: StoredAlternative<T>[],
  same: (x: T, y: T) => boolean,
): StoredAlternative<T>[] {
  const out = a.map((x) => ({ ...x }));
  for (const alt of b) {
    const existing = out.find((x) => same(x.value, alt.value));
    if (existing) {
      existing.observationIds = unionIds(existing.observationIds, alt.observationIds);
      existing.lastObservedAt = maxDate(existing.lastObservedAt, alt.lastObservedAt);
    } else out.push({ ...alt });
  }
  return out.slice(0, 10);
}

function pick(
  choice: MergeFieldChoice | undefined,
  survivorHas: boolean,
  mergedHas: boolean,
): MergeFieldChoice {
  if (choice) return choice;
  return survivorHas || !mergedHas ? "survivor" : "merged";
}

export function mergeRecords(
  survivorIn: BusinessDocument,
  mergedIn: BusinessDocument,
  choices: MergeChoices,
  now: Date = new Date(),
): MergeResult {
  const s = cloneBson(survivorIn);
  const m = cloneBson(mergedIn);
  const decisions: MergeResult["fieldDecisions"] = [];

  // Name.
  const nameFrom = pick(choices.name, Boolean(s.name.normalized), Boolean(m.name.normalized));
  if (nameFrom === "merged")
    s.name = { ...m.name, observationIds: unionIds(m.name.observationIds, s.name.observationIds) };
  else
    s.name = { ...s.name, observationIds: unionIds(s.name.observationIds, m.name.observationIds) };
  decisions.push({ field: "name", chosenFrom: nameFrom === "merged" ? m._id : s._id });

  // Website: the chosen one, the other kept as an alternative when it differs.
  const websiteFrom = pick(choices.website, Boolean(s.website), Boolean(m.website));
  const chosenWebsite = websiteFrom === "merged" ? m.website : s.website;
  const otherWebsite = websiteFrom === "merged" ? s.website : m.website;
  if (!chosenWebsite) s.website = otherWebsite ? { ...otherWebsite } : null;
  else {
    let website = { ...chosenWebsite };
    if (otherWebsite) {
      if (otherWebsite.domain === website.domain) website = combineMeta(website, otherWebsite);
      website.alternatives = unionAlternatives(
        website.alternatives,
        otherWebsite.alternatives,
        (x, y) => x === y,
      );
      if (
        otherWebsite.domain !== website.domain &&
        !website.alternatives.some((a) => a.value === otherWebsite.value)
      ) {
        website.alternatives = [
          ...website.alternatives,
          {
            value: otherWebsite.value,
            rawValue: otherWebsite.rawValue,
            observationIds: otherWebsite.observationIds,
            lastObservedAt: otherWebsite.lastObservedAt,
            expiresAt: otherWebsite.expiresAt,
          },
        ].slice(0, 10);
      }
    }
    s.website = website;
  }
  if (s.website || m.website)
    decisions.push({ field: "website", chosenFrom: websiteFrom === "merged" ? m._id : s._id });

  // Location.
  const locationFrom = pick(
    choices.location,
    locationHasValue(s.location),
    locationHasValue(m.location),
  );
  const chosenLoc = locationFrom === "merged" ? m.location : s.location;
  const otherLoc = locationFrom === "merged" ? s.location : m.location;
  const sameLocation = (x: StoredLocationValue, y: StoredLocationValue) =>
    x.formatted === y.formatted;
  let location = {
    ...chosenLoc,
    alternatives: unionAlternatives(chosenLoc.alternatives, otherLoc.alternatives, sameLocation),
  };
  if (locationHasValue(otherLoc)) {
    if (!locationHasValue(location))
      location = { ...otherLoc, alternatives: location.alternatives };
    else if (otherLoc.formatted === location.formatted) location = combineMeta(location, otherLoc);
    else if (!location.alternatives.some((a) => a.value.formatted === otherLoc.formatted)) {
      const value: StoredLocationValue = {
        formatted: otherLoc.formatted,
        street: otherLoc.street,
        locality: otherLoc.locality,
        lga: otherLoc.lga,
        region: otherLoc.region,
        country: otherLoc.country,
        postalCode: otherLoc.postalCode,
      };
      location.alternatives = [
        ...location.alternatives,
        {
          value,
          rawValue: otherLoc.rawValue,
          observationIds: otherLoc.observationIds,
          lastObservedAt: otherLoc.lastObservedAt,
          expiresAt: otherLoc.expiresAt,
        },
      ].slice(0, 10);
    }
  }
  s.location = location;
  if (locationHasValue(s.location) || locationHasValue(m.location))
    decisions.push({ field: "location", chosenFrom: locationFrom === "merged" ? m._id : s._id });

  // Multi-valued fields are combined.
  for (const c of m.categories) {
    const existing = s.categories.find((x) => x.key === c.key);
    if (existing) existing.observationIds = unionIds(existing.observationIds, c.observationIds);
    else if (s.categories.length < 20) s.categories.push({ ...c });
  }
  for (const p of m.phones) {
    const index = s.phones.findIndex((x) => x.e164 === p.e164);
    if (index < 0) {
      if (s.phones.length < 20) s.phones.push({ ...p });
      continue;
    }
    const current = s.phones[index]!;
    const whatsapp =
      bestWhatsApp([current.whatsapp.status, p.whatsapp.status]) === current.whatsapp.status
        ? current.whatsapp
        : p.whatsapp;
    s.phones[index] = { ...combineMeta(current, p), whatsapp };
  }
  for (const e of m.emails) {
    const index = s.emails.findIndex((x) => x.address === e.address);
    if (index < 0) {
      if (s.emails.length < 20) s.emails.push({ ...e });
      continue;
    }
    const current = s.emails[index]!;
    const verification =
      !current.verification ||
      (e.verification && e.verification.checkedAt > current.verification.checkedAt)
        ? e.verification
        : current.verification;
    s.emails[index] = { ...combineMeta(current, e), verification };
  }
  for (const so of m.socials) {
    const index = s.socials.findIndex((x) => x.url.toLowerCase() === so.url.toLowerCase());
    if (index < 0) {
      if (s.socials.length < 20) s.socials.push({ ...so });
    } else s.socials[index] = combineMeta(s.socials[index]!, so);
  }
  for (const r of m.externalRefs) {
    if (
      !s.externalRefs.some((x) => x.source === r.source && x.externalId === r.externalId) &&
      s.externalRefs.length < 20
    )
      s.externalRefs.push({ ...r });
  }
  for (const [source, seen] of Object.entries(m.sourceSeen) as Array<
    [keyof BusinessDocument["sourceSeen"], { firstSeenAt: Date; lastSeenAt: Date }]
  >) {
    const current = s.sourceSeen[source];
    s.sourceSeen[source] = current
      ? {
          firstSeenAt:
            current.firstSeenAt < seen.firstSeenAt ? current.firstSeenAt : seen.firstSeenAt,
          lastSeenAt: current.lastSeenAt > seen.lastSeenAt ? current.lastSeenAt : seen.lastSeenAt,
        }
      : { ...seen };
  }
  for (const id of m.importIds) if (!s.importIds.some((x) => x.equals(id))) s.importIds.push(id);

  // Never lose a do-not-contact: a suppressed side keeps the survivor suppressed.
  if (m.flags.suppressed && !s.flags.suppressed) s.flags = { ...m.flags };
  s.flags.doNotContact = s.flags.doNotContact || m.flags.doNotContact;

  const sAnalysis = s.latestAnalysis ?? null;
  const mAnalysis = m.latestAnalysis ?? null;
  if (
    mAnalysis &&
    (!sAnalysis ||
      (mAnalysis.analyzedAt && sAnalysis.analyzedAt && mAnalysis.analyzedAt > sAnalysis.analyzedAt))
  )
    s.latestAnalysis = mAnalysis;

  s.dedup = {
    status: s.dedup.status === "merged_into" ? "unique" : s.dedup.status,
    mergedIntoId: null,
    candidateCount: s.dedup.candidateCount,
    absorbedIds: unionIds(unionIds(s.dedup.absorbedIds ?? [], [m._id]), m.dedup.absorbedIds ?? []),
  };
  s.updatedAt = now;
  recomputeDerived(s);

  const mergedAfter = cloneBson(mergedIn);
  mergedAfter.deletedAt = now;
  mergedAfter.updatedAt = now;
  mergedAfter.dedup = {
    status: "merged_into",
    mergedIntoId: s._id,
    candidateCount: 0,
    absorbedIds: mergedAfter.dedup.absorbedIds ?? [],
  };
  return { survivor: s, merged: mergedAfter, fieldDecisions: decisions };
}
