"use client";

import Lenis from "lenis";
import { cancelFrame, frame } from "framer-motion";
import { useEffect } from "react";
import { useMotionSafe } from "@leadforge/ui";

/** Overlays and nested widgets that must keep native scrolling. */
const NATIVE_SCROLL =
  '[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"], [data-radix-popper-content-wrapper], [data-lenis-prevent]';

/**
 * Marketing-only smooth scrolling (Lenis, lerp 0.09), driven from framer-motion's frame loop so
 * scroll-linked motion values read the same smoothed position every frame.
 *
 * - The native scrollbar stays; keyboard, anchor, jump-link and focus scrolling keep working
 *   (Lenis resyncs on native scroll events; in-page anchors glide with an offset for the sticky
 *   nav and chip bar).
 * - Nested scroll containers (carousel track, chip bars) and open dialogs, menus and sheets keep
 *   native scrolling.
 * - Not mounted at all under prefers-reduced-motion, and never in the dashboard.
 */
export function SmoothScroll() {
  const motionSafe = useMotionSafe();

  useEffect(() => {
    if (!motionSafe) return;
    const lenis = new Lenis({
      lerp: 0.09,
      smoothWheel: true,
      syncTouch: false,
      anchors: { offset: -128 },
      allowNestedScroll: true,
      stopInertiaOnNavigate: true,
      prevent: (node) => typeof node.matches === "function" && node.matches(NATIVE_SCROLL),
      // Radix locks the page while a modal is open; never move the page behind it.
      virtualScroll: () => !document.body.hasAttribute("data-scroll-locked"),
    });
    const update = (data: { timestamp: number }) => lenis.raf(data.timestamp);
    frame.update(update, true);
    return () => {
      cancelFrame(update);
      lenis.destroy();
    };
  }, [motionSafe]);

  return null;
}
