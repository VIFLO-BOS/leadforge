import { useMemo, useSyncExternalStore } from "react";
import { vi } from "vitest";

/**
 * A `next/navigation` stand-in whose search params follow the real `window.location`, so screens
 * that keep state in the URL (`useUrlState` writes with the History API) re-render in jsdom.
 * Use from a `vi.mock("next/navigation", ...)` factory via a dynamic import.
 */
const listeners = new Set<() => void>();
let patched = false;

function patchHistory() {
  if (patched) return;
  patched = true;
  for (const method of ["pushState", "replaceState"] as const) {
    const original = window.history[method].bind(window.history);
    window.history[method] = (...args: Parameters<History["pushState"]>) => {
      original(...args);
      for (const l of listeners) l();
    };
  }
  window.addEventListener("popstate", () => {
    for (const l of listeners) l();
  });
}

export const routerPush = vi.fn();
export const routerReplace = vi.fn();

export function navigationMock() {
  patchHistory();
  return {
    useRouter: () => ({
      push: routerPush,
      replace: routerReplace,
      prefetch: vi.fn(),
      back: vi.fn(),
    }),
    usePathname: () => window.location.pathname,
    useSearchParams: () => {
      const search = useSyncExternalStore(
        (cb) => {
          listeners.add(cb);
          return () => listeners.delete(cb);
        },
        () => window.location.search,
        () => "",
      );
      return useMemo(() => new URLSearchParams(search), [search]);
    },
  };
}

/** Puts the jsdom location at `url` (path and query) before a render. */
export function setLocation(url: string) {
  window.history.replaceState(null, "", url);
}
