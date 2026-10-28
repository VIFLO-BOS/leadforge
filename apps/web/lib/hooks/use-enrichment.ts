"use client";

import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import type { EnrichmentRun, PagedEnvelope, RefreshResponse } from "@leadforge/contracts";
import { useWorkspace } from "@/components/app/app-shell";
import { apiFetch, apiFetchPaged, isApiError } from "../api";
import { queryKeys } from "../query-keys";
import { invalidateAfterAnalysisChange } from "./use-analysis";
import { invalidateBusinessData } from "./use-businesses";

/** The API asks for a 2 second poll while a run is queued or running. */
export const ENRICHMENT_POLL_MS = 2_000;

export function isRunActive(run: Pick<EnrichmentRun, "status">): boolean {
  return run.status === "queued" || run.status === "running";
}

function retryServerErrors(count: number, err: unknown): boolean {
  if (isApiError(err) && err.status < 500) return false;
  return count < 2;
}

/** A run that finished can change contacts, states, verification history and the score. */
export function invalidateAfterEnrichment(
  queryClient: QueryClient,
  orgId: string,
  businessId: string,
): void {
  void queryClient.invalidateQueries({
    queryKey: queryKeys.businesses.detail(orgId, businessId),
    exact: true,
  });
  void queryClient.invalidateQueries({ queryKey: queryKeys.jobs.all(orgId) });
  void queryClient.invalidateQueries({ queryKey: queryKeys.dedup.all(orgId) });
  invalidateBusinessData(queryClient, orgId, businessId);
}

/**
 * GET /businesses/:id/enrichment-runs (newest first, first page). Polls every 2 seconds while any
 * listed run is active; when the last active run finishes, the business detail refetches so new
 * observations, states and checks appear.
 */
export function useEnrichmentRuns(businessId: string, enabled = true) {
  const { org } = useWorkspace();
  const queryClient = useQueryClient();
  const key = queryKeys.enrichment.forBusiness(org.id, businessId);
  return useQuery({
    queryKey: key,
    queryFn: async () => {
      const previous = queryClient.getQueryData<PagedEnvelope<EnrichmentRun>>(key);
      const page = await apiFetchPaged<EnrichmentRun>(
        `/businesses/${encodeURIComponent(businessId)}/enrichment-runs?pageSize=10`,
      );
      const wasActive = previous?.data.some(isRunActive) ?? false;
      if (wasActive && !page.data.some(isRunActive)) {
        invalidateAfterEnrichment(queryClient, org.id, businessId);
      }
      return page;
    },
    retry: retryServerErrors,
    enabled,
    staleTime: 0,
    refetchInterval: (q) => (q.state.data?.data.some(isRunActive) ? ENRICHMENT_POLL_MS : false),
    refetchIntervalInBackground: false,
  });
}

function useRunMutation<TVars>(
  businessId: string,
  request: (vars: TVars) => Promise<EnrichmentRun>,
) {
  const { org } = useWorkspace();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: request,
    onSuccess: (run) => {
      // Put the new (or already running) run at the top so polling starts at once.
      const key = queryKeys.enrichment.forBusiness(org.id, businessId);
      queryClient.setQueryData<PagedEnvelope<EnrichmentRun>>(key, (old) =>
        old
          ? { ...old, data: [run, ...old.data.filter((r) => r.id !== run.id)] }
          : { data: [run], meta: { nextCursor: null, pageSize: 10 } },
      );
      queryClient.setQueryData(queryKeys.enrichment.run(org.id, run.id), run);
      void queryClient.invalidateQueries({ queryKey: queryKeys.jobs.all(org.id) });
    },
  });
}

/** POST /enrichment/businesses/:id/website-contacts (free). */
export function useFindWebsiteContacts(businessId: string) {
  return useRunMutation<void>(businessId, () =>
    apiFetch<EnrichmentRun>(
      `/enrichment/businesses/${encodeURIComponent(businessId)}/website-contacts`,
      { method: "POST" },
    ),
  );
}

/** POST /enrichment/businesses/:id/check-email for one address already on the business (free). */
export function useCheckEmail(businessId: string) {
  return useRunMutation<string>(businessId, (address) =>
    apiFetch<EnrichmentRun>(
      `/enrichment/businesses/${encodeURIComponent(businessId)}/check-email`,
      {
        method: "POST",
        body: { address },
      },
    ),
  );
}

/**
 * POST /businesses/:id/refresh: a website-contacts run (free) plus a website analysis (1 credit
 * held, or the analysis already in progress).
 */
export function useRefreshBusiness(businessId: string) {
  const { org } = useWorkspace();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () =>
      apiFetch<RefreshResponse>(`/businesses/${encodeURIComponent(businessId)}/refresh`, {
        method: "POST",
      }),
    onSuccess: (res) => {
      const key = queryKeys.enrichment.forBusiness(org.id, businessId);
      queryClient.setQueryData<PagedEnvelope<EnrichmentRun>>(key, (old) =>
        old
          ? {
              ...old,
              data: [res.enrichmentRun, ...old.data.filter((r) => r.id !== res.enrichmentRun.id)],
            }
          : { data: [res.enrichmentRun], meta: { nextCursor: null, pageSize: 10 } },
      );
      queryClient.setQueryData(queryKeys.analysis.detail(org.id, res.analysis.id), res.analysis);
      // The business's "latest analysis" stays the newest completed one; the new analysis shows
      // up through the active-analysis list, which this refetches.
      invalidateAfterAnalysisChange(queryClient, org.id, businessId);
    },
  });
}
