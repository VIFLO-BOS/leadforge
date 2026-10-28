import { describe, expect, it } from "vitest";
import { AdminIndex, lgaMatchKey, parseWkbPolygons, rectangleWkb } from "./admin-index.js";
import {
  OVERTURE_FIXTURE_RELEASE,
  overtureFixtureDivisions,
  overtureFixtureRecords,
} from "./fixtures/places-fixtures.js";
import {
  attributionLineFor,
  licenseFor,
  OVERTURE_LICENSING,
  recordAttribution,
} from "./overture-licensing.js";
import {
  classifyWebsite,
  cleanPostcode,
  normalizeOverturePlace,
  parseUpdateTime,
  releaseDate,
} from "./overture-normalize.js";
import { categoryOptions } from "./overture-catalog.service.js";
import { arraySnapshot, resolveStacRelease } from "./overture-stac.js";
import { CURATED_CATEGORIES, categoryPhrase, resolveCategory } from "./overture-taxonomy.js";
import { LICENSE_TEXTS, FOURSQUARE_NOTICE_TEXT } from "./license-texts.js";
import type { OvertureRawPlace } from "./overture.types.js";

const EMPTY_ADMIN = {
  stateName: null,
  stateKey: null,
  stateCode: null,
  lgaName: null,
  lgaKey: null,
  regionDivisionId: null,
  countyDivisionId: null,
};

function fixture(id: string): OvertureRawPlace {
  const r = overtureFixtureRecords().find((x) => x.place.id.startsWith(id));
  if (!r) throw new Error(`no fixture ${id}`);
  return r.place;
}

describe("admin index (state and LGA by point-in-polygon)", () => {
  it("parses WKB polygons in either byte order and tests points against them", () => {
    const wkb = rectangleWkb(3.3, 6.5, 3.4, 6.6);
    const [polygon] = parseWkbPolygons(wkb);
    expect(polygon![0]!.length).toBe(10);
    const big = new Uint8Array(wkb.length);
    const view = new DataView(big.buffer);
    const src = new DataView(wkb.buffer);
    view.setUint8(0, 0);
    view.setUint32(1, 3, false);
    view.setUint32(5, 1, false);
    view.setUint32(9, 5, false);
    for (let i = 0; i < 10; i++)
      view.setFloat64(13 + i * 8, src.getFloat64(13 + i * 8, true), false);
    expect(parseWkbPolygons(big)).toEqual(parseWkbPolygons(wkb));
    expect(() => parseWkbPolygons(new Uint8Array([1, 1, 0, 0, 0]))).toThrow(
      /Unsupported WKB geometry type 1/,
    );
  });

  it("reproduces the research's real state and LGA for all 25 fixtures with the synthetic boundaries", () => {
    const index = new AdminIndex(overtureFixtureDivisions());
    for (const r of overtureFixtureRecords()) {
      const a = index.lookup(r.place.lon, r.place.lat);
      expect(a.stateName, r.place.id).toBe(r.expectedAdmin.state);
      expect(a.lgaKey, r.place.id).toBe(
        r.expectedAdmin.lga ? lgaMatchKey(r.expectedAdmin.lga) : null,
      );
    }
    const ikorodu = overtureFixtureRecords().find((r) => r.expectedAdmin.lga === "Ìkòròdú")!;
    expect(index.lookup(ikorodu.place.lon, ikorodu.place.lat)).toMatchObject({
      stateKey: "lagos",
      stateCode: "NG-LA",
      lgaKey: "ikorodu",
      lgaName: "Ìkòròdú",
    });
    expect(index.lookup(0, 0)).toMatchObject({ stateKey: null, lgaKey: null });
    expect(index.lookup(null, 6.5)).toMatchObject({ stateKey: null });
  });

  it("matches LGA names whatever the case, diacritics, hyphens or slashes", () => {
    expect(lgaMatchKey("Port-Harcourt")).toBe("port harcourt");
    expect(lgaMatchKey("Oshodi/Isolo")).toBe("oshodi isolo");
    expect(lgaMatchKey("ÌKÒRÒDÚ")).toBe("ikorodu");
  });
});

describe("normalizing an Overture place", () => {
  const admin = {
    ...EMPTY_ADMIN,
    stateName: "Federal Capital Territory",
    stateKey: "federal capital territory",
    stateCode: "NG-FC",
    lgaName: "Municipal Area Council",
    lgaKey: "municipal area council",
  };

  it("types phones and emails, keeps provenance and licence, and derives dedup keys", () => {
    const res = normalizeOverturePlace(fixture("67b7fd45"), {
      release: OVERTURE_FIXTURE_RELEASE,
      schemaVersion: "2.0.0",
      admin,
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const p = res.place;
    expect(p).toMatchObject({
      _id: "67b7fd45-fc42-4de9-9c3d-8bf8f5b7a922",
      name: "Officers Of Nigerian National Commission-NATFORCE",
      taxonomy: {
        primary: "government_office",
        hierarchy: ["community_and_government", "government_office"],
      },
      confidence: expect.closeTo(0.521, 3),
      closed: false,
      rootSource: { dataset: "meta", recordId: "229113884444822", license: "CDLA-Permissive-2.0" },
      licenses: ["CDLA-Permissive-2.0"],
      upstreamKey: "up:meta:229113884444822",
      socialKeys: ["fb:229113884444822"],
      contacts: { phone: true, email: true, website: false, any: true, score: 2 },
      admin: { stateKey: "federal capital territory", lgaKey: "municipal area council" },
    });
    expect(p.phones).toEqual([
      { raw: "+2349039880927", e164: "+2349039880927", type: "mobile", country: "NG" },
    ]);
    expect(p.emails).toEqual([
      {
        raw: "markyjayf@gmail.com",
        address: "markyjayf@gmail.com",
        domain: "gmail.com",
        kind: "free_mail",
      },
    ]);
    expect(p.categoryNodes).toEqual(["community_and_government", "government_office"]);
    expect(p.location).toEqual({ type: "Point", coordinates: [7.50752, 9.0472] });
    expect(p.contentHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("reads closed places, Foursquare and AllThePlaces licences, and Uberall's open status", () => {
    const fsq = normalizeOverturePlace(fixture("60043b60"), {
      release: OVERTURE_FIXTURE_RELEASE,
      schemaVersion: null,
      admin,
    });
    expect(fsq.ok && fsq.place.rootSource).toMatchObject({
      dataset: "Foursquare",
      license: "Apache-2.0",
    });
    const atp = normalizeOverturePlace(fixture("d82daf9e"), {
      release: OVERTURE_FIXTURE_RELEASE,
      schemaVersion: null,
      admin,
    });
    expect(atp.ok && atp.place).toMatchObject({
      rootSource: { dataset: "AllThePlaces", license: "CC0-1.0" },
      contacts: { any: false },
    });
    const closed = normalizeOverturePlace(
      { ...fixture("e8453bb9"), operating_status: "permanently_closed" },
      { release: "r", schemaVersion: null, admin },
    );
    expect(closed.ok && closed.place.closed).toBe(true);
    const open = normalizeOverturePlace(fixture("e8453bb9"), {
      release: "r",
      schemaVersion: null,
      admin,
    });
    expect(open.ok && open.place).toMatchObject({ operatingStatus: "open", closed: false });
  });

  it("drops rows without an id or a name, and non-Nigerian rows outside the boundaries", () => {
    expect(
      normalizeOverturePlace(
        { ...fixture("67b7fd45"), id: "" },
        { release: "r", schemaVersion: null, admin },
      ).ok,
    ).toBe(false);
    expect(
      normalizeOverturePlace(
        { ...fixture("67b7fd45"), name: "  " },
        { release: "r", schemaVersion: null, admin },
      ),
    ).toEqual({ ok: false, reason: "missing_name" });
    const foreign = {
      ...fixture("67b7fd45"),
      addresses: [{ freeform: null, locality: null, postcode: null, region: null, country: "CM" }],
    };
    expect(
      normalizeOverturePlace(foreign, { release: "r", schemaVersion: null, admin: EMPTY_ADMIN }),
    ).toEqual({ ok: false, reason: "not_nigeria" });
  });

  it("separates real websites from social, messaging, link-hub and shortener links", () => {
    expect(classifyWebsite("https://www.example.ng/?utm_source=x")).toMatchObject({
      kind: "website",
      domain: "example.ng",
      url: "https://www.example.ng",
    });
    expect(classifyWebsite("https://wa.me/2348031234567").kind).toBe("messaging");
    expect(classifyWebsite("linktr.ee/shop").kind).toBe("link_hub");
    expect(classifyWebsite("https://bit.ly/abc").kind).toBe("shortener");
    expect(classifyWebsite("https://instagram.com/shopname").kind).toBe("social");
    expect(classifyWebsite("").kind).toBe("invalid");
  });

  it("keeps six-digit postcodes only, parses mixed update times and release dates", () => {
    expect(cleanPostcode("100001")).toBe("100001");
    for (const junk of ["+234", "234", "<<not-applicable>>", "", null])
      expect(cleanPostcode(junk)).toBeNull();
    expect(parseUpdateTime("2026-01-23T00:00:00.000")?.toISOString()).toBe(
      "2026-01-23T00:00:00.000Z",
    );
    expect(parseUpdateTime("2026-10-12T00:00:00.000Z")?.toISOString()).toBe(
      "2026-10-12T00:00:00.000Z",
    );
    expect(releaseDate("2026-10-21.0")?.toISOString()).toBe("2026-10-21T00:00:00.000Z");
  });

  it("gives the same content hash for the same row, and a different one when a value changes", () => {
    const a = normalizeOverturePlace(fixture("67b7fd45"), {
      release: "2026-10-21.0",
      schemaVersion: null,
      admin,
    });
    const b = normalizeOverturePlace(fixture("67b7fd45"), {
      release: "2026-11-18.0",
      schemaVersion: null,
      admin,
    });
    const c = normalizeOverturePlace(
      { ...fixture("67b7fd45"), phones: ["+2348031234567"] },
      { release: "2026-10-21.0", schemaVersion: null, admin },
    );
    expect(a.ok && b.ok && a.place.contentHash === b.place.contentHash).toBe(true);
    expect(a.ok && c.ok && a.place.contentHash !== c.place.contentHash).toBe(true);
  });
});

describe("category mapping (Nigerian synonyms to Overture taxonomy)", () => {
  const vocabulary = new Set([
    "pharmacy_and_drug_store",
    "pharmacy",
    "grocery_store",
    "pet_store",
    "music_school",
    "art_school",
    "attorney_or_law_firm",
    "christian_place_of_worship",
  ]);

  it("maps words with no node of that name through the curated table", () => {
    expect(resolveCategory("supermarket", vocabulary)).toMatchObject({
      via: "curated",
      nodes: expect.arrayContaining(["grocery_store"]),
    });
    expect(resolveCategory("Lawyers", vocabulary)).toMatchObject({
      via: "curated",
      nodes: expect.arrayContaining(["attorney_or_law_firm"]),
    });
    expect(resolveCategory("church", vocabulary)).toMatchObject({
      via: "curated",
      nodes: ["christian_place_of_worship"],
    });
    expect(resolveCategory("chemist", vocabulary)).toMatchObject({
      label: "Pharmacy",
      nodes: ["pharmacy_and_drug_store"],
    });
    expect(resolveCategory("Filling station", vocabulary).nodes).toContain("fueling_station");
    expect(resolveCategory("POS agent", vocabulary).nodes).toContain("money_transfer_service");
    expect(resolveCategory("Pharmacies", vocabulary).label).toBe("Pharmacy");
  });

  it("uses an Overture node of the same name, then nodes ending in the term, then the place name", () => {
    expect(resolveCategory("pet store", vocabulary)).toMatchObject({
      via: "taxonomy",
      nodes: ["pet_store"],
    });
    expect(resolveCategory("Pets", vocabulary)).toMatchObject({
      via: "taxonomy",
      nodes: ["pet_store"],
    });
    expect(resolveCategory("Driving school", vocabulary)).toMatchObject({ via: "curated" });
    expect(resolveCategory("Art school", vocabulary)).toMatchObject({
      via: "taxonomy",
      nodes: ["art_school"],
    });
    expect(resolveCategory("grocery_store", vocabulary)).toMatchObject({
      via: "taxonomy",
      nodes: ["grocery_store"],
    });
    expect(resolveCategory("Zobo drinks", vocabulary)).toMatchObject({
      via: "name",
      nodes: [],
      nameWords: ["zobo", "drink"],
    });
    expect(resolveCategory("Zobo drinks", null).via).toBe("name");
  });

  it("has unique keys and normalized phrases", () => {
    expect(new Set(CURATED_CATEGORIES.map((c) => c.key)).size).toBe(CURATED_CATEGORIES.length);
    expect(categoryPhrase("Event Centres")).toBe("event centre");
  });

  it("lists each category label once in the wizard catalogue", () => {
    // Real node counts from release 2026-10-21.0: `pharmacy` and `bank` sit under curated nodes.
    const counts = new Map([
      ["pharmacy_and_drug_store", 419],
      ["pharmacy", 419],
      ["bank_or_credit_union", 30],
      ["bank", 27],
      ["drugstore", 3],
      ["airline", 12],
      ["pet_store", 9],
      ["pet-store", 2],
    ]);
    const options = categoryOptions(counts);
    const labels = options.map((o) => o.label.toLowerCase());
    expect(new Set(labels).size).toBe(labels.length);
    expect(options.filter((o) => o.label === "Pharmacy")).toEqual([
      expect.objectContaining({ key: "pharmacy", kind: "curated", places: 419 }),
    ]);
    expect(options.filter((o) => o.label === "Bank")).toEqual([
      expect.objectContaining({ kind: "curated", sourceCategories: ["bank_or_credit_union"] }),
    ]);
    // A curated synonym ("drugstore") is not offered again as a taxonomy entry.
    expect(options.some((o) => o.kind === "taxonomy" && o.key === "drugstore")).toBe(false);
    // Taxonomy nodes with the same label are merged.
    expect(options.filter((o) => o.label === "Pet store")).toEqual([
      expect.objectContaining({
        kind: "taxonomy",
        key: "pet_store",
        sourceCategories: ["pet_store", "pet-store"],
        places: 9,
      }),
    ]);
    expect(options.find((o) => o.key === "airline")).toMatchObject({
      kind: "taxonomy",
      label: "Airline",
      places: 12,
    });
    expect(categoryOptions(null).every((o) => o.kind === "curated" && o.places === null)).toBe(
      true,
    );
  });
});

describe("licensing and attribution", () => {
  it("keeps the verbatim per-dataset lines and the record licence", () => {
    expect(attributionLineFor("meta", "CDLA-Permissive-2.0")).toBe(
      "Data from Meta. Available under CDLA Permissive 2.0.",
    );
    expect(attributionLineFor("Foursquare", "Apache-2.0")).toMatch(
      /^Data from Foursquare\. Copyright 2024 Foursquare Labs, Inc\. All rights reserved\. Available under Apache 2\.0\./,
    );
    expect(attributionLineFor("AllThePlaces", "CC0-1.0")).toBe(
      "Data from AllThePlaces. Available under CC0 1.0.",
    );
    expect(recordAttribution("meta", "CDLA-Permissive-2.0")).toBe(
      "Source: Overture Maps Foundation (overturemaps.org). Data from Meta. Available under CDLA Permissive 2.0.",
    );
    expect(licenseFor("Foursquare", null)).toBe("Apache-2.0");
    expect(licenseFor("meta", "CDLA-Permissive-2.0")).toBe("CDLA-Permissive-2.0");
    expect(licenseFor("unknown", "MIT")).toBeNull();
  });

  it("ships every licence text and the Foursquare NOTICE", () => {
    expect(LICENSE_TEXTS["CDLA-Permissive-2.0"]).toMatch(
      /^Community Data License Agreement - Permissive - Version 2\.0/,
    );
    expect(LICENSE_TEXTS["Apache-2.0"]).toMatch(/Apache License\s+Version 2\.0, January 2004/);
    expect(LICENSE_TEXTS["CC0-1.0"]).toMatch(/CC0 1\.0 Universal/);
    expect(LICENSE_TEXTS["ODbL-1.0"]).toMatch(/Open Database License/);
    expect(LICENSE_TEXTS["CC-BY-4.0"]).toMatch(/Attribution 4\.0 International/);
    expect(FOURSQUARE_NOTICE_TEXT).toMatch(/© 2026 Foursquare Labs, Inc\. All rights reserved\./);
    expect(OVERTURE_LICENSING.licenses.map((l) => l.id)).toEqual([
      "CDLA-Permissive-2.0",
      "Apache-2.0",
      "CC0-1.0",
      "ODbL-1.0",
      "CC-BY-4.0",
    ]);
    expect(OVERTURE_LICENSING.upstream.find((u) => u.dataset === "meta")?.license).toBe(
      "CDLA-Permissive-2.0",
    );
  });
});

describe("STAC release resolution (stubbed fetch, no network)", () => {
  const base = "https://stac.example.test";
  const docs: Record<string, unknown> = {
    [`${base}/catalog.json`]: {
      latest: "2026-10-21.0",
      links: [
        {
          rel: "child",
          href: `${base}/2026-10-21.0/catalog.json`,
          title: "2026-10-21.0 Overture Release",
        },
      ],
    },
    [`${base}/2026-10-21.0/catalog.json`]: {
      links: [
        { rel: "child", href: `${base}/2026-10-21.0/places/catalog.json`, title: "places" },
        { rel: "child", href: `${base}/2026-10-21.0/divisions/catalog.json`, title: "divisions" },
      ],
    },
    [`${base}/2026-10-21.0/places/catalog.json`]: {
      links: [{ rel: "child", href: `${base}/p/collection.json`, title: "place" }],
    },
    [`${base}/2026-10-21.0/divisions/catalog.json`]: {
      links: [{ rel: "child", href: `${base}/d/collection.json`, title: "division_area" }],
    },
    [`${base}/p/collection.json`]: {
      links: [
        { rel: "item", href: `${base}/p/1.json` },
        { rel: "item", href: `${base}/p/2.json` },
      ],
    },
    [`${base}/p/1.json`]: {
      bbox: [-74.9, -20, 4.38, 40.7],
      assets: {
        aws: { href: "https://aws/p1.parquet", alternate: { s3: { href: "s3://b/p1.parquet" } } },
        azure: { href: "https://az/p1.parquet" },
      },
    },
    [`${base}/p/2.json`]: {
      bbox: [100, -80, 179, 18],
      assets: { aws: { href: "https://aws/p2.parquet" } },
    },
    [`${base}/d/collection.json`]: { links: [{ rel: "item", href: `${base}/d/1.json` }] },
    [`${base}/d/1.json`]: {
      bbox: [2, 4, 15, 14],
      assets: { aws: { href: "https://aws/d1.parquet" } },
    },
  };
  const fetchFn = async (url: string) =>
    docs[url]
      ? new Response(JSON.stringify(docs[url]), { status: 200 })
      : new Response("not found", { status: 404 });

  it("follows latest to the places and division files overlapping Nigeria", async () => {
    const r = await resolveStacRelease(`${base}/catalog.json`, { fetchFn });
    expect(r.release).toBe("2026-10-21.0");
    expect(r.placesFiles).toEqual([
      {
        https: "https://aws/p1.parquet",
        s3: "s3://b/p1.parquet",
        azure: "https://az/p1.parquet",
        bbox: [-74.9, -20, 4.38, 40.7],
      },
    ]);
    expect(r.divisionFiles.map((f) => f.https)).toEqual(["https://aws/d1.parquet"]);
  });

  it("refuses a release the catalogue no longer lists", async () => {
    await expect(
      resolveStacRelease(`${base}/catalog.json`, { fetchFn, release: "2026-08-20.0" }),
    ).rejects.toThrow(/not in the STAC catalogue/);
  });

  it("batches an in-memory snapshot", async () => {
    const snap = arraySnapshot({
      release: "r",
      places: overtureFixtureRecords().map((r) => r.place),
      divisions: [],
      batchSize: 10,
    });
    const sizes: number[] = [];
    for await (const b of snap.places) sizes.push(b.length);
    expect(sizes).toEqual([10, 10, 5]);
  });
});
