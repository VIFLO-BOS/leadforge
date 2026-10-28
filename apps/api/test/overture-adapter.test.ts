import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Collections, MongoService } from "@leadforge/db-mongo";
import { DiscoveryJobSpec, type DiscoveryJobSpecInput } from "@leadforge/contracts";
import {
  BusinessesService,
  OverturePlacesAdapter,
  overtureFixtureRecords,
  SourceError,
  sourceOrgContext,
  type MappedRecord,
  type OverturePlaceDocument,
  type SearchCursor,
  type SourceOrgContext,
} from "@leadforge/core";
import type { Harness } from "./harness.js";
import { createOwner } from "./fixtures.js";
import { createDiscoveryHarness } from "./discovery-helpers.js";
import {
  forgetOverture,
  ingestOverturePlace,
  overtureSpec,
  sampleId,
  SAMPLE_MATCHES_HIGH,
  SAMPLE_MATCHES_STANDARD,
  seedOverture,
} from "./overture-helpers.js";

let h: Harness;
beforeAll(async () => {
  h = await createDiscoveryHarness();
});
afterAll(async () => h?.close());
beforeEach(async () => {
  await h.resetState();
  forgetOverture(h);
});

const adapter = () => h.app.get(OverturePlacesAdapter, { strict: false });
const spec = (o: Partial<DiscoveryJobSpecInput> = {}) => DiscoveryJobSpec.parse(overtureSpec(o));
const fixtureId = (prefix: string) =>
  overtureFixtureRecords().find((r) => r.place.id.startsWith(prefix))!.place.id;

async function searchAll(s: DiscoveryJobSpec, from?: SearchCursor, context?: SourceOrgContext) {
  const pages: Array<{ cursor: SearchCursor; nextCursor: SearchCursor | null; ids: string[] }> = [];
  for await (const page of adapter().search(s, { from, context }))
    pages.push({
      cursor: page.cursor,
      nextCursor: page.nextCursor,
      ids: page.records.map((r) => r._id),
    });
  return pages;
}

describe("Overture adapter: describe and validateSpec", () => {
  it("is not configured until a snapshot is loaded, then reports the release", async () => {
    await adapter().refreshState();
    expect(adapter().describe()).toMatchObject({
      key: "overture_places",
      status: "not_configured",
      statusReason: "snapshot_missing",
      collectionMethod: "dataset_snapshot",
      snapshot: null,
    });
    await expect(adapter().estimate(spec())).resolves.toMatchObject({ maxResults: 0, exact: true });
    await expect(async () => {
      for await (const _ of adapter().search(spec())) void _;
    }).rejects.toMatchObject({ code: "SOURCE_NOT_CONFIGURED", retryable: false });
    await seedOverture(h);
    await adapter().refreshState();
    expect(adapter().describe()).toMatchObject({
      status: "configured",
      statusReason: null,
      snapshot: { release: "2026-10-21.0", places: 54, offerable: 51 },
      maxResultsPerQuery: 0,
    });
  });

  it("covers Nigeria only and checks state names", () => {
    expect(adapter().validateSpec(spec({ location: { country: "GH" } }))).toEqual([
      {
        path: "location.country",
        message: "Overture Maps Places in LeadForge covers Nigeria only",
      },
    ]);
    expect(
      adapter().validateSpec(spec({ location: { country: "NG", region: "Lagoon" } }))[0],
    ).toMatchObject({ path: "location.region" });
    expect(adapter().validateSpec(spec({ location: { country: "NG", region: "FCT" } }))).toEqual(
      [],
    );
    expect(adapter().validateSpec(spec({ location: { country: "NG" } }))).toEqual([]);
  });
});

describe("Overture adapter: matching, exact estimate and paging", () => {
  beforeEach(async () => {
    await seedOverture(h);
  });

  it("maps Nigerian words to Overture categories", async () => {
    const count = async (o: Partial<DiscoveryJobSpecInput>) =>
      (await adapter().estimate(spec(o))).maxResults;
    expect(await count({ categories: ["Chemist"] })).toBe(SAMPLE_MATCHES_STANDARD);
    expect(await count({ categories: ["pharmacies"] })).toBe(SAMPLE_MATCHES_STANDARD);
    expect(
      await count({ categories: ["church"], location: { country: "NG", region: "Lagos" } }),
    ).toBe(1);
    expect(await count({ categories: ["Hotel"], location: { country: "NG", region: "FCT" } })).toBe(
      1,
    );
    expect(await count({ categories: ["POS agent"], location: { country: "NG" } })).toBe(2);
    // No category matches "galleria": the place name does, flagged as a name match.
    const byName = await adapter().estimate(
      spec({ categories: ["Galleria"], location: { country: "NG", region: "Lagos" } }),
    );
    expect(byName.maxResults).toBe(1);
    expect(byName.warnings[0]).toMatch(/matches no Overture category/);
  });

  it("filters by state, LGA (any spelling) and city", async () => {
    const ids = async (o: Partial<DiscoveryJobSpecInput>) =>
      (await searchAll(spec(o))).flatMap((p) => p.ids);
    expect(
      await ids({ location: { country: "NG", region: "Lagos", lga: "Ikeja LGA" } }),
    ).toHaveLength(SAMPLE_MATCHES_STANDARD);
    expect(await ids({ location: { country: "NG", locality: "Ikeja" } })).toHaveLength(
      SAMPLE_MATCHES_STANDARD,
    );
    expect(await ids({ location: { country: "NG", region: "Kano" } })).toEqual([]);
    expect(
      await ids({
        categories: ["Religious organization"],
        location: { country: "NG", lga: "Ikorodu" },
      }),
    ).toEqual([fixtureId("a5f46168")]);
    expect(
      await ids({
        categories: ["Shopping mall"],
        location: { country: "NG", region: "Lagos State", lga: "Eti-Osa" },
      }),
    ).toEqual([fixtureId("60043b60")]);
    expect(
      await ids({ location: { country: "NG", region: "Lagos", query: "3 Allen Avenue" } }),
    ).toEqual([sampleId(3)]);
  });

  it("applies the confidence floor, never offers closed places or duplicates, and requires a contact by default", async () => {
    const ids = async (o: Partial<DiscoveryJobSpecInput>) =>
      new Set((await searchAll(spec(o))).flatMap((p) => p.ids));
    const standard = await ids({});
    expect(standard.size).toBe(SAMPLE_MATCHES_STANDARD);
    expect(standard.has(sampleId(23))).toBe(true);
    for (const n of [24, 25, 26, 27, 28]) expect(standard.has(sampleId(n))).toBe(false);
    expect(standard.has(sampleId(29))).toBe(true);
    const high = await ids({ confidence: "high" });
    expect(high.size).toBe(SAMPLE_MATCHES_HIGH);
    expect(high.has(sampleId(23))).toBe(false);
    const anyContact = await ids({ requireContact: false });
    expect(anyContact.has(sampleId(26))).toBe(true);
    expect(anyContact.has(sampleId(25))).toBe(false);
  });

  it("estimates the exact number of places the search returns, less those already in the directory", async () => {
    const owner = await createOwner(h, "estimate@example.test", "Estimate Org");
    const context = sourceOrgContext(
      h.app.get(BusinessesService, { strict: false }),
      owner.orgId,
      "overture_places",
      null,
    );
    const est = await adapter().estimate(spec(), context);
    expect(est).toMatchObject({
      maxResults: SAMPLE_MATCHES_STANDARD,
      exact: true,
      alreadyInDirectory: 0,
      queries: 1,
      maxRequests: 3,
    });
    expect((await searchAll(spec())).flatMap((p) => p.ids)).toHaveLength(est.maxResults);

    for (const n of [1, 2]) await ingestOverturePlace(h, owner.orgId, sampleId(n));
    const after = await adapter().estimate(spec(), context);
    expect(after).toMatchObject({ maxResults: SAMPLE_MATCHES_STANDARD - 2, alreadyInDirectory: 2 });
    const remaining = (await searchAll(spec(), undefined, context)).flatMap((p) => p.ids);
    expect(remaining).toHaveLength(SAMPLE_MATCHES_STANDARD - 2);
    expect(remaining).not.toContain(sampleId(1));
  });

  it("pages in a stable order and resumes from any page's cursor", async () => {
    const pages = await searchAll(spec());
    expect(pages.map((p) => p.ids.length)).toEqual([10, 10, 4]);
    expect(pages[2]!.nextCursor).toBeNull();
    expect(pages[0]!.ids[0]).toBe(sampleId(1)); // highest confidence first
    const resumed = await searchAll(spec(), pages[1]!.cursor);
    expect(resumed.map((p) => p.ids)).toEqual([pages[1]!.ids, pages[2]!.ids]);
    await expect(async () => {
      for await (const _ of adapter().search(spec(), {
        from: { queryIndex: 0, pageIndex: 1, pageToken: "garbage" },
      }))
        void _;
    }).rejects.toMatchObject({ code: "SOURCE_REQUEST_INVALID" });
  });

  it("leaves out places whose upstream record is already linked under another GERS id", async () => {
    const owner = await createOwner(h, "dedup-gers@example.test", "Dedup Org");
    const context = sourceOrgContext(
      h.app.get(BusinessesService, { strict: false }),
      owner.orgId,
      "overture_places",
      null,
    );
    // The organization holds the duplicate (27); the offered representative (3) is the same Meta page.
    await ingestOverturePlace(h, owner.orgId, sampleId(27));
    const ids = (await searchAll(spec(), undefined, context)).flatMap((p) => p.ids);
    expect(ids).not.toContain(sampleId(3));
    expect(
      await context.linkedAmong([
        { externalId: sampleId(3), matchKeys: [`gers:${sampleId(3)}`, "up:meta:1000000003"] },
      ]),
    ).toEqual(new Set([sampleId(3)]));
    expect((await adapter().estimate(spec(), context)).alreadyInDirectory).toBe(1);
  });

  it("turns a staging read failure into a retryable source error", async () => {
    const repo = (adapter() as unknown as { places: { findOrdered: () => Promise<unknown> } })
      .places;
    const original = repo.findOrdered;
    repo.findOrdered = async () => {
      throw new Error("connection reset");
    };
    try {
      await expect(searchAll(spec())).rejects.toMatchObject({
        code: "SOURCE_UNAVAILABLE",
        retryable: true,
      });
    } finally {
      repo.findOrdered = original;
    }
  });
});

describe("Overture adapter: mapToObservations and fetchRecord", () => {
  beforeEach(async () => {
    await seedOverture(h);
    await adapter().refreshState();
  });

  const placeDoc = async (id: string) =>
    (await h.app
      .get(MongoService)
      .database.collection<OverturePlaceDocument>(Collections.overturePlaces)
      .findOne({ _id: id }))!;

  it("maps a place with provenance, licence, freshness from the release and typed contacts", async () => {
    const m: MappedRecord = adapter().mapToObservations(await placeDoc(sampleId(1)), {
      spec: spec(),
      collectedAt: new Date("2026-10-26T08:00:00Z"),
    });
    expect(m.externalId).toBe(sampleId(1));
    expect(m.skip).toBeNull();
    expect(m.warnings).toEqual([]);
    expect(m.provenance).toMatchObject({
      sourceRef: `overture:2026-10-21.0:places/place/${sampleId(1)}`,
      expiresAt: null,
      externalIdExpiresAt: null,
      categoryTaxonomy: "overture",
      collectionMethod: "dataset_snapshot",
      confidence: 0.6,
      observedAt: new Date("2026-10-21T00:00:00Z"),
      attribution:
        "Source: Overture Maps Foundation (overturemaps.org). Data from Meta. Available under CDLA Permissive 2.0.",
      ref: {
        release: "2026-10-21.0",
        dataset: "meta",
        recordId: "1000000001",
        license: "CDLA-Permissive-2.0",
      },
      metadata: {
        overture: {
          release: "2026-10-21.0",
          gersId: sampleId(1),
          confidence: 0.94,
          upstream: { dataset: "meta", recordId: "1000000001", license: "CDLA-Permissive-2.0" },
        },
      },
    });
    expect(m.provenance.matchKeys).toEqual([`gers:${sampleId(1)}`, "up:meta:1000000001"]);
    expect(m.input).toMatchObject({
      name: { value: "Ikeja Pharmacy 1 (Sample)" },
      categories: [{ value: "Pharmacy" }, { value: "Pharmacy and drug store" }],
      website: { domain: "pharmacy-1.example.test" },
      phones: [
        expect.objectContaining({ e164: "+2348031000001", type: "mobile", whatsapp: "unknown" }),
      ],
      emails: [
        {
          address: "info@pharmacy-1.example.test",
          domain: "pharmacy-1.example.test",
          raw: "info@pharmacy-1.example.test",
        },
      ],
      socials: [expect.objectContaining({ platform: "facebook", handle: "1000000001" })],
      location: expect.objectContaining({
        region: "Lagos",
        lga: "Ikeja",
        locality: "Ikeja",
        postalCode: "100001",
        country: "NG",
      }),
    });
  });

  it("flags lower confidence and name-only matches, and carries Foursquare's licence line", async () => {
    const low = adapter().mapToObservations(await placeDoc(sampleId(23)), {
      spec: spec(),
      collectedAt: new Date(),
    });
    expect(low.warnings.map((w) => w.code)).toEqual(["LOWER_CONFIDENCE"]);
    const galleria = await placeDoc(fixtureId("60043b60"));
    const fsq = adapter().mapToObservations(galleria, {
      spec: spec({ categories: ["Galleria"] }),
      collectedAt: new Date(),
    });
    expect(fsq.warnings.map((w) => w.code)).toContain("MATCHED_BY_NAME");
    expect(fsq.provenance.ref).toMatchObject({ dataset: "Foursquare", license: "Apache-2.0" });
    expect(fsq.provenance.attribution).toMatch(
      /Data from Foursquare\. Copyright 2024 Foursquare Labs, Inc\./,
    );
  });

  it("fetches a record by GERS id, and nothing for a retired place", async () => {
    expect((await adapter().fetchRecord(sampleId(2)))?._id).toBe(sampleId(2));
    await h.app
      .get(MongoService)
      .database.collection<OverturePlaceDocument>(Collections.overturePlaces)
      .updateOne({ _id: sampleId(2) }, { $set: { retiredAt: new Date() } });
    expect(await adapter().fetchRecord(sampleId(2))).toBeNull();
    expect(await adapter().fetchRecord("00000000-0000-4000-8000-000000000000")).toBeNull();
  });

  it("uses indexes for the discovery queries (no collection scans)", async () => {
    const repo = (
      adapter() as unknown as { places: { explain(f: unknown): Promise<Record<string, unknown>> } }
    ).places;
    for (const o of [
      {},
      { location: { country: "NG", region: "Lagos" } },
      { location: { country: "NG" } },
    ]) {
      const plan = JSON.stringify(await repo.explain(adapter().query(spec(o), null).filter));
      expect(plan, JSON.stringify(o)).not.toMatch(/COLLSCAN/);
    }
    expect(new SourceError("SOURCE_UNAVAILABLE", "x", true).retryable).toBe(true);
  });
});
