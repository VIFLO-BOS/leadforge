import { describe, expect, it } from "vitest";
import { ObjectId } from "@leadforge/db-mongo";
import { EXPIRED_NAME_LABEL } from "@leadforge/contracts";
import { normalizeCreateRequest, type BusinessInput } from "./business-input.js";
import {
  buildObservations,
  combineExpiry,
  createBusinessDocument,
  mergeIntoBusiness,
  purgeExpiredValues,
  PURGED_NAME_VALUE,
  type ProvenanceContext,
} from "./business-model.js";
import { toDetail, toListItem } from "./business-view.js";
import { toObservationView } from "../provenance/provenance.view.js";
import { discoveryBackoffDelay } from "../queue/queue.constants.js";

const ORG = "0192c9a8-0000-7000-8000-000000000001";
const T0 = new Date("2026-10-25T12:00:00.000Z");
const MIN = 60_000;

function input(name = "Ikeja Restaurant 01 (Sample)"): BusinessInput {
  const { input: i, errors } = normalizeCreateRequest(
    {
      name,
      categories: ["Restaurant"],
      website: "https://restaurant-01.example.test/",
      phones: ["+44 113 496 0701"],
      emails: [],
      location: { street: "1 Sample Street", locality: "Ikeja", region: "Lagos", country: "NG" },
    },
    "NG",
  );
  if (!i) throw new Error(JSON.stringify(errors));
  return i;
}

/** Google-like context: values expire at `expiresAt`, the place ID is kept. */
function places(
  collectedAt: Date,
  expiresAt: Date | null,
  placeId = "fixture-restaurant-01",
): ProvenanceContext {
  return {
    source: "google_places",
    collectionMethod: "api",
    sourceRef: `places/${placeId}`,
    collectedAt,
    confidence: 0.8,
    actor: { type: "system", userId: null },
    importId: null,
    note: null,
    idSeed: `discovery:job:${placeId}:${collectedAt.getTime()}`,
    expiresAt,
    sourceExternalId: placeId,
    categoryTaxonomy: "google",
    externalRef: { source: "google_places", externalId: placeId, expiresAt: null },
    attribution: "Google Maps",
  };
}

function imported(collectedAt: Date): ProvenanceContext {
  return {
    source: "user_import",
    collectionMethod: "user_import",
    sourceRef: "import:x",
    collectedAt,
    confidence: 0.6,
    actor: { type: "user", userId: null },
    importId: null,
    note: null,
    idSeed: null,
  };
}

function create(c: ProvenanceContext, i = input()) {
  const id = new ObjectId();
  const { refs, observations } = buildObservations(ORG, id, i, c);
  const doc = createBusinessDocument(ORG, i, refs, c, {
    id,
    slug: "x",
    createdVia: { kind: "discovery", importId: null, userId: null },
  });
  return { doc, observations };
}

describe("source retention on business records", () => {
  it("combines expiry: a value from a source without a limit never expires; two limits keep the later", () => {
    const a = new Date(T0.getTime() + MIN);
    const b = new Date(T0.getTime() + 2 * MIN);
    expect(combineExpiry(a, b)).toEqual(b);
    expect(combineExpiry(b, a)).toEqual(b);
    expect(combineExpiry(a, null)).toBeNull();
    expect(combineExpiry(null, a)).toBeNull();
  });

  it("stamps every value and observation from a limited source with expiresAt, keeps the place ID and category taxonomy", () => {
    const { doc, observations } = create(places(T0, T0));
    expect(doc.name.expiresAt).toEqual(T0);
    expect(doc.phones[0]!.expiresAt).toEqual(T0);
    expect(doc.website!.expiresAt).toEqual(T0);
    expect(doc.location.expiresAt).toEqual(T0);
    expect(doc.categories[0]).toMatchObject({ taxonomy: "google", expiresAt: T0 });
    expect(doc.externalRefs).toEqual([
      {
        source: "google_places",
        externalId: "fixture-restaurant-01",
        lastFetchedAt: T0,
        expiresAt: null,
      },
    ]);
    expect(doc.retention?.nextExpiryAt).toEqual(T0);
    expect(doc.phones[0]!.whatsapp.status).toBe("unknown");
    for (const o of observations) {
      expect(o.policy).toEqual({ retainValueUntil: T0 });
      expect(o.sourceExternalId).toBe("fixture-restaurant-01");
      expect(o.metadata.attribution).toBe("Google Maps");
    }
  });

  it("hides expired values on read: list name label, detail nulls, observation values and keys", () => {
    const { doc, observations } = create(places(T0, T0));
    const later = { now: new Date(T0.getTime() + 1000), freshnessDays: 180 };
    const item = toListItem(doc, later);
    expect(item.name).toBe(EXPIRED_NAME_LABEL);
    expect(item.states.name).toBe("expired");
    expect(item.phone).toMatchObject({ value: null, state: "expired" });
    expect(item.website).toMatchObject({ value: null, domain: null, state: "expired" });
    expect(item.location.formatted).toBeNull();
    expect(item.categories).toEqual([]);
    const detail = toDetail(doc, later, {
      freshnessDays: 180,
      recentObservations: observations,
      totalObservations: observations.length,
      observationCounts: { google_places: observations.length },
      recentVerificationEvents: [],
      suppressionEntries: [],
    });
    expect(detail.name).toMatchObject({ value: null, rawValue: null, state: "expired" });
    expect(detail.externalRefs[0]!.externalId).toBe("fixture-restaurant-01");
    const obs = toObservationView(
      observations.find((o) => o.field === "phone")!,
      later.now,
    );
    expect(obs).toMatchObject({
      rawValue: null,
      normalizedValue: null,
      fieldKey: null,
      redacted: true,
      sourceExternalId: "fixture-restaurant-01",
      attribution: "Google Maps",
    });
  });

  it("keeps a value visible when another source without a limit corroborates it", () => {
    const { doc } = create(places(T0, T0));
    const i = input();
    const c = imported(new Date(T0.getTime() + MIN));
    const { refs } = buildObservations(ORG, doc._id, i, c);
    mergeIntoBusiness(doc, i, refs, c);
    expect(doc.phones[0]!.expiresAt).toBeNull();
    expect(doc.website!.expiresAt).toBeNull();
    const view = toListItem(doc, { now: new Date(T0.getTime() + 10 * MIN), freshnessDays: 180 });
    expect(view.phone?.state).toBe("unverified");
  });

  it("replaces an expired name with a fresh observation of the same place", () => {
    const { doc } = create(places(T0, T0));
    purgeExpiredValues(doc, new Date(T0.getTime() + MIN));
    const t1 = new Date(T0.getTime() + 2 * MIN);
    const renamed = input("Ikeja Grill (Sample)");
    const c = places(t1, new Date(t1.getTime() + 30 * 24 * 60 * MIN));
    const { refs } = buildObservations(ORG, doc._id, renamed, c);
    mergeIntoBusiness(doc, renamed, refs, c);
    expect(doc.name.value).toBe("Ikeja Grill (Sample)");
    expect(doc.name.normalized).not.toBe("");
    expect(doc.externalRefs).toHaveLength(1);
    expect(doc.externalRefs[0]!.lastFetchedAt).toEqual(t1);
  });

  it("purges expired values from storage but keeps the place reference and corroborated values", () => {
    const { doc } = create(places(T0, T0));
    // An email from another source (no retention limit) on the same record.
    doc.emails.push({
      address: "hello@restaurant-01.example.test",
      raw: "hello@restaurant-01.example.test",
      domain: "restaurant-01.example.test",
      verification: null,
      state: "unverified",
      confidence: 0.6,
      observationIds: [new ObjectId()],
      lastObservedAt: T0,
      lastVerifiedAt: null,
      expiresAt: null,
    });

    expect(purgeExpiredValues(doc, new Date(T0.getTime() - 1))).toBe(false);
    expect(purgeExpiredValues(doc, new Date(T0.getTime() + MIN))).toBe(true);
    expect(doc.name.value).toBe(PURGED_NAME_VALUE);
    expect(doc.name.rawValue).toBeNull();
    expect(doc.phones).toEqual([]);
    expect(doc.website).toBeNull();
    expect(doc.categories).toEqual([]);
    expect(doc.location.formatted).toBeNull();
    expect(doc.emails.map((e) => e.address)).toEqual(["hello@restaurant-01.example.test"]);
    expect(doc.externalRefs[0]!.externalId).toBe("fixture-restaurant-01");
    expect(doc.search.tokens).not.toContain("ikeja");
    expect(doc.retention?.nextExpiryAt).toBeNull();
    // Idempotent.
    expect(purgeExpiredValues(doc, new Date(T0.getTime() + 2 * MIN))).toBe(false);
  });
});

describe("discovery retry backoff", () => {
  it("doubles from 30 s and caps at 10 minutes (ARCHITECTURE section 8)", () => {
    const delays = [1, 2, 3, 4, 5, 6, 7].map((n) => discoveryBackoffDelay(n, 30_000, 600_000));
    expect(delays).toEqual([30_000, 60_000, 120_000, 240_000, 480_000, 600_000, 600_000]);
    expect(discoveryBackoffDelay(0, 30_000, 600_000)).toBe(30_000);
  });
});
