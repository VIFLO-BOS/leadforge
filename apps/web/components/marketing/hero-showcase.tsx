"use client";

import { motion, useScroll, useSpring, useTransform, type MotionValue } from "framer-motion";
import { MailCheck } from "lucide-react";
import { JobStatus, SCROLL_SPRING, useMotionSafe } from "@leadforge/ui";
import { AppFrameMock, DirectoryMock, MockFigure, ProvenanceMock } from "./mocks";

/** Scroll distance in px over which the showcase assembles. */
const ASSEMBLE_PX = 620;

type MotionStyle = React.ComponentProps<typeof motion.div>["style"];

/** Scroll-scrubbed value, spring-smoothed so it glides instead of stepping. */
function useScrubbed(scrollY: MotionValue<number>, to: [number, number], range = [0, ASSEMBLE_PX]) {
  return useSpring(useTransform(scrollY, range, to, { clamp: true }), SCROLL_SPRING);
}

/**
 * Scroll-linked hero showcase. At the top of the page the product UI is tilted back and scaled
 * down, with its provenance panel, job chip and verification toast floating well apart. As the
 * page scrolls (scrubbed, spring-smoothed) the frame flattens and grows to full size and every
 * layer docks into place. Before hydration the same starting pose comes from CSS (.hero-pose-* in
 * globals.css, motion users only); under reduced motion it renders assembled with no transforms.
 */
export function HeroShowcase() {
  const motionSafe = useMotionSafe();
  const { scrollY } = useScroll();
  const frameScale = useScrubbed(scrollY, [0.84, 1]);
  const frameRotate = useScrubbed(scrollY, [22, 0]);
  const panelX = useScrubbed(scrollY, [160, 0]);
  const panelY = useScrubbed(scrollY, [120, 0]);
  const panelRotate = useScrubbed(scrollY, [4, 0]);
  const chipX = useScrubbed(scrollY, [-140, 0]);
  const chipY = useScrubbed(scrollY, [90, 0]);
  const toastX = useScrubbed(scrollY, [-110, 0]);
  const toastY = useScrubbed(scrollY, [-50, 0]);

  // Same elements before and after hydration (no remount); motion styles attach only when allowed.
  if (!motionSafe) return <Showcase />;
  return (
    <Showcase
      frameStyle={{ scale: frameScale, rotateX: frameRotate, transformPerspective: 1600 }}
      panelStyle={{ x: panelX, y: panelY, rotate: panelRotate }}
      chipStyle={{ x: chipX, y: chipY }}
      toastStyle={{ x: toastX, y: toastY }}
    />
  );
}

function Showcase({
  frameStyle,
  panelStyle,
  chipStyle,
  toastStyle,
}: {
  frameStyle?: MotionStyle;
  panelStyle?: MotionStyle;
  chipStyle?: MotionStyle;
  toastStyle?: MotionStyle;
}) {
  return (
    <MockFigure
      caption="Illustration of the LeadForge business directory with a provenance panel. All businesses, contact details and scores are fictional sample data."
      className="relative mx-auto w-full max-w-6xl"
    >
      <div className="relative [perspective:1600px]">
        <motion.div
          data-motion="scroll-linked"
          style={frameStyle}
          className="hero-pose-frame bg-surface-container-high/70 shadow-3 dark:bg-surface-container origin-[50%_0%] rounded-[22px] p-1.5 will-change-transform sm:rounded-[32px] sm:p-2.5"
        >
          <div className="overflow-hidden rounded-[16px] sm:rounded-[24px]">
            <AppFrameMock>
              <DirectoryMock />
            </AppFrameMock>
          </div>
        </motion.div>
        <motion.div
          data-motion="scroll-linked"
          style={panelStyle}
          className="hero-pose-panel absolute -right-2 top-[20%] hidden w-[300px] will-change-transform lg:block xl:-right-8"
        >
          <ProvenanceMock />
        </motion.div>
        <motion.div
          data-motion="scroll-linked"
          style={chipStyle}
          className="hero-pose-chip bg-surface-elevated shadow-3 absolute -left-2 bottom-[12%] hidden items-center gap-3 rounded-full py-2.5 pl-3 pr-5 will-change-transform md:flex xl:-left-8"
        >
          <JobStatus state="completed_with_warnings" variant="badge" size="sm" />
          <span className="whitespace-nowrap text-xs">
            141 created · 7 failed, retry available{" "}
            <span className="text-muted-foreground">(Sample)</span>
          </span>
        </motion.div>
        <motion.div
          data-motion="scroll-linked"
          style={toastStyle}
          className="hero-pose-toast bg-inverse-surface text-inverse-foreground shadow-3 absolute -left-2 top-[9%] hidden max-w-[280px] items-center gap-3 rounded-2xl px-4 py-3 will-change-transform lg:flex xl:-left-10"
        >
          <MailCheck aria-hidden className="text-inverse-primary size-5 shrink-0" />
          <span className="text-xs leading-snug">
            Email passed syntax and MX checks. Mailbox not confirmed, so it stays unverified
            (Sample)
          </span>
        </motion.div>
      </div>
    </MockFigure>
  );
}

/**
 * Hero copy layer: server-rendered and fully visible at load; as the page scrolls it drifts up
 * and recedes (scrubbed, spring-smoothed) while the showcase assembles. Static under reduced motion.
 */
export function HeroCopy({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  const motionSafe = useMotionSafe();
  const { scrollY } = useScroll();
  const y = useScrubbed(scrollY, [0, -72], [0, 520]);
  const opacity = useScrubbed(scrollY, [1, 0.25], [0, 520]);
  const scale = useScrubbed(scrollY, [1, 0.96], [0, 520]);
  // One motion.div throughout, so the server-rendered heading is never replaced after hydration.
  return (
    <motion.div
      data-motion={motionSafe ? "scroll-linked" : undefined}
      style={motionSafe ? { y, opacity, scale } : undefined}
      className={className}
    >
      {children}
    </motion.div>
  );
}
