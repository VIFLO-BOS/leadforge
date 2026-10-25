"use client";

import * as React from "react";
import { motion, type HTMLMotionProps } from "framer-motion";
import { useMotionSafe } from "../hooks/use-motion-safe";

export interface RevealProps extends Omit<HTMLMotionProps<"div">, "children"> {
  children: React.ReactNode;
  /** Delay in seconds. */
  delay?: number;
  /** Translate distance in px. */
  distance?: number;
  once?: boolean;
  className?: string;
}

/**
 * Scroll-triggered reveal: 300ms, 24px translate, once. Renders a plain element in
 * its final state when the user prefers reduced motion or during SSR.
 */
export function Reveal({
  children,
  delay = 0,
  distance = 24,
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
      initial={{ opacity: 0, y: distance }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once, margin: "0px 0px -10% 0px" }}
      transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1], delay }}
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

/** Mount animation for hero content: 400ms fade and short rise, once. */
export function FadeIn({ children, delay = 0, duration = 0.4, className, ...rest }: FadeInProps) {
  const motionSafe = useMotionSafe();
  if (!motionSafe) {
    return <div className={className}>{children}</div>;
  }
  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration, ease: [0.22, 1, 0.36, 1], delay }}
      {...rest}
    >
      {children}
    </motion.div>
  );
}
