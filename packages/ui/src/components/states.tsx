import * as React from "react";
import { CircleAlert, type LucideIcon } from "lucide-react";
import { cn } from "../lib/cn";
import { Button } from "./button";
import { Heading, type HeadingLevelValue } from "./heading-level";
import { Code } from "./typography";

export interface EmptyStateProps extends React.HTMLAttributes<HTMLDivElement> {
  icon?: LucideIcon;
  title: string;
  description?: React.ReactNode;
  action?: React.ReactNode;
  /** compact: inside cards and tables. default: page-level. */
  size?: "compact" | "default";
  /** Heading level of the title; defaults to the surrounding HeadingLevel context. */
  level?: HeadingLevelValue;
}

/** Explains what will appear here and offers the first action. */
export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  size = "default",
  level,
  className,
  ...props
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        "flex min-w-0 flex-col items-center justify-center gap-4 text-center",
        size === "default"
          ? "bg-surface-container-low rounded-lg px-4 py-12 sm:px-8 sm:py-16"
          : "px-4 py-8",
        className,
      )}
      {...props}
    >
      {Icon ? (
        <span
          className={cn(
            "bg-primary-container text-primary-container-foreground flex items-center justify-center rounded-full",
            size === "default" ? "size-14" : "size-11",
          )}
        >
          <Icon aria-hidden className={size === "default" ? "size-7" : "size-5"} />
        </span>
      ) : null}
      <div className="flex max-w-md flex-col gap-1.5">
        <Heading
          level={level}
          className={cn("font-medium", size === "default" ? "text-base" : "text-sm")}
        >
          {title}
        </Heading>
        {description ? (
          <div className="text-muted-foreground text-sm leading-relaxed">{description}</div>
        ) : null}
      </div>
      {action ? (
        <div className="flex flex-wrap items-center justify-center gap-2">{action}</div>
      ) : null}
    </div>
  );
}

export interface ErrorStateProps extends React.HTMLAttributes<HTMLDivElement> {
  title?: string;
  message: string;
  requestId?: string | null | undefined;
  onRetry?: () => void;
  retryLabel?: string;
  /** The title's element: "h1" when the error is the whole page (nothing else names it). */
  titleAs?: "p" | "h1" | "h2" | "h3";
}

/** Inline error with an optional retry and the request ID for support. */
export function ErrorState({
  title = "Something went wrong",
  message,
  requestId,
  onRetry,
  retryLabel = "Try again",
  titleAs: Title = "p",
  className,
  ...props
}: ErrorStateProps) {
  return (
    <div
      role="alert"
      className={cn(
        "bg-destructive-subtle flex min-w-0 flex-col items-start gap-3 rounded-md p-4",
        className,
      )}
      {...props}
    >
      <div className="flex min-w-0 items-start gap-3">
        <CircleAlert aria-hidden className="text-destructive mt-0.5 size-5 shrink-0" />
        <div className="flex min-w-0 flex-col gap-0.5">
          <Title className="text-foreground text-sm font-medium">{title}</Title>
          <p className="break-anywhere text-foreground text-sm">{message}</p>
          {requestId ? (
            <p className="text-muted-foreground mt-1 text-xs">
              Request ID <Code className="bg-transparent px-0">{requestId}</Code>
            </p>
          ) : null}
        </div>
      </div>
      {onRetry ? (
        <Button type="button" variant="outline" size="sm" onClick={onRetry} className="ml-8">
          {retryLabel}
        </Button>
      ) : null}
    </div>
  );
}

/**
 * Visually hidden polite live region. Keep it mounted and derive `message` from a status, so it
 * changes (and is announced) only on transitions such as queued -> running -> completed, never on
 * every poll. Used for job, import, analysis, enrichment and recompute status.
 */
export function LiveAnnouncement({
  message,
  className,
  ...props
}: { message: string } & React.HTMLAttributes<HTMLParagraphElement>) {
  return (
    <p className={cn("sr-only", className)} aria-live="polite" aria-atomic="true" {...props}>
      {message}
    </p>
  );
}

/** Loading placeholder. A soft shimmer when motion is allowed; static tone under reduced motion. */
export function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      aria-hidden
      className={cn(
        "bg-surface-container-high relative overflow-hidden rounded-sm",
        "motion-safe:after:animate-shimmer after:absolute after:inset-0 after:-translate-x-full after:bg-[linear-gradient(90deg,transparent,color-mix(in_srgb,var(--surface)_55%,transparent),transparent)] motion-reduce:after:hidden",
        className,
      )}
      {...props}
    />
  );
}
