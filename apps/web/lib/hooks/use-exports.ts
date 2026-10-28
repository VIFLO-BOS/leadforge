"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { CreateExportRequest, ExportDownloadLink, ExportJob } from "@leadforge/contracts";
import { useWorkspace } from "@/components/app/app-shell";
import { apiFetch, isApiError } from "../api";
import { newIdempotencyKey } from "../bulk";
import { EXPORT_POLL_MS, isExportActive, sameOriginDownloadUrl } from "../exports";
import { queryKeys } from "../query-keys";
import { usePollingQuery } from "./use-polling-query";

/**
 * POST /exports (202). One Idempotency-Key per click, so a double click or a retried request
 * returns the same export instead of spending another of the hourly exports.
 */
export function useCreateExport() {
  const { org } = useWorkspace();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ body, key }: { body: CreateExportRequest; key?: string }) =>
      apiFetch<ExportJob>("/exports", {
        method: "POST",
        body,
        headers: { "Idempotency-Key": key ?? newIdempotencyKey("export") },
      }),
    onSuccess: (job) => {
      queryClient.setQueryData(queryKeys.exports.detail(org.id, job.id), job);
      void queryClient.invalidateQueries({ queryKey: queryKeys.jobs.all(org.id) });
    },
  });
}

/** GET /exports/:id, polled every 2 s while queued or running. */
export function useExportJob(id: string) {
  const { org } = useWorkspace();
  const queryClient = useQueryClient();
  const key = queryKeys.exports.detail(org.id, id);
  return usePollingQuery<ExportJob>({
    queryKey: key,
    queryFn: async () => {
      const previous = queryClient.getQueryData<ExportJob>(key);
      const job = await apiFetch<ExportJob>(`/exports/${encodeURIComponent(id)}`);
      if (previous && isExportActive(previous) && !isExportActive(job)) {
        void queryClient.invalidateQueries({ queryKey: queryKeys.jobs.all(org.id) });
        void queryClient.invalidateQueries({ queryKey: queryKeys.notifications.all(org.id) });
        void queryClient.invalidateQueries({ queryKey: ["org", org.id, "usage"] });
      }
      return job;
    },
    isActive: isExportActive,
    intervalMs: EXPORT_POLL_MS,
    retry: (count, err) => !(isApiError(err) && err.status < 500) && count < 2,
  });
}

/**
 * Asks for a fresh signed link (GET /exports/:id/download-url, valid 15 minutes and bound to this
 * user, workspace and export) and sends the browser to it. A new link is requested for every
 * download. `navigate` is injectable for tests.
 */
export function useDownloadExport(navigate?: (url: string) => void) {
  return useMutation({
    mutationFn: async (id: string) => {
      const link = await apiFetch<ExportDownloadLink>(
        `/exports/${encodeURIComponent(id)}/download-url`,
      );
      const url = sameOriginDownloadUrl(link.url);
      if (navigate) navigate(url);
      else window.location.assign(url);
      return link;
    },
  });
}
