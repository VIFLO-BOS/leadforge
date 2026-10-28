"use client";

import * as React from "react";
import { Check, ChevronDown } from "lucide-react";
import { cn } from "../lib/cn";
import { Button } from "./button";
import { fieldClasses, Input } from "./input";
import { Popover, PopoverContent, PopoverTrigger } from "./popover";

export interface RangeValue {
  min?: number;
  max?: number;
}

export interface FilterRangeSection {
  id: string;
  /** Section name inside the panel, for example "Fit score". */
  label: string;
  value: RangeValue;
}

export interface FilterRangeProps {
  /** Filter name on the trigger, for example "Lead score". */
  label: string;
  sections: FilterRangeSection[];
  /** Called once with every section's new range when the user applies or clears. */
  onApply: (values: Record<string, RangeValue>) => void;
  /** Inclusive bounds shared by every section. */
  bounds?: { min: number; max: number };
  /** chip for inline toolbars, field for filter sheets (same contract as FilterMenu). */
  appearance?: "chip" | "field";
  disabled?: boolean;
  align?: "start" | "end";
  className?: string;
}

type Draft = Record<string, { min: string; max: string }>;

function toDraft(sections: FilterRangeSection[]): Draft {
  return Object.fromEntries(
    sections.map((s) => [
      s.id,
      {
        min: s.value.min === undefined ? "" : String(s.value.min),
        max: s.value.max === undefined ? "" : String(s.value.max),
      },
    ]),
  );
}

/** "60 to 100", "at least 60", "at most 40", or "" when open on both ends. */
export function describeRange(value: RangeValue): string {
  const { min, max } = value;
  if (min !== undefined && max !== undefined) return min === max ? `${min}` : `${min} to ${max}`;
  if (min !== undefined) return `at least ${min}`;
  if (max !== undefined) return `at most ${max}`;
  return "";
}

function parseBound(
  text: string,
  bounds: { min: number; max: number },
): { value?: number; error?: string } {
  const t = text.trim();
  if (t === "") return {};
  const n = Number(t);
  if (!Number.isInteger(n) || n < bounds.min || n > bounds.max) {
    return { error: `Enter a whole number from ${bounds.min} to ${bounds.max}` };
  }
  return { value: n };
}

/**
 * Filter chip that opens a small panel of minimum and maximum inputs, one pair per section (for
 * example fit score and data confidence). Values apply together with the Apply button or Enter,
 * so typing never refetches on every keystroke. Matches FilterMenu's chip and field triggers.
 */
export function FilterRange({
  label,
  sections,
  onApply,
  bounds = { min: 0, max: 100 },
  appearance = "chip",
  disabled,
  align = "start",
  className,
}: FilterRangeProps) {
  const [open, setOpen] = React.useState(false);
  const [draft, setDraft] = React.useState<Draft>(() => toDraft(sections));
  const baseId = React.useId();
  const labelId = `${baseId}-label`;
  const summaries = sections
    .map((s) => ({ s, text: describeRange(s.value) }))
    .filter((x) => x.text)
    .map((x) => `${x.s.label} ${x.text}`);
  const active = summaries.length > 0;

  // Reset the draft from the applied values every time the panel opens.
  const onOpenChange = (next: boolean) => {
    if (next) setDraft(toDraft(sections));
    setOpen(next);
  };

  const parsed = sections.map((s) => {
    const d = draft[s.id] ?? { min: "", max: "" };
    const min = parseBound(d.min, bounds);
    const max = parseBound(d.max, bounds);
    const order =
      min.value !== undefined && max.value !== undefined && min.value > max.value
        ? "The minimum is above the maximum"
        : undefined;
    return { s, min, max, error: min.error ?? max.error ?? order };
  });
  const invalid = parsed.some((p) => p.error);

  const apply = () => {
    if (invalid) return;
    onApply(
      Object.fromEntries(parsed.map((p) => [p.s.id, { min: p.min.value, max: p.max.value }])),
    );
    setOpen(false);
  };
  const clear = () => {
    onApply(Object.fromEntries(sections.map((s) => [s.id, {}])));
    setOpen(false);
  };

  const trigger =
    appearance === "chip" ? (
      <button
        type="button"
        disabled={disabled}
        aria-label={active ? `${label}: ${summaries.join(", ")}` : label}
        className={cn(
          "transition-ui state-layer press-scale group inline-flex h-8 min-w-0 max-w-full items-center gap-1.5 whitespace-nowrap rounded-full border px-3 text-[13px] font-medium [&_svg]:size-4 [&_svg]:shrink-0",
          "disabled:cursor-not-allowed disabled:opacity-[0.38]",
          active
            ? "bg-secondary text-secondary-foreground border-transparent pl-2.5"
            : "border-border-strong text-foreground bg-transparent",
          className,
        )}
      >
        {active ? <Check aria-hidden /> : null}
        <span className="truncate">
          {label}
          {active ? <span className="font-normal">: {summaries.join(", ")}</span> : null}
        </span>
        <ChevronDown
          aria-hidden
          className="ease-emphasized transition-transform duration-200 group-data-[state=open]:rotate-180 motion-reduce:transition-none"
        />
      </button>
    ) : (
      <button
        type="button"
        disabled={disabled}
        // Name = field label + current value ("Lead score Any"), so the visible text is in the name.
        aria-labelledby={`${labelId} ${baseId}-value`}
        className={cn(
          fieldClasses,
          "group flex h-10 items-center justify-between gap-2 px-3 text-left text-sm",
        )}
      >
        <span id={`${baseId}-value`} className={cn("truncate", !active && "text-muted-foreground")}>
          {active ? summaries.join(", ") : "Any"}
        </span>
        <ChevronDown
          aria-hidden
          className="text-muted-foreground ease-emphasized size-[18px] shrink-0 transition-transform duration-200 group-data-[state=open]:rotate-180 motion-reduce:transition-none"
        />
      </button>
    );

  const panel = (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent
        align={align}
        aria-label={label}
        className={cn(
          "flex flex-col gap-4 p-4",
          appearance === "field"
            ? "w-[var(--radix-popover-trigger-width)]"
            : "w-[min(20rem,calc(100vw-24px))]",
        )}
      >
        <form
          className="flex min-w-0 flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            apply();
          }}
          noValidate
        >
          {parsed.map(({ s, min, max, error }) => {
            const d = draft[s.id] ?? { min: "", max: "" };
            const errorId = `${baseId}-${s.id}-error`;
            return (
              <fieldset key={s.id} className="flex min-w-0 flex-col gap-2">
                <legend className="text-foreground mb-2 text-sm font-medium">{s.label}</legend>
                <div className="grid min-w-0 grid-cols-2 gap-2">
                  {(["min", "max"] as const).map((end) => {
                    const id = `${baseId}-${s.id}-${end}`;
                    const bad = end === "min" ? Boolean(min.error) : Boolean(max.error);
                    return (
                      <div key={end} className="flex min-w-0 flex-col gap-1">
                        <label htmlFor={id} className="text-muted-foreground text-xs">
                          {end === "min" ? "Minimum" : "Maximum"}
                        </label>
                        <Input
                          id={id}
                          inputMode="numeric"
                          autoComplete="off"
                          placeholder={String(end === "min" ? bounds.min : bounds.max)}
                          value={d[end]}
                          invalid={bad || (Boolean(error) && !min.error && !max.error)}
                          aria-describedby={error ? errorId : undefined}
                          onChange={(e) =>
                            setDraft((prev) => ({
                              ...prev,
                              [s.id]: {
                                ...(prev[s.id] ?? { min: "", max: "" }),
                                [end]: e.target.value,
                              },
                            }))
                          }
                          className="[--field-bg:var(--surface-elevated)]"
                        />
                      </div>
                    );
                  })}
                </div>
                {error ? (
                  <p id={errorId} role="alert" className="text-destructive text-xs">
                    {error}
                  </p>
                ) : null}
              </fieldset>
            );
          })}
          <div className="flex flex-wrap items-center justify-end gap-2">
            <Button type="button" variant="text" size="sm" onClick={clear} disabled={!active}>
              Clear
            </Button>
            <Button type="submit" size="sm" disabled={invalid}>
              Apply
            </Button>
          </div>
        </form>
      </PopoverContent>
    </Popover>
  );

  if (appearance === "chip") return panel;
  return (
    <div className={cn("flex min-w-0 flex-col gap-1.5", className)}>
      <span id={labelId} className="text-foreground text-sm font-medium leading-5">
        {label}
      </span>
      {panel}
    </div>
  );
}
