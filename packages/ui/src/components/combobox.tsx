"use client";

import * as React from "react";
import { Check, ChevronsUpDown, LoaderCircle, Search, X } from "lucide-react";
import { cn } from "../lib/cn";
import { fieldClasses } from "./input";
import { Popover, PopoverContent, PopoverTrigger } from "./popover";

export interface ComboboxOption {
  value: string;
  label: string;
  description?: string;
  disabled?: boolean;
}

interface ComboboxSharedProps {
  id?: string;
  options: ComboboxOption[];
  placeholder?: string;
  searchPlaceholder?: string;
  emptyMessage?: string;
  /** Shows a spinner in the list while server results load. */
  loading?: boolean;
  disabled?: boolean;
  invalid?: boolean;
  /**
   * Server-side search. When provided, options are rendered as given (not filtered locally)
   * and this is called with every query change; debounce in the caller's query hook.
   */
  onSearchChange?: (query: string) => void;
  className?: string;
  "aria-label"?: string;
  "aria-labelledby"?: string;
  "aria-describedby"?: string;
}

export interface ComboboxProps extends ComboboxSharedProps {
  value: string | null;
  onValueChange: (value: string | null) => void;
  /** Adds a clear button when a value is selected. */
  clearable?: boolean;
}

export interface MultiComboboxProps extends ComboboxSharedProps {
  values: string[];
  onValuesChange: (values: string[]) => void;
}

function useFiltered(options: ComboboxOption[], query: string, server: boolean) {
  return React.useMemo(() => {
    if (server || !query.trim()) return options;
    const q = query.trim().toLowerCase();
    return options.filter(
      (o) => o.label.toLowerCase().includes(q) || o.description?.toLowerCase().includes(q),
    );
  }, [options, query, server]);
}

interface ListProps {
  listId: string;
  options: ComboboxOption[];
  isSelected: (value: string) => boolean;
  onPick: (option: ComboboxOption) => void;
  query: string;
  setQuery: (q: string) => void;
  searchPlaceholder: string;
  emptyMessage: string;
  loading?: boolean;
  multiple: boolean;
}

/** Search input (role=combobox) plus listbox, with arrow-key, Home/End and Enter handling. */
function ComboboxList({
  listId,
  options,
  isSelected,
  onPick,
  query,
  setQuery,
  searchPlaceholder,
  emptyMessage,
  loading,
  multiple,
}: ListProps) {
  const enabled = options.filter((o) => !o.disabled);
  const [active, setActive] = React.useState<string | null>(enabled[0]?.value ?? null);
  const listRef = React.useRef<HTMLUListElement>(null);

  React.useEffect(() => {
    if (!active || !options.some((o) => o.value === active && !o.disabled)) {
      setActive(options.find((o) => !o.disabled)?.value ?? null);
    }
  }, [options, active]);

  const optionId = (value: string) => `${listId}-opt-${value.replace(/[^a-zA-Z0-9_-]/g, "_")}`;

  React.useEffect(() => {
    if (!active || !listRef.current) return;
    listRef.current.ownerDocument
      .getElementById(optionId(active))
      ?.scrollIntoView({ block: "nearest" });
    // optionId is derived from listId, which is stable.
  }, [active]);

  const move = (delta: number) => {
    if (enabled.length === 0) return;
    const index = enabled.findIndex((o) => o.value === active);
    const next = enabled[(index + delta + enabled.length) % enabled.length];
    if (next) setActive(next.value);
  };

  return (
    <div className="flex min-w-0 flex-col">
      <div className="border-border relative flex items-center border-b">
        <Search aria-hidden className="text-muted-foreground absolute left-3 size-[18px]" />
        <input
          role="combobox"
          aria-expanded="true"
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={active ? optionId(active) : undefined}
          aria-label={searchPlaceholder}
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={searchPlaceholder}
          className="placeholder:text-muted-foreground h-11 w-full min-w-0 bg-transparent pl-10 pr-3 text-sm outline-none focus-visible:outline-none"
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              move(1);
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              move(-1);
            } else if (e.key === "Home" && !query) {
              e.preventDefault();
              setActive(enabled[0]?.value ?? null);
            } else if (e.key === "End" && !query) {
              e.preventDefault();
              setActive(enabled[enabled.length - 1]?.value ?? null);
            } else if (e.key === "Enter") {
              e.preventDefault();
              const option = options.find((o) => o.value === active);
              if (option && !option.disabled) onPick(option);
            }
          }}
        />
      </div>
      <ul
        ref={listRef}
        id={listId}
        role="listbox"
        aria-multiselectable={multiple || undefined}
        aria-busy={loading || undefined}
        className="max-h-64 overflow-y-auto py-1"
      >
        {loading ? (
          <li
            role="presentation"
            className="text-muted-foreground flex items-center gap-2 px-4 py-3 text-sm"
          >
            <LoaderCircle aria-hidden className="size-4 animate-spin" /> Loading
          </li>
        ) : options.length === 0 ? (
          <li role="presentation" className="text-muted-foreground px-4 py-3 text-sm">
            {emptyMessage}
          </li>
        ) : (
          options.map((option) => {
            const selected = isSelected(option.value);
            return (
              <li
                key={option.value}
                id={optionId(option.value)}
                role="option"
                data-value={option.value}
                aria-selected={selected}
                aria-disabled={option.disabled || undefined}
                onMouseMove={() => !option.disabled && setActive(option.value)}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => !option.disabled && onPick(option)}
                className={cn(
                  "relative flex min-h-11 cursor-default select-none items-start gap-3 py-2.5 pl-3 pr-3 text-sm",
                  // Focus state layer; a surface token is invisible on the dark popup surface.
                  active === option.value && "bg-foreground/12",
                  selected && "text-foreground",
                  option.disabled && "opacity-[0.38]",
                )}
              >
                <span className="flex size-5 shrink-0 items-center justify-center">
                  {selected ? <Check aria-hidden className="text-primary size-[18px]" /> : null}
                </span>
                <span className="flex min-w-0 flex-col">
                  <span className="break-anywhere">{option.label}</span>
                  {option.description ? (
                    <span className="text-muted-foreground text-xs">{option.description}</span>
                  ) : null}
                </span>
              </li>
            );
          })
        )}
      </ul>
    </div>
  );
}

const triggerClasses = cn(
  fieldClasses,
  "flex h-10 items-center justify-between gap-2 px-3 text-left text-sm",
);

/** Searchable single-select (industry, location). Keyboard: open with Enter/Space/ArrowDown. */
export function Combobox({
  id,
  options,
  value,
  onValueChange,
  placeholder = "Select",
  searchPlaceholder = "Search",
  emptyMessage = "No matches",
  loading,
  disabled,
  invalid,
  onSearchChange,
  clearable,
  className,
  ...aria
}: ComboboxProps) {
  const [open, setOpen] = React.useState(false);
  const [query, setQueryState] = React.useState("");
  const listId = React.useId();
  const filtered = useFiltered(options, query, Boolean(onSearchChange));
  const selected = options.find((o) => o.value === value) ?? null;
  const setQuery = (q: string) => {
    setQueryState(q);
    onSearchChange?.(q);
  };

  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) setQuery("");
      }}
    >
      <div className={cn("relative min-w-0", className)}>
        <PopoverTrigger asChild disabled={disabled}>
          <button
            id={id}
            type="button"
            aria-haspopup="listbox"
            aria-invalid={invalid || undefined}
            {...aria}
            className={cn(triggerClasses, clearable && selected && "pr-16")}
          >
            <span className={cn("truncate", !selected && "text-muted-foreground")}>
              {selected?.label ?? placeholder}
            </span>
            <ChevronsUpDown aria-hidden className="text-muted-foreground size-[18px] shrink-0" />
          </button>
        </PopoverTrigger>
        {clearable && selected && !disabled ? (
          <button
            type="button"
            aria-label={`Clear ${selected.label}`}
            onClick={() => onValueChange(null)}
            className="state-layer text-muted-foreground absolute right-9 top-1/2 flex size-7 -translate-y-1/2 items-center justify-center rounded-full"
          >
            <X aria-hidden className="size-4" />
          </button>
        ) : null}
      </div>
      <PopoverContent className="w-[max(var(--radix-popover-trigger-width),16rem)] overflow-hidden p-0">
        <ComboboxList
          listId={listId}
          options={filtered}
          isSelected={(v) => v === value}
          onPick={(o) => {
            onValueChange(o.value);
            setOpen(false);
            setQuery("");
          }}
          query={query}
          setQuery={setQuery}
          searchPlaceholder={searchPlaceholder}
          emptyMessage={emptyMessage}
          loading={loading}
          multiple={false}
        />
      </PopoverContent>
    </Popover>
  );
}

/** Searchable multi-select; selections render as removable input chips below the trigger. */
export function MultiCombobox({
  id,
  options,
  values,
  onValuesChange,
  placeholder = "Select",
  searchPlaceholder = "Search",
  emptyMessage = "No matches",
  loading,
  disabled,
  invalid,
  onSearchChange,
  className,
  ...aria
}: MultiComboboxProps) {
  const [open, setOpen] = React.useState(false);
  const [query, setQueryState] = React.useState("");
  const listId = React.useId();
  const filtered = useFiltered(options, query, Boolean(onSearchChange));
  const selectedSet = new Set(values);
  const setQuery = (q: string) => {
    setQueryState(q);
    onSearchChange?.(q);
  };
  const toggle = (v: string) =>
    onValuesChange(selectedSet.has(v) ? values.filter((x) => x !== v) : [...values, v]);
  const labelOf = (v: string) => options.find((o) => o.value === v)?.label ?? v;

  return (
    <div className={cn("flex min-w-0 flex-col gap-2", className)}>
      <Popover
        open={open}
        onOpenChange={(o) => {
          setOpen(o);
          if (!o) setQuery("");
        }}
      >
        <PopoverTrigger asChild disabled={disabled}>
          <button
            id={id}
            type="button"
            aria-haspopup="listbox"
            aria-invalid={invalid || undefined}
            {...aria}
            className={triggerClasses}
          >
            <span className={cn("truncate", values.length === 0 && "text-muted-foreground")}>
              {values.length === 0 ? placeholder : `${values.length} selected`}
            </span>
            <ChevronsUpDown aria-hidden className="text-muted-foreground size-[18px] shrink-0" />
          </button>
        </PopoverTrigger>
        <PopoverContent className="w-[max(var(--radix-popover-trigger-width),16rem)] overflow-hidden p-0">
          <ComboboxList
            listId={listId}
            options={filtered}
            isSelected={(v) => selectedSet.has(v)}
            onPick={(o) => toggle(o.value)}
            query={query}
            setQuery={setQuery}
            searchPlaceholder={searchPlaceholder}
            emptyMessage={emptyMessage}
            loading={loading}
            multiple
          />
        </PopoverContent>
      </Popover>
      {values.length > 0 ? (
        <ul className="flex min-w-0 flex-wrap gap-1.5" aria-label="Selected">
          {values.map((v) => (
            <li key={v} className="min-w-0">
              <span className="border-border-strong bg-surface inline-flex h-7 min-w-0 max-w-full items-center gap-1 rounded-full border pl-2.5 pr-1 text-xs font-medium">
                <span className="truncate">{labelOf(v)}</span>
                <button
                  type="button"
                  disabled={disabled}
                  aria-label={`Remove ${labelOf(v)}`}
                  onClick={() => toggle(v)}
                  className="state-layer text-muted-foreground flex size-5 shrink-0 items-center justify-center rounded-full"
                >
                  <X aria-hidden className="size-3.5" />
                </button>
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
