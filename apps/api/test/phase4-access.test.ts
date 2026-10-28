import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ObjectId } from "@leadforge/db-mongo";
import { DEFAULT_SCORING_WEIGHTS, type OrganizationRole } from "@leadforge/contracts";
import { addMember, API, orgHeaders, type Harness } from "./harness.js";
import { createOwner, seedBusinesses, type OrgUser } from "./fixtures.js";
import { grant, type Json } from "./discovery-helpers.js";
import { createPhase4Harness, startPhase4Workers, waitFor } from "./phase4-helpers.js";

/**
 * Every Phase 4 route: the permission matrix (denied roles get 403 FORBIDDEN before any work;
 * allowed roles reach the handler) and tenant isolation (another organization's ids are 404 and
 * never appear in lists).
 */

type Method = "get" | "post" | "patch";
interface RouteCase {
  name: string;
  method: Method;
  path: (ids: Ids) => string;
  body?: (ids: Ids) => object;
  /** Roles that pass the permission check. */
  allowed: OrganizationRole[];
  /** Status an allowed role gets for the probe ids (no such resource, or a harmless request). */
  allowedStatus: number;
}
interface Ids {
  business: string;
  analysis: string;
  run: string;
  candidate: string;
  merge: string;
}

const ALL: OrganizationRole[] = ["owner", "admin", "researcher", "sales_rep", "analyst"];
const RUNNERS: OrganizationRole[] = ["owner", "admin", "researcher"];
const SETTINGS: OrganizationRole[] = ["owner", "admin"];

const ROUTES: RouteCase[] = [
  {
    name: "request analysis",
    method: "post",
    path: () => "/analysis/websites",
    body: (i) => ({ businessId: i.business }),
    allowed: RUNNERS,
    allowedStatus: 404,
  },
  {
    name: "list analyses",
    method: "get",
    path: () => "/analysis/websites",
    allowed: ALL,
    allowedStatus: 200,
  },
  {
    name: "get analysis",
    method: "get",
    path: (i) => `/analysis/websites/${i.analysis}`,
    allowed: ALL,
    allowedStatus: 404,
  },
  {
    name: "latest analysis",
    method: "get",
    path: (i) => `/businesses/${i.business}/analysis`,
    allowed: ALL,
    allowedStatus: 404,
  },
  {
    name: "website contacts",
    method: "post",
    path: (i) => `/enrichment/businesses/${i.business}/website-contacts`,
    allowed: RUNNERS,
    allowedStatus: 404,
  },
  {
    name: "check email",
    method: "post",
    path: (i) => `/enrichment/businesses/${i.business}/check-email`,
    body: () => ({ address: "a@b.example.test" }),
    allowed: RUNNERS,
    allowedStatus: 404,
  },
  {
    name: "refresh",
    method: "post",
    path: (i) => `/businesses/${i.business}/refresh`,
    allowed: RUNNERS,
    allowedStatus: 404,
  },
  {
    name: "get run",
    method: "get",
    path: (i) => `/enrichment/runs/${i.run}`,
    allowed: ALL,
    allowedStatus: 404,
  },
  {
    name: "list runs",
    method: "get",
    path: (i) => `/businesses/${i.business}/enrichment-runs`,
    allowed: ALL,
    allowedStatus: 404,
  },
  {
    name: "get scoring profile",
    method: "get",
    path: () => "/scoring/profile",
    allowed: ALL,
    allowedStatus: 200,
  },
  {
    name: "edit scoring profile",
    method: "patch",
    path: () => "/scoring/profile",
    body: () => ({ version: 999, weights: DEFAULT_SCORING_WEIGHTS }),
    allowed: SETTINGS,
    allowedStatus: 409,
  },
  {
    name: "recompute scores",
    method: "post",
    path: () => "/scoring/recompute",
    allowed: SETTINGS,
    allowedStatus: 202,
  },
  {
    name: "business score",
    method: "get",
    path: (i) => `/businesses/${i.business}/score`,
    allowed: ALL,
    allowedStatus: 404,
  },
  {
    name: "list candidates",
    method: "get",
    path: () => "/dedup/candidates",
    allowed: ALL,
    allowedStatus: 200,
  },
  {
    name: "get candidate",
    method: "get",
    path: (i) => `/dedup/candidates/${i.candidate}`,
    allowed: ALL,
    allowedStatus: 404,
  },
  {
    name: "merge",
    method: "post",
    path: (i) => `/dedup/candidates/${i.candidate}/merge`,
    body: (i) => ({ survivorId: i.business }),
    allowed: RUNNERS,
    allowedStatus: 404,
  },
  {
    name: "reject",
    method: "post",
    path: (i) => `/dedup/candidates/${i.candidate}/reject`,
    allowed: RUNNERS,
    allowedStatus: 404,
  },
  {
    name: "defer",
    method: "post",
    path: (i) => `/dedup/candidates/${i.candidate}/defer`,
    allowed: RUNNERS,
    allowedStatus: 404,
  },
  {
    name: "list merges",
    method: "get",
    path: () => "/dedup/merges",
    allowed: ALL,
    allowedStatus: 200,
  },
  {
    name: "get merge",
    method: "get",
    path: (i) => `/dedup/merges/${i.merge}`,
    allowed: ALL,
    allowedStatus: 404,
  },
  {
    name: "undo merge",
    method: "post",
    path: (i) => `/dedup/merges/${i.merge}/undo`,
    body: () => ({}),
    allowed: RUNNERS,
    allowedStatus: 404,
  },
  {
    name: "dedup scan",
    method: "post",
    path: () => "/dedup/scan",
    body: () => ({}),
    allowed: RUNNERS,
    allowedStatus: 202,
  },
];

function call(u: OrgUser, route: RouteCase, ids: Ids) {
  const req = u.agent[route.method](`${API}${route.path(ids)}`).set(orgHeaders(u.agent, u.orgId));
  return route.method === "get" ? req : req.send(route.body ? route.body(ids) : {});
}

let h: Harness;
beforeAll(async () => {
  h = await createPhase4Harness({});
  await h.resetState();
});
afterAll(async () => h?.close());

describe("Phase 4 permission matrix", () => {
  it("checks the required permission on every new route for every role", async () => {
    const owner = await createOwner(h, "p4-matrix@example.test", "Matrix Org");
    const users: Record<OrganizationRole, OrgUser> = { owner } as Record<OrganizationRole, OrgUser>;
    for (const role of ["admin", "researcher", "sales_rep", "analyst"] as const) {
      const m = await addMember(h, owner.orgId, role);
      users[role] = { agent: m.agent, orgId: owner.orgId, userId: m.userId };
    }
    const probe: Ids = {
      business: new ObjectId().toHexString(),
      analysis: new ObjectId().toHexString(),
      run: new ObjectId().toHexString(),
      candidate: new ObjectId().toHexString(),
      merge: new ObjectId().toHexString(),
    };
    const failures: string[] = [];
    for (const route of ROUTES) {
      for (const role of ALL) {
        const res = await call(users[role], route, probe);
        const expected = route.allowed.includes(role) ? route.allowedStatus : 403;
        if (res.status !== expected)
          failures.push(
            `${route.name} as ${role}: ${res.status} (expected ${expected}) ${JSON.stringify(res.body.error ?? "")}`,
          );
        if (expected === 403 && res.body.error?.code !== "FORBIDDEN")
          failures.push(`${route.name} as ${role}: code ${res.body.error?.code}`);
      }
    }
    expect(failures).toEqual([]);
  });
});

describe("Phase 4 tenant isolation", () => {
  it("returns 404 for another organization's businesses, analyses, runs, candidates and merges, and lists only its own", async () => {
    await h.resetState();
    const a = await createOwner(h, "p4-org-a@example.test", "Org A");
    const b = await createOwner(h, "p4-org-b@example.test", "Org B");
    await grant(h, a.orgId, 5);
    await grant(h, b.orgId, 5);
    const [business, twin] = await seedBusinesses(h, a.orgId, [
      {
        name: "Isolated Bakery (Sample)",
        website: "isolated.example.test",
        emails: ["hi@isolated.example.test"],
        location: { locality: "Ikeja", region: "Lagos" },
      },
      { name: "Isolated Bakery Ikeja (Sample)", location: { locality: "Ikeja", region: "Lagos" } },
    ]);
    const w = startPhase4Workers(h, ["dedup"]);
    let candidate: Json;
    try {
      candidate = await waitFor(
        async () =>
          (
            (await a.agent.get(`${API}/dedup/candidates`).set(orgHeaders(a.agent, a.orgId))).body
              .data as Json[]
          )[0],
        20_000,
        "candidate",
      );
    } finally {
      await w.close();
    }
    const analysis = (
      await a.agent
        .post(`${API}/analysis/websites`)
        .set(orgHeaders(a.agent, a.orgId))
        .send({ businessId: business })
        .expect(202)
    ).body.data.analyses[0] as Json;
    const run = (
      await a.agent
        .post(`${API}/enrichment/businesses/${business}/website-contacts`)
        .set(orgHeaders(a.agent, a.orgId))
        .expect(202)
    ).body.data as Json;
    const merge = (
      await a.agent
        .post(`${API}/dedup/candidates/${candidate.id}/merge`)
        .set(orgHeaders(a.agent, a.orgId))
        .send({ survivorId: business })
        .expect(200)
    ).body.data.merge as Json;
    expect(twin).toBeDefined();

    const ids: Ids = {
      business: business!,
      analysis: analysis.id,
      run: run.id,
      candidate: candidate.id,
      merge: merge.id,
    };
    const failures: string[] = [];
    for (const route of ROUTES) {
      if (!route.path(ids).match(/[a-f0-9]{24}/)) continue; // routes without ids are covered by the list checks below
      const res = await call(b, route, ids);
      if (res.status !== 404)
        failures.push(
          `${route.name}: ${res.status} ${JSON.stringify(res.body.error ?? res.body.data)}`,
        );
    }
    expect(failures).toEqual([]);

    const lists = [
      "/analysis/websites",
      "/dedup/candidates?status=pending&status=merged&status=rejected&status=deferred",
      "/dedup/merges",
      "/jobs",
    ];
    for (const path of lists) {
      const res = await b.agent.get(`${API}${path}`).set(orgHeaders(b.agent, b.orgId)).expect(200);
      expect(res.body.data, path).toEqual([]);
    }
    // Filters naming another organization's business are 404, not an empty list.
    await b.agent
      .get(`${API}/analysis/websites?businessId=${business}`)
      .set(orgHeaders(b.agent, b.orgId))
      .expect(404);
    await b.agent
      .get(`${API}/dedup/candidates?businessId=${business}`)
      .set(orgHeaders(b.agent, b.orgId))
      .expect(404);
    await b.agent
      .get(`${API}/dedup/merges?businessId=${business}`)
      .set(orgHeaders(b.agent, b.orgId))
      .expect(404);
    // Scoring profiles are per organization.
    const profileA = (
      await a.agent.get(`${API}/scoring/profile`).set(orgHeaders(a.agent, a.orgId)).expect(200)
    ).body.data as Json;
    const profileB = (
      await b.agent.get(`${API}/scoring/profile`).set(orgHeaders(b.agent, b.orgId)).expect(200)
    ).body.data as Json;
    expect(profileA.id).not.toBe(profileB.id);
    // Bulk analysis of another organization's ids skips them as not found and holds nothing.
    const bulk = await b.agent
      .post(`${API}/analysis/websites`)
      .set(orgHeaders(b.agent, b.orgId))
      .send({ businessIds: [business] })
      .expect(202);
    expect(bulk.body.data).toMatchObject({
      analyses: [],
      skipped: [{ businessId: business, code: "NOT_FOUND" }],
      credits: { held: 0 },
    });
  });
});
