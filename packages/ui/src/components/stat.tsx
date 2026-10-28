import * as React from "react";
import { ArrowDownRight, ArrowUpRight, Minus, type LucideIcon } from "lucide-react";
import { cn } from "../lib/cn";
import { Skeleton } from "./states";

export interface StatTrend {
  /** Pre-formatted change, for example "+12%" or "-3". Only from real backend data. */
  value: string;
  direction: "up" | "down" | "flat";
  /** Whether this direction is good for the metric (credits used going up is not). */
  sentiment?: "positive" | "negative" | "neutral";
  /** Comparison period, for example "vs last 30 days". */
  label?: string;
}

export interface StatProps extends React.HTMLAttributes<HTMLDivElement> {
  label: string;
  /** Pre-formatted value. null or undefined renders the empty state ("No data yet"). */
  value?: React.ReactNode | null;
  icon?: LucideIcon;
  /** Supporting line under the value, for example the unit or scope. */
  hint?: React.ReactNode;
  trend?: StatTrend;
  /** Source and freshness, for example "Updated 2 min ago from discovery jobs". */
  footnote?: React.ReactNode;
  loading?: boolean;
  emptyLabel?: string;
}

const TREND_ICON = { up: ArrowUpRight, down: ArrowDownRight, flat: Minus } as const;
const SENTIMENT = {
  positive: "text-success",
  negative: "text-destructive",
  neutral: "text-muted-foreground",
} as const;

/**
 * KPI tile. Shows only real values: with no value it says "No data yet" instead of a zero or a
 * placeholder number. Trend arrows carry text, never colour alone.
 */
export function Stat({
  label,
  value,
  icon: Icon,
  hint,
  trend,
  footnote,
  loading,
  emptyLabel = "No data yet",
  className,
  ...props
}: StatProps) {
  const empty = value === null || value === undefined;
  const TrendIcon = trend ? TREND_ICON[trend.direction] : null;
  return (
    <div
      className={cn(
        // Dark mode steps up two tones: the content panel is surface (= container-low in dark),
        // so a container-low tile would not separate from it.
        "bg-surface-container-low dark:bg-surface-container-high flex min-w-0 flex-col gap-3 rounded-md p-4",
        className,
      )}
      aria-busy={loading || undefined}
      data-stat={label}
      {...props}
    >
      <div className="flex min-w-0 items-start justify-between gap-2">
        <p className="text-muted-foreground text-[13px] font-medium leading-5">{label}</p>
        {Icon ? (
          <span className="bg-surface text-primary flex size-8 shrink-0 items-center justify-center rounded-full">
            <Icon aria-hidden className="size-4" />
          </span>
        ) : null}
      </div>
      {loading ? (
        <div className="flex flex-col gap-2">
          <Skeleton className="h-8 w-24" />
          <Skeleton className="h-3 w-32 max-w-full" />
        </div>
      ) : (
        <div className="animate-in fade-in-0 flex min-w-0 flex-col gap-1 duration-300 motion-reduce:animate-none">
          {empty ? (
            <p className="text-muted-foreground text-sm leading-8" data-stat-empty>
              {emptyLabel}
            </p>
          ) : (
            <p
              className="break-anywhere text-foreground text-2xl font-normal leading-8 tracking-[-0.015em]"
              data-stat-value
            >
              {value}
            </p>
          )}
          {hint ? <p className="text-muted-foreground text-xs">{hint}</p> : null}
          {trend && TrendIcon && !empty ? (
            <p className="flex flex-wrap items-center gap-1 text-xs">
              <span
                className={cn(
                  "inline-flex items-center gap-0.5 font-medium",
                  SENTIMENT[trend.sentiment ?? "neutral"],
                )}
              >
                <TrendIcon aria-hidden className="size-3.5" />
                {trend.value}
              </span>
              {trend.label ? <span className="text-muted-foreground">{trend.label}</span> : null}
            </p>
          ) : null}
        </div>
      )}
      {footnote ? (
        <p className="text-muted-foreground border-border mt-auto border-t pt-2 text-xs">
          {footnote}
        </p>
      ) : null}
    </div>
  );
}
