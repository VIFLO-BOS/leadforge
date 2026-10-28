import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Collections, MongoService, ObjectId } from "@leadforge/db-mongo";
import {
  OVERTURE_SYNC_LEASE_MS,
  OvertureSyncBusyError,
  OvertureSyncService,
  overtureFixtureRecords,
  type OverturePlaceDocument,
} from "@leadforge/core";
import type { Harness } from "./harness.js";
import { createDiscoveryHarness } from "./discovery-helpers.js";
import {
  forgetOverture,
  sampleDataset,
  sampleId,
  samplePlace,
  seedOverture,
} from "./overture-helpers.js";

let h: Harness;
beforeAll(async () => {
  h = await createDiscoveryHarness();
});
afterAll(async () => h?.close());
beforeEach(async () => {
  await h.resetState();
  forgetOverture(h);
});

const places = () =>
  h.app.get(MongoService).database.collection<OverturePlaceDocument>(Collections.overturePlaces);
const all = () => [...overtureFixtureRecords().map((r) => r.place), ...sampleDataset()];

describe("Overture sync: load, idempotent rerun, update, retire", () => {
  it("loads places with states and LGAs from the boundaries and groups duplicates", async () => {
    const run = await seedOverture(h);
    expect(run).toMatchObject({
      status: "completed",
      release: "2026-10-21.0",
      trigger: "test",
      warnings: [],
    });
    expect(run.counts).toMatchObject({
      read: 54,
      invalid: 0,
      inserted: 54,
      updated: 0,
      unchanged: 0,
      retired: 0,
      live: 54,
      withoutState: 0,
      withoutLga: 0,
    });
    // Two duplicate groups (3 with 27: same Meta page; 4 with 28: same Facebook page and name, another dataset).
    expect(run.counts).toMatchObject({ duplicateGroups: 2, duplicatesHidden: 2, offerable: 51 });

    const dup = await places().findOne({ _id: sampleId(27) });
    expect(dup).toMatchObject({ isCanonical: false, offerable: false, canonicalId: sampleId(3) });
    expect(dup!.groupKeys).toEqual(
      [`gers:${sampleId(27)}`, `gers:${sampleId(3)}`, "up:meta:1000000003"].sort(),
    );
    expect(await places().findOne({ _id: sampleId(28) })).toMatchObject({
      isCanonical: false,
      canonicalId: sampleId(4),
    });
    // A chain branch (same name and page as 5, its own Meta page) stays separate.
    expect(await places().findOne({ _id: sampleId(29) })).toMatchObject({
      isCanonical: true,
      offerable: true,
    });
    expect(await places().findOne({ _id: sampleId(25) })).toMatchObject({
      closed: true,
      offerable: false,
    });

    const ikorodu = overtureFixtureRecords().find((r) => r.expectedAdmin.lga === "Ìkòròdú")!;
    expect(await places().findOne({ _id: ikorodu.place.id })).toMatchObject({
      admin: { stateName: "Lagos", stateCode: "NG-LA", lgaName: "Ìkòròdú", lgaKey: "ikorodu" },
    });
    const lagos = run.summary!.states.find((s) => s.key === "lagos")!;
    expect(lagos.lgas.find((l) => l.key === "ikeja")!.places).toBeGreaterThanOrEqual(24);
    expect(run.summary!.categories.find((c) => c.node === "pharmacy")!.places).toBe(24);
  });

  it("is idempotent: loading the same release again writes nothing", async () => {
    await seedOverture(h);
    const before = await places()
      .find({}, { projection: { _id: 1, updatedAt: 1 } })
      .toArray();
    const again = await seedOverture(h);
    expect(again.counts).toMatchObject({
      read: 54,
      inserted: 0,
      updated: 0,
      unchanged: 54,
      retired: 0,
      live: 54,
      offerable: 51,
    });
    const after = await places()
      .find({}, { projection: { _id: 1, updatedAt: 1 } })
      .toArray();
    expect(after).toEqual(before);
    expect(await places().countDocuments()).toBe(54);
  });

  it("updates changed places, retires missing ones without deleting them, and restores returning ones", async () => {
    await seedOverture(h);
    const next = all()
      .filter((p) => p.id !== sampleId(22))
      .map((p) => (p.id === sampleId(21) ? { ...p, phones: ["+2348039990021"] } : p));
    const run = await seedOverture(h, { places: next, release: "2026-11-18.0" });
    expect(run.counts).toMatchObject({
      read: 53,
      inserted: 0,
      updated: 1,
      unchanged: 52,
      retired: 1,
      live: 53,
    });
    expect(await places().findOne({ _id: sampleId(21) })).toMatchObject({
      release: "2026-11-18.0",
      firstSeenRelease: "2026-10-21.0",
      phones: [expect.objectContaining({ e164: "+2348039990021" })],
    });
    const retired = await places().findOne({ _id: sampleId(22) });
    expect(retired).toMatchObject({
      retiredInRelease: "2026-11-18.0",
      offerable: false,
      isCanonical: false,
    });
    expect(retired!.retiredAt).toBeInstanceOf(Date);
    expect(await places().countDocuments()).toBe(54);

    const back = await seedOverture(h, { places: all(), release: "2026-12-16.0" });
    expect(back.counts).toMatchObject({
      updated: 2,
      restored: 1,
      retired: 0,
      live: 54,
      offerable: 51,
    });
    expect(await places().findOne({ _id: sampleId(22) })).toMatchObject({
      retiredAt: null,
      offerable: true,
    });
  });

  it("does not retire more than 5% of live places unless forced", async () => {
    const many = Array.from({ length: 1100 }, (_, i) => samplePlace(1000 + i));
    await seedOverture(h, { places: many });
    const shrunk = await seedOverture(h, { places: many.slice(0, 1000), release: "2026-11-18.0" });
    expect(shrunk.status).toBe("completed_with_warnings");
    expect(shrunk.counts.retired).toBe(0);
    expect(shrunk.warnings.join(" ")).toMatch(
      /100 live places \(9\.1%\) are missing from 2026-11-18\.0, above the 5% safety limit/,
    );
    expect(await places().countDocuments({ retiredAt: null })).toBe(1100);

    const forced = await seedOverture(h, {
      places: many.slice(0, 1000),
      release: "2026-11-18.0",
      force: true,
    });
    expect(forced.counts.retired).toBe(100);
    expect(await places().countDocuments({ retiredAt: null })).toBe(1000);
  });

  it("runs one sync at a time (a lease in MongoDB) and expires runs whose process stopped", async () => {
    const runs = h.app.get(MongoService).database.collection(Collections.overtureSyncRuns);
    const running = (id: ObjectId, heartbeatAgoMs: number | null) => ({
      _id: id,
      release: "2026-10-21.0",
      schemaVersion: "2.0.0",
      origin: { kind: "fixture", location: "another process" },
      trigger: "manual",
      status: "running",
      counts: {},
      warnings: [],
      error: null,
      summary: null,
      startedAt: new Date(Date.now() - 60 * 60_000),
      heartbeatAt: heartbeatAgoMs === null ? null : new Date(Date.now() - heartbeatAgoMs),
      finishedAt: null,
      durationMs: null,
    });

    // Another live sync (fresh heartbeat) holds the lease, whatever Redis database this process uses.
    const live = new ObjectId();
    await runs.insertOne(running(live, 5_000));
    await expect(seedOverture(h)).rejects.toBeInstanceOf(OvertureSyncBusyError);
    // The unique partial index admits one running run, even when two processes race past the check.
    await expect(runs.insertOne(running(new ObjectId(), 0))).rejects.toMatchObject({ code: 11000 });

    // Its process stops: no heartbeat for longer than the lease. The next attempt marks it failed and runs.
    await runs.updateOne(
      { _id: live },
      { $set: { heartbeatAt: new Date(Date.now() - OVERTURE_SYNC_LEASE_MS - 1_000) } },
    );
    const run = await seedOverture(h);
    expect(run.status).toBe("completed");
    expect(await runs.findOne({ _id: live })).toMatchObject({
      status: "failed",
      error: expect.stringMatching(
        /^The sync process stopped before finishing \(no heartbeat since \d{4}-\d\d-\d\dT/,
      ),
      finishedAt: expect.any(Date),
      durationMs: expect.any(Number),
    });
    const ours = await runs.findOne({ _id: run._id });
    expect(ours).toMatchObject({
      status: "completed",
      origin: { kind: "fixture" },
      durationMs: expect.any(Number),
      heartbeatAt: expect.any(Date),
    });

    // A run recorded before heartbeats existed (no heartbeatAt) expires by its start time; a fresh one is kept.
    const legacy = new ObjectId();
    await runs.insertOne(running(legacy, null));
    expect(await h.app.get(OvertureSyncService, { strict: false }).expireStaleRuns()).toBe(1);
    expect(await runs.findOne({ _id: legacy })).toMatchObject({ status: "failed" });
    const fresh = new ObjectId();
    await runs.insertOne(running(fresh, 1_000));
    expect(await h.app.get(OvertureSyncService, { strict: false }).expireStaleRuns()).toBe(0);
    expect(await runs.countDocuments({ status: "running" })).toBe(1);
  });
});
