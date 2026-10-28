"use client";

import * as React from "react";
import { Check, X } from "lucide-react";
import { cn } from "../lib/cn";

export type ChipVariant = "assist" | "filter" | "input" | "suggestion";

export interface ChipProps extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "onClick"> {
  variant?: ChipVariant;
  /** Filter chips: selected state (rendered as aria-pressed plus a check icon). */
  selected?: boolean;
  /** Leading icon (hidden on a selected filter chip, which shows a check instead). */
  icon?: React.ReactNode;
  /** Input chips: called by the trailing remove button and by Backspace/Delete. */
  onRemove?: () => void;
  /** Accessible name for the remove button. Defaults to "Remove <label>". */
  removeLabel?: string;
  onClick?: React.MouseEventHandler<HTMLButtonElement>;
  size?: "sm" | "md";
}

/**
 * Pill chips (Material 3 semantics).
 * - assist / suggestion: a button that performs an action or inserts a suggestion.
 * - filter: a toggle button (aria-pressed) with a check icon when selected.
 * - input: represents a value (an applied filter, a recipient) with a remove button.
 */
export const Chip = React.forwardRef<HTMLButtonElement, ChipProps>(
  (
    {
      variant = "assist",
      selected = false,
      icon,
      onRemove,
      removeLabel,
      className,
      children,
      disabled,
      size = "md",
      onKeyDown,
      ...props
    },
    ref,
  ) => {
    const base = cn(
      "transition-ui inline-flex max-w-full min-w-0 items-center gap-1.5 rounded-full border font-medium whitespace-nowrap",
      size === "sm" ? "h-7 text-xs [&_svg]:size-3.5" : "h-8 text-[13px] [&_svg]:size-4",
      "disabled:cursor-not-allowed disabled:opacity-[0.38]",
    );
    const tone =
      variant === "filter" && selected
        ? "border-transparent bg-secondary text-secondary-foreground"
        : variant === "input"
          ? "border-border-strong bg-surface text-foreground"
          : "border-border-strong bg-transparent text-foreground";

    if (variant === "input") {
      const label = typeof children === "string" ? children : undefined;
      return (
        <span
          className={cn(base, tone, "pr-1", size === "sm" ? "pl-2.5" : "pl-3", className)}
          data-disabled={disabled || undefined}
        >
          {icon ? <span className="text-muted-foreground flex shrink-0">{icon}</span> : null}
          <span className="truncate">{children}</span>
          {onRemove ? (
            <button
              ref={ref}
              type="button"
              disabled={disabled}
              aria-label={removeLabel ?? (label ? `Remove ${label}` : "Remove")}
              onClick={onRemove}
              onKeyDown={(e) => {
                if (e.key === "Backspace" || e.key === "Delete") {
                  e.preventDefault();
                  onRemove();
                }
                onKeyDown?.(e);
              }}
              className="state-layer text-muted-foreground flex size-6 shrink-0 items-center justify-center rounded-full"
              {...props}
            >
              <X aria-hidden />
            </button>
          ) : null}
        </span>
      );
    }

    return (
      <button
        ref={ref}
        type="button"
        disabled={disabled}
        aria-pressed={variant === "filter" ? selected : undefined}
        onKeyDown={onKeyDown}
        className={cn(
          base,
          tone,
          "state-layer press-scale",
          size === "sm" ? "px-2.5" : "px-3",
          (icon || (variant === "filter" && selected)) && (size === "sm" ? "pl-2" : "pl-2.5"),
          className,
        )}
        {...props}
      >
        {variant === "filter" && selected ? (
          <Check aria-hidden className="shrink-0" />
        ) : icon ? (
          <span className="text-primary flex shrink-0">{icon}</span>
        ) : null}
        <span className="truncate">{children}</span>
      </button>
    );
  },
);
Chip.displayName = "Chip";
