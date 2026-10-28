"use client";

import * as React from "react";
import * as CheckboxPrimitive from "@radix-ui/react-checkbox";
import * as RadioGroupPrimitive from "@radix-ui/react-radio-group";
import * as SwitchPrimitive from "@radix-ui/react-switch";
import { Check, Minus } from "lucide-react";
import { cn } from "../lib/cn";

/**
 * Material checkbox: 18px box with a 2px outline, inside a 40px state-layer target so touch
 * targets meet the 40px minimum without changing layout density.
 */
export const Checkbox = React.forwardRef<
  React.ElementRef<typeof CheckboxPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof CheckboxPrimitive.Root>
>(({ className, ...props }, ref) => (
  <CheckboxPrimitive.Root
    ref={ref}
    className={cn(
      "transition-ui text-primary-foreground peer relative isolate inline-flex size-[18px] shrink-0 items-center justify-center rounded-[3px] border-2 border-[var(--muted-foreground)] bg-transparent",
      "before:bg-foreground data-[state=checked]:before:bg-primary before:absolute before:-inset-[11px] before:-z-10 before:rounded-full before:opacity-0 before:transition-opacity before:duration-150 hover:before:opacity-[0.08]",
      "data-[state=checked]:border-primary data-[state=checked]:bg-primary data-[state=indeterminate]:border-primary data-[state=indeterminate]:bg-primary",
      "aria-invalid:border-destructive disabled:cursor-not-allowed disabled:opacity-[0.38]",
      className,
    )}
    {...props}
  >
    <CheckboxPrimitive.Indicator className="flex items-center justify-center">
      {props.checked === "indeterminate" ? (
        <Minus aria-hidden strokeWidth={3} className="size-3.5" />
      ) : (
        <Check aria-hidden strokeWidth={3} className="size-3.5" />
      )}
    </CheckboxPrimitive.Indicator>
  </CheckboxPrimitive.Root>
));
Checkbox.displayName = "Checkbox";

export const RadioGroup = React.forwardRef<
  React.ElementRef<typeof RadioGroupPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof RadioGroupPrimitive.Root>
>(({ className, ...props }, ref) => (
  <RadioGroupPrimitive.Root ref={ref} className={cn("grid gap-3", className)} {...props} />
));
RadioGroup.displayName = "RadioGroup";

export const RadioGroupItem = React.forwardRef<
  React.ElementRef<typeof RadioGroupPrimitive.Item>,
  React.ComponentPropsWithoutRef<typeof RadioGroupPrimitive.Item>
>(({ className, ...props }, ref) => (
  <RadioGroupPrimitive.Item
    ref={ref}
    className={cn(
      "transition-ui text-primary peer relative isolate inline-flex size-5 shrink-0 items-center justify-center rounded-full border-2 border-[var(--muted-foreground)]",
      "before:bg-foreground data-[state=checked]:before:bg-primary before:absolute before:-inset-[10px] before:-z-10 before:rounded-full before:opacity-0 before:transition-opacity before:duration-150 hover:before:opacity-[0.08]",
      "data-[state=checked]:border-primary disabled:cursor-not-allowed disabled:opacity-[0.38]",
      className,
    )}
    {...props}
  >
    <RadioGroupPrimitive.Indicator className="flex items-center justify-center">
      <span className="bg-primary size-2.5 rounded-full" />
    </RadioGroupPrimitive.Indicator>
  </RadioGroupPrimitive.Item>
));
RadioGroupItem.displayName = "RadioGroupItem";

/**
 * Material 3 switch: 52x32 track; the thumb grows from 16px to 24px when selected and shows a
 * check icon, so state is not carried by colour alone.
 */
export const Switch = React.forwardRef<
  React.ElementRef<typeof SwitchPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof SwitchPrimitive.Root>
>(({ className, ...props }, ref) => (
  <SwitchPrimitive.Root
    ref={ref}
    className={cn(
      "transition-ui group/switch peer relative inline-flex h-8 w-[52px] shrink-0 cursor-pointer items-center rounded-full border-2",
      "bg-surface-container-highest data-[state=checked]:border-primary data-[state=checked]:bg-primary border-[var(--input)]",
      "disabled:cursor-not-allowed disabled:opacity-[0.38]",
      className,
    )}
    {...props}
  >
    <SwitchPrimitive.Thumb
      className={cn(
        "pointer-events-none flex size-6 items-center justify-center rounded-full",
        "text-primary data-[state=checked]:bg-primary-foreground bg-[var(--input)]",
        "translate-x-[2px] scale-[0.667] data-[state=checked]:translate-x-[22px] data-[state=checked]:scale-100",
        "ease-emphasized transition-[translate,scale] duration-300 motion-reduce:transition-none",
      )}
    >
      <Check
        aria-hidden
        strokeWidth={3}
        className="size-4 opacity-0 transition-opacity duration-150 group-data-[state=checked]/switch:opacity-100"
      />
    </SwitchPrimitive.Thumb>
  </SwitchPrimitive.Root>
));
Switch.displayName = "Switch";

export interface ChoiceFieldProps {
  id: string;
  label: React.ReactNode;
  description?: React.ReactNode;
  control: React.ReactElement;
  className?: string;
  /** Put the control after the text (settings rows with a Switch). */
  controlPosition?: "start" | "end";
}

/** Label and optional description beside a Checkbox, RadioGroupItem or Switch. */
export function ChoiceField({
  id,
  label,
  description,
  control,
  className,
  controlPosition = "start",
}: ChoiceFieldProps) {
  const descId = description ? `${id}-description` : undefined;
  const controlEl = React.cloneElement(
    control as React.ReactElement<{ id?: string; "aria-describedby"?: string }>,
    { id, "aria-describedby": descId },
  );
  return (
    <div
      className={cn(
        "flex min-w-0 items-start gap-3",
        controlPosition === "end" && "flex-row-reverse justify-between",
        className,
      )}
    >
      <span className={cn("flex shrink-0 items-center", controlPosition === "end" ? "h-8" : "h-5")}>
        {controlEl}
      </span>
      <span className="flex min-w-0 flex-col gap-0.5">
        <label htmlFor={id} className="text-foreground text-sm font-medium leading-5">
          {label}
        </label>
        {description ? (
          <span id={descId} className="text-muted-foreground text-xs leading-4">
            {description}
          </span>
        ) : null}
      </span>
    </div>
  );
}
