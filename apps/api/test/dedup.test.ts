import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Collections, EJSON, MongoService, ObjectId, type Document } from "@leadforge/db-mongo";
import { addMember, API, createHarness, orgHeaders, type Harness } from "./harness.js";
import { createOwner, seedBusinesses, type OrgUser } from "./fixtures.js";
import type { Json } from "./discovery-helpers.js";
import { startPhase4Workers, waitFor } from "./phase4-helpers.js";

let h: Harness;
beforeAll(async () => {
  h = await createHarness();
});
afterAll(async () => h?.close());
beforeEach(async () => h.resetState());

const get = (u: OrgUser, path: string) =>
  u.agent.get(`${API}${path}`).set(orgHeaders(u.agent, u.orgId));
const post = (u: OrgUser, path: string, body: unknown = {}) =>
  u.agent
    .post(`${API}${path}`)
    .set(orgHeaders(u.agent, u.orgId))
    .send(body as object);

/** Raw business documents, as stored, without `version` (undo moves it forward on purpose). */
async function raw(ids: string[]): Promise<string[]> {
  const col = h.app.get(MongoService).database.collection(Collections.businesses);
  const docs = await col
    .find({ _id: { $in: ids.map((i) => new ObjectId(i)) } })
    .sort({ _id: 1 })
    .toArray();
  return docs.map((d: Document) => {
    const { version: _v, ...rest } = d;
    return EJSON.stringify(rest, { relaxed: false });
  });
}

async function seedPairs(owner: OrgUser) {
  return seedBusinesses(h, owner.orgId, [
    {
      name: "Mama Put Kitchen (Sample)",
      phones: ["0803 111 2222"],
      categories: ["Restaurant"],
      website: "mamaput.example.test",
      location: { locality: "Ikeja", region: "Lagos" },
    },
    {
      name: "Mama Put Kitchens (Sample)",
      emails: ["orders@mamaput-kitchens.example.test"],
      categories: ["Catering"],
      location: { locality: "Ikeja", region: "Lagos" },
    },
    // Same name, different city, nothing shared: a name-only match.
    { name: "Mama Put Kitchen (Sample)", location: { locality: "Wuse", region: "Abuja" } },
    // Shares the phone with the first but is a different business.
    {
      name: "Zenith Motors (Sample)",
      phones: ["0803 111 2222"],
      location: { locality: "Yaba", region: "Lagos" },
    },
  ]);
}

async function candidates(owner: OrgUser, query = ""): Promise<Json[]> {
  return (await get(owner, `/dedup/candidates${query}`).expect(200)).body.data as Json[];
}

describe("duplicate review queue", () => {
  it("proposes corroborated pairs only, never a name-only match, with reasons", async () => {
    const owner = await createOwner(h, "dd-owner@example.test", "Dedup Org");
    const [a, b, abuja, zenith] = await seedPairs(owner);
    const w = startPhase4Workers(h, ["dedup"]);
    try {
      // Ingest queued a duplicate search for the new records; an explicit scan is idempotent.
      await post(owner, "/dedup/scan", {}).expect(202);
      await waitFor(async () => (await candidates(owner)).length === 1, 20_000, "candidates");
      await new Promise((r) => setTimeout(r, 500));
    } finally {
      await w.close();
    }
    const list = await candidates(owner);
    expect(list).toHaveLength(1);
    const c = list[0]!;
    expect([...c.businessIds].sort()).toEqual([a, b].sort());
    expect(c).toMatchObject({ stage: "name_location", status: "pending" });
    expect(c.reasons[0]).toBe("Both are in Ikeja");
    expect(c.signals.map((s: Json) => s.kind)).toEqual(["name_similarity", "same_locality"]);
    expect(c.businesses.map((x: Json) => x.live)).toEqual([true, true]);
    // Backlog 11 (Phase 6): phones come with a display (international) format next to E.164.
    const withPhone = c.businesses.find((x: Json) => x.id === a) as Json;
    expect(withPhone.phones).toEqual(["+2348031112222"]);
    expect(withPhone.phonesDisplay).toEqual([
      { e164: "+2348031112222", international: "+234 803 111 2222" },
    ]);
    for (const id of [abuja, zenith])
      expect(
        await candidates(owner, `?businessId=${id}&status=pending&status=deferred&status=rejected`),
      ).toEqual([]);
    expect((await get(owner, `/businesses/${a}`).expect(200)).body.data.dedup).toMatchObject({
      status: "has_candidates",
      candidateCount: 1,
    });
  });

  it("merges into the chosen survivor and undo restores both records exactly", async () => {
    const owner = await createOwner(h, "dd-merge@example.test", "Merge Org");
    const [a, b] = await seedPairs(owner);
    const w = startPhase4Workers(h, ["dedup"]);
    try {
      await waitFor(async () => (await candidates(owner)).length === 1, 20_000, "candidate");
    } finally {
      await w.close();
    }
    const [candidate] = await candidates(owner);
    const before = await raw([a!, b!]);

    const merged = await post(owner, `/dedup/candidates/${candidate!.id}/merge`, {
      survivorId: a,
      fields: { name: "survivor" },
    }).expect(200);
    expect(merged.body.data.candidate).toMatchObject({
      status: "merged",
      mergeId: merged.body.data.merge.id,
    });
    expect(merged.body.data.merge).toMatchObject({
      survivorId: a,
      mergedIds: [b],
      status: "applied",
      canUndo: true,
      undoForced: false,
    });
    // Backlog 8 (Phase 6): merge history carries the business names from the merge snapshots.
    expect(merged.body.data.merge).toMatchObject({
      survivorName: "Mama Put Kitchen (Sample)",
      mergedNames: [{ id: b, name: "Mama Put Kitchens (Sample)" }],
    });
    const history = (await get(owner, `/dedup/merges?businessId=${a}`).expect(200)).body
      .data as Json[];
    expect(history[0]).toMatchObject({
      survivorName: "Mama Put Kitchen (Sample)",
      mergedNames: [{ id: b, name: "Mama Put Kitchens (Sample)" }],
    });
    const survivor = (await get(owner, `/businesses/${a}`).expect(200)).body.data as Json;
    expect(survivor.emails.map((e: Json) => e.address)).toEqual([
      "orders@mamaput-kitchens.example.test",
    ]);
    expect(survivor.categories.map((c: Json) => c.key).sort()).toEqual(["catering", "restaurant"]);
    expect(survivor.dedup).toMatchObject({ absorbedIds: [b] });
    // Provenance of the merged record is listed with the survivor.
    const observations = (
      await get(owner, `/businesses/${a}/observations?pageSize=100`).expect(200)
    ).body.data as Json[];
    expect(observations.some((o) => o.businessId === b)).toBe(true);
    await get(owner, `/businesses/${b}`).expect(404);
    expect(
      ((await get(owner, "/businesses").expect(200)).body.data as Json[]).some((x) => x.id === b),
    ).toBe(false);
    const audit = await h.app
      .get(MongoService)
      .database.collection(Collections.auditEvents)
      .findOne({ organizationId: owner.orgId, action: "dedup.merged" });
    expect(audit).toMatchObject({ resourceId: a, after: { mergeId: merged.body.data.merge.id } });

    const undone = await post(owner, `/dedup/merges/${merged.body.data.merge.id}/undo`, {}).expect(
      200,
    );
    expect(undone.body.data).toMatchObject({
      status: "undone",
      undoneByUserId: owner.userId,
      undoForced: false,
      canUndo: false,
    });
    expect(await raw([a!, b!])).toEqual(before);
    expect((await candidates(owner))[0]).toMatchObject({
      id: candidate!.id,
      status: "pending",
      mergeId: null,
    });
    const again = await post(owner, `/dedup/merges/${merged.body.data.merge.id}/undo`, {}).expect(
      409,
    );
    expect(again.body.error.code).toBe("CONFLICT");
    expect(
      await h.app
        .get(MongoService)
        .database.collection(Collections.auditEvents)
        .countDocuments({ organizationId: owner.orgId, action: "dedup.merge_undone" }),
    ).toBe(1);
  });

  it("refuses to undo over later changes without force (409 MERGE_CONFLICT), and force restores the snapshots", async () => {
    const owner = await createOwner(h, "dd-force@example.test", "Force Org");
    const [a, b] = await seedPairs(owner);
    const w = startPhase4Workers(h, ["dedup"]);
    try {
      await waitFor(async () => (await candidates(owner)).length === 1, 20_000, "candidate");
    } finally {
      await w.close();
    }
    const [candidate] = await candidates(owner);
    const before = await raw([a!, b!]);
    const merged = await post(owner, `/dedup/candidates/${candidate!.id}/merge`, {
      survivorId: b,
      fields: { name: "merged", location: "survivor" },
    }).expect(200);
    expect(merged.body.data.merge.fieldDecisions).toEqual(
      expect.arrayContaining([{ field: "name", chosenFrom: a }]),
    );
    await owner.agent
      .patch(`${API}/businesses/${b}`)
      .set(orgHeaders(owner.agent, owner.orgId))
      .send({ field: "categories", value: ["Bakery"] })
      .expect(200);
    const conflict = await post(
      owner,
      `/dedup/merges/${merged.body.data.merge.id}/undo`,
      {},
    ).expect(409);
    expect(conflict.body.error.code).toBe("MERGE_CONFLICT");
    await post(owner, `/dedup/merges/${merged.body.data.merge.id}/undo`, { force: true }).expect(
      200,
    );
    expect(await raw([a!, b!])).toEqual(before);
    const merges = (await get(owner, `/dedup/merges?businessId=${a}&status=undone`).expect(200))
      .body.data as Json[];
    expect(merges).toEqual([
      expect.objectContaining({ id: merged.body.data.merge.id, undoForced: true }),
    ]);
  });

  it("rejects and defers, never re-proposes a rejected pair, and refuses decided or invalid merges", async () => {
    const owner = await createOwner(h, "dd-reject@example.test", "Reject Org");
    const [a] = await seedPairs(owner);
    const w = startPhase4Workers(h, ["dedup"]);
    try {
      await waitFor(async () => (await candidates(owner)).length === 1, 20_000, "candidate");
      const [candidate] = await candidates(owner);
      await post(owner, `/dedup/candidates/${candidate!.id}/merge`, {
        survivorId: new ObjectId().toHexString(),
      }).expect(400);
      expect(
        (await post(owner, `/dedup/candidates/${candidate!.id}/defer`).expect(200)).body.data
          .status,
      ).toBe("deferred");
      expect(await candidates(owner)).toEqual([]);
      expect(await candidates(owner, "?status=deferred")).toHaveLength(1);
      const rejected = await post(owner, `/dedup/candidates/${candidate!.id}/reject`).expect(200);
      expect(rejected.body.data).toMatchObject({
        status: "rejected",
        decidedByUserId: owner.userId,
      });
      const decided = await post(owner, `/dedup/candidates/${candidate!.id}/merge`, {
        survivorId: a,
      }).expect(409);
      expect(decided.body.error.code).toBe("CONFLICT");
      // A rescan does not bring a rejected pair back.
      await post(owner, "/dedup/scan", { businessIds: [a] }).expect(202);
      await new Promise((r) => setTimeout(r, 1_500));
      expect(await candidates(owner, "?status=pending&status=deferred")).toEqual([]);
      expect((await get(owner, `/businesses/${a}`).expect(200)).body.data.dedup).toMatchObject({
        status: "unique",
        candidateCount: 0,
      });
    } finally {
      await w.close();
    }
  });

  it("enforces the permission matrix: researchers merge, analysts and sales reps do not, undo is limited", async () => {
    const owner = await createOwner(h, "dd-perm@example.test", "Dedup Perm Org");
    const [a] = await seedPairs(owner);
    const w = startPhase4Workers(h, ["dedup"]);
    try {
      await waitFor(async () => (await candidates(owner)).length === 1, 20_000, "candidate");
    } finally {
      await w.close();
    }
    const [candidate] = await candidates(owner);
    const as = async (role: "researcher" | "analyst" | "sales_rep") => {
      const m = await addMember(h, owner.orgId, role);
      return { agent: m.agent, orgId: owner.orgId, userId: m.userId };
    };
    const analyst = await as("analyst");
    const rep = await as("sales_rep");
    for (const u of [analyst, rep]) {
      expect((await candidates(u)).length).toBe(1);
      expect(
        (await post(u, `/dedup/candidates/${candidate!.id}/merge`, { survivorId: a }).expect(403))
          .body.error.code,
      ).toBe("FORBIDDEN");
      await post(u, `/dedup/candidates/${candidate!.id}/reject`).expect(403);
      await post(u, "/dedup/scan", {}).expect(403);
    }
    const researcher = await as("researcher");
    const merged = await post(researcher, `/dedup/candidates/${candidate!.id}/merge`, {
      survivorId: a,
    }).expect(200);
    const other = await as("researcher");
    const denied = await post(other, `/dedup/merges/${merged.body.data.merge.id}/undo`, {}).expect(
      403,
    );
    expect(denied.body.error.code).toBe("FORBIDDEN");
    expect(
      (await get(other, `/dedup/merges/${merged.body.data.merge.id}`).expect(200)).body.data
        .canUndo,
    ).toBe(false);
    await post(researcher, `/dedup/merges/${merged.body.data.merge.id}/undo`, {}).expect(200);
  });
});
