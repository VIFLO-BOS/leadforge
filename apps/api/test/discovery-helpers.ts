import { Worker, type Job } from "bullmq";
import { Redis } from "ioredis";
import type TestAgent from "supertest/lib/agent.js";
import { randomUUID } from "node:crypto";
import type { DiscoveryJobSpecInput } from "@leadforge/contracts";
import {
  CreditsService,
  DISCOVERY_BACKOFF_TYPE,
  DiscoveryQueueHandler,
  discoveryBackoffDelay,
  QueueNames,
} from "@leadforge/core";
import { API, createHarness, orgHeaders, TEST_QUEUE_PREFIX, type Harness } from "./harness.js";
import { overtureSpec } from "./overture-helpers.js";

/** API response bodies, asserted field by field in tests. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Json = Record<string, any>;

/**
 * Compressed retry timings so backoff is exercised in milliseconds instead of minutes, and small
 * Overture pages (10) so paging is exercised on the sample data. Google fixture mode stays on to
 * prove Google never runs even with a working transport.
 */
export const DISCOVERY_TEST_ENV = {
  GOOGLE_PLACES_FIXTURE_MODE: "true",
  OVERTURE_PAGE_SIZE: "10",
  DISCOVERY_RETRY_BASE_MS: "20",
  DISCOVERY_RETRY_MAX_MS: "80",
  DISCOVERY_PAGE_ATTEMPTS: "3",
  DISCOVERY_JOBS_PER_HOUR: "1000",
};

export function createDiscoveryHarness(env: Record<string, string> = {}): Promise<Harness> {
  return createHarness({ ...DISCOVERY_TEST_ENV, ...env });
}

export function credits(h: Harness): CreditsService {
  return h.app.get(CreditsService, { strict: false });
}

export async function grant(h: Harness, organizationId: string, units: number): Promise<void> {
  await credits(h).grant(organizationId, {
    units,
    key: `test-grant:${organizationId}:${randomUUID()}`,
    description: "Test grant",
  });
}

/** Default job spec: Overture pharmacies in Ikeja LGA (see overture-helpers.ts for the data). */
export function spec(overrides: Partial<DiscoveryJobSpecInput> = {}): DiscoveryJobSpecInput {
  return overtureSpec(overrides);
}

export function createJob(
  agent: TestAgent,
  organizationId: string,
  body: DiscoveryJobSpecInput,
  key: string = randomUUID(),
) {
  return agent
    .post(`${API}/discovery/jobs`)
    .set(orgHeaders(agent, organizationId))
    .set("Idempotency-Key", key)
    .send(body);
}

/**
 * A real BullMQ worker on the discovery queue, wired like apps/worker: the same
 * DiscoveryQueueHandler, the same custom capped-exponential backoff (compressed by env).
 */
export function startDiscoveryWorker(h: Harness): {
  worker: Worker;
  close: () => Promise<void>;
  failures: string[];
} {
  const handler = h.app.get(DiscoveryQueueHandler, { strict: false });
  const failures: string[] = [];
  const worker = new Worker(
    QueueNames.discovery,
    (job: Job, token?: string) => handler.handle(job, token),
    {
      connection: new Redis(process.env.REDIS_URL!, { maxRetriesPerRequest: null }),
      prefix: TEST_QUEUE_PREFIX,
      concurrency: 4,
      settings: {
        backoffStrategy: (attemptsMade: number, type?: string) =>
          type === DISCOVERY_BACKOFF_TYPE ? discoveryBackoffDelay(attemptsMade, 20, 80) : 0,
      },
    },
  );
  worker.on("failed", (job, err) => {
    if (err?.name !== "DelayedError") failures.push(`${job?.name}:${job?.id}:${err?.message}`);
  });
  return { worker, failures, close: () => worker.close() };
}

const TERMINAL = ["completed", "completed_with_warnings", "failed", "cancelled"];

/** Polls the job through the API, the way the UI does, until it is terminal and settled. */
export async function waitForJob(
  agent: TestAgent,
  organizationId: string,
  jobId: string,
  timeoutMs = 45_000,
): Promise<Json> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const res = await agent
      .get(`${API}/discovery/jobs/${jobId}`)
      .set(orgHeaders(agent, organizationId));
    if (res.status !== 200)
      throw new Error(`GET job ${jobId}: ${res.status} ${JSON.stringify(res.body)}`);
    const data = res.body.data as Json;
    if (TERMINAL.includes(String(data.status)) && data.credits.settled) return data;
    if (Date.now() > deadline)
      throw new Error(`Job ${jobId} did not finish: ${JSON.stringify(data)}`);
    await new Promise((r) => setTimeout(r, 100));
  }
}

/** Creates a job and runs it to completion on a temporary worker. */
export async function runJob(
  h: Harness,
  agent: TestAgent,
  organizationId: string,
  body: DiscoveryJobSpecInput,
) {
  const created = await createJob(agent, organizationId, body);
  if (created.status !== 201)
    throw new Error(`create: ${created.status} ${JSON.stringify(created.body)}`);
  const w = startDiscoveryWorker(h);
  try {
    return await waitForJob(agent, organizationId, created.body.data.id as string);
  } finally {
    await w.close();
  }
}

export async function allItems(
  agent: TestAgent,
  organizationId: string,
  jobId: string,
  query = "",
): Promise<Array<Json>> {
  const out: Array<Json> = [];
  let cursor: string | null = null;
  do {
    const res = await agent
      .get(
        `${API}/discovery/jobs/${jobId}/items?pageSize=100${query}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`,
      )
      .set(orgHeaders(agent, organizationId))
      .expect(200);
    out.push(...(res.body.data as Array<Json>));
    cursor = res.body.meta.nextCursor as string | null;
  } while (cursor);
  return out;
}

export async function ledger(
  agent: TestAgent,
  organizationId: string,
  query = "",
): Promise<Array<Json>> {
  const res = await agent
    .get(`${API}/credits/ledger?pageSize=100${query}`)
    .set(orgHeaders(agent, organizationId))
    .expect(200);
  return res.body.data as Array<Json>;
}

export async function balance(
  agent: TestAgent,
  organizationId: string,
): Promise<{ balance: number; held: number; openHolds: number }> {
  const res = await agent
    .get(`${API}/credits/balance`)
    .set(orgHeaders(agent, organizationId))
    .expect(200);
  return res.body.data as { balance: number; held: number; openHolds: number };
}
