"use client";

import * as React from "react";
import { Search, X } from "lucide-react";
import { cn } from "../lib/cn";

export interface SearchFieldProps extends Omit<
  React.InputHTMLAttributes<HTMLInputElement>,
  "onChange" | "value"
> {
  value?: string;
  defaultValue?: string;
  /** Called after the debounce delay with the trimmed value. */
  onDebouncedChange: (value: string) => void;
  delay?: number;
  label?: string;
}

export const SearchField = React.forwardRef<HTMLInputElement, SearchFieldProps>(
  (
    {
      className,
      value,
      defaultValue = "",
      onDebouncedChange,
      delay = 300,
      label = "Search",
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
      <div role="search" className={cn("relative flex min-w-0 items-center", className)}>
        <Search
          aria-hidden
          className="text-muted-foreground pointer-events-none absolute left-3 size-4"
        />
        <input
          ref={ref}
          type="search"
          aria-label={label}
          value={text}
          onChange={(e) => setText(e.target.value)}
          className="border-input bg-surface placeholder:text-muted-foreground h-10 w-full min-w-0 rounded-md border pl-9 pr-9 text-sm [&::-webkit-search-cancel-button]:hidden"
          {...props}
        />
        {text ? (
          <button
            type="button"
            aria-label="Clear search"
            onClick={() => setText("")}
            className="text-muted-foreground hover:bg-muted hover:text-foreground absolute right-1 flex size-8 items-center justify-center rounded-md"
          >
            <X aria-hidden className="size-4" />
          </button>
        ) : null}
      </div>
    );
  },
);
SearchField.displayName = "SearchField";
