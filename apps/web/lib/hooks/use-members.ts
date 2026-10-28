"use client";

import { useQuery } from "@tanstack/react-query";
import type { MemberSummary, OrganizationRole } from "@leadforge/contracts";
import { useCallback, useMemo } from "react";
import { useWorkspace } from "@/components/app/app-shell";
import { apiFetchPaged } from "../api";
import { queryKeys } from "../query-keys";

/** Roles that can own and work leads (the API refuses other assignees with INVALID_ASSIGNEE). */
export const LEAD_WORK_ROLES: readonly OrganizationRole[] = ["owner", "admin", "sales_rep"];

/**
 * Organization members (GET /organizations/current/members, first 100). Shares the Team page's
 * cache key, so pickers and name lookups never request it twice.
 */
export function useMembers() {
  const { org } = useWorkspace();
  return useQuery({
    queryKey: queryKeys.members(org.id),
    queryFn: () => apiFetchPaged<MemberSummary>("/organizations/current/members?pageSize=100"),
    staleTime: 5 * 60_000,
    retry: false,
  });
}

/** Active members who can be assigned leads (owners, administrators, sales representatives). */
export function useAssignableMembers() {
  const members = useMembers();
  const data = members.data?.data;
  const assignable = useMemo(
    () => (data ?? []).filter((m) => m.status === "active" && LEAD_WORK_ROLES.includes(m.role)),
    [data],
  );
  return { ...members, assignable };
}

/**
 * Display names for member ids (who merged, who undid). Shares the Team page's cache key. Falls
 * back to "a team member" while loading or for someone who left the organization.
 */
export function useMemberNames() {
  const { me } = useWorkspace();
  const members = useMembers();
  const data = members.data?.data;
  return useCallback(
    (userId: string | null | undefined): string => {
      if (!userId) return "a team member";
      if (userId === me.user.id) return "you";
      return data?.find((m) => m.userId === userId)?.name ?? "a team member";
    },
    [data, me.user.id],
  );
}
