"use client";

import * as React from "react";
import * as SelectPrimitive from "@radix-ui/react-select";
import { Check, ChevronDown } from "lucide-react";
import { cn } from "../lib/cn";
import { fieldClasses } from "./input";

export const Select = SelectPrimitive.Root;
export const SelectGroup = SelectPrimitive.Group;
export const SelectValue = SelectPrimitive.Value;

export const SelectTrigger = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Trigger> & { size?: "sm" | "md" }
>(({ className, children, size = "md", ...props }, ref) => (
  <SelectPrimitive.Trigger
    ref={ref}
    className={cn(
      fieldClasses,
      "data-[placeholder]:text-muted-foreground flex items-center justify-between gap-2 text-left [&>span]:truncate",
      size === "sm" ? "h-8 px-2.5 text-[13px]" : "h-10 px-3 text-sm",
      className,
    )}
    {...props}
  >
    {children}
    <SelectPrimitive.Icon asChild>
      <ChevronDown aria-hidden className="text-muted-foreground size-[18px] shrink-0" />
    </SelectPrimitive.Icon>
  </SelectPrimitive.Trigger>
));
SelectTrigger.displayName = "SelectTrigger";

export const SelectContent = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Content>
>(({ className, children, position = "popper", ...props }, ref) => (
  <SelectPrimitive.Portal>
    <SelectPrimitive.Content
      ref={ref}
      position={position}
      className={cn(
        "bg-surface-elevated text-foreground shadow-2 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 z-50 max-h-[min(24rem,var(--radix-select-content-available-height))] w-[min(var(--radix-select-trigger-width),calc(100vw-24px))] min-w-0 overflow-hidden rounded-sm py-1 duration-200 motion-reduce:animate-none",
        position === "popper" && "data-[side=bottom]:translate-y-1 data-[side=top]:-translate-y-1",
        className,
      )}
      {...props}
    >
      <SelectPrimitive.Viewport>{children}</SelectPrimitive.Viewport>
    </SelectPrimitive.Content>
  </SelectPrimitive.Portal>
));
SelectContent.displayName = "SelectContent";

export const SelectItem = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Item>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Item>
>(({ className, children, ...props }, ref) => (
  <SelectPrimitive.Item
    ref={ref}
    className={cn(
      "data-[highlighted]:bg-foreground/12 data-[state=checked]:bg-secondary data-[state=checked]:text-secondary-foreground relative flex min-h-11 w-full cursor-default select-none items-center py-2 pl-10 pr-3 text-sm outline-none data-[disabled]:pointer-events-none data-[disabled]:opacity-[0.38]",
      className,
    )}
    {...props}
  >
    <span className="absolute left-3 flex size-5 items-center justify-center">
      <SelectPrimitive.ItemIndicator>
        <Check aria-hidden className="size-[18px]" />
      </SelectPrimitive.ItemIndicator>
    </span>
    <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
  </SelectPrimitive.Item>
));
SelectItem.displayName = "SelectItem";
