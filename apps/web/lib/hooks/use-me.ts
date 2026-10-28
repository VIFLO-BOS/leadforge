"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { MeResponse, OrganizationMembershipSummary } from "@leadforge/contracts";
import { useEffect, useState } from "react";
import { apiFetch } from "../api";
import { getActiveOrgId, setActiveOrgId } from "../org";

export const ME_QUERY_KEY = ["auth", "me"] as const;

export function useMe() {
  return useQuery({
    queryKey: ME_QUERY_KEY,
    queryFn: () => apiFetch<MeResponse>("/auth/me", { noOrg: true }),
    retry: (count, err) => {
      const status = (err as { status?: number }).status;
      if (status === 401 || status === 403) return false;
      return count < 2;
    },
    staleTime: 60_000,
  });
}

/** Resolves the active organization from storage, falling back to the first membership. */
export function useActiveOrg(me: MeResponse | undefined): {
  org: OrganizationMembershipSummary | null;
  setOrg: (id: string) => void;
} {
  const queryClient = useQueryClient();
  // Read storage on the first client render so the stored choice wins over the first membership
  // (the shell only renders org-scoped content after /auth/me resolves, so SSR output is unaffected).
  const [stored, setStored] = useState<string | null>(() => getActiveOrgId());

  useEffect(() => {
    setStored(getActiveOrgId());
    const onChange = (e: Event) => setStored((e as CustomEvent<string | null>).detail);
    window.addEventListener("lf:org-changed", onChange);
    return () => window.removeEventListener("lf:org-changed", onChange);
  }, []);

  const orgs = me?.organizations ?? [];
  const org = orgs.find((o) => o.id === stored) ?? orgs[0] ?? null;

  useEffect(() => {
    if (org && org.id !== stored) setActiveOrgId(org.id);
  }, [org, stored]);

  return {
    org,
    setOrg: (id) => {
      setActiveOrgId(id);
      // Org-scoped queries must refetch under the new header.
      void queryClient.invalidateQueries({ predicate: (q) => q.queryKey[0] !== "auth" });
    },
  };
}
