import { describe, expect, it, vi } from "vitest";
import { DelayedError, UnrecoverableError, type Job } from "bullmq";
import type { Logger } from "nestjs-pino";
import { DiscoveryQueueHandler } from "./discovery.queue-handler.js";
import {
  DiscoveryPayloadError,
  RetryableItemsError,
  type DiscoveryRunner,
  type RunResult,
} from "./discovery.runner.js";

const ORG = "0192c9a8-0000-7000-8000-000000000001";
const JOB = "6add8b76520012303c641f9f";
const PAGE = {
  organizationId: ORG,
  jobId: JOB,
  round: 0,
  source: "google_places",
  unit: "search-google_places",
  cursor: { kind: "search", queryIndex: 0, pageIndex: 0, pageToken: null },
};

function setup(processUnit: () => Promise<RunResult>) {
  const runner = {
    run: vi.fn(async (): Promise<RunResult> => ({ status: "continued" })),
    processUnit: vi.fn(processUnit),
    failUnit: vi.fn(async () => undefined),
  };
  const logger = { log: vi.fn(), error: vi.fn(), warn: vi.fn() } as unknown as Logger;
  return {
    runner,
    handler: new DiscoveryQueueHandler(runner as unknown as DiscoveryRunner, logger),
  };
}

function job(name: string, data: unknown, attemptsMade = 0, attempts = 3) {
  return {
    name,
    data,
    attemptsMade,
    opts: { attempts },
    moveToDelayed: vi.fn(async () => undefined),
  } as unknown as Job & {
    moveToDelayed: ReturnType<typeof vi.fn>;
  };
}

describe("DiscoveryQueueHandler", () => {
  it("dispatches both job types with validated payloads and the attempt count", async () => {
    const { runner, handler } = setup(async () => ({ status: "unit_done" }));
    await expect(
      handler.handle(
        job("run-discovery-job", { organizationId: ORG, jobId: JOB, round: 0, reason: "start" }),
      ),
    ).resolves.toEqual({ status: "continued" });
    await expect(handler.handle(job("fetch-source-page", PAGE, 1, 4))).resolves.toEqual({
      status: "unit_done",
    });
    expect(runner.processUnit).toHaveBeenCalledWith(PAGE, { attemptsMade: 1, maxAttempts: 4 });
  });

  it("refuses malformed payloads, unknown names and other organizations' jobs without retrying", async () => {
    const { runner, handler } = setup(async () => {
      throw new DiscoveryPayloadError("Discovery job not found in the payload's organization");
    });
    await expect(
      handler.handle(job("fetch-source-page", { ...PAGE, organizationId: "not-a-uuid" })),
    ).rejects.toBeInstanceOf(UnrecoverableError);
    await expect(
      handler.handle(job("fetch-source-page", { ...PAGE, jobId: { $gt: "" } })),
    ).rejects.toBeInstanceOf(UnrecoverableError);
    await expect(
      handler.handle(job("fetch-source-page", { ...PAGE, source: "facebook" })),
    ).rejects.toBeInstanceOf(UnrecoverableError);
    await expect(
      handler.handle(
        job("run-discovery-job", { organizationId: ORG, jobId: JOB, round: 0, reason: "delete" }),
      ),
    ).rejects.toBeInstanceOf(UnrecoverableError);
    await expect(handler.handle(job("purge-everything", {}))).rejects.toBeInstanceOf(
      UnrecoverableError,
    );
    await expect(handler.handle(job("fetch-source-page", PAGE))).rejects.toBeInstanceOf(
      UnrecoverableError,
    );
    expect(runner.failUnit).not.toHaveBeenCalled();
  });

  it("moves a rate-limited page back to the delayed set instead of spending an attempt", async () => {
    const { handler } = setup(async () => ({ status: "rate_limited", retryAfterMs: 250 }));
    const j = job("fetch-source-page", PAGE);
    const before = Date.now();
    await expect(handler.handle(j, "worker-token")).rejects.toBeInstanceOf(DelayedError);
    const [timestamp, token] = j.moveToDelayed.mock.calls[0] as [number, string];
    expect(token).toBe("worker-token");
    expect(timestamp).toBeGreaterThanOrEqual(before + 250);
  });

  it("lets BullMQ retry earlier attempts and finishes the unit after the last one", async () => {
    const { runner, handler } = setup(async () => {
      throw new RetryableItemsError(2);
    });
    await expect(handler.handle(job("fetch-source-page", PAGE, 0, 3))).rejects.toBeInstanceOf(
      RetryableItemsError,
    );
    expect(runner.failUnit).not.toHaveBeenCalled();
    await expect(handler.handle(job("fetch-source-page", PAGE, 2, 3))).rejects.toBeInstanceOf(
      RetryableItemsError,
    );
    expect(runner.failUnit).toHaveBeenCalledTimes(1);
  });
});
