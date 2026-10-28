import { describe, expect, it } from "vitest";
import { MetricsService, metricsAccessAllowed } from "./metrics.service.js";

describe("MetricsService", () => {
  it("records HTTP requests by route template and errors by code, labeled with the service", async () => {
    const m = new MetricsService("api");
    m.observeHttp("GET", "/api/v1/businesses/:id", 200, 0.042);
    m.observeHttp("GET", "/api/v1/businesses/:id", 404, 0.01);
    m.countError("NOT_FOUND", 404);
    const text = (await m.render()).body;
    expect(text).toMatch(
      /leadforge_http_requests_total\{method="GET",route="\/api\/v1\/businesses\/:id",status="200",service="api"\} 1/,
    );
    // Histogram series put the default label (service) before the metric's own labels.
    expect(text).toMatch(
      /leadforge_http_request_duration_seconds_bucket\{le="0\.05",[^}]*route="\/api\/v1\/businesses\/:id",status="200"[^}]*\} 1/,
    );
    expect(text).toMatch(
      /leadforge_http_errors_total\{code="NOT_FOUND",status="404",service="api"\} 1/,
    );
    expect(text).toContain("process_resident_memory_bytes");
  });

  it("counts job outcomes, durations and waits, ignoring impossible waits", async () => {
    const m = new MetricsService("worker");
    m.observeJob("discovery", "fetch-source-page", "completed", 1.2);
    m.observeJob("discovery", "fetch-source-page", "retrying", 0.3);
    m.observeJobWait("discovery", 4);
    m.observeJobWait("discovery", -1);
    m.observeJobWait("discovery", Number.NaN);
    const text = (await m.render()).body;
    expect(text).toMatch(
      /leadforge_jobs_total\{queue="discovery",name="fetch-source-page",outcome="completed",service="worker"\} 1/,
    );
    expect(text).toMatch(
      /leadforge_jobs_total\{queue="discovery",name="fetch-source-page",outcome="retrying",service="worker"\} 1/,
    );
    expect(text).toMatch(/leadforge_job_wait_seconds_count\{[^}]*queue="discovery"[^}]*\} 1/);
  });

  it("turns reconciliation reports into item counts and pass outcomes", async () => {
    const m = new MetricsService("worker");
    m.recordReconciliation("billing", {
      payments: { checked: 3, fixed: 2, errors: 0 },
      webhooks: { checked: 0, fixed: 0, errors: 0 },
    });
    m.recordReconciliation("credits", { discovery: { settledJobs: 1, errors: [{ jobId: "x" }] } });
    m.recordReconciliation("credits", null, true);
    const text = (await m.render()).body;
    expect(text).toMatch(
      /leadforge_reconciliation_items_total\{kind="billing",field="payments\.fixed",service="worker"\} 2/,
    );
    expect(text).toMatch(
      /leadforge_reconciliation_runs_total\{kind="billing",outcome="ok",service="worker"\} 1/,
    );
    expect(text).toMatch(
      /leadforge_reconciliation_items_total\{kind="credits",field="errors",service="worker"\} 1/,
    );
    expect(text).toMatch(
      /leadforge_reconciliation_runs_total\{kind="credits",outcome="errors",service="worker"\} 1/,
    );
    expect(text).toMatch(
      /leadforge_reconciliation_runs_total\{kind="credits",outcome="failed",service="worker"\} 1/,
    );
  });

  it("keeps separate registries per instance (several apps in one process)", async () => {
    const a = new MetricsService("api");
    const b = new MetricsService("api");
    a.countError("CONFLICT", 409);
    expect((await b.render()).body).not.toContain('code="CONFLICT"');
  });
});

describe("metricsAccessAllowed", () => {
  const token = "metrics-token-0123456789abcdef";
  it("requires the exact bearer token when one is configured, wherever the caller is", () => {
    const env = { METRICS_TOKEN: token, NODE_ENV: "production" };
    expect(
      metricsAccessAllowed({ authorization: `Bearer ${token}`, remoteAddress: "10.0.0.5" }, env),
    ).toBe(true);
    expect(
      metricsAccessAllowed({ authorization: `Bearer ${token}x`, remoteAddress: "127.0.0.1" }, env),
    ).toBe(false);
    expect(
      metricsAccessAllowed({ authorization: undefined, remoteAddress: "127.0.0.1" }, env),
    ).toBe(false);
    expect(metricsAccessAllowed({ authorization: token, remoteAddress: "127.0.0.1" }, env)).toBe(
      false,
    );
  });

  it("without a token: loopback only, and never in production", () => {
    expect(
      metricsAccessAllowed(
        { authorization: undefined, remoteAddress: "127.0.0.1" },
        { NODE_ENV: "development" },
      ),
    ).toBe(true);
    expect(
      metricsAccessAllowed(
        { authorization: undefined, remoteAddress: "::ffff:127.0.0.1" },
        { NODE_ENV: "test" },
      ),
    ).toBe(true);
    expect(
      metricsAccessAllowed(
        { authorization: undefined, remoteAddress: "192.168.1.20" },
        { NODE_ENV: "development" },
      ),
    ).toBe(false);
    expect(
      metricsAccessAllowed(
        { authorization: undefined, remoteAddress: "127.0.0.1" },
        { NODE_ENV: "production" },
      ),
    ).toBe(false);
  });
});
