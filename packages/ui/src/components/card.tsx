"use client";

import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "../lib/cn";
import { HeadingLevel, useHeadingLevel, type HeadingLevelValue } from "./heading-level";

/**
 * Cards separate content by tone first, outline second, shadow last.
 * - outlined: default dashboard card (surface + decorative outline).
 * - filled: tonal container, no outline.
 * - elevated: tonal plus level-1 shadow, for content that floats over imagery.
 * `interactive` adds a hover state layer and a 2px lift (transform only).
 */
export const cardVariants = cva("text-foreground min-w-0 rounded-lg", {
  variants: {
    variant: {
      outlined: "border border-border bg-surface",
      filled: "bg-surface-container-low",
      elevated: "bg-surface-container-low shadow-1",
      tonal: "bg-primary-subtle",
    },
    interactive: {
      true: "state-layer transition-ui duration-300 hover:-translate-y-0.5 motion-reduce:translate-none",
      false: "",
    },
  },
  defaultVariants: { variant: "outlined", interactive: false },
});

export interface CardProps
  extends React.HTMLAttributes<HTMLDivElement>, VariantProps<typeof cardVariants> {}

/** The level a CardTitle uses: the level that was current where the Card was placed. */
const CardTitleLevelContext = React.createContext<HeadingLevelValue | null>(null);

/**
 * A card is a nested section: its title takes the current heading level and anything inside it
 * (an EmptyState, a nested card) one level deeper, so headings never skip a level.
 */
export const Card = React.forwardRef<HTMLDivElement, CardProps>(
  ({ className, variant, interactive, children, ...props }, ref) => {
    const level = useHeadingLevel();
    return (
      <div ref={ref} className={cn(cardVariants({ variant, interactive }), className)} {...props}>
        <CardTitleLevelContext.Provider value={level}>
          <HeadingLevel>{children}</HeadingLevel>
        </CardTitleLevelContext.Provider>
      </div>
    );
  },
);
Card.displayName = "Card";

export const CardHeader = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn("flex flex-col gap-1 p-4 sm:p-5", className)} {...props} />
  ),
);
CardHeader.displayName = "CardHeader";

export interface CardTitleProps extends React.HTMLAttributes<HTMLHeadingElement> {
  /** Explicit level; otherwise the level where the Card sits (h2 directly under a page h1). */
  level?: HeadingLevelValue;
}

export const CardTitle = React.forwardRef<HTMLHeadingElement, CardTitleProps>(
  ({ className, level, ...props }, ref) => {
    const cardLevel = React.useContext(CardTitleLevelContext);
    const ctx = useHeadingLevel();
    const Tag = `h${level ?? cardLevel ?? ctx}` as "h3";
    return (
      <Tag ref={ref} className={cn("text-base font-medium leading-snug", className)} {...props} />
    );
  },
);
CardTitle.displayName = "CardTitle";

export const CardDescription = React.forwardRef<
  HTMLParagraphElement,
  React.HTMLAttributes<HTMLParagraphElement>
>(({ className, ...props }, ref) => (
  <p ref={ref} className={cn("text-muted-foreground text-sm", className)} {...props} />
));
CardDescription.displayName = "CardDescription";

export const CardContent = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn("p-4 pt-0 sm:p-5 sm:pt-0", className)} {...props} />
  ),
);
CardContent.displayName = "CardContent";

export const CardFooter = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn("flex flex-wrap items-center gap-2 p-4 pt-0 sm:p-5 sm:pt-0", className)}
      {...props}
    />
  ),
);
CardFooter.displayName = "CardFooter";
