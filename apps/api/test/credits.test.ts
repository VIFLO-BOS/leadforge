import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Collections, MongoService, ObjectId } from "@leadforge/db-mongo";
import { AppError, DiscoveryReconciliationService, jobCreditKeys } from "@leadforge/core";
import { addMember, API, orgHeaders, type Harness } from "./harness.js";
import { createOwner } from "./fixtures.js";
import {
  balance,
  createDiscoveryHarness,
  createJob,
  credits,
  grant,
  ledger,
  spec,
  waitForJob,
} from "./discovery-helpers.js";
import { forgetOverture, seedOverture } from "./overture-helpers.js";

let h: Harness;
beforeAll(async () => {
  h = await createDiscoveryHarness();
});
afterAll(async () => h?.close());
beforeEach(async () => h.resetState());

/** Discovery jobs need places to hold credits against (resetState empties the Overture catalogue). */
async function withPlaces() {
  forgetOverture(h);
  await seedOverture(h);
}

const hold = (orgId: string, key: string, units: number) =>
  credits(h).hold(orgId, {
    units,
    key,
    referenceType: "test",
    referenceId: key,
    actorUserId: null,
    description: "test hold",
  });

async function invariant(orgId: string) {
  const { sum, cached } = await credits(h).invariant(orgId);
  expect(sum).toBe(cached);
  return cached;
}

describe("credit ledger: hold, capture and release", () => {
  it("50 parallel holds against a balance covering 10 yield exactly 10 successes", async () => {
    const owner = await createOwner(h, "race@example.test", "Race Org");
    await grant(h, owner.orgId, 10);
    const results = await Promise.allSettled(
      Array.from({ length: 50 }, (_, i) => hold(owner.orgId, `race:${i}:hold`, 1)),
    );
    const ok = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");
    expect(ok).toHaveLength(10);
    expect(rejected).toHaveLength(40);
    for (const r of rejected) {
      expect(r.reason).toBeInstanceOf(AppError);
      expect((r.reason as AppError).code).toBe("INSUFFICIENT_CREDITS");
    }
    expect(await invariant(owner.orgId)).toBe(0);
    expect(await balance(owner.agent, owner.orgId)).toMatchObject({
      balance: 0,
      held: 10,
      openHolds: 10,
    });
  });

  it("captures produced units and releases the rest; replays never double-charge", async () => {
    const owner = await createOwner(h, "settle@example.test", "Settle Org");
    await grant(h, owner.orgId, 100);
    const keys = jobCreditKeys("aaaaaaaaaaaaaaaaaaaaaaaa", 0);
    const first = await hold(owner.orgId, keys.hold, 40);
    const replay = await hold(owner.orgId, keys.hold, 40);
    expect(replay.replayed).toBe(true);
    expect(replay.entry.id).toBe(first.entry.id);
    expect(await invariant(owner.orgId)).toBe(60);

    // Partial failure: 25 of 40 records produced.
    const settle = {
      holdKey: keys.hold,
      captureKey: keys.capture,
      releaseKey: keys.release,
      capturedUnits: 25,
      description: "test",
    };
    expect(await credits(h).settle(owner.orgId, settle)).toEqual({
      found: true,
      held: 40,
      captured: 25,
      released: 15,
    });
    expect(await credits(h).settle(owner.orgId, { ...settle, capturedUnits: 39 })).toEqual({
      found: true,
      held: 40,
      captured: 25,
      released: 15,
    });
    expect(await invariant(owner.orgId)).toBe(75);

    // A capture can never exceed its hold.
    const k2 = jobCreditKeys("bbbbbbbbbbbbbbbbbbbbbbbb", 0);
    await hold(owner.orgId, k2.hold, 5);
    expect(
      await credits(h).settle(owner.orgId, {
        holdKey: k2.hold,
        captureKey: k2.capture,
        releaseKey: k2.release,
        capturedUnits: 99,
        description: "t",
      }),
    ).toMatchObject({ captured: 5, released: 0 });
    expect(await invariant(owner.orgId)).toBe(70);

    // A full release (compensation) closes the hold; a later settle captures nothing.
    const k3 = jobCreditKeys("cccccccccccccccccccccccc", 0);
    await hold(owner.orgId, k3.hold, 10);
    expect(
      await credits(h).releaseHold(owner.orgId, {
        holdKey: k3.hold,
        releaseKey: k3.release,
        description: "t",
      }),
    ).toMatchObject({ released: 10 });
    expect(
      await credits(h).releaseHold(owner.orgId, {
        holdKey: k3.hold,
        releaseKey: k3.release,
        description: "t",
      }),
    ).toMatchObject({ released: 10 });
    expect(
      await credits(h).settle(owner.orgId, {
        holdKey: k3.hold,
        captureKey: k3.capture,
        releaseKey: k3.release,
        capturedUnits: 4,
        description: "t",
      }),
    ).toMatchObject({ captured: 0, released: 10 });
    expect(await invariant(owner.orgId)).toBe(70);
    expect(
      await credits(h).settle(owner.orgId, {
        holdKey: "job:missing:hold",
        captureKey: "x:c",
        releaseKey: "x:r",
        capturedUnits: 1,
        description: "t",
      }),
    ).toMatchObject({ found: false });

    const rows = await ledger(owner.agent, owner.orgId);
    const capture = rows.find((r) => r.entryType === "capture" && r.capturedUnits === 25);
    expect(capture).toMatchObject({ units: 0, holdId: first.entry.id });
  });

  it("returns 402 INSUFFICIENT_CREDITS when a job cannot be held, and creates no job", async () => {
    await withPlaces();
    const owner = await createOwner(h, "broke@example.test", "Broke Org");
    await grant(h, owner.orgId, 7);
    const est = await owner.agent
      .post(`${API}/discovery/jobs/estimate`)
      .set(orgHeaders(owner.agent, owner.orgId))
      .send(spec({ maxRecords: 10 }))
      .expect(200);
    expect(est.body.data.credits).toMatchObject({ hold: 10, balance: 7, sufficient: false });
    expect(est.body.data.blockers).toEqual([
      expect.objectContaining({ code: "INSUFFICIENT_CREDITS" }),
    ]);
    const res = await createJob(owner.agent, owner.orgId, spec({ maxRecords: 10 })).expect(402);
    expect(res.body.error.code).toBe("INSUFFICIENT_CREDITS");
    expect(res.body.error.details).toEqual([
      { path: "credits.required", message: "10" },
      { path: "credits.available", message: "7" },
    ]);
    expect(
      await h.app
        .get(MongoService)
        .database.collection(Collections.discoveryJobs)
        .countDocuments({ organizationId: owner.orgId }),
    ).toBe(0);
    expect(await balance(owner.agent, owner.orgId)).toMatchObject({ balance: 7, held: 0 });
  });

  it("pages the ledger newest first and limits it to roles with usage:read", async () => {
    const owner = await createOwner(h, "ledger@example.test", "Ledger Org");
    for (let i = 0; i < 3; i++) await grant(h, owner.orgId, 1);
    const page1 = await owner.agent
      .get(`${API}/credits/ledger?pageSize=2`)
      .set(orgHeaders(owner.agent, owner.orgId))
      .expect(200);
    expect(page1.body.data).toHaveLength(2);
    expect(page1.body.data[0].balanceAfter).toBe(3);
    const page2 = await owner.agent
      .get(`${API}/credits/ledger?pageSize=2&cursor=${page1.body.meta.nextCursor}`)
      .set(orgHeaders(owner.agent, owner.orgId))
      .expect(200);
    expect(page2.body.data.map((e: { balanceAfter: number }) => e.balanceAfter)).toEqual([1]);
    expect(page2.body.meta.nextCursor).toBeNull();
    const bad = await owner.agent
      .get(`${API}/credits/ledger?cursor=nope`)
      .set(orgHeaders(owner.agent, owner.orgId))
      .expect(400);
    expect(bad.body.error.details[0].path).toBe("cursor");
    const rep = await addMember(h, owner.orgId, "sales_rep", "ledger-rep@example.test");
    await rep.agent
      .get(`${API}/credits/ledger`)
      .set(orgHeaders(rep.agent, owner.orgId))
      .expect(403);
    const repBalance = await rep.agent
      .get(`${API}/credits/balance`)
      .set(orgHeaders(rep.agent, owner.orgId))
      .expect(200);
    expect(repBalance.body.data.balance).toBe(3);
  });
});

describe("reconciliation", () => {
  it("settles terminal jobs left unsettled and releases orphan holds, but never a live job's hold", async () => {
    await withPlaces();
    const owner = await createOwner(h, "recon@example.test", "Recon Org");
    await grant(h, owner.orgId, 200);
    const db = h.app.get(MongoService).database;
    const recon = h.app.get(DiscoveryReconciliationService, { strict: false });

    // 1. A job that finished (crash before settlement): terminal, unsettled, finished 6 minutes ago.
    const unsettled = (
      await createJob(owner.agent, owner.orgId, spec({ maxRecords: 20 })).expect(201)
    ).body.data.id as string;
    await db
      .collection(Collections.discoveryJobs)
      .updateOne(
        { _id: new ObjectId(unsettled) },
        {
          $set: {
            status: "completed",
            finishedAt: new Date(Date.now() - 6 * 60_000),
            pendingUnits: [],
          },
        },
      );
    // 2. An orphan hold: no job document exists for it (the insert failed after the hold).
    const orphanJob = new ObjectId().toHexString();
    await credits(h).hold(owner.orgId, {
      units: 30,
      key: jobCreditKeys(orphanJob, 0).hold,
      referenceType: "discovery_job",
      referenceId: orphanJob,
      actorUserId: null,
      description: "orphan",
    });
    // 3. A live (queued) job whose hold is old: kept.
    const live = (await createJob(owner.agent, owner.orgId, spec({ maxRecords: 10 })).expect(201))
      .body.data.id as string;
    await h.prisma.$executeRawUnsafe(
      `UPDATE credit_ledger SET created_at = now() - interval '25 hours' WHERE entry_type = 'hold'`,
    );
    // 4. A running job past its timeout.
    const stuck = (await createJob(owner.agent, owner.orgId, spec({ maxRecords: 5 })).expect(201))
      .body.data.id as string;
    await db
      .collection(Collections.discoveryJobs)
      .updateOne(
        { _id: new ObjectId(stuck) },
        {
          $set: {
            status: "running",
            startedAt: new Date(),
            timeoutAt: new Date(Date.now() - 60_000),
          },
        },
      );
    expect(await balance(owner.agent, owner.orgId)).toMatchObject({
      balance: 135,
      held: 65,
      openHolds: 4,
    });

    const report = await recon.run(new Date());
    expect(report).toMatchObject({
      timedOut: 1,
      settledJobs: 1,
      orphanHoldsReleased: 1,
      errors: [],
    });

    const settled = await waitForJob(owner.agent, owner.orgId, unsettled);
    expect(settled.credits).toMatchObject({ held: 20, captured: 0, released: 20, settled: true });
    const timedOut = await waitForJob(owner.agent, owner.orgId, stuck);
    expect(timedOut).toMatchObject({
      status: "failed",
      errors: [expect.objectContaining({ code: "JOB_TIMEOUT" })],
    });
    const liveJob = await owner.agent
      .get(`${API}/discovery/jobs/${live}`)
      .set(orgHeaders(owner.agent, owner.orgId))
      .expect(200);
    expect(liveJob.body.data).toMatchObject({ status: "queued", credits: { settled: false } });
    expect(await balance(owner.agent, owner.orgId)).toMatchObject({
      balance: 190,
      held: 10,
      openHolds: 1,
    });
    expect(await invariant(owner.orgId)).toBe(190);
    const orphanRows = await ledger(owner.agent, owner.orgId, `&referenceId=${orphanJob}`);
    expect(orphanRows.map((r) => [r.entryType, r.units])).toEqual([
      ["release", 30],
      ["hold", -30],
    ]);
    const runs = await h.prisma.reconciliationRun.findMany({ where: { kind: "holds" } });
    expect(runs.length).toBeGreaterThanOrEqual(1);
    expect(runs[0]!.fixed).toBeGreaterThanOrEqual(3);

    // A second pass finds nothing left to fix.
    const again = await recon.run(new Date());
    expect(again).toMatchObject({
      timedOut: 0,
      settledJobs: 0,
      orphanHoldsReleased: 0,
      orphanHoldsSettled: 0,
    });
  });
});
