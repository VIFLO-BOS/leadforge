"use client";

import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from "@tanstack/react-query";
import type {
  DedupScanResponse,
  DuplicateCandidate,
  MergeRecord,
  MergeRequestInput,
  MergeResponse,
} from "@leadforge/contracts";
import { useWorkspace } from "@/components/app/app-shell";
import { apiFetch, apiFetchPaged, isApiError, toQueryString } from "../api";
import { queryKeys } from "../query-keys";
import { invalidateBusinessData } from "./use-businesses";

function retryServerErrors(count: number, err: unknown): boolean {
  if (isApiError(err) && err.status < 500) return false;
  return count < 2;
}

/**
 * A merge or an undo changes both businesses (one disappears or comes back), the directory,
 * facets, every candidate list and the merge history.
 */
export function invalidateAfterDedupChange(
  queryClient: QueryClient,
  orgId: string,
  businessIds: string[] = [],
): void {
  void queryClient.invalidateQueries({ queryKey: queryKeys.dedup.all(orgId) });
  for (const id of businessIds) {
    void queryClient.invalidateQueries({
      queryKey: queryKeys.businesses.detail(orgId, id),
    });
  }
  invalidateBusinessData(queryClient, orgId);
}

/** GET /dedup/candidates (default status pending), highest score first. */
export function useCandidates(query: Record<string, unknown>, enabled = true) {
  const { org } = useWorkspace();
  return useQuery({
    queryKey: queryKeys.dedup.candidates(org.id, query),
    queryFn: () => apiFetchPaged<DuplicateCandidate>(`/dedup/candidates${toQueryString(query)}`),
    placeholderData: keepPreviousData,
    retry: retryServerErrors,
    enabled,
  });
}

export function useCandidate(id: string, enabled = true) {
  const { org } = useWorkspace();
  return useQuery({
    queryKey: queryKeys.dedup.candidate(org.id, id),
    queryFn: () => apiFetch<DuplicateCandidate>(`/dedup/candidates/${encodeURIComponent(id)}`),
    retry: retryServerErrors,
    enabled,
  });
}

/** GET /dedup/merges (newest first), optionally for one business (survivor or merged). */
export function useMerges(query: Record<string, unknown>, enabled = true) {
  const { org } = useWorkspace();
  return useQuery({
    queryKey: queryKeys.dedup.merges(org.id, query),
    queryFn: () => apiFetchPaged<MergeRecord>(`/dedup/merges${toQueryString(query)}`),
    placeholderData: keepPreviousData,
    retry: retryServerErrors,
    enabled,
  });
}

/** POST /dedup/candidates/:id/merge. Not optimistic: the server combines the records. */
export function useMergeCandidate(candidate: Pick<DuplicateCandidate, "id" | "businessIds">) {
  const { org } = useWorkspace();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: MergeRequestInput) =>
      apiFetch<MergeResponse>(`/dedup/candidates/${encodeURIComponent(candidate.id)}/merge`, {
        method: "POST",
        body,
      }),
    onSuccess: (res) => {
      queryClient.setQueryData(queryKeys.dedup.candidate(org.id, candidate.id), res.candidate);
      invalidateAfterDedupChange(queryClient, org.id, [...candidate.businessIds]);
    },
    onError: (err) => {
      // 409s mean the pair moved on (decided, merged elsewhere, or changed): show the new state.
      if (isApiError(err) && (err.status === 409 || err.status === 404)) {
        void queryClient.invalidateQueries({ queryKey: queryKeys.dedup.all(org.id) });
      }
    },
  });
}

function useDecision(candidateId: string, action: "reject" | "defer") {
  const { org } = useWorkspace();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () =>
      apiFetch<DuplicateCandidate>(
        `/dedup/candidates/${encodeURIComponent(candidateId)}/${action}`,
        { method: "POST" },
      ),
    onSuccess: (candidate) => {
      queryClient.setQueryData(queryKeys.dedup.candidate(org.id, candidateId), candidate);
      invalidateAfterDedupChange(queryClient, org.id, [...candidate.businessIds]);
    },
    onError: (err) => {
      if (isApiError(err) && (err.status === 409 || err.status === 404)) {
        void queryClient.invalidateQueries({ queryKey: queryKeys.dedup.all(org.id) });
      }
    },
  });
}

/** POST /dedup/candidates/:id/reject: not the same business; never proposed again. */
export function useRejectCandidate(candidateId: string) {
  return useDecision(candidateId, "reject");
}

/** POST /dedup/candidates/:id/defer: decide later. */
export function useDeferCandidate(candidateId: string) {
  return useDecision(candidateId, "defer");
}

/**
 * POST /dedup/merges/:id/undo. Without `force`, a record that changed after the merge answers
 * 409 MERGE_CONFLICT; the caller explains and offers `force: true`.
 */
export function useUndoMerge() {
  const { org } = useWorkspace();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ merge, force }: { merge: MergeRecord; force?: boolean }) =>
      apiFetch<MergeRecord>(`/dedup/merges/${encodeURIComponent(merge.id)}/undo`, {
        method: "POST",
        body: force ? { force: true } : {},
      }),
    onSuccess: (record) => {
      invalidateAfterDedupChange(queryClient, org.id, [record.survivorId, ...record.mergedIds]);
    },
    onError: (err) => {
      if (isApiError(err) && err.code !== "MERGE_CONFLICT" && err.status === 409) {
        void queryClient.invalidateQueries({ queryKey: queryKeys.dedup.all(org.id) });
      }
    },
  });
}

/** POST /dedup/scan: look for candidates among these businesses, or the whole organization. */
export function useDedupScan() {
  const { org } = useWorkspace();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (businessIds?: string[]) =>
      apiFetch<DedupScanResponse>("/dedup/scan", {
        method: "POST",
        body: businessIds?.length ? { businessIds } : {},
      }),
    onSuccess: () => {
      // The worker adds candidates shortly; refetch once it has had a moment.
      window.setTimeout(
        () => void queryClient.invalidateQueries({ queryKey: queryKeys.dedup.all(org.id) }),
        4_000,
      );
    },
  });
}
