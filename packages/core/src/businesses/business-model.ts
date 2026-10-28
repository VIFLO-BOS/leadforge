import { ObjectId } from "@leadforge/db-mongo";
import type {
  CategoryTaxonomy,
  CollectionMethod,
  DataLicenseId,
  ObservationField,
  SourceKey,
} from "@leadforge/contracts";
import { blockingKeys, nationalDigits, normalizeKey, searchWords } from "../normalization/index.js";
import { deterministicObjectId, type ObservationDocument } from "../provenance/provenance.types.js";
import { bestWhatsApp } from "./field-state.js";
import {
  OBSERVATION_IDS_CAP,
  type BusinessDocument,
  type StoredFieldMeta,
  type StoredLocation,
  type StoredLocationValue,
  type StoredExternalRef,
  type StoredPhone,
} from "./business.types.js";
import type {
  BusinessInput,
  CategoryInput,
  EmailInput,
  NormalizedLocation,
  PhoneInput,
  WebsiteInput,
} from "./business-input.js";

/** Who and what produced a set of observations. */
export interface ProvenanceContext {
  source: SourceKey;
  collectionMethod: CollectionMethod;
  sourceRef: string | null;
  collectedAt: Date;
  /** Base confidence for this source (user_edit 0.8, user_import 0.6). */
  confidence: number;
  actor: { type: "user" | "system"; userId: string | null };
  importId: ObjectId | null;
  note: string | null;
  metadata?: Record<string, unknown>;
  /** When set, observation ids are derived from it so reprocessing is idempotent. */
  idSeed: string | null;
  /** Timestamp used for derived observation ids (defaults to collectedAt). Must be stable across retries. */
  idTime?: Date;
  /**
   * End of the source's retention window for every value in this batch (source policy). Null or
   * absent means the values may be kept. Sets field `expiresAt` and observation `policy.retainValueUntil`.
   */
  expiresAt?: Date | null;
  /** Source record id (for example a Google place ID), stored on observations. */
  sourceExternalId?: string | null;
  /** Discovery job that collected the values. */
  discoveryJobId?: ObjectId | null;
  /** Taxonomy for categories from this source (default "user"). */
  categoryTaxonomy?: CategoryTaxonomy;
  /** Source reference kept on the business so the record can be refreshed (place IDs may be kept indefinitely). */
  externalRef?: {
    source: SourceKey;
    externalId: string;
    expiresAt: Date | null;
    /** Other keys of the same real place; a business carrying any of them is the same place. */
    matchKeys?: string[];
    release?: string | null;
    dataset?: string | null;
    recordId?: string | null;
    license?: DataLicenseId | null;
  } | null;
  /**
   * When the source observed the values, if earlier than collection (an open-data release date).
   * Field freshness (`lastObservedAt`, and so `stale`) follows it; defaults to collectedAt.
   */
  observedAt?: Date | null;
  /** Attribution the source requires next to its values, stored on observations. */
  attribution?: string | null;
  /** Enrichment run that collected the values (website observations). */
  enrichmentRunId?: ObjectId | null;
}

export const SOURCE_CONFIDENCE: Record<SourceKey, number> = {
  user_edit: 0.8,
  user_import: 0.6,
  website: 0.7,
  google_places: 0.8,
  overture_places: 0.6,
};

/** Maps each input value to the observation that recorded it. */
export interface ObservationRefs {
  name: ObjectId;
  categories: Map<string, ObjectId>;
  website: ObjectId | null;
  socials: Map<string, ObjectId>;
  phones: Map<string, ObjectId>;
  whatsapp: Map<string, ObjectId>;
  emails: Map<string, ObjectId>;
  location: ObjectId | null;
}

function locationValue(loc: NormalizedLocation | StoredLocation | null): StoredLocationValue {
  return {
    formatted: loc?.formatted ?? null,
    street: loc?.street ?? null,
    locality: loc?.locality ?? null,
    lga: loc?.lga ?? null,
    region: loc?.region ?? null,
    country: loc?.country ?? null,
    postalCode: loc?.postalCode ?? null,
  };
}

export function locationHasValue(loc: StoredLocationValue): boolean {
  return Boolean(
    loc.street || loc.locality || loc.lga || loc.region || loc.postalCode || loc.country,
  );
}

/** Builds one observation per observed value. */
export function buildObservations(
  organizationId: string,
  businessId: ObjectId,
  input: BusinessInput,
  ctx: ProvenanceContext,
): { observations: ObservationDocument[]; refs: ObservationRefs } {
  const observations: ObservationDocument[] = [];
  const nextId = () =>
    ctx.idSeed
      ? deterministicObjectId(
          `${ctx.idSeed}:obs:${observations.length}`,
          ctx.idTime ?? ctx.collectedAt,
        )
      : new ObjectId();
  const add = (
    field: ObservationField,
    fieldKey: string | null,
    rawValue: string | null,
    normalizedValue: ObservationDocument["normalizedValue"],
    metadata: Record<string, unknown> = {},
  ): ObjectId => {
    const _id = nextId();
    observations.push(
      observationDoc(organizationId, businessId, ctx, {
        _id,
        field,
        fieldKey,
        rawValue,
        normalizedValue,
        action: "set",
        metadata,
      }),
    );
    return _id;
  };

  const refs: ObservationRefs = {
    name: add("name", null, input.name.raw, input.name.value),
    categories: new Map(),
    website: null,
    socials: new Map(),
    phones: new Map(),
    whatsapp: new Map(),
    emails: new Map(),
    location: null,
  };
  for (const c of input.categories)
    refs.categories.set(c.key, add("category", c.key, c.raw, c.value));
  if (input.website)
    refs.website = add("website", input.website.domain, input.website.raw, input.website.url);
  for (const s of input.socials)
    refs.socials.set(s.url, add("social", s.url, s.raw, s.url, { platform: s.platform }));
  for (const p of input.phones) {
    refs.phones.set(
      p.e164,
      add("phone", p.e164, p.raw, p.e164, { type: p.type, country: p.country }),
    );
    if (p.whatsapp === "user_asserted")
      refs.whatsapp.set(p.e164, add("whatsapp", p.e164, p.raw, "user_asserted"));
  }
  for (const e of input.emails)
    refs.emails.set(e.address, add("email", e.address, e.raw, e.address));
  if (input.location) {
    const { formatted: _f, ...parts } = locationValue(input.location);
    refs.location = add("location", null, input.location.raw, parts);
  }
  return { observations, refs };
}

export function observationDoc(
  organizationId: string,
  businessId: ObjectId,
  ctx: ProvenanceContext,
  o: Pick<
    ObservationDocument,
    "_id" | "field" | "fieldKey" | "rawValue" | "normalizedValue" | "action"
  > & {
    metadata?: Record<string, unknown>;
  },
): ObservationDocument {
  return {
    _id: o._id,
    organizationId,
    businessId,
    source: ctx.source,
    sourceRef: ctx.sourceRef,
    sourceExternalId: ctx.sourceExternalId ?? null,
    field: o.field,
    fieldKey: o.fieldKey,
    rawValue: o.rawValue === null ? null : o.rawValue.slice(0, 4000),
    normalizedValue: o.normalizedValue,
    collectedAt: ctx.collectedAt,
    collectionMethod: ctx.collectionMethod,
    verification: null,
    confidence: ctx.confidence,
    ...(ctx.importId ? { importId: ctx.importId } : {}),
    ...(ctx.discoveryJobId ? { discoveryJobId: ctx.discoveryJobId } : {}),
    ...(ctx.enrichmentRunId ? { enrichmentRunId: ctx.enrichmentRunId } : {}),
    actor: ctx.actor,
    note: ctx.note,
    action: o.action,
    policy: ctx.expiresAt ? { retainValueUntil: ctx.expiresAt } : null,
    redactedAt: null,
    metadata: {
      ...(ctx.metadata ?? {}),
      ...(o.metadata ?? {}),
      ...(ctx.attribution ? { attribution: ctx.attribution } : {}),
    },
  };
}

/** When the values were observed: the source's own date when it gives one, else collection time. */
function observedAt(ctx: ProvenanceContext): Date {
  return ctx.observedAt && ctx.observedAt < ctx.collectedAt ? ctx.observedAt : ctx.collectedAt;
}

function freshMeta(obsId: ObjectId | null, ctx: ProvenanceContext): StoredFieldMeta {
  return {
    state: "unverified",
    confidence: ctx.confidence,
    observationIds: obsId ? [obsId] : [],
    lastObservedAt: obsId ? observedAt(ctx) : null,
    lastVerifiedAt: null,
    expiresAt: ctx.expiresAt ?? null,
  };
}

/**
 * Expiry after a value is observed again. A value seen by a source without a retention limit
 * never expires (it is corroborated); between two limited sources the later end wins.
 */
export function combineExpiry(
  current: Date | null | undefined,
  incoming: Date | null | undefined,
): Date | null {
  if (!current || !incoming) return null;
  return current > incoming ? current : incoming;
}

/** True when the value's retention window has passed. */
export function isExpired(expiresAt: Date | null | undefined, now: Date = new Date()): boolean {
  return Boolean(expiresAt && expiresAt.getTime() <= now.getTime());
}

function observeAgain(meta: StoredFieldMeta, obsId: ObjectId, ctx: ProvenanceContext): void {
  meta.observationIds = [...meta.observationIds.filter((id) => !id.equals(obsId)), obsId].slice(
    -OBSERVATION_IDS_CAP,
  );
  const seen = observedAt(ctx);
  if (!meta.lastObservedAt || meta.lastObservedAt < seen) meta.lastObservedAt = seen;
  meta.confidence = Math.max(meta.confidence, ctx.confidence);
  meta.expiresAt = combineExpiry(meta.expiresAt, ctx.expiresAt ?? null);
}

const MATCH_KEYS_CAP = 40;

/** The stored form of a context's source reference (new refs remember the discovery job that linked them). */
export function storedExternalRef(ctx: ProvenanceContext): StoredExternalRef | null {
  const ref = ctx.externalRef;
  if (!ref) return null;
  return {
    source: ref.source,
    externalId: ref.externalId,
    lastFetchedAt: ctx.collectedAt,
    expiresAt: ref.expiresAt,
    ...(ref.matchKeys?.length
      ? { matchKeys: [...new Set(ref.matchKeys)].slice(0, MATCH_KEYS_CAP) }
      : {}),
    ...(ctx.discoveryJobId ? { discoveryJobId: ctx.discoveryJobId } : {}),
    ...(ref.release !== undefined
      ? {
          release: ref.release,
          dataset: ref.dataset ?? null,
          recordId: ref.recordId ?? null,
          license: ref.license ?? null,
        }
      : {}),
  };
}

function upsertExternalRef(doc: BusinessDocument, ctx: ProvenanceContext): void {
  const ref = ctx.externalRef;
  if (!ref) return;
  const existing = doc.externalRefs.find(
    (r) => r.source === ref.source && r.externalId === ref.externalId,
  );
  if (existing) {
    if (existing.lastFetchedAt < ctx.collectedAt) existing.lastFetchedAt = ctx.collectedAt;
    existing.expiresAt = ref.expiresAt;
    if (ref.matchKeys?.length)
      existing.matchKeys = [...new Set([...(existing.matchKeys ?? []), ...ref.matchKeys])].slice(
        0,
        MATCH_KEYS_CAP,
      );
    if (ref.release !== undefined) {
      existing.release = ref.release;
      existing.dataset = ref.dataset ?? null;
      existing.recordId = ref.recordId ?? null;
      existing.license = ref.license ?? null;
    }
  } else if (doc.externalRefs.length < 20) {
    doc.externalRefs.push(storedExternalRef(ctx)!);
  }
}

function emptyLocation(): StoredLocation {
  return {
    ...locationValue(null),
    rawValue: null,
    regionKey: null,
    localityKey: null,
    lgaKey: null,
    alternatives: [],
    state: "unverified",
    confidence: 0,
    observationIds: [],
    lastObservedAt: null,
    lastVerifiedAt: null,
    expiresAt: null,
  };
}

function storedLocation(
  loc: NormalizedLocation,
  obsId: ObjectId,
  ctx: ProvenanceContext,
): StoredLocation {
  return {
    ...locationValue(loc),
    rawValue: loc.raw,
    regionKey: loc.regionKey,
    localityKey: loc.localityKey,
    lgaKey: loc.lgaKey,
    alternatives: [],
    ...freshMeta(obsId, ctx),
  };
}

function storedPhone(p: PhoneInput, refs: ObservationRefs, ctx: ProvenanceContext): StoredPhone {
  const asserted = p.whatsapp === "user_asserted";
  return {
    e164: p.e164,
    raw: p.raw,
    national: p.national,
    international: p.international,
    country: p.country,
    type: p.type,
    whatsapp: {
      status: asserted ? "user_asserted" : "unknown",
      evidenceObservationId: asserted ? (refs.whatsapp.get(p.e164) ?? null) : null,
      assertedByUserId: asserted ? ctx.actor.userId : null,
      assertedAt: asserted ? ctx.collectedAt : null,
    },
    ...freshMeta(refs.phones.get(p.e164) ?? null, ctx),
  };
}

export interface NewBusinessOptions {
  id: ObjectId;
  slug: string;
  createdVia: BusinessDocument["createdVia"];
}

export function createBusinessDocument(
  organizationId: string,
  input: BusinessInput,
  refs: ObservationRefs,
  ctx: ProvenanceContext,
  opts: NewBusinessOptions,
): BusinessDocument {
  const now = new Date();
  const doc: BusinessDocument = {
    _id: opts.id,
    organizationId,
    name: {
      value: input.name.value,
      rawValue: input.name.raw,
      normalized: input.name.normalized,
      ...freshMeta(refs.name, ctx),
    },
    slug: opts.slug,
    categories: input.categories.map((c) => ({
      value: c.value,
      key: c.key,
      taxonomy: ctx.categoryTaxonomy ?? ("user" as const),
      observationIds: [refs.categories.get(c.key)!].filter(Boolean),
      ...(ctx.expiresAt ? { expiresAt: ctx.expiresAt } : {}),
    })),
    location:
      input.location && refs.location
        ? storedLocation(input.location, refs.location, ctx)
        : emptyLocation(),
    website:
      input.website && refs.website
        ? {
            value: input.website.url,
            rawValue: input.website.raw,
            domain: input.website.domain,
            alternatives: [],
            ...freshMeta(refs.website, ctx),
          }
        : null,
    phones: input.phones.map((p) => storedPhone(p, refs, ctx)),
    emails: input.emails.map((e) => ({
      address: e.address,
      raw: e.raw,
      domain: e.domain,
      verification: null,
      ...freshMeta(refs.emails.get(e.address) ?? null, ctx),
    })),
    socials: input.socials.map((s) => ({
      platform: s.platform,
      url: s.url,
      handle: s.handle,
      raw: s.raw,
      ...freshMeta(refs.socials.get(s.url) ?? null, ctx),
    })),
    externalRefs: ctx.externalRef ? [storedExternalRef(ctx)!] : [],
    sourceSeen: { [ctx.source]: { firstSeenAt: ctx.collectedAt, lastSeenAt: ctx.collectedAt } },
    sources: [ctx.source],
    importIds: ctx.importId ? [ctx.importId] : [],
    whatsappStatus: "unknown",
    lastVerifiedAt: null,
    lastObservedAt: ctx.collectedAt,
    score: null,
    latestAnalysis: null,
    dedup: { status: "unique", mergedIntoId: null, candidateCount: 0, absorbedIds: [] },
    dedupKeys: [],
    flags: {
      suppressed: false,
      suppressedReason: null,
      suppressedAt: null,
      suppressedByUserId: null,
      doNotContact: false,
    },
    search: { tokens: [] },
    createdVia: opts.createdVia,
    retention: { nextExpiryAt: null },
    version: 1,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
  };
  return recomputeDerived(doc);
}

/** True when this exact set of observations was already applied (idempotent reprocessing). */
export function alreadyApplied(doc: BusinessDocument, refs: ObservationRefs): boolean {
  return doc.name.observationIds.some((id) => id.equals(refs.name));
}

/**
 * Merges new observations into an existing business. Multi-valued fields (phones, emails,
 * categories, socials) are unioned. Single-valued fields keep their value when the new
 * observation agrees, fill in when empty, and become `conflicting` with the new value kept
 * as an alternative when it disagrees. Nothing is silently overwritten.
 */
export function mergeIntoBusiness(
  doc: BusinessDocument,
  input: BusinessInput,
  refs: ObservationRefs,
  ctx: ProvenanceContext,
): BusinessDocument {
  // Expiry is judged at the new observation's collection time, so merges are deterministic.
  const now = ctx.collectedAt;
  if (isExpired(doc.name.expiresAt, now) && input.name.normalized) {
    // The stored name is past its source's retention: a fresh observation replaces it.
    doc.name = {
      value: input.name.value,
      rawValue: input.name.raw,
      normalized: input.name.normalized,
      ...freshMeta(refs.name, ctx),
    };
  } else {
    observeAgain(doc.name, refs.name, ctx);
  }

  for (const c of input.categories) {
    const obsId = refs.categories.get(c.key)!;
    const existing = doc.categories.find((x) => x.key === c.key);
    if (existing) {
      existing.observationIds = [...existing.observationIds, obsId].slice(-OBSERVATION_IDS_CAP);
      const expiresAt = combineExpiry(existing.expiresAt, ctx.expiresAt ?? null);
      if (expiresAt) existing.expiresAt = expiresAt;
      else delete existing.expiresAt;
    } else if (doc.categories.length < 20) {
      doc.categories.push({
        value: c.value,
        key: c.key,
        taxonomy: ctx.categoryTaxonomy ?? "user",
        observationIds: [obsId],
        ...(ctx.expiresAt ? { expiresAt: ctx.expiresAt } : {}),
      });
    }
  }

  if (input.website && refs.website) mergeWebsite(doc, input.website, refs.website, ctx);

  for (const s of input.socials) {
    const obsId = refs.socials.get(s.url)!;
    const existing = doc.socials.find((x) => x.url === s.url);
    if (existing) observeAgain(existing, obsId, ctx);
    else if (doc.socials.length < 20)
      doc.socials.push({
        platform: s.platform,
        url: s.url,
        handle: s.handle,
        raw: s.raw,
        ...freshMeta(obsId, ctx),
      });
  }

  for (const p of input.phones) {
    const existing = doc.phones.find((x) => x.e164 === p.e164);
    if (!existing) {
      if (doc.phones.length < 20) doc.phones.push(storedPhone(p, refs, ctx));
      continue;
    }
    observeAgain(existing, refs.phones.get(p.e164)!, ctx);
    if (p.whatsapp === "user_asserted" && existing.whatsapp.status === "unknown") {
      existing.whatsapp = {
        status: "user_asserted",
        evidenceObservationId: refs.whatsapp.get(p.e164) ?? null,
        assertedByUserId: ctx.actor.userId,
        assertedAt: ctx.collectedAt,
      };
    }
  }

  for (const e of input.emails) {
    const existing = doc.emails.find((x) => x.address === e.address);
    const obsId = refs.emails.get(e.address)!;
    if (existing) observeAgain(existing, obsId, ctx);
    else if (doc.emails.length < 20)
      doc.emails.push({
        address: e.address,
        raw: e.raw,
        domain: e.domain,
        verification: null,
        ...freshMeta(obsId, ctx),
      });
  }

  if (input.location && refs.location) mergeLocation(doc, input.location, refs.location, ctx);

  const seen = doc.sourceSeen[ctx.source];
  doc.sourceSeen[ctx.source] = {
    firstSeenAt: seen && seen.firstSeenAt < ctx.collectedAt ? seen.firstSeenAt : ctx.collectedAt,
    lastSeenAt: seen && seen.lastSeenAt > ctx.collectedAt ? seen.lastSeenAt : ctx.collectedAt,
  };
  if (ctx.importId && !doc.importIds.some((id) => id.equals(ctx.importId!)))
    doc.importIds.push(ctx.importId);
  upsertExternalRef(doc, ctx);
  doc.updatedAt = new Date();
  return recomputeDerived(doc);
}

function mergeWebsite(
  doc: BusinessDocument,
  w: WebsiteInput,
  obsId: ObjectId,
  ctx: ProvenanceContext,
): void {
  if (
    !doc.website ||
    (isExpired(doc.website.expiresAt, ctx.collectedAt) && doc.website.domain !== w.domain)
  ) {
    const alternatives = (doc.website?.alternatives ?? []).filter(
      (a) => !isExpired(a.expiresAt, ctx.collectedAt),
    );
    doc.website = {
      value: w.url,
      rawValue: w.raw,
      domain: w.domain,
      alternatives,
      ...freshMeta(obsId, ctx),
    };
    return;
  }
  if (doc.website.domain === w.domain) {
    observeAgain(doc.website, obsId, ctx);
    return;
  }
  const alt = doc.website.alternatives.find((a) => a.value === w.url);
  if (alt) {
    alt.observationIds = [...alt.observationIds, obsId].slice(-OBSERVATION_IDS_CAP);
    alt.lastObservedAt = ctx.collectedAt;
    alt.expiresAt = combineExpiry(alt.expiresAt, ctx.expiresAt ?? null);
  } else if (doc.website.alternatives.length < 10) {
    doc.website.alternatives.push({
      value: w.url,
      rawValue: w.raw,
      observationIds: [obsId],
      lastObservedAt: ctx.collectedAt,
      expiresAt: ctx.expiresAt ?? null,
    });
  }
  doc.website.state = "conflicting";
}

const LOCATION_PARTS = ["street", "locality", "lga", "region", "country", "postalCode"] as const;

function mergeLocation(
  doc: BusinessDocument,
  loc: NormalizedLocation,
  obsId: ObjectId,
  ctx: ProvenanceContext,
): void {
  const current = doc.location;
  if (!locationHasValue(current) || isExpired(current.expiresAt, ctx.collectedAt)) {
    const alternatives = current.alternatives.filter(
      (a) => !isExpired(a.expiresAt, ctx.collectedAt),
    );
    doc.location = { ...storedLocation(loc, obsId, ctx), alternatives };
    return;
  }
  const disagrees = LOCATION_PARTS.some((part) => {
    const a = current[part];
    const b = loc[part];
    return a !== null && b !== null && normalizeKey(a) !== normalizeKey(b);
  });
  if (disagrees) {
    const value = locationValue(loc);
    const existingAlt = current.alternatives.find((a) => a.value.formatted === value.formatted);
    if (existingAlt) {
      existingAlt.observationIds = [...existingAlt.observationIds, obsId].slice(
        -OBSERVATION_IDS_CAP,
      );
      existingAlt.lastObservedAt = ctx.collectedAt;
      existingAlt.expiresAt = combineExpiry(existingAlt.expiresAt, ctx.expiresAt ?? null);
    } else if (current.alternatives.length < 10) {
      current.alternatives.push({
        value,
        rawValue: loc.raw,
        observationIds: [obsId],
        lastObservedAt: ctx.collectedAt,
        expiresAt: ctx.expiresAt ?? null,
      });
    }
    current.state = "conflicting";
    return;
  }
  // Agreeing observation: fill any gaps and refresh.
  for (const part of LOCATION_PARTS)
    if (current[part] === null && loc[part] !== null) current[part] = loc[part];
  current.regionKey = current.regionKey ?? loc.regionKey;
  current.localityKey = current.localityKey ?? loc.localityKey;
  current.lgaKey = current.lgaKey ?? loc.lgaKey;
  if (loc.formatted && (current.formatted?.length ?? 0) < loc.formatted.length)
    current.formatted = loc.formatted;
  observeAgain(current, obsId, ctx);
}

const MAX_TOKENS = 200;

/** Recomputes the denormalized fields used for search, filters and sorting. */
export function recomputeDerived(doc: BusinessDocument): BusinessDocument {
  const words = new Set<string>();
  const add = (v: string | null | undefined) => {
    for (const w of searchWords(v)) if (words.size < MAX_TOKENS) words.add(w);
  };
  // A purged name (retention ended) is a label, not data: keep it out of search.
  if (doc.name.normalized) add(doc.name.value);
  for (const c of doc.categories) add(c.value);
  add(doc.location.locality);
  add(doc.location.lga);
  add(doc.location.region);
  add(doc.location.street);
  if (doc.website) {
    add(doc.website.domain);
    if (words.size < MAX_TOKENS) words.add(doc.website.domain);
  }
  for (const e of doc.emails) {
    add(e.address);
    if (words.size < MAX_TOKENS) words.add(e.address);
  }
  for (const p of doc.phones) {
    if (words.size < MAX_TOKENS) words.add(p.e164.replace(/\D/g, ""));
    if (p.national) {
      const digits = nationalDigits(p.national);
      for (const d of [digits, digits.replace(/^0+/, "")])
        if (d && words.size < MAX_TOKENS) words.add(d);
    }
  }
  for (const s of doc.socials) add(s.handle);
  doc.search = { tokens: [...words] };
  doc.dedupKeys = doc.name.normalized
    ? blockingKeys(doc.name.normalized, doc.location.localityKey, doc.location.lgaKey)
    : [];

  doc.whatsappStatus = bestWhatsApp(doc.phones.map((p) => p.whatsapp.status));

  const metas: StoredFieldMeta[] = [
    doc.name,
    doc.location,
    ...doc.phones,
    ...doc.emails,
    ...doc.socials,
  ];
  if (doc.website) metas.push(doc.website);
  const maxDate = (dates: Array<Date | null>) =>
    dates.reduce<Date | null>((m, d) => (d && (!m || d > m) ? d : m), null);
  doc.lastVerifiedAt = maxDate(metas.map((m) => m.lastVerifiedAt));
  doc.lastObservedAt = maxDate(metas.map((m) => m.lastObservedAt));
  doc.sources = (Object.keys(doc.sourceSeen) as SourceKey[]).sort();

  // Earliest expiry among values still stored. A purged name (empty normalized key) and a
  // cleared location keep their past expiresAt as metadata and no longer count.
  const expiries: Array<Date | null | undefined> = [
    ...doc.phones.map((p) => p.expiresAt),
    ...doc.emails.map((e) => e.expiresAt),
    ...doc.socials.map((s) => s.expiresAt),
    ...doc.categories.map((c) => c.expiresAt),
    ...doc.location.alternatives.map((a) => a.expiresAt),
  ];
  if (doc.name.normalized) expiries.push(doc.name.expiresAt);
  if (locationHasValue(doc.location)) expiries.push(doc.location.expiresAt);
  if (doc.website)
    expiries.push(doc.website.expiresAt, ...doc.website.alternatives.map((a) => a.expiresAt));
  const live = expiries.filter((d): d is Date => d instanceof Date);
  doc.retention = { nextExpiryAt: live.reduce<Date | null>((m, d) => (!m || d < m ? d : m), null) };
  return doc;
}

/** Label stored in place of a purged name (contracts EXPIRED_NAME_LABEL). */
export const PURGED_NAME_VALUE = "Name expired under source terms";

/**
 * Removes values whose source retention has passed (security policy section 7, data
 * minimization). Expired phones, emails, socials, categories and alternatives are dropped;
 * an expired website or location is cleared; an expired name is replaced by a label (the
 * record keeps its source reference, for example a Google place ID, so it can be refreshed).
 * Values corroborated by a source without a limit have no expiry and are kept. Returns true
 * when anything changed.
 */
export function purgeExpiredValues(doc: BusinessDocument, now: Date = new Date()): boolean {
  let changed = false;
  const keep = <T extends { expiresAt?: Date | null }>(items: T[]): T[] => {
    const kept = items.filter((x) => !isExpired(x.expiresAt, now));
    if (kept.length !== items.length) changed = true;
    return kept;
  };
  if (
    isExpired(doc.name.expiresAt, now) &&
    (doc.name.rawValue !== null || doc.name.normalized !== "")
  ) {
    doc.name = { ...doc.name, value: PURGED_NAME_VALUE, rawValue: null, normalized: "" };
    changed = true;
  }
  doc.categories = keep(doc.categories);
  doc.phones = keep(doc.phones);
  doc.emails = keep(doc.emails);
  doc.socials = keep(doc.socials);
  if (doc.website) {
    doc.website.alternatives = keep(doc.website.alternatives);
    if (isExpired(doc.website.expiresAt, now)) {
      doc.website = null;
      changed = true;
    }
  }
  doc.location.alternatives = keep(doc.location.alternatives);
  if (isExpired(doc.location.expiresAt, now) && locationHasValue(doc.location)) {
    doc.location = {
      ...emptyLocation(),
      alternatives: doc.location.alternatives,
      expiresAt: doc.location.expiresAt,
    };
    changed = true;
  }
  if (changed) {
    doc.updatedAt = now;
    recomputeDerived(doc);
  } else if (doc.retention?.nextExpiryAt && doc.retention.nextExpiryAt <= now) {
    recomputeDerived(doc);
    changed = true;
  }
  return changed;
}

// ---------------------------------------------------------------------------
// Website contacts (enrichment) and email checks
// ---------------------------------------------------------------------------

/** Contacts observed on a business's website, each with the observation that recorded it. */
export interface WebsiteContactsInput {
  /** True when the pages were on the business's own site (its website domain). */
  ownSite: boolean;
  phones: Array<{ phone: PhoneInput; obsId: ObjectId }>;
  emails: Array<{ email: EmailInput; obsId: ObjectId }>;
  socials: Array<{
    social: { platform: StoredSocialPlatform; url: string; handle: string | null; raw: string };
    obsId: ObjectId;
  }>;
  /** Numbers with explicit WhatsApp evidence (wa.me link or label) on the own site. */
  whatsapp: Array<{ e164: string; obsId: ObjectId }>;
}

type StoredSocialPlatform = BusinessDocument["socials"][number]["platform"];

export interface WebsiteContactsChange {
  phonesAdded: string[];
  phonesVerified: string[];
  whatsappConfirmed: string[];
  emailsAdded: string[];
  socialsAdded: string[];
}

/**
 * Applies website observations. Phones, emails and socials are unioned like any ingest. A phone
 * is set `verified` only when it is valid for its numbering plan (every parsed phone is) AND was
 * observed on the business's own website (PRODUCT_REQUIREMENTS section 5). WhatsApp becomes
 * `confirmed` only from explicit evidence on the own site. Emails stay `unverified`: release 1
 * does no mailbox probing.
 */
export function mergeWebsiteContacts(
  doc: BusinessDocument,
  input: WebsiteContactsInput,
  ctx: ProvenanceContext,
): WebsiteContactsChange {
  const change: WebsiteContactsChange = {
    phonesAdded: [],
    phonesVerified: [],
    whatsappConfirmed: [],
    emailsAdded: [],
    socialsAdded: [],
  };
  for (const { phone, obsId } of input.phones) {
    let stored = doc.phones.find((p) => p.e164 === phone.e164);
    if (!stored) {
      if (doc.phones.length >= 20) continue;
      stored = {
        e164: phone.e164,
        raw: phone.raw,
        national: phone.national,
        international: phone.international,
        country: phone.country,
        type: phone.type,
        whatsapp: {
          status: "unknown",
          evidenceObservationId: null,
          assertedByUserId: null,
          assertedAt: null,
        },
        ...freshMeta(obsId, ctx),
      };
      doc.phones.push(stored);
      change.phonesAdded.push(phone.e164);
    } else {
      observeAgain(stored, obsId, ctx);
    }
    if (input.ownSite && stored.state !== "conflicting") {
      stored.state = "verified";
      stored.lastVerifiedAt = ctx.collectedAt;
      change.phonesVerified.push(phone.e164);
    }
  }
  if (input.ownSite) {
    for (const { e164, obsId } of input.whatsapp) {
      const stored = doc.phones.find((p) => p.e164 === e164);
      if (!stored) continue;
      stored.whatsapp = {
        status: "confirmed",
        evidenceObservationId: obsId,
        assertedByUserId: stored.whatsapp.assertedByUserId,
        assertedAt: stored.whatsapp.assertedAt,
      };
      change.whatsappConfirmed.push(e164);
    }
  }
  for (const { email, obsId } of input.emails) {
    const existing = doc.emails.find((e) => e.address === email.address);
    if (existing) observeAgain(existing, obsId, ctx);
    else if (doc.emails.length < 20) {
      doc.emails.push({
        address: email.address,
        raw: email.raw,
        domain: email.domain,
        verification: null,
        ...freshMeta(obsId, ctx),
      });
      change.emailsAdded.push(email.address);
    }
  }
  for (const { social, obsId } of input.socials) {
    const existing = doc.socials.find((x) => x.url.toLowerCase() === social.url.toLowerCase());
    if (existing) observeAgain(existing, obsId, ctx);
    else if (doc.socials.length < 20) {
      doc.socials.push({
        platform: social.platform,
        url: social.url,
        handle: social.handle,
        raw: social.raw,
        ...freshMeta(obsId, ctx),
      });
      change.socialsAdded.push(social.url);
    }
  }
  const seen = doc.sourceSeen[ctx.source];
  doc.sourceSeen[ctx.source] = {
    firstSeenAt: seen && seen.firstSeenAt < ctx.collectedAt ? seen.firstSeenAt : ctx.collectedAt,
    lastSeenAt: seen && seen.lastSeenAt > ctx.collectedAt ? seen.lastSeenAt : ctx.collectedAt,
  };
  doc.updatedAt = new Date();
  recomputeDerived(doc);
  return change;
}

/** Records an email check summary; the state is left as it was (an email is never verified in release 1). */
export function applyEmailCheck(
  doc: BusinessDocument,
  address: string,
  verification: { method: string; result: string; checkedAt: Date },
): boolean {
  const email = doc.emails.find((e) => e.address === address);
  if (!email) return false;
  email.verification = verification;
  doc.updatedAt = new Date();
  return true;
}

// ---------------------------------------------------------------------------
// Corrections
// ---------------------------------------------------------------------------

export type NormalizedCorrection =
  | { field: "name"; value: { value: string; normalized: string }; raw: string }
  | { field: "website"; value: WebsiteInput | null }
  | { field: "phone"; target: string | null; value: PhoneInput | null }
  | { field: "email"; target: string | null; value: EmailInput | null }
  | { field: "whatsapp"; target: string; value: "user_asserted" | "unknown" }
  | { field: "categories"; value: CategoryInput[] }
  | { field: "location"; value: NormalizedLocation | null };

export class CorrectionTargetError extends Error {
  constructor(
    readonly path: string,
    message: string,
  ) {
    super(message);
    this.name = "CorrectionTargetError";
  }
}

/**
 * Applies a user correction in place. The corrected value becomes `unverified` (a person
 * typing it is not a verification method) and resolves any conflict on that field.
 * Returns before/after snapshots of the field for the audit log.
 */
export function applyCorrection(
  doc: BusinessDocument,
  c: NormalizedCorrection,
  obsId: ObjectId,
  ctx: ProvenanceContext,
): { before: unknown; after: unknown } {
  const meta = () => freshMeta(obsId, ctx);
  let before: unknown;
  let after: unknown;

  switch (c.field) {
    case "name":
      before = doc.name.value;
      doc.name = {
        value: c.value.value,
        rawValue: c.raw,
        normalized: c.value.normalized,
        ...meta(),
      };
      after = doc.name.value;
      break;
    case "website":
      before = doc.website?.value ?? null;
      doc.website = c.value
        ? {
            value: c.value.url,
            rawValue: c.value.raw,
            domain: c.value.domain,
            alternatives: [],
            ...meta(),
          }
        : null;
      after = doc.website?.value ?? null;
      break;
    case "phone": {
      before = doc.phones.map((p) => p.e164);
      const index = c.target === null ? -1 : doc.phones.findIndex((p) => p.e164 === c.target);
      if (c.target !== null && index === -1)
        throw new CorrectionTargetError("target", "That phone number is not on this business");
      const previous = index >= 0 ? doc.phones[index]! : null;
      if (index >= 0) doc.phones.splice(index, 1);
      if (c.value) {
        const existing = doc.phones.findIndex((p) => p.e164 === c.value!.e164);
        const keep =
          existing >= 0
            ? doc.phones.splice(existing, 1)[0]!
            : previous?.e164 === c.value.e164
              ? previous
              : null;
        const entry: StoredPhone = {
          e164: c.value.e164,
          raw: c.value.raw,
          national: c.value.national,
          international: c.value.international,
          country: c.value.country,
          type: c.value.type,
          whatsapp: keep?.whatsapp ?? {
            status: "unknown",
            evidenceObservationId: null,
            assertedByUserId: null,
            assertedAt: null,
          },
          ...meta(),
        };
        doc.phones.splice(
          index >= 0 ? Math.min(index, doc.phones.length) : doc.phones.length,
          0,
          entry,
        );
      }
      after = doc.phones.map((p) => p.e164);
      break;
    }
    case "email": {
      before = doc.emails.map((e) => e.address);
      const index = c.target === null ? -1 : doc.emails.findIndex((e) => e.address === c.target);
      if (c.target !== null && index === -1)
        throw new CorrectionTargetError("target", "That email address is not on this business");
      if (index >= 0) doc.emails.splice(index, 1);
      if (c.value) {
        const existing = doc.emails.findIndex((e) => e.address === c.value!.address);
        if (existing >= 0) doc.emails.splice(existing, 1);
        doc.emails.splice(index >= 0 ? Math.min(index, doc.emails.length) : doc.emails.length, 0, {
          address: c.value.address,
          raw: c.value.raw,
          domain: c.value.domain,
          verification: null,
          ...meta(),
        });
      }
      after = doc.emails.map((e) => e.address);
      break;
    }
    case "whatsapp": {
      const phone = doc.phones.find((p) => p.e164 === c.target);
      if (!phone)
        throw new CorrectionTargetError("target", "That phone number is not on this business");
      before = { phone: phone.e164, status: phone.whatsapp.status };
      phone.whatsapp =
        c.value === "user_asserted"
          ? {
              status: "user_asserted",
              evidenceObservationId: obsId,
              assertedByUserId: ctx.actor.userId,
              assertedAt: ctx.collectedAt,
            }
          : {
              status: "unknown",
              evidenceObservationId: null,
              assertedByUserId: null,
              assertedAt: null,
            };
      after = { phone: phone.e164, status: phone.whatsapp.status };
      break;
    }
    case "categories":
      before = doc.categories.map((x) => x.value);
      doc.categories = c.value.map((cat) => ({
        value: cat.value,
        key: cat.key,
        taxonomy: "user" as const,
        observationIds: [obsId],
      }));
      after = doc.categories.map((x) => x.value);
      break;
    case "location":
      before = doc.location.formatted;
      doc.location = c.value ? storedLocation(c.value, obsId, ctx) : emptyLocation();
      after = doc.location.formatted;
      break;
  }

  const seen = doc.sourceSeen[ctx.source];
  doc.sourceSeen[ctx.source] = {
    firstSeenAt: seen?.firstSeenAt ?? ctx.collectedAt,
    lastSeenAt: ctx.collectedAt,
  };
  doc.updatedAt = new Date();
  recomputeDerived(doc);
  return { before, after };
}

/** The normalized value a correction observation records. */
export function correctionObservationValue(c: NormalizedCorrection): {
  field: ObservationField;
  fieldKey: string | null;
  rawValue: string | null;
  normalizedValue: ObservationDocument["normalizedValue"];
  action: "set" | "remove";
} {
  switch (c.field) {
    case "name":
      return {
        field: "name",
        fieldKey: null,
        rawValue: c.raw,
        normalizedValue: c.value.value,
        action: "set",
      };
    case "website":
      return c.value
        ? {
            field: "website",
            fieldKey: c.value.domain,
            rawValue: c.value.raw,
            normalizedValue: c.value.url,
            action: "set",
          }
        : {
            field: "website",
            fieldKey: null,
            rawValue: null,
            normalizedValue: null,
            action: "remove",
          };
    case "phone":
      return c.value
        ? {
            field: "phone",
            fieldKey: c.value.e164,
            rawValue: c.value.raw,
            normalizedValue: c.value.e164,
            action: "set",
          }
        : {
            field: "phone",
            fieldKey: c.target,
            rawValue: null,
            normalizedValue: null,
            action: "remove",
          };
    case "email":
      return c.value
        ? {
            field: "email",
            fieldKey: c.value.address,
            rawValue: c.value.raw,
            normalizedValue: c.value.address,
            action: "set",
          }
        : {
            field: "email",
            fieldKey: c.target,
            rawValue: null,
            normalizedValue: null,
            action: "remove",
          };
    case "whatsapp":
      return {
        field: "whatsapp",
        fieldKey: c.target,
        rawValue: c.value,
        normalizedValue: c.value,
        action: "set",
      };
    case "categories":
      return {
        field: "category",
        fieldKey: null,
        rawValue: c.value.map((x) => x.raw).join("; ") || null,
        normalizedValue: c.value.map((x) => x.value),
        action: c.value.length > 0 ? "set" : "remove",
      };
    case "location": {
      if (!c.value)
        return {
          field: "location",
          fieldKey: null,
          rawValue: null,
          normalizedValue: null,
          action: "remove",
        };
      const { formatted: _f, ...parts } = locationValue(c.value);
      return {
        field: "location",
        fieldKey: null,
        rawValue: c.value.raw,
        normalizedValue: parts,
        action: "set",
      };
    }
  }
}
