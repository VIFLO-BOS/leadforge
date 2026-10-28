"use client";

import * as React from "react";
import * as LabelPrimitive from "@radix-ui/react-label";
import { cn } from "../lib/cn";

export const Label = React.forwardRef<
  React.ElementRef<typeof LabelPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof LabelPrimitive.Root>
>(({ className, ...props }, ref) => (
  <LabelPrimitive.Root
    ref={ref}
    className={cn(
      "text-foreground text-sm font-medium leading-5 peer-disabled:opacity-60",
      className,
    )}
    {...props}
  />
));
Label.displayName = "Label";

/**
 * Top-labelled form field: label, control, supporting text or error wired with
 * aria-describedby. Use for dense dashboard forms, Select, Combobox and anything that is not a
 * plain text input; use TextField for text inputs that should float their label.
 */
export function FormField({
  id,
  label,
  error,
  hint,
  required,
  children,
  className,
}: {
  id: string;
  label: React.ReactNode;
  error?: string | undefined;
  hint?: React.ReactNode;
  required?: boolean;
  children: React.ReactNode;
  className?: string;
}) {
  const describedBy = [hint ? `${id}-hint` : null, error ? `${id}-error` : null]
    .filter(Boolean)
    .join(" ");
  // A single native control gets aria-describedby automatically; anything else wires it itself.
  const child = React.Children.count(children) === 1 ? React.Children.toArray(children)[0] : null;
  const control =
    describedBy && React.isValidElement<{ "aria-describedby"?: string }>(child)
      ? React.cloneElement(child, {
          "aria-describedby":
            [child.props["aria-describedby"], describedBy].filter(Boolean).join(" ") || undefined,
        })
      : children;
  return (
    <div className={cn("flex min-w-0 flex-col gap-1.5", className)}>
      <Label htmlFor={id}>
        {label}
        {required ? (
          <span aria-hidden className="text-destructive">
            {" "}
            *
          </span>
        ) : null}
      </Label>
      {control}
      {hint ? (
        <p id={`${id}-hint`} className="text-muted-foreground text-xs">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={`${id}-error`} role="alert" className="text-destructive text-xs">
          {error}
        </p>
      ) : null}
    </div>
  );
}
