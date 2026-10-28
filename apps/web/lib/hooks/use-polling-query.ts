"use client";

import { useQuery, type QueryKey } from "@tanstack/react-query";

export interface PollingQueryOptions<T> {
  queryKey: QueryKey;
  queryFn: () => Promise<T>;
  /** True while the resource is still changing (for example a job that is queued or running). */
  isActive: (data: T) => boolean;
  /** Poll interval while active. The API asks for 1 to 2 seconds. */
  intervalMs?: number;
  enabled?: boolean;
  /** Retry policy for failed fetches (TanStack's default retries 3 times, 4xx included). */
  retry?: (failureCount: number, error: unknown) => boolean;
}

/**
 * Polls a resource while it is active and stops on its own once it settles. Polling pauses while
 * the tab is hidden (TanStack's default) and errors keep the last good data with a retry.
 * Reuse it for every job-like resource: imports, discovery jobs, exports.
 */
export function usePollingQuery<T>({
  queryKey,
  queryFn,
  isActive,
  intervalMs = 1_500,
  enabled = true,
  retry,
}: PollingQueryOptions<T>) {
  return useQuery({
    queryKey,
    queryFn,
    enabled,
    ...(retry ? { retry } : {}),
    staleTime: 0,
    refetchInterval: (query) => {
      const data = query.state.data;
      if (data === undefined) return false;
      return isActive(data) ? intervalMs : false;
    },
    refetchIntervalInBackground: false,
  });
}
