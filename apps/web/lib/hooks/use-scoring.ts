"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { ScoringProfile, UpdateScoringProfileRequest } from "@leadforge/contracts";
import { useWorkspace } from "@/components/app/app-shell";
import { apiFetch } from "../api";
import { queryKeys } from "../query-keys";
import { invalidateBusinessData } from "./use-businesses";
import { usePollingQuery } from "./use-polling-query";

/** The API asks for a 2 second poll while a recompute is queued or running. */
export const RECOMPUTE_POLL_MS = 2_000;

export function isRecomputeActive(profile: Pick<ScoringProfile, "recompute">): boolean {
  return profile.recompute.status === "queued" || profile.recompute.status === "running";
}

/**
 * GET /scoring/profile (every role), polled every 2 seconds while a recompute is queued or
 * running. When the recompute finishes, scores in the directory and on business pages refetch.
 */
export function useScoringProfile() {
  const { org } = useWorkspace();
  const queryClient = useQueryClient();
  const key = queryKeys.scoring.profile(org.id);
  return usePollingQuery<ScoringProfile>({
    queryKey: key,
    queryFn: async () => {
      const previous = queryClient.getQueryData<ScoringProfile>(key);
      const profile = await apiFetch<ScoringProfile>("/scoring/profile");
      if (previous && isRecomputeActive(previous) && !isRecomputeActive(profile)) {
        invalidateBusinessData(queryClient, org.id);
        void queryClient.invalidateQueries({ queryKey: queryKeys.businesses.all(org.id) });
      }
      return profile;
    },
    isActive: isRecomputeActive,
    intervalMs: RECOMPUTE_POLL_MS,
  });
}

/** PATCH /scoring/profile with the version the editor loaded (409 CONFLICT when stale). */
export function useUpdateScoringProfile() {
  const { org } = useWorkspace();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: UpdateScoringProfileRequest) =>
      apiFetch<ScoringProfile>("/scoring/profile", { method: "PATCH", body }),
    // The response carries the queued recompute, which restarts polling.
    onSuccess: (profile) => queryClient.setQueryData(queryKeys.scoring.profile(org.id), profile),
  });
}

/** POST /scoring/recompute: recompute every score with the current profile. */
export function useRecomputeScores() {
  const { org } = useWorkspace();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => apiFetch<ScoringProfile>("/scoring/recompute", { method: "POST" }),
    onSuccess: (profile) => queryClient.setQueryData(queryKeys.scoring.profile(org.id), profile),
  });
}
