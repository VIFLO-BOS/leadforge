"use client";

import * as React from "react";
import * as RadioGroupPrimitive from "@radix-ui/react-radio-group";
import { Check } from "lucide-react";
import { motion } from "framer-motion";
import { cn } from "../lib/cn";
import { useMotionSafe } from "../hooks/use-motion-safe";
import { SPRING } from "../lib/motion";

export interface SegmentedOption<V extends string = string> {
  value: V;
  label: React.ReactNode;
  icon?: React.ReactNode;
  disabled?: boolean;
  /** Accessible name when `label` is icon-only. */
  ariaLabel?: string;
}

export interface SegmentedControlProps<V extends string = string> {
  options: SegmentedOption<V>[];
  value: V;
  onValueChange: (value: V) => void;
  /** Required: names the group for assistive technology. */
  "aria-label": string;
  size?: "sm" | "md";
  /** Stretch segments to fill the container. */
  fullWidth?: boolean;
  /** Show a check icon on the selected segment (Material segmented button). */
  showCheck?: boolean;
  disabled?: boolean;
  className?: string;
}

/**
 * Single-select segmented button. Radio-group semantics: Tab enters the group, arrow keys move
 * the selection. The selected segment uses the secondary container plus a check icon, so state is
 * never colour alone; the fill slides between segments on emphasized springs when motion is allowed.
 */
export function SegmentedControl<V extends string = string>({
  options,
  value,
  onValueChange,
  size = "md",
  fullWidth = false,
  showCheck = true,
  disabled,
  className,
  ...aria
}: SegmentedControlProps<V>) {
  const motionSafe = useMotionSafe();
  const id = React.useId();
  return (
    <RadioGroupPrimitive.Root
      value={value}
      onValueChange={(v) => onValueChange(v as V)}
      orientation="horizontal"
      disabled={disabled}
      aria-label={aria["aria-label"]}
      className={cn(
        "border-input inline-flex min-w-0 max-w-full items-stretch rounded-full border p-0",
        fullWidth && "flex w-full",
        size === "sm" ? "h-8" : "h-10",
        className,
      )}
    >
      {options.map((opt, i) => {
        const selected = opt.value === value;
        return (
          <RadioGroupPrimitive.Item
            key={opt.value}
            value={opt.value}
            disabled={opt.disabled}
            aria-label={opt.ariaLabel}
            className={cn(
              "state-layer transition-ui text-foreground relative flex min-w-0 items-center justify-center gap-1.5 whitespace-nowrap font-medium",
              "disabled:cursor-not-allowed disabled:opacity-[0.38]",
              i > 0 && "border-input border-l",
              i === 0 && "rounded-l-full",
              i === options.length - 1 && "rounded-r-full",
              fullWidth && "flex-1",
              size === "sm"
                ? "px-3 text-[13px] [&_svg]:size-4"
                : "px-4 text-sm [&_svg]:size-[18px]",
              selected && "text-secondary-foreground",
              !motionSafe && selected && "bg-secondary",
            )}
          >
            {motionSafe && selected ? (
              <motion.span
                layoutId={`${id}-segment`}
                aria-hidden
                transition={SPRING.slow}
                className={cn(
                  "bg-secondary absolute inset-0 -z-[2]",
                  i === 0 && "rounded-l-full",
                  i === options.length - 1 && "rounded-r-full",
                )}
              />
            ) : null}
            {showCheck && selected ? <Check aria-hidden className="shrink-0" /> : opt.icon}
            <span className="truncate">{opt.label}</span>
          </RadioGroupPrimitive.Item>
        );
      })}
    </RadioGroupPrimitive.Root>
  );
}
