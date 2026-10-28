import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Collections, MongoService, ObjectId } from "@leadforge/db-mongo";
import { UsageService } from "@leadforge/core";
import { API, createHarness, orgHeaders, type Harness } from "./harness.js";
import { createOwner, seedBusinesses } from "./fixtures.js";
import { credits, grant, type Json } from "./discovery-helpers.js";
import { call, createTeam, isTerminal, pollUntil, startPhase5Workers } from "./phase5-helpers.js";

let h: Harness;
beforeAll(async () => {
  h = await createHarness();
});
afterAll(async () => h?.close());
beforeEach(async () => h.resetState());

const today = () => new Date().toISOString().slice(0, 10);

describe("usage aggregates", () => {
  it("rolls up credits, exports and jobs per UTC day idempotently and serves the Usage page", async () => {
    const owner = await createOwner(h, "usage@example.test", "Usage Org");
    const team = { owner, analyst: owner };
    const org = owner.orgId;
    await grant(h, org, 50);
    // Two billed discovery records and one billed analysis, from real ledger captures.
    const c = credits(h);
    await c.hold(org, {
      units: 5,
      key: "job:usage1:hold",
      referenceType: "discovery_job",
      referenceId: "usage1",
      referenceName: "Usage job",
      actorUserId: owner.userId,
      description: "t",
    });
    await c.settle(org, {
      holdKey: "job:usage1:hold",
      captureKey: "job:usage1:capture",
      releaseKey: "job:usage1:release",
      capturedUnits: 2,
      description: "t",
    });
    await c.hold(org, {
      units: 1,
      key: "analysis:usage2:hold",
      referenceType: "website_analysis",
      referenceId: "usage2",
      actorUserId: owner.userId,
      description: "t",
    });
    await c.settle(org, {
      holdKey: "analysis:usage2:hold",
      captureKey: "analysis:usage2:capture",
      releaseKey: "analysis:usage2:release",
      capturedUnits: 1,
      description: "t",
    });
    // One synchronous and one asynchronous export.
    await seedBusinesses(h, org, [{ name: "Usage 1" }, { name: "Usage 2" }]);
    await call(team.owner, "post", "/exports/businesses", { columns: ["name"] }).expect(200);
    const exp = (
      await call(team.owner, "post", "/exports", { kind: "directory", filter: {} }).expect(202)
    ).body.data as Json;
    const w = startPhase5Workers(h, ["exports"]);
    try {
      await pollUntil(team.owner, `/exports/${exp.id}`, isTerminal);
    } finally {
      await w.close();
    }

    const before = (await call(team.analyst, "get", "/usage?period=7d").expect(200)).body
      .data as Json;
    expect(before).toMatchObject({ period: "7d", computedAt: null, totals: { credits_used: 0 } });
    expect(before.series).toHaveLength(7);

    const usage = h.app.get(UsageService, { strict: false });
    await usage.rollupAll(2);
    await usage.rollupAll(2);
    const summary = (await call(team.analyst, "get", "/usage?period=7d").expect(200)).body
      .data as Json;
    expect(summary.computedAt).not.toBeNull();
    expect(summary.to).toBe(today());
    expect(summary.totals).toEqual({
      credits_used: 3,
      discovery_jobs: 0,
      discovery_records: 2,
      analyses: 1,
      enrichment_runs: 0,
      exports: 2,
      export_rows: 4,
    });
    expect(summary.series[summary.series.length - 1]).toEqual({
      day: today(),
      values: summary.totals,
    });
    expect(summary.credits).toMatchObject({ balance: 47, held: 0 });
    const rows = await h.prisma.usageDaily.count({ where: { organizationId: org } });
    expect(rows).toBe(2 * 7);

    // Ledger entries carry their reference name; a fully captured hold has no release row.
    const ledger = (await call(team.owner, "get", "/credits/ledger?referenceId=usage2").expect(200))
      .body.data as Json[];
    expect(ledger.map((e) => e.entryType).sort()).toEqual(["capture", "hold"]);
    const named = (await call(team.owner, "get", "/credits/ledger?referenceId=usage1").expect(200))
      .body.data as Json[];
    expect(named.every((e) => e.referenceName === "Usage job")).toBe(true);
    expect(named.map((e) => [e.entryType, e.units]).sort()).toEqual([
      ["capture", 0],
      ["hold", -5],
      ["release", 3],
    ]);
  });
});

describe("reports", () => {
  it("serves source, quality, jobs, funnel and activity reports and the overview additions from real records", async () => {
    const team = await createTeam(h, "reports");
    const org = team.owner.orgId;
    const ids = await seedBusinesses(h, org, [
      { name: "R1 (Sample)" },
      { name: "R2 (Sample)" },
      { name: "R3 (Sample)" },
    ]);
    const db = h.app.get(MongoService).database;
    // Two scored businesses: fit and data confidence land in their own histograms.
    await db
      .collection(Collections.businesses)
      .updateOne(
        { _id: new ObjectId(ids[0]!) },
        { $set: { score: { fit: 85, dataConfidence: 42 } } },
      );
    await db
      .collection(Collections.businesses)
      .updateOne(
        { _id: new ObjectId(ids[1]!) },
        { $set: { score: { fit: 100, dataConfidence: 5 } } },
      );

    const l1 = (
      await call(team.owner, "post", "/pipeline/leads", {
        businessId: ids[0],
        assignedToUserId: team.sales_rep.userId,
      }).expect(201)
    ).body.data as Json;
    const l2 = (
      await call(team.owner, "post", "/pipeline/leads", { businessId: ids[1] }).expect(201)
    ).body.data as Json;
    await call(team.owner, "post", "/pipeline/leads", { businessId: ids[2] }).expect(201);
    await call(team.owner, "post", `/pipeline/leads/${l1.id}/move`, {
      stageKey: "qualified",
    }).expect(200);
    await call(team.owner, "post", `/pipeline/leads/${l2.id}/move`, {
      stageKey: "won",
      wonValueMinor: 250_000,
      currency: "NGN",
    }).expect(200);
    await call(team.sales_rep, "post", "/activities", {
      businessId: ids[0],
      type: "call",
      outcome: "connected",
    }).expect(201);
    await call(team.sales_rep, "post", "/activities", {
      businessId: ids[0],
      type: "whatsapp",
      outcome: "sent",
    }).expect(201);
    await call(team.owner, "post", "/activities", {
      businessId: ids[1],
      type: "note",
      body: "Signed",
    }).expect(201);
    const list = (await call(team.owner, "post", "/lists", { name: "Reports list" }).expect(201))
      .body.data as Json;
    await call(team.owner, "post", "/bulk-operations", {
      action: "add_to_list",
      listId: list.id,
      selection: { ids },
    })
      .set("Idempotency-Key", "reports-bulk-1")
      .expect(202);

    const sources = (
      await call(team.analyst, "get", "/reports/source-breakdown?period=all").expect(200)
    ).body.data as Json;
    expect(sources).toMatchObject({
      period: "all",
      periodStart: null,
      totalBusinesses: 3,
      sources: [{ source: "user_import", businesses: 3, share: 1 }],
    });
    const quality = (
      await call(team.analyst, "get", "/reports/quality-distribution?period=30d").expect(200)
    ).body.data as Json;
    expect(quality).toMatchObject({ total: 3, unscored: 1 });
    expect(quality.fit).toHaveLength(10);
    expect(quality.fit.find((b: Json) => b.min === 80).count).toBe(1);
    expect(quality.fit.find((b: Json) => b.min === 90)).toEqual({ min: 90, max: 100, count: 1 });
    expect(quality.dataConfidence.find((b: Json) => b.min === 40).count).toBe(1);
    expect(quality.dataConfidence.find((b: Json) => b.min === 0).count).toBe(1);

    const timeline = (
      await call(team.analyst, "get", "/reports/jobs-timeline?period=7d").expect(200)
    ).body.data as Json;
    expect(timeline.days).toHaveLength(7);
    expect(timeline.days[6]).toMatchObject({
      day: today(),
      created: { bulk: 1, discovery: 0, export: 0 },
    });
    expect(timeline.totals.created.bulk).toBe(1);

    const funnel = (
      await call(team.analyst, "get", "/reports/pipeline-funnel?period=30d").expect(200)
    ).body.data as Json;
    expect(funnel.stages.map((s: Json) => [s.key, s.current, s.entered])).toEqual([
      ["new", 1, 3],
      ["qualified", 1, 1],
      ["contacted", 0, 0],
      ["interested", 0, 0],
      ["opportunity", 0, 0],
      ["won", 1, 1],
      ["lost", 0, 0],
    ]);
    expect(funnel.totals).toEqual({
      leads: 3,
      open: 2,
      won: 1,
      lost: 0,
      winRate: 1,
      wonValue: [{ currency: "NGN", valueMinor: 250_000 }],
    });

    const acts = (
      await call(team.analyst, "get", "/reports/activity-summary?period=7d").expect(200)
    ).body.data as Json;
    expect(acts.total).toBe(3);
    expect(acts.byType).toEqual([
      { type: "note", count: 1 },
      { type: "call", count: 1 },
      { type: "whatsapp", count: 1 },
    ]);
    expect(acts.byUser[0]).toMatchObject({
      userId: team.sales_rep.userId,
      name: "Test Person",
      total: 2,
    });

    const overview = (
      await team.analyst.agent
        .get(`${API}/reports/overview?period=30d`)
        .set(orgHeaders(team.analyst.agent, org))
        .expect(200)
    ).body.data as Json;
    expect(overview.pipeline).toEqual({
      openLeads: 2,
      qualifiedLeads: 1,
      unassignedOpenLeads: 1,
      wonInPeriod: 1,
      lostInPeriod: 0,
    });
    expect(overview.activity.loggedInPeriod).toBe(3);
    expect(overview.activity.recent[0]).toMatchObject({
      type: expect.any(String),
      business: expect.objectContaining({ name: expect.any(String) }),
    });
    expect(overview.jobs).toMatchObject({ active: 1, failedInPeriod: 0 });
    expect(overview.jobs.recent[0]).toMatchObject({ kind: "bulk" });
    expect(overview.quality).toMatchObject({ total: 3, unscored: 1 });
    expect(overview.credits.usedInPeriod).toBe(0);
  });
});
