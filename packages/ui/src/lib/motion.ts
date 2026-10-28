/**
 * Material 3 motion tokens for framer-motion. CSS equivalents live in tokens.css
 * (--ease-emphasized and friends). See docs/DESIGN_SYSTEM.md section 8.
 */

/** Emphasized easing: the default for anything that moves on screen. */
export const EASE_EMPHASIZED = [0.2, 0, 0, 1] as const;
/** Emphasized decelerate: elements entering the screen. */
export const EASE_EMPHASIZED_DECELERATE = [0.05, 0.7, 0.1, 1] as const;
/** Emphasized accelerate: elements leaving the screen. */
export const EASE_EMPHASIZED_ACCELERATE = [0.3, 0, 0.8, 0.15] as const;

/** Durations in seconds. */
export const DURATION = {
  short: 0.2,
  medium: 0.3,
  long: 0.5,
  extraLong: 0.7,
  /** Scroll reveals: unhurried, clearly visible. */
  reveal: 0.9,
  /** Route and page transitions. */
  page: 0.4,
} as const;

/** Stagger between siblings in reveal groups, in seconds. */
export const STAGGER = 0.1;

/**
 * Spring used to smooth scroll-linked values so they glide instead of stepping
 * (useSpring(motionValue, SCROLL_SPRING)).
 */
export const SCROLL_SPRING = { stiffness: 140, damping: 30, mass: 0.6, restDelta: 0.0005 } as const;

/**
 * Material 3 Expressive spatial springs (damping ratio 0.9) expressed as framer-motion
 * stiffness and damping for a unit mass.
 */
export const SPRING = {
  fast: { type: "spring", stiffness: 1400, damping: 67, mass: 1 },
  default: { type: "spring", stiffness: 700, damping: 48, mass: 1 },
  slow: { type: "spring", stiffness: 300, damping: 31, mass: 1 },
} as const;
