import { z } from "zod";
import { IsoDateTime } from "../common/ids.js";

/**
 * Usage aggregates (PostgreSQL `usage_daily`, one row per organization, UTC day and metric).
 * A rollup in the worker recomputes the latest days every 10 minutes and the last 90 days
 * daily, writing absolute values, so reruns are idempotent.
 */
export const UsageMetric = z.enum([
  /** Credits captured (billed), all kinds. */
  "credits_used",
  /** Discovery jobs created. */
  "discovery_jobs",
  /** Billable discovery records (credits captured by discovery jobs). */
  "discovery_records",
  /** Billed website analyses (credits captured by analyses). */
  "analyses",
  /** Enrichment runs requested (website contacts and email checks; free). */
  "enrichment_runs",
  /** Exports completed (asynchronous jobs and synchronous downloads). */
  "exports",
  /** Rows in those exports. */
  "export_rows",
]);
export type UsageMetric = z.infer<typeof UsageMetric>;

export const UsagePeriod = z.enum(["7d", "30d", "90d"]);
export type UsagePeriod = z.infer<typeof UsagePeriod>;

export const UsageQuery = z.object({ period: UsagePeriod.default("30d") });
export type UsageQuery = z.infer<typeof UsageQuery>;

const int = z.number().int();
export const UsageValues = z.object({
  credits_used: int,
  discovery_jobs: int,
  discovery_records: int,
  analyses: int,
  enrichment_runs: int,
  exports: int,
  export_rows: int,
});
export type UsageValues = z.infer<typeof UsageValues>;

export const UsageSummary = z.object({
  period: UsagePeriod,
  /** First and last UTC day (yyyy-mm-dd), inclusive; one series point per day. */
  from: z.string(),
  to: z.string(),
  /** When the rollup last ran for this organization; null before the first run. */
  computedAt: IsoDateTime.nullable(),
  metrics: z.array(UsageMetric),
  series: z.array(z.object({ day: z.string(), values: UsageValues })),
  totals: UsageValues,
  /** Live balance from the credit ledger. */
  credits: z.object({ balance: int, held: int }),
});
export type UsageSummary = z.infer<typeof UsageSummary>;
