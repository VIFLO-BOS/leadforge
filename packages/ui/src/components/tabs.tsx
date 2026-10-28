"use client";

import * as React from "react";
import * as TabsPrimitive from "@radix-ui/react-tabs";
import { motion } from "framer-motion";
import { cn } from "../lib/cn";
import { useMotionSafe } from "../hooks/use-motion-safe";
import { SPRING } from "../lib/motion";

const TabsValueContext = React.createContext<string | undefined>(undefined);
const TabsListContext = React.createContext<{ variant: "underline" | "pill"; id: string }>({
  variant: "underline",
  id: "tabs",
});

/**
 * Tabs root (Radix keyboard model: arrow keys move between tabs, Home/End jump). Works
 * controlled or uncontrolled; tracks the active value so triggers can render the sliding indicator.
 */
export const Tabs = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Root>
>(({ value, defaultValue, onValueChange, ...props }, ref) => {
  const [inner, setInner] = React.useState(defaultValue);
  const current = value ?? inner;
  return (
    <TabsValueContext.Provider value={current}>
      <TabsPrimitive.Root
        ref={ref}
        value={current}
        onValueChange={(v) => {
          if (value === undefined) setInner(v);
          onValueChange?.(v);
        }}
        {...props}
      />
    </TabsValueContext.Provider>
  );
});
Tabs.displayName = "Tabs";

export interface TabsListProps extends React.ComponentPropsWithoutRef<typeof TabsPrimitive.List> {
  /**
   * underline: Material primary tabs (dashboard sections).
   * pill: segmented switcher with a sliding tonal pill (marketing feature switchers).
   */
  variant?: "underline" | "pill";
}

/** Horizontally scrollable on narrow widths so every tab stays reachable at 240px. */
export const TabsList = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.List>,
  TabsListProps
>(({ className, variant = "underline", ...props }, ref) => {
  const id = React.useId();
  return (
    <TabsListContext.Provider value={{ variant, id }}>
      <TabsPrimitive.List
        ref={ref}
        className={cn(
          "scrollbar-none flex min-w-0 overflow-x-auto",
          variant === "underline" && "border-border w-full items-end border-b",
          variant === "pill" &&
            "bg-surface-container-high max-w-full items-center gap-1 rounded-full p-1",
          className,
        )}
        {...props}
      />
    </TabsListContext.Provider>
  );
});
TabsList.displayName = "TabsList";

export const TabsTrigger = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger>
>(({ className, children, value, ...props }, ref) => {
  const current = React.useContext(TabsValueContext);
  const { variant, id } = React.useContext(TabsListContext);
  const motionSafe = useMotionSafe();
  const active = current === value;

  if (variant === "pill") {
    return (
      <TabsPrimitive.Trigger
        ref={ref}
        value={value}
        className={cn(
          "transition-ui text-muted-foreground hover:text-foreground data-[state=active]:text-foreground relative isolate inline-flex h-10 shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-full px-4 text-sm font-medium",
          "disabled:pointer-events-none disabled:opacity-[0.38] [&_svg]:size-[18px]",
          !motionSafe && "data-[state=active]:bg-surface data-[state=active]:shadow-1",
          className,
        )}
        {...props}
      >
        {motionSafe && active ? (
          <motion.span
            layoutId={`${id}-pill`}
            aria-hidden
            transition={SPRING.slow}
            style={{ borderRadius: 9999 }}
            className="bg-surface shadow-1 absolute inset-0 -z-10"
          />
        ) : null}
        {children}
      </TabsPrimitive.Trigger>
    );
  }

  return (
    <TabsPrimitive.Trigger
      ref={ref}
      value={value}
      className={cn(
        "state-layer transition-ui text-muted-foreground data-[state=active]:text-primary relative inline-flex h-12 shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-t-sm px-4 text-sm font-medium",
        "focus-visible:outline-offset-[-2px] disabled:pointer-events-none disabled:opacity-[0.38] [&_svg]:size-[18px]",
        className,
      )}
      {...props}
    >
      {children}
      {active ? (
        motionSafe ? (
          <motion.span
            layoutId={`${id}-underline`}
            aria-hidden
            transition={SPRING.slow}
            className="bg-primary absolute inset-x-3 bottom-0 h-[3px] rounded-t-full"
          />
        ) : (
          <span
            aria-hidden
            className="bg-primary absolute inset-x-3 bottom-0 h-[3px] rounded-t-full"
          />
        )
      ) : null}
    </TabsPrimitive.Trigger>
  );
});
TabsTrigger.displayName = "TabsTrigger";

export const TabsContent = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Content>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Content
    ref={ref}
    // Radix makes the panel a Tab stop (tabIndex 0) so keyboard users can reach its content; it
    // shows the standard 2px ring on keyboard focus like every other stop.
    className={cn("mt-5 min-w-0 rounded-md", className)}
    {...props}
  />
));
TabsContent.displayName = "TabsContent";
