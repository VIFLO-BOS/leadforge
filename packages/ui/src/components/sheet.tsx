"use client";

import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { cva, type VariantProps } from "class-variance-authority";
import { X } from "lucide-react";
import { cn } from "../lib/cn";
import { DialogOverlay, useReturnFocus } from "./dialog";
import { HeadingLevel } from "./heading-level";

export const Sheet = DialogPrimitive.Root;
export const SheetTrigger = DialogPrimitive.Trigger;
export const SheetClose = DialogPrimitive.Close;
export const SheetTitle = DialogPrimitive.Title;
export const SheetDescription = DialogPrimitive.Description;

/**
 * Modal sheets. Full width under 480px; above that a navigation drawer (left), a detail panel
 * (right) or a bottom sheet with a 28px top radius. Slides on emphasized decelerate easing.
 */
const sheetVariants = cva(
  "fixed z-50 flex flex-col bg-surface-container-low text-foreground outline-none data-[state=open]:animate-in data-[state=closed]:animate-out duration-300 ease-[cubic-bezier(0.05,0.7,0.1,1)] data-[state=closed]:duration-200 data-[state=closed]:ease-[cubic-bezier(0.3,0,0.8,0.15)] motion-reduce:animate-none",
  {
    variants: {
      side: {
        left: "inset-y-0 left-0 h-dvh w-full min-[480px]:w-[320px] min-[480px]:rounded-r-lg data-[state=closed]:slide-out-to-left data-[state=open]:slide-in-from-left",
        right:
          "inset-y-0 right-0 h-dvh w-full min-[480px]:w-[420px] min-[480px]:rounded-l-lg data-[state=closed]:slide-out-to-right data-[state=open]:slide-in-from-right",
        bottom:
          "inset-x-0 bottom-0 max-h-[85dvh] rounded-t-2xl data-[state=closed]:slide-out-to-bottom data-[state=open]:slide-in-from-bottom",
        full: "inset-0 h-dvh w-full data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
      },
    },
    defaultVariants: { side: "right" },
  },
);

export interface SheetContentProps
  extends
    React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content>,
    VariantProps<typeof sheetVariants> {
  hideClose?: boolean;
}

export const SheetContent = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  SheetContentProps
>(({ side, className, children, hideClose, onOpenAutoFocus, onCloseAutoFocus, ...props }, ref) => {
  const focus = useReturnFocus({ onOpenAutoFocus, onCloseAutoFocus });
  return (
    <DialogPrimitive.Portal>
      <DialogOverlay />
      <DialogPrimitive.Content
        ref={ref}
        className={cn(sheetVariants({ side }), className)}
        {...props}
        onOpenAutoFocus={focus.onOpenAutoFocus}
        onCloseAutoFocus={focus.onCloseAutoFocus}
      >
        {side === "bottom" ? (
          <span
            aria-hidden
            className="bg-input/60 mx-auto mb-1 mt-3 h-1 w-8 shrink-0 rounded-full"
          />
        ) : null}
        {/* The title is the sheet's h2; headings inside the sheet start at h3. */}
        <HeadingLevel level={3}>{children}</HeadingLevel>
        {hideClose ? null : (
          <DialogPrimitive.Close
            aria-label="Close"
            className="state-layer text-muted-foreground absolute right-3 top-3 flex size-10 items-center justify-center rounded-full"
          >
            <X aria-hidden className="size-5" />
          </DialogPrimitive.Close>
        )}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
});
SheetContent.displayName = "SheetContent";

export function SheetHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("flex shrink-0 flex-col gap-1 px-5 pb-3 pr-16 pt-5", className)}
      {...props}
    />
  );
}

export function SheetBody({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("min-h-0 flex-1 overflow-y-auto px-5 py-2", className)} {...props} />;
}

export function SheetFooter({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "border-border flex shrink-0 flex-col-reverse gap-2 border-t px-5 py-4 min-[360px]:flex-row min-[360px]:justify-end",
        className,
      )}
      {...props}
    />
  );
}
