"use client";

import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from "@tanstack/react-query";
import type {
  CreateLeadListRequest,
  LeadList,
  LeadListItem,
  ListItemsResult,
  UpdateLeadListRequest,
} from "@leadforge/contracts";
import { useWorkspace } from "@/components/app/app-shell";
import { apiFetch, apiFetchPaged, isApiError, toQueryString } from "../api";
import { queryKeys } from "../query-keys";

function retryServerErrors(count: number, err: unknown): boolean {
  if (isApiError(err) && err.status < 500) return false;
  return count < 2;
}

/** Lists, their items, and what list membership feeds: the pipeline's list filter and reports. */
export function invalidateListData(queryClient: QueryClient, orgId: string): void {
  void queryClient.invalidateQueries({ queryKey: queryKeys.lists.all(orgId) });
  void queryClient.invalidateQueries({ queryKey: queryKeys.pipeline.all(orgId) });
}

/** GET /lists: name prefix `q`, owner, `businessId` (lists containing it), sort, cursor. */
export function useLeadLists(query: Record<string, unknown>, enabled = true) {
  const { org } = useWorkspace();
  return useQuery({
    queryKey: queryKeys.lists.list(org.id, query),
    queryFn: () => apiFetchPaged<LeadList>(`/lists${toQueryString(query)}`),
    placeholderData: keepPreviousData,
    retry: retryServerErrors,
    enabled,
  });
}

export function useLeadList(id: string | null | undefined) {
  const { org } = useWorkspace();
  return useQuery({
    queryKey: queryKeys.lists.detail(org.id, id ?? "none"),
    queryFn: () => apiFetch<LeadList>(`/lists/${encodeURIComponent(id ?? "")}`),
    retry: retryServerErrors,
    enabled: Boolean(id),
  });
}

/** GET /lists/:id/items, newest first, with the directory row and the lead of each business. */
export function useListItems(id: string, query: Record<string, unknown>) {
  const { org } = useWorkspace();
  return useQuery({
    queryKey: queryKeys.lists.items(org.id, id, query),
    queryFn: () =>
      apiFetchPaged<LeadListItem>(`/lists/${encodeURIComponent(id)}/items${toQueryString(query)}`),
    placeholderData: keepPreviousData,
    retry: retryServerErrors,
  });
}

export function useCreateList() {
  const { org } = useWorkspace();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateLeadListRequest) =>
      apiFetch<LeadList>("/lists", { method: "POST", body }),
    onSuccess: (list) => {
      queryClient.setQueryData(queryKeys.lists.detail(org.id, list.id), list);
      invalidateListData(queryClient, org.id);
    },
  });
}

export function useUpdateList() {
  const { org } = useWorkspace();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: UpdateLeadListRequest }) =>
      apiFetch<LeadList>(`/lists/${encodeURIComponent(id)}`, { method: "PATCH", body }),
    onSuccess: (list) => {
      queryClient.setQueryData(queryKeys.lists.detail(org.id, list.id), list);
      invalidateListData(queryClient, org.id);
    },
  });
}

export function useDeleteList() {
  const { org } = useWorkspace();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiFetch<{ deleted: true; items: number }>(`/lists/${encodeURIComponent(id)}`, {
        method: "DELETE",
      }),
    onSuccess: (_res, id) => {
      queryClient.removeQueries({ queryKey: queryKeys.lists.detail(org.id, id) });
      invalidateListData(queryClient, org.id);
    },
  });
}

/** POST /lists/:id/items (add) or /items/remove, at most 100 businesses per request. */
export function useListItemsChange(mode: "add" | "remove") {
  const { org } = useWorkspace();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ listId, businessIds }: { listId: string; businessIds: string[] }) =>
      apiFetch<ListItemsResult>(
        `/lists/${encodeURIComponent(listId)}/items${mode === "remove" ? "/remove" : ""}`,
        { method: "POST", body: { businessIds } },
      ),
    onSuccess: (res) => {
      queryClient.setQueryData(queryKeys.lists.detail(org.id, res.list.id), res.list);
      invalidateListData(queryClient, org.id);
    },
  });
}
