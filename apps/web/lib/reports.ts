import type { HistogramBucket } from "@leadforge/contracts";

/** Chart rows for the reports and overview (`@leadforge/ui/charts` ChartRow shape). */
export type ReportRow = Record<string, string | number | null>;

/** "0–9", "10–19", …, "90–100". */
export function bucketLabel(b: HistogramBucket): string {
  return `${b.min}–${b.max}`;
}

/** One row per 10-point band; empty when nothing is scored, so the chart shows its empty state. */
export function histogramRows(buckets: HistogramBucket[]): ReportRow[] {
  return buckets.some((b) => b.count > 0)
    ? buckets.map((b) => ({ range: bucketLabel(b), businesses: b.count }))
    : [];
}

const dayFormat = new Intl.DateTimeFormat(undefined, {
  day: "numeric",
  month: "short",
  timeZone: "UTC",
});

/** A UTC day ("2026-10-20") as "20 Oct". */
export function formatDay(day: string | number): string {
  const d = new Date(`${day}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? String(day) : dayFormat.format(d);
}
