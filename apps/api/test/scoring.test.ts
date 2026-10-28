import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_SCORING_WEIGHTS, SCORE_EXPLANATION } from "@leadforge/contracts";
import { Collections, MongoService } from "@leadforge/db-mongo";
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
const patch = (u: OrgUser, body: unknown) =>
  u.agent
    .patch(`${API}/scoring/profile`)
    .set(orgHeaders(u.agent, u.orgId))
    .send(body as object);

const WEIGHTS = {
  contactCompleteness: 10,
  contactVerification: 10,
  websiteOpportunity: 10,
  industryMatch: 40,
  locationMatch: 20,
  freshness: 5,
  sourceReliability: 5,
};

describe("scoring profile", () => {
  it("is created with the default weights on first read and validates edits", async () => {
    const owner = await createOwner(h, "sc-owner@example.test", "Scoring Org");
    const first = await get(owner, "/scoring/profile").expect(200);
    expect(first.body.data).toMatchObject({
      name: "Default",
      isDefault: true,
      version: 1,
      weights: DEFAULT_SCORING_WEIGHTS,
      icp: { categories: [], locations: [] },
      recompute: { status: "idle" },
    });
    expect((await get(owner, "/scoring/profile").expect(200)).body.data.id).toBe(
      first.body.data.id,
    );

    const sum = await patch(owner, { version: 1, weights: { ...WEIGHTS, freshness: 15 } }).expect(
      400,
    );
    expect(sum.body.error).toMatchObject({ code: "VALIDATION_FAILED" });
    expect(sum.body.error.details[0]).toMatchObject({
      path: "weights",
      message: "Weights must add up to 100 (they add up to 110)",
    });
    const range = await patch(owner, {
      version: 1,
      weights: { ...WEIGHTS, industryMatch: 140, locationMatch: -80 },
    }).expect(400);
    expect(range.body.error.details.map((d: Json) => d.path)).toEqual(
      expect.arrayContaining(["weights.industryMatch", "weights.locationMatch"]),
    );
    await patch(owner, { version: 1 }).expect(400);
    const stale = await patch(owner, { version: 7, weights: WEIGHTS }).expect(409);
    expect(stale.body.error.code).toBe("CONFLICT");

    const ok = await patch(owner, {
      version: 1,
      weights: WEIGHTS,
      icp: {
        categories: ["Bakery", "bakery ", "Pharmacy"],
        locations: [{ region: "Lagos State" }],
      },
    }).expect(200);
    expect(ok.body.data).toMatchObject({
      version: 2,
      weights: WEIGHTS,
      icp: {
        categories: ["Bakery", "Pharmacy"],
        locations: [{ country: null, region: "Lagos", locality: null }],
      },
      recompute: { status: "queued", profileVersion: 2 },
    });
    const audit = await h.app
      .get(MongoService)
      .database.collection(Collections.auditEvents)
      .findOne({ organizationId: owner.orgId, action: "scoring.profile_updated" });
    expect(audit).toMatchObject({
      before: { version: 1, weights: DEFAULT_SCORING_WEIGHTS },
      after: { version: 2, weights: WEIGHTS },
    });
  });

  it("only owners and admins edit scoring; every role reads it", async () => {
    const owner = await createOwner(h, "sc-perm@example.test", "Scoring Perm Org");
    for (const role of ["researcher", "sales_rep", "analyst"] as const) {
      const m = await addMember(h, owner.orgId, role);
      const u = { agent: m.agent, orgId: owner.orgId, userId: m.userId };
      await get(u, "/scoring/profile").expect(200);
      const denied = await patch(u, { version: 1, weights: WEIGHTS }).expect(403);
      expect(denied.body.error.code).toBe("FORBIDDEN");
      await u.agent.post(`${API}/scoring/recompute`).set(orgHeaders(u.agent, u.orgId)).expect(403);
    }
    const admin = await addMember(h, owner.orgId, "admin");
    await patch(
      { agent: admin.agent, orgId: owner.orgId, userId: admin.userId },
      { version: 1, weights: WEIGHTS },
    ).expect(200);
  });
});

describe("score computation and the directory", () => {
  it("recomputes every score after a weight change, explains each one, and sorts and filters by fit and data confidence", async () => {
    const owner = await createOwner(h, "sc-recompute@example.test", "Recompute Org");
    const [bakery, clinic, bare] = await seedBusinesses(h, owner.orgId, [
      {
        name: "Lagos Bakery (Sample)",
        categories: ["Bakery"],
        phones: ["0803 123 4567"],
        emails: ["hi@bakery.example.test"],
        website: "bakery.example.test",
        location: { locality: "Ikeja", region: "Lagos" },
      },
      {
        name: "Abuja Clinic (Sample)",
        categories: ["Clinic"],
        phones: ["0803 765 4321"],
        location: { locality: "Wuse", region: "Abuja" },
      },
      { name: "Bare Record (Sample)" },
    ]);
    const w = startPhase4Workers(h, ["scoring"]);
    try {
      // Ingest queued a score for each new business.
      await waitFor(
        async () =>
          (await get(owner, `/businesses/${bare}/score`).expect(200)).body.data ? true : null,
        20_000,
        "initial scores",
      );
      await patch(owner, {
        version: 1,
        weights: WEIGHTS,
        icp: { categories: ["Bakery"], locations: [{ region: "Lagos" }] },
      }).expect(200);
      const profile = await waitFor(
        async () => {
          const p = (await get(owner, "/scoring/profile").expect(200)).body.data as Json;
          return p.recompute.status === "completed" ? p : null;
        },
        20_000,
        "recompute",
      );
      expect(profile.recompute).toMatchObject({ profileVersion: 2, processed: 3, total: 3 });
    } finally {
      await w.close();
    }

    const score = (await get(owner, `/businesses/${bakery}/score`).expect(200)).body.data as Json;
    expect(score).toMatchObject({ profileVersion: 2, explanation: SCORE_EXPLANATION });
    expect(score.breakdown.map((b: Json) => b.signal)).toEqual([
      "contactCompleteness",
      "contactVerification",
      "websiteOpportunity",
      "industryMatch",
      "locationMatch",
      "freshness",
      "sourceReliability",
    ]);
    const by = Object.fromEntries(score.breakdown.map((b: Json) => [b.signal, b]));
    expect(by.industryMatch).toMatchObject({
      weight: 40,
      value: 1,
      points: 40,
      label: "Industry match",
      detail: "Category Bakery is in your ICP",
    });
    expect(by.locationMatch).toMatchObject({ weight: 20, value: 1, points: 20 });
    expect(score.fit).toBe(
      Math.round(score.breakdown.reduce((s: number, b: Json) => s + b.weight * b.value, 0)),
    );
    expect(score.dataConfidenceDetail.basis).toMatch(/never added to the fit score/);
    // The detail view carries the same snapshot; the list carries the two numbers.
    expect((await get(owner, `/businesses/${bakery}`).expect(200)).body.data.score).toEqual(score);

    const sorted = (await get(owner, "/businesses?sort=fit:desc").expect(200)).body.data as Json[];
    expect(sorted.map((b) => b.id)).toEqual([bakery, clinic, bare]);
    expect(sorted[0]?.score).toEqual({ fit: score.fit, dataConfidence: score.dataConfidence });
    const byConfidence = (await get(owner, "/businesses?sort=dataConfidence:asc").expect(200)).body
      .data as Json[];
    expect(byConfidence[0]?.id).toBe(bare);
    const high = (await get(owner, `/businesses?fitMin=${score.fit}`).expect(200)).body;
    expect(high.data.map((b: Json) => b.id)).toEqual([bakery]);
    expect(high.meta.total).toBe(1);
    const cursorPage = await get(owner, "/businesses?sort=fit:desc&pageSize=1").expect(200);
    const next = await get(
      owner,
      `/businesses?sort=fit:desc&pageSize=1&cursor=${encodeURIComponent(cursorPage.body.meta.nextCursor)}`,
    ).expect(200);
    expect(next.body.data[0].id).toBe(clinic);
    await get(owner, "/businesses?fitMin=101").expect(400);
  });
});
