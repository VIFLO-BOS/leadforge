"use client";

import * as React from "react";
import { Check, CircleAlert } from "lucide-react";
import { cn } from "../lib/cn";

export type StepStatus = "complete" | "current" | "upcoming" | "error";

export interface StepItem {
  id: string;
  label: string;
  description?: string;
  /** Overrides the status derived from `current`. */
  status?: StepStatus;
  /** Optional; shown in muted text after the label. */
  optional?: boolean;
}

export interface StepperProps extends Omit<React.HTMLAttributes<HTMLElement>, "onChange"> {
  steps: StepItem[];
  /** Index of the current step. */
  current: number;
  /** When set, completed steps become buttons that jump back. */
  onStepSelect?: (index: number) => void;
  /** Horizontal from 640px, vertical below (auto), or forced. */
  orientation?: "auto" | "horizontal" | "vertical";
  /**
   * Under 640px show "Step n of m" and a segmented bar instead of the full list, so a long
   * wizard does not push its content below the fold on a phone.
   */
  collapseOnNarrow?: boolean;
  "aria-label"?: string;
}

function statusOf(step: StepItem, index: number, current: number): StepStatus {
  if (step.status) return step.status;
  if (index < current) return "complete";
  if (index === current) return "current";
  return "upcoming";
}

/**
 * Wizard progress (discovery job creation). An ordered list with aria-current="step"; completed
 * steps can be revisited when `onStepSelect` is provided. Vertical under 640px.
 */
export function Stepper({
  steps,
  current,
  onStepSelect,
  orientation = "auto",
  collapseOnNarrow = false,
  className,
  ...props
}: StepperProps) {
  const currentStep = steps[current];
  const currentStatus = currentStep ? statusOf(currentStep, current, current) : "current";
  const vertical = orientation === "vertical";
  const horizontal = orientation === "horizontal";
  return (
    <nav aria-label={props["aria-label"] ?? "Progress"} className={cn("min-w-0", className)}>
      {collapseOnNarrow && currentStep ? (
        <div className="flex min-w-0 flex-col gap-2 min-[640px]:hidden">
          <p className="flex min-w-0 flex-wrap items-baseline gap-x-2 text-sm" aria-current="step">
            <span className="text-muted-foreground text-xs tabular-nums">
              Step {current + 1} of {steps.length}
            </span>
            <span className="font-medium">{currentStep.label}</span>
            {currentStatus === "error" ? (
              <span className="text-destructive text-xs">Needs attention</span>
            ) : null}
          </p>
          <div aria-hidden className="flex gap-1">
            {steps.map((step, i) => {
              const status = statusOf(step, i, current);
              return (
                <span
                  key={step.id}
                  className={cn(
                    "transition-ui h-1 flex-1 rounded-full",
                    status === "complete" || status === "current"
                      ? "bg-primary"
                      : status === "error"
                        ? "bg-destructive"
                        : "bg-surface-container-highest",
                  )}
                />
              );
            })}
          </div>
        </div>
      ) : null}
      <ol
        className={cn(
          "flex min-w-0",
          collapseOnNarrow && "max-[639.98px]:hidden",
          vertical && "flex-col",
          horizontal && "flex-row items-start",
          orientation === "auto" && "flex-col min-[640px]:flex-row min-[640px]:items-start",
        )}
      >
        {steps.map((step, i) => {
          const status = statusOf(step, i, current);
          const last = i === steps.length - 1;
          const clickable = Boolean(onStepSelect) && status === "complete";
          const marker = (
            <span
              className={cn(
                "flex size-7 shrink-0 items-center justify-center rounded-full text-xs font-medium",
                status === "complete" && "bg-primary text-primary-foreground",
                status === "current" &&
                  "bg-primary-container text-primary-container-foreground ring-primary ring-2",
                status === "upcoming" && "border-input text-muted-foreground border",
                status === "error" && "bg-destructive text-destructive-foreground",
              )}
            >
              {status === "complete" ? (
                <Check aria-hidden className="size-4" strokeWidth={3} />
              ) : status === "error" ? (
                <CircleAlert aria-hidden className="size-4" />
              ) : (
                i + 1
              )}
            </span>
          );
          const text = (
            <span className="flex min-w-0 flex-col">
              <span
                className={cn(
                  "text-sm font-medium leading-7",
                  status === "upcoming" ? "text-muted-foreground" : "text-foreground",
                )}
              >
                {step.label}
                {step.optional ? (
                  <span className="text-muted-foreground font-normal"> (optional)</span>
                ) : null}
              </span>
              {step.description ? (
                <span className="text-muted-foreground text-xs">{step.description}</span>
              ) : null}
              <span className="sr-only">
                {status === "complete"
                  ? "Completed"
                  : status === "current"
                    ? "Current step"
                    : status === "error"
                      ? "Needs attention"
                      : "Not started"}
              </span>
            </span>
          );
          const content = (
            <>
              {marker}
              {text}
            </>
          );
          return (
            <li
              key={step.id}
              aria-current={status === "current" ? "step" : undefined}
              className={cn(
                "relative flex min-w-0 items-start gap-3",
                !last && (vertical || orientation === "auto") && "pb-6",
                orientation === "auto" && "min-[640px]:pb-0",
                orientation === "auto" && !last && "min-[640px]:flex-1",
                horizontal && !last && "flex-1",
              )}
            >
              {!last && !horizontal ? (
                <span
                  aria-hidden
                  className={cn(
                    "absolute bottom-1 left-[13px] top-8 w-0.5",
                    status === "complete" ? "bg-primary" : "bg-border-strong",
                    orientation === "auto" && "min-[640px]:hidden",
                  )}
                />
              ) : null}
              {clickable ? (
                <button
                  type="button"
                  onClick={() => onStepSelect?.(i)}
                  className="state-layer flex min-w-0 items-start gap-3 rounded-md pr-2 text-left"
                >
                  {content}
                </button>
              ) : (
                <span className="flex min-w-0 items-start gap-3">{content}</span>
              )}
              {!last && !vertical ? (
                <span
                  aria-hidden
                  className={cn(
                    "h-0.5 min-w-4 flex-1 rounded-full",
                    status === "complete" ? "bg-primary" : "bg-border-strong",
                    // Aligned to the marker's centre (28px marker), so a label that wraps
                    // to two lines never pulls the connector off the line.
                    orientation === "auto" && "hidden min-[640px]:mt-[13px] min-[640px]:block",
                    horizontal && "mt-[13px]",
                  )}
                />
              ) : null}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
