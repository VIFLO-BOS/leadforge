"use client";

import * as React from "react";
import { Search, X } from "lucide-react";
import { cn } from "../lib/cn";

export interface SearchFieldProps extends Omit<
  React.InputHTMLAttributes<HTMLInputElement>,
  "onChange" | "value" | "size"
> {
  value?: string;
  defaultValue?: string;
  /** Called after the debounce delay with the trimmed value. */
  onDebouncedChange: (value: string) => void;
  delay?: number;
  label?: string;
  /** pill: tonal search bar (app bars, directory). outlined: inside forms and filter panels. */
  appearance?: "pill" | "outlined";
  size?: "md" | "lg";
  /** Extra content before the clear button (for example a keyboard hint). */
  trailing?: React.ReactNode;
}

/** Debounced search input with a clear button, inside a role="search" landmark named `label`. */
export const SearchField = React.forwardRef<HTMLInputElement, SearchFieldProps>(
  (
    {
      className,
      value,
      defaultValue = "",
      onDebouncedChange,
      delay = 300,
      label = "Search",
      appearance = "pill",
      size = "md",
      trailing,
      ...props
    },
    ref,
  ) => {
    const [text, setText] = React.useState(value ?? defaultValue);
    const first = React.useRef(true);

    React.useEffect(() => {
      if (value !== undefined) setText(value);
    }, [value]);

    const callbackRef = React.useRef(onDebouncedChange);
    callbackRef.current = onDebouncedChange;

    React.useEffect(() => {
      if (first.current) {
        first.current = false;
        return;
      }
      const t = window.setTimeout(() => callbackRef.current(text.trim()), delay);
      return () => window.clearTimeout(t);
    }, [text, delay]);

    return (
      // Named after the field, so several search landmarks on a page stay distinguishable.
      <div
        role="search"
        aria-label={label}
        className={cn("relative flex min-w-0 items-center", className)}
      >
        <Search
          aria-hidden
          className={cn(
            "text-muted-foreground pointer-events-none absolute size-5",
            size === "lg" ? "left-4" : "left-3",
          )}
        />
        <input
          ref={ref}
          type="search"
          aria-label={label}
          value={text}
          onChange={(e) => setText(e.target.value)}
          className={cn(
            "transition-ui text-foreground placeholder:text-muted-foreground w-full min-w-0 outline-none [&::-webkit-search-cancel-button]:hidden",
            size === "lg" ? "h-12 pl-12 text-base" : "h-10 pl-10 text-sm",
            text || trailing ? "pr-11" : "pr-4",
            appearance === "pill"
              ? "bg-surface-container-high hover:bg-surface-container-highest focus:bg-surface focus:border-primary rounded-full border border-transparent focus:shadow-[inset_0_0_0_1px_var(--primary)] focus-visible:outline-none"
              : "border-input focus:border-primary rounded-sm border bg-[var(--field-bg,var(--surface))] focus:shadow-[inset_0_0_0_1px_var(--primary)] focus-visible:outline-none",
          )}
          {...props}
        />
        <div className="absolute right-1 flex items-center gap-1">
          {!text ? trailing : null}
          {text ? (
            <button
              type="button"
              aria-label="Clear search"
              onClick={() => setText("")}
              className="state-layer text-muted-foreground flex size-8 items-center justify-center rounded-full"
            >
              <X aria-hidden className="size-[18px]" />
            </button>
          ) : null}
        </div>
      </div>
    );
  },
);
SearchField.displayName = "SearchField";
