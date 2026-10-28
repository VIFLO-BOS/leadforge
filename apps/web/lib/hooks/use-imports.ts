"use client";

import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  ImportCommitRequest,
  ImportJob,
  ImportPreviewRequest,
  ImportPreviewResponse,
  ImportRowResult,
  ImportStatus,
} from "@leadforge/contracts";
import { useWorkspace } from "@/components/app/app-shell";
import { apiFetch, apiFetchPaged, apiUpload, isApiError, toQueryString } from "../api";
import { queryKeys } from "../query-keys";
import { usePollingQuery } from "./use-polling-query";
import { invalidateBusinessData } from "./use-businesses";

const ACTIVE: ImportStatus[] = ["queued", "processing"];

export function isImportActive(job: Pick<ImportJob, "status">): boolean {
  return ACTIVE.includes(job.status);
}

export function isImportFinished(job: Pick<ImportJob, "status">): boolean {
  return (
    job.status === "completed" || job.status === "completed_with_errors" || job.status === "failed"
  );
}

/** GET /imports/:id, polled every 1.5 s while the worker has it queued or processing. */
export function useImportJob(id: string | null) {
  const { org } = useWorkspace();
  const queryClient = useQueryClient();
  const key = queryKeys.imports.detail(org.id, id ?? "none");
  return usePollingQuery<ImportJob>({
    queryKey: key,
    queryFn: async () => {
      const previous = queryClient.getQueryData<ImportJob>(key);
      const job = await apiFetch<ImportJob>(`/imports/${encodeURIComponent(id ?? "")}`);
      if (previous && isImportActive(previous) && isImportFinished(job)) {
        // Rows landed: directory, facets, overview and the recent-imports list are now stale.
        // (Only the list is invalidated here, never this detail query, which is mid-fetch.)
        invalidateBusinessData(queryClient, org.id);
        void queryClient.invalidateQueries({ queryKey: queryKeys.imports.list(org.id) });
      }
      return job;
    },
    isActive: isImportActive,
    enabled: Boolean(id),
  });
}

export function useRecentImports(pageSize = 10) {
  const { org } = useWorkspace();
  return useQuery({
    queryKey: queryKeys.imports.list(org.id, { pageSize }),
    queryFn: () => apiFetchPaged<ImportJob>(`/imports${toQueryString({ pageSize })}`),
    retry: (count, err) => !(isApiError(err) && err.status < 500) && count < 2,
  });
}

export function useImportRows(
  id: string,
  params: { outcome?: string; cursor?: string; pageSize?: number },
  enabled = true,
) {
  const { org } = useWorkspace();
  return useQuery({
    queryKey: queryKeys.imports.rows(org.id, id, params),
    queryFn: () =>
      apiFetchPaged<ImportRowResult>(
        `/imports/${encodeURIComponent(id)}/rows${toQueryString({ pageSize: 25, ...params })}`,
      ),
    placeholderData: keepPreviousData,
    enabled,
  });
}

export function useUploadImport() {
  const { org } = useWorkspace();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      file,
      onProgress,
      signal,
    }: {
      file: File;
      onProgress?: (sent: number, total: number) => void;
      signal?: AbortSignal;
    }) => {
      const form = new FormData();
      form.append("file", file, file.name);
      return apiUpload<ImportJob>("/imports", form, { onProgress, signal });
    },
    onSuccess: (job) => {
      queryClient.setQueryData(queryKeys.imports.detail(org.id, job.id), job);
      void queryClient.invalidateQueries({ queryKey: queryKeys.imports.all(org.id) });
    },
  });
}

export function usePreviewImport(id: string) {
  return useMutation({
    mutationFn: (body: ImportPreviewRequest) =>
      apiFetch<ImportPreviewResponse>(`/imports/${encodeURIComponent(id)}/preview`, {
        method: "POST",
        body,
      }),
  });
}

export function useCommitImport(id: string) {
  const { org } = useWorkspace();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: ImportCommitRequest) =>
      apiFetch<ImportJob>(`/imports/${encodeURIComponent(id)}/commit`, { method: "POST", body }),
    onSuccess: (job) => {
      queryClient.setQueryData(queryKeys.imports.detail(org.id, job.id), job);
      void queryClient.invalidateQueries({ queryKey: queryKeys.imports.list(org.id) });
    },
  });
}
