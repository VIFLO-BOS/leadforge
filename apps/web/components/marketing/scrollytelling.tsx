"use client";

import { AnimatePresence, motion, useScroll, useSpring } from "framer-motion";
import { useEffect, useRef, useState } from "react";
import {
  EASE_EMPHASIZED_ACCELERATE,
  EASE_EMPHASIZED_DECELERATE,
  MEDIA,
  SCROLL_SPRING,
  cn,
  useMediaQuery,
  useMotionSafe,
} from "@leadforge/ui";

export interface StoryStep {
  id: string;
  title: string;
  body: React.ReactNode;
  /** Inert product mock for this step (wrap in MockFigure). */
  visual: React.ReactNode;
}

/**
 * Pinned scrollytelling. From 1024px the interface preview is position: sticky in the right
 * column while the steps scroll past on the left; the step crossing the viewport centre becomes
 * active and the preview crossfades to it. Nothing intercepts scrolling. Below 1024px each step
 * shows its own preview inline. Under reduced motion the preview switches without a crossfade and
 * the progress rail is static.
 */
export function Scrollytelling({ steps, label }: { steps: StoryStep[]; label: string }) {
  const [active, setActive] = useState(0);
  const motionSafe = useMotionSafe();
  const wide = useMediaQuery(MEDIA.lg);
  const listRef = useRef<HTMLOListElement>(null);
  const stepRefs = useRef<(HTMLLIElement | null)[]>([]);

  useEffect(() => {
    if (!wide || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            const index = Number((entry.target as HTMLElement).dataset.index);
            if (!Number.isNaN(index)) setActive(index);
          }
        }
      },
      { rootMargin: "-50% 0px -50% 0px" },
    );
    stepRefs.current.forEach((el) => el && observer.observe(el));
    return () => observer.disconnect();
  }, [wide, steps.length]);

  const current = steps[active] ?? steps[0];

  return (
    <div className="lg:grid lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:gap-16 xl:gap-24">
      <div className="relative">
        {wide ? (
          <ProgressRail
            listRef={listRef}
            active={active}
            count={steps.length}
            motionSafe={motionSafe}
          />
        ) : null}
        <ol ref={listRef} aria-label={label} className="flex flex-col gap-12 lg:gap-0">
          {steps.map((step, i) => (
            <li
              key={step.id}
              ref={(el) => {
                stepRefs.current[i] = el;
              }}
              data-index={i}
              aria-current={wide && active === i ? "step" : undefined}
              className="flex min-w-0 flex-col gap-6 lg:min-h-[72vh] lg:justify-center"
            >
              <div className="flex min-w-0 max-w-lg gap-4 sm:gap-5">
                <span
                  className={cn(
                    "transition-ui relative z-[1] flex size-9 shrink-0 items-center justify-center rounded-full text-sm font-medium duration-500",
                    !wide || active === i
                      ? "bg-primary text-primary-foreground"
                      : "bg-surface-container-high text-muted-foreground",
                  )}
                >
                  {i + 1}
                </span>
                <div className="flex min-w-0 flex-col gap-3 pt-1">
                  <h3
                    className={cn(
                      "text-h3 transition-ui duration-500",
                      wide && active !== i && "text-muted-foreground",
                    )}
                  >
                    {step.title}
                  </h3>
                  <div className="text-body-lg text-muted-foreground">{step.body}</div>
                </div>
              </div>
              <div className="lg:hidden">
                <VisualFrame>{step.visual}</VisualFrame>
              </div>
            </li>
          ))}
        </ol>
      </div>
      <div className="hidden lg:block">
        <div data-motion="scroll-linked" className="sticky top-[max(8rem,calc(50vh-17rem))]">
          <VisualFrame stage>
            {motionSafe ? (
              <AnimatePresence mode="wait" initial={false}>
                <motion.div
                  key={current?.id}
                  initial={{ opacity: 0, scale: 0.94, y: 56 }}
                  animate={{
                    opacity: 1,
                    scale: 1,
                    y: 0,
                    transition: { duration: 0.7, ease: EASE_EMPHASIZED_DECELERATE },
                  }}
                  exit={{
                    opacity: 0,
                    scale: 0.97,
                    y: -32,
                    transition: { duration: 0.25, ease: EASE_EMPHASIZED_ACCELERATE },
                  }}
                >
                  {current?.visual}
                </motion.div>
              </AnimatePresence>
            ) : (
              current?.visual
            )}
          </VisualFrame>
          <p className="text-muted-foreground mt-4 text-center text-sm" aria-live="polite">
            Step {active + 1} of {steps.length}: {current?.title}
          </p>
        </div>
      </div>
    </div>
  );
}

/**
 * Product stage: a tinted well with the mock floating on it as an elevated card. With `stage`
 * (the pinned desktop preview) the well has a fixed height so steps of different length crossfade
 * without the frame resizing.
 */
function VisualFrame({ children, stage = false }: { children: React.ReactNode; stage?: boolean }) {
  return (
    <div className="bg-surface-container-high/70 dark:bg-surface-container rounded-[24px] p-1.5 sm:rounded-[32px] sm:p-2.5">
      <div
        className={cn(
          "bg-surface-tint flex items-center justify-center overflow-hidden rounded-[18px] p-3 sm:rounded-[24px] sm:p-6",
          stage && "h-[480px] p-8",
        )}
      >
        <div className="bg-surface shadow-2 w-full max-w-[560px] overflow-hidden rounded-2xl">
          {children}
        </div>
      </div>
    </div>
  );
}

/** Vertical rail whose fill tracks scroll progress through the steps (scaleY transform). */
function ProgressRail({
  listRef,
  active,
  count,
  motionSafe,
}: {
  listRef: React.RefObject<HTMLOListElement | null>;
  active: number;
  count: number;
  motionSafe: boolean;
}) {
  const { scrollYProgress } = useScroll({
    target: listRef,
    offset: ["start center", "end center"],
  });
  const progress = useSpring(scrollYProgress, SCROLL_SPRING);
  return (
    <div
      aria-hidden
      className="bg-border absolute bottom-0 left-[17px] top-0 w-0.5 overflow-hidden rounded-full"
    >
      {motionSafe ? (
        <motion.div className="bg-primary h-full w-full origin-top" style={{ scaleY: progress }} />
      ) : (
        <div
          className="bg-primary h-full w-full origin-top"
          style={{ transform: `scaleY(${(active + 1) / count})` }}
        />
      )}
    </div>
  );
}
