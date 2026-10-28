"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { useCallback, useMemo } from "react";

/**
 * Typed view state mirrored in the URL query string. Reads with useSearchParams and writes with
 * the native History API, which Next.js syncs into its router (no server round trip and no
 * scroll jump). `replace` keeps typing and filter tweaks out of the back-button history.
 *
 * Reuse it for every list or wizard whose view should be shareable and survive a refresh:
 * provide `parse` (URLSearchParams to state, tolerant of bad input) and `serialize` (state to
 * URLSearchParams, leaving defaults out).
 */
export function useUrlState<T>(
  parse: (params: URLSearchParams) => T,
  serialize: (state: T) => URLSearchParams,
): [T, (next: T, opts?: { push?: boolean }) => void] {
  const params = useSearchParams();
  const pathname = usePathname();
  const raw = params.toString();
  const state = useMemo(() => parse(new URLSearchParams(raw)), [parse, raw]);
  const setState = useCallback(
    (next: T, opts?: { push?: boolean }) => {
      const qs = serialize(next).toString();
      const url = qs ? `${pathname}?${qs}` : pathname;
      if (opts?.push) window.history.pushState(null, "", url);
      else window.history.replaceState(null, "", url);
    },
    [pathname, serialize],
  );
  return [state, setState];
}
