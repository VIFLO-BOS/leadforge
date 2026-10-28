import { timingSafeEqual } from "node:crypto";
import { collectDefaultMetrics, Counter, Histogram, Registry } from "prom-client";

/** Which process exports the metrics (the `service` label on every series). */
export type MetricsServiceName = "api" | "worker";

const LATENCY_BUCKETS = [0.005, 0.01, 0.025, 0.05, 0.1, 0.2, 0.3, 0.5, 1, 2, 5, 10];
const JOB_BUCKETS = [0.05, 0.1, 0.5, 1, 5, 15, 30, 60, 120, 300, 600, 1800];

/**
 * Prometheus metrics for one process (docs/OPERATIONS.md, "Monitoring"). Each process (and each
 * test app) owns its registry, so several apps in one process never collide on metric names.
 *
 * Series (all prefixed `leadforge_`):
 * - `http_request_duration_seconds` (histogram) and `http_requests_total` by method, route
 *   template and status; `http_errors_total` by error code (API).
 * - `jobs_total` by queue, job name and outcome (completed, failed, retrying, delayed);
 *   `job_duration_seconds` and `job_wait_seconds` (enqueue to start) by queue (worker).
 * - `reconciliation_runs_total` by kind and outcome, `reconciliation_items_total` by kind and
 *   field (checked, fixed, settled ... as each reconciler reports them) (worker).
 * - Platform gauges (queue depth, stuck payments, unsettled jobs, negative balances, Overture
 *   sync) come from OpsMetricsCollector, registered on the API registry only.
 * - Node.js process defaults (CPU, memory, event loop lag, GC).
 */
export class MetricsService {
  readonly registry = new Registry();
  private readonly httpDuration: Histogram<"method" | "route" | "status">;
  private readonly httpRequests: Counter<"method" | "route" | "status">;
  private readonly httpErrors: Counter<"code" | "status">;
  private readonly jobs: Counter<"queue" | "name" | "outcome">;
  private readonly jobDuration: Histogram<"queue" | "outcome">;
  private readonly jobWait: Histogram<"queue">;
  private readonly reconciliationRuns: Counter<"kind" | "outcome">;
  private readonly reconciliationItems: Counter<"kind" | "field">;

  constructor(readonly service: MetricsServiceName) {
    this.registry.setDefaultLabels({ service });
    collectDefaultMetrics({ register: this.registry });
    const registers = [this.registry];
    this.httpDuration = new Histogram({
      name: "leadforge_http_request_duration_seconds",
      help: "HTTP request latency by route template",
      labelNames: ["method", "route", "status"],
      buckets: LATENCY_BUCKETS,
      registers,
    });
    this.httpRequests = new Counter({
      name: "leadforge_http_requests_total",
      help: "HTTP requests by route template and status code",
      labelNames: ["method", "route", "status"],
      registers,
    });
    this.httpErrors = new Counter({
      name: "leadforge_http_errors_total",
      help: "Error responses by API error code",
      labelNames: ["code", "status"],
      registers,
    });
    this.jobs = new Counter({
      name: "leadforge_jobs_total",
      help: "Queue job attempts by outcome: completed, failed (final), retrying, delayed (rate limited)",
      labelNames: ["queue", "name", "outcome"],
      registers,
    });
    this.jobDuration = new Histogram({
      name: "leadforge_job_duration_seconds",
      help: "Queue job attempt duration",
      labelNames: ["queue", "outcome"],
      buckets: JOB_BUCKETS,
      registers,
    });
    this.jobWait = new Histogram({
      name: "leadforge_job_wait_seconds",
      help: "Time from enqueue (or the end of a delay) to the start of the first attempt",
      labelNames: ["queue"],
      buckets: JOB_BUCKETS,
      registers,
    });
    this.reconciliationRuns = new Counter({
      name: "leadforge_reconciliation_runs_total",
      help: "Reconciliation passes by kind and outcome (ok, errors, failed)",
      labelNames: ["kind", "outcome"],
      registers,
    });
    this.reconciliationItems = new Counter({
      name: "leadforge_reconciliation_items_total",
      help: "Items reconciliation checked or repaired, by kind and the reconciler's own field name",
      labelNames: ["kind", "field"],
      registers,
    });
  }

  observeHttp(method: string, route: string, status: number, seconds: number): void {
    const labels = { method, route, status: String(status) };
    this.httpDuration.observe(labels, seconds);
    this.httpRequests.inc(labels);
  }

  countError(code: string, status: number): void {
    this.httpErrors.inc({ code, status: String(status) });
  }

  observeJob(
    queue: string,
    name: string,
    outcome: "completed" | "failed" | "retrying" | "delayed",
    seconds: number,
  ): void {
    this.jobs.inc({ queue, name, outcome });
    this.jobDuration.observe({ queue, outcome }, seconds);
  }

  observeJobWait(queue: string, seconds: number): void {
    if (Number.isFinite(seconds) && seconds >= 0) this.jobWait.observe({ queue }, seconds);
  }

  /**
   * Records one reconciliation pass. Numeric fields of the report (at any depth, joined with
   * dots, e.g. `analyses.settled`) become item counts; an `errors` array marks the pass.
   */
  recordReconciliation(kind: string, report: unknown, failed = false): void {
    if (failed) {
      this.reconciliationRuns.inc({ kind, outcome: "failed" });
      return;
    }
    let errors = 0;
    const walk = (value: unknown, path: string, depth: number) => {
      if (depth > 3 || value === null || typeof value !== "object") return;
      for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
        const field = path ? `${path}.${key}` : key;
        if (key === "errors" && Array.isArray(v)) errors += v.length;
        else if (typeof v === "number" && Number.isFinite(v) && v > 0)
          this.reconciliationItems.inc({ kind, field }, v);
        else if (typeof v === "object") walk(v, field, depth + 1);
      }
    };
    walk(report, "", 0);
    if (errors > 0) this.reconciliationItems.inc({ kind, field: "errors" }, errors);
    this.reconciliationRuns.inc({ kind, outcome: errors > 0 ? "errors" : "ok" });
  }

  async render(): Promise<{ contentType: string; body: string }> {
    return { contentType: this.registry.contentType, body: await this.registry.metrics() };
  }
}

/**
 * Who may read /metrics: with METRICS_TOKEN set, only `Authorization: Bearer <token>`
 * (constant-time compare). Without a token, only loopback callers, and never in production.
 */
export function metricsAccessAllowed(
  input: { authorization: string | undefined; remoteAddress: string | undefined },
  env: { METRICS_TOKEN?: string | undefined; NODE_ENV: string },
): boolean {
  if (env.METRICS_TOKEN) {
    const presented = input.authorization?.startsWith("Bearer ")
      ? input.authorization.slice(7)
      : "";
    const a = Buffer.from(presented);
    const b = Buffer.from(env.METRICS_TOKEN);
    return a.length === b.length && timingSafeEqual(a, b);
  }
  if (env.NODE_ENV === "production") return false;
  const ip = input.remoteAddress ?? "";
  return ip === "127.0.0.1" || ip === "::1" || ip === "::ffff:127.0.0.1";
}
