import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { MongoService, ObjectId } from "@leadforge/db-mongo";
import { API, createHarness, orgHeaders, type Harness } from "./harness.js";
import { createOwner, seedBusinesses, type OrgUser } from "./fixtures.js";
import { forgetOverture, ingestOverturePlace, sampleId, seedOverture } from "./overture-helpers.js";
import { overtureFixtureRecords } from "@leadforge/core";

let h: Harness;
beforeAll(async () => {
  h = await createHarness();
});
afterAll(async () => h?.close());
beforeEach(async () => {
  await h.resetState();
  forgetOverture(h);
});

const exportCsv = (u: OrgUser, body: unknown) =>
  u.agent
    .post(`${API}/exports/businesses`)
    .set(orgHeaders(u.agent, u.orgId))
    .send(body as object)
    .buffer(true)
    .parse((res, cb) => {
      let data = "";
      res.setEncoding("utf8");
      res.on("data", (chunk: string) => (data += chunk));
      res.on("end", () => cb(null, data));
    });

function parseCsv(text: string): string[][] {
  // Small RFC 4180 reader for assertions (quoted fields, doubled quotes, CRLF).
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  const body = text.replace(/^\uFEFF/, "");
  for (let i = 0; i < body.length; i++) {
    const ch = body[i]!;
    if (quoted) {
      if (ch === '"' && body[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") {
      row.push(cell);
      cell = "";
    } else if (ch === "\r") continue;
    else if (ch === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else cell += ch;
  }
  return rows;
}

describe("synchronous CSV export", () => {
  it("exports filtered rows with a BOM, neutralized formulas and an audit event, never suppressed rows", async () => {
    const owner = await createOwner(h, "export@example.test", "Export Org");
    const ids = await seedBusinesses(h, owner.orgId, [
      {
        name: "Acme Foods",
        categories: ["Restaurant"],
        phones: ["0803 123 4567"],
        location: { locality: "Ikeja", region: "Lagos" },
      },
      {
        name: 'Bola, "The" Pharmacy',
        categories: ["Pharmacy"],
        location: { locality: "Yaba", region: "Lagos" },
      },
      {
        name: "Hidden Shop",
        categories: ["Pharmacy"],
        location: { locality: "Yaba", region: "Lagos" },
      },
      { name: "Abuja Office", location: { region: "FCT" } },
    ]);
    // Names that look like formulas can only arrive through old data or other sources; make one.
    await h.app
      .get(MongoService)
      .database.collection("businesses")
      .updateOne(
        { _id: new ObjectId(ids[0]!) },
        { $set: { "name.value": '=HYPERLINK("http://evil.example")' } },
      );
    await owner.agent
      .post(`${API}/businesses/${ids[2]}/suppress`)
      .set(orgHeaders(owner.agent, owner.orgId))
      .send({ scope: "business", reason: "Opted out" })
      .expect(200);

    const res = await exportCsv(owner, {
      filter: { region: ["Lagos"], suppression: "include" },
      columns: ["name", "phone", "region", "categories"],
    }).expect(200);
    expect(res.headers["content-type"]).toMatch(/^text\/csv/);
    expect(res.headers["content-disposition"]).toMatch(
      /^attachment; filename="leadforge-businesses-.*\.csv"$/,
    );
    expect(res.headers["x-export-row-count"]).toBe("2");
    const text = res.body as string;
    expect(text.startsWith("\uFEFF")).toBe(true);
    const rows = parseCsv(text);
    expect(rows[0]).toEqual(["name", "phone", "region", "categories"]);
    const names = rows
      .slice(1)
      .map((r) => r[0])
      .sort();
    expect(names).toEqual(['\'=HYPERLINK("http://evil.example")', 'Bola, "The" Pharmacy']);
    expect(rows.find((r) => r[0]!.startsWith("'="))![1]).toBe("+2348031234567");

    const audit = await h.app
      .get(MongoService)
      .database.collection("audit_events")
      .findOne({ organizationId: owner.orgId, action: "export.created" });
    expect(audit).toMatchObject({
      actorUserId: owner.userId,
      resourceType: "export",
      after: { kind: "businesses", rowCount: 2 },
    });
  });

  it("exports selected ids only from the caller's organization", async () => {
    const owner = await createOwner(h, "sel@example.test");
    const ids = await seedBusinesses(h, owner.orgId, [
      { name: "One" },
      { name: "Two" },
      { name: "Three" },
    ]);
    const res = await exportCsv(owner, {
      ids: [ids[0], ids[2], new ObjectId().toHexString()],
      columns: ["id", "name"],
    }).expect(200);
    const rows = parseCsv(res.body as string).slice(1);
    expect(rows.map((r) => r[1]).sort()).toEqual(["One", "Three"]);
  });

  it("adds source, dataset, licence, release, attribution and licence-URL columns for open data", async () => {
    const owner = await createOwner(h, "licensed-export@example.test", "Licensed Org");
    await seedOverture(h);
    const fsq = overtureFixtureRecords().find(
      (r) => r.place.sources?.[0]?.dataset === "Foursquare",
    )!.place.id;
    await ingestOverturePlace(h, owner.orgId, sampleId(1));
    await ingestOverturePlace(h, owner.orgId, fsq);
    await seedBusinesses(h, owner.orgId, [{ name: "Imported Only (Sample)" }]);
    const res = await exportCsv(owner, {
      filter: {},
      columns: [
        "name",
        "sources",
        "source_records",
        "source_datasets",
        "source_licenses",
        "overture_release",
        "attribution",
        "license_urls",
      ],
    }).expect(200);
    expect(res.headers.link).toBe(
      '<http://localhost:4000/api/v1/public/data-licenses>; rel="license"',
    );
    const rows = parseCsv(res.body as string);
    const byName = Object.fromEntries(rows.slice(1).map((r) => [r[0], r]));
    expect(byName["Ikeja Pharmacy 1 (Sample)"]!.slice(1, 6)).toEqual([
      "overture_places",
      `overture_places:${sampleId(1)}`,
      "meta",
      "CDLA-Permissive-2.0",
      "2026-10-21.0",
    ]);
    expect(byName["Ikeja Pharmacy 1 (Sample)"]![6]).toMatch(
      /^Source: Overture Maps Foundation \(overturemaps\.org\) Data from Meta\. Available under CDLA Permissive 2\.0\. States and LGAs assigned/,
    );
    expect(byName["Ikeja Pharmacy 1 (Sample)"]![7]!.split(" ")).toEqual([
      "http://localhost:4000/api/v1/public/data-licenses/CDLA-Permissive-2.0",
      "http://localhost:4000/api/v1/public/data-licenses/ODbL-1.0",
      "http://localhost:4000/api/v1/public/data-licenses/CC-BY-4.0",
    ]);
    const galleria = rows.find((r) => r[3] === "Foursquare")!;
    expect(galleria[4]).toBe("Apache-2.0");
    expect(galleria[6]).toMatch(/Copyright 2024 Foursquare Labs, Inc\. All rights reserved\./);
    expect(galleria[7]).toContain("/api/v1/public/data-licenses/Apache-2.0");
    expect(byName["Imported Only (Sample)"]!.slice(1)).toEqual([
      "user_import",
      "",
      "",
      "",
      "",
      "",
      "",
    ]);
  });

  it("refuses more than 1,000 rows with EXPORT_TOO_LARGE", async () => {
    const owner = await createOwner(h, "big-export@example.test");
    await seedBusinesses(
      h,
      owner.orgId,
      Array.from({ length: 1001 }, (_, i) => ({ name: `Shop ${i}` })),
    );
    const res = await owner.agent
      .post(`${API}/exports/businesses`)
      .set(orgHeaders(owner.agent, owner.orgId))
      .send({})
      .expect(422);
    expect(res.body.error.code).toBe("EXPORT_TOO_LARGE");
    const narrowed = await exportCsv(owner, {
      filter: { q: "shop 100" },
      columns: ["name"],
    }).expect(200);
    expect(narrowed.headers["x-export-row-count"]).toBe("2"); // "Shop 100" and "Shop 1000"
  });

  it("validates the export body", async () => {
    const owner = await createOwner(h, "bad-export@example.test");
    const res = await owner.agent
      .post(`${API}/exports/businesses`)
      .set(orgHeaders(owner.agent, owner.orgId))
      .send({ columns: ["name", "password"] })
      .expect(400);
    expect(res.body.error.code).toBe("VALIDATION_FAILED");
  });

  it("rate limits exports to 10 per hour per user", async () => {
    const owner = await createOwner(h, "rl-export@example.test");
    for (let i = 0; i < 10; i++) await exportCsv(owner, { columns: ["name"] }).expect(200);
    const limited = await owner.agent
      .post(`${API}/exports/businesses`)
      .set(orgHeaders(owner.agent, owner.orgId))
      .send({})
      .expect(429);
    expect(limited.body.error.code).toBe("RATE_LIMITED");
  });
});

describe("source registry", () => {
  it("lists sources honestly: Google Places unavailable under its terms, Overture waiting for a snapshot", async () => {
    const owner = await createOwner(h, "sources@example.test");
    const res = await owner.agent
      .get(`${API}/sources`)
      .set(orgHeaders(owner.agent, owner.orgId))
      .expect(200);
    const byKey = Object.fromEntries(res.body.data.map((s: { key: string }) => [s.key, s]));
    expect(Object.keys(byKey).sort()).toEqual([
      "google_places",
      "overture_places",
      "user_edit",
      "user_import",
      "website",
    ]);
    // Google's terms (section 3.2.3) forbid storing place content and directory use: never runnable.
    expect(byKey.google_places).toMatchObject({
      status: "not_available",
      statusReason: "provider_terms",
      kind: "discovery",
      method: "api",
      policy: { retentionDays: 0 },
    });
    expect(byKey.overture_places).toMatchObject({
      status: "not_configured",
      statusReason: "snapshot_missing",
      kind: "discovery",
      method: "dataset_snapshot",
      policy: { retentionDays: null },
    });
    expect(byKey.user_import).toMatchObject({ statusReason: null, policy: { licensing: null } });
    expect(byKey.user_import).toMatchObject({ status: "active", method: "user_import" });
    // Phase 4: website contacts enrichment ships through SafeFetch.
    expect(byKey.website).toMatchObject({
      status: "active",
      kind: "enrichment",
      method: "website_fetch",
      enabled: true,
    });
  });
});

describe("data licences (public)", () => {
  it("publishes licence texts, attribution lines, the Foursquare NOTICE and LeadForge's changes", async () => {
    const res = await h.agent().get(`${API}/public/data-licenses`).expect(200);
    expect(res.headers["cache-control"]).toBe("public, max-age=3600");
    const data = res.body.data;
    expect(data.licenses.map((l: { id: string }) => l.id)).toEqual([
      "CDLA-Permissive-2.0",
      "Apache-2.0",
      "CC0-1.0",
      "ODbL-1.0",
      "CC-BY-4.0",
    ]);
    expect(data.licenses[0]).toMatchObject({
      textPath: "/api/v1/public/data-licenses/CDLA-Permissive-2.0",
      textAvailable: true,
      appliesTo: expect.stringMatching(/Meta/),
    });
    expect(
      data.sources[0].licensing.upstream.find(
        (u: { dataset: string }) => u.dataset === "Foursquare",
      ).text,
    ).toMatch(/^Data from Foursquare\. Copyright 2024/);
    expect(data.notices[0]).toMatchObject({
      id: "foursquare-notice",
      url: "https://opensource.foursquare.com/places-notice-txt/",
    });
    expect(data.notices[0].text).toMatch(/preserve attribution to Foursquare/);
    expect(data.modifications).toMatch(/E\.164/);
    expect(data.disclaimer).toMatch(/as is/);
    expect(data.overtureRelease).toBeNull();

    const cdla = await h.agent().get(`${API}/public/data-licenses/CDLA-Permissive-2.0`).expect(200);
    expect(cdla.headers["content-type"]).toMatch(/^text\/plain/);
    expect(cdla.text).toMatch(/^Community Data License Agreement - Permissive - Version 2\.0/);
    expect(
      (await h.agent().get(`${API}/public/data-licenses/Apache-2.0`).expect(200)).text,
    ).toMatch(/Apache License/);
    expect(
      (await h.agent().get(`${API}/public/data-licenses/notices/foursquare`).expect(200)).text,
    ).toMatch(/Foursquare OS Places Notice/);
    const missing = await h.agent().get(`${API}/public/data-licenses/MIT`).expect(404);
    expect(missing.body.error.code).toBe("NOT_FOUND");
  });
});

describe("overview metrics", () => {
  it("counts businesses, contacts, sources and imports from real records only", async () => {
    const owner = await createOwner(h, "overview@example.test");
    const empty = await owner.agent
      .get(`${API}/reports/overview`)
      .set(orgHeaders(owner.agent, owner.orgId))
      .expect(200);
    expect(empty.body.data).toMatchObject({
      period: "30d",
      freshnessDays: 180,
      businesses: { total: 0, suppressed: 0, addedInPeriod: 0 },
      contacts: { withPhone: 0, verifiedPhone: 0, whatsappConfirmed: 0 },
      sources: [],
      imports: { total: 0, inProgress: 0, recent: [] },
      discovery: { total: 0, inProgress: 0, completedInPeriod: 0, failedInPeriod: 0, recent: [] },
      credits: { balance: 0, held: 0 },
    });

    const ids = await seedBusinesses(h, owner.orgId, [
      { name: "A", phones: ["0803 123 4567"], emails: ["a@a.example.test"] },
      { name: "B", phones: ["0803 765 4321"], website: "b.example.test" },
      { name: "C" },
    ]);
    // Mark one phone verified, as a verification method would.
    await h.app
      .get(MongoService)
      .database.collection("businesses")
      .updateOne(
        { _id: new ObjectId(ids[0]!) },
        { $set: { "phones.0.state": "verified", "phones.0.lastVerifiedAt": new Date() } },
      );
    await owner.agent
      .post(`${API}/businesses/${ids[2]}/suppress`)
      .set(orgHeaders(owner.agent, owner.orgId))
      .send({ scope: "business", reason: "Opted out" })
      .expect(200);

    const res = await owner.agent
      .get(`${API}/reports/overview?period=7d`)
      .set(orgHeaders(owner.agent, owner.orgId))
      .expect(200);
    expect(res.body.data).toMatchObject({
      period: "7d",
      businesses: { total: 3, suppressed: 1, addedInPeriod: 3 },
      contacts: {
        withPhone: 2,
        withEmail: 1,
        withWebsite: 1,
        verifiedPhone: 1,
        verifiedEmail: 0,
        verifiedWebsite: 0,
        whatsappConfirmed: 0,
        whatsappUserAsserted: 0,
      },
      sources: [{ source: "user_import", businesses: 2 }],
    });
    await owner.agent
      .get(`${API}/reports/overview?period=1y`)
      .set(orgHeaders(owner.agent, owner.orgId))
      .expect(400);
  });
});
