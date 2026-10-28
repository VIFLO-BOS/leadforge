import { describe, expect, it, vi } from "vitest";
import type { Job } from "bullmq";
import type { Logger } from "nestjs-pino";
import type {
  AnalysisQueueHandler,
  AnalysisReconciliationService,
  BillingQueueHandler,
  DedupQueueHandler,
  DiscoveryQueueHandler,
  DiscoveryReconciliationService,
  EnrichmentQueueHandler,
  EnrichmentService,
  RetentionService,
  ScoringQueueHandler,
  ScoringService,
} from "@leadforge/core";
import { MetricsService } from "@leadforge/core";
import { DiscoveryProcessor } from "./discovery.processor.js";
import { BillingProcessor } from "./billing.processor.js";
import { MaintenanceProcessor } from "./maintenance.processor.js";
import { AnalysisProcessor } from "./analysis.processor.js";
import { EnrichmentProcessor } from "./enrichment.processor.js";
import { ScoringProcessor } from "./scoring.processor.js";
import { DedupProcessor } from "./dedup.processor.js";

const logger = { log: vi.fn(), error: vi.fn() } as unknown as Logger;
const job = (name: string) => ({ id: "j1", name, data: {} }) as unknown as Job;

describe("Phase 3 processors", () => {
  it("passes discovery jobs and the worker token to the shared handler", async () => {
    const handle = vi.fn(async () => ({ status: "continued" }));
    const processor = new DiscoveryProcessor({ handle } as unknown as DiscoveryQueueHandler);
    expect(processor.queueName).toBe("discovery");
    expect(processor.concurrency).toBe(4);
    await expect(processor.process(job("fetch-source-page"), "tok")).resolves.toEqual({
      status: "continued",
    });
    expect(handle).toHaveBeenCalledWith(
      expect.objectContaining({ name: "fetch-source-page" }),
      "tok",
    );
  });

  it("runs credit reconciliation on the billing queue, hands Phase 6 jobs to the billing handler and refuses other names", async () => {
    const report = {
      timedOut: 0,
      settledJobs: 1,
      requeued: 0,
      orphanHoldsReleased: 0,
      orphanHoldsSettled: 0,
      checked: 1,
      errors: [],
    };
    const run = vi.fn(async () => report);
    const analysisReport = {
      timedOut: 0,
      settled: 2,
      requeued: 0,
      orphanHoldsSettled: 0,
      orphanHoldsReleased: 0,
      errors: [],
    };
    const runAnalyses = vi.fn(async () => analysisReport);
    const billingJobs = [
      "process-webhook",
      "verify-payment",
      "generate-invoice-pdf",
      "reconcile-billing",
    ];
    const metrics = new MetricsService("worker");
    const handle = vi.fn(async (j: Job) => ({ handled: j.name }));
    const processor = new BillingProcessor(
      { run } as unknown as DiscoveryReconciliationService,
      { run: runAnalyses } as unknown as AnalysisReconciliationService,
      {
        handles: (name: string) => billingJobs.includes(name),
        handle,
      } as unknown as BillingQueueHandler,
      logger,
      metrics,
    );
    expect(processor.queueName).toBe("billing");
    await expect(processor.process(job("reconcile-credits"))).resolves.toEqual({
      discovery: report,
      analyses: analysisReport,
    });
    await expect(processor.process(job("process-webhook"))).resolves.toEqual({
      handled: "process-webhook",
    });
    await expect(processor.process(job("reconcile-billing"))).resolves.toEqual({
      handled: "reconcile-billing",
    });
    expect(handle).toHaveBeenCalledTimes(2);
    await expect(processor.process(job("charge-card"))).rejects.toThrow(/Unknown billing job/);
    expect(run).toHaveBeenCalledTimes(1);
    expect(runAnalyses).toHaveBeenCalledTimes(1);
    // Reconciliation passes are counted for Prometheus (credits and billing kinds).
    const text = (await metrics.render()).body;
    expect(text).toMatch(
      /leadforge_reconciliation_runs_total\{[^}]*kind="credits"[^}]*outcome="ok"[^}]*\} 1/,
    );
    expect(text).toMatch(
      /leadforge_reconciliation_items_total\{[^}]*kind="credits"[^}]*field="discovery.settledJobs"[^}]*\} 1/,
    );
    expect(text).toMatch(
      /leadforge_reconciliation_items_total\{[^}]*kind="credits"[^}]*field="analyses.settled"[^}]*\} 2/,
    );
    expect(text).toMatch(
      /leadforge_reconciliation_runs_total\{[^}]*kind="billing"[^}]*outcome="ok"[^}]*\} 1/,
    );
  });

  it("runs the retention purge on the maintenance queue", async () => {
    const purgeExpired = vi.fn(async () => ({
      observationsRedacted: 3,
      businessesChecked: 1,
      businessesPurged: 1,
    }));
    const refreshStaleScores = vi.fn(async () => 7);
    const recoverStuck = vi.fn(async () => ({ failed: 1, requeued: 0 }));
    const processor = new MaintenanceProcessor(
      { purgeExpired } as unknown as RetentionService,
      { refreshStaleScores } as unknown as ScoringService,
      { recoverStuck } as unknown as EnrichmentService,
    );
    expect(processor.queueName).toBe("maintenance");
    await expect(processor.process(job("purge-expired-content"))).resolves.toMatchObject({
      businessesPurged: 1,
    });
    await expect(processor.process(job("refresh-scores"))).resolves.toEqual({ refreshed: 7 });
    await expect(processor.process(job("recover-enrichment"))).resolves.toEqual({
      failed: 1,
      requeued: 0,
    });
    await expect(processor.process(job("drop-db"))).rejects.toThrow(/Unknown maintenance job/);
  });
});

describe("Phase 4 processors", () => {
  it("passes each Phase 4 queue to its shared handler with the documented concurrency", async () => {
    const handle = vi.fn(async () => ({ status: "completed" }));
    const cases = [
      [new AnalysisProcessor({ handle } as unknown as AnalysisQueueHandler), "website-analysis", 4],
      [new EnrichmentProcessor({ handle } as unknown as EnrichmentQueueHandler), "enrichment", 8],
      [new ScoringProcessor({ handle } as unknown as ScoringQueueHandler), "scoring", 2],
      [new DedupProcessor({ handle } as unknown as DedupQueueHandler), "dedup", 2],
    ] as const;
    for (const [processor, queue, concurrency] of cases) {
      expect(processor.queueName).toBe(queue);
      expect(processor.concurrency).toBe(concurrency);
      await expect(processor.process(job("x"))).resolves.toEqual({ status: "completed" });
    }
    expect(handle).toHaveBeenCalledTimes(4);
  });
});
