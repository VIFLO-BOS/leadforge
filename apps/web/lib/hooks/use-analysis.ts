"use client";

import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from "@tanstack/react-query";
import type {
  CreateAnalysisRequest,
  CreateAnalysisResponse,
  WebsiteAnalysis,
} from "@leadforge/contracts";
import { useWorkspace } from "@/components/app/app-shell";
import { apiFetch, apiFetchPaged, isApiError, toQueryString } from "../api";
import { ANALYSIS_POLL_MS, shouldPollAnalysis } from "../analysis";
import { queryKeys } from "../query-keys";
import { invalidateBusinessData } from "./use-businesses";
import { usePollingQuery } from "./use-polling-query";

function retryServerErrors(count: number, err: unknown): boolean {
  if (isApiError(err) && err.status < 500) return false;
  return count < 2;
}

/**
 * Everything a new or settled analysis can change: analysis lists, the business's latest
 * analysis and detail (opportunities, score), the all-jobs page, the credit balance and ledger,
 * notifications (a finished bulk request notifies) and the directory. Never a polled query.
 */
export function invalidateAfterAnalysisChange(
  queryClient: QueryClient,
  orgId: string,
  businessId?: string,
): void {
  void queryClient.invalidateQueries({ queryKey: queryKeys.analysis.lists(orgId) });
  void queryClient.invalidateQueries({ queryKey: queryKeys.jobs.all(orgId) });
  void queryClient.invalidateQueries({ queryKey: queryKeys.credits.all(orgId) });
  void queryClient.invalidateQueries({ queryKey: queryKeys.notifications.all(orgId) });
  if (businessId) {
    void queryClient.invalidateQueries({
      queryKey: queryKeys.analysis.forBusiness(orgId, businessId),
    });
    void queryClient.invalidateQueries({
      queryKey: queryKeys.businesses.detail(orgId, businessId),
      exact: true,
    });
  }
  invalidateBusinessData(queryClient, orgId, businessId);
}

/** GET /analysis/websites. Refreshes every 5 s while an analysis on the page is still active. */
export function useAnalyses(query: Record<string, unknown>) {
  const { org } = useWorkspace();
  return useQuery({
    queryKey: queryKeys.analysis.list(org.id, query),
    queryFn: () => apiFetchPaged<WebsiteAnalysis>(`/analysis/websites${toQueryString(query)}`),
    placeholderData: keepPreviousData,
    retry: retryServerErrors,
    refetchInterval: (q) => (q.state.data?.data.some(shouldPollAnalysis) ? 5_000 : false),
    refetchIntervalInBackground: false,
  });
}

/**
 * GET /analysis/websites/:id, polled every 2 s while queued or running and until its credit is
 * settled. On the transition to settled, dependent data is invalidated (never this query).
 */
export function useAnalysis(id: string | null | undefined) {
  const { org } = useWorkspace();
  const queryClient = useQueryClient();
  const key = queryKeys.analysis.detail(org.id, id ?? "none");
  return usePollingQuery<WebsiteAnalysis>({
    queryKey: key,
    queryFn: async () => {
      const previous = queryClient.getQueryData<WebsiteAnalysis>(key);
      const analysis = await apiFetch<WebsiteAnalysis>(
        `/analysis/websites/${encodeURIComponent(id ?? "")}`,
      );
      if (previous && shouldPollAnalysis(previous) && !shouldPollAnalysis(analysis)) {
        invalidateAfterAnalysisChange(queryClient, org.id, analysis.businessId);
      }
      return analysis;
    },
    isActive: shouldPollAnalysis,
    intervalMs: ANALYSIS_POLL_MS,
    enabled: Boolean(id),
  });
}

/**
 * GET /businesses/:id/analysis: the newest completed analysis, else the newest of any status, or
 * null when none ran. While that analysis is active the caller polls it with useAnalysis.
 */
export function useBusinessAnalysis(businessId: string, enabled = true) {
  const { org } = useWorkspace();
  return useQuery({
    queryKey: queryKeys.analysis.forBusiness(org.id, businessId),
    queryFn: () =>
      apiFetch<WebsiteAnalysis | null>(`/businesses/${encodeURIComponent(businessId)}/analysis`),
    retry: retryServerErrors,
    enabled,
  });
}

/**
 * The business's queued or running analysis, if any (GET /analysis/websites?businessId&status).
 * The business endpoint returns the newest completed analysis, so a new one is found here; the
 * caller then polls it every 2 seconds with useAnalysis.
 */
export function useActiveBusinessAnalysis(businessId: string, enabled = true) {
  const { org } = useWorkspace();
  const query = { businessId, status: ["queued", "running"], pageSize: 1 };
  return useQuery({
    queryKey: queryKeys.analysis.list(org.id, query),
    queryFn: async () =>
      (await apiFetchPaged<WebsiteAnalysis>(`/analysis/websites${toQueryString(query)}`)).data[0] ??
      null,
    retry: retryServerErrors,
    enabled,
  });
}

/**
 * POST /analysis/websites for one business or up to 50. One credit is held per new analysis;
 * businesses that already have one running are returned in `alreadyInProgress` at no cost.
 */
export function useRequestAnalysis() {
  const { org } = useWorkspace();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateAnalysisRequest) =>
      apiFetch<CreateAnalysisResponse>("/analysis/websites", { method: "POST", body }),
    onSuccess: (res, body) => {
      for (const a of res.analyses) {
        queryClient.setQueryData(queryKeys.analysis.detail(org.id, a.id), a);
      }
      const businessId = "businessId" in body ? body.businessId : undefined;
      invalidateAfterAnalysisChange(queryClient, org.id, businessId);
    },
  });
}
