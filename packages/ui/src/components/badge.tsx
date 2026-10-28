import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "../lib/cn";

/** Small pill labels. Status badges always carry text; pair with an icon when meaning is state. */
export const badgeVariants = cva(
  "inline-flex h-6 max-w-full items-center gap-1 whitespace-nowrap rounded-full border px-2.5 text-xs font-medium leading-none [&_svg]:size-3.5 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        neutral: "border-transparent bg-surface-container-high text-foreground",
        success: "border-transparent bg-success-subtle text-success",
        warning: "border-transparent bg-warning-subtle text-warning",
        destructive: "border-transparent bg-destructive-subtle text-destructive",
        info: "border-transparent bg-info-subtle text-info",
        primary: "border-transparent bg-primary-container text-primary-container-foreground",
        outline: "border-border-strong bg-transparent text-muted-foreground",
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
