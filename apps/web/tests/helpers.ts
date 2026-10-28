import { afterEach } from "vitest";

const original = typeof window !== "undefined" ? window.matchMedia : undefined;

/**
 * Makes window.matchMedia report `matches: true` for the given media queries (exact string match,
 * as used by MEDIA in packages/ui) and false for everything else. Restored after each test.
 */
export function mockMatchMedia(matching: string[]): void {
  const set = new Set(matching);
  window.matchMedia = (query: string) =>
    ({
      matches: set.has(query),
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }) as MediaQueryList;
}

afterEach(() => {
  if (original) window.matchMedia = original;
});

/** Query strings from packages/ui/src/hooks/use-media-query.ts (MEDIA). */
export const NARROW = "(max-width: 479.98px)";
export const BELOW_MD = "(max-width: 767.98px)";
