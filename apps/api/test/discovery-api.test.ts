import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Collections, MongoService } from "@leadforge/db-mongo";
import { addMember, API, orgHeaders, type Harness } from "./harness.js";
import { createOwner, csvBuffer, uploadCsv } from "./fixtures.js";
import { createDiscoveryHarness, createJob, grant, runJob, spec } from "./discovery-helpers.js";
import { forgetOverture, SAMPLE_MATCHES_STANDARD, seedOverture } from "./overture-helpers.js";

const N = SAMPLE_MATCHES_STANDARD;

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

/** Makes the next jobs fail: the Overture snapshot record disappears (as if never synced). */
async function dropSnapshot(): Promise<void> {
  await h.app.get(MongoService).database.collection(Collections.overtureSyncRuns).deleteMany({});
  forgetOverture(h);
}

describe("sources: registry, per-organization enable and disable", () => {
  it("lists sources with this organization's setting and field-level retention", async () => {
    const owner = await createOwner(h, "src-owner@example.test", "Sources Org");
    const res = await owner.agent
      .get(`${API}/sources`)
      .set(orgHeaders(owner.agent, owner.orgId))
      .expect(200);
    const keys = res.body.data.map((s: { key: string }) => s.key);
    expect(keys).toEqual([
      "user_import",
      "user_edit",
      "overture_places",
      "google_places",
      "website",
    ]);
    const overture = res.body.data.find((s: { key: string }) => s.key === "overture_places");
    expect(overture).toMatchObject({
      status: "configured",
      statusReason: null,
      method: "dataset_snapshot",
      enabled: true,
      configurable: true,
      config: null,
    });
    expect(overture.statusDetail).toMatch(/Release 2026-10-21\.0 loaded/);
    expect(overture.policy).toMatchObject({
      retentionDays: null,
      termsCheckedAt: "2026-10-25",
      attribution: expect.stringMatching(/^Source: Overture Maps Foundation/),
    });
    expect(overture.policy.licensing).toMatchObject({
      label: "Overture Maps Foundation",
      licensesPath: "/api/v1/public/data-licenses",
    });
    expect(overture.policy.licensing.licenses.map((l: { id: string }) => l.id)).toEqual([
      "CDLA-Permissive-2.0",
      "Apache-2.0",
      "CC0-1.0",
      "ODbL-1.0",
      "CC-BY-4.0",
    ]);
    // Google stays listed but is unavailable under its terms, even with a working (fixture) transport.
    const google = res.body.data.find((s: { key: string }) => s.key === "google_places");
    expect(google).toMatchObject({
      status: "not_available",
      statusReason: "provider_terms",
      policy: { retentionDays: 0, licensing: null },
    });
    expect(google.statusDetail).toMatch(/3\.2\.3/);
    const wizard = await owner.agent
      .get(`${API}/discovery/sources`)
      .set(orgHeaders(owner.agent, owner.orgId))
      .expect(200);
    expect(wizard.body.data).toEqual([
      expect.objectContaining({
        key: "overture_places",
        status: "configured",
        statusReason: null,
        runnable: true,
        enabled: true,
        maxResultsPerQuery: 0,
        attribution: "Overture Maps Foundation",
        licensing: expect.objectContaining({ label: "Overture Maps Foundation" }),
        specSupport: {
          location: ["region", "lga", "locality", "query", "geo"],
          confidence: true,
          requireContact: true,
          priorityFields: false,
          catalog: true,
        },
        snapshot: expect.objectContaining({ release: "2026-10-21.0", places: 54, offerable: 51 }),
      }),
      expect.objectContaining({
        key: "google_places",
        status: "not_available",
        statusReason: "provider_terms",
        runnable: false,
        licensing: null,
      }),
    ]);
  });

  it("disables a source for the organization: SOURCE_DISABLED on create, blocker on estimate, audited", async () => {
    const owner = await createOwner(h, "src-admin@example.test", "Disable Org");
    await grant(h, owner.orgId, 100);
    const off = await owner.agent
      .patch(`${API}/sources/overture_places`)
      .set(orgHeaders(owner.agent, owner.orgId))
      .send({ enabled: false })
      .expect(200);
    expect(off.body.data).toMatchObject({
      key: "overture_places",
      enabled: false,
      config: { updatedByUserId: owner.userId },
    });

    const create = await createJob(owner.agent, owner.orgId, spec()).expect(422);
    expect(create.body.error.code).toBe("SOURCE_DISABLED");
    const est = await owner.agent
      .post(`${API}/discovery/jobs/estimate`)
      .set(orgHeaders(owner.agent, owner.orgId))
      .send(spec())
      .expect(200);
    expect(est.body.data).toMatchObject({
      estimateAvailable: false,
      blockers: [expect.objectContaining({ code: "SOURCE_DISABLED", source: "overture_places" })],
    });

    const audit = await h.app
      .get(MongoService)
      .database.collection(Collections.auditEvents)
      .findOne({ organizationId: owner.orgId, action: "source.disabled" });
    expect(audit).toMatchObject({
      resourceType: "source",
      resourceId: "overture_places",
      before: { enabled: true },
      after: { enabled: false },
    });

    await owner.agent
      .patch(`${API}/sources/overture_places`)
      .set(orgHeaders(owner.agent, owner.orgId))
      .send({ enabled: true })
      .expect(200);
    await createJob(owner.agent, owner.orgId, spec()).expect(201);

    const notConfigurable = await owner.agent
      .patch(`${API}/sources/user_import`)
      .set(orgHeaders(owner.agent, owner.orgId))
      .send({ enabled: false })
      .expect(400);
    expect(notConfigurable.body.error.code).toBe("VALIDATION_FAILED");
    await owner.agent
      .patch(`${API}/sources/not_a_source`)
      .set(orgHeaders(owner.agent, owner.orgId))
      .send({ enabled: false })
      .expect(400);
  });
});

describe("job creation limits and validation", () => {
  it("rate limits job creation per organization (429 RATE_LIMITED with Retry-After)", async () => {
    const owner = await createOwner(h, "rl@example.test", "Rate Org");
    await grant(h, owner.orgId, 100);
    const bucket = Math.floor(Date.now() / (60 * 60 * 1000));
    await h.redis.set(`lf:rate:discovery-create:${owner.orgId}:${bucket}`, "1000", "EX", 3600);
    const res = await createJob(owner.agent, owner.orgId, spec()).expect(429);
    expect(res.body.error.code).toBe("RATE_LIMITED");
    expect(res.headers["retry-after"]).toBeDefined();
    expect(
      (await owner.agent.get(`${API}/credits/balance`).set(orgHeaders(owner.agent, owner.orgId)))
        .body.data.balance,
    ).toBe(100);
  });

  it("validates the spec with field details", async () => {
    const owner = await createOwner(h, "val@example.test", "Validate Org");
    await grant(h, owner.orgId, 100);
    const bad = await createJob(owner.agent, owner.orgId, {
      ...spec(),
      categories: [],
      maxRecords: 0,
      sources: ["overture_places", "overture_places"],
    }).expect(400);
    const paths = bad.body.error.details.map((d: { path: string }) => d.path).sort();
    expect(paths).toEqual(expect.arrayContaining(["categories", "maxRecords", "sources"]));
    const noState = await createJob(
      owner.agent,
      owner.orgId,
      spec({ location: { country: "NG", region: "Lagoon" } }),
    ).expect(400);
    expect(noState.body.error.details[0]).toMatchObject({ path: "location.region" });
    const abroad = await createJob(
      owner.agent,
      owner.orgId,
      spec({ location: { country: "GH" } }),
    ).expect(400);
    expect(abroad.body.error.details[0]).toMatchObject({ path: "location.country" });
    // Google is refused by its terms, whatever its configuration, and nothing is held.
    const google = await createJob(
      owner.agent,
      owner.orgId,
      spec({ sources: ["google_places"] }),
    ).expect(422);
    expect(google.body.error).toMatchObject({
      code: "SOURCE_POLICY_BLOCKED",
      details: [{ path: "sources", message: "google_places" }],
    });
    expect(
      (await owner.agent.get(`${API}/credits/balance`).set(orgHeaders(owner.agent, owner.orgId)))
        .body.data,
    ).toMatchObject({ balance: 100, held: 0 });
  });
});

describe("notifications", () => {
  it("lists, counts and marks read the user's notifications, and honors preferences", async () => {
    const owner = await createOwner(h, "notes@example.test", "Notes Org");
    await grant(h, owner.orgId, 200);
    const hdr = () => orgHeaders(owner.agent, owner.orgId);
    const job = await runJob(h, owner.agent, owner.orgId, spec());

    expect(
      (await owner.agent.get(`${API}/notifications/unread-count`).set(hdr()).expect(200)).body.data,
    ).toEqual({ unread: 1 });
    const list = await owner.agent.get(`${API}/notifications`).set(hdr()).expect(200);
    const note = list.body.data[0];
    expect(note).toMatchObject({
      type: "discovery.completed",
      title: `Discovery job "Ikeja pharmacies" completed`,
      href: `/app/discovery/${job.id}`,
    });
    expect(note.body).toBe(`${N} new, 0 updated.`);
    const read = await owner.agent
      .post(`${API}/notifications/${note.id}/read`)
      .set(hdr())
      .expect(200);
    expect(read.body.data.readAt).not.toBeNull();
    expect(
      (await owner.agent.get(`${API}/notifications?unread=true`).set(hdr()).expect(200)).body.data,
    ).toEqual([]);
    await owner.agent
      .post(`${API}/notifications/000000000000000000000000/read`)
      .set(hdr())
      .expect(404);

    // Another member cannot touch this user's notification.
    const admin = await addMember(h, owner.orgId, "admin", "notes-admin@example.test");
    await admin.agent
      .post(`${API}/notifications/${note.id}/read`)
      .set(orgHeaders(admin.agent, owner.orgId))
      .expect(404);
    expect(
      (
        await admin.agent
          .get(`${API}/notifications`)
          .set(orgHeaders(admin.agent, owner.orgId))
          .expect(200)
      ).body.data,
    ).toEqual([]);

    // Preferences: defaults on; switching in-app off stops new notices; email off stops failure mails.
    expect(
      (await owner.agent.get(`${API}/notifications/preferences`).set(hdr()).expect(200)).body.data,
    ).toEqual({ emailJobEvents: true, emailBilling: true, inappAll: true, emailAssignments: true });
    const prefs = await owner.agent
      .put(`${API}/notifications/preferences`)
      .set(hdr())
      .send({ inappAll: false, emailJobEvents: false })
      .expect(200);
    expect(prefs.body.data).toEqual({
      emailJobEvents: false,
      emailBilling: true,
      inappAll: false,
      emailAssignments: true,
    });
    const quiet = await createJob(
      owner.agent,
      owner.orgId,
      spec({
        name: "Quiet failure",
        categories: ["Hotel"],
        location: { country: "NG", region: "FCT" },
      }),
    ).expect(201);
    await dropSnapshot();
    const { startDiscoveryWorker, waitForJob } = await import("./discovery-helpers.js");
    const w = startDiscoveryWorker(h);
    const failed = await waitForJob(owner.agent, owner.orgId, quiet.body.data.id).finally(() =>
      w.close(),
    );
    expect(failed.status).toBe("failed");
    expect(
      (await owner.agent.get(`${API}/notifications/unread-count`).set(hdr()).expect(200)).body.data,
    ).toEqual({ unread: 0 });
    const mails = await h.mailQueue.getJobs([
      "waiting",
      "delayed",
      "prioritized",
      "completed",
      "active",
    ]);
    expect(mails.filter((m) => /Quiet failure/.test(m.data.message.subject))).toEqual([]);

    await owner.agent
      .put(`${API}/notifications/preferences`)
      .set(hdr())
      .send({ inappAll: true })
      .expect(200);
    await seedOverture(h);
    const third = await runJob(
      h,
      owner.agent,
      owner.orgId,
      spec({ name: "Third", categories: ["Hotel"], location: { country: "NG", region: "FCT" } }),
    );
    expect(third.status).toBe("completed");
    expect(
      (await owner.agent.post(`${API}/notifications/read-all`).set(hdr()).expect(200)).body.data,
    ).toEqual({ updated: 1 });
  });

  it("notifies the importing user when an import finishes", async () => {
    const owner = await createOwner(h, "import-note@example.test", "Import Note Org");
    const upload = await uploadCsv(
      owner,
      csvBuffer(["Name,Phone", "Alpha (Sample),+44 113 496 0101"]),
    ).expect(201);
    await owner.agent
      .post(`${API}/imports/${upload.body.data.id}/commit`)
      .set(orgHeaders(owner.agent, owner.orgId))
      .send({
        mapping: [
          { column: 0, field: "name" },
          { column: 1, field: "phone" },
        ],
        attestLawfulBasis: true,
      })
      .expect(202);
    const { ImportsService } = await import("@leadforge/core");
    await h.app.get(ImportsService, { strict: false }).process(owner.orgId, upload.body.data.id);
    const notes = await owner.agent
      .get(`${API}/notifications`)
      .set(orgHeaders(owner.agent, owner.orgId))
      .expect(200);
    expect(notes.body.data[0]).toMatchObject({
      type: "import.completed",
      href: `/app/businesses?importId=${upload.body.data.id}`,
    });
  });
});

describe("all jobs and overview", () => {
  it("lists discovery and import jobs newest first with normalized statuses, filters and cursors", async () => {
    const owner = await createOwner(h, "jobs@example.test", "Jobs Org");
    await grant(h, owner.orgId, 100);
    const hdr = () => orgHeaders(owner.agent, owner.orgId);
    const upload = await uploadCsv(owner, csvBuffer(["Name", "Draft Row (Sample)"])).expect(201);
    const job = await runJob(h, owner.agent, owner.orgId, spec());

    const all = await owner.agent.get(`${API}/jobs`).set(hdr()).expect(200);
    expect(all.body.data.map((j: { kind: string; status: string }) => [j.kind, j.status])).toEqual([
      ["discovery", "completed"],
      ["import", "draft"],
    ]);
    expect(all.body.data[0]).toMatchObject({
      id: job.id,
      name: "Ikeja pharmacies",
      href: `/app/discovery/${job.id}`,
      progress: { processed: N, total: null, failed: 0 },
    });
    expect(all.body.data[1]).toMatchObject({
      id: upload.body.data.id,
      kindStatus: "uploaded",
      progress: { total: 1 },
    });

    const imports = await owner.agent.get(`${API}/jobs?kind=import`).set(hdr()).expect(200);
    expect(imports.body.data).toHaveLength(1);
    const drafts = await owner.agent.get(`${API}/jobs?status=draft`).set(hdr()).expect(200);
    expect(drafts.body.data.map((j: { kind: string }) => j.kind)).toEqual(["import"]);
    const p1 = await owner.agent.get(`${API}/jobs?pageSize=1`).set(hdr()).expect(200);
    expect(p1.body.data[0].kind).toBe("discovery");
    const p2 = await owner.agent
      .get(`${API}/jobs?pageSize=1&cursor=${p1.body.meta.nextCursor}`)
      .set(hdr())
      .expect(200);
    expect(p2.body.data[0].kind).toBe("import");
    expect(p2.body.meta.nextCursor).toBeNull();
    await owner.agent.get(`${API}/jobs?cursor=broken`).set(hdr()).expect(400);

    const overview = await owner.agent.get(`${API}/reports/overview`).set(hdr()).expect(200);
    expect(overview.body.data.discovery).toMatchObject({
      total: 1,
      inProgress: 0,
      completedInPeriod: 1,
      failedInPeriod: 0,
    });
    expect(overview.body.data.discovery.recent[0]).toMatchObject({
      id: job.id,
      status: "completed",
    });
    // Phase 5 adds the credits captured in the period.
    expect(overview.body.data.credits).toEqual({ balance: 100 - N, held: 0, usedInPeriod: N });

    const list = await owner.agent
      .get(`${API}/discovery/jobs?status=completed&source=overture_places`)
      .set(hdr())
      .expect(200);
    expect(list.body.data.map((j: { id: string }) => j.id)).toEqual([job.id]);
    expect(
      (await owner.agent.get(`${API}/discovery/jobs?status=failed`).set(hdr()).expect(200)).body
        .data,
    ).toEqual([]);
  });
});

describe("wizard catalogues: categories and locations", () => {
  it("offers curated Nigerian categories with synonyms, Overture categories and place counts", async () => {
    const owner = await createOwner(h, "cats@example.test", "Cats Org");
    const hdr = () => orgHeaders(owner.agent, owner.orgId);
    const all = await owner.agent
      .get(`${API}/discovery/categories?limit=500`)
      .set(hdr())
      .expect(200);
    const pharmacy = all.body.data.find((c: { key: string }) => c.key === "pharmacy");
    expect(pharmacy).toMatchObject({
      label: "Pharmacy",
      kind: "curated",
      sourceCategories: ["pharmacy_and_drug_store"],
      places: N,
    });
    expect(pharmacy.synonyms).toContain("chemist");
    // One entry per label: the fixture's `pharmacy` places (under the curated node) add no second "Pharmacy".
    const labels = all.body.data.map((c: { label: string }) => c.label.toLowerCase());
    expect(new Set(labels).size).toBe(labels.length);
    expect(labels.filter((l: string) => l === "pharmacy")).toHaveLength(1);
    expect(
      all.body.data.some(
        (c: { kind: string; key: string }) => c.kind === "taxonomy" && c.key === "airline",
      ),
    ).toBe(true);
    const chem = await owner.agent.get(`${API}/discovery/categories?q=chem`).set(hdr()).expect(200);
    expect(chem.body.data.map((c: { key: string }) => c.key)).toContain("pharmacy");
    await owner.agent.get(`${API}/discovery/categories?source=nope`).set(hdr()).expect(400);
  });

  it("lists states and LGAs with offerable place counts and the boundary credit", async () => {
    const owner = await createOwner(h, "locs@example.test", "Locs Org");
    const res = await owner.agent
      .get(`${API}/discovery/locations`)
      .set(orgHeaders(owner.agent, owner.orgId))
      .expect(200);
    expect(res.body.data).toMatchObject({
      source: "overture_places",
      release: "2026-10-21.0",
      country: "NG",
    });
    expect(res.body.data.boundariesAttribution).toMatch(/OpenStreetMap contributors/);
    const lagos = res.body.data.states.find((s: { key: string }) => s.key === "lagos");
    expect(lagos).toMatchObject({ name: "Lagos", code: "NG-LA" });
    expect(lagos.lgas.find((l: { key: string }) => l.key === "ikeja")).toMatchObject({
      name: "Ikeja",
    });
    expect(lagos.lgas.find((l: { name: string }) => l.name === "Ìkòròdú")).toMatchObject({
      key: "ikorodu",
    });
  });
});
