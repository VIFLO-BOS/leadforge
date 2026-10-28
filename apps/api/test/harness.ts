import type { INestApplication } from "@nestjs/common";
import { Queue, Worker } from "bullmq";
import { Redis } from "ioredis";
import request from "supertest";
import type TestAgent from "supertest/lib/agent.js";
import { newId, PrismaService } from "@leadforge/db-postgres";
import { MongoService, syncCollections } from "@leadforge/db-mongo";
import {
  CSRF_COOKIE,
  CSRF_HEADER,
  ORGANIZATION_HEADER,
  type MeResponse,
  type OrganizationRole,
} from "@leadforge/contracts";
import {
  ImportsService,
  QueueNames,
  type CommitImportJob,
  type SendEmailJob,
} from "@leadforge/core";
import { createApp } from "../src/bootstrap.js";

export const API = "/api/v1";

/** BullMQ prefix the test app uses (setup.ts sets QUEUE_PREFIX); test queues and workers must match it. */
export const TEST_QUEUE_PREFIX = process.env.QUEUE_PREFIX ?? "leadforge";

export interface Harness {
  app: INestApplication;
  prisma: PrismaService;
  redis: Redis;
  mailQueue: Queue;
  importQueue: Queue;
  discoveryQueue: Queue;
  close(): Promise<void>;
  resetState(): Promise<void>;
  /** Finds the most recent mail job addressed to `to` and extracts the token from its link. */
  tokenFromMail(to: string, pathPart: string): Promise<string>;
  agent(): TestAgent;
}

/** `env` overrides process.env for this app instance (for example fixture mode for discovery tests). */
export async function createHarness(env: Record<string, string> = {}): Promise<Harness> {
  const redisUrl = process.env.REDIS_URL!;
  const redis = new Redis(redisUrl, { maxRetriesPerRequest: null });
  const prefix = env.QUEUE_PREFIX ?? TEST_QUEUE_PREFIX;
  const mailQueue = new Queue(QueueNames.mail, {
    connection: new Redis(redisUrl, { maxRetriesPerRequest: null }),
    prefix,
  });
  const importQueue = new Queue(QueueNames.imports, {
    connection: new Redis(redisUrl, { maxRetriesPerRequest: null }),
    prefix,
  });
  const extraQueues = [
    QueueNames.discovery,
    QueueNames.billing,
    QueueNames.maintenance,
    QueueNames.websiteAnalysis,
    QueueNames.enrichment,
    QueueNames.scoring,
    QueueNames.dedup,
    QueueNames.exports,
    QueueNames.bulk,
  ].map(
    (name) =>
      new Queue(name, { connection: new Redis(redisUrl, { maxRetriesPerRequest: null }), prefix }),
  );
  const discoveryQueue = extraQueues[0]!;
  const app = await createApp({ ...process.env, ...env });
  const prisma = app.get(PrismaService);
  const mongo = app.get(MongoService);
  // Validators and indexes exactly as production gets them from pnpm db:mongo:sync.
  await syncCollections(mongo.database);

  const resetState = async () => {
    await prisma.$executeRawUnsafe(
      `TRUNCATE TABLE sessions, email_tokens, invitations, memberships, notification_preferences, api_keys, contact_submissions,
       credit_ledger, entitlements, payment_disputes, refunds, payments, invoices, invoice_counters, subscriptions, billing_audit, payment_webhook_events, reconciliation_runs,
       billing_customers, usage_daily, plans, credit_packs, organization_erasures, organizations, users
       RESTART IDENTITY CASCADE`,
    );
    // Empty every collection but keep validators and indexes from the sync above.
    const collections = await mongo.database.listCollections({}, { nameOnly: true }).toArray();
    await Promise.all(collections.map((c) => mongo.database.collection(c.name).deleteMany({})));
    await redis.flushdb();
    await mailQueue.obliterate({ force: true }).catch(() => undefined);
    await importQueue.obliterate({ force: true }).catch(() => undefined);
    for (const q of extraQueues) await q.obliterate({ force: true }).catch(() => undefined);
  };

  return {
    app,
    prisma,
    redis,
    mailQueue,
    importQueue,
    discoveryQueue,
    resetState,
    agent: () => request.agent(app.getHttpServer()),
    async tokenFromMail(to, pathPart) {
      const jobs = await mailQueue.getJobs([
        "waiting",
        "delayed",
        "prioritized",
        "completed",
        "active",
      ]);
      const matching = jobs
        .filter(
          (j) =>
            (j.data as SendEmailJob).message.to === to &&
            (j.data as SendEmailJob).message.text.includes(pathPart),
        )
        .sort((a, b) => (b.timestamp ?? 0) - (a.timestamp ?? 0));
      const job = matching[0];
      if (!job) throw new Error(`No mail to ${to} containing ${pathPart}`);
      const text = (job.data as SendEmailJob).message.text;
      const link = text
        .split(/\s+/)
        .find((word) => word.startsWith("http") && word.includes(pathPart));
      if (!link) throw new Error(`Could not find a link containing ${pathPart} in mail: ${text}`);
      const url = new URL(link);
      const fromQuery = url.searchParams.get("token");
      const token =
        fromQuery ?? decodeURIComponent(url.pathname.split("/").filter(Boolean).pop() ?? "");
      if (!token) throw new Error(`Could not extract token from link: ${link}`);
      return token;
    },
    async close() {
      await app.close();
      await mailQueue.close();
      await importQueue.close();
      for (const q of extraQueues) await q.close();
      await redis.quit();
    },
  };
}

export function csrfFrom(agent: TestAgent): string {
  const jar = (
    agent as unknown as {
      jar: {
        getCookies: (opts: {
          domain: string;
          path: string;
          secure: boolean;
          script: boolean;
        }) => Array<{ name: string; value: string }>;
      };
    }
  ).jar;
  const cookies = jar.getCookies({ domain: "127.0.0.1", path: "/", secure: false, script: true });
  const csrf = cookies.find((c) => c.name === CSRF_COOKIE);
  if (!csrf) throw new Error("No CSRF cookie in jar");
  return csrf.value;
}

export async function registerUser(
  agent: TestAgent,
  overrides: Partial<{
    email: string;
    password: string;
    name: string;
    organizationName: string;
  }> = {},
): Promise<MeResponse> {
  const body = {
    email: overrides.email ?? `user-${Math.random().toString(36).slice(2, 8)}@example.test`,
    password: overrides.password ?? "Str0ng-Passw0rd-Example!",
    name: overrides.name ?? "Test Person",
    organizationName: overrides.organizationName ?? "Test Org",
    country: "NG",
  };
  const res = await agent.post(`${API}/auth/register`).send(body).expect(201);
  return res.body.data as MeResponse;
}

export async function verifyEmail(h: Harness, agent: TestAgent, email: string): Promise<void> {
  const token = await h.tokenFromMail(email, "/verify-email");
  await agent
    .post(`${API}/auth/verify-email`)
    .set(CSRF_HEADER, csrfFrom(agent))
    .send({ token })
    .expect(200);
}

export function orgHeaders(agent: TestAgent, organizationId: string): Record<string, string> {
  return { [ORGANIZATION_HEADER]: organizationId, [CSRF_HEADER]: csrfFrom(agent) };
}

/** Registers a verified user and adds them to an existing organization with a role. */
export async function addMember(
  h: Harness,
  organizationId: string,
  role: OrganizationRole,
  email = `${role}-${Math.random().toString(36).slice(2, 8)}@example.test`,
): Promise<{ agent: TestAgent; userId: string }> {
  const agent = h.agent();
  const me = await registerUser(agent, { email, organizationName: `${role} personal org` });
  await verifyEmail(h, agent, email);
  await h.prisma.membership.create({
    data: { id: newId(), organizationId, userId: me.user.id, role },
  });
  return { agent, userId: me.user.id };
}

/**
 * Runs a real BullMQ worker for the imports queue (wired exactly like apps/worker) until
 * the given import reaches a terminal status, observed through the API like the UI polls it.
 */
export async function runImportToCompletion(
  h: Harness,
  agent: TestAgent,
  organizationId: string,
  importId: string,
  timeoutMs = 30_000,
): Promise<Record<string, unknown>> {
  const imports = h.app.get(ImportsService, { strict: false });
  const worker = new Worker<CommitImportJob>(
    QueueNames.imports,
    async (job) => imports.process(job.data.organizationId, job.data.importId),
    {
      connection: new Redis(process.env.REDIS_URL!, { maxRetriesPerRequest: null }),
      prefix: TEST_QUEUE_PREFIX,
      concurrency: 1,
    },
  );
  try {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const res = await agent
        .get(`${API}/imports/${importId}`)
        .set(orgHeaders(agent, organizationId))
        .expect(200);
      const data = res.body.data as Record<string, unknown>;
      if (["completed", "completed_with_errors", "failed"].includes(String(data.status)))
        return data;
      if (Date.now() > deadline)
        throw new Error(`Import ${importId} did not finish: ${JSON.stringify(data)}`);
      await new Promise((r) => setTimeout(r, 100));
    }
  } finally {
    await worker.close();
  }
}
