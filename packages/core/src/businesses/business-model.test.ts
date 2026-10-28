import { describe, expect, it } from "vitest";
import { ObjectId } from "@leadforge/db-mongo";
import { normalizeCreateRequest, type BusinessInput } from "./business-input.js";
import {
  alreadyApplied,
  applyCorrection,
  buildObservations,
  createBusinessDocument,
  mergeIntoBusiness,
  type ProvenanceContext,
} from "./business-model.js";
import { buildBusinessFilter, searchTerms } from "./business-query.js";
import { bestState, deriveFieldState } from "./field-state.js";
import { summaryStates, toDetail, toListItem } from "./business-view.js";
import { deterministicObjectId } from "../provenance/provenance.types.js";

const ORG = "0192c9a8-0000-7000-8000-000000000001";
const NOW = new Date("2026-10-25T12:00:00.000Z");
const DAY = 24 * 60 * 60 * 1000;
const stateCtx = { now: NOW, freshnessDays: 180 };

function ctx(overrides: Partial<ProvenanceContext> = {}): ProvenanceContext {
  return {
    source: "user_import",
    collectionMethod: "user_import",
    sourceRef: "import:test",
    collectedAt: NOW,
    confidence: 0.6,
    actor: { type: "user", userId: "0192c9a8-0000-7000-8000-0000000000aa" },
    importId: null,
    note: null,
    idSeed: null,
    ...overrides,
  };
}

function input(
  overrides: Partial<Parameters<typeof normalizeCreateRequest>[0]> = {},
): BusinessInput {
  const { input: i, errors } = normalizeCreateRequest(
    {
      name: "Acme Foods",
      categories: ["Restaurant"],
      website: "acme.ng",
      phones: ["0803 123 4567"],
      emails: ["info@acme.ng"],
      location: { locality: "Ikeja", region: "Lagos" },
      ...overrides,
    },
    "NG",
  );
  if (!i) throw new Error(JSON.stringify(errors));
  return i;
}

function newDoc(i: BusinessInput, c = ctx()) {
  const id = new ObjectId();
  const { refs, observations } = buildObservations(ORG, id, i, c);
  return {
    doc: createBusinessDocument(ORG, i, refs, c, {
      id,
      slug: "acme",
      createdVia: { kind: "manual", importId: null, userId: null },
    }),
    observations,
  };
}

describe("field state derivation", () => {
  const meta = (
    o: Partial<{
      state: "verified" | "unverified" | "conflicting";
      lastObservedAt: Date | null;
      lastVerifiedAt: Date | null;
      expiresAt: Date | null;
    }>,
  ) => ({
    state: "unverified" as const,
    lastObservedAt: NOW,
    lastVerifiedAt: null,
    expiresAt: null,
    ...o,
  });

  it("derives missing, expired, conflicting, stale, verified and unverified", () => {
    expect(deriveFieldState(null, false, stateCtx)).toBe("missing");
    expect(deriveFieldState(meta({ expiresAt: new Date(NOW.getTime() - 1) }), true, stateCtx)).toBe(
      "expired",
    );
    expect(deriveFieldState(meta({ state: "conflicting" }), true, stateCtx)).toBe("conflicting");
    expect(
      deriveFieldState(
        meta({ lastObservedAt: new Date(NOW.getTime() - 181 * DAY) }),
        true,
        stateCtx,
      ),
    ).toBe("stale");
    expect(deriveFieldState(meta({ state: "verified" }), true, stateCtx)).toBe("verified");
    expect(deriveFieldState(meta({}), true, stateCtx)).toBe("unverified");
  });

  it("uses the organization freshness window and recent verification", () => {
    const old = meta({ lastObservedAt: new Date(NOW.getTime() - 100 * DAY) });
    expect(deriveFieldState(old, true, { now: NOW, freshnessDays: 180 })).toBe("unverified");
    expect(deriveFieldState(old, true, { now: NOW, freshnessDays: 90 })).toBe("stale");
    const reverified = meta({
      state: "verified",
      lastObservedAt: new Date(NOW.getTime() - 400 * DAY),
      lastVerifiedAt: new Date(NOW.getTime() - DAY),
    });
    expect(deriveFieldState(reverified, true, stateCtx)).toBe("verified");
  });

  it("ranks the best state for multi-valued fields", () => {
    expect(bestState(["stale", "verified", "unverified"])).toBe("verified");
    expect(bestState([])).toBe("missing");
  });
});

describe("business documents", () => {
  it("creates an unverified profile with one observation per value", () => {
    const { doc, observations } = newDoc(input());
    expect(observations.map((o) => o.field).sort()).toEqual([
      "category",
      "email",
      "location",
      "name",
      "phone",
      "website",
    ]);
    expect(doc.name.state).toBe("unverified");
    expect(doc.phones[0]!.whatsapp.status).toBe("unknown");
    expect(doc.sources).toEqual(["user_import"]);
    expect(doc.search.tokens).toEqual(
      expect.arrayContaining([
        "acme",
        "foods",
        "restaurant",
        "ikeja",
        "acme.ng",
        "2348031234567",
        "08031234567",
        "8031234567",
      ]),
    );
    const item = toListItem(doc, stateCtx);
    expect(item.states).toEqual({
      name: "unverified",
      website: "unverified",
      phone: "unverified",
      email: "unverified",
      location: "unverified",
    });
    expect(item.whatsapp).toBe("unknown");
  });

  it("merges agreeing observations and unions phones without overwriting", () => {
    const { doc } = newDoc(input());
    const second = input({ phones: ["0812 000 1111"], website: "https://www.acme.ng/" });
    const later = ctx({ collectedAt: new Date(NOW.getTime() + DAY) });
    const { refs } = buildObservations(ORG, doc._id, second, later);
    mergeIntoBusiness(doc, second, refs, later);
    expect(doc.phones.map((p) => p.e164)).toEqual(["+2348031234567", "+2348120001111"]);
    expect(doc.website!.state).toBe("unverified");
    expect(doc.website!.observationIds).toHaveLength(2);
    expect(doc.name.observationIds).toHaveLength(2);
    expect(alreadyApplied(doc, refs)).toBe(true);
  });

  it("keeps conflicting websites and locations as alternatives", () => {
    const { doc } = newDoc(input());
    const other = input({
      website: "acme-foods.com",
      location: { locality: "Lekki", region: "Lagos" },
    });
    const { refs } = buildObservations(ORG, doc._id, other, ctx());
    mergeIntoBusiness(doc, other, refs, ctx());
    expect(doc.website!.state).toBe("conflicting");
    expect(doc.website!.domain).toBe("acme.ng");
    expect(doc.website!.alternatives[0]!.value).toBe("https://acme-foods.com");
    expect(doc.location.state).toBe("conflicting");
    expect(summaryStates(doc, stateCtx).website).toBe("conflicting");
  });

  it("caps observation ids at 50 per field", () => {
    const { doc } = newDoc(input());
    for (let i = 0; i < 60; i++) {
      const { refs } = buildObservations(ORG, doc._id, input(), ctx());
      mergeIntoBusiness(doc, input(), refs, ctx());
    }
    expect(doc.name.observationIds).toHaveLength(50);
  });

  it("derives deterministic ids for idempotent import rows", () => {
    const a = buildObservations(ORG, new ObjectId(), input(), ctx({ idSeed: "import:x:row:2" }));
    const b = buildObservations(ORG, new ObjectId(), input(), ctx({ idSeed: "import:x:row:2" }));
    expect(a.observations.map((o) => o._id.toHexString())).toEqual(
      b.observations.map((o) => o._id.toHexString()),
    );
    expect(deterministicObjectId("s", NOW).equals(deterministicObjectId("s", NOW))).toBe(true);
    expect(deterministicObjectId("s", NOW).equals(deterministicObjectId("t", NOW))).toBe(false);
  });
});

describe("corrections", () => {
  it("replaces a phone, resets state to unverified and resolves conflicts", () => {
    const { doc } = newDoc(input());
    doc.phones[0]!.state = "verified";
    const editCtx = ctx({ source: "user_edit", collectionMethod: "user_edit", confidence: 0.8 });
    const obsId = new ObjectId();
    const { before, after } = applyCorrection(
      doc,
      {
        field: "phone",
        target: "+2348031234567",
        value: {
          e164: "+2348099999999",
          national: "0809 999 9999",
          international: "+234 809 999 9999",
          country: "NG",
          type: "mobile",
          raw: "0809 999 9999",
          whatsapp: "unknown",
        },
      },
      obsId,
      editCtx,
    );
    expect(before).toEqual(["+2348031234567"]);
    expect(after).toEqual(["+2348099999999"]);
    expect(doc.phones[0]!.state).toBe("unverified");
    expect(doc.phones[0]!.observationIds[0]!.equals(obsId)).toBe(true);
    expect(doc.sources).toContain("user_edit");
  });

  it("sets WhatsApp to user_asserted with the asserting user", () => {
    const { doc } = newDoc(input());
    const obsId = new ObjectId();
    applyCorrection(
      doc,
      { field: "whatsapp", target: "+2348031234567", value: "user_asserted" },
      obsId,
      ctx({ source: "user_edit" }),
    );
    expect(doc.phones[0]!.whatsapp.status).toBe("user_asserted");
    expect(doc.phones[0]!.whatsapp.assertedByUserId).toBeTruthy();
    expect(doc.whatsappStatus).toBe("user_asserted");
  });

  it("refuses a target that is not on the business", () => {
    const { doc } = newDoc(input());
    expect(() =>
      applyCorrection(
        doc,
        { field: "whatsapp", target: "+2348000000000", value: "user_asserted" },
        new ObjectId(),
        ctx(),
      ),
    ).toThrow(/not on this business/);
  });

  it("hides expired values in the detail view but keeps their metadata", () => {
    const { doc } = newDoc(input());
    doc.phones[0]!.expiresAt = new Date(NOW.getTime() - DAY);
    const detail = toDetail(doc, stateCtx, {
      freshnessDays: 180,
      recentObservations: [],
      totalObservations: 0,
      observationCounts: {},
      recentVerificationEvents: [],
      suppressionEntries: [],
    });
    expect(detail.phones[0]!.state).toBe("expired");
    expect(detail.phones[0]!.value).toBeNull();
    expect(detail.phones[0]!.e164).toBeNull();
    expect(detail.phones[0]!.observationIds).toHaveLength(1);
  });
});

describe("directory query builder", () => {
  it("anchors and escapes search terms and collapses phone-like queries to digits", () => {
    // Longest term first: it bounds the index scan, and a longer prefix usually matches less.
    expect(searchTerms("Acme  foods")).toEqual(["foods", "acme"]);
    expect(searchTerms("ikeja mama put kitchen")).toEqual(["kitchen", "ikeja", "mama", "put"]);
    expect(searchTerms("0803 123 4567")).toEqual(["08031234567"]);
    expect(searchTerms("+234 (803)")).toEqual(["234803"]);
    const f = buildBusinessFilter({ q: "a.*b" }, stateCtx) as {
      $and: Array<Record<string, unknown>>;
    };
    const clause = f.$and.find((c) => "search.tokens" in c)!;
    const terms = (clause["search.tokens"] as { $all: RegExp[] }).$all;
    expect(terms.map((r) => r.source)).toEqual(["^a", "^b"]);
  });

  it("never turns user strings into operators", () => {
    const f = JSON.stringify(
      buildBusinessFilter(
        { category: ["$where"], region: ['{"$gt":""}'], locality: ["Ikeja"] },
        stateCtx,
      ),
    );
    expect(f).toContain('"categories.key":{"$in":["$where"]}');
    expect(f).toContain('"location.localityKey":{"$in":["ikeja"]}');
  });

  it("normalizes location filters to keys and excludes suppressed by default", () => {
    const f = buildBusinessFilter({ region: ["Lagos State"] }, stateCtx) as { $and: unknown[] };
    expect(f.$and).toEqual(
      expect.arrayContaining([
        { "location.regionKey": { $in: ["lagos"] } },
        { "flags.suppressed": false },
      ]),
    );
    const all = buildBusinessFilter({ suppression: "include" }, stateCtx);
    expect(JSON.stringify(all)).not.toContain("flags.suppressed");
  });

  it("turns an ids selection into one de-duplicated _id clause, combined with the other filters (Stage 8)", () => {
    const a = "65f000000000000000000001";
    const f = buildBusinessFilter(
      { ids: [a, a.toUpperCase(), "65f000000000000000000002"], region: ["Lagos"] },
      stateCtx,
    ) as { $and: Array<Record<string, unknown>> };
    const clause = f.$and.find((c) => "_id" in c) as { _id: { $in: ObjectId[] } };
    expect(clause._id.$in.map((i) => i.toHexString())).toEqual([a, "65f000000000000000000002"]);
    expect(clause._id.$in.every((i) => i instanceof ObjectId)).toBe(true);
    expect(f.$and).toEqual(
      expect.arrayContaining([
        { deletedAt: null },
        { "location.regionKey": { $in: ["lagos"] } },
        { "flags.suppressed": false },
      ]),
    );
    expect(JSON.stringify(buildBusinessFilter({ ids: [] }, stateCtx))).not.toContain("_id");
  });

  it("uses the freshness cutoff for stale and verified state filters", () => {
    const f = JSON.stringify(
      buildBusinessFilter({ phoneState: ["verified", "missing"] }, stateCtx),
    );
    const cutoff = new Date(NOW.getTime() - 180 * DAY).toISOString();
    expect(f).toContain(cutoff);
    expect(f).toContain('"phones.0":{"$exists":false}');
    expect(f).toContain('"state":"verified"');
  });
});
