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
  BusinessDetail,
  BusinessFacets,
  BusinessListItem,
  CorrectionRequest,
  CreateBusinessRequest,
  Observation,
  PagedEnvelope,
  SuppressRequest,
  VerificationEvent,
} from "@leadforge/contracts";
import { useWorkspace } from "@/components/app/app-shell";
import { apiFetch, apiFetchPaged, isApiError, toQueryString } from "../api";
import { queryKeys } from "../query-keys";

/** Detail, observation and list data that a business write can change. */
export function invalidateBusinessData(
  queryClient: QueryClient,
  orgId: string,
  businessId?: string,
): void {
  void queryClient.invalidateQueries({ queryKey: queryKeys.businesses.lists(orgId) });
  void queryClient.invalidateQueries({ queryKey: queryKeys.businesses.facets(orgId) });
  void queryClient.invalidateQueries({ queryKey: ["org", orgId, "reports"] });
  if (businessId) {
    void queryClient.invalidateQueries({
      queryKey: [...queryKeys.businesses.detail(orgId, businessId), "observations"],
    });
    void queryClient.invalidateQueries({
      queryKey: queryKeys.businesses.verificationEvents(orgId, businessId),
    });
  }
}

/** Never retry a 4xx: a 404 for an unknown id or a 403 for a role will not change on retry. */
function retryServerErrors(count: number, err: unknown): boolean {
  if (isApiError(err) && err.status < 500) return false;
  return count < 2;
}

export function useBusinessList(query: Record<string, unknown>, enabled = true) {
  const { org } = useWorkspace();
  return useQuery({
    queryKey: queryKeys.businesses.list(org.id, query),
    queryFn: () => apiFetchPaged<BusinessListItem>(`/businesses${toQueryString(query)}`),
    placeholderData: keepPreviousData,
    retry: retryServerErrors,
    enabled,
  });
}

export function useBusinessFacets() {
  const { org } = useWorkspace();
  return useQuery({
    queryKey: queryKeys.businesses.facets(org.id),
    queryFn: () => apiFetch<BusinessFacets>("/businesses/facets"),
    // The API caches facets for up to 60 seconds per organization.
    staleTime: 60_000,
    retry: retryServerErrors,
  });
}

export function useBusinessDetail(id: string) {
  const { org } = useWorkspace();
  return useQuery({
    queryKey: queryKeys.businesses.detail(org.id, id),
    queryFn: () => apiFetch<BusinessDetail>(`/businesses/${encodeURIComponent(id)}`),
    retry: retryServerErrors,
  });
}

export function useObservations(
  id: string,
  filter: { field?: string; source?: string },
  enabled = true,
) {
  const { org } = useWorkspace();
  return useInfiniteQuery({
    queryKey: queryKeys.businesses.observations(org.id, id, filter),
    queryFn: ({ pageParam }) =>
      apiFetchPaged<Observation>(
        `/businesses/${encodeURIComponent(id)}/observations${toQueryString({
          ...filter,
          pageSize: 25,
          cursor: pageParam,
        })}`,
      ),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last: PagedEnvelope<Observation>) => last.meta.nextCursor ?? undefined,
    enabled,
    retry: retryServerErrors,
  });
}

export function useVerificationEvents(id: string, enabled = true) {
  const { org } = useWorkspace();
  return useInfiniteQuery({
    queryKey: queryKeys.businesses.verificationEvents(org.id, id),
    queryFn: ({ pageParam }) =>
      apiFetchPaged<VerificationEvent>(
        `/businesses/${encodeURIComponent(id)}/verification-events${toQueryString({
          pageSize: 25,
          cursor: pageParam,
        })}`,
      ),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last: PagedEnvelope<VerificationEvent>) => last.meta.nextCursor ?? undefined,
    enabled,
    retry: retryServerErrors,
  });
}

/**
 * One correction per request. Not optimistic: the server normalizes the value, resets its
 * state to unverified, may resolve a conflict or suppress the business, and records a
 * provenance observation, none of which the client can predict. The response is the updated
 * detail, which replaces the cache; dependent lists and the provenance trail refetch.
 */
export function useCorrectBusiness(id: string) {
  const { org } = useWorkspace();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: CorrectionRequest) =>
      apiFetch<BusinessDetail>(`/businesses/${encodeURIComponent(id)}`, {
        method: "PATCH",
        body,
      }),
    onSuccess: (detail) => {
      queryClient.setQueryData(queryKeys.businesses.detail(org.id, id), detail);
      invalidateBusinessData(queryClient, org.id, id);
    },
  });
}

export function useSuppressBusiness(id: string) {
  const { org } = useWorkspace();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: SuppressRequest) =>
      apiFetch<BusinessDetail>(`/businesses/${encodeURIComponent(id)}/suppress`, {
        method: "POST",
        body,
      }),
    onSuccess: (detail) => {
      queryClient.setQueryData(queryKeys.businesses.detail(org.id, id), detail);
      // A domain, phone or email entry can suppress other businesses too.
      void queryClient.invalidateQueries({ queryKey: queryKeys.businesses.all(org.id) });
      invalidateBusinessData(queryClient, org.id, id);
    },
  });
}

export function useUnsuppressBusiness(id: string) {
  const { org } = useWorkspace();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () =>
      apiFetch<BusinessDetail>(`/businesses/${encodeURIComponent(id)}/suppression`, {
        method: "DELETE",
      }),
    onSuccess: (detail) => {
      queryClient.setQueryData(queryKeys.businesses.detail(org.id, id), detail);
      void queryClient.invalidateQueries({ queryKey: queryKeys.businesses.all(org.id) });
      invalidateBusinessData(queryClient, org.id, id);
    },
  });
}

export function useCreateBusiness() {
  const { org } = useWorkspace();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateBusinessRequest) =>
      apiFetch<BusinessDetail>("/businesses", { method: "POST", body }),
    onSuccess: (detail) => {
      queryClient.setQueryData(queryKeys.businesses.detail(org.id, detail.id), detail);
      invalidateBusinessData(queryClient, org.id);
    },
  });
}
