"use client";

import { useCallback, useSyncExternalStore } from "react";

/**
 * Subscribes to a media query. Returns `serverValue` (default false) during server rendering
 * and hydration, then the live value. Use for layout switches that cannot be done in CSS
 * without rendering interactive content twice (DataTable mobile cards, FilterBar sheet).
 */
export function useMediaQuery(query: string, serverValue = false): boolean {
  const subscribe = useCallback(
    (callback: () => void) => {
      if (typeof window === "undefined" || !window.matchMedia) return () => {};
      const media = window.matchMedia(query);
      media.addEventListener("change", callback);
      return () => media.removeEventListener("change", callback);
    },
    [query],
  );
  const getSnapshot = useCallback(() => {
    if (typeof window === "undefined" || !window.matchMedia) return serverValue;
    return window.matchMedia(query).matches;
  }, [query, serverValue]);
  return useSyncExternalStore(subscribe, getSnapshot, () => serverValue);
}

/** Breakpoints shared with tokens.css and docs/DESIGN_SYSTEM.md section 7. */
export const MEDIA = {
  /** Phones under 480px: stacked cards, full-screen dialogs. */
  narrow: "(max-width: 479.98px)",
  /** Under 768px: filter sheets, menu sheets. */
  belowMd: "(max-width: 767.98px)",
  /** 1024px and up: fixed navigation drawer. */
  lg: "(min-width: 1024px)",
} as const;
