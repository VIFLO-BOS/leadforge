import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Job } from "bullmq";
import { Collections, MongoService, ObjectId } from "@leadforge/db-mongo";
import type { OrganizationRole } from "@leadforge/contracts";
import { DiscoveryQueueHandler, OverturePlaceRepository } from "@leadforge/core";
import { addMember, API, orgHeaders, type Harness } from "./harness.js";
import { createOwner, type OrgUser } from "./fixtures.js";
import { createDiscoveryHarness, createJob, grant, runJob, spec } from "./discovery-helpers.js";
import { forgetOverture, seedOverture } from "./overture-helpers.js";

let h: Harness;
beforeAll(async () => {
  h = await createDiscoveryHarness();
});
afterAll(async () => h?.close());
afterEach(() => vi.restoreAllMocks());
beforeEach(async () => {
  await h.resetState();
  forgetOverture(h);
  await seedOverture(h);
});

describe("tenant isolation on discovery, credits, jobs and notifications", () => {
  it("returns 404 for another organization's jobs and never lists its data", async () => {
    const a = await createOwner(h, "iso-a@example.test", "Iso A");
    const b = await createOwner(h, "iso-b@example.test", "Iso B");
    await grant(h, a.orgId, 100);
    await grant(h, b.orgId, 100);
    const jobA = await runJob(h, a.agent, a.orgId, spec({ name: "A job" }));
    const queuedB = (
      await createJob(b.agent, b.orgId, spec({ name: "B job", maxRecords: 5 })).expect(201)
    ).body.data.id as string;
    const noteA = (
      await a.agent.get(`${API}/notifications`).set(orgHeaders(a.agent, a.orgId)).expect(200)
    ).body.data[0].id as string;

    const B = (req: ReturnType<OrgUser["agent"]["get"]>) => req.set(orgHeaders(b.agent, b.orgId));
    for (const req of [
      () => b.agent.get(`${API}/discovery/jobs/${jobA.id}`),
      () => b.agent.get(`${API}/discovery/jobs/${jobA.id}/items`),
      () => b.agent.post(`${API}/discovery/jobs/${jobA.id}/cancel`),
      () => b.agent.post(`${API}/discovery/jobs/${jobA.id}/retry-failed`),
      () => b.agent.post(`${API}/notifications/${noteA}/read`),
    ]) {
      const res = await B(req());
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe("NOT_FOUND");
    }
    // B's member switching the header to A's organization is refused outright.
    await b.agent
      .get(`${API}/discovery/jobs/${jobA.id}`)
      .set(orgHeaders(b.agent, a.orgId))
      .expect(403);

    const listB = await B(b.agent.get(`${API}/discovery/jobs`)).expect(200);
    expect(listB.body.data.map((j: { id: string }) => j.id)).toEqual([queuedB]);
    const jobsB = await B(b.agent.get(`${API}/jobs`)).expect(200);
    expect(jobsB.body.data.map((j: { id: string }) => j.id)).toEqual([queuedB]);
    const ledgerB = await B(b.agent.get(`${API}/credits/ledger`)).expect(200);
    expect(
      ledgerB.body.data.every((e: { referenceId: string | null }) => e.referenceId !== jobA.id),
    ).toBe(true);
    expect((await B(b.agent.get(`${API}/credits/balance`)).expect(200)).body.data).toMatchObject({
      balance: 95,
      held: 5,
    });
    expect((await B(b.agent.get(`${API}/notifications`)).expect(200)).body.data).toEqual([]);
    const sourcesB = await B(b.agent.get(`${API}/businesses?source=overture_places`)).expect(200);
    expect(sourcesB.body.data).toEqual([]);
  });

  it("rejects job payloads whose organization does not own the job before any work", async () => {
    const a = await createOwner(h, "payload-a@example.test", "Payload A");
    const b = await createOwner(h, "payload-b@example.test", "Payload B");
    await grant(h, a.orgId, 100);
    const jobA = (await createJob(a.agent, a.orgId, spec()).expect(201)).body.data.id as string;
    const handler = h.app.get(DiscoveryQueueHandler, { strict: false });
    const reads = vi.spyOn(h.app.get(OverturePlaceRepository, { strict: false }), "findOrdered");
    const fake = (name: string, data: unknown) =>
      ({ name, data, attemptsMade: 0, opts: { attempts: 3 } }) as unknown as Job;

    for (const job of [
      fake("run-discovery-job", {
        organizationId: b.orgId,
        jobId: jobA,
        round: 0,
        reason: "start",
      }),
      fake("fetch-source-page", {
        organizationId: b.orgId,
        jobId: jobA,
        round: 0,
        source: "overture_places",
        unit: "search-overture_places",
        cursor: { kind: "search", queryIndex: 0, pageIndex: 0, pageToken: null },
      }),
      fake("fetch-source-page", { organizationId: a.orgId, jobId: { $ne: null }, round: 0 }),
      fake("drop-collections", {}),
    ]) {
      await expect(handler.handle(job)).rejects.toMatchObject({ name: "UnrecoverableError" });
    }
    const db = h.app.get(MongoService).database;
    expect(
      await db
        .collection(Collections.discoveryJobItems)
        .countDocuments({ jobId: new ObjectId(jobA) }),
    ).toBe(0);
    expect(
      (await db.collection(Collections.discoveryJobs).findOne({ _id: new ObjectId(jobA) }))?.status,
    ).toBe("queued");
    expect(reads).not.toHaveBeenCalled();
  });
});

type Expect = Record<OrganizationRole, number>;
const ALL = (ok: number): Expect => ({
  owner: ok,
  admin: ok,
  researcher: ok,
  sales_rep: ok,
  analyst: ok,
});
const RUN = (ok: number): Expect => ({
  owner: ok,
  admin: ok,
  researcher: ok,
  sales_rep: 403,
  analyst: 403,
});
const SOURCES: Expect = { owner: 200, admin: 200, researcher: 403, sales_rep: 403, analyst: 403 };
const USAGE: Expect = { owner: 200, admin: 200, researcher: 200, sales_rep: 403, analyst: 200 };

describe("permission matrix for discovery, sources, credits, jobs and notifications", () => {
  it("enforces the security matrix on every new route", async () => {
    const owner = await createOwner(h, "pm-owner@example.test", "Matrix Org");
    await grant(h, owner.orgId, 1000);
    const users: Record<OrganizationRole, OrgUser> = { owner } as Record<OrganizationRole, OrgUser>;
    for (const role of ["admin", "researcher", "sales_rep", "analyst"] as const) {
      const m = await addMember(h, owner.orgId, role, `pm-${role}@example.test`);
      users[role] = { agent: m.agent, orgId: owner.orgId, userId: m.userId };
    }
    const finished = await runJob(h, owner.agent, owner.orgId, spec({ maxRecords: 3 }));

    const mismatches: Array<{ role: string; name: string; status: number; expected: number }> = [];
    for (const role of Object.keys(users) as OrganizationRole[]) {
      const u = users[role];
      const hdr = orgHeaders(u.agent, u.orgId);
      const run = async (
        name: string,
        expected: Expect,
        req: () => Promise<{ status: number }>,
      ) => {
        const res = await req();
        if (res.status !== expected[role])
          mismatches.push({ role, name, status: res.status, expected: expected[role] });
      };
      await run("discovery sources", ALL(200), () =>
        u.agent.get(`${API}/discovery/sources`).set(hdr),
      );
      await run("estimate", RUN(200), () =>
        u.agent.post(`${API}/discovery/jobs/estimate`).set(hdr).send(spec()),
      );
      await run("create", RUN(201), () =>
        u.agent
          .post(`${API}/discovery/jobs`)
          .set(hdr)
          .set("Idempotency-Key", `pm-${role}-0001`)
          .send(spec({ maxRecords: 2 })),
      );
      await run("list", ALL(200), () => u.agent.get(`${API}/discovery/jobs`).set(hdr));
      await run("detail", ALL(200), () =>
        u.agent.get(`${API}/discovery/jobs/${finished.id}`).set(hdr),
      );
      await run("items", ALL(200), () =>
        u.agent.get(`${API}/discovery/jobs/${finished.id}/items`).set(hdr),
      );
      // Allowed roles reach the state check (409); others are stopped by the permission (403).
      await run("cancel finished", RUN(409), () =>
        u.agent.post(`${API}/discovery/jobs/${finished.id}/cancel`).set(hdr),
      );
      await run("retry-failed none", RUN(409), () =>
        u.agent.post(`${API}/discovery/jobs/${finished.id}/retry-failed`).set(hdr),
      );
      await run("sources list", ALL(200), () => u.agent.get(`${API}/sources`).set(hdr));
      await run("source toggle", SOURCES, () =>
        u.agent.patch(`${API}/sources/overture_places`).set(hdr).send({ enabled: true }),
      );
      await run("categories", ALL(200), () => u.agent.get(`${API}/discovery/categories`).set(hdr));
      await run("locations", ALL(200), () => u.agent.get(`${API}/discovery/locations`).set(hdr));
      await run("balance", ALL(200), () => u.agent.get(`${API}/credits/balance`).set(hdr));
      await run("ledger", USAGE, () => u.agent.get(`${API}/credits/ledger`).set(hdr));
      await run("all jobs", ALL(200), () => u.agent.get(`${API}/jobs`).set(hdr));
      await run("notifications", ALL(200), () => u.agent.get(`${API}/notifications`).set(hdr));
      await run("unread count", ALL(200), () =>
        u.agent.get(`${API}/notifications/unread-count`).set(hdr),
      );
      await run("read all", ALL(200), () => u.agent.post(`${API}/notifications/read-all`).set(hdr));
      await run("preferences", ALL(200), () =>
        u.agent.get(`${API}/notifications/preferences`).set(hdr),
      );
      await run("update preferences", ALL(200), () =>
        u.agent.put(`${API}/notifications/preferences`).set(hdr).send({ emailJobEvents: true }),
      );
    }
    expect(mismatches).toEqual([]);

    const denied = await users.analyst.agent
      .post(`${API}/discovery/jobs/estimate`)
      .set(orgHeaders(users.analyst.agent, owner.orgId))
      .send(spec())
      .expect(403);
    expect(denied.body.error.code).toBe("FORBIDDEN");
  });
});
