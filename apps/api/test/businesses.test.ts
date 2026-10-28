import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { MongoService, ObjectId } from "@leadforge/db-mongo";
import { ProvenanceService } from "@leadforge/core";
import { API, createHarness, orgHeaders, type Harness } from "./harness.js";
import { createOwner, seedBusinesses, type OrgUser } from "./fixtures.js";

let h: Harness;
beforeAll(async () => {
  h = await createHarness();
});
afterAll(async () => h?.close());
beforeEach(async () => h.resetState());

const DAY = 24 * 60 * 60 * 1000;
const get = (u: OrgUser, path: string) =>
  u.agent.get(`${API}${path}`).set(orgHeaders(u.agent, u.orgId));
const patch = (u: OrgUser, path: string, body: unknown) =>
  u.agent
    .patch(`${API}${path}`)
    .set(orgHeaders(u.agent, u.orgId))
    .send(body as object);
const post = (u: OrgUser, path: string, body: unknown = {}) =>
  u.agent
    .post(`${API}${path}`)
    .set(orgHeaders(u.agent, u.orgId))
    .send(body as object);
const del = (u: OrgUser, path: string) =>
  u.agent.delete(`${API}${path}`).set(orgHeaders(u.agent, u.orgId));

async function standardOrg() {
  const owner = await createOwner(
    h,
    `owner-${Math.random().toString(36).slice(2, 7)}@example.test`,
    "Directory Org",
  );
  const ids = await seedBusinesses(h, owner.orgId, [
    {
      name: "Acme Foods",
      categories: ["Restaurant"],
      phones: ["0803 123 4567"],
      emails: ["info@acme.example.test"],
      website: "acme.example.test",
      location: { locality: "Ikeja", region: "Lagos" },
    },
    {
      name: "Bola Pharmacy",
      categories: ["Pharmacy"],
      phones: ["0812 000 1111"],
      location: { locality: "Yaba", region: "Lagos State" },
    },
    {
      name: "Chi Salon",
      categories: ["Salon", "Spa"],
      emails: ["chi@salon.example.test"],
      location: { locality: "Wuse", region: "FCT" },
    },
    {
      name: "Delta Logistics",
      categories: ["Logistics"],
      website: "delta.example.test",
      location: { locality: "Warri", region: "Delta" },
    },
  ]);
  return { owner, ids };
}

describe("directory list", () => {
  it("filters by category, location, presence, source and search", async () => {
    const { owner } = await standardOrg();
    const names = async (q: string) =>
      (await get(owner, `/businesses?sort=name:asc${q}`).expect(200)).body.data.map(
        (b: { name: string }) => b.name,
      );

    expect(await names("")).toEqual([
      "Acme Foods",
      "Bola Pharmacy",
      "Chi Salon",
      "Delta Logistics",
    ]);
    expect(await names("&category=pharmacy")).toEqual(["Bola Pharmacy"]);
    expect(await names("&category=Salon&category=Logistics")).toEqual([
      "Chi Salon",
      "Delta Logistics",
    ]);
    expect(await names("&region=Lagos")).toEqual(["Acme Foods", "Bola Pharmacy"]);
    expect(await names("&region=Federal%20Capital%20Territory")).toEqual(["Chi Salon"]);
    expect(await names("&locality=ikeja")).toEqual(["Acme Foods"]);
    expect(await names("&hasPhone=true")).toEqual(["Acme Foods", "Bola Pharmacy"]);
    expect(await names("&hasWebsite=false")).toEqual(["Bola Pharmacy", "Chi Salon"]);
    expect(await names("&hasEmail=true&hasPhone=true")).toEqual(["Acme Foods"]);
    expect(await names("&source=user_import")).toHaveLength(4);
    expect(await names("&source=google_places")).toEqual([]);
    expect(await names("&q=pharm")).toEqual(["Bola Pharmacy"]);
    expect(await names("&q=acme%20food")).toEqual(["Acme Foods"]);
    expect(await names("&q=0803%20123")).toEqual(["Acme Foods"]);
    expect(await names("&q=%2B234%20812")).toEqual(["Bola Pharmacy"]);
    expect(await names("&q=salon.example")).toEqual(["Chi Salon"]);
    // Regex metacharacters are literal: "acme.*" searches the word "acme".
    expect(await names("&q=acme.*")).toEqual(["Acme Foods"]);
    expect(await names("&q=zzz")).toEqual([]);
  });

  it("returns directory row shapes, totals on the first page and stable cursors", async () => {
    const { owner } = await standardOrg();
    const first = await get(owner, "/businesses?pageSize=3&sort=name:asc").expect(200);
    expect(first.body.meta).toMatchObject({ pageSize: 3, total: 4 });
    expect(first.body.data[0]).toMatchObject({
      name: "Acme Foods",
      categories: ["Restaurant"],
      location: { locality: "Ikeja", region: "Lagos", country: "NG" },
      website: { domain: "acme.example.test", state: "unverified" },
      phone: {
        value: "+2348031234567",
        international: "+234 803 123 4567",
        state: "unverified",
        whatsapp: "unknown",
      },
      email: { value: "info@acme.example.test", state: "unverified" },
      whatsapp: "unknown",
      states: {
        website: "unverified",
        phone: "unverified",
        email: "unverified",
        location: "unverified",
      },
      score: null,
      sources: ["user_import"],
      sourceCount: 1,
      suppressed: false,
    });
    expect(first.body.data[2].states.phone).toBe("missing");
    const second = await get(
      owner,
      `/businesses?pageSize=3&sort=name:asc&cursor=${first.body.meta.nextCursor}`,
    ).expect(200);
    expect(second.body.data.map((b: { name: string }) => b.name)).toEqual(["Delta Logistics"]);
    expect(second.body.meta.total).toBeUndefined();
    expect(second.body.meta.nextCursor).toBeNull();

    // A cursor issued for one sort cannot be replayed under another.
    const wrongSort = await get(
      owner,
      `/businesses?pageSize=3&sort=createdAt:desc&cursor=${first.body.meta.nextCursor}`,
    ).expect(400);
    expect(wrongSort.body.error.details[0].path).toBe("cursor");
    await get(owner, "/businesses?cursor=garbage!!").expect(400);
    await get(owner, "/businesses?sort=score:desc").expect(400);
    await get(owner, "/businesses?phoneState=probably").expect(400);
  });

  it("derives stale from the organization freshness window and filters on it", async () => {
    const owner = await createOwner(h, "fresh@example.test", "Freshness Org");
    await seedBusinesses(h, owner.orgId, [{ name: "Old Shop", phones: ["0803 111 2222"] }], {
      collectedAt: new Date(Date.now() - 120 * DAY),
    });
    await seedBusinesses(h, owner.orgId, [{ name: "New Shop", phones: ["0803 333 4444"] }]);

    const stale = async () =>
      (await get(owner, "/businesses?phoneState=stale").expect(200)).body.data.map(
        (b: { name: string }) => b.name,
      );
    expect(await stale()).toEqual([]);
    await patch(owner, "/organizations/current", { freshnessDays: 90 }).expect(200);
    expect(await stale()).toEqual(["Old Shop"]);
    const unverified = await get(owner, "/businesses?phoneState=unverified").expect(200);
    expect(unverified.body.data.map((b: { name: string }) => b.name)).toEqual(["New Shop"]);
    const detail = await get(
      owner,
      `/businesses/${(await get(owner, "/businesses?q=old").expect(200)).body.data[0].id}`,
    ).expect(200);
    expect(detail.body.data.freshnessDays).toBe(90);
    expect(detail.body.data.phones[0].state).toBe("stale");
  });

  it("filters by ids (comma-separated or repeated, at most 100), combined with the other filters and scoped to the organization", async () => {
    const { owner, ids } = await standardOrg();
    const [acme, bola, chi, delta] = ids as [string, string, string, string];
    const other = await createOwner(h, "ids-other@example.test", "Other Org");
    const [foreign] = await seedBusinesses(h, other.orgId, [{ name: "Foreign Bakery (Sample)" }]);
    const page = async (q: string) => {
      const res = await get(owner, `/businesses?sort=name:asc${q}`).expect(200);
      return {
        names: res.body.data.map((b: { name: string }) => b.name) as string[],
        total: res.body.meta.total as number,
      };
    };

    expect(await page(`&ids=${acme},${chi}`)).toEqual({
      names: ["Acme Foods", "Chi Salon"],
      total: 2,
    });
    expect((await page(`&ids=${acme}&ids=${delta}`)).names).toEqual([
      "Acme Foods",
      "Delta Logistics",
    ]);
    expect((await page(`&ids=${acme},${bola}&ids=${chi}`)).names).toEqual([
      "Acme Foods",
      "Bola Pharmacy",
      "Chi Salon",
    ]);
    // Upper-case and repeated ids are the same businesses, once each.
    expect((await page(`&ids=${acme.toUpperCase()},${acme}`)).names).toEqual(["Acme Foods"]);
    // Combines with every other filter (AND), including search and the default that hides suppressed businesses.
    expect((await page(`&ids=${acme},${bola},${chi}&region=Lagos`)).names).toEqual([
      "Acme Foods",
      "Bola Pharmacy",
    ]);
    expect((await page(`&ids=${acme},${bola}&q=pharm`)).names).toEqual(["Bola Pharmacy"]);
    await post(owner, `/businesses/${bola}/suppress`, {
      scope: "business",
      reason: "Asked not to be contacted",
    }).expect(200);
    expect((await page(`&ids=${acme},${bola}`)).names).toEqual(["Acme Foods"]);
    expect((await page(`&ids=${acme},${bola}&suppression=include`)).names).toEqual([
      "Acme Foods",
      "Bola Pharmacy",
    ]);
    // Another organization's id matches nothing, exactly like an id that does not exist.
    expect(await page(`&ids=${foreign}`)).toEqual({ names: [], total: 0 });
    expect(await page(`&ids=${new ObjectId().toHexString()}`)).toEqual({ names: [], total: 0 });
    expect((await page(`&ids=${foreign},${delta}`)).names).toEqual(["Delta Logistics"]);
    // Cursor pages keep the filter.
    const first = await get(
      owner,
      `/businesses?sort=name:asc&pageSize=1&ids=${acme},${chi},${delta}`,
    ).expect(200);
    expect(first.body.data.map((b: { name: string }) => b.name)).toEqual(["Acme Foods"]);
    const second = await get(
      owner,
      `/businesses?sort=name:asc&pageSize=1&ids=${acme},${chi},${delta}&cursor=${encodeURIComponent(first.body.meta.nextCursor)}`,
    ).expect(200);
    expect(second.body.data.map((b: { name: string }) => b.name)).toEqual(["Chi Salon"]);

    // More than 100 ids, or a malformed one, is 400 on `ids`.
    const many = Array.from({ length: 101 }, () => new ObjectId().toHexString());
    const over = await get(owner, `/businesses?ids=${many.join(",")}`).expect(400);
    expect(over.body.error.code).toBe("VALIDATION_FAILED");
    expect(over.body.error.details).toEqual([expect.objectContaining({ path: "ids" })]);
    await get(owner, `/businesses?ids=${many.slice(0, 100).join(",")}`).expect(200);
    const split = await get(
      owner,
      `/businesses?ids=${many.slice(0, 60).join(",")}&ids=${many.slice(60).join(",")}`,
    ).expect(400);
    expect(split.body.error.details).toEqual([expect.objectContaining({ path: "ids" })]);
    const malformed = await get(owner, `/businesses?ids=${acme},nope`).expect(400);
    expect(malformed.body.error.details?.[0]?.path).toMatch(/^ids/);
    // The other organization sees only its own business, whatever ids it names.
    const theirs = await other.agent
      .get(`${API}/businesses?ids=${acme},${foreign}`)
      .set(orgHeaders(other.agent, other.orgId))
      .expect(200);
    expect(theirs.body.data.map((b: { name: string }) => b.name)).toEqual([
      "Foreign Bakery (Sample)",
    ]);
  });

  it("serves facets with counts for the filter UI", async () => {
    const { owner } = await standardOrg();
    const res = await get(owner, "/businesses/facets").expect(200);
    expect(res.body.data.total).toBe(4);
    expect(res.body.data.regions).toEqual(
      expect.arrayContaining([
        { value: "lagos", label: "Lagos", count: 2 },
        { value: "federal capital territory", label: "Federal Capital Territory", count: 1 },
      ]),
    );
    expect(res.body.data.regions[0]).toEqual({ value: "lagos", label: "Lagos", count: 2 });
    expect(res.body.data.categories).toHaveLength(5);
    expect(res.body.data.sources).toEqual([
      { value: "user_import", label: "user_import", count: 4 },
    ]);
    expect(res.body.data.whatsapp).toEqual([{ value: "unknown", label: "unknown", count: 4 }]);
    expect(res.body.data.maxAgeSeconds).toBe(60);
  });
});

describe("business detail, provenance and corrections", () => {
  it("returns the field model with provenance and records each correction as user_edit", async () => {
    const { owner, ids } = await standardOrg();
    const id = ids[0]!;
    const detail = await get(owner, `/businesses/${id}`).expect(200);
    const d = detail.body.data;
    expect(d.name).toMatchObject({
      value: "Acme Foods",
      rawValue: "Acme Foods",
      state: "unverified",
      confidence: 0.6,
    });
    expect(d.name.observationIds).toHaveLength(1);
    expect(d.website).toMatchObject({
      value: "https://acme.example.test",
      domain: "acme.example.test",
      state: "unverified",
      alternatives: [],
    });
    expect(d.phones[0]).toMatchObject({
      e164: "+2348031234567",
      national: "0803 123 4567",
      country: "NG",
      type: "mobile",
      whatsapp: { status: "unknown" },
    });
    expect(d.location.value).toMatchObject({
      locality: "Ikeja",
      region: "Lagos",
      country: "NG",
      formatted: "Ikeja, Lagos, Nigeria",
    });
    expect(d.provenance.totalObservations).toBe(6);
    expect(d.sources).toEqual([
      expect.objectContaining({ source: "user_import", observationCount: 6 }),
    ]);
    expect(d.suppression).toMatchObject({ suppressed: false, entries: [] });

    const name = await patch(owner, `/businesses/${id}`, {
      field: "name",
      value: "Acme Foods Nigeria",
    }).expect(200);
    expect(name.body.data.name).toMatchObject({
      value: "Acme Foods Nigeria",
      state: "unverified",
      confidence: 0.8,
    });

    const website = await patch(owner, `/businesses/${id}`, {
      field: "website",
      value: "https://www.acme-foods.example.test/home/",
    }).expect(200);
    expect(website.body.data.website).toMatchObject({
      value: "https://www.acme-foods.example.test/home",
      domain: "acme-foods.example.test",
    });

    const addEmail = await patch(owner, `/businesses/${id}`, {
      field: "email",
      value: "Sales@Acme.example.test",
    }).expect(200);
    expect(addEmail.body.data.emails.map((e: { address: string }) => e.address)).toEqual([
      "info@acme.example.test",
      "sales@acme.example.test",
    ]);
    const removeEmail = await patch(owner, `/businesses/${id}`, {
      field: "email",
      target: "info@acme.example.test",
      value: null,
    }).expect(200);
    expect(removeEmail.body.data.emails.map((e: { address: string }) => e.address)).toEqual([
      "sales@acme.example.test",
    ]);

    const wa = await patch(owner, `/businesses/${id}`, {
      field: "whatsapp",
      target: "0803 123 4567",
      value: "user_asserted",
    }).expect(200);
    expect(wa.body.data.whatsapp).toBe("user_asserted");
    expect(wa.body.data.phones[0].whatsapp).toMatchObject({
      status: "user_asserted",
      assertedByUserId: owner.userId,
    });

    const cats = await patch(owner, `/businesses/${id}`, {
      field: "categories",
      value: ["Restaurant", "Bakery", "restaurant"],
    }).expect(200);
    expect(cats.body.data.categories.map((c: { value: string }) => c.value)).toEqual([
      "Restaurant",
      "Bakery",
    ]);

    const loc = await patch(owner, `/businesses/${id}`, {
      field: "location",
      value: { street: "12 Allen Avenue", locality: "Ikeja", region: "lagos state" },
    }).expect(200);
    expect(loc.body.data.location.value).toMatchObject({
      street: "12 Allen Avenue",
      region: "Lagos",
      country: "NG",
    });

    const edits = await get(
      owner,
      `/businesses/${id}/observations?source=user_edit&pageSize=3`,
    ).expect(200);
    expect(edits.body.data.map((o: { field: string }) => o.field)).toEqual([
      "location",
      "category",
      "whatsapp",
    ]);
    const rest = await get(
      owner,
      `/businesses/${id}/observations?source=user_edit&pageSize=10&cursor=${edits.body.meta.nextCursor}`,
    ).expect(200);
    expect(
      rest.body.data.map((o: { field: string; action: string }) => `${o.field}:${o.action}`),
    ).toEqual(["email:remove", "email:set", "website:set", "name:set"]);
  });

  it("rejects invalid corrections with field-level details", async () => {
    const { owner, ids } = await standardOrg();
    const id = ids[0]!;
    const badPhone = await patch(owner, `/businesses/${id}`, {
      field: "phone",
      value: "12345",
    }).expect(400);
    expect(badPhone.body.error).toMatchObject({
      code: "VALIDATION_FAILED",
      details: [{ path: "value" }],
    });
    const notOnBusiness = await patch(owner, `/businesses/${id}`, {
      field: "phone",
      target: "+2348099999999",
      value: null,
    }).expect(400);
    expect(notOnBusiness.body.error.details[0].path).toBe("target");
    const social = await patch(owner, `/businesses/${id}`, {
      field: "website",
      value: "https://instagram.com/acme",
    }).expect(400);
    expect(social.body.error.details[0].message).toMatch(/instagram/);
    const confirmed = await patch(owner, `/businesses/${id}`, {
      field: "whatsapp",
      target: "+2348031234567",
      value: "confirmed",
    }).expect(400);
    expect(confirmed.body.error.code).toBe("VALIDATION_FAILED");
    await patch(owner, `/businesses/${id}`, { field: "score", value: 1 }).expect(400);
  });

  it("returns 404 for unknown ids and 400 for malformed ids", async () => {
    const { owner } = await standardOrg();
    const unknown = new ObjectId().toHexString();
    expect((await get(owner, `/businesses/${unknown}`).expect(404)).body.error.code).toBe(
      "NOT_FOUND",
    );
    await get(owner, `/businesses/${unknown}/observations`).expect(404);
    await get(owner, `/businesses/${unknown}/verification-events`).expect(404);
    await patch(owner, `/businesses/${unknown}`, { field: "name", value: "x" }).expect(404);
    await post(owner, `/businesses/${unknown}/suppress`, {
      scope: "business",
      reason: "test reason",
    }).expect(404);
    await get(owner, "/businesses/not-an-id").expect(400);
  });

  it("lists verification events newest first", async () => {
    const { owner, ids } = await standardOrg();
    const provenance = h.app.get(ProvenanceService, { strict: false });
    const businessId = new ObjectId(ids[0]!);
    for (const [i, result] of (["failed", "passed"] as const).entries()) {
      await provenance.recordVerificationEvent(owner.orgId, {
        businessId,
        field: "email",
        fieldKey: "info@acme.example.test",
        method: "mx_check",
        result,
        details: null,
        actorType: "system",
        actorId: null,
        occurredAt: new Date(Date.now() - (2 - i) * 1000),
      });
    }
    const res = await get(owner, `/businesses/${ids[0]}/verification-events`).expect(200);
    expect(res.body.data.map((e: { result: string }) => e.result)).toEqual(["passed", "failed"]);
    const detail = await get(owner, `/businesses/${ids[0]}`).expect(200);
    expect(detail.body.data.recentVerificationEvents).toHaveLength(2);
  });
});

describe("manual creation", () => {
  it("creates with user_edit provenance and refuses an exact duplicate", async () => {
    const owner = await createOwner(h, "manual@example.test");
    const created = await post(owner, "/businesses", {
      name: "Zara Prints",
      categories: ["Printing"],
      phones: ["0803 765 4321"],
      location: { locality: "Surulere", region: "Lagos" },
    }).expect(201);
    expect(created.body.data.createdVia).toMatchObject({ kind: "manual", userId: owner.userId });
    expect(
      created.body.data.provenance.recent.every(
        (o: { source: string }) => o.source === "user_edit",
      ),
    ).toBe(true);

    const dup = await post(owner, "/businesses", {
      name: "ZARA PRINTS LTD",
      phones: ["+234 803 765 4321"],
    }).expect(409);
    expect(dup.body.error).toMatchObject({
      code: "CONFLICT",
      details: [{ path: "existingBusinessId", message: created.body.data.id }],
    });

    // A business whose phone is suppressed cannot be added again by hand.
    await post(owner, `/businesses/${created.body.data.id}/suppress`, {
      scope: "phone",
      reason: "Do not contact",
    }).expect(200);
    const suppressed = await post(owner, "/businesses", {
      name: "Another Name",
      phones: ["0803 765 4321"],
    }).expect(409);
    expect(suppressed.body.error.code).toBe("CONFLICT");
    expect(suppressed.body.error.message).toMatch(/suppression/);

    const invalid = await post(owner, "/businesses", {
      name: "Bad",
      phones: ["123"],
      emails: ["nope"],
    }).expect(400);
    expect(invalid.body.error.details.map((d: { path: string }) => d.path)).toEqual([
      "phones.0",
      "emails.0",
    ]);
  });
});

describe("suppression", () => {
  it("suppresses by business, hides from the directory, and lifts it again", async () => {
    const { owner, ids } = await standardOrg();
    const res = await post(owner, `/businesses/${ids[1]}/suppress`, {
      scope: "business",
      reason: "Requested removal by phone",
    }).expect(200);
    expect(res.body.data.suppression).toMatchObject({
      suppressed: true,
      reason: "Requested removal by phone",
      suppressedByUserId: owner.userId,
    });
    expect(res.body.data.suppression.entries[0]).toMatchObject({ kind: "business", value: ids[1] });

    const visible = await get(owner, "/businesses").expect(200);
    expect(visible.body.data.map((b: { id: string }) => b.id)).not.toContain(ids[1]);
    const only = await get(owner, "/businesses?suppression=only").expect(200);
    expect(only.body.data.map((b: { id: string }) => b.id)).toEqual([ids[1]]);

    const lifted = await del(owner, `/businesses/${ids[1]}/suppression`).expect(200);
    expect(lifted.body.data.suppression).toMatchObject({ suppressed: false, entries: [] });
    expect((await get(owner, "/businesses").expect(200)).body.data).toHaveLength(4);
  });

  it("suppresses a domain across every business that uses it and validates the scope", async () => {
    const owner = await createOwner(h, "domain@example.test");
    const ids = await seedBusinesses(h, owner.orgId, [
      { name: "Branch One", website: "chain.example.test" },
      { name: "Branch Two", website: "https://www.chain.example.test/lekki" },
      { name: "No Site" },
    ]);
    const res = await post(owner, `/businesses/${ids[0]}/suppress`, {
      scope: "domain",
      reason: "Chain opted out",
    }).expect(200);
    expect(res.body.data.suppression.entries[0]).toMatchObject({
      kind: "domain",
      value: "chain.example.test",
    });
    const only = await get(owner, "/businesses?suppression=only&sort=name:asc").expect(200);
    expect(only.body.data.map((b: { name: string }) => b.name)).toEqual([
      "Branch One",
      "Branch Two",
    ]);

    const noSite = await post(owner, `/businesses/${ids[2]}/suppress`, {
      scope: "domain",
      reason: "No website here",
    }).expect(400);
    expect(noSite.body.error.details[0].path).toBe("scope");
    await post(owner, `/businesses/${ids[2]}/suppress`, { scope: "business" }).expect(400);

    // Lifting from the second branch does not remove the entry the first branch created.
    const stillSuppressed = await del(owner, `/businesses/${ids[1]}/suppression`).expect(200);
    expect(stillSuppressed.body.data.suppression.suppressed).toBe(true);
    await del(owner, `/businesses/${ids[0]}/suppression`).expect(200);
    expect((await get(owner, "/businesses?suppression=only").expect(200)).body.data).toHaveLength(
      0,
    );
  });

  it("writes audit events for corrections and suppression", async () => {
    const { owner, ids } = await standardOrg();
    await patch(owner, `/businesses/${ids[0]}`, { field: "name", value: "Renamed" }).expect(200);
    await post(owner, `/businesses/${ids[0]}/suppress`, {
      scope: "business",
      reason: "Audit check",
    }).expect(200);
    await del(owner, `/businesses/${ids[0]}/suppression`).expect(200);
    const events = await h.app
      .get(MongoService)
      .database.collection("audit_events")
      .find({ organizationId: owner.orgId, resourceId: ids[0] })
      .sort({ occurredAt: 1 })
      .toArray();
    expect(events.map((e) => e.action)).toEqual([
      "business.corrected",
      "business.suppressed",
      "business.unsuppressed",
    ]);
    expect(events[0]).toMatchObject({
      actorUserId: owner.userId,
      before: { field: "name", value: "Acme Foods" },
      after: { field: "name", value: "Renamed" },
    });
  });
});
