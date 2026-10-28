"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import type { CreditBalance, CreditLedgerEntry, JobSummary } from "@leadforge/contracts";
import { useWorkspace } from "@/components/app/app-shell";
import { apiFetch, apiFetchPaged, isApiError, toQueryString } from "../api";
import { queryKeys } from "../query-keys";
import { usePermissions } from "./use-permissions";

function retryServerErrors(count: number, err: unknown): boolean {
  if (isApiError(err) && err.status < 500) return false;
  return count < 2;
}

/**
 * GET /credits/balance (every role). The browser never computes a balance: this is the ledger's
 * figure, refreshed on focus and whenever a discovery job is created or settles.
 */
export function useCreditBalance(enabled = true) {
  const { org } = useWorkspace();
  return useQuery({
    queryKey: queryKeys.credits.balance(org.id),
    queryFn: () => apiFetch<CreditBalance>("/credits/balance"),
    staleTime: 30_000,
    refetchOnWindowFocus: true,
    retry: retryServerErrors,
    enabled,
  });
}

/** GET /credits/ledger (owner, admin, researcher, analyst; not sales reps). */
export function useCreditLedger(query: Record<string, unknown>) {
  const { org } = useWorkspace();
  const { can } = usePermissions();
  return useQuery({
    queryKey: queryKeys.credits.ledger(org.id, query),
    queryFn: () => apiFetchPaged<CreditLedgerEntry>(`/credits/ledger${toQueryString(query)}`),
    placeholderData: keepPreviousData,
    retry: retryServerErrors,
    enabled: can("usage:read"),
  });
}

/** GET /jobs: every background job kind with normalized statuses. Refreshes while any is active. */
export function useAllJobs(query: Record<string, unknown>) {
  const { org } = useWorkspace();
  return useQuery({
    queryKey: queryKeys.jobs.list(org.id, query),
    queryFn: () => apiFetchPaged<JobSummary>(`/jobs${toQueryString(query)}`),
    placeholderData: keepPreviousData,
    retry: retryServerErrors,
    refetchInterval: (q) =>
      q.state.data?.data.some((j) => j.status === "queued" || j.status === "running")
        ? 5_000
        : false,
    refetchIntervalInBackground: false,
  });
}
