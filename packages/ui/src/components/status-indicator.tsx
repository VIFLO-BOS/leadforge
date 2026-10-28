"use client";

import * as React from "react";
import {
  Ban,
  BadgeCheck,
  CircleAlert,
  CircleCheck,
  CircleDashed,
  CircleSlash,
  CircleX,
  Clock,
  PencilLine,
  GitCompareArrows,
  History,
  Info,
  LoaderCircle,
  TimerOff,
  TriangleAlert,
  Circle,
  type LucideIcon,
} from "lucide-react";
import { cn } from "../lib/cn";
import { useMotionSafe } from "../hooks/use-motion-safe";

export type StatusTone = "neutral" | "success" | "warning" | "destructive" | "info";

/** Contact-field states (docs/PRODUCT_REQUIREMENTS.md section 5). */
export type FieldState =
  "verified" | "unverified" | "stale" | "expired" | "missing" | "conflicting";

/**
 * Background job states (discovery, import, analysis, export). `draft` is a job that exists but
 * has not been queued yet (an uploaded CSV waiting for its column mapping).
 */
export type JobState =
  "draft" | "queued" | "running" | "completed" | "completed_with_warnings" | "failed" | "cancelled";

interface StatusMeta {
  label: string;
  tone: StatusTone;
  icon: LucideIcon;
  description: string;
}

export const FIELD_STATE_META: Record<FieldState, StatusMeta> = {
  verified: {
    label: "Verified",
    tone: "success",
    icon: BadgeCheck,
    description: "A verification method succeeded for this value.",
  },
  unverified: {
    label: "Unverified",
    tone: "neutral",
    icon: CircleDashed,
    description: "Observed in a source but not verified.",
  },
  stale: {
    label: "Stale",
    tone: "warning",
    icon: History,
    description: "Older than the workspace freshness window.",
  },
  expired: {
    label: "Expired",
    tone: "neutral",
    icon: TimerOff,
    description: "Past the source's retention limit. Refresh to collect it again.",
  },
  missing: {
    label: "Missing",
    tone: "neutral",
    icon: CircleSlash,
    description: "No source has provided this value.",
  },
  conflicting: {
    label: "Conflicting",
    tone: "warning",
    icon: GitCompareArrows,
    description: "Sources disagree. All observed values are shown.",
  },
};

export const JOB_STATE_META: Record<JobState, StatusMeta> = {
  draft: {
    label: "Draft",
    tone: "neutral",
    icon: PencilLine,
    description: "Created but not queued yet.",
  },
  queued: {
    label: "Queued",
    tone: "neutral",
    icon: Clock,
    description: "Waiting for a worker.",
  },
  running: {
    label: "Running",
    tone: "info",
    icon: LoaderCircle,
    description: "A worker is processing this job.",
  },
  completed: {
    label: "Completed",
    tone: "success",
    icon: CircleCheck,
    description: "Finished without errors.",
  },
  completed_with_warnings: {
    label: "Completed with warnings",
    tone: "warning",
    icon: TriangleAlert,
    description: "Finished, but some items failed or were skipped.",
  },
  failed: {
    label: "Failed",
    tone: "destructive",
    icon: CircleX,
    description: "Stopped because of an error.",
  },
  cancelled: {
    label: "Cancelled",
    tone: "neutral",
    icon: Ban,
    description: "Stopped by a team member.",
  },
};

const TONE_ICON: Record<StatusTone, LucideIcon> = {
  neutral: Circle,
  success: CircleCheck,
  warning: TriangleAlert,
  destructive: CircleAlert,
  info: Info,
};

const TONE_TEXT: Record<StatusTone, string> = {
  neutral: "text-muted-foreground",
  success: "text-success",
  warning: "text-warning",
  destructive: "text-destructive",
  info: "text-info",
};

const TONE_CONTAINER: Record<StatusTone, string> = {
  neutral: "bg-surface-container-high text-foreground [&>svg]:text-muted-foreground",
  success: "bg-success-subtle text-success",
  warning: "bg-warning-subtle text-warning",
  destructive: "bg-destructive-subtle text-destructive",
  info: "bg-info-subtle text-info",
};

export interface StatusIndicatorProps extends React.HTMLAttributes<HTMLSpanElement> {
  tone: StatusTone;
  label: string;
  /** Override the tone's default icon. Status always renders an icon plus text. */
  icon?: LucideIcon;
  /** Spin the icon for in-progress states. Static under reduced motion. */
  live?: boolean;
  /** inline: icon plus text. badge: the same inside a tonal pill. */
  variant?: "inline" | "badge";
  size?: "sm" | "md";
}

/**
 * Status is never colour alone: an icon and a text label are always rendered, and the
 * coloured part is the icon (3:1 graphic contrast) while text stays in readable ink.
 */
export function StatusIndicator({
  tone,
  label,
  icon,
  live,
  variant = "inline",
  size = "md",
  className,
  ...props
}: StatusIndicatorProps) {
  const motionSafe = useMotionSafe();
  const Icon = icon ?? TONE_ICON[tone];
  const iconClass = cn(
    "shrink-0",
    size === "sm" ? "size-3.5" : "size-4",
    live && motionSafe && "animate-spin-slow",
  );

  if (variant === "badge") {
    return (
      <span
        className={cn(
          "inline-flex h-6 max-w-full items-center gap-1 rounded-full px-2 text-xs font-medium",
          TONE_CONTAINER[tone],
          className,
        )}
        data-status-tone={tone}
        {...props}
      >
        <Icon aria-hidden className={iconClass} />
        <span className="truncate">{label}</span>
      </span>
    );
  }

  return (
    <span
      className={cn(
        "inline-flex min-w-0 max-w-full items-start gap-1.5",
        size === "sm" ? "text-xs leading-4" : "text-sm leading-5",
        className,
      )}
      data-status-tone={tone}
      {...props}
    >
      <Icon
        aria-hidden
        className={cn(iconClass, "mt-0.5", size === "sm" && "mt-px", TONE_TEXT[tone])}
      />
      <span className="text-foreground min-w-0 break-words">{label}</span>
    </span>
  );
}

export interface FieldStatusProps extends Omit<StatusIndicatorProps, "tone" | "label" | "icon"> {
  state: FieldState;
  /** Optional override, for example "Verified by MX check". */
  label?: string;
}

/** Contact-field state: verified, unverified, stale, expired, missing or conflicting. */
export function FieldStatus({ state, label, title, ...props }: FieldStatusProps) {
  const meta = FIELD_STATE_META[state];
  return (
    <StatusIndicator
      tone={meta.tone}
      icon={meta.icon}
      label={label ?? meta.label}
      title={title ?? meta.description}
      data-state={state}
      {...props}
    />
  );
}

export interface JobStatusProps extends Omit<StatusIndicatorProps, "tone" | "label" | "icon"> {
  state: JobState;
  label?: string;
}

/** Background job state: queued, running, completed, completed with warnings, failed, cancelled. */
export function JobStatus({ state, label, title, ...props }: JobStatusProps) {
  const meta = JOB_STATE_META[state];
  return (
    <StatusIndicator
      tone={meta.tone}
      icon={meta.icon}
      label={label ?? meta.label}
      live={state === "running"}
      title={title ?? meta.description}
      data-state={state}
      {...props}
    />
  );
}
