"use client";

import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  type InfiniteData,
} from "@tanstack/react-query";
import type {
  Notification,
  NotificationPreferences,
  NotificationUnreadCount,
  PagedEnvelope,
  UpdateNotificationPreferences,
} from "@leadforge/contracts";
import { useWorkspace } from "@/components/app/app-shell";
import { apiFetch, apiFetchPaged, isApiError, toQueryString } from "../api";
import { queryKeys } from "../query-keys";

/** Gentle unread-count polling (the API suggests about 30 s); also refetched on window focus. */
export const UNREAD_POLL_MS = 45_000;
export const NOTIFICATION_PAGE_SIZE = 20;

function retryServerErrors(count: number, err: unknown): boolean {
  if (isApiError(err) && err.status < 500) return false;
  return count < 2;
}

export function useUnreadCount() {
  const { org } = useWorkspace();
  return useQuery({
    queryKey: queryKeys.notifications.unreadCount(org.id),
    queryFn: () => apiFetch<NotificationUnreadCount>("/notifications/unread-count"),
    refetchInterval: UNREAD_POLL_MS,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
    staleTime: 10_000,
    retry: retryServerErrors,
  });
}

/** GET /notifications, newest first, loaded page by page while the panel is open. */
export function useNotificationList(unreadOnly: boolean, enabled: boolean) {
  const { org } = useWorkspace();
  const filter = { unread: unreadOnly ? true : undefined };
  return useInfiniteQuery({
    queryKey: queryKeys.notifications.list(org.id, filter),
    queryFn: ({ pageParam }) =>
      apiFetchPaged<Notification>(
        `/notifications${toQueryString({
          ...filter,
          pageSize: NOTIFICATION_PAGE_SIZE,
          cursor: pageParam,
        })}`,
      ),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last: PagedEnvelope<Notification>) => last.meta.nextCursor ?? undefined,
    enabled,
    retry: retryServerErrors,
    staleTime: 5_000,
  });
}

type ListData = InfiniteData<PagedEnvelope<Notification>, string | undefined>;

/** POST /notifications/:id/read. The response replaces the item in every cached page. */
export function useMarkNotificationRead() {
  const { org } = useWorkspace();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiFetch<Notification>(`/notifications/${encodeURIComponent(id)}/read`, { method: "POST" }),
    onSuccess: (updated) => {
      queryClient.setQueriesData<ListData>(
        { queryKey: [...queryKeys.notifications.all(org.id), "list"] },
        (data) =>
          data
            ? {
                ...data,
                pages: data.pages.map((p) => ({
                  ...p,
                  data: p.data.map((n) => (n.id === updated.id ? updated : n)),
                })),
              }
            : data,
      );
      void queryClient.invalidateQueries({
        queryKey: queryKeys.notifications.unreadCount(org.id),
      });
    },
  });
}

/** POST /notifications/read-all. */
export function useMarkAllNotificationsRead() {
  const { org } = useWorkspace();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => apiFetch<{ updated: number }>("/notifications/read-all", { method: "POST" }),
    onSuccess: () => {
      queryClient.setQueryData(queryKeys.notifications.unreadCount(org.id), { unread: 0 });
      void queryClient.invalidateQueries({ queryKey: queryKeys.notifications.all(org.id) });
    },
  });
}

export function useNotificationPreferences() {
  const { org } = useWorkspace();
  return useQuery({
    queryKey: queryKeys.notifications.preferences(org.id),
    queryFn: () => apiFetch<NotificationPreferences>("/notifications/preferences"),
    retry: retryServerErrors,
  });
}

/** PUT /notifications/preferences with any subset; the saved preferences replace the cache. */
export function useUpdateNotificationPreferences() {
  const { org } = useWorkspace();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: UpdateNotificationPreferences) =>
      apiFetch<NotificationPreferences>("/notifications/preferences", { method: "PUT", body }),
    onSuccess: (prefs) => {
      queryClient.setQueryData(queryKeys.notifications.preferences(org.id), prefs);
    },
  });
}
