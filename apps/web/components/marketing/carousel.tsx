"use client";

import { motion } from "framer-motion";
import { ChevronLeft, ChevronRight, Pause, Play } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button, SPRING, cn, useMotionSafe } from "@leadforge/ui";

/**
 * Horizontal carousel (WAI-ARIA carousel pattern).
 * - CSS scroll-snap track; swipe and trackpad scrolling work natively.
 * - Pill pagination: the active dot stretches into a pill (layout animation, transform-based).
 * - A visible Pause/Play button. Autoplay (6s) runs only when motion is allowed, and pauses while
 *   the pointer or keyboard focus is inside or the tab is hidden. Under reduced motion it starts
 *   paused and the button reads "Play".
 */
export function Carousel({
  label,
  slides,
  interval = 6000,
}: {
  label: string;
  slides: { id: string; content: React.ReactNode }[];
  interval?: number;
}) {
  const motionSafe = useMotionSafe();
  const trackRef = useRef<HTMLDivElement>(null);
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [userPaused, setUserPaused] = useState(false);
  const [hold, setHold] = useState(false);
  const count = slides.length;

  // Autoplay defaults on only when motion is allowed and the user has not paused it.
  useEffect(() => {
    setPlaying(motionSafe && !userPaused);
  }, [motionSafe, userPaused]);

  const goTo = useCallback(
    (i: number) => {
      const track = trackRef.current;
      const target = track?.children[i] as HTMLElement | undefined;
      if (!track || !target) return;
      track.scrollTo({
        left:
          target.offsetLeft -
          track.offsetLeft -
          parseFloat(getComputedStyle(track).paddingLeft || "0"),
        behavior: motionSafe ? "smooth" : "auto",
      });
      setIndex(i);
    },
    [motionSafe],
  );

  // Track the slide nearest the start edge as the user scrolls.
  useEffect(() => {
    const track = trackRef.current;
    if (!track) return;
    let frame = 0;
    const onScroll = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const children = Array.from(track.children) as HTMLElement[];
        const start = track.scrollLeft + track.offsetLeft;
        let best = 0;
        let bestDist = Infinity;
        children.forEach((child, i) => {
          const d = Math.abs(child.offsetLeft - start);
          if (d < bestDist) {
            bestDist = d;
            best = i;
          }
        });
        if (track.scrollLeft + track.clientWidth >= track.scrollWidth - 2)
          best = children.length - 1;
        setIndex(best);
      });
    };
    track.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      track.removeEventListener("scroll", onScroll);
      cancelAnimationFrame(frame);
    };
  }, []);

  useEffect(() => {
    if (!playing || hold || count < 2) return;
    const t = window.setInterval(() => {
      if (document.visibilityState !== "visible") return;
      setIndex((current) => {
        const next = (current + 1) % count;
        const track = trackRef.current;
        const target = track?.children[next] as HTMLElement | undefined;
        if (track && target) {
          track.scrollTo({ left: target.offsetLeft - track.offsetLeft, behavior: "smooth" });
        }
        return next;
      });
    }, interval);
    return () => window.clearInterval(t);
  }, [playing, hold, count, interval]);

  return (
    <section
      aria-roledescription="carousel"
      aria-label={label}
      className="flex min-w-0 flex-col gap-6"
      onPointerEnter={() => setHold(true)}
      onPointerLeave={() => setHold(false)}
      onFocusCapture={() => setHold(true)}
      onBlurCapture={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setHold(false);
      }}
    >
      {/* The track scrolls sideways, so it takes focus (arrow keys scroll it, WCAG 2.1.1). */}
      <div
        ref={trackRef}
        role="group"
        aria-label={`${label}: slides`}
        tabIndex={0}
        aria-live={playing && !hold ? "off" : "polite"}
        className="scrollbar-none flex min-w-0 snap-x snap-mandatory gap-4 overflow-x-auto pb-1 sm:gap-6"
      >
        {slides.map((slide, i) => (
          <div
            key={slide.id}
            role="group"
            aria-roledescription="slide"
            aria-label={`${i + 1} of ${count}`}
            className="flex w-[86%] shrink-0 snap-start min-[640px]:w-[calc((100%-24px)/2)] lg:w-[calc((100%-48px)/3)]"
          >
            {slide.content}
          </div>
        ))}
      </div>

      <div className="flex min-w-0 flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-1" role="group" aria-label="Choose slide">
          {slides.map((slide, i) => (
            <button
              key={slide.id}
              type="button"
              onClick={() => goTo(i)}
              aria-label={`Show slide ${i + 1} of ${count}`}
              aria-current={i === index ? "true" : undefined}
              className="flex h-8 items-center justify-center rounded-full px-1"
            >
              <motion.span
                layout={motionSafe}
                transition={SPRING.slow}
                style={{ borderRadius: 9999 }}
                className={cn(
                  "block h-2",
                  i === index ? "bg-primary w-6" : "bg-border-strong hover:bg-muted-foreground w-2",
                )}
              />
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setUserPaused(playing)}
            aria-label={playing ? "Pause carousel" : "Play carousel"}
            className={cn(!motionSafe && "hidden")}
          >
            {playing ? <Pause aria-hidden /> : <Play aria-hidden />}
            {playing ? "Pause" : "Play"}
          </Button>
          <Button
            variant="outline"
            size="icon-sm"
            onClick={() => goTo(Math.max(0, index - 1))}
            disabled={index === 0}
            aria-label="Previous slide"
          >
            <ChevronLeft aria-hidden />
          </Button>
          <Button
            variant="outline"
            size="icon-sm"
            onClick={() => goTo(Math.min(count - 1, index + 1))}
            disabled={index === count - 1}
            aria-label="Next slide"
          >
            <ChevronRight aria-hidden />
          </Button>
        </div>
      </div>
    </section>
  );
}
