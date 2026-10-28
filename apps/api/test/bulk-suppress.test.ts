import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Collections, MongoService, ObjectId } from "@leadforge/db-mongo";
import { BULK_SUPPRESS_MAX } from "@leadforge/contracts";
import { addMember, API, createHarness, orgHeaders, type Harness } from "./harness.js";
import { createOwner, seedBusinesses, type OrgUser } from "./fixtures.js";

let h: Harness;
beforeAll(async () => {
  h = await createHarness();
});
afterAll(async () => h?.close());
beforeEach(async () => h.resetState());

const bulk = (u: OrgUser, body: unknown) =>
  u.agent
    .post(`${API}/businesses/suppress`)
    .set(orgHeaders(u.agent, u.orgId))
    .send(body as object);

describe("bulk suppression", () => {
  it("suppresses many businesses with per-item outcomes, flags shared values and writes one audit event", async () => {
    const owner = await createOwner(h, "bulk@example.test", "Bulk Org");
    const [a, b, c, d] = await seedBusinesses(h, owner.orgId, [
      { name: "Alpha (Sample)", phones: ["0803 111 0001"], website: "https://alpha.example.test" },
      { name: "Bravo (Sample)", phones: ["0803 111 0002"] },
      { name: "Charlie (Sample)" },
      { name: "Alpha Branch (Sample)", website: "https://alpha.example.test" },
    ]);
    const unknown = new ObjectId().toHexString();
    const res = await bulk(owner, {
      ids: [a, b, c, unknown],
      scope: "phone",
      reason: "Asked not to be called",
    }).expect(200);
    expect(res.body.data.results).toEqual([
      {
        id: a,
        outcome: "suppressed",
        value: "+2348031110001",
        entryId: expect.any(String),
        message: null,
      },
      {
        id: b,
        outcome: "suppressed",
        value: "+2348031110002",
        entryId: expect.any(String),
        message: null,
      },
      {
        id: c,
        outcome: "no_value",
        value: null,
        entryId: null,
        message: "That phone number is not on this business",
      },
      {
        id: unknown,
        outcome: "not_found",
        value: null,
        entryId: null,
        message: "No business with this id in the organization",
      },
    ]);
    expect(res.body.data.summary).toEqual({
      requested: 4,
      suppressed: 2,
      alreadySuppressed: 0,
      notFound: 1,
      noValue: 1,
      failed: 0,
      businessesAffected: 2,
    });

    // Again: nothing new.
    const again = await bulk(owner, {
      ids: [a],
      scope: "phone",
      reason: "Asked not to be called",
    }).expect(200);
    expect(again.body.data.results[0]).toMatchObject({
      outcome: "already_suppressed",
      value: "+2348031110001",
    });

    // A domain suppression flags every business on the domain.
    const domain = await bulk(owner, {
      ids: [a],
      scope: "domain",
      reason: "Company-wide opt-out",
    }).expect(200);
    expect(domain.body.data.summary).toMatchObject({ suppressed: 1, businessesAffected: 2 });
    const list = await owner.agent
      .get(`${API}/businesses?suppression=only&pageSize=100`)
      .set(orgHeaders(owner.agent, owner.orgId))
      .expect(200);
    expect(list.body.data.map((r: { id: string }) => r.id).sort()).toEqual([a, b, d].sort());

    const audit = await h.app
      .get(MongoService)
      .database.collection(Collections.auditEvents)
      .find({ organizationId: owner.orgId, action: "business.bulk_suppressed" })
      .toArray();
    expect(audit).toHaveLength(3);
    const first = audit.find((e) => e.after?.requested === 4);
    expect(first).toMatchObject({
      actorUserId: owner.userId,
      resourceType: "business",
      after: {
        scope: "phone",
        reason: "Asked not to be called",
        suppressed: 2,
        notFound: 1,
        noValue: 1,
      },
    });
    expect(first!.after.items).toHaveLength(4);
  });

  it("caps the request at 100 ids and rejects duplicates and bad scopes", async () => {
    const owner = await createOwner(h, "bulk-cap@example.test", "Cap Org");
    const ids = Array.from({ length: BULK_SUPPRESS_MAX + 1 }, () => new ObjectId().toHexString());
    const tooMany = await bulk(owner, { ids, scope: "business", reason: "Opted out" }).expect(400);
    expect(tooMany.body.error).toMatchObject({
      code: "VALIDATION_FAILED",
      details: [
        expect.objectContaining({ path: "ids", message: "At most 100 businesses per request" }),
      ],
    });
    const dup = await bulk(owner, {
      ids: [ids[0], ids[0]],
      scope: "business",
      reason: "Opted out",
    }).expect(400);
    expect(dup.body.error.details[0]).toMatchObject({ path: "ids" });
    await bulk(owner, { ids: [ids[0]], scope: "everything", reason: "Opted out" }).expect(400);
    await bulk(owner, { ids: [], scope: "business", reason: "Opted out" }).expect(400);
    await bulk(owner, { ids: ["not-an-id"], scope: "business", reason: "Opted out" }).expect(400);
    const ok = await bulk(owner, {
      ids: ids.slice(0, BULK_SUPPRESS_MAX),
      scope: "business",
      reason: "Opted out",
    }).expect(200);
    expect(ok.body.data.summary).toMatchObject({ requested: 100, notFound: 100 });
  });

  it("never touches another organization's businesses", async () => {
    const a = await createOwner(h, "bulk-a@example.test", "Bulk A");
    const b = await createOwner(h, "bulk-b@example.test", "Bulk B");
    const [mine] = await seedBusinesses(h, a.orgId, [{ name: "Mine (Sample)" }]);
    const [theirs] = await seedBusinesses(h, b.orgId, [
      { name: "Theirs (Sample)", phones: ["0803 222 0001"] },
    ]);
    const res = await bulk(a, {
      ids: [mine, theirs],
      scope: "business",
      reason: "Opted out",
    }).expect(200);
    expect(res.body.data.results.map((r: { outcome: string }) => r.outcome)).toEqual([
      "suppressed",
      "not_found",
    ]);
    const detail = await b.agent
      .get(`${API}/businesses/${theirs}`)
      .set(orgHeaders(b.agent, b.orgId))
      .expect(200);
    expect(detail.body.data.suppression.suppressed).toBe(false);
    // A member switching the header to the other organization is refused outright.
    await a.agent
      .post(`${API}/businesses/suppress`)
      .set(orgHeaders(a.agent, b.orgId))
      .send({ ids: [theirs], scope: "business", reason: "Opted out" })
      .expect(403);
  });

  it("is allowed for owners, admins and researchers only", async () => {
    const owner = await createOwner(h, "bulk-roles@example.test", "Roles Org");
    const [id] = await seedBusinesses(h, owner.orgId, [{ name: "Role Target (Sample)" }]);
    const expected = { admin: 200, researcher: 200, sales_rep: 403, analyst: 403 } as const;
    for (const role of Object.keys(expected) as Array<keyof typeof expected>) {
      const m = await addMember(h, owner.orgId, role);
      const res = await m.agent
        .post(`${API}/businesses/suppress`)
        .set(orgHeaders(m.agent, owner.orgId))
        .send({ ids: [id], scope: "business", reason: "Opted out" });
      expect(res.status, role).toBe(expected[role]);
    }
    const anonymous = await h
      .agent()
      .post(`${API}/businesses/suppress`)
      .send({ ids: [id], scope: "business", reason: "x" });
    expect([401, 403]).toContain(anonymous.status);
  });
});
