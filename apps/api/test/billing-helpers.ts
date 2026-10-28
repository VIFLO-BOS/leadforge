import { randomUUID } from "node:crypto";
import { Queue, Worker, type Job } from "bullmq";
import { Redis } from "ioredis";
import request from "supertest";
import { newId } from "@leadforge/db-postgres";
import { BillingQueueHandler, CreditsService, QueueNames } from "@leadforge/core";
import { API, orgHeaders, TEST_QUEUE_PREFIX, type Harness } from "./harness.js";
import type { OrgUser } from "./fixtures.js";
import { sign, type Json } from "./paystack-fake.js";

export type { Json };

/** A credit pack row with a real (non-placeholder) test price. */
export async function createPack(
  h: Harness,
  input: {
    code?: string;
    credits: number;
    priceMinor: number;
    isPlaceholder?: boolean;
    currency?: string;
  },
) {
  return h.prisma.creditPack.create({
    data: {
      id: newId(),
      code: input.code ?? `pack-${randomUUID().slice(0, 8)}`,
      name: `${input.credits} credits (test)`,
      credits: input.credits,
      priceMinor: BigInt(input.priceMinor),
      currency: input.currency ?? "NGN",
      isActive: true,
      isPlaceholder: input.isPlaceholder ?? false,
    },
  });
}

export async function createPlan(
  h: Harness,
  input: {
    code?: string;
    name?: string;
    priceMinor: number;
    includedCredits?: number;
    maxMembers?: number;
    exportRowCap?: number;
    discoveryEnabled?: boolean;
    isPlaceholder?: boolean;
    providerPlanCode?: string | null;
  },
) {
  return h.prisma.plan.create({
    data: {
      id: newId(),
      code: input.code ?? `plan-${randomUUID().slice(0, 8)}`,
      name: input.name ?? "Test plan",
      description: "Test plan (fixture)",
      interval: "monthly",
      priceMinor: BigInt(input.priceMinor),
      currency: "NGN",
      includedCredits: input.includedCredits ?? 100,
      maxMembers: input.maxMembers ?? 5,
      exportRowCap: input.exportRowCap ?? 5000,
      discoveryEnabled: input.discoveryEnabled ?? true,
      websiteAnalysisEnabled: true,
      isActive: true,
      isPlaceholder: input.isPlaceholder ?? false,
      providerPlanCode: input.providerPlanCode ?? null,
    },
  });
}

export function call(
  u: OrgUser,
  method: "get" | "post",
  path: string,
  body?: object,
  key?: string,
) {
  const req = u.agent[method](`${API}${path}`).set(orgHeaders(u.agent, u.orgId));
  if (key) req.set("Idempotency-Key", key);
  return method === "get" ? req : req.send(body ?? {});
}

export function postWebhook(h: Harness, body: Buffer, signature: string | null = sign(body)) {
  const req = request(h.app.getHttpServer())
    .post(`${API}/webhooks/paystack`)
    .set("content-type", "application/json");
  if (signature !== null) req.set("x-paystack-signature", signature);
  return req.send(body.toString("utf8"));
}

/** A real BullMQ worker on the billing queue running the same handler as apps/worker. */
export function startBillingWorker(h: Harness): {
  close(): Promise<void>;
  failures: string[];
  drain(timeoutMs?: number): Promise<void>;
} {
  const handler = h.app.get(BillingQueueHandler, { strict: false });
  const failures: string[] = [];
  const worker = new Worker(QueueNames.billing, (job: Job) => handler.handle(job), {
    connection: new Redis(process.env.REDIS_URL!, { maxRetriesPerRequest: null }),
    prefix: TEST_QUEUE_PREFIX,
    concurrency: 4,
  });
  worker.on("failed", (job, err) => failures.push(`${job?.name}:${err?.message}`));
  const queue = new Queue(QueueNames.billing, {
    connection: new Redis(process.env.REDIS_URL!, { maxRetriesPerRequest: null }),
    prefix: TEST_QUEUE_PREFIX,
  });
  return {
    failures,
    async drain(timeoutMs = 20_000) {
      const deadline = Date.now() + timeoutMs;
      for (;;) {
        const counts = await queue.getJobCounts(
          "waiting",
          "active",
          "delayed",
          "prioritized",
          "paused",
        );
        if (Object.values(counts).every((n) => n === 0)) return;
        if (Date.now() > deadline)
          throw new Error(
            `Billing queue did not drain: ${JSON.stringify(counts)} failures=${failures.join("; ")}`,
          );
        await new Promise((r) => setTimeout(r, 50));
      }
    },
    async close() {
      await worker.close();
      await queue.close();
    },
  };
}

export function creditsOf(h: Harness): CreditsService {
  return h.app.get(CreditsService, { strict: false });
}

export async function ledgerRows(h: Harness, organizationId: string) {
  const customer = await h.prisma.billingCustomer.findUniqueOrThrow({ where: { organizationId } });
  return h.prisma.creditLedger.findMany({
    where: { billingCustomerId: customer.id },
    orderBy: { createdAt: "asc" },
  });
}

export async function customerOf(h: Harness, organizationId: string) {
  return h.prisma.billingCustomer.findUniqueOrThrow({ where: { organizationId } });
}

/** Ledger sum equals the cached balance. */
export async function expectInvariant(
  h: Harness,
  organizationId: string,
): Promise<{ sum: number; cached: number }> {
  const inv = await creditsOf(h).invariant(organizationId);
  if (inv.sum !== inv.cached)
    throw new Error(`Balance invariant broken: ledger ${inv.sum}, cached ${inv.cached}`);
  return inv;
}
