import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { AlertTriangle, CheckCircle2, Circle, Info, XCircle, type LucideIcon } from "lucide-react";
import { cn } from "../lib/cn";

export const badgeVariants = cva(
  "inline-flex max-w-full items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium leading-5 whitespace-nowrap [&_svg]:size-3",
  {
    variants: {
      variant: {
        neutral: "border-transparent bg-muted text-foreground",
        success: "border-transparent bg-success-subtle text-success",
        warning: "border-transparent bg-warning-subtle text-warning",
        destructive: "border-transparent bg-destructive-subtle text-destructive",
        info: "border-transparent bg-info-subtle text-info",
        primary: "border-transparent bg-primary-subtle text-primary",
        outline: "border-border bg-transparent text-muted-foreground",
      },
    },
    defaultVariants: { variant: "neutral" },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>, VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export type StatusTone = "neutral" | "success" | "warning" | "destructive" | "info";

const STATUS_ICON: Record<StatusTone, LucideIcon> = {
  neutral: Circle,
  success: CheckCircle2,
  warning: AlertTriangle,
  destructive: XCircle,
  info: Info,
};

const STATUS_DOT: Record<StatusTone, string> = {
  neutral: "bg-muted-foreground",
  success: "bg-success",
  warning: "bg-warning",
  destructive: "bg-destructive",
  info: "bg-info",
};

export interface StatusIndicatorProps extends React.HTMLAttributes<HTMLSpanElement> {
  tone: StatusTone;
  label: string;
  icon?: LucideIcon | null;
  /** Show a pulsing dot for in-progress states. Static under reduced motion. */
  live?: boolean;
}

/**
 * Status is never color alone: a dot, an icon and a text label are always rendered.
 */
export function StatusIndicator({
  tone,
  label,
  icon,
  live,
  className,
  ...props
}: StatusIndicatorProps) {
  const Icon = icon === null ? null : (icon ?? STATUS_ICON[tone]);
  return (
    <span className={cn("inline-flex min-w-0 items-center gap-1.5 text-sm", className)} {...props}>
      <span
        aria-hidden
        className={cn(
          "size-2 shrink-0 rounded-full",
          STATUS_DOT[tone],
          live && "motion-safe:animate-pulse",
        )}
      />
      {Icon ? <Icon aria-hidden className="text-muted-foreground size-3.5 shrink-0" /> : null}
      <span className="truncate">{label}</span>
    </span>
  );
}
