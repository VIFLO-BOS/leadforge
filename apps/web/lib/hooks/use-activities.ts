"use client";

import {
  keepPreviousData,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from "@tanstack/react-query";
import type {
  Activity,
  CreateActivityRequest,
  CreateActivityResponse,
  LogOutreachAttemptRequest,
  LogOutreachAttemptResponse,
  OutreachRecord,
  PagedEnvelope,
  UpdateActivityRequest,
  UpdateOutreachRequest,
} from "@leadforge/contracts";
import { useWorkspace } from "@/components/app/app-shell";
import { apiFetch, apiFetchPaged, isApiError, toQueryString } from "../api";
import { isVersionConflict } from "../crm";
import { queryKeys } from "../query-keys";

function retryServerErrors(count: number, err: unknown): boolean {
  if (isApiError(err) && err.status < 500) return false;
  return count < 2;
}

/** Activity and outreach lists, leads (lastActivityAt), reports and the overview. */
export function invalidateActivityData(queryClient: QueryClient, orgId: string): void {
  void queryClient.invalidateQueries({ queryKey: queryKeys.activities.all(orgId) });
  void queryClient.invalidateQueries({ queryKey: queryKeys.outreach.all(orgId) });
  void queryClient.invalidateQueries({ queryKey: queryKeys.pipeline.all(orgId) });
  void queryClient.invalidateQueries({ queryKey: ["org", orgId, "reports"] });
}

/** GET /activities: type[], userId (author), businessId, leadId, listId, from, to, cursor. */
export function useActivities(query: Record<string, unknown>) {
  const { org } = useWorkspace();
  return useQuery({
    queryKey: queryKeys.activities.list(org.id, query),
    queryFn: () => apiFetchPaged<Activity>(`/activities${toQueryString(query)}`),
    placeholderData: keepPreviousData,
    retry: retryServerErrors,
  });
}

/** A business's activity timeline, newest first, 20 at a time ("Show older"). */
export function useBusinessActivities(businessId: string, enabled = true) {
  const { org } = useWorkspace();
  const base = { businessId, pageSize: 20 };
  return useInfiniteQuery({
    queryKey: queryKeys.activities.list(org.id, { ...base, infinite: true }),
    queryFn: ({ pageParam }) =>
      apiFetchPaged<Activity>(`/activities${toQueryString({ ...base, cursor: pageParam })}`),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last: PagedEnvelope<Activity>) => last.meta.nextCursor ?? undefined,
    enabled,
    retry: retryServerErrors,
  });
}

export function useCreateActivity() {
  const { org } = useWorkspace();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateActivityRequest) =>
      apiFetch<CreateActivityResponse>("/activities", { method: "POST", body }),
    onSuccess: () => invalidateActivityData(queryClient, org.id),
  });
}

export function useUpdateActivity() {
  const { org } = useWorkspace();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: UpdateActivityRequest }) =>
      apiFetch<Activity>(`/activities/${encodeURIComponent(id)}`, { method: "PATCH", body }),
    onSuccess: () => invalidateActivityData(queryClient, org.id),
  });
}

export function useDeleteActivity() {
  const { org } = useWorkspace();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiFetch<{ deleted: true }>(`/activities/${encodeURIComponent(id)}`, { method: "DELETE" }),
    onSuccess: () => invalidateActivityData(queryClient, org.id),
  });
}

/** GET /outreach: channel[], status[], userId (owner), businessId, listId, from, to, cursor. */
export function useOutreach(query: Record<string, unknown>, enabled = true) {
  const { org } = useWorkspace();
  return useQuery({
    queryKey: queryKeys.outreach.list(org.id, query),
    queryFn: () => apiFetchPaged<OutreachRecord>(`/outreach${toQueryString(query)}`),
    placeholderData: keepPreviousData,
    retry: retryServerErrors,
    enabled,
  });
}

/** POST /outreach/:id/attempts: one attempt on the record's channel (an activity). */
export function useLogOutreachAttempt() {
  const { org } = useWorkspace();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: LogOutreachAttemptRequest }) =>
      apiFetch<LogOutreachAttemptResponse>(`/outreach/${encodeURIComponent(id)}/attempts`, {
        method: "POST",
        body,
      }),
    onSuccess: () => invalidateActivityData(queryClient, org.id),
  });
}

/**
 * PATCH /outreach/:id with the record's `version`. A stale version (409 VERSION_CONFLICT) is not
 * retried: the record is refreshed and the caller explains, because the status someone else set
 * may already be what the user wanted.
 */
export function useUpdateOutreach() {
  const { org } = useWorkspace();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      record,
      body,
    }: {
      record: OutreachRecord;
      body: Omit<UpdateOutreachRequest, "version">;
    }) =>
      apiFetch<OutreachRecord>(`/outreach/${encodeURIComponent(record.id)}`, {
        method: "PATCH",
        body: { ...body, version: record.version },
      }),
    onSuccess: () => invalidateActivityData(queryClient, org.id),
    onError: (err) => {
      if (isVersionConflict(err)) {
        void queryClient.invalidateQueries({ queryKey: queryKeys.outreach.all(org.id) });
      }
    },
  });
}
