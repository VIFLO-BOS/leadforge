import * as React from "react";
import { cn } from "../lib/cn";

export interface PageHeaderProps extends Omit<React.HTMLAttributes<HTMLDivElement>, "title"> {
  title: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  breadcrumbs?: React.ReactNode;
  as?: "h1" | "h2";
}

/** Title, optional description and actions. Actions wrap below the title under 480px. */
export function PageHeader({
  title,
  description,
  actions,
  breadcrumbs,
  as = "h1",
  className,
  ...props
}: PageHeaderProps) {
  const Heading = as;
  return (
    <div className={cn("flex min-w-0 flex-col gap-3", className)} {...props}>
      {breadcrumbs}
      <div className="flex min-w-0 flex-col gap-3 min-[480px]:flex-row min-[480px]:items-start min-[480px]:justify-between">
        <div className="min-w-0 flex-1">
          <Heading className="break-anywhere text-xl font-semibold leading-tight sm:text-2xl">
            {title}
          </Heading>
          {description ? <p className="text-muted-foreground mt-1 text-sm">{description}</p> : null}
        </div>
        {actions ? (
          <div className="flex min-w-0 flex-wrap items-center gap-2">{actions}</div>
        ) : null}
      </div>
    </div>
  );
}
