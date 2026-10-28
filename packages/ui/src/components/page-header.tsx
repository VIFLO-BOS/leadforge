import * as React from "react";
import { cn } from "../lib/cn";

export interface PageHeaderProps extends Omit<React.HTMLAttributes<HTMLDivElement>, "title"> {
  title: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  breadcrumbs?: React.ReactNode;
  /** Small line above the title (section name, status). */
  eyebrow?: React.ReactNode;
  as?: "h1" | "h2";
}

/** Title, optional description and actions. Actions wrap below the title under 480px. */
export function PageHeader({
  title,
  description,
  actions,
  breadcrumbs,
  eyebrow,
  as = "h1",
  className,
  ...props
}: PageHeaderProps) {
  const Heading = as;
  return (
    <div className={cn("flex min-w-0 flex-col gap-3", className)} {...props}>
      {breadcrumbs}
      <div className="flex min-w-0 flex-col gap-4 min-[480px]:flex-row min-[480px]:items-end min-[480px]:justify-between">
        {/* The title keeps at least 10rem beside the actions, so many actions (or 200% zoom at
            1280, a 640px viewport) wrap the buttons instead of squeezing the h1 to one letter
            per line (WCAG 1.4.10 reflow). */}
        <div className="flex min-w-[min(100%,10rem)] flex-1 flex-col gap-1">
          {eyebrow ? (
            <div className="text-muted-foreground text-xs font-medium">{eyebrow}</div>
          ) : null}
          <Heading className="break-anywhere text-xl font-normal leading-7 tracking-[-0.01em] sm:text-2xl sm:leading-8">
            {title}
          </Heading>
          {description ? (
            <p className="text-muted-foreground max-w-3xl text-sm leading-5">{description}</p>
          ) : null}
        </div>
        {actions ? (
          <div className="flex min-w-0 flex-wrap items-center gap-2">{actions}</div>
        ) : null}
      </div>
    </div>
  );
}
