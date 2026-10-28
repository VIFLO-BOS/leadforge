import { Injectable } from "@nestjs/common";
import { Logger } from "nestjs-pino";
import {
  UsageMetric,
  type UsagePeriod,
  type UsageSummary,
  type UsageValues,
} from "@leadforge/contracts";
import { AuditService } from "../audit/audit.service.js";
import { CreditsService } from "../credits/credits.service.js";
import { DiscoveryService } from "../discovery/discovery.service.js";
import { EnrichmentService } from "../enrichment/enrichment.service.js";
import { ExportsService } from "../exports/exports.service.js";
import { OrganizationsService } from "../organizations/organizations.service.js";
import { UsageDailyRepository, type UsageRow } from "./repositories/usage-daily.repository.js";

const DAY_MS = 24 * 60 * 60 * 1000;
const PERIOD_DAYS: Record<UsagePeriod, number> = { "7d": 7, "30d": 30, "90d": 90 };

/** UTC midnight of the day `d` falls on. */
export function utcDay(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

export const dayKey = (d: Date) => d.toISOString().slice(0, 10);

function emptyValues(): UsageValues {
  return Object.fromEntries(UsageMetric.options.map((m) => [m, 0])) as UsageValues;
}

/**
 * Usage aggregates. Choice: a rollup, not incremental counters. Each run recomputes whole UTC
 * days from the source records (credit captures in the PostgreSQL ledger; discovery jobs,
 * enrichment runs and export jobs in MongoDB; synchronous exports from their audit events) and
 * writes absolute values, so it is idempotent, self-healing after a missed run, and never
 * double-counts a retried event. The worker rolls up the last 2 days every 10 minutes and the
 * last 90 days once a day.
 */
@Injectable()
export class UsageService {
  constructor(
    private readonly repo: UsageDailyRepository,
    private readonly credits: CreditsService,
    private readonly discovery: DiscoveryService,
    private readonly enrichment: EnrichmentService,
    private readonly exports: ExportsService,
    private readonly audit: AuditService,
    private readonly organizations: OrganizationsService,
    private readonly logger: Logger,
  ) {}

  /** Recomputes the last `days` UTC days (today included) for one organization. */
  async rollupOrganization(
    organizationId: string,
    days: number,
    now: Date = new Date(),
  ): Promise<number> {
    const to = new Date(utcDay(now).getTime() + DAY_MS);
    const from = new Date(to.getTime() - days * DAY_MS);
    const values = new Map<string, UsageValues>();
    for (let t = from.getTime(); t < to.getTime(); t += DAY_MS)
      values.set(dayKey(new Date(t)), emptyValues());
    const add = (day: string, metric: UsageMetric, n: number) => {
      const v = values.get(day);
      if (v) v[metric] += n;
    };

    const [captured, discovery, enrichment, asyncExports, syncExports] = await Promise.all([
      this.credits.capturedByDay(organizationId, from, to),
      this.discovery.jobsPerDay(organizationId, from, to),
      this.enrichment.jobsPerDay(organizationId, from, to),
      this.exports.completedPerDay(organizationId, from, to),
      this.audit.perDay(organizationId, "export.created", from, to, "after.rowCount"),
    ]);
    for (const c of captured) {
      add(c.day, "credits_used", c.units);
      if (c.referenceType === "discovery_job") add(c.day, "discovery_records", c.units);
      if (c.referenceType === "website_analysis") add(c.day, "analyses", c.units);
    }
    for (const d of discovery) add(d.day, "discovery_jobs", d.count);
    for (const e of enrichment) add(e.day, "enrichment_runs", e.count);
    for (const x of asyncExports) {
      add(x.day, "exports", x.count);
      add(x.day, "export_rows", x.sum);
    }
    for (const x of syncExports) {
      add(x.day, "exports", x.count);
      add(x.day, "export_rows", x.sum);
    }

    const rows: UsageRow[] = [];
    for (const [day, v] of values)
      for (const metric of UsageMetric.options) rows.push({ day, metric, value: v[metric] });
    await this.repo.upsertMany(organizationId, rows, new Date());
    return rows.length;
  }

  /** Maintenance: rolls up every live organization. Errors are logged per organization. */
  async rollupAll(
    days: number,
    now: Date = new Date(),
  ): Promise<{ organizations: number; rows: number; failed: number }> {
    let after: string | null = null;
    let organizations = 0;
    let rows = 0;
    let failed = 0;
    for (;;) {
      const ids: string[] = await this.organizations.liveOrganizationIds(after, 200);
      if (ids.length === 0) break;
      for (const id of ids) {
        try {
          rows += await this.rollupOrganization(id, days, now);
          organizations += 1;
        } catch (err) {
          failed += 1;
          this.logger.error({ err, organizationId: id }, "Usage rollup failed for an organization");
        }
      }
      after = ids[ids.length - 1]!;
    }
    return { organizations, rows, failed };
  }

  /** The Usage page: a daily series and totals for the period, read from usage_daily. */
  async summary(
    organizationId: string,
    period: UsagePeriod,
    now: Date = new Date(),
  ): Promise<UsageSummary> {
    const today = utcDay(now);
    const fromDate = new Date(today.getTime() - (PERIOD_DAYS[period] - 1) * DAY_MS);
    const from = dayKey(fromDate);
    const to = dayKey(today);
    const [rows, computedAt, balance] = await Promise.all([
      this.repo.range(organizationId, from, to),
      this.repo.lastComputedAt(organizationId),
      this.credits.balance(organizationId),
    ]);
    const byDay = new Map<string, UsageValues>();
    for (let t = fromDate.getTime(); t <= today.getTime(); t += DAY_MS)
      byDay.set(dayKey(new Date(t)), emptyValues());
    const totals = emptyValues();
    for (const r of rows) {
      const metric = UsageMetric.safeParse(r.metric);
      const v = byDay.get(r.day);
      if (!metric.success || !v) continue;
      v[metric.data] = r.value;
      totals[metric.data] += r.value;
    }
    return {
      period,
      from,
      to,
      computedAt: computedAt?.toISOString() ?? null,
      metrics: [...UsageMetric.options],
      series: [...byDay].map(([day, values]) => ({ day, values })),
      totals,
      credits: { balance: balance.balance, held: balance.held },
    };
  }
}
