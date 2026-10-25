import * as React from "react";
import { cn } from "../lib/cn";

export function Kbd({ className, ...props }: React.HTMLAttributes<HTMLElement>) {
  return (
    <kbd
      className={cn(
        "border-border bg-muted text-muted-foreground inline-flex h-5 min-w-5 items-center justify-center rounded border px-1 font-mono text-[11px]",
        className,
      )}
      {...props}
    />
  );
}

export function Code({ className, ...props }: React.HTMLAttributes<HTMLElement>) {
  return (
    <code
      className={cn(
        "break-anywhere bg-muted text-foreground rounded px-1 py-0.5 font-mono text-[13px]",
        className,
      )}
      {...props}
    />
  );
}
