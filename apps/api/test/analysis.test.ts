import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Collections, MongoService, ObjectId } from "@leadforge/db-mongo";
import { AnalysisReconciliationService } from "@leadforge/core";
import { API, orgHeaders, type Harness } from "./harness.js";
import { createOwner, seedBusinesses, type OrgUser } from "./fixtures.js";
import { balance, grant, ledger, type Json } from "./discovery-helpers.js";
import {
  ALLOW_ALL_ROBOTS,
  closedPort,
  createPhase4Harness,
  startPhase4Workers,
  startSites,
  stubDns,
  waitFor,
  type LocalSites,
} from "./phase4-helpers.js";

const SHOP = "shop.example.test";
const BLOCKED = "blocked.example.test";
const DOWN = "down.example.test";

let h: Harness;
let sites: LocalSites;

beforeAll(async () => {
  sites = await startSites();
  const down = await closedPort();
  h = await createPhase4Harness({
    [SHOP]: `127.0.0.1:${sites.port}`,
    [BLOCKED]: `127.0.0.1:${sites.port}`,
    [DOWN]: `127.0.0.1:${down}`,
  });
});
afterAll(async () => {
  await h?.close();
  await sites?.close();
});
beforeEach(async () => {
  await h.resetState();
  sites.requests.length = 0;
  sites.sites.set(SHOP, {
    "/robots.txt": ALLOW_ALL_ROBOTS,
    "/": {
      body: `<html><head><title>Shop (Sample)</title><meta name="viewport" content="width=device-width"></head>
<body><a href="/contact">Contact us</a><p>Welcome</p></body></html>`,
    },
    "/contact": { body: `<html><body><p>Write to us</p></body></html>` },
  });
  sites.sites.set(BLOCKED, {
    "/robots.txt": { type: "text/plain", body: "User-agent: *\nDisallow: /\n" },
    "/": { body: "<p>hidden</p>" },
  });
});

const post = (u: OrgUser, path: string, body: unknown) =>
  u.agent
    .post(`${API}${path}`)
    .set(orgHeaders(u.agent, u.orgId))
    .send(body as object);
const get = (u: OrgUser, path: string) =>
  u.agent.get(`${API}${path}`).set(orgHeaders(u.agent, u.orgId));

async function waitAnalysis(u: OrgUser, id: string): Promise<Json> {
  return waitFor(
    async () => {
      const res = await get(u, `/analysis/websites/${id}`).expect(200);
      const data = res.body.data as Json;
      return ["completed", "failed"].includes(data.status) && data.credits.settled ? data : null;
    },
    30_000,
    `analysis ${id}`,
  );
}

describe("website analysis: credits and outcomes", () => {
  it("holds 1 credit, analyzes through SafeFetch, captures on completion and records evidence", async () => {
    const owner = await createOwner(h, "an-owner@example.test", "Analysis Org");
    await grant(h, owner.orgId, 10);
    const [id] = await seedBusinesses(h, owner.orgId, [
      { name: "Shop (Sample)", website: `http://${SHOP}` },
    ]);
    const created = await post(owner, "/analysis/websites", { businessId: id }).expect(202);
    const analysis = created.body.data.analyses[0] as Json;
    expect(created.body.data).toMatchObject({
      alreadyInProgress: [],
      skipped: [],
      batchId: null,
      credits: { held: 1 },
    });
    expect(analysis).toMatchObject({
      status: "queued",
      businessId: id,
      url: `http://${SHOP}`,
      credits: { held: 1, captured: 0, settled: false },
    });
    expect((await balance(owner.agent, owner.orgId)).balance).toBe(9);
    // Backlog 9 (Phase 6): business detail exposes the active analysis; with none finished yet it is the latest itself.
    const queuedDetail = await get(owner, `/businesses/${id}`).expect(200);
    expect(queuedDetail.body.data.latestAnalysis).toEqual({
      analysisId: analysis.id,
      status: "queued",
      analyzedAt: null,
      opportunities: [],
      activeAnalysisId: analysis.id,
    });

    // Asking again while it is queued returns the same analysis and holds nothing more.
    const again = await post(owner, "/analysis/websites", { businessId: id }).expect(202);
    expect(again.body.data).toMatchObject({
      alreadyInProgress: [analysis.id],
      credits: { held: 0 },
    });
    expect((await balance(owner.agent, owner.orgId)).balance).toBe(9);

    const w = startPhase4Workers(h, ["analysis"]);
    try {
      const done = await waitAnalysis(owner, analysis.id);
      expect(done).toMatchObject({
        status: "completed",
        error: null,
        credits: { held: 1, captured: 1, released: 0, settled: true },
        robots: { fetched: true, allowed: true },
      });
      expect(done.pagesVisited.map((p: Json) => p.kind)).toEqual(["home", "contact"]);
      const byKey = Object.fromEntries(done.detections.map((d: Json) => [d.key, d]));
      expect(byKey.website_unreachable.observed).toBe("no");
      expect(byKey.no_contact_form).toMatchObject({
        observed: "yes",
        label: "No contact form was detected",
      });
      expect(byKey.no_contact_form.evidence.length).toBeGreaterThan(0);
      expect(done.opportunities.map((o: Json) => o.key)).toContain("contact_form");
      for (const o of done.opportunities as Json[])
        expect(o.detectionKeys.every((k: string) => byKey[k].observed === "yes")).toBe(true);
      expect(w.failures).toEqual([]);
    } finally {
      await w.close();
    }
    expect((await balance(owner.agent, owner.orgId)).balance).toBe(9);
    const entries = await ledger(owner.agent, owner.orgId, `&referenceId=${analysis.id}`);
    // A fully captured hold has no 0-unit release row (Phase 5); every row names the analysis.
    expect(entries.map((e) => [e.entryType, e.units, e.capturedUnits]).sort()).toEqual(
      [
        ["capture", 0, 1],
        ["hold", -1, null],
      ].sort(),
    );
    expect(entries.every((e) => e.referenceName === "Website analysis: shop.example.test")).toBe(
      true,
    );
    expect(sites.requests.every((r) => r.userAgent?.startsWith("LeadForgeBot/1.0"))).toBe(true);

    const latest = await get(owner, `/businesses/${id}/analysis`).expect(200);
    expect(latest.body.data.id).toBe(analysis.id);
    const detail = await get(owner, `/businesses/${id}`).expect(200);
    expect(detail.body.data.latestAnalysis).toMatchObject({
      analysisId: analysis.id,
      status: "completed",
      activeAnalysisId: null,
    });
    expect(detail.body.data.latestAnalysis.opportunities).toContain("contact_form");
    const list = await get(owner, "/analysis/websites?opportunity=contact_form").expect(200);
    expect(list.body.data.map((a: Json) => a.id)).toEqual([analysis.id]);
    const jobs = await get(owner, "/jobs?kind=analysis").expect(200);
    expect(jobs.body.data[0]).toMatchObject({
      id: analysis.id,
      kind: "analysis",
      status: "completed",
      progress: { processed: 1, total: 1, failed: 0 },
      href: `/app/analysis/${analysis.id}`,
    });
  });

  it("releases the credit when robots.txt disallows the site, and fetches no page", async () => {
    const owner = await createOwner(h, "an-robots@example.test", "Robots Org");
    await grant(h, owner.orgId, 5);
    const [id] = await seedBusinesses(h, owner.orgId, [
      { name: "Blocked (Sample)", website: `http://${BLOCKED}` },
    ]);
    const created = await post(owner, "/analysis/websites", { businessId: id }).expect(202);
    const w = startPhase4Workers(h, ["analysis"]);
    try {
      const done = await waitAnalysis(owner, created.body.data.analyses[0].id);
      expect(done).toMatchObject({
        status: "failed",
        error: { code: "ROBOTS_DISALLOWED" },
        robots: { fetched: true, allowed: false },
        credits: { captured: 0, released: 1, settled: true },
      });
    } finally {
      await w.close();
    }
    expect((await balance(owner.agent, owner.orgId)).balance).toBe(5);
    expect(sites.requests.filter((r) => r.host === BLOCKED).map((r) => r.path)).toEqual([
      "/robots.txt",
    ]);
  });

  it("releases the credit when the website resolves to a private address (SSRF deny list)", async () => {
    const owner = await createOwner(h, "an-ssrf@example.test", "SSRF Org");
    await grant(h, owner.orgId, 5);
    stubDns(h, { hosts: { "intranet-shop.example.ng": ["10.0.0.5"] } });
    const [id] = await seedBusinesses(h, owner.orgId, [
      { name: "Private (Sample)", website: "http://intranet-shop.example.ng" },
    ]);
    const created = await post(owner, "/analysis/websites", { businessId: id }).expect(202);
    const w = startPhase4Workers(h, ["analysis"]);
    try {
      const done = await waitAnalysis(owner, created.body.data.analyses[0].id);
      expect(done).toMatchObject({
        status: "failed",
        error: { code: "ADDRESS_NOT_ALLOWED" },
        credits: { captured: 0, released: 1 },
      });
    } finally {
      await w.close();
    }
    expect((await balance(owner.agent, owner.orgId)).balance).toBe(5);
  });

  it("completes and charges an analysis of an unreachable website: that is the finding", async () => {
    const owner = await createOwner(h, "an-down@example.test", "Down Org");
    await grant(h, owner.orgId, 5);
    const [id] = await seedBusinesses(h, owner.orgId, [
      { name: "Down (Sample)", website: `http://${DOWN}` },
    ]);
    const created = await post(owner, "/analysis/websites", { businessId: id }).expect(202);
    const w = startPhase4Workers(h, ["analysis"]);
    try {
      const done = await waitAnalysis(owner, created.body.data.analyses[0].id);
      expect(done).toMatchObject({ status: "completed", credits: { captured: 1, released: 0 } });
      const reach = done.detections.find((d: Json) => d.key === "website_unreachable");
      expect(reach).toMatchObject({ observed: "yes", label: "No reachable website was detected" });
      expect(
        done.detections
          .filter((d: Json) => d.key !== "website_unreachable")
          .every((d: Json) => d.observed === "unknown"),
      ).toBe(true);
      expect(done.opportunities.map((o: Json) => o.key)).toEqual(["website_rebuild"]);
    } finally {
      await w.close();
    }
    expect((await balance(owner.agent, owner.orgId)).balance).toBe(4);
  });

  it("refuses without credits (402) and without a website (422 WEBSITE_MISSING), holding nothing", async () => {
    const owner = await createOwner(h, "an-errors@example.test", "Errors Org");
    const [withSite, noSite] = await seedBusinesses(h, owner.orgId, [
      { name: "Has Site (Sample)", website: `http://${SHOP}` },
      { name: "No Site (Sample)" },
    ]);
    const poor = await post(owner, "/analysis/websites", { businessId: withSite }).expect(402);
    expect(poor.body.error).toMatchObject({
      code: "INSUFFICIENT_CREDITS",
      details: [
        { path: "credits.required", message: "1" },
        { path: "credits.available", message: "0" },
      ],
    });
    await grant(h, owner.orgId, 3);
    const missing = await post(owner, "/analysis/websites", { businessId: noSite }).expect(422);
    expect(missing.body.error.code).toBe("WEBSITE_MISSING");
    await post(owner, "/analysis/websites", { businessId: new ObjectId().toHexString() }).expect(
      404,
    );
    await post(owner, "/analysis/websites", { businessId: "nope" }).expect(400);
    await post(owner, "/analysis/websites", {
      businessIds: Array.from({ length: 51 }, () => new ObjectId().toHexString()),
    }).expect(400);
    expect((await balance(owner.agent, owner.orgId)).balance).toBe(3);
    expect(
      await h.app
        .get(MongoService)
        .database.collection(Collections.websiteAnalyses)
        .countDocuments({ organizationId: owner.orgId }),
    ).toBe(0);
  });

  it("runs a bulk request: skips with reasons, one batch, a notification when the batch finishes, audited", async () => {
    const owner = await createOwner(h, "an-bulk@example.test", "Bulk Org");
    await grant(h, owner.orgId, 10);
    const [a, b, none] = await seedBusinesses(h, owner.orgId, [
      { name: "Bulk A (Sample)", website: `http://${SHOP}` },
      { name: "Bulk B (Sample)", website: `http://${BLOCKED}` },
      { name: "Bulk None (Sample)" },
    ]);
    const ghost = new ObjectId().toHexString();
    const res = await post(owner, "/analysis/websites", {
      businessIds: [a, b, none, ghost],
    }).expect(202);
    expect(res.body.data.analyses).toHaveLength(2);
    expect(res.body.data.credits.held).toBe(2);
    expect(res.body.data.batchId).toMatch(/^[a-f0-9]{24}$/);
    expect(res.body.data.skipped).toEqual([
      { businessId: none, code: "WEBSITE_MISSING", message: expect.any(String) },
      { businessId: ghost, code: "NOT_FOUND", message: expect.any(String) },
    ]);
    const w = startPhase4Workers(h, ["analysis"]);
    try {
      for (const an of res.body.data.analyses as Json[]) await waitAnalysis(owner, an.id);
    } finally {
      await w.close();
    }
    const batch = await get(owner, `/analysis/websites?batchId=${res.body.data.batchId}`).expect(
      200,
    );
    expect(batch.body.data.map((x: Json) => x.status).sort()).toEqual(["completed", "failed"]);
    expect((await balance(owner.agent, owner.orgId)).balance).toBe(9);
    const notes = await get(owner, "/notifications").expect(200);
    expect(notes.body.data).toEqual([
      expect.objectContaining({
        type: "analysis.bulk_completed",
        title: "Website analysis of 2 businesses finished",
      }),
    ]);
    const audit = await h.app
      .get(MongoService)
      .database.collection(Collections.auditEvents)
      .findOne({ organizationId: owner.orgId, action: "analysis.bulk_requested" });
    expect(audit).toMatchObject({
      resourceType: "analysis_batch",
      after: { requested: 4, created: 2, creditsHeld: 2 },
    });
  });

  it("reconciliation fails a stuck analysis and releases its credit", async () => {
    const owner = await createOwner(h, "an-stuck@example.test", "Stuck Org");
    await grant(h, owner.orgId, 2);
    const [id] = await seedBusinesses(h, owner.orgId, [
      { name: "Stuck (Sample)", website: `http://${SHOP}` },
    ]);
    const created = await post(owner, "/analysis/websites", { businessId: id }).expect(202);
    const analysisId = new ObjectId(created.body.data.analyses[0].id as string);
    const old = new Date(Date.now() - 60 * 60 * 1000);
    await h.app
      .get(MongoService)
      .database.collection(Collections.websiteAnalyses)
      .updateOne({ _id: analysisId }, { $set: { status: "running", updatedAt: old } });
    const report = await h.app
      .get(AnalysisReconciliationService, { strict: false })
      .run(new Date());
    expect(report.timedOut).toBe(1);
    const after = await get(owner, `/analysis/websites/${analysisId.toHexString()}`).expect(200);
    expect(after.body.data).toMatchObject({
      status: "failed",
      error: { code: "ANALYSIS_TIMEOUT" },
      credits: { released: 1, settled: true },
    });
    expect((await balance(owner.agent, owner.orgId)).balance).toBe(2);
  });
});
