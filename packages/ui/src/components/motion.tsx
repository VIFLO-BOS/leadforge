"use client";

import * as React from "react";
import {
  motion,
  useScroll,
  useSpring,
  useTransform,
  type HTMLMotionProps,
  type MotionValue,
  type Variants,
} from "framer-motion";
import { useMotionSafe } from "../hooks/use-motion-safe";
import { DURATION, EASE_EMPHASIZED_DECELERATE, SCROLL_SPRING, STAGGER } from "../lib/motion";

/*
 * Marketing motion primitives. Every one renders a plain element in its final state during server
 * rendering and under prefers-reduced-motion, animates only transform and opacity, and never
 * hijacks scrolling. Do not wrap above-the-fold hero text in these: it must paint without JS.
 */

export interface RevealProps extends Omit<HTMLMotionProps<"div">, "children"> {
  children: React.ReactNode;
  /** Delay in seconds. */
  delay?: number;
  /** Translate distance in px. */
  distance?: number;
  once?: boolean;
  className?: string;
}

/** Reveal on scroll: 900ms, 40px rise plus a slight scale-up, emphasized decelerate, once. */
export function Reveal({
  children,
  delay = 0,
  distance = 40,
  once = true,
  className,
  ...rest
}: RevealProps) {
  const motionSafe = useMotionSafe();
  if (!motionSafe) {
    return <div className={className}>{children}</div>;
  }
  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, y: distance, scale: 0.98 }}
      whileInView={{ opacity: 1, y: 0, scale: 1 }}
      viewport={{ once, margin: "0px 0px -12% 0px" }}
      transition={{ duration: DURATION.reveal, ease: EASE_EMPHASIZED_DECELERATE, delay }}
      {...rest}
    >
      {children}
    </motion.div>
  );
}

export interface FadeInProps extends Omit<HTMLMotionProps<"div">, "children"> {
  children: React.ReactNode;
  delay?: number;
  duration?: number;
  className?: string;
}

/** Mount animation for secondary content: fade and short rise, once. Not for LCP text. */
export function FadeIn({ children, delay = 0, duration = 0.7, className, ...rest }: FadeInProps) {
  const motionSafe = useMotionSafe();
  if (!motionSafe) {
    return <div className={className}>{children}</div>;
  }
  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, y: 24 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration, ease: EASE_EMPHASIZED_DECELERATE, delay }}
      {...rest}
    >
      {children}
    </motion.div>
  );
}

type StaggerTag = "div" | "ul" | "ol";
type StaggerItemTag = "div" | "li";

const MOTION_TAGS = { div: motion.div, ul: motion.ul, ol: motion.ol, li: motion.li } as const;

const containerVariants = (stagger: number, delay: number): Variants => ({
  hidden: {},
  visible: { transition: { staggerChildren: stagger, delayChildren: delay } },
});

const itemVariants = (distance: number): Variants => ({
  hidden: { opacity: 0, y: distance, scale: 0.98 },
  visible: {
    opacity: 1,
    y: 0,
    scale: 1,
    transition: { duration: DURATION.reveal, ease: EASE_EMPHASIZED_DECELERATE },
  },
});

const StaggerContext = React.createContext<{ distance: number; enabled: boolean }>({
  distance: 40,
  enabled: false,
});

export interface StaggerProps extends React.HTMLAttributes<HTMLElement> {
  as?: StaggerTag;
  /** Seconds between children. */
  stagger?: number;
  delay?: number;
  distance?: number;
  children: React.ReactNode;
}

/** Staggered reveal-on-scroll container. Children must be StaggerItem. */
export function Stagger({
  as = "div",
  stagger = STAGGER,
  delay = 0,
  distance = 40,
  className,
  children,
  ...rest
}: StaggerProps) {
  const motionSafe = useMotionSafe();
  const value = React.useMemo(() => ({ distance, enabled: motionSafe }), [distance, motionSafe]);
  if (!motionSafe) {
    const Tag = as;
    return (
      <StaggerContext.Provider value={value}>
        <Tag className={className} {...rest}>
          {children}
        </Tag>
      </StaggerContext.Provider>
    );
  }
  const MotionTag = MOTION_TAGS[as] as typeof motion.div;
  return (
    <StaggerContext.Provider value={value}>
      <MotionTag
        className={className}
        initial="hidden"
        whileInView="visible"
        viewport={{ once: true, margin: "0px 0px -10% 0px" }}
        variants={containerVariants(stagger, delay)}
        {...(rest as HTMLMotionProps<"div">)}
      >
        {children}
      </MotionTag>
    </StaggerContext.Provider>
  );
}

export interface StaggerItemProps extends React.HTMLAttributes<HTMLElement> {
  as?: StaggerItemTag;
  children: React.ReactNode;
}

export function StaggerItem({ as = "div", className, children, ...rest }: StaggerItemProps) {
  const { distance, enabled } = React.useContext(StaggerContext);
  if (!enabled) {
    const Tag = as;
    return (
      <Tag className={className} {...rest}>
        {children}
      </Tag>
    );
  }
  const MotionTag = MOTION_TAGS[as] as typeof motion.div;
  return (
    <MotionTag
      className={className}
      variants={itemVariants(distance)}
      {...(rest as HTMLMotionProps<"div">)}
    >
      {children}
    </MotionTag>
  );
}

export interface ParallaxProps extends Omit<HTMLMotionProps<"div">, "children" | "style"> {
  children: React.ReactNode;
  /** Total travel in px across the element's pass through the viewport. */
  distance?: number;
  className?: string;
}

/**
 * Parallax layer: translates its content against scroll while the element crosses the viewport,
 * smoothed with a spring so it glides. Static under reduced motion. Use inside an overflow-hidden
 * frame so travel never overflows.
 */
export function Parallax({ children, distance = 120, className, ...rest }: ParallaxProps) {
  const motionSafe = useMotionSafe();
  if (!motionSafe) {
    return <div className={className}>{children}</div>;
  }
  return (
    <ParallaxInner distance={distance} className={className} {...rest}>
      {children}
    </ParallaxInner>
  );
}

function ParallaxInner({ children, distance = 120, className, ...rest }: ParallaxProps) {
  const ref = React.useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start end", "end start"] });
  const raw = useTransform(scrollYProgress, [0, 1], [distance / 2, -distance / 2]);
  const y = useSpring(raw, SCROLL_SPRING);
  return (
    <motion.div ref={ref} className={className} style={{ y }} {...rest}>
      {children}
    </motion.div>
  );
}

/**
 * Scroll progress (0 to 1) of a target element through the viewport, for bespoke scroll-linked
 * effects. Callers must still render a static final state when useMotionSafe() is false.
 */
export function useElementScrollProgress(
  ref: React.RefObject<HTMLElement | null>,
  offset: NonNullable<Parameters<typeof useScroll>[0]>["offset"] = ["start end", "end start"],
): MotionValue<number> {
  return useScroll({ target: ref, offset }).scrollYProgress;
}

let hasMountedPage = false;

export interface PageTransitionProps {
  children: React.ReactNode;
  className?: string;
}

/**
 * Route transition for template.tsx: fade plus 16px rise over 400ms on client-side navigations.
 * The first page load renders immediately (server HTML stays visible, so LCP never waits on an
 * animation), and reduced motion renders without movement.
 */
export function PageTransition({ children, className }: PageTransitionProps) {
  const motionSafe = useMotionSafe();
  const [animate] = React.useState(() => hasMountedPage);
  React.useEffect(() => {
    hasMountedPage = true;
  }, []);
  return (
    <motion.div
      className={className}
      initial={animate && motionSafe ? { opacity: 0, y: 16 } : false}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: DURATION.page, ease: EASE_EMPHASIZED_DECELERATE }}
    >
      {children}
    </motion.div>
  );
}
