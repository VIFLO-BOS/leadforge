"use client";

import { useId } from "react";
import { Badge, Button, cn, type ButtonProps } from "@leadforge/ui";

/**
 * A feature that is not available yet: a disabled button with a visible "Coming soon" label
 * beside it (not inside it, where the disabled opacity would make it unreadable). No route, no
 * handler.
 */
export function ComingSoonButton({
  children,
  variant = "outline",
  size = "sm",
  className,
}: {
  children: React.ReactNode;
  variant?: ButtonProps["variant"];
  size?: ButtonProps["size"];
  className?: string;
}) {
  const id = useId();
  return (
    <span className={cn("inline-flex min-w-0 flex-wrap items-center gap-2", className)}>
      <Button variant={variant} size={size} disabled aria-describedby={id}>
        {children}
      </Button>
      <Badge id={id} variant="outline">
        Coming soon
      </Badge>
    </span>
  );
}
