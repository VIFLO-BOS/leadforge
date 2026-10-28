"use client";

import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from "@tanstack/react-query";
import {
  IDEMPOTENCY_KEY_HEADER,
  type DiscoveryCategoryOption,
  type DiscoveryEstimate,
  type DiscoveryJob,
  type DiscoveryJobItem,
  type DiscoveryJobSpecInput,
  type DiscoveryLocationOptions,
  type DiscoverySourceOption,
} from "@leadforge/contracts";
import { useWorkspace } from "@/components/app/app-shell";
import { apiFetch, apiFetchPaged, isApiError, toQueryString } from "../api";
import { isDiscoveryActive, shouldPollDiscoveryJob } from "../discovery";
import { queryKeys } from "../query-keys";
import { invalidateBusinessData } from "./use-businesses";
import { usePollingQuery } from "./use-polling-query";

/** The API asks for a 2 second poll while a job is queued or running. */
export const DISCOVERY_POLL_MS = 2_000;

function retryServerErrors(count: number, err: unknown): boolean {
  if (isApiError(err) && err.status < 500) return false;
  return count < 2;
}

/**
 * Everything a settled (or newly queued) discovery job can change: the job lists, the all-jobs
 * page, the credit balance and ledger, the overview, the directory and the unread count (a
 * finished job notifies its creator). Never the polled detail query itself.
 */
export function invalidateAfterDiscoveryChange(queryClient: QueryClient, orgId: string): void {
  void queryClient.invalidateQueries({ queryKey: queryKeys.discovery.lists(orgId) });
  void queryClient.invalidateQueries({ queryKey: queryKeys.jobs.all(orgId) });
  void queryClient.invalidateQueries({ queryKey: queryKeys.credits.all(orgId) });
  void queryClient.invalidateQueries({ queryKey: queryKeys.notifications.all(orgId) });
  invalidateBusinessData(queryClient, orgId);
}

/** GET /discovery/sources: source metadata for the wizard, filters and labels. */
export function useDiscoverySources() {
  const { org } = useWorkspace();
  return useQuery({
    queryKey: queryKeys.discovery.sources(org.id),
    queryFn: async () => (await apiFetchPaged<DiscoverySourceOption>("/discovery/sources")).data,
    staleTime: 30_000,
    retry: retryServerErrors,
  });
}

/**
 * GET /discovery/categories for a source with a catalogue (`specSupport.catalog`): categories the
 * source can match, with offerable place counts. Disabled without a catalogue source; any error
 * leaves the wizard on free text.
 */
export function useDiscoveryCategories(source: string | null, q: string) {
  const { org } = useWorkspace();
  return useQuery({
    queryKey: queryKeys.discovery.categories(org.id, source ?? "none", q),
    queryFn: async () =>
      (
        await apiFetchPaged<DiscoveryCategoryOption>(
          `/discovery/categories${toQueryString({ source, q: q || undefined, limit: 20 })}`,
        )
      ).data,
    enabled: Boolean(source),
    staleTime: 5 * 60_000,
    placeholderData: keepPreviousData,
    retry: false,
  });
}

/** GET /discovery/locations: states and LGAs with offerable place counts, for catalogue sources. */
export function useDiscoveryLocations(source: string | null) {
  const { org } = useWorkspace();
  return useQuery({
    queryKey: queryKeys.discovery.locations(org.id, source ?? "none"),
    queryFn: () =>
      apiFetch<DiscoveryLocationOptions>(`/discovery/locations${toQueryString({ source })}`),
    enabled: Boolean(source),
    staleTime: 10 * 60_000,
    retry: false,
  });
}

/** GET /discovery/jobs, newest first. Refreshes every 5 s while a job on the page is active. */
export function useDiscoveryJobs(query: Record<string, unknown>) {
  const { org } = useWorkspace();
  return useQuery({
    queryKey: queryKeys.discovery.list(org.id, query),
    queryFn: () => apiFetchPaged<DiscoveryJob>(`/discovery/jobs${toQueryString(query)}`),
    placeholderData: keepPreviousData,
    retry: retryServerErrors,
    refetchInterval: (q) => (q.state.data?.data.some(shouldPollDiscoveryJob) ? 5_000 : false),
    refetchIntervalInBackground: false,
  });
}

/**
 * GET /discovery/jobs/:id, polled every 2 s while queued or running and until the credits are
 * settled. When the job moves from active to finished, dependent lists are invalidated (the
 * polled query itself never is).
 */
export function useDiscoveryJob(id: string) {
  const { org } = useWorkspace();
  const queryClient = useQueryClient();
  const key = queryKeys.discovery.detail(org.id, id);
  return usePollingQuery<DiscoveryJob>({
    queryKey: key,
    queryFn: async () => {
      const previous = queryClient.getQueryData<DiscoveryJob>(key);
      const job = await apiFetch<DiscoveryJob>(`/discovery/jobs/${encodeURIComponent(id)}`);
      if (previous && shouldPollDiscoveryJob(previous) && !shouldPollDiscoveryJob(job)) {
        invalidateAfterDiscoveryChange(queryClient, org.id);
        void queryClient.invalidateQueries({
          queryKey: ["org", org.id, "discovery", "items", id],
        });
      }
      return job;
    },
    isActive: shouldPollDiscoveryJob,
    intervalMs: DISCOVERY_POLL_MS,
  });
}

/** GET /discovery/jobs/:id/items, refreshed with the job while it runs (first page only). */
export function useDiscoveryItems(
  id: string,
  params: { outcome?: string[]; cursor?: string | null; pageSize?: number },
  jobActive: boolean,
) {
  const { org } = useWorkspace();
  const query = { pageSize: 25, ...params, cursor: params.cursor ?? undefined };
  return useQuery({
    queryKey: queryKeys.discovery.items(org.id, id, query),
    queryFn: () =>
      apiFetchPaged<DiscoveryJobItem>(
        `/discovery/jobs/${encodeURIComponent(id)}/items${toQueryString(query)}`,
      ),
    placeholderData: keepPreviousData,
    retry: retryServerErrors,
    refetchInterval: jobActive && !params.cursor ? 4_000 : false,
    refetchIntervalInBackground: false,
  });
}

/**
 * POST /discovery/jobs/estimate for a valid spec. Keyed by the spec, so going back and changing
 * anything asks again; the API never fails for an unconfigured or disabled source (those come
 * back as blockers).
 */
export function useDiscoveryEstimate(spec: DiscoveryJobSpecInput | null) {
  const { org } = useWorkspace();
  return useQuery({
    queryKey: queryKeys.discovery.estimate(org.id, spec),
    queryFn: () =>
      apiFetch<DiscoveryEstimate>("/discovery/jobs/estimate", { method: "POST", body: spec }),
    enabled: spec !== null,
    staleTime: 15_000,
    retry: false,
  });
}

/** POST /discovery/jobs with an Idempotency-Key header chosen by the caller (one per submit). */
export function useCreateDiscoveryJob() {
  const { org } = useWorkspace();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      spec,
      idempotencyKey,
    }: {
      spec: DiscoveryJobSpecInput;
      idempotencyKey: string;
    }) =>
      apiFetch<DiscoveryJob>("/discovery/jobs", {
        method: "POST",
        body: spec,
        headers: { [IDEMPOTENCY_KEY_HEADER]: idempotencyKey },
      }),
    onSuccess: (job) => {
      queryClient.setQueryData(queryKeys.discovery.detail(org.id, job.id), job);
      // The hold already left the balance.
      invalidateAfterDiscoveryChange(queryClient, org.id);
    },
  });
}

function useJobAction(id: string, action: "cancel" | "retry-failed") {
  const { org } = useWorkspace();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () =>
      apiFetch<DiscoveryJob>(`/discovery/jobs/${encodeURIComponent(id)}/${action}`, {
        method: "POST",
      }),
    onSuccess: (job) => {
      // The response restarts polling when the job is active again (retry) or still running.
      queryClient.setQueryData(queryKeys.discovery.detail(org.id, id), job);
      invalidateAfterDiscoveryChange(queryClient, org.id);
      if (!isDiscoveryActive(job)) {
        void queryClient.invalidateQueries({ queryKey: ["org", org.id, "discovery", "items", id] });
      }
    },
    onError: (err) => {
      // 409s mean the server's view moved on (finished, or not settled yet): show it.
      if (isApiError(err) && (err.status === 409 || err.status === 404)) {
        void queryClient.invalidateQueries({ queryKey: queryKeys.discovery.detail(org.id, id) });
      }
    },
  });
}

export function useCancelDiscoveryJob(id: string) {
  return useJobAction(id, "cancel");
}

export function useRetryFailedItems(id: string) {
  return useJobAction(id, "retry-failed");
}
