"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@leadforge/ui";

export interface JumpLink {
  id: string;
  label: string;
}

/**
 * Sticky in-page navigation chips (scrollspy). Links are native anchors, so jumps use the
 * browser's own scrolling; nothing intercepts the scroll. The active chip is the section that
 * crosses the upper third of the viewport.
 */
export function JumpLinkBar({
  items,
  label = "On this page",
}: {
  items: JumpLink[];
  label?: string;
}) {
  const [active, setActive] = useState<string | null>(null);
  const trackRef = useRef<HTMLUListElement>(null);

  useEffect(() => {
    const sections = items
      .map((i) => document.getElementById(i.id))
      .filter((el): el is HTMLElement => Boolean(el));
    if (sections.length === 0 || typeof IntersectionObserver === "undefined") return;
    const visible = new Map<string, boolean>();
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) visible.set(entry.target.id, entry.isIntersecting);
        const first = items.find((i) => visible.get(i.id));
        setActive(first?.id ?? null);
      },
      { rootMargin: "-30% 0px -60% 0px" },
    );
    sections.forEach((s) => observer.observe(s));
    return () => observer.disconnect();
  }, [items]);

  // Keep the active chip in view inside the horizontal track without scrolling the page.
  useEffect(() => {
    const track = trackRef.current;
    if (!track || !active) return;
    const chip = track.querySelector<HTMLElement>(`[data-target="${active}"]`);
    if (!chip) return;
    const left = chip.offsetLeft - track.clientWidth / 2 + chip.clientWidth / 2;
    track.scrollTo({ left: Math.max(0, left), behavior: "auto" });
  }, [active]);

  return (
    <nav
      aria-label={label}
      className="bg-background/90 supports-[backdrop-filter]:bg-background/75 sticky top-14 z-30 backdrop-blur-xl md:top-16"
    >
      <div className="container-marketing">
        <ul
          ref={trackRef}
          className="scrollbar-none -mx-1 flex min-w-0 gap-2 overflow-x-auto px-1 py-2.5"
        >
          {items.map((item) => {
            const isActive = active === item.id;
            return (
              <li key={item.id} className="shrink-0">
                <a
                  href={`#${item.id}`}
                  data-target={item.id}
                  aria-current={isActive ? "true" : undefined}
                  className={cn(
                    "state-layer transition-ui inline-flex h-9 items-center whitespace-nowrap rounded-full border px-4 text-sm font-medium",
                    isActive
                      ? "bg-secondary text-secondary-foreground border-transparent"
                      : "border-border-strong text-muted-foreground hover:text-foreground",
                  )}
                >
                  {item.label}
                </a>
              </li>
            );
          })}
        </ul>
      </div>
    </nav>
  );
}
