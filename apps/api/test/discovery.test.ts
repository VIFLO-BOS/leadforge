import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { Logger } from "nestjs-pino";
import { Collections, MongoService, ObjectId } from "@leadforge/db-mongo";
import { EXPIRED_NAME_LABEL } from "@leadforge/contracts";
import {
  BusinessesService,
  DiscoveryRunner,
  OverturePlaceRepository,
  ProvenanceService,
  RetentionService,
  SOURCE_CONFIDENCE,
  type FetchSourcePageJob,
  type IngestItem,
  type RunResult,
} from "@leadforge/core";
import { addMember, API, orgHeaders, type Harness } from "./harness.js";
import { createOwner, seedBusinesses } from "./fixtures.js";
import {
  allItems,
  balance,
  createDiscoveryHarness,
  createJob,
  grant,
  ledger,
  runJob,
  spec,
  startDiscoveryWorker,
  waitForJob,
} from "./discovery-helpers.js";
import {
  forgetOverture,
  sampleId,
  sampleName,
  SAMPLE_MATCHES_STANDARD,
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
  await seedOverture(h);
});
afterEach(() => vi.restoreAllMocks());

const N = SAMPLE_MATCHES_STANDARD; // 24 matching Ikeja pharmacies, 10 per page
const mongo = () => h.app.get(MongoService).database;
const runner = () => h.app.get(DiscoveryRunner, { strict: false });
/** The purge runs in the worker; build it from the same services the worker uses. */
const retention = () =>
  new RetentionService(
    h.app.get(BusinessesService, { strict: false }),
    h.app.get(ProvenanceService, { strict: false }),
    h.app.get(Logger),
  );

function page0(organizationId: string, jobId: string): FetchSourcePageJob {
  return {
    organizationId,
    jobId,
    round: 0,
    source: "overture_places",
    unit: "search-overture_places",
    cursor: { kind: "search", queryIndex: 0, pageIndex: 0, pageToken: null },
  };
}

/** The next page job the runner queued after page 0 (its cursor carries Overture's page token). */
async function page1(organizationId: string, jobId: string): Promise<FetchSourcePageJob> {
  const queued = await h.discoveryQueue.getJob(
    `discovery-${jobId}-r0-search-overture_places-q0-p1`,
  );
  if (!queued) throw new Error("page 1 was not queued");
  expect(queued.data.organizationId).toBe(organizationId);
  return queued.data as FetchSourcePageJob;
}

/** processUnit, waiting out our own rate limiter the way the worker would. */
async function processPage(payload: FetchSourcePageJob, attemptsMade = 0): Promise<RunResult> {
  for (;;) {
    const r = await runner().processUnit(payload, { attemptsMade, maxAttempts: 3 });
    if (r.status !== "rate_limited") return r;
    await new Promise((res) => setTimeout(res, r.retryAfterMs));
  }
}

async function counts(organizationId: string, jobId: string) {
  const db = mongo();
  return {
    businesses: await db.collection(Collections.businesses).countDocuments({ organizationId }),
    observations: await db
      .collection(Collections.sourceObservations)
      .countDocuments({ organizationId, discoveryJobId: new ObjectId(jobId) }),
    items: await db
      .collection(Collections.discoveryJobItems)
      .countDocuments({ organizationId, jobId: new ObjectId(jobId) }),
  };
}

describe("discovery job end to end on Overture Maps Places", () => {
  it("runs a job through the queue: exact hold, items, businesses with provenance and attribution, credits and a notification", async () => {
    const owner = await createOwner(h, "disco-owner@example.test", "Disco Org");
    await grant(h, owner.orgId, 100);

    const estimate = await owner.agent
      .post(`${API}/discovery/jobs/estimate`)
      .set(orgHeaders(owner.agent, owner.orgId))
      .send(spec())
      .expect(200);
    expect(estimate.body.data).toMatchObject({
      estimateAvailable: true,
      maxRecords: N,
      credits: { perRecord: 1, hold: N, balance: 100, sufficient: true },
      blockers: [],
    });
    expect(estimate.body.data.sources[0]).toMatchObject({
      source: "overture_places",
      runnable: true,
      queries: 1,
      maxResults: N,
      exact: true,
      alreadyInDirectory: 0,
      providerSku: null,
    });

    const job = await runJob(h, owner.agent, owner.orgId, spec());
    expect(job.status).toBe("completed");
    expect(job.progress).toMatchObject({
      processed: N,
      created: N,
      updated: 0,
      duplicates: 0,
      skipped: 0,
      failed: 0,
      billable: N,
      pagesFetched: 3,
      limit: N,
    });
    expect(job.sourceOutcomes).toEqual([
      {
        source: "overture_places",
        status: "completed",
        pages: 3,
        records: N,
        rateLimited: expect.any(Number),
        errors: [],
      },
    ]);
    expect(job.credits).toMatchObject({ held: N, captured: N, released: 0, settled: true });
    expect(job.attributions).toEqual(["Overture Maps Foundation"]);
    expect(job.sourceReleases).toEqual([{ source: "overture_places", release: "2026-10-21.0" }]);

    const items = await allItems(owner.agent, owner.orgId, job.id);
    expect(items).toHaveLength(N);
    expect(items.map((i) => i.externalId)).not.toContain(sampleId(27)); // duplicate of 3: never offered, never billed
    expect(
      items
        .find((i) => i.externalId === sampleId(23))!
        .warnings.map((w: { code: string }) => w.code),
    ).toEqual(["LOWER_CONFIDENCE"]);
    const first = items.find((i) => i.externalId === sampleId(1))!;
    expect(first.business).toMatchObject({ name: sampleName(1), nameState: "unverified" });

    const list = await owner.agent
      .get(`${API}/businesses?source=overture_places&pageSize=100`)
      .set(orgHeaders(owner.agent, owner.orgId))
      .expect(200);
    expect(list.body.meta.total).toBe(N);
    expect(list.body.data.every((row: { name: string }) => row.name !== EXPIRED_NAME_LABEL)).toBe(
      true,
    );

    const detail = await owner.agent
      .get(`${API}/businesses/${first.business.id}`)
      .set(orgHeaders(owner.agent, owner.orgId))
      .expect(200);
    expect(detail.body.data.name).toMatchObject({
      value: sampleName(1),
      state: "unverified",
      expiresAt: null,
      lastObservedAt: "2026-10-21T00:00:00.000Z",
    });
    expect(detail.body.data.externalRefs).toEqual([
      expect.objectContaining({
        source: "overture_places",
        externalId: sampleId(1),
        expiresAt: null,
        release: "2026-10-21.0",
        dataset: "meta",
        recordId: "1000000001",
        license: "CDLA-Permissive-2.0",
        status: "active",
      }),
    ]);
    expect(detail.body.data.attributions[0]).toMatchObject({
      source: "overture_places",
      text: "Source: Overture Maps Foundation (overturemaps.org)",
    });
    expect(detail.body.data.attributions[0].lines[0]).toBe(
      "Data from Meta. Available under CDLA Permissive 2.0.",
    );
    expect(detail.body.data.attributions[0].licenses.map((l: { id: string }) => l.id)).toEqual([
      "CDLA-Permissive-2.0",
      "ODbL-1.0",
      "CC-BY-4.0",
    ]);
    expect(detail.body.data.location.value).toMatchObject({
      region: "Lagos",
      lga: "Ikeja",
      locality: "Ikeja",
    });
    expect(detail.body.data.phones[0]).toMatchObject({ e164: "+2348031000001", type: "mobile" });
    expect(detail.body.data.emails[0]).toMatchObject({
      address: "info@pharmacy-1.example.test",
      kind: "business",
    });
    expect(detail.body.data.categories.map((c: { taxonomy: string }) => c.taxonomy)).toEqual([
      "overture",
      "overture",
    ]);
    expect(detail.body.data.createdVia).toMatchObject({
      kind: "discovery",
      discoveryJobId: job.id,
    });

    const obs = await owner.agent
      .get(`${API}/businesses/${first.business.id}/observations?pageSize=100`)
      .set(orgHeaders(owner.agent, owner.orgId))
      .expect(200);
    expect(obs.body.data.length).toBeGreaterThanOrEqual(6);
    for (const o of obs.body.data) {
      expect(o).toMatchObject({
        source: "overture_places",
        collectionMethod: "dataset_snapshot",
        sourceRef: `overture:2026-10-21.0:places/place/${sampleId(1)}`,
        sourceExternalId: sampleId(1),
        discoveryJobId: job.id,
        redacted: false,
        retainValueUntil: null,
        confidence: 0.6,
        attribution:
          "Source: Overture Maps Foundation (overturemaps.org). Data from Meta. Available under CDLA Permissive 2.0.",
        licensing: {
          release: "2026-10-21.0",
          dataset: "meta",
          recordId: "1000000001",
          license: "CDLA-Permissive-2.0",
          licenseTextPath: "/api/v1/public/data-licenses/CDLA-Permissive-2.0",
        },
      });
    }

    // Ledger: hold 24 (the exact match count), capture 24, nothing to release (no 0-unit release row since Phase 5).
    const entries = await ledger(owner.agent, owner.orgId, `&referenceId=${job.id}`);
    expect(entries.map((e) => [e.entryType, e.units, e.capturedUnits]).sort()).toEqual([
      ["capture", 0, N],
      ["hold", -N, null],
    ]);
    expect(entries.every((e) => e.referenceName === job.name)).toBe(true);
    expect(await balance(owner.agent, owner.orgId)).toMatchObject({
      balance: 100 - N,
      held: 0,
      openHolds: 0,
    });

    const notes = await owner.agent
      .get(`${API}/notifications`)
      .set(orgHeaders(owner.agent, owner.orgId))
      .expect(200);
    expect(notes.body.data).toEqual([
      expect.objectContaining({
        type: "discovery.completed",
        href: `/app/discovery/${job.id}`,
        readAt: null,
      }),
    ]);
    const audit = await mongo()
      .collection(Collections.auditEvents)
      .find({ organizationId: owner.orgId, resourceId: job.id })
      .toArray();
    expect(audit.map((a) => a.action).sort()).toEqual(["discovery.created", "discovery.finished"]);
  });

  it("never charges twice for the same place: later jobs skip places already in the directory", async () => {
    const owner = await createOwner(h, "twice@example.test", "Twice Org");
    await grant(h, owner.orgId, 100);
    const first = await runJob(
      h,
      owner.agent,
      owner.orgId,
      spec({ name: "First five", maxRecords: 5 }),
    );
    expect(first.progress).toMatchObject({ created: 5, billable: 5 });

    const est = await owner.agent
      .post(`${API}/discovery/jobs/estimate`)
      .set(orgHeaders(owner.agent, owner.orgId))
      .send(spec({ name: "The rest" }))
      .expect(200);
    expect(est.body.data.sources[0]).toMatchObject({ maxResults: N - 5, alreadyInDirectory: 5 });
    expect(est.body.data.credits.hold).toBe(N - 5);
    const second = await runJob(h, owner.agent, owner.orgId, spec({ name: "The rest" }));
    expect(second.progress).toMatchObject({
      created: N - 5,
      updated: 0,
      duplicates: 0,
      billable: N - 5,
    });
    expect(second.credits).toMatchObject({ held: N - 5, captured: N - 5, released: 0 });

    // Nothing new left: the job is refused before any hold.
    const none = await createJob(owner.agent, owner.orgId, spec({ name: "Nothing left" })).expect(
      400,
    );
    expect(none.body.error.details[0]).toMatchObject({ path: "sources" });
    expect(await balance(owner.agent, owner.orgId)).toMatchObject({ balance: 100 - N, held: 0 });
    expect(
      await mongo()
        .collection(Collections.businesses)
        .countDocuments({ organizationId: owner.orgId }),
    ).toBe(N);
  });

  it("replays an Idempotency-Key to the same job and refuses it for a different spec", async () => {
    const owner = await createOwner(h, "idem@example.test", "Idem Org");
    await grant(h, owner.orgId, 200);
    const first = await createJob(owner.agent, owner.orgId, spec(), "wizard-submit-0001").expect(
      201,
    );
    const again = await createJob(owner.agent, owner.orgId, spec(), "wizard-submit-0001").expect(
      200,
    );
    expect(again.body.data.id).toBe(first.body.data.id);
    const other = await createJob(
      owner.agent,
      owner.orgId,
      spec({ maxRecords: 10 }),
      "wizard-submit-0001",
    ).expect(409);
    expect(other.body.error.code).toBe("CONFLICT");
    expect(await balance(owner.agent, owner.orgId)).toMatchObject({
      balance: 200 - N,
      held: N,
      openHolds: 1,
    });
    const missing = await owner.agent
      .post(`${API}/discovery/jobs`)
      .set(orgHeaders(owner.agent, owner.orgId))
      .send(spec())
      .expect(400);
    expect(missing.body.error.details[0].path).toBe("Idempotency-Key");
  });

  it("creates nothing new when the same page is processed again, even after a lost item write", async () => {
    const owner = await createOwner(h, "idempotent@example.test", "Idempotent Org");
    await grant(h, owner.orgId, 100);
    const created = await createJob(owner.agent, owner.orgId, spec()).expect(201);
    const jobId = created.body.data.id as string;
    await runner().run({ organizationId: owner.orgId, jobId, round: 0, reason: "start" });

    expect(await processPage(page0(owner.orgId, jobId))).toEqual({ status: "continued" });
    const first = await counts(owner.orgId, jobId);
    expect(first).toMatchObject({ businesses: 10, items: 10 });

    expect(await processPage(page0(owner.orgId, jobId))).toEqual({ status: "continued" });
    expect(await counts(owner.orgId, jobId)).toEqual(first);

    // A crash after the businesses were written but before the item outcomes were: the page,
    // reprocessed, still returns the same places (links made by this job do not exclude them).
    await mongo()
      .collection(Collections.discoveryJobItems)
      .deleteMany({ jobId: new ObjectId(jobId) });
    await processPage(page0(owner.orgId, jobId));
    expect(await counts(owner.orgId, jobId)).toEqual(first);
    expect(await allItems(owner.agent, owner.orgId, jobId, "&outcome=created")).toHaveLength(10);
    const job = await owner.agent
      .get(`${API}/discovery/jobs/${jobId}`)
      .set(orgHeaders(owner.agent, owner.orgId))
      .expect(200);
    expect(job.body.data.progress.pagesFetched).toBe(1);
  });

  it("retries a page with capped exponential backoff when the catalogue cannot be read", async () => {
    const owner = await createOwner(h, "retry@example.test", "Retry Org");
    await grant(h, owner.orgId, 100);
    const repo = h.app.get(OverturePlaceRepository, { strict: false });
    const original = repo.findOrdered.bind(repo);
    let failures = 0;
    vi.spyOn(repo, "findOrdered").mockImplementation(async (filter, limit) => {
      if (failures < 2) {
        failures += 1;
        throw new Error("Simulated connection reset");
      }
      return original(filter, limit);
    });
    const job = await runJob(h, owner.agent, owner.orgId, spec());
    expect(job.status).toBe("completed");
    expect(job.progress.created).toBe(N);
    expect(job.sourceOutcomes[0].errors.map((e: { code: string }) => e.code)).toEqual([
      "SOURCE_UNAVAILABLE",
      "SOURCE_UNAVAILABLE",
    ]);
    expect(job.errors).toEqual([]);
    const p0 = await h.discoveryQueue.getJob(`discovery-${job.id}-r0-search-overture_places-q0-p0`);
    expect(p0?.attemptsMade).toBeGreaterThanOrEqual(2);
    expect(p0?.opts.backoff).toEqual({ type: "discovery-capped-exponential" });
  });

  it("fails the job when the snapshot is gone, returns every credit and notifies in-app and by email", async () => {
    const owner = await createOwner(h, "gone@example.test", "Gone Org");
    await grant(h, owner.orgId, 100);
    const created = await createJob(owner.agent, owner.orgId, spec()).expect(201);
    // The catalogue disappears between creation and the run (an operator emptied it).
    await mongo().collection(Collections.overtureSyncRuns).deleteMany({});
    forgetOverture(h);
    const w = startDiscoveryWorker(h);
    const job = await waitForJob(owner.agent, owner.orgId, created.body.data.id).finally(() =>
      w.close(),
    );
    expect(job.status).toBe("failed");
    expect(job.errors[0]).toMatchObject({ code: "SOURCE_NOT_CONFIGURED" });
    expect(job.credits).toMatchObject({ held: N, captured: 0, released: N, settled: true });
    expect(await balance(owner.agent, owner.orgId)).toMatchObject({ balance: 100, held: 0 });
    const notes = await owner.agent
      .get(`${API}/notifications?unread=true`)
      .set(orgHeaders(owner.agent, owner.orgId))
      .expect(200);
    expect(notes.body.data[0]).toMatchObject({
      type: "discovery.failed",
      title: `Discovery job "Ikeja pharmacies" failed`,
    });
    const mails = await h.mailQueue.getJobs([
      "waiting",
      "delayed",
      "prioritized",
      "completed",
      "active",
    ]);
    const failureMail = mails.find(
      (m) => m.data.message.to === "gone@example.test" && /failed/.test(m.data.message.subject),
    );
    expect(failureMail?.data.message.text).toContain(`/app/discovery/${job.id}`);
  });

  it("bills an item that fails twice with a retryable error and then succeeds exactly once", async () => {
    const owner = await createOwner(h, "flaky@example.test", "Flaky Org");
    await grant(h, owner.orgId, 100);
    const businesses = h.app.get(BusinessesService, { strict: false });
    const original = businesses.ingestBatch.bind(businesses);
    let failures = 0;
    vi.spyOn(businesses, "ingestBatch").mockImplementation(
      async (org: string, items: IngestItem[], opts?: { dryRun?: boolean }) => {
        if (items.some((i) => i.ctx.sourceExternalId === sampleId(4)) && failures < 2) {
          failures += 1;
          throw new Error("Simulated transient write failure");
        }
        return original(org, items, opts);
      },
    );
    const job = await runJob(h, owner.agent, owner.orgId, spec());
    expect(failures).toBe(2);
    expect(job.status).toBe("completed");
    const item = (await allItems(owner.agent, owner.orgId, job.id)).find(
      (i) => i.externalId === sampleId(4),
    )!;
    expect(item).toMatchObject({ outcome: "created", billable: true, attempts: 2, error: null });
    expect(job.credits).toMatchObject({ captured: N, released: 0 });
    const captures = (
      await ledger(owner.agent, owner.orgId, `&referenceId=${job.id}&entryType=capture`)
    ).map((e) => e.capturedUnits);
    expect(captures).toEqual([N]);
    expect(
      await mongo()
        .collection(Collections.businesses)
        .countDocuments({ organizationId: owner.orgId }),
    ).toBe(N);
  });

  it("stops at maxRecords: the hold and the capture never exceed it", async () => {
    const owner = await createOwner(h, "limit@example.test", "Limit Org");
    await grant(h, owner.orgId, 100);
    const job = await runJob(h, owner.agent, owner.orgId, spec({ maxRecords: 5 }));
    expect(job.status).toBe("completed");
    expect(job.progress).toMatchObject({ billable: 5, created: 5, pagesFetched: 1, limit: 5 });
    expect(job.credits).toMatchObject({ held: 5, captured: 5, released: 0 });
    expect(await balance(owner.agent, owner.orgId)).toMatchObject({ balance: 95 });
  });

  it("applies domain filters, merges with an imported business by domain and name, and skips suppressed places", async () => {
    const owner = await createOwner(h, "dedup@example.test", "Dedup Org");
    await grant(h, owner.orgId, 100);
    const [importedId] = await seedBusinesses(h, owner.orgId, [
      { name: sampleName(2), website: "https://pharmacy-2.example.test", phones: [] },
    ]);
    const [optedOut] = await seedBusinesses(h, owner.orgId, [
      { name: "Someone else (Sample)", phones: ["+2348031000006"] },
    ]);
    await owner.agent
      .post(`${API}/businesses/${optedOut}/suppress`)
      .set(orgHeaders(owner.agent, owner.orgId))
      .send({ scope: "phone", reason: "Asked not to be contacted" })
      .expect(200);

    const filtered = spec({ domainsExclude: ["pharmacy-1.example.test"] });
    const est = await owner.agent
      .post(`${API}/discovery/jobs/estimate`)
      .set(orgHeaders(owner.agent, owner.orgId))
      .send(filtered)
      .expect(200);
    expect(est.body.data.maxRecords).toBe(N - 1); // the excluded domain is left out of the exact count
    const job = await runJob(h, owner.agent, owner.orgId, filtered);
    const items = await allItems(owner.agent, owner.orgId, job.id);
    expect(items.find((i) => i.externalId === sampleId(1))).toBeUndefined();
    expect(items.find((i) => i.externalId === sampleId(2))).toMatchObject({
      outcome: "updated",
      billable: true,
      business: { id: importedId },
    });
    expect(items.find((i) => i.externalId === sampleId(6))).toMatchObject({
      outcome: "skipped",
      billable: false,
      error: { code: "SUPPRESSED" },
    });
    expect(job.progress).toMatchObject({ created: N - 3, updated: 1, skipped: 1, billable: N - 2 });
    expect(job.credits).toMatchObject({ held: N - 1, captured: N - 2, released: 1 });

    const detail = await owner.agent
      .get(`${API}/businesses/${importedId}`)
      .set(orgHeaders(owner.agent, owner.orgId))
      .expect(200);
    expect(detail.body.data.name).toMatchObject({ value: sampleName(2), state: "unverified" });
    expect(detail.body.data.externalRefs.map((r: { externalId: string }) => r.externalId)).toEqual([
      sampleId(2),
    ]);
    expect(detail.body.data.sources.map((s: { source: string }) => s.source).sort()).toEqual([
      "overture_places",
      "user_import",
    ]);
  });

  it("does not charge for a place the directory already holds under another GERS id", async () => {
    const owner = await createOwner(h, "regers@example.test", "Regers Org");
    await grant(h, owner.orgId, 100);
    await runJob(h, owner.agent, owner.orgId, spec({ name: "Three", maxRecords: 3 }));
    // A later release gives the same Meta page (sample 3) a new GERS id: the old one is retired.
    const places = mongo().collection(Collections.overturePlaces);
    const three = (await places.findOne({ _id: sampleId(3) as never }))!;
    await places.updateOne(
      { _id: sampleId(3) as never },
      { $set: { retiredAt: new Date(), offerable: false } },
    );
    await places.insertOne({
      ...three,
      _id: "5a3b1e00-0000-4000-8000-000000000903" as never,
      canonicalId: "5a3b1e00-0000-4000-8000-000000000903",
      groupKeys: ["gers:5a3b1e00-0000-4000-8000-000000000903", "up:meta:1000000003"],
    });
    const job = await runJob(h, owner.agent, owner.orgId, spec({ name: "Rest" }));
    const items = await allItems(owner.agent, owner.orgId, job.id);
    expect(items.map((i) => i.externalId)).not.toContain("5a3b1e00-0000-4000-8000-000000000903");
    expect(job.progress.billable).toBe(N - 3);
    expect(
      await mongo()
        .collection(Collections.businesses)
        .countDocuments({ organizationId: owner.orgId }),
    ).toBe(N);
  });

  it("retries failed items in a new round with its own hold, and refuses when nothing failed", async () => {
    const owner = await createOwner(h, "retryfailed@example.test", "Retry Failed Org");
    await grant(h, owner.orgId, 100);
    const businesses = h.app.get(BusinessesService, { strict: false });
    const original = businesses.ingestBatch.bind(businesses);
    const spy = vi
      .spyOn(businesses, "ingestBatch")
      .mockImplementation(async (org: string, items: IngestItem[], opts?: { dryRun?: boolean }) => {
        if (items.some((i) => i.ctx.sourceExternalId === sampleId(4)))
          throw new Error("Simulated persistent write failure");
        return original(org, items, opts);
      });
    const job = await runJob(h, owner.agent, owner.orgId, spec());
    expect(job.status).toBe("completed_with_warnings");
    expect(job.progress).toMatchObject({ created: N - 1, failed: 1, billable: N - 1 });
    expect(job.retryableItems).toBe(1);
    expect(job.credits).toMatchObject({ held: N, captured: N - 1, released: 1 });
    const failed = (await allItems(owner.agent, owner.orgId, job.id, "&outcome=failed"))[0]!;
    expect(failed).toMatchObject({
      externalId: sampleId(4),
      billable: false,
      attempts: 3,
      error: { code: "INGEST_FAILED", retryable: true },
    });

    spy.mockRestore();
    const fetchRecord = vi.spyOn(
      h.app.get(OverturePlaceRepository, { strict: false }),
      "findByIds",
    );
    const retried = await owner.agent
      .post(`${API}/discovery/jobs/${job.id}/retry-failed`)
      .set(orgHeaders(owner.agent, owner.orgId))
      .expect(202);
    expect(retried.body.data).toMatchObject({ status: "queued", round: 1, progress: { limit: 1 } });
    const w = startDiscoveryWorker(h);
    const done = await waitForJob(owner.agent, owner.orgId, job.id).finally(() => w.close());
    expect(done).toMatchObject({
      status: "completed",
      round: 1,
      retryableItems: 0,
      progress: { created: N, failed: 0, billable: N },
    });
    expect(done.credits).toMatchObject({ held: N + 1, captured: N, released: 1, settled: true });
    const item = (await allItems(owner.agent, owner.orgId, job.id)).find(
      (i) => i.externalId === sampleId(4),
    )!;
    expect(item).toMatchObject({ outcome: "created", billable: true, round: 1 });
    expect(fetchRecord.mock.calls.map((c) => c[0])).toEqual([[sampleId(4)]]);
    const keys = (await ledger(owner.agent, owner.orgId, `&referenceId=${job.id}`)).map((e) => [
      e.entryType,
      e.units,
      e.capturedUnits,
    ]);
    expect(keys).toEqual(
      expect.arrayContaining([
        ["hold", -1, null],
        ["capture", 0, 1],
      ]),
    );
    expect(keys).not.toContainEqual(["release", 0, null]);
    expect(await balance(owner.agent, owner.orgId)).toMatchObject({ balance: 100 - N, held: 0 });

    const none = await owner.agent
      .post(`${API}/discovery/jobs/${job.id}/retry-failed`)
      .set(orgHeaders(owner.agent, owner.orgId))
      .expect(409);
    expect(none.body.error.code).toBe("JOB_NOT_RETRYABLE");
  });
});

describe("cancellation, timeout and access re-checks", () => {
  it("cancels a queued job at once and releases the whole hold", async () => {
    const owner = await createOwner(h, "cancelq@example.test", "Cancel Queued Org");
    await grant(h, owner.orgId, 100);
    const created = await createJob(owner.agent, owner.orgId, spec()).expect(201);
    const res = await owner.agent
      .post(`${API}/discovery/jobs/${created.body.data.id}/cancel`)
      .set(orgHeaders(owner.agent, owner.orgId))
      .expect(200);
    expect(res.body.data).toMatchObject({
      status: "cancelled",
      credits: { captured: 0, released: N, settled: true },
    });
    expect(await balance(owner.agent, owner.orgId)).toMatchObject({ balance: 100, held: 0 });
    const again = await owner.agent
      .post(`${API}/discovery/jobs/${created.body.data.id}/cancel`)
      .set(orgHeaders(owner.agent, owner.orgId))
      .expect(409);
    expect(again.body.error.code).toBe("JOB_NOT_CANCELLABLE");
    expect(
      await runner().run({
        organizationId: owner.orgId,
        jobId: created.body.data.id,
        round: 0,
        reason: "start",
      }),
    ).toMatchObject({ status: "noop" });
  });

  it("stops a running job before the next page, charging only the items already produced", async () => {
    const owner = await createOwner(h, "cancelr@example.test", "Cancel Running Org");
    await grant(h, owner.orgId, 100);
    const created = await createJob(owner.agent, owner.orgId, spec()).expect(201);
    const jobId = created.body.data.id as string;
    await runner().run({ organizationId: owner.orgId, jobId, round: 0, reason: "start" });
    await processPage(page0(owner.orgId, jobId));

    const res = await owner.agent
      .post(`${API}/discovery/jobs/${jobId}/cancel`)
      .set(orgHeaders(owner.agent, owner.orgId))
      .expect(200);
    expect(res.body.data).toMatchObject({ status: "running", cancelRequested: true });
    expect(await h.discoveryQueue.getJob(`discovery-${jobId}-r0-cancel`)).toBeTruthy();
    await runner().run({ organizationId: owner.orgId, jobId, round: 0, reason: "cancel" });

    expect(await processPage(await page1(owner.orgId, jobId))).toMatchObject({ status: "noop" });
    const job = await waitForJob(owner.agent, owner.orgId, jobId);
    expect(job).toMatchObject({
      status: "cancelled",
      progress: { processed: 10, created: 10, billable: 10 },
      credits: { captured: 10, released: N - 10 },
    });
    expect(job.sourceOutcomes[0].status).toBe("cancelled");
    expect(await balance(owner.agent, owner.orgId)).toMatchObject({ balance: 90 });
    const audit = await mongo()
      .collection(Collections.auditEvents)
      .find({ resourceId: jobId })
      .toArray();
    expect(audit.map((a) => a.action)).toEqual(
      expect.arrayContaining(["discovery.cancel_requested", "discovery.finished"]),
    );
  });

  it("times out a running job and settles it", async () => {
    const owner = await createOwner(h, "timeout@example.test", "Timeout Org");
    await grant(h, owner.orgId, 100);
    const created = await createJob(owner.agent, owner.orgId, spec()).expect(201);
    const jobId = created.body.data.id as string;
    await runner().run({ organizationId: owner.orgId, jobId, round: 0, reason: "start" });
    const timeoutJob = await h.discoveryQueue.getJob(`discovery-${jobId}-r0-timeout`);
    expect(timeoutJob?.opts.delay).toBe(2 * 60 * 60 * 1000);
    await processPage(page0(owner.orgId, jobId));
    expect(
      await runner().run({ organizationId: owner.orgId, jobId, round: 0, reason: "timeout" }),
    ).toMatchObject({ status: "noop" });
    await mongo()
      .collection(Collections.discoveryJobs)
      .updateOne(
        { _id: new ObjectId(jobId) },
        { $set: { timeoutAt: new Date(Date.now() - 1000) } },
      );
    expect(await processPage(await page1(owner.orgId, jobId))).toEqual({
      status: "finalized",
      jobStatus: "failed",
    });
    const job = await waitForJob(owner.agent, owner.orgId, jobId);
    expect(job.errors[0]).toMatchObject({ code: "JOB_TIMEOUT" });
    expect(job.credits).toMatchObject({ captured: 10, released: N - 10, settled: true });
  });

  it("re-checks the creator's permission before work starts", async () => {
    const owner = await createOwner(h, "revoke-owner@example.test", "Revoke Org");
    await grant(h, owner.orgId, 100);
    const researcher = await addMember(
      h,
      owner.orgId,
      "researcher",
      "revoke-researcher@example.test",
    );
    const created = await createJob(researcher.agent, owner.orgId, spec()).expect(201);
    await h.prisma.membership.update({
      where: { organizationId_userId: { organizationId: owner.orgId, userId: researcher.userId } },
      data: { role: "sales_rep" },
    });
    const result = await runner().run({
      organizationId: owner.orgId,
      jobId: created.body.data.id,
      round: 0,
      reason: "start",
    });
    expect(result).toEqual({ status: "finalized", jobStatus: "failed" });
    const job = await waitForJob(owner.agent, owner.orgId, created.body.data.id);
    expect(job.errors[0].code).toBe("ACCESS_REVOKED");
    expect(job.credits).toMatchObject({ captured: 0, released: N });
  });
});

describe("retention purge (legacy Google values)", () => {
  it("redacts values past their source retention and keeps the place ID and the observation metadata", async () => {
    const owner = await createOwner(h, "purge@example.test", "Purge Org");
    const collectedAt = new Date(Date.now() - 60_000);
    const service = h.app.get(BusinessesService, { strict: false });
    const { normalizeCreateRequest } = await import("@leadforge/core");
    const items: IngestItem[] = ["Wuse Pharmacy 1 (Sample)", "Wuse Pharmacy 2 (Sample)"].map(
      (name, i) => ({
        input: normalizeCreateRequest(
          {
            name,
            categories: ["Pharmacy"],
            phones: [`+23480310077${i}0`],
            emails: [],
            website: `https://wuse-${i}.example.test`,
          },
          "NG",
        ).input!,
        newId: new ObjectId(),
        createdVia: { kind: "seed", importId: null, userId: null },
        ctx: {
          source: "google_places",
          collectionMethod: "api",
          sourceRef: `places/legacy-${i}`,
          collectedAt,
          confidence: SOURCE_CONFIDENCE.google_places,
          actor: { type: "system", userId: null },
          importId: null,
          note: null,
          idSeed: null,
          expiresAt: collectedAt,
          sourceExternalId: `legacy-${i}`,
          categoryTaxonomy: "google",
          externalRef: { source: "google_places", externalId: `legacy-${i}`, expiresAt: null },
          attribution: "Google Maps",
        },
      }),
    );
    await service.ingestBatch(owner.orgId, items);
    const report = await retention().purgeExpired(new Date());
    expect(report.businessesPurged).toBe(2);
    expect(report.observationsRedacted).toBeGreaterThan(0);
    const db = mongo();
    for (const o of await db
      .collection(Collections.sourceObservations)
      .find({ organizationId: owner.orgId })
      .toArray()) {
      expect(o).toMatchObject({
        rawValue: null,
        normalizedValue: null,
        fieldKey: null,
        source: "google_places",
      });
      expect(o.redactedAt).toBeInstanceOf(Date);
    }
    for (const d of await db
      .collection(Collections.businesses)
      .find({ organizationId: owner.orgId })
      .toArray()) {
      expect(d.name.rawValue).toBeNull();
      expect(d.phones).toEqual([]);
      expect(d.website).toBeNull();
      expect(d.externalRefs[0].externalId).toMatch(/^legacy-/);
    }
    expect((await retention().purgeExpired(new Date())).businessesPurged).toBe(0);
  });
});
