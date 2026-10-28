import { randomUUID } from "node:crypto";
import { Queue, Worker, type Job } from "bullmq";
import { Redis } from "ioredis";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Collections, MongoService, ObjectId } from "@leadforge/db-mongo";
import { CSRF_HEADER, ORGANIZATION_DELETION_GRACE_DAYS } from "@leadforge/contracts";
import {
  ExportQueueHandler,
  OBJECT_STORAGE,
  OrganizationExportBuilder,
  OrganizationExportQueueHandler,
  OrganizationLifecycleService,
  QueueNames,
  type ObjectStorage,
  type SendEmailJob,
} from "@leadforge/core";
import {
  addMember,
  API,
  createHarness,
  csrfFrom,
  orgHeaders,
  TEST_QUEUE_PREFIX,
  type Harness,
} from "./harness.js";
import { createOwner, csvBuffer, seedBusinesses, uploadCsv, type OrgUser } from "./fixtures.js";
import { createJob, DISCOVERY_TEST_ENV, grant, spec, type Json } from "./discovery-helpers.js";
import { download, navigate, parseCsv, pollUntil, readZip } from "./phase5-helpers.js";
import { createPack } from "./billing-helpers.js";

/**
 * Stage 10: the organization deletion request (typed name, re-authentication, idempotent), the
 * grace period (new paid or long work refused with 409 ORGANIZATION_PENDING_DELETION, everything
 * else working), cancellation, the reminder and purge scan, and the whole-organization data
 * export (owner only, one at a time, signed downloads, ZIP contents, retention, redirects).
 */

const PASSWORD = "Str0ng-Passw0rd-Example!";
const DAY = 24 * 60 * 60 * 1000;

let h: Harness;
let owner: OrgUser;
let admin: OrgUser;
let researcher: OrgUser;

const as = (u: OrgUser) => orgHeaders(u.agent, u.orgId);
const requestDeletion = (u: OrgUser, body: object) =>
  u.agent.post(`${API}/organizations/current/deletion-requests`).set(as(u)).send(body);
const cancelDeletion = (u: OrgUser) =>
  u.agent.delete(`${API}/organizations/current/deletion-requests`).set(as(u));

async function mailsTo(to: string): Promise<Array<{ subject: string; text: string }>> {
  const jobs = await h.mailQueue.getJobs([
    "waiting",
    "delayed",
    "prioritized",
    "completed",
    "active",
    "failed",
  ]);
  return jobs.map((j) => (j.data as SendEmailJob).message).filter((m) => m.to === to);
}

async function auditCount(organizationId: string, action: string): Promise<number> {
  return h.app
    .get(MongoService)
    .database.collection(Collections.auditEvents)
    .countDocuments({ organizationId, action });
}

function orgExportWorker(): { close(): Promise<void>; failures: string[] } {
  const failures: string[] = [];
  // Dispatch like apps/worker's ExportProcessor: list exports queued earlier in this file share the queue.
  const orgHandler = h.app.get(OrganizationExportQueueHandler, { strict: false });
  const exportHandler = h.app.get(ExportQueueHandler, { strict: false });
  const w = new Worker(
    QueueNames.exports,
    (job: Job) =>
      job.name === "build-organization-export" ? orgHandler.handle(job) : exportHandler.handle(job),
    {
      connection: new Redis(process.env.REDIS_URL!, { maxRetriesPerRequest: null }),
      prefix: TEST_QUEUE_PREFIX,
    },
  );
  w.on("failed", (job, err) => failures.push(`${job?.name}: ${err?.message}`));
  return { failures, close: () => w.close() };
}

beforeAll(async () => {
  h = await createHarness(DISCOVERY_TEST_ENV);
  await h.resetState();
  owner = await createOwner(h, "lifecycle-owner@example.test", "Lifecycle Org");
  const a = await addMember(h, owner.orgId, "admin", "lifecycle-admin@example.test");
  admin = { agent: a.agent, orgId: owner.orgId, userId: a.userId };
  const r = await addMember(h, owner.orgId, "researcher", "lifecycle-researcher@example.test");
  researcher = { agent: r.agent, orgId: owner.orgId, userId: r.userId };
  await grant(h, owner.orgId, 50);
}, 120_000);

afterAll(async () => {
  await h?.close();
});

describe("organization deletion request", () => {
  it("is owner only, needs the exact name and the current password, and never answers 401", async () => {
    const byAdmin = await requestDeletion(admin, {
      confirmName: "Lifecycle Org",
      password: PASSWORD,
    });
    expect(byAdmin.status).toBe(403);
    expect(byAdmin.body.error.code).toBe("FORBIDDEN");

    const wrongName = await requestDeletion(owner, {
      confirmName: "lifecycle org",
      password: PASSWORD,
    }).expect(400);
    expect(wrongName.body.error.code).toBe("VALIDATION_FAILED");
    expect(wrongName.body.error.details).toEqual([
      expect.objectContaining({ path: "confirmName" }),
    ]);

    const wrongPassword = await requestDeletion(owner, {
      confirmName: "Lifecycle Org",
      password: "not-my-password-1",
    }).expect(403);
    expect(wrongPassword.body.error.code).toBe("REAUTH_FAILED");
    expect(await auditCount(owner.orgId, "org.deletion_reauth_failed")).toBe(1);

    const missing = await requestDeletion(owner, { confirmName: "Lifecycle Org" }).expect(400);
    expect(missing.body.error.code).toBe("VALIDATION_FAILED");
    const org = await h.prisma.organization.findUniqueOrThrow({ where: { id: owner.orgId } });
    expect(org.deletionRequestedAt).toBeNull();
  });

  it("schedules the purge 14 days out, tells owners and admins, and is idempotent while pending", async () => {
    const before = Date.now();
    const res = await requestDeletion(owner, {
      confirmName: "Lifecycle Org",
      password: PASSWORD,
    }).expect(202);
    const { deletionRequestedAt, purgeAfter } = res.body.data as {
      deletionRequestedAt: string;
      purgeAfter: string;
    };
    expect(new Date(deletionRequestedAt).getTime()).toBeGreaterThanOrEqual(before - 1000);
    expect(new Date(purgeAfter).getTime() - new Date(deletionRequestedAt).getTime()).toBe(
      ORGANIZATION_DELETION_GRACE_DAYS * DAY,
    );

    // Every member sees it: the organization profile and the membership list the app shell reads.
    const profile = (
      await researcher.agent.get(`${API}/organizations/current`).set(as(researcher)).expect(200)
    ).body.data as Json;
    expect(profile).toMatchObject({ deletionRequestedAt, purgeAfter });
    const me = (await researcher.agent.get(`${API}/auth/me`).expect(200)).body.data as Json;
    expect(me.organizations.find((o: Json) => o.id === owner.orgId)).toMatchObject({
      deletionRequestedAt,
      purgeAfter,
    });

    // Owners and admins: in-app and email. The researcher gets neither.
    const adminNotes = (await admin.agent.get(`${API}/notifications`).set(as(admin)).expect(200))
      .body.data as Json[];
    expect(adminNotes.map((n) => n.type)).toContain("organization.deletion_requested");
    const researcherNotes = (
      await researcher.agent.get(`${API}/notifications`).set(as(researcher)).expect(200)
    ).body.data as Json[];
    expect(researcherNotes.map((n) => n.type)).not.toContain("organization.deletion_requested");
    expect(
      (await mailsTo("lifecycle-owner@example.test")).some((m) =>
        /will be deleted on/.test(m.subject),
      ),
    ).toBe(true);
    expect(
      (await mailsTo("lifecycle-admin@example.test")).some((m) =>
        /will be deleted on/.test(m.subject),
      ),
    ).toBe(true);
    expect(
      (await mailsTo("lifecycle-researcher@example.test")).some((m) => /deleted/.test(m.subject)),
    ).toBe(false);

    const again = await requestDeletion(owner, {
      confirmName: "Lifecycle Org",
      password: PASSWORD,
    }).expect(202);
    expect(again.body.data).toEqual({ deletionRequestedAt, purgeAfter });
    expect(await auditCount(owner.orgId, "org.deletion_requested")).toBe(1);
  });

  it("pauses new paid or long work with 409 ORGANIZATION_PENDING_DELETION, and keeps everything else", async () => {
    const purgeAfter = (
      (await owner.agent.get(`${API}/organizations/current`).set(as(owner))).body.data as Json
    ).purgeAfter as string;
    const [biz] = await seedBusinesses(h, owner.orgId, [
      { name: "Grace Period Bakery (Sample)", website: "grace.example.test" },
    ]);
    const pack = await createPack(h, { credits: 10, priceMinor: 50_000 });
    const refused: Array<[string, { status: number; body: Json }]> = [
      ["discovery", await createJob(owner.agent, owner.orgId, spec({ name: "During grace" }))],
      [
        "analysis",
        await owner.agent.post(`${API}/analysis/websites`).set(as(owner)).send({ businessId: biz }),
      ],
      [
        "website contacts",
        await owner.agent
          .post(`${API}/enrichment/businesses/${biz}/website-contacts`)
          .set(as(owner)),
      ],
      ["refresh", await owner.agent.post(`${API}/businesses/${biz}/refresh`).set(as(owner))],
      ["import upload", await uploadCsv(owner, csvBuffer(["Name", "Grace Import (Sample)"]))],
      [
        "checkout",
        await owner.agent
          .post(`${API}/billing/checkout/credits`)
          .set(as(owner))
          .set("Idempotency-Key", randomUUID())
          .send({ packId: pack.id }),
      ],
      ["resume", await owner.agent.post(`${API}/billing/subscription/resume`).set(as(owner))],
      [
        "invitation",
        await owner.agent
          .post(`${API}/organizations/current/invitations`)
          .set(as(owner))
          .send({ email: "late-invitee@example.test", role: "analyst" }),
      ],
    ];
    for (const [label, res] of refused) {
      expect(res.status, label).toBe(409);
      expect(res.body.error.code).toBe("ORGANIZATION_PENDING_DELETION");
      expect(res.body.error.details).toEqual([{ path: "purgeAfter", message: purgeAfter }]);
    }
    // The permission is checked first: a sales rep's discovery request is still 403.
    const rep = await addMember(h, owner.orgId, "sales_rep");
    expect((await createJob(rep.agent, owner.orgId, spec())).status).toBe(403);

    // Reads, exports, CRM edits and settings keep working.
    await owner.agent.get(`${API}/businesses`).set(as(owner)).expect(200);
    const list = (
      await owner.agent.post(`${API}/lists`).set(as(owner)).send({ name: "Grace list" }).expect(201)
    ).body.data as Json;
    await owner.agent
      .post(`${API}/lists/${list.id}/items`)
      .set(as(owner))
      .send({ businessIds: [biz] })
      .expect(200);
    await owner.agent
      .post(`${API}/activities`)
      .set(as(owner))
      .send({ businessId: biz, type: "note", body: "Still working" })
      .expect(201);
    await owner.agent
      .post(`${API}/exports`)
      .set(as(owner))
      .send({ kind: "list", listId: list.id })
      .expect(202);
    await owner.agent
      .patch(`${API}/organizations/current`)
      .set(as(owner))
      .send({ freshnessDays: 200 })
      .expect(200);
  });

  it("refuses to accept an invitation into an organization scheduled for deletion", async () => {
    const org = await h.prisma.organization.findUniqueOrThrow({ where: { id: owner.orgId } });
    // An invitation sent before the request.
    await h.prisma.organization.update({
      where: { id: owner.orgId },
      data: { deletionRequestedAt: null },
    });
    await h.redis.del(`lf:org:lifecycle:${owner.orgId}`);
    await owner.agent
      .post(`${API}/organizations/current/invitations`)
      .set(as(owner))
      .send({ email: "early-invitee@example.test", role: "analyst" })
      .expect(201);
    await h.prisma.organization.update({
      where: { id: owner.orgId },
      data: { deletionRequestedAt: org.deletionRequestedAt },
    });
    await h.redis.del(`lf:org:lifecycle:${owner.orgId}`);
    const token = await h.tokenFromMail("early-invitee@example.test", "/invite/");
    const invitee = await createOwner(h, "early-invitee@example.test", "Invitee Org");
    const res = await invitee.agent
      .post(`${API}/invitations/${encodeURIComponent(token)}/accept`)
      .set(CSRF_HEADER, csrfFrom(invitee.agent))
      .expect(409);
    expect(res.body.error.code).toBe("ORGANIZATION_PENDING_DELETION");
    expect(
      await h.prisma.membership.count({
        where: { organizationId: owner.orgId, userId: invitee.userId },
      }),
    ).toBe(0);
  });

  it("lets only an owner cancel, any time before the purge; cancelling twice is harmless", async () => {
    expect((await cancelDeletion(admin)).status).toBe(403);
    await cancelDeletion(owner).expect(204);
    const profile = (
      await researcher.agent.get(`${API}/organizations/current`).set(as(researcher)).expect(200)
    ).body.data as Json;
    expect(profile).toMatchObject({ deletionRequestedAt: null, purgeAfter: null });
    const adminNotes = (await admin.agent.get(`${API}/notifications`).set(as(admin)).expect(200))
      .body.data as Json[];
    expect(adminNotes.map((n) => n.type)).toContain("organization.deletion_cancelled");
    expect(
      (await mailsTo("lifecycle-admin@example.test")).some((m) => /was cancelled/.test(m.subject)),
    ).toBe(true);
    expect(await auditCount(owner.orgId, "org.deletion_cancelled")).toBe(1);
    await cancelDeletion(owner).expect(204);
    expect(await auditCount(owner.orgId, "org.deletion_cancelled")).toBe(1);
    // Work starts again at once (the cached state was dropped).
    const job = await createJob(
      owner.agent,
      owner.orgId,
      spec({ name: "After cancel", maxRecords: 5 }),
    );
    expect(job.status).not.toBe(409);
  });

  it("sends one reminder about 3 days before, and queues the purge once the grace period is over", async () => {
    const other = await createOwner(h, "scan-owner@example.test", "Scan Org");
    await requestDeletion(other, { confirmName: "Scan Org", password: PASSWORD }).expect(202);
    const lifecycle = h.app.get(OrganizationLifecycleService, { strict: false });
    const now = new Date();
    await h.prisma.organization.update({
      where: { id: other.orgId },
      data: { purgeAfter: new Date(now.getTime() + 2 * DAY) },
    });
    expect((await lifecycle.scan(now)).reminders).toBe(1);
    expect((await lifecycle.scan(now)).reminders).toBe(0);
    expect(
      (await mailsTo("scan-owner@example.test")).filter((m) => /^Reminder:/.test(m.subject)),
    ).toHaveLength(1);

    await h.prisma.organization.update({
      where: { id: other.orgId },
      data: { purgeAfter: new Date(now.getTime() - 60_000) },
    });
    const scan = await lifecycle.scan(now);
    expect(scan.purgesQueued).toBeGreaterThanOrEqual(1);
    const q = new Queue(QueueNames.maintenance, {
      connection: new Redis(process.env.REDIS_URL!, { maxRetriesPerRequest: null }),
      prefix: TEST_QUEUE_PREFIX,
    });
    try {
      const queued = await q.getJob(`purge-org-${other.orgId}`);
      expect(queued?.name).toBe("purge-organization");
      expect(queued?.data).toEqual({ organizationId: other.orgId });
      await queued?.remove();
    } finally {
      await q.close();
    }
  });
});

describe("organization data export", () => {
  let exportId: string;

  it("is owner only and one at a time; an Idempotency-Key replays the same export", async () => {
    expect(
      (await admin.agent.post(`${API}/organizations/current/data-exports`).set(as(admin))).status,
    ).toBe(403);
    expect(
      (await admin.agent.get(`${API}/organizations/current/data-exports`).set(as(admin))).status,
    ).toBe(403);
    const key = `org-export-${randomUUID()}`;
    const first = await owner.agent
      .post(`${API}/organizations/current/data-exports`)
      .set(as(owner))
      .set("Idempotency-Key", key)
      .expect(202);
    exportId = first.body.data.id as string;
    expect(first.body.data).toMatchObject({
      status: "queued",
      progress: { completedSections: 0, totalSections: 16, currentSection: null },
      file: null,
    });
    const replay = await owner.agent
      .post(`${API}/organizations/current/data-exports`)
      .set(as(owner))
      .set("Idempotency-Key", key)
      .expect(200);
    expect(replay.body.data.id).toBe(exportId);
    const second = await owner.agent
      .post(`${API}/organizations/current/data-exports`)
      .set(as(owner))
      .expect(409);
    expect(second.body.error.code).toBe("CONFLICT");
    expect(second.body.error.details).toEqual([{ path: "activeExportId", message: exportId }]);
    const notReady = await owner.agent
      .get(`${API}/organizations/current/data-exports/${exportId}/download-url`)
      .set(as(owner))
      .expect(409);
    expect(notReady.body.error.code).toBe("EXPORT_NOT_READY");
  });

  it("builds a ZIP of the organization's own data: JSON and formula-safe CSV, attribution, no expired values, no card data", async () => {
    // A value past its source retention: hidden on reads, so never exported.
    const [expiredBiz] = await seedBusinesses(h, owner.orgId, [
      {
        name: "Retention Test Shop (Sample)",
        phones: ["0803 555 0199"],
        emails: ["expired@retention.example.test"],
      },
    ]);
    const mongo = h.app.get(MongoService).database;
    const past = new Date(Date.now() - DAY);
    await mongo
      .collection(Collections.businesses)
      .updateOne(
        { organizationId: owner.orgId, _id: new ObjectId(expiredBiz!) },
        { $set: { "phones.$[].expiresAt": past, "emails.$[].expiresAt": past } },
      );
    await mongo
      .collection(Collections.sourceObservations)
      .updateMany(
        { organizationId: owner.orgId, businessId: new ObjectId(expiredBiz!) },
        { $set: { policy: { retainValueUntil: past } } },
      );
    // A note that would run as a formula in a spreadsheet.
    await owner.agent
      .post(`${API}/activities`)
      .set(as(owner))
      .send({ businessId: expiredBiz, type: "note", body: '=HYPERLINK("http://evil.example","x")' })
      .expect(201);

    const worker = orgExportWorker();
    let done: Json;
    try {
      done = await pollUntil(
        owner,
        `/organizations/current/data-exports/${exportId}`,
        (d) => ["completed", "failed"].includes(String(d.status)),
        60_000,
      );
    } finally {
      await worker.close();
    }
    expect(worker.failures).toEqual([]);
    expect(done.status).toBe("completed");
    expect(done.file).toMatchObject({ available: true });
    expect(done.sections.map((s: Json) => s.key)).toEqual([
      "organization",
      "members",
      "businesses",
      "observations",
      "lists",
      "list_items",
      "leads",
      "activities",
      "outreach",
      "imports",
      "jobs",
      "credit_ledger",
      "invoices",
      "payments",
      "usage",
      "audit_events",
    ]);
    const notes = (await owner.agent.get(`${API}/notifications`).set(as(owner)).expect(200)).body
      .data as Json[];
    expect(notes.map((n) => n.type)).toContain("organization.export_completed");

    const link = (
      await owner.agent
        .get(`${API}/organizations/current/data-exports/${exportId}/download-url`)
        .set(as(owner))
        .expect(200)
    ).body.data as Json;
    expect(link.url).toContain(
      `/api/v1/organizations/current/data-exports/${exportId}/download?org=${owner.orgId}`,
    );
    const file = await download(owner.agent, link.url);
    expect(file.status).toBe(200);
    expect(file.headers["content-type"]).toContain("application/zip");
    const zip = readZip(file.body);
    for (const name of [
      "README.txt",
      "ATTRIBUTION.txt",
      "organization.json",
      "members.json",
      "members.csv",
      "businesses.json",
      "businesses.csv",
      "observations.json",
      "observations.csv",
      "verification_events.json",
      "lists.json",
      "lists.csv",
      "list_items.csv",
      "leads.json",
      "activities.json",
      "activities.csv",
      "outreach.json",
      "imports.json",
      "jobs.json",
      "jobs.csv",
      "credit_ledger.json",
      "credit_ledger.csv",
      "invoices.json",
      "payments.json",
      "usage.json",
      "audit_events.json",
      "audit_events.csv",
    ]) {
      expect(zip.has(name), name).toBe(true);
    }
    const all = [...zip.values()].map((b) => b.toString("utf8")).join("\n");
    const org = JSON.parse(zip.get("organization.json")!.toString("utf8")) as Json;
    expect(org).toMatchObject({ id: owner.orgId, name: "Lifecycle Org" });
    const members = JSON.parse(zip.get("members.json")!.toString("utf8")) as Json[];
    expect(members.map((m) => m.email).sort()).toEqual(
      expect.arrayContaining([
        "lifecycle-admin@example.test",
        "lifecycle-owner@example.test",
        "lifecycle-researcher@example.test",
      ]),
    );
    const businesses = JSON.parse(zip.get("businesses.json")!.toString("utf8")) as Json[];
    const shop = businesses.find((b) => b.name?.value === "Retention Test Shop (Sample)")!;
    // The phone and email are still stored (the purge job has not run) but shown as expired, without values.
    expect(shop.phones).toEqual([
      expect.objectContaining({ state: "expired", value: null, e164: null }),
    ]);
    expect(shop.emails).toEqual([expect.objectContaining({ state: "expired", value: null })]);
    expect(all).toContain("grace.example.test"); // positive control: live values are exported
    // Expired values are left out everywhere (JSON, CSV, provenance).
    expect(all).not.toContain("+2348035550199");
    expect(all).not.toContain("expired@retention.example.test");
    // Formula-safe CSV.
    const activities = parseCsv(
      zip
        .get("activities.csv")!
        .toString("utf8")
        .replace(/^\uFEFF/, ""),
    );
    const bodyCol = activities[0]!.indexOf("body");
    expect(
      activities.slice(1).some((row) => row[bodyCol] === '\'=HYPERLINK("http://evil.example","x")'),
    ).toBe(true);
    // No card data, no network identifiers of members, no internal keys.
    expect(all).not.toMatch(/authorizationMasked|authorization_masked|"last4"|accessCode/);
    const audit = JSON.parse(zip.get("audit_events.json")!.toString("utf8")) as Json[];
    expect(audit.length).toBeGreaterThan(0);
    for (const e of audit) {
      expect(e).not.toHaveProperty("ip");
      expect(e).not.toHaveProperty("userAgent");
    }
    expect(zip.get("README.txt")!.toString("utf8")).toContain(
      "Values whose source retention period has ended are left out",
    );
    expect(await auditCount(owner.orgId, "org.data_export_downloaded")).toBe(1);
  });

  it("binds links to the owner, redirects failed browser downloads to Settings, and expires files after 7 days", async () => {
    const link = (
      await owner.agent
        .get(`${API}/organizations/current/data-exports/${exportId}/download-url`)
        .set(as(owner))
        .expect(200)
    ).body.data as Json;
    // Another member of the same organization cannot use the owner's link.
    const asAdmin = await download(admin.agent, link.url);
    expect(asAdmin.status).toBe(403);
    expect(asAdmin.json?.error?.code).toBe("DOWNLOAD_LINK_INVALID");
    const opened = await navigate(admin.agent, link.url);
    expect(opened.status).toBe(303);
    expect(opened.headers.location).toBe(
      "http://localhost:3000/app/settings?tab=organization&downloadError=DOWNLOAD_LINK_INVALID",
    );
    const signedOut = await navigate(h.agent(), link.url);
    expect(signedOut.status).toBe(303);
    expect(signedOut.headers.location).toBe(
      "http://localhost:3000/sign-in?next=%2Fapp%2Fsettings%3Ftab%3Dorganization",
    );

    // A demoted owner loses access to the export.
    const second = await addMember(h, owner.orgId, "owner", "second-owner@example.test");
    const secondOwner = { agent: second.agent, orgId: owner.orgId, userId: second.userId };
    const secondLink = (
      await second.agent
        .get(`${API}/organizations/current/data-exports/${exportId}/download-url`)
        .set(as(secondOwner))
        .expect(200)
    ).body.data as Json;
    await h.prisma.membership.update({
      where: { organizationId_userId: { organizationId: owner.orgId, userId: second.userId } },
      data: { role: "admin" },
    });
    await h.redis.del(`lf:member:${second.userId}:${owner.orgId}`);
    const demoted = await download(second.agent, secondLink.url);
    expect(demoted.status).toBe(403);
    expect(demoted.json?.error?.code).toBe("FORBIDDEN");

    // Retention: the maintenance cleanup deletes the file and the export becomes expired.
    const mongo = h.app.get(MongoService).database;
    const doc = await mongo
      .collection(Collections.organizationDataExports)
      .findOne({ organizationId: owner.orgId, status: "completed" });
    const key = (doc!.file as { key: string }).key;
    await mongo
      .collection(Collections.organizationDataExports)
      .updateOne({ _id: doc!._id }, { $set: { "file.expiresAt": new Date(Date.now() - 1000) } });
    expect(await h.app.get(OrganizationExportBuilder, { strict: false }).cleanup()).toMatchObject({
      expired: 1,
    });
    expect(await h.app.get<ObjectStorage>(OBJECT_STORAGE, { strict: false }).get(key)).toBeNull();
    const view = (
      await owner.agent
        .get(`${API}/organizations/current/data-exports/${exportId}`)
        .set(as(owner))
        .expect(200)
    ).body.data as Json;
    expect(view.status).toBe("expired");
    expect(view.file.available).toBe(false);
    const gone = await owner.agent
      .get(`${API}/organizations/current/data-exports/${exportId}/download-url`)
      .set(as(owner))
      .expect(410);
    expect(gone.body.error.code).toBe("EXPORT_EXPIRED");
    const list = (
      await owner.agent.get(`${API}/organizations/current/data-exports`).set(as(owner)).expect(200)
    ).body.data as Json[];
    expect(list[0]!.id).toBe(exportId);
  });
});
