import { describe, expect, it } from "vitest";
import { cloneBson, EJSON, ObjectId } from "@leadforge/db-mongo";
import { normalizeCreateRequest } from "../businesses/business-input.js";
import {
  buildObservations,
  createBusinessDocument,
  type ProvenanceContext,
} from "../businesses/business-model.js";
import type { BusinessDocument } from "../businesses/business.types.js";
import { blockingKeys, nameSimilarity } from "../normalization/similarity.js";
import { evaluatePair, NAME_THRESHOLD_WITH_LOCATION, pairKey } from "./candidate-scoring.js";
import { mergeRecords } from "./merge.js";

const ORG = "0192c9a8-0000-7000-8000-000000000001";
const NOW = new Date("2026-10-25T12:00:00.000Z");

function business(
  spec: Partial<Parameters<typeof normalizeCreateRequest>[0]> & { name: string },
  source: ProvenanceContext["source"] = "user_import",
): BusinessDocument {
  const { input, errors } = normalizeCreateRequest(
    { categories: [], phones: [], emails: [], ...spec },
    "NG",
  );
  if (!input) throw new Error(JSON.stringify(errors));
  const c: ProvenanceContext = {
    source,
    collectionMethod: source === "website" ? "website_fetch" : "user_import",
    sourceRef: null,
    collectedAt: NOW,
    confidence: 0.6,
    actor: { type: "system", userId: null },
    importId: null,
    note: null,
    idSeed: null,
  };
  const id = new ObjectId();
  const { refs } = buildObservations(ORG, id, input, c);
  return createBusinessDocument(ORG, input, refs, c, {
    id,
    slug: `b-${id.toHexString()}`,
    createdVia: { kind: "manual", importId: null, userId: null },
  });
}

describe("name similarity and blocking keys", () => {
  it("scores close names high and different names low", () => {
    expect(nameSimilarity("mama put kitchen", "mama put kitchen")).toBe(1);
    expect(nameSimilarity("mama put kitchen", "mama put kitchen and grill")).toBeGreaterThan(0.85);
    expect(nameSimilarity("grace pharmacy", "favour bakery")).toBeLessThan(0.5);
    expect(nameSimilarity("", "anything")).toBe(0);
    expect(nameSimilarity("mamaput kitchen", "mama put kitchen")).toBe(1);
    expect(nameSimilarity("mama put kitchens", "mama put kitchen")).toBeGreaterThan(0.9);
    expect(nameSimilarity("acme foods", "zenith motors")).toBe(0);
  });

  it("pairs distinctive name tokens with the locality and LGA only", () => {
    expect(blockingKeys("the mama put kitchen enterprises", "ikeja", "ikeja")).toEqual(
      expect.arrayContaining(["kitchen|l:ikeja", "kitchen|g:ikeja", "mama|l:ikeja", "put|l:ikeja"]),
    );
    expect(blockingKeys("mama put", null, null)).toEqual([]);
  });

  it("orders pair keys so (a, b) and (b, a) are one candidate", () => {
    expect(pairKey("b", "a")).toEqual({ key: "a:b", ids: ["a", "b"] });
  });
});

describe("candidate scoring thresholds", () => {
  it("never makes a name-only match a candidate, even with identical names", () => {
    const a = business({
      name: "Grace Pharmacy",
      location: { locality: "Ikeja", region: "Lagos" },
    });
    const b = business({ name: "Grace Pharmacy", location: { locality: "Wuse", region: "Abuja" } });
    expect(nameSimilarity(a.name.normalized, b.name.normalized)).toBe(1);
    expect(evaluatePair(a, b, NOW)).toBeNull();
    // Same region alone is not "close": still no candidate.
    const c = business({ name: "Grace Pharmacy", location: { locality: "Yaba", region: "Lagos" } });
    expect(evaluatePair(a, c, NOW)).toBeNull();
    // No location at all: nothing corroborates.
    expect(
      evaluatePair(business({ name: "Grace Pharmacy" }), business({ name: "Grace Pharmacy" }), NOW),
    ).toBeNull();
  });

  it("needs high name similarity when only the locality corroborates", () => {
    const a = business({
      name: "Mama Put Kitchen",
      location: { locality: "Ikeja", region: "Lagos" },
    });
    const near = business({
      name: "Mama Put Kitchen Ikeja",
      location: { locality: "Ikeja", region: "Lagos" },
    });
    const other = business({
      name: "Mama Cass Restaurant",
      location: { locality: "Ikeja", region: "Lagos" },
    });
    const hit = evaluatePair(a, near, NOW)!;
    expect(hit.stage).toBe("name_location");
    expect(hit.signals.map((s) => s.kind)).toEqual(["name_similarity", "same_locality"]);
    expect(hit.signals[0]!.similarity).toBeGreaterThanOrEqual(NAME_THRESHOLD_WITH_LOCATION);
    expect(hit.reasons[0]).toMatch(/Both are in Ikeja/);
    expect(evaluatePair(a, other, NOW)).toBeNull();
  });

  it("accepts a lower name similarity when a phone, email or domain is shared, and explains it", () => {
    const a = business({ name: "Acme Foods", phones: ["0803 123 4567"] });
    const b = business({ name: "Acme Foods Catering", phones: ["0803 123 4567"] });
    const hit = evaluatePair(a, b, NOW)!;
    expect(hit.stage).toBe("phone");
    expect(hit.reasons[0]).toBe("Both list the phone +2348031234567");
    expect(hit.score).toBeGreaterThan(0.6);
    // A shared phone with an unrelated name stays out of the queue.
    expect(
      evaluatePair(a, business({ name: "Zenith Motors", phones: ["0803 123 4567"] }), NOW),
    ).toBeNull();
  });
});

describe("merge and undo snapshots", () => {
  it("combines the records, keeps the other website as an alternative, and leaves the inputs untouched", () => {
    const survivor = business({
      name: "Acme Foods",
      phones: ["0803 123 4567"],
      website: "acme.example.test",
      categories: ["Restaurant"],
      location: { locality: "Ikeja", region: "Lagos" },
    });
    const merged = business(
      {
        name: "ACME FOODS LTD",
        phones: ["0803 123 4567", "0812 000 1111"],
        emails: ["hi@acme.example.test"],
        website: "acmefoods.example.test",
        categories: ["Catering"],
      },
      "website",
    );
    const before = {
      s: EJSON.stringify(survivor, { relaxed: false }),
      m: EJSON.stringify(merged, { relaxed: false }),
    };
    const result = mergeRecords(survivor, merged, { website: "survivor" }, NOW);
    expect(EJSON.stringify(survivor, { relaxed: false })).toBe(before.s);
    expect(EJSON.stringify(merged, { relaxed: false })).toBe(before.m);

    const s = result.survivor;
    expect(s._id.equals(survivor._id)).toBe(true);
    expect(s.phones.map((p) => p.e164).sort()).toEqual(["+2348031234567", "+2348120001111"]);
    expect(s.emails.map((e) => e.address)).toEqual(["hi@acme.example.test"]);
    expect(s.categories.map((c) => c.key).sort()).toEqual(["catering", "restaurant"]);
    expect(s.website!.domain).toBe("acme.example.test");
    expect(s.website!.alternatives.map((a) => a.value)).toEqual(["https://acmefoods.example.test"]);
    expect(s.sources.sort()).toEqual(["user_import", "website"]);
    expect(s.dedup.absorbedIds!.map((id) => id.toHexString())).toEqual([merged._id.toHexString()]);
    expect(result.merged.deletedAt).toEqual(NOW);
    expect(result.merged.dedup).toMatchObject({ status: "merged_into" });
    expect(result.merged.dedup.mergedIntoId!.equals(survivor._id)).toBe(true);
    expect(result.fieldDecisions.map((f) => f.field)).toEqual(["name", "website", "location"]);
  });

  it("a BSON snapshot round-trips exactly, so undo can restore it byte for byte", () => {
    const doc = business({
      name: "Acme Foods",
      phones: ["0803 123 4567"],
      website: "acme.example.test",
    });
    const snapshot = cloneBson(doc);
    mergeRecords(doc, business({ name: "Acme Foods" }), {}, NOW);
    expect(EJSON.stringify(snapshot, { relaxed: false })).toBe(
      EJSON.stringify(doc, { relaxed: false }),
    );
    expect(snapshot._id).toBeInstanceOf(ObjectId);
    expect(snapshot.createdAt).toBeInstanceOf(Date);
  });

  it("never loses a do-not-contact when merging a suppressed record", () => {
    const survivor = business({ name: "Acme Foods" });
    const merged = business({ name: "Acme Foods" });
    merged.flags = {
      suppressed: true,
      suppressedReason: "Asked to be removed",
      suppressedAt: NOW,
      suppressedByUserId: null,
      doNotContact: true,
    };
    expect(mergeRecords(survivor, merged, {}, NOW).survivor.flags).toMatchObject({
      suppressed: true,
      doNotContact: true,
    });
  });
});
