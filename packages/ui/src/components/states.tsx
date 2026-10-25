import * as React from "react";
import { AlertCircle, type LucideIcon } from "lucide-react";
import { cn } from "../lib/cn";
import { Button } from "./button";
import { Code } from "./typography";

export interface EmptyStateProps extends React.HTMLAttributes<HTMLDivElement> {
  icon?: LucideIcon;
  title: string;
  description?: React.ReactNode;
  action?: React.ReactNode;
}

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
  ...props
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        "border-border bg-surface flex min-w-0 flex-col items-center justify-center gap-3 rounded-lg border border-dashed px-4 py-10 text-center",
        className,
      )}
      {...props}
    >
      {Icon ? (
        <span className="bg-muted text-muted-foreground flex size-12 items-center justify-center rounded-full">
          <Icon aria-hidden className="size-6" />
        </span>
      ) : null}
      <div className="max-w-prose">
        <h3 className="text-base font-semibold">{title}</h3>
        {description ? <p className="text-muted-foreground mt-1 text-sm">{description}</p> : null}
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
}

export function ErrorState({
  title = "Something went wrong",
  message,
  requestId,
  onRetry,
  retryLabel = "Try again",
  className,
  ...props
}: ErrorStateProps) {
  return (
    <div
      role="alert"
      className={cn(
        "border-destructive/40 bg-destructive-subtle flex min-w-0 flex-col items-start gap-3 rounded-lg border p-4",
        className,
      )}
      {...props}
    >
      <div className="flex min-w-0 items-start gap-2">
        <AlertCircle aria-hidden className="text-destructive mt-0.5 size-4 shrink-0" />
        <div className="min-w-0">
          <p className="text-sm font-semibold">{title}</p>
          <p className="break-anywhere text-muted-foreground text-sm">{message}</p>
          {requestId ? (
            <p className="text-muted-foreground mt-1 text-xs">
              Request ID <Code>{requestId}</Code>
            </p>
          ) : null}
        </div>
      </div>
      {onRetry ? (
        <Button type="button" variant="outline" size="sm" onClick={onRetry}>
          {retryLabel}
        </Button>
      ) : null}
    </div>
  );
}

export function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      aria-hidden
      className={cn("bg-muted rounded-md motion-safe:animate-pulse", className)}
      {...props}
    />
  );
}
