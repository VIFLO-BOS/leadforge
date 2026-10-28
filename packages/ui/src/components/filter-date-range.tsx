"use client";

import * as React from "react";
import { Check, ChevronDown } from "lucide-react";
import { cn } from "../lib/cn";
import { Button } from "./button";
import { fieldClasses, Input } from "./input";
import { Popover, PopoverContent, PopoverTrigger } from "./popover";

/** Inclusive day range as yyyy-mm-dd strings (local days); either end may be open. */
export interface DayRange {
  from?: string;
  to?: string;
}

export interface FilterDateRangeProps {
  /** Filter name on the trigger, for example "Date" or "Last attempt". */
  label: string;
  value: DayRange;
  onApply: (value: DayRange) => void;
  /** Text for the applied range on the trigger ("12 Oct to 20 Oct"); defaults to the raw days. */
  describe?: (value: DayRange) => string;
  /** chip for inline toolbars, field for filter sheets (same contract as FilterMenu). */
  appearance?: "chip" | "field";
  disabled?: boolean;
  align?: "start" | "end";
  className?: string;
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;

function defaultDescribe({ from, to }: DayRange): string {
  if (from && to) return from === to ? from : `${from} to ${to}`;
  if (from) return `from ${from}`;
  if (to) return `until ${to}`;
  return "";
}

/**
 * Filter chip that opens a panel with From and To date inputs (native date pickers, so keyboard
 * and screen-reader support come from the browser). Applies together with Apply or Enter; a From
 * after To is an inline error. Matches FilterMenu and FilterRange triggers.
 */
export function FilterDateRange({
  label,
  value,
  onApply,
  describe = defaultDescribe,
  appearance = "chip",
  disabled,
  align = "start",
  className,
}: FilterDateRangeProps) {
  const [open, setOpen] = React.useState(false);
  const [draft, setDraft] = React.useState({ from: value.from ?? "", to: value.to ?? "" });
  const baseId = React.useId();
  const labelId = `${baseId}-label`;
  const errorId = `${baseId}-error`;
  const summary = describe(value);
  const active = Boolean(value.from || value.to);

  const onOpenChange = (next: boolean) => {
    if (next) setDraft({ from: value.from ?? "", to: value.to ?? "" });
    setOpen(next);
  };

  const badFrom = draft.from !== "" && !DAY.test(draft.from);
  const badTo = draft.to !== "" && !DAY.test(draft.to);
  const order = !badFrom && !badTo && draft.from && draft.to && draft.from > draft.to;
  const error =
    badFrom || badTo
      ? "Enter a complete date"
      : order
        ? "The start date is after the end date"
        : undefined;

  const apply = () => {
    if (error) return;
    onApply({ from: draft.from || undefined, to: draft.to || undefined });
    setOpen(false);
  };
  const clear = () => {
    onApply({});
    setOpen(false);
  };

  const trigger =
    appearance === "chip" ? (
      <button
        type="button"
        disabled={disabled}
        aria-label={active ? `${label}: ${summary}` : label}
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
          {active ? <span className="font-normal">: {summary}</span> : null}
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
        aria-labelledby={`${labelId} ${baseId}-value`}
        className={cn(
          fieldClasses,
          "group flex h-10 items-center justify-between gap-2 px-3 text-left text-sm",
        )}
      >
        <span id={`${baseId}-value`} className={cn("truncate", !active && "text-muted-foreground")}>
          {active ? summary : "Any time"}
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
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            apply();
          }}
        >
          <fieldset className="flex min-w-0 flex-col gap-2">
            <legend className="text-foreground mb-2 text-sm font-medium">{label}</legend>
            <div className="grid min-w-0 grid-cols-1 gap-2 min-[360px]:grid-cols-2">
              {(["from", "to"] as const).map((end) => {
                const id = `${baseId}-${end}`;
                return (
                  <div key={end} className="flex min-w-0 flex-col gap-1">
                    <label htmlFor={id} className="text-muted-foreground text-xs">
                      {end === "from" ? "From" : "To"}
                    </label>
                    <Input
                      id={id}
                      type="date"
                      value={draft[end]}
                      invalid={Boolean(error)}
                      aria-describedby={error ? errorId : undefined}
                      onChange={(e) => setDraft((d) => ({ ...d, [end]: e.target.value }))}
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
          <div className="flex flex-wrap items-center justify-end gap-2">
            <Button type="button" variant="text" size="sm" onClick={clear} disabled={!active}>
              Clear
            </Button>
            <Button type="submit" size="sm" disabled={Boolean(error)}>
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
