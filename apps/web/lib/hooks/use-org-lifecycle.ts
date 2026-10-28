"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  ExportDownloadLink,
  OrganizationDataExport,
  OrganizationDeletionStatus,
  OrganizationProfile,
  RequestOrganizationDeletion,
} from "@leadforge/contracts";
import { useWorkspace } from "@/components/app/app-shell";
import { apiFetch, apiFetchPaged, isApiError } from "../api";
import { newIdempotencyKey } from "../bulk";
import { sameOriginDownloadUrl } from "../exports";
import { activeExportIdFrom, isOrgExportActive, ORG_EXPORT_POLL_MS } from "../org-lifecycle";
import { queryKeys } from "../query-keys";
import { ME_QUERY_KEY } from "./use-me";
import { usePollingQuery } from "./use-polling-query";

/**
 * GET /organizations/current. Shared by the profile form and the deletion banner (same key), read
 * again when the window regains focus and every 5 minutes, so a deletion requested or cancelled by
 * another owner shows up without a reload.
 */
export function useOrgProfile(options: { enabled?: boolean } = {}) {
  const { org } = useWorkspace();
  return useQuery({
    queryKey: queryKeys.orgProfile(org.id),
    queryFn: () => apiFetch<OrganizationProfile>("/organizations/current"),
    enabled: options.enabled ?? true,
    refetchOnWindowFocus: true,
    refetchInterval: 5 * 60_000,
    retry: (count, err) => !(isApiError(err) && err.status < 500) && count < 1,
  });
}

/** After a request or a cancellation: the profile, the membership list (banner) and notifications. */
function useInvalidateLifecycle() {
  const { org } = useWorkspace();
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.orgProfile(org.id) });
    void queryClient.invalidateQueries({ queryKey: ME_QUERY_KEY });
    void queryClient.invalidateQueries({ queryKey: queryKeys.notifications.all(org.id) });
  };
}

/** POST /organizations/current/deletion-requests (owner): typed name plus the current password. */
export function useRequestDeletion() {
  const { org } = useWorkspace();
  const queryClient = useQueryClient();
  const invalidate = useInvalidateLifecycle();
  return useMutation({
    mutationFn: (body: RequestOrganizationDeletion) =>
      apiFetch<OrganizationDeletionStatus>("/organizations/current/deletion-requests", {
        method: "POST",
        body,
      }),
    onSuccess: (status) => {
      queryClient.setQueryData<OrganizationProfile>(queryKeys.orgProfile(org.id), (p) =>
        p
          ? { ...p, deletionRequestedAt: status.deletionRequestedAt, purgeAfter: status.purgeAfter }
          : p,
      );
      invalidate();
    },
  });
}

/** DELETE /organizations/current/deletion-requests (owner): keeps the organization. */
export function useCancelDeletion() {
  const { org } = useWorkspace();
  const queryClient = useQueryClient();
  const invalidate = useInvalidateLifecycle();
  return useMutation({
    mutationFn: () =>
      apiFetch<null>("/organizations/current/deletion-requests", { method: "DELETE" }),
    onSuccess: () => {
      queryClient.setQueryData<OrganizationProfile>(queryKeys.orgProfile(org.id), (p) =>
        p ? { ...p, deletionRequestedAt: null, purgeAfter: null } : p,
      );
      invalidate();
    },
  });
}

/** GET /organizations/current/data-exports (owner): the newest exports, newest first. */
export function useOrgDataExports(enabled: boolean) {
  const { org } = useWorkspace();
  return useQuery({
    queryKey: queryKeys.orgExports.list(org.id),
    queryFn: () => apiFetchPaged<OrganizationDataExport>("/organizations/current/data-exports"),
    enabled,
    retry: (count, err) => !(isApiError(err) && err.status < 500) && count < 1,
  });
}

/** GET /organizations/current/data-exports/:id, polled every 2 s while queued or running. */
export function useOrgDataExport(id: string | null) {
  const { org } = useWorkspace();
  const queryClient = useQueryClient();
  const key = queryKeys.orgExports.detail(org.id, id ?? "none");
  return usePollingQuery<OrganizationDataExport>({
    queryKey: key,
    queryFn: async () => {
      const previous = queryClient.getQueryData<OrganizationDataExport>(key);
      const next = await apiFetch<OrganizationDataExport>(
        `/organizations/current/data-exports/${encodeURIComponent(id ?? "")}`,
      );
      if (previous && isOrgExportActive(previous) && !isOrgExportActive(next)) {
        void queryClient.invalidateQueries({ queryKey: queryKeys.orgExports.list(org.id) });
        void queryClient.invalidateQueries({ queryKey: queryKeys.notifications.all(org.id) });
      }
      return next;
    },
    enabled: Boolean(id),
    isActive: isOrgExportActive,
    intervalMs: ORG_EXPORT_POLL_MS,
    retry: (count, err) => !(isApiError(err) && err.status < 500) && count < 2,
  });
}

/**
 * POST /organizations/current/data-exports (202). One Idempotency-Key per click. A 409 CONFLICT
 * names the export already being built (`activeExportId`); the caller follows that one instead.
 */
export function useCreateOrgDataExport() {
  const { org } = useWorkspace();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () =>
      apiFetch<OrganizationDataExport>("/organizations/current/data-exports", {
        method: "POST",
        headers: { "Idempotency-Key": newIdempotencyKey("org-export") },
      }),
    onSuccess: (e) => {
      queryClient.setQueryData(queryKeys.orgExports.detail(org.id, e.id), e);
      void queryClient.invalidateQueries({ queryKey: queryKeys.orgExports.list(org.id) });
    },
    onError: (err) => {
      if (activeExportIdFrom(err))
        void queryClient.invalidateQueries({ queryKey: queryKeys.orgExports.list(org.id) });
    },
  });
}

/**
 * A fresh signed link for every download (GET …/download-url, valid 15 minutes and bound to this
 * owner, workspace and export), then the browser goes to it. `navigate` is injectable for tests.
 */
export function useDownloadOrgDataExport(navigate?: (url: string) => void) {
  return useMutation({
    mutationFn: async (id: string) => {
      const link = await apiFetch<ExportDownloadLink>(
        `/organizations/current/data-exports/${encodeURIComponent(id)}/download-url`,
      );
      const url = sameOriginDownloadUrl(link.url);
      if (navigate) navigate(url);
      else window.location.assign(url);
      return link;
    },
  });
}
