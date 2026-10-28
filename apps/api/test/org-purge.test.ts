import { randomUUID } from "node:crypto";
import { Queue, Worker, type Job } from "bullmq";
import { Redis } from "ioredis";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  Collections,
  EJSON,
  MongoService,
  ObjectId,
  organizationPurgePlan,
} from "@leadforge/db-mongo";
import { CSRF_HEADER, ORGANIZATION_HEADER } from "@leadforge/contracts";
import { newId } from "@leadforge/db-postgres";
import {
  erasedEmail,
  erasureReceiptKey,
  ExportQueueHandler,
  OBJECT_STORAGE,
  OrganizationDataRepository,
  OrganizationErasureRepository,
  OrganizationExportQueueHandler,
  OrganizationLifecycleService,
  OrganizationPurgeService,
  PaymentSettlementService,
  PURGE_STEPS,
  QueueNames,
  type ObjectStorage,
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
import { forgetOverture, seedOverture } from "./overture-helpers.js";
import { download, isTerminal, pollUntil } from "./phase5-helpers.js";
import {
  billingEnv,
  startFakePaystack,
  transactionData,
  type FakePaystack,
} from "./paystack-fake.js";
import { createPack, createPlan } from "./billing-helpers.js";

/**
 * Stage 10: the organization purge, end to end. Two organizations and a user who belongs to both
 * (plus a personal organization). Organization A is purged after its grace period; the test proves
 * that every MongoDB document of A is gone (except the audit log), files are deleted (invoice PDFs
 * kept), PostgreSQL membership data is deleted, A's sole members are anonymized and signed out,
 * billing records remain, Paystack renewal is disabled, B, the shared user and the platform
 * catalogue are byte-for-byte untouched, a re-run is a no-op, a re-application after a restore
 * removes restored data again, and a purge that crashes mid-way resumes after its last step.
 */

const PASSWORD = "Str0ng-Passw0rd-Example!";

let h: Harness;
let fake: FakePaystack;
let A: OrgUser;
let Aadmin: OrgUser;
let shared: OrgUser;
let B: OrgUser;
let exportKey: string;
let orgExportKey: string;
let invoicePdfKey: string;

const db = () => h.app.get(MongoService).database;
const storage = () => h.app.get<ObjectStorage>(OBJECT_STORAGE, { strict: false });
const purge = () => h.app.get(OrganizationPurgeService, { strict: false });
const ser = (v: unknown) =>
  JSON.stringify(v, (_k, x) => (typeof x === "bigint" ? x.toString() : x));

/** Every MongoDB document and PostgreSQL row that belongs to an organization (the route-isolation technique). */
async function snapshot(organizationId: string): Promise<string> {
  const parts: string[] = [];
  const names = (await db().listCollections({}, { nameOnly: true }).toArray())
    .map((c) => c.name)
    .sort();
  for (const name of names) {
    const docs = await db().collection(name).find({ organizationId }).sort({ _id: 1 }).toArray();
    if (docs.length) parts.push(`${name}:${EJSON.stringify(docs, { relaxed: false })}`);
  }
  const customer = await h.prisma.billingCustomer.findUnique({
    where: { organizationId },
    include: {
      ledger: true,
      payments: { include: { refunds: true } },
      invoices: true,
      entitlements: true,
      subscriptions: true,
      audit: true,
    },
  });
  const org = await h.prisma.organization.findUnique({
    where: { id: organizationId },
    include: {
      memberships: { include: { user: true } },
      invitations: true,
      notificationPreferences: true,
      usageDaily: true,
    },
  });
  parts.push(ser({ customer, org }));
  return parts.join("\n");
}

/** Platform-level documents no purge may touch: the Overture catalogue, sync runs, global suppression and source switches. */
async function globalSnapshot(): Promise<string> {
  const parts: string[] = [];
  for (const name of [Collections.overturePlaces, Collections.overtureSyncRuns]) {
    parts.push(
      `${name}:${EJSON.stringify(await db().collection(name).find({}).sort({ _id: 1 }).toArray(), { relaxed: false })}`,
    );
  }
  for (const name of [Collections.suppressionEntries, Collections.sourceConfigs]) {
    parts.push(
      `${name}:${EJSON.stringify(await db().collection(name).find({ organizationId: null }).sort({ _id: 1 }).toArray(), { relaxed: false })}`,
    );
  }
  return parts.join("\n");
}

/** Billing records that must survive the purge unchanged. */
async function billingRecords(organizationId: string): Promise<string> {
  const customer = await h.prisma.billingCustomer.findUniqueOrThrow({ where: { organizationId } });
  const where = { billingCustomerId: customer.id };
  return ser({
    payments: await h.prisma.payment.findMany({
      where,
      orderBy: { id: "asc" },
      include: { refunds: true },
    }),
    invoices: await h.prisma.invoice.findMany({ where, orderBy: { id: "asc" } }),
    ledger: await h.prisma.creditLedger.findMany({ where, orderBy: { id: "asc" } }),
  });
}

async function requestAndExpire(u: OrgUser, name: string): Promise<void> {
  await u.agent
    .post(`${API}/organizations/current/deletion-requests`)
    .set(orgHeaders(u.agent, u.orgId))
    .send({ confirmName: name, password: PASSWORD })
    .expect(202);
  // The grace period is simulated: the purge date moves into the past.
  await h.prisma.organization.update({
    where: { id: u.orgId },
    data: { purgeAfter: new Date(Date.now() - 60_000) },
  });
}

/** A user whose only membership is in `organizationId` (addMember also gives each user a personal organization). */
async function soleMember(
  organizationId: string,
  role: "admin" | "researcher",
  email: string,
): Promise<OrgUser> {
  const m = await addMember(h, organizationId, role, email);
  const personal = await h.prisma.membership.findMany({
    where: { userId: m.userId, organizationId: { not: organizationId } },
  });
  await h.prisma.membership.deleteMany({ where: { id: { in: personal.map((p) => p.id) } } });
  return { agent: m.agent, orgId: organizationId, userId: m.userId };
}

function exportWorker(): { close(): Promise<void> } {
  const org = h.app.get(OrganizationExportQueueHandler, { strict: false });
  const exp = h.app.get(ExportQueueHandler, { strict: false });
  const w = new Worker(
    QueueNames.exports,
    (job: Job) => (job.name === "build-organization-export" ? org.handle(job) : exp.handle(job)),
    {
      connection: new Redis(process.env.REDIS_URL!, { maxRetriesPerRequest: null }),
      prefix: TEST_QUEUE_PREFIX,
    },
  );
  return { close: () => w.close() };
}

async function queuedJobsOf(organizationId: string): Promise<string[]> {
  const q = new Queue(QueueNames.discovery, {
    connection: new Redis(process.env.REDIS_URL!, { maxRetriesPerRequest: null }),
    prefix: TEST_QUEUE_PREFIX,
  });
  try {
    const jobs = await q.getJobs(["waiting", "delayed", "prioritized", "paused"]);
    return jobs
      .filter((j) => (j.data as { organizationId?: string }).organizationId === organizationId)
      .map((j) => j.id!);
  } finally {
    await q.close();
  }
}

beforeAll(async () => {
  fake = await startFakePaystack();
  h = await createHarness({ ...DISCOVERY_TEST_ENV, ...billingEnv(fake) });
  await h.resetState();
  forgetOverture(h);
  await seedOverture(h);
  // Platform-level documents with a null organization: never purged.
  await db()
    .collection(Collections.suppressionEntries)
    .insertOne({
      organizationId: null,
      kind: "domain",
      value: "global-optout.example.test",
      reason: "Platform do-not-collect",
      createdByUserId: null,
      createdAt: new Date(),
    });

  A = await createOwner(h, "purge-owner@example.test", "Purge Victim Org");
  Aadmin = await soleMember(A.orgId, "admin", "purge-admin@example.test");
  B = await createOwner(h, "bystander-owner@example.test", "Bystander Org");
  // The shared user: a researcher in A, an admin in B, and their own personal organization.
  const s = await addMember(h, A.orgId, "researcher", "shared-user@example.test");
  shared = { agent: s.agent, orgId: A.orgId, userId: s.userId };
  await h.prisma.membership.create({
    data: { id: newId(), organizationId: B.orgId, userId: s.userId, role: "admin" },
  });
  await grant(h, A.orgId, 50);
  await grant(h, B.orgId, 50);

  for (const u of [A, B]) {
    const hdr = () => orgHeaders(u.agent, u.orgId);
    const tag = u === A ? "Purgemark" : "Keepmark";
    const [biz] = await seedBusinesses(h, u.orgId, [
      {
        name: `${tag} Bakery (Sample)`,
        website: `${tag.toLowerCase()}.example.test`,
        emails: [`hello@${tag.toLowerCase()}.example.test`],
        phones: ["0803 555 0101"],
      },
      { name: `${tag} Bakery Ikeja (Sample)` },
    ]);
    const list = (
      await u.agent
        .post(`${API}/lists`)
        .set(hdr())
        .send({ name: `${tag} prospects` })
        .expect(201)
    ).body.data as Json;
    await u.agent
      .post(`${API}/lists/${list.id}/items`)
      .set(hdr())
      .send({ businessIds: [biz] })
      .expect(200);
    await u.agent.post(`${API}/pipeline/leads`).set(hdr()).send({ businessId: biz }).expect(201);
    await u.agent
      .post(`${API}/activities`)
      .set(hdr())
      .send({ businessId: biz, type: "note", body: `${tag} private note` })
      .expect(201);
    await u.agent
      .post(`${API}/outreach`)
      .set(hdr())
      .send({ businessId: biz, channel: "call" })
      .expect(201);
    await u.agent
      .post(`${API}/businesses/${biz}/suppress`)
      .set(hdr())
      .send({ scope: "business", reason: `${tag} asked us to stop` })
      .expect(200);
    await u.agent
      .patch(`${API}/sources/overture_places`)
      .set(hdr())
      .send({ enabled: true })
      .expect(200);
    await uploadCsv(u, csvBuffer(["Name", `${tag} Imported (Sample)`])).expect(201);
    await u.agent
      .put(`${API}/notifications/preferences`)
      .set(hdr())
      .send({ emailJobEvents: false })
      .expect(200);
    await createJob(u.agent, u.orgId, spec({ name: `${tag} discovery`, maxRecords: 5 })).expect(
      201,
    );
    const exp = (
      await u.agent
        .post(`${API}/exports`)
        .set(hdr())
        .send({ kind: "list", listId: list.id })
        .expect(202)
    ).body.data as Json;
    const w = exportWorker();
    try {
      await pollUntil(u, `/exports/${exp.id}`, isTerminal);
      if (u === A) {
        const orgExport = (
          await u.agent.post(`${API}/organizations/current/data-exports`).set(hdr()).expect(202)
        ).body.data as Json;
        await pollUntil(u, `/organizations/current/data-exports/${orgExport.id}`, isTerminal);
      }
    } finally {
      await w.close();
    }
    await h.prisma.usageDaily.create({
      data: {
        id: newId(),
        organizationId: u.orgId,
        day: new Date("2026-10-20T00:00:00Z"),
        metric: "credits_used",
        value: 7n,
      },
    });
  }
  await A.agent
    .post(`${API}/organizations/current/invitations`)
    .set(orgHeaders(A.agent, A.orgId))
    .send({ email: "purge-invitee@example.test", role: "analyst" })
    .expect(201);
  exportKey = (
    (await db().collection(Collections.exportJobs).findOne({ organizationId: A.orgId }))!.file as {
      key: string;
    }
  ).key;
  orgExportKey = (
    (await db()
      .collection(Collections.organizationDataExports)
      .findOne({ organizationId: A.orgId }))!.file as { key: string }
  ).key;

  // A pays (a payment, an invoice and its PDF, a ledger purchase) and has a live subscription at Paystack.
  const pack = await createPack(h, { credits: 50, priceMinor: 150_000 });
  const checkout = (
    await A.agent
      .post(`${API}/billing/checkout/credits`)
      .set(orgHeaders(A.agent, A.orgId))
      .set("Idempotency-Key", randomUUID())
      .send({ packId: pack.id })
      .expect(201)
  ).body.data as Json;
  fake.transactions.set(
    checkout.reference,
    transactionData({ reference: checkout.reference, amount: 150_000 }),
  );
  expect(
    await h.app
      .get(PaymentSettlementService, { strict: false })
      .verifyAndSettle(checkout.paymentId, { trigger: "webhook" }),
  ).toBe("granted");
  const invoice = await h.prisma.invoice.findFirstOrThrow({
    where: { billingCustomer: { organizationId: A.orgId } },
  });
  const pdfLink = (
    await A.agent
      .get(`${API}/billing/invoices/${invoice.id}/download-url`)
      .set(orgHeaders(A.agent, A.orgId))
      .expect(200)
  ).body.data.url as string;
  expect((await download(A.agent, pdfLink)).status).toBe(200);
  invoicePdfKey = (await h.prisma.invoice.findUniqueOrThrow({ where: { id: invoice.id } })).pdfKey!;
  const plan = await createPlan(h, { priceMinor: 500_000, providerPlanCode: "PLN_purge" });
  const customer = await h.prisma.billingCustomer.findUniqueOrThrow({
    where: { organizationId: A.orgId },
  });
  await h.prisma.subscription.create({
    data: {
      id: newId(),
      billingCustomerId: customer.id,
      planId: plan.id,
      status: "active",
      providerSubscriptionCode: "SUB_purge_victim",
      providerEmailToken: "tok_purge_victim",
      currentPeriodStart: new Date(),
      currentPeriodEnd: new Date(Date.now() + 20 * 24 * 60 * 60 * 1000),
    },
  });
}, 300_000);

afterAll(async () => {
  await h?.close();
  await fake?.close();
});

describe("organization purge", () => {
  let bBefore: string;
  let globalBefore: string;
  let billingBefore: string;
  let sharedBefore: string;

  it("covers every collection holding organization documents (schema registry, checked against the live database)", async () => {
    const plan = organizationPurgePlan();
    const covered = new Set([...plan.delete, ...plan.retain.map((r) => r.collection)]);
    const names = (await db().listCollections({}, { nameOnly: true }).toArray()).map((c) => c.name);
    const holding: string[] = [];
    for (const name of names) {
      if (
        (await db()
          .collection(name)
          .countDocuments({ organizationId: { $exists: true } }, { limit: 1 })) > 0
      )
        holding.push(name);
    }
    expect(holding.length).toBeGreaterThanOrEqual(15);
    expect(
      holding.filter((n) => !covered.has(n)),
      "a collection with organizationId documents is missing from the purge plan",
    ).toEqual([]);
    // A holds data in (almost) every scoped collection, so the purge below is a real test.
    const ofA = await h.app
      .get(OrganizationDataRepository, { strict: false })
      .countEverywhere(A.orgId);
    expect(Object.keys(ofA).length, JSON.stringify(ofA)).toBeGreaterThanOrEqual(15);
  });

  it("purges A after its grace period through the scan and the maintenance job", async () => {
    bBefore = await snapshot(B.orgId);
    globalBefore = await globalSnapshot();
    billingBefore = await billingRecords(A.orgId);
    sharedBefore = ser(await h.prisma.user.findUniqueOrThrow({ where: { id: shared.userId } }));
    expect(await queuedJobsOf(A.orgId)).not.toEqual([]);
    const bJobs = await queuedJobsOf(B.orgId);
    expect(bJobs).not.toEqual([]);

    await requestAndExpire(A, "Purge Victim Org");
    expect(
      (await h.app.get(OrganizationLifecycleService, { strict: false }).scan()).purgesQueued,
    ).toBe(1);
    const failures: string[] = [];
    const w = new Worker(
      QueueNames.maintenance,
      (job: Job) =>
        job.name === "purge-organization" ? purge().handle(job) : Promise.resolve(null),
      {
        connection: new Redis(process.env.REDIS_URL!, { maxRetriesPerRequest: null }),
        prefix: TEST_QUEUE_PREFIX,
      },
    );
    w.on("failed", (job, err) => failures.push(`${job?.name}: ${err?.message}`));
    try {
      const deadline = Date.now() + 60_000;
      for (;;) {
        const record = await h.prisma.organizationErasure.findUnique({
          where: { organizationId: A.orgId },
        });
        if (record?.completedAt) break;
        if (Date.now() > deadline)
          throw new Error(`Purge did not finish: ${ser(record)} ${failures.join("; ")}`);
        await new Promise((r) => setTimeout(r, 200));
      }
    } finally {
      await w.close();
    }
    expect(failures).toEqual([]);

    const record = await h.prisma.organizationErasure.findUniqueOrThrow({
      where: { organizationId: A.orgId },
    });
    expect(Object.keys(record.steps as object).sort()).toEqual([...PURGE_STEPS].sort());
    expect(record).toMatchObject({ trigger: "schedule", attempts: 1, lastError: null });
    // B's waiting discovery jobs are untouched; A's were removed.
    expect(await queuedJobsOf(A.orgId)).toEqual([]);
    expect(await queuedJobsOf(B.orgId)).toEqual(bJobs);
  });

  it("deleted every MongoDB document of A except the audit log, and the export files (invoice PDFs kept)", async () => {
    const left = await h.app
      .get(OrganizationDataRepository, { strict: false })
      .countEverywhere(A.orgId);
    expect(Object.keys(left)).toEqual([Collections.auditEvents]);
    const actions = await db()
      .collection(Collections.auditEvents)
      .distinct("action", { organizationId: A.orgId });
    expect(actions).toEqual(
      expect.arrayContaining(["org.deletion_requested", "org.purge_started", "org.purged"]),
    );
    expect(await storage().get(exportKey)).toBeNull();
    expect(await storage().get(orgExportKey)).toBeNull();
    const pdf = await storage().get(invoicePdfKey);
    expect(pdf).not.toBeNull();
    pdf?.stream.destroy();
    // The erasure receipt lives outside both databases.
    const receipt = await storage().get(erasureReceiptKey(A.orgId));
    const chunks: Buffer[] = [];
    for await (const c of receipt!.stream) chunks.push(c as Buffer);
    const parsed = JSON.parse(Buffer.concat(chunks).toString("utf8")) as Json;
    expect(parsed).toMatchObject({
      kind: "organization_erasure",
      organizationId: A.orgId,
      trigger: "schedule",
    });
    expect(JSON.stringify(parsed)).not.toContain("purge-owner@example.test");
  });

  it("deleted A's memberships and settings, anonymized its sole members, and kept billing records", async () => {
    const org = await h.prisma.organization.findUniqueOrThrow({ where: { id: A.orgId } });
    expect(org.purgedAt).not.toBeNull();
    expect(org.deletedAt).not.toBeNull();
    expect(org.name).toBe(`Deleted organization ${A.orgId.slice(0, 8)}`);
    expect(org.slug).toBe(`deleted-${A.orgId}`);
    for (const count of [
      await h.prisma.membership.count({ where: { organizationId: A.orgId } }),
      await h.prisma.invitation.count({ where: { organizationId: A.orgId } }),
      await h.prisma.notificationPreference.count({ where: { organizationId: A.orgId } }),
      await h.prisma.usageDaily.count({ where: { organizationId: A.orgId } }),
    ]) {
      expect(count).toBe(0);
    }
    for (const u of [A, Aadmin]) {
      const user = await h.prisma.user.findUniqueOrThrow({ where: { id: u.userId } });
      expect(user).toMatchObject({
        email: erasedEmail(u.userId),
        name: "",
        passwordHash: "",
        emailVerifiedAt: null,
      });
      expect(user.deletedAt).not.toBeNull();
      expect(await h.prisma.session.count({ where: { userId: u.userId, revokedAt: null } })).toBe(
        0,
      );
      expect(await h.prisma.emailToken.count({ where: { userId: u.userId } })).toBe(0);
      // Signed out at once (the session is revoked in Redis too) and cannot sign in again.
      expect((await u.agent.get(`${API}/auth/me`)).status).toBe(401);
    }
    const login = await h
      .agent()
      .post(`${API}/auth/login`)
      .send({ email: "purge-owner@example.test", password: PASSWORD });
    expect(login.status).toBe(401);
    expect(login.body.error.code).toBe("INVALID_CREDENTIALS");

    expect(await billingRecords(A.orgId)).toBe(billingBefore);
    const customer = await h.prisma.billingCustomer.findUniqueOrThrow({
      where: { organizationId: A.orgId },
      include: { subscriptions: true, audit: true },
    });
    expect(customer.email).toBe(erasedEmail(A.orgId));
    expect(customer.subscriptions.map((s) => s.status)).toEqual(["cancelled"]);
    expect(customer.audit.map((a) => a.action)).toContain("subscription.cancelled");
    expect(
      fake.requests.filter((r) => r.path === "/subscription/disable").map((r) => r.body?.code),
    ).toEqual(["SUB_purge_victim"]);
  });

  it("left B, the shared user and the platform catalogue byte-for-byte unchanged", async () => {
    expect(await snapshot(B.orgId)).toBe(bBefore);
    expect(await globalSnapshot()).toBe(globalBefore);
    expect(ser(await h.prisma.user.findUniqueOrThrow({ where: { id: shared.userId } }))).toBe(
      sharedBefore,
    );
    expect(await h.prisma.membership.count({ where: { userId: shared.userId } })).toBe(2);
    const inB = await shared.agent
      .get(`${API}/organizations/current`)
      .set(ORGANIZATION_HEADER, B.orgId);
    expect(inB.status).toBe(200);
    const inA = await shared.agent
      .get(`${API}/organizations/current`)
      .set(ORGANIZATION_HEADER, A.orgId);
    expect(inA.status).toBe(403);
    expect(inA.body.error.code).toBe("ORG_FORBIDDEN");
    const me = (await shared.agent.get(`${API}/auth/me`).expect(200)).body.data as Json;
    expect(me.organizations.map((o: Json) => o.id)).not.toContain(A.orgId);
    expect(me.organizations.map((o: Json) => o.id)).toContain(B.orgId);
  });

  it("is a no-op when it runs again", async () => {
    const all = async () =>
      [
        await snapshot(A.orgId),
        await snapshot(B.orgId),
        await globalSnapshot(),
        ser(await h.prisma.user.findMany({ orderBy: { id: "asc" } })),
      ].join("\n#\n");
    const before = await all();
    const erasureBefore = ser(
      await h.prisma.organizationErasure.findUniqueOrThrow({ where: { organizationId: A.orgId } }),
    );
    expect(await purge().purge(A.orgId)).toEqual({
      status: "already_purged",
      organizationId: A.orgId,
    });
    expect(
      (await h.app.get(OrganizationLifecycleService, { strict: false }).scan()).purgesQueued,
    ).toBe(0);
    expect(
      await purge().handle({
        name: "purge-organization",
        data: { organizationId: B.orgId },
      } as unknown as Job),
    ).toEqual({ status: "not_due", organizationId: B.orgId });
    expect(await all()).toBe(before);
    expect(
      ser(
        await h.prisma.organizationErasure.findUniqueOrThrow({
          where: { organizationId: A.orgId },
        }),
      ),
    ).toBe(erasureBefore);
  });

  it("re-applies after a restore from an older backup", async () => {
    // A backup taken before the purge brought back a business and a membership of A.
    await db()
      .collection(Collections.businesses)
      .insertOne({
        ...(await db().collection(Collections.businesses).findOne({ organizationId: B.orgId }))!,
        _id: new ObjectId(),
        organizationId: A.orgId,
        slug: "restored-row",
      });
    await h.prisma.membership.create({
      data: { id: newId(), organizationId: A.orgId, userId: shared.userId, role: "researcher" },
    });
    const outcome = await purge().purge(A.orgId, { trigger: "reapply" });
    expect(outcome).toMatchObject({ status: "purged", steps: [...PURGE_STEPS] });
    expect(
      Object.keys(
        await h.app.get(OrganizationDataRepository, { strict: false }).countEverywhere(A.orgId),
      ),
    ).toEqual([Collections.auditEvents]);
    expect(await h.prisma.membership.count({ where: { organizationId: A.orgId } })).toBe(0);
    // The shared user still belongs to B (and their personal organization), so they are kept.
    expect((await h.prisma.user.findUniqueOrThrow({ where: { id: shared.userId } })).email).toBe(
      "shared-user@example.test",
    );
    expect(await snapshot(B.orgId)).toBe(bBefore);
  });
});

describe("a purge that crashes mid-way", () => {
  it("records its finished steps, keeps the organization closed, and resumes after the last one", async () => {
    const C = await createOwner(h, "crash-owner@example.test", "Crash Org");
    const [biz] = await seedBusinesses(h, C.orgId, [{ name: "Crashmark Shop (Sample)" }]);
    await C.agent
      .post(`${API}/lists`)
      .set(orgHeaders(C.agent, C.orgId))
      .send({ name: "Crashmark list" })
      .expect(201);
    await C.agent
      .post(`${API}/activities`)
      .set(orgHeaders(C.agent, C.orgId))
      .send({ businessId: biz, type: "note", body: "Crashmark" })
      .expect(201);
    await requestAndExpire(C, "Crash Org");
    const bBefore = await snapshot(B.orgId);

    const erasures = h.app.get(OrganizationErasureRepository, { strict: false });
    const spy = vi
      .spyOn(erasures, "purgeOrganizationRows")
      .mockRejectedValueOnce(new Error("Simulated crash in the PostgreSQL step"));
    try {
      await expect(purge().purge(C.orgId)).rejects.toThrow("Simulated crash");
    } finally {
      spy.mockRestore();
    }
    const halfway = await h.prisma.organizationErasure.findUniqueOrThrow({
      where: { organizationId: C.orgId },
    });
    // (jsonb does not keep key order)
    expect(Object.keys(halfway.steps as object).sort()).toEqual([
      "mongo",
      "stop_work",
      "storage",
      "subscription",
    ]);
    expect(halfway.lastError).toContain("Simulated crash");
    expect(halfway.completedAt).toBeNull();
    expect(
      Object.keys(
        await h.app.get(OrganizationDataRepository, { strict: false }).countEverywhere(C.orgId),
      ),
    ).toEqual([Collections.auditEvents]);
    // PostgreSQL was not reached, but the organization is already closed to everyone.
    expect(await h.prisma.membership.count({ where: { organizationId: C.orgId } })).toBe(1);
    const closed = await C.agent
      .get(`${API}/organizations/current`)
      .set(orgHeaders(C.agent, C.orgId));
    expect(closed.status).toBe(403);
    expect(closed.body.error.code).toBe("ORG_FORBIDDEN");
    const cancel = await C.agent
      .delete(`${API}/organizations/current/deletion-requests`)
      .set(ORGANIZATION_HEADER, C.orgId)
      .set(CSRF_HEADER, csrfFrom(C.agent));
    expect(cancel.status).toBe(403);

    // The next attempt (the scan re-enqueues it) runs only the remaining steps.
    expect(await purge().purge(C.orgId)).toEqual({
      status: "purged",
      organizationId: C.orgId,
      steps: ["postgres", "finalize"],
    });
    const done = await h.prisma.organizationErasure.findUniqueOrThrow({
      where: { organizationId: C.orgId },
    });
    expect(done).toMatchObject({ attempts: 2, lastError: null });
    expect(Object.keys(done.steps as object).sort()).toEqual([...PURGE_STEPS].sort());
    expect(await h.prisma.membership.count({ where: { organizationId: C.orgId } })).toBe(0);
    expect((await h.prisma.user.findUniqueOrThrow({ where: { id: C.userId } })).email).toBe(
      erasedEmail(C.userId),
    );
    expect(await snapshot(B.orgId)).toBe(bBefore);
  });
});
