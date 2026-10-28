"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import type {
  ActivitySummary,
  JobsTimeline,
  PipelineFunnel,
  QualityDistribution,
  ReportPeriod,
  SourceBreakdown,
  UsagePeriod,
  UsageSummary,
} from "@leadforge/contracts";
import { useWorkspace } from "@/components/app/app-shell";
import { apiFetch, isApiError } from "../api";
import { queryKeys } from "../query-keys";
import { usePermissions } from "./use-permissions";

function retryServerErrors(count: number, err: unknown): boolean {
  if (isApiError(err) && err.status < 500) return false;
  return count < 2;
}

interface ReportShapes {
  "source-breakdown": SourceBreakdown;
  "quality-distribution": QualityDistribution;
  "jobs-timeline": JobsTimeline;
  "pipeline-funnel": PipelineFunnel;
  "activity-summary": ActivitySummary;
}

/** Jobs over time needs a bounded window: "all" is shown as the last 90 days. */
export function timelinePeriod(period: ReportPeriod): Exclude<ReportPeriod, "all"> {
  return period === "all" ? "90d" : period;
}

/** GET /reports/<name>?period. Every role can read reports. */
export function useReport<N extends keyof ReportShapes>(name: N, period: ReportPeriod) {
  const { org } = useWorkspace();
  const p = name === "jobs-timeline" ? timelinePeriod(period) : period;
  return useQuery({
    queryKey: queryKeys.report(org.id, name, p),
    queryFn: () => apiFetch<ReportShapes[N]>(`/reports/${name}?period=${p}`),
    placeholderData: keepPreviousData,
    retry: retryServerErrors,
  });
}

/** GET /usage?period: daily usage from the rollup plus totals (not for sales representatives). */
export function useUsageSummary(period: UsagePeriod) {
  const { org } = useWorkspace();
  const { can } = usePermissions();
  return useQuery({
    queryKey: queryKeys.usage(org.id, period),
    queryFn: () => apiFetch<UsageSummary>(`/usage?period=${period}`),
    placeholderData: keepPreviousData,
    retry: retryServerErrors,
    enabled: can("usage:read"),
  });
}
