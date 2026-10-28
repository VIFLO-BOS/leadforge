"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { setActiveOrgId } from "@/lib/org";
import { SIGNED_OUT_EVENT, signInUrl } from "@/lib/session";

/** Per-tab state that belongs to the signed-in session (discovery drafts, dismissed banners). */
export function clearSessionStorage(): void {
  try {
    const keys: string[] = [];
    for (let i = 0; i < window.sessionStorage.length; i++) {
      const k = window.sessionStorage.key(i);
      if (k?.startsWith("lf.")) keys.push(k);
    }
    for (const k of keys) window.sessionStorage.removeItem(k);
  } catch {
    /* storage unavailable */
  }
}

/**
 * Listens for the signed-out signal (a 401 that survived the refresh attempt, lib/session.ts).
 * On dashboard pages it drops every cached query, the active organization and session drafts,
 * then replaces the page with sign-in and a same-origin return path. A full navigation (not a
 * client transition) guarantees nothing from the old session stays in memory. Other pages (sign
 * in, invitations, email verification) handle their own 401s, so it only clears state there.
 */
export function SessionWatcher({ navigate }: { navigate?: (url: string) => void }) {
  const queryClient = useQueryClient();
  useEffect(() => {
    const onSignedOut = () => {
      queryClient.cancelQueries().catch(() => undefined);
      queryClient.clear();
      setActiveOrgId(null);
      clearSessionStorage();
      const { pathname, search, origin } = window.location;
      if (!pathname.startsWith("/app")) return;
      const url = signInUrl(`${pathname}${search}`, origin);
      if (navigate) navigate(url);
      else window.location.replace(url);
    };
    window.addEventListener(SIGNED_OUT_EVENT, onSignedOut);
    return () => window.removeEventListener(SIGNED_OUT_EVENT, onSignedOut);
  }, [queryClient, navigate]);
  return null;
}
