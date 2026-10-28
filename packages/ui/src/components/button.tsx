"use client";

import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { Loader2 } from "lucide-react";
import { cn } from "../lib/cn";

/**
 * Pill buttons (Material 3). Hover and press feedback is a state layer (opacity) plus a 0.97
 * press scale (transform) on emphasized easing; nothing else animates.
 */
export const buttonVariants = cva(
  "transition-ui press-scale inline-flex shrink-0 select-none items-center justify-center gap-2 whitespace-nowrap rounded-full border font-medium tracking-[0.01em] disabled:pointer-events-none disabled:opacity-[0.38] aria-disabled:pointer-events-none aria-disabled:opacity-[0.38] [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        /** Filled: the one primary action in a region. */
        primary: "state-layer border-transparent bg-primary text-primary-foreground",
        /** Tonal: secondary emphasis. */
        secondary: "state-layer border-transparent bg-secondary text-secondary-foreground",
        tonal: "state-layer border-transparent bg-secondary text-secondary-foreground",
        /** Outlined: medium emphasis, neutral label. */
        outline: "state-layer border-input bg-transparent text-foreground",
        /** Text button in the brand colour (dialog actions, inline actions). */
        text: "state-layer border-transparent bg-transparent text-primary",
        /** Neutral text button and icon buttons. */
        ghost: "state-layer border-transparent bg-transparent text-foreground",
        /** Filled destructive. */
        destructive: "state-layer border-transparent bg-destructive text-destructive-foreground",
        /** Inline link styled as text; no pill padding. */
        link: "h-auto rounded-sm border-transparent bg-transparent px-0 text-primary underline-offset-4 hover:underline",
      },
      size: {
        sm: "h-8 px-3.5 text-[13px] [&_svg]:size-4",
        md: "h-10 px-5 text-sm [&_svg]:size-[18px]",
        lg: "h-11 px-6 text-sm [&_svg]:size-[18px]",
        xl: "h-12 px-7 text-[15px] [&_svg]:size-5",
        icon: "size-10 px-0 [&_svg]:size-5",
        "icon-sm": "size-8 px-0 [&_svg]:size-[18px]",
        "icon-lg": "size-12 px-0 [&_svg]:size-6",
      },
    },
    compoundVariants: [{ variant: "link", class: "h-auto px-0" }],
    defaultVariants: { variant: "primary", size: "md" },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  asChild?: boolean;
  loading?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      className,
      variant,
      size,
      asChild = false,
      loading = false,
      disabled,
      children,
      type,
      ...props
    },
    ref,
  ) => {
    const classes = cn(buttonVariants({ variant, size }), className);

    // Slot requires exactly one element child, so asChild cannot show a spinner.
    if (asChild) {
      return (
        <Slot
          ref={ref}
          className={classes}
          aria-disabled={disabled || loading || undefined}
          {...props}
        >
          {children}
        </Slot>
      );
    }

    return (
      <button
        ref={ref}
        type={type ?? "button"}
        className={classes}
        disabled={disabled || loading}
        aria-busy={loading || undefined}
        data-loading={loading || undefined}
        {...props}
      >
        {loading ? <Loader2 aria-hidden className="animate-spin" /> : null}
        {children}
      </button>
    );
  },
);
Button.displayName = "Button";
