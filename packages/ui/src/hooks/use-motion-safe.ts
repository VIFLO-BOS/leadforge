"use client";

import { useSyncExternalStore } from "react";

const QUERY = "(prefers-reduced-motion: reduce)";

function subscribe(callback: () => void): () => void {
  if (typeof window === "undefined" || !window.matchMedia) return () => {};
  const media = window.matchMedia(QUERY);
  media.addEventListener("change", callback);
  return () => media.removeEventListener("change", callback);
}

function getSnapshot(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  return !window.matchMedia(QUERY).matches;
}

/**
 * True when non-essential motion is allowed. Returns false under
 * prefers-reduced-motion and during server rendering so animated components
 * render their final state immediately.
 */
export function useMotionSafe(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, () => false);
}
