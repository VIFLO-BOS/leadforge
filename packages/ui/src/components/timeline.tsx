import * as React from "react";
import { Circle, type LucideIcon } from "lucide-react";
import { cn } from "../lib/cn";
import type { StatusTone } from "./status-indicator";

export interface TimelineItem {
  id: string;
  title: React.ReactNode;
  /** ISO timestamp; rendered in a <time> element. */
  timestamp: string;
  /** Pre-formatted time text. Defaults to the locale date and time. */
  timestampLabel?: string;
  description?: React.ReactNode;
  /** Source, actor or method, for example "Places API (Sample)" or "Ada (Researcher)". */
  meta?: React.ReactNode;
  icon?: LucideIcon;
  tone?: StatusTone | "primary";
}

export interface TimelineProps extends React.HTMLAttributes<HTMLOListElement> {
  items: TimelineItem[];
  /** compact: activity feeds in narrow panels. */
  density?: "comfortable" | "compact";
  "aria-label"?: string;
}

const TONE: Record<NonNullable<TimelineItem["tone"]>, string> = {
  neutral: "bg-surface-container-high text-muted-foreground",
  primary: "bg-primary-container text-primary-container-foreground",
  success: "bg-success-subtle text-success",
  warning: "bg-warning-subtle text-warning",
  destructive: "bg-destructive-subtle text-destructive",
  info: "bg-info-subtle text-info",
};

/**
 * Vertical event list for provenance trails and activity. Newest first is the caller's choice;
 * each entry shows when, what, and where it came from.
 */
export function Timeline({ items, density = "comfortable", className, ...props }: TimelineProps) {
  return (
    <ol className={cn("flex min-w-0 flex-col", className)} {...props}>
      {items.map((item, i) => {
        const Icon = item.icon ?? Circle;
        const last = i === items.length - 1;
        return (
          <li
            key={item.id}
            className={cn(
              "relative flex min-w-0 gap-3",
              !last && (density === "compact" ? "pb-4" : "pb-6"),
            )}
          >
            {!last ? (
              <span
                aria-hidden
                className={cn(
                  "bg-border absolute w-0.5",
                  density === "compact"
                    ? "bottom-1 left-[11px] top-7"
                    : "bottom-1 left-[15px] top-9",
                )}
              />
            ) : null}
            <span
              className={cn(
                "flex shrink-0 items-center justify-center rounded-full",
                density === "compact" ? "size-6 [&_svg]:size-3.5" : "size-8 [&_svg]:size-4",
                TONE[item.tone ?? "neutral"],
              )}
            >
              <Icon aria-hidden />
            </span>
            <div className="flex min-w-0 flex-1 flex-col gap-0.5 pt-1">
              <div className="flex min-w-0 flex-col gap-x-3 gap-y-0.5 min-[480px]:flex-row min-[480px]:items-baseline min-[480px]:justify-between">
                <p className="text-foreground min-w-0 text-sm font-medium">{item.title}</p>
                <time
                  dateTime={item.timestamp}
                  className="text-muted-foreground shrink-0 text-xs tabular-nums"
                >
                  {item.timestampLabel ?? new Date(item.timestamp).toLocaleString()}
                </time>
              </div>
              {item.description ? (
                <div className="break-anywhere text-muted-foreground text-sm">
                  {item.description}
                </div>
              ) : null}
              {item.meta ? <div className="text-muted-foreground text-xs">{item.meta}</div> : null}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
