"use client";

import * as React from "react";
import { cn } from "../lib/cn";
import { useMotionSafe } from "../hooks/use-motion-safe";

export interface ProgressProps extends Omit<React.HTMLAttributes<HTMLDivElement>, "children"> {
  /** 0 to max. Omit for indeterminate (work is happening but its size is unknown). */
  value?: number | null;
  max?: number;
  /** Accessible name, for example "Discovery job progress". Required. */
  label: string;
  /** Visible value text, for example "120 of 500 records". Also used as aria-valuetext. */
  valueText?: string;
  showLabel?: boolean;
  tone?: "primary" | "success" | "warning" | "destructive";
  size?: "sm" | "md";
}

const TONE = {
  primary: "bg-primary",
  success: "bg-success",
  warning: "bg-warning",
  destructive: "bg-destructive",
} as const;

/**
 * Linear progress bound to real progress events only. Determinate fills with a transform (scaleX);
 * indeterminate shows a moving segment, or a static 30% bar labelled "In progress" under reduced
 * motion.
 */
export function Progress({
  value,
  max = 100,
  label,
  valueText,
  showLabel = false,
  tone = "primary",
  size = "md",
  className,
  ...props
}: ProgressProps) {
  const motionSafe = useMotionSafe();
  const indeterminate = value === undefined || value === null;
  const clamped = indeterminate ? 0 : Math.min(Math.max(value, 0), max);
  const ratio = max > 0 ? clamped / max : 0;
  const text = valueText ?? (indeterminate ? "In progress" : `${Math.round(ratio * 100)}%`);

  return (
    <div className={cn("flex min-w-0 flex-col gap-1.5", className)} {...props}>
      {showLabel ? (
        <div className="flex min-w-0 items-baseline justify-between gap-3 text-xs">
          <span className="text-foreground truncate font-medium">{label}</span>
          <span className="text-muted-foreground shrink-0 tabular-nums">{text}</span>
        </div>
      ) : null}
      <div
        role="progressbar"
        aria-label={label}
        aria-valuemin={indeterminate ? undefined : 0}
        aria-valuemax={indeterminate ? undefined : max}
        aria-valuenow={indeterminate ? undefined : clamped}
        aria-valuetext={text}
        className={cn(
          "bg-surface-container-highest relative w-full overflow-hidden rounded-full",
          size === "sm" ? "h-1" : "h-1.5",
        )}
      >
        {indeterminate ? (
          <span
            className={cn(
              "absolute inset-y-0 left-0 w-full origin-left rounded-full",
              TONE[tone],
              motionSafe ? "animate-indeterminate" : "scale-x-[0.3]",
            )}
          />
        ) : (
          <span
            className={cn(
              "ease-emphasized absolute inset-y-0 left-0 w-full origin-left rounded-full transition-transform duration-500 motion-reduce:transition-none",
              TONE[tone],
            )}
            style={{ transform: `scaleX(${ratio})` }}
          />
        )}
      </div>
    </div>
  );
}

export interface CircularProgressProps extends Omit<
  React.SVGAttributes<SVGSVGElement>,
  "children"
> {
  value?: number | null;
  max?: number;
  label: string;
  size?: number;
}

/** Small circular indicator for inline loading (buttons, rows). */
export function CircularProgress({
  value,
  max = 100,
  label,
  size = 20,
  className,
  ...props
}: CircularProgressProps) {
  const motionSafe = useMotionSafe();
  const indeterminate = value === undefined || value === null;
  const r = 8;
  const c = 2 * Math.PI * r;
  const ratio = indeterminate ? 0.3 : Math.min(Math.max(value / max, 0), 1);
  return (
    <svg
      role="progressbar"
      aria-label={label}
      aria-valuemin={indeterminate ? undefined : 0}
      aria-valuemax={indeterminate ? undefined : max}
      aria-valuenow={indeterminate ? undefined : value}
      viewBox="0 0 20 20"
      width={size}
      height={size}
      className={cn(
        "text-primary shrink-0 -rotate-90",
        indeterminate && motionSafe && "animate-spin-slow",
        className,
      )}
      {...props}
    >
      <circle
        cx="10"
        cy="10"
        r={r}
        fill="none"
        strokeWidth="2.5"
        className="stroke-surface-container-highest"
      />
      <circle
        cx="10"
        cy="10"
        r={r}
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeDasharray={`${c * ratio} ${c}`}
      />
    </svg>
  );
}
