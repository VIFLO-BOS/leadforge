"use client";

import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  BulkOperation,
  BulkOperationItem,
  BulkOperationRequest,
  BulkPreview,
} from "@leadforge/contracts";
import { useWorkspace } from "@/components/app/app-shell";
import { apiFetch, apiFetchPaged, isApiError, toQueryString } from "../api";
import { BULK_POLL_MS, isBulkActive } from "../bulk";
import { queryKeys } from "../query-keys";
import { invalidateBusinessData } from "./use-businesses";
import { usePollingQuery } from "./use-polling-query";

function retryServerErrors(count: number, err: unknown): boolean {
  if (isApiError(err) && err.status < 500) return false;
  return count < 2;
}

/** POST /bulk-operations/preview: what confirming would do. Nothing is written. */
export function useBulkPreview() {
  return useMutation({
    mutationFn: (body: BulkOperationRequest) =>
      apiFetch<BulkPreview>("/bulk-operations/preview", { method: "POST", body }),
  });
}

/**
 * POST /bulk-operations with the Idempotency-Key chosen for this confirmation (the caller keeps
 * it for retries of the same confirmation, so a network failure replays to the same operation).
 */
export function useCreateBulkOperation() {
  const { org } = useWorkspace();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ body, key }: { body: BulkOperationRequest; key: string }) =>
      apiFetch<BulkOperation>("/bulk-operations", {
        method: "POST",
        body,
        headers: { "Idempotency-Key": key },
      }),
    onSuccess: (op) => {
      queryClient.setQueryData(queryKeys.bulk.detail(org.id, op.id), op);
      void queryClient.invalidateQueries({ queryKey: queryKeys.jobs.all(org.id) });
    },
  });
}

/**
 * GET /bulk-operations/:id, polled every 1.5 s while queued or running. When it finishes, what it
 * changed is refreshed (lists, pipeline, directory, jobs, notifications), never this query.
 */
export function useBulkOperation(id: string) {
  const { org } = useWorkspace();
  const queryClient = useQueryClient();
  const key = queryKeys.bulk.detail(org.id, id);
  return usePollingQuery<BulkOperation>({
    queryKey: key,
    queryFn: async () => {
      const previous = queryClient.getQueryData<BulkOperation>(key);
      const op = await apiFetch<BulkOperation>(`/bulk-operations/${encodeURIComponent(id)}`);
      if (previous && isBulkActive(previous) && !isBulkActive(op)) {
        void queryClient.invalidateQueries({ queryKey: queryKeys.lists.all(org.id) });
        void queryClient.invalidateQueries({ queryKey: queryKeys.pipeline.all(org.id) });
        void queryClient.invalidateQueries({ queryKey: queryKeys.activities.all(org.id) });
        void queryClient.invalidateQueries({ queryKey: queryKeys.jobs.all(org.id) });
        void queryClient.invalidateQueries({ queryKey: queryKeys.notifications.all(org.id) });
        void queryClient.invalidateQueries({ queryKey: ["org", org.id, "bulk", "items", id] });
        invalidateBusinessData(queryClient, org.id);
      }
      return op;
    },
    isActive: isBulkActive,
    intervalMs: BULK_POLL_MS,
    retry: retryServerErrors,
  });
}

/** GET /bulk-operations/:id/items (per-business results, kept 30 days). Refreshes while running. */
export function useBulkItems(id: string, query: Record<string, unknown>, active: boolean) {
  const { org } = useWorkspace();
  return useQuery({
    queryKey: queryKeys.bulk.items(org.id, id, query),
    queryFn: () =>
      apiFetchPaged<BulkOperationItem>(
        `/bulk-operations/${encodeURIComponent(id)}/items${toQueryString(query)}`,
      ),
    placeholderData: keepPreviousData,
    retry: retryServerErrors,
    refetchInterval: active ? 4_000 : false,
    refetchIntervalInBackground: false,
  });
}
