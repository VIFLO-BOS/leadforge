import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Worker, type Job } from "bullmq";
import { Redis } from "ioredis";
import { DEFAULT_QUEUE_PREFIX, QueueNames, QueueService, queuePrefix } from "@leadforge/core";
import { createHarness, type Harness } from "./harness.js";

const PREFIX = "lf-prefix-check";
let h: Harness;
beforeAll(async () => {
  h = await createHarness({ QUEUE_PREFIX: PREFIX });
  await h.resetState();
});
afterAll(async () => h?.close());

function worker(prefix: string, seen: string[]): Worker {
  return new Worker(QueueNames.mail, async (job: Job) => void seen.push(String(job.id)), {
    connection: new Redis(process.env.REDIS_URL!, { maxRetriesPerRequest: null }),
    prefix,
  });
}

describe("per-environment BullMQ queue prefix (QUEUE_PREFIX)", () => {
  it("defaults to leadforge and reads QUEUE_PREFIX", () => {
    expect(queuePrefix({})).toBe(DEFAULT_QUEUE_PREFIX);
    expect(DEFAULT_QUEUE_PREFIX).toBe("leadforge");
    expect(queuePrefix({ QUEUE_PREFIX: " dev-ada " })).toBe("dev-ada");
    expect(h.app.get(QueueService, { strict: false }).prefix).toBe(PREFIX);
  });

  it("puts jobs under the prefix, so only a worker with the same prefix takes them", async () => {
    const queues = h.app.get(QueueService, { strict: false });
    const otherSeen: string[] = [];
    const other = worker("leadforge", otherSeen);
    await queues.enqueueMail({
      message: { to: "prefix@example.test", subject: "Prefix check", text: "Prefix check" },
      idempotencyKey: "prefix:check-1",
    });
    expect((await h.redis.keys(`${PREFIX}:mail:*`)).length).toBeGreaterThan(0);
    expect(await h.redis.exists(`${PREFIX}:mail:mail:prefix:check-1`)).toBe(1);
    expect(await h.redis.exists("leadforge:mail:mail:prefix:check-1")).toBe(0);
    await new Promise((r) => setTimeout(r, 750));
    expect(otherSeen).toEqual([]);
    await other.close();

    const seen: string[] = [];
    const same = worker(PREFIX, seen);
    const deadline = Date.now() + 10_000;
    while (seen.length === 0 && Date.now() < deadline) await new Promise((r) => setTimeout(r, 50));
    await same.close();
    expect(seen).toEqual(["mail:prefix:check-1"]);
  });
});
