import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { MongoService, ObjectId } from "@leadforge/db-mongo";
import { ImportsService } from "@leadforge/core";
import { API, createHarness, orgHeaders, type Harness } from "./harness.js";
import { createOwner, csvBuffer, seedBusinesses, uploadCsv, type OrgUser } from "./fixtures.js";

let h: Harness;
beforeAll(async () => {
  h = await createHarness();
});
afterAll(async () => h?.close());
beforeEach(async () => h.resetState());

async function orgWithData(email: string, name: string, businessName: string) {
  const user = await createOwner(h, email, name);
  const [businessId] = await seedBusinesses(h, user.orgId, [
    {
      name: businessName,
      phones: ["0803 123 4567"],
      website: `${name.toLowerCase().replace(/\s/g, "")}.example.test`,
      location: { locality: "Ikeja", region: "Lagos" },
    },
  ]);
  const upload = await uploadCsv(
    user,
    csvBuffer(["Name,Phone", `${businessName} Two,0812 000 1111`]),
  ).expect(201);
  return { user, businessId: businessId!, importId: upload.body.data.id as string };
}

describe("tenant isolation on business records", () => {
  it("returns 404 for every cross-organization id, never another org's data", async () => {
    const a = await orgWithData("a@example.test", "Org A", "Alpha Bakery");
    const b = await orgWithData("b@example.test", "Org B", "Beta Bakery");
    const B = b.user;
    let n = 0;
    const h404 = async (req: ReturnType<OrgUser["agent"]["get"]>) => {
      const res = await req.set(orgHeaders(B.agent, B.orgId));
      n += 1;
      expect(res.status, `cross-org request #${n}`).toBe(404);
      expect(res.body.error.code).toBe("NOT_FOUND");
    };

    await h404(B.agent.get(`${API}/businesses/${a.businessId}`));
    await h404(B.agent.get(`${API}/businesses/${a.businessId}/observations`));
    await h404(B.agent.get(`${API}/businesses/${a.businessId}/verification-events`));
    await h404(
      B.agent.patch(`${API}/businesses/${a.businessId}`).send({ field: "name", value: "Hijacked" }),
    );
    await h404(
      B.agent
        .post(`${API}/businesses/${a.businessId}/suppress`)
        .send({ scope: "business", reason: "cross org" }),
    );
    await h404(B.agent.delete(`${API}/businesses/${a.businessId}/suppression`));
    await h404(B.agent.get(`${API}/businesses?importId=${a.importId}`));
    await h404(B.agent.get(`${API}/imports/${a.importId}`));
    await h404(B.agent.get(`${API}/imports/${a.importId}/rows`));
    await h404(
      B.agent
        .post(`${API}/imports/${a.importId}/preview`)
        .send({ mapping: [{ column: 0, field: "name" }] }),
    );
    await h404(
      B.agent
        .post(`${API}/imports/${a.importId}/commit`)
        .send({ mapping: [{ column: 0, field: "name" }], attestLawfulBasis: true }),
    );
    await h404(
      B.agent.post(`${API}/exports/businesses`).send({ filter: { importId: a.importId } }),
    );

    // Lists, search, facets and overview only ever show B's records.
    const list = await B.agent
      .get(`${API}/businesses?suppression=include`)
      .set(orgHeaders(B.agent, B.orgId))
      .expect(200);
    expect(list.body.data.map((x: { name: string }) => x.name)).toEqual(["Beta Bakery"]);
    expect(list.body.meta.total).toBe(1);
    const search = await B.agent
      .get(`${API}/businesses?q=alpha`)
      .set(orgHeaders(B.agent, B.orgId))
      .expect(200);
    expect(search.body.data).toEqual([]);
    const facets = await B.agent
      .get(`${API}/businesses/facets`)
      .set(orgHeaders(B.agent, B.orgId))
      .expect(200);
    expect(facets.body.data.total).toBe(1);
    const imports = await B.agent
      .get(`${API}/imports`)
      .set(orgHeaders(B.agent, B.orgId))
      .expect(200);
    expect(imports.body.data.map((j: { id: string }) => j.id)).toEqual([b.importId]);
    const overview = await B.agent
      .get(`${API}/reports/overview`)
      .set(orgHeaders(B.agent, B.orgId))
      .expect(200);
    expect(overview.body.data.businesses.total).toBe(1);
    expect(overview.body.data.imports.total).toBe(1);

    // Exporting A's ids from B yields nothing of A's.
    const exp = await B.agent
      .post(`${API}/exports/businesses`)
      .set(orgHeaders(B.agent, B.orgId))
      .send({ ids: [a.businessId], columns: ["name"] })
      .expect(200);
    expect(exp.headers["x-export-row-count"]).toBe("0");
    expect(exp.text).not.toContain("Alpha");

    // A's data is untouched: zero cross-org writes.
    const aDetail = await a.user.agent
      .get(`${API}/businesses/${a.businessId}`)
      .set(orgHeaders(a.user.agent, a.user.orgId))
      .expect(200);
    expect(aDetail.body.data.name.value).toBe("Alpha Bakery");
    expect(aDetail.body.data.suppression.suppressed).toBe(false);
    const aImport = await a.user.agent
      .get(`${API}/imports/${a.importId}`)
      .set(orgHeaders(a.user.agent, a.user.orgId))
      .expect(200);
    expect(aImport.body.data.status).toBe("uploaded");
  });

  it("refuses another organization's scope header on every new endpoint", async () => {
    const a = await orgWithData("a2@example.test", "Org A", "Alpha");
    const b = await createOwner(h, "b2@example.test", "Org B");
    const asA = { "X-Organization-Id": a.user.orgId };
    const paths = [
      "/businesses",
      "/businesses/facets",
      `/businesses/${a.businessId}`,
      `/imports/${a.importId}`,
      "/imports",
      "/sources",
      "/reports/overview",
    ];
    for (const path of paths) {
      const res = await b.agent.get(`${API}${path}`).set(asA);
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe("ORG_FORBIDDEN");
    }
  });

  it("suppression entries and dedup never cross organizations", async () => {
    const a = await createOwner(h, "a3@example.test", "Org A");
    const b = await createOwner(h, "b3@example.test", "Org B");
    const [aId] = await seedBusinesses(h, a.orgId, [
      { name: "Shared Name", phones: ["0803 123 4567"] },
    ]);
    await a.agent
      .post(`${API}/businesses/${aId}/suppress`)
      .set(orgHeaders(a.agent, a.orgId))
      .send({ scope: "phone", reason: "Org A only" })
      .expect(200);
    // Same name and phone in B: not suppressed and not merged into A's record.
    const [bId] = await seedBusinesses(h, b.orgId, [
      { name: "Shared Name", phones: ["0803 123 4567"] },
    ]);
    expect(bId).not.toBe(aId);
    const bDetail = await b.agent
      .get(`${API}/businesses/${bId}`)
      .set(orgHeaders(b.agent, b.orgId))
      .expect(200);
    expect(bDetail.body.data.suppression).toMatchObject({ suppressed: false, entries: [] });
    expect(bDetail.body.data.provenance.totalObservations).toBe(2);
  });

  it("rejects an import job whose organization does not own the import before doing any work", async () => {
    const a = await orgWithData("a4@example.test", "Org A", "Alpha");
    const b = await createOwner(h, "b4@example.test", "Org B");
    const imports = h.app.get(ImportsService, { strict: false });
    await expect(imports.process(b.orgId, a.importId)).rejects.toThrow(/not found/);
    const db = h.app.get(MongoService).database;
    const job = await db.collection("import_jobs").findOne({ _id: new ObjectId(a.importId) });
    expect(job?.status).toBe("uploaded");
    expect(await db.collection("businesses").countDocuments({ organizationId: b.orgId })).toBe(0);
  });
});
