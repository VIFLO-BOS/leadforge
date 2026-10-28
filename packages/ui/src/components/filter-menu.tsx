"use client";

import * as React from "react";
import { Check, ChevronDown, X } from "lucide-react";
import { cn } from "../lib/cn";
import { fieldClasses } from "./input";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "./dropdown-menu";

export interface FilterMenuOption {
  value: string;
  label: string;
  /** Matching records, from the server (facets). Shown right-aligned; never estimated. */
  count?: number;
  disabled?: boolean;
}

export interface FilterMenuSection {
  id: string;
  /** Section heading inside the menu (needed when a menu has several sections). */
  label?: string;
  /** multiple: checkbox items, the menu stays open. single: radio items with an "Any" choice. */
  type: "multiple" | "single";
  options: FilterMenuOption[];
  value: string[];
  onValueChange: (value: string[]) => void;
  /** Label of the radio that clears a single-choice section. */
  anyLabel?: string;
}

export interface FilterMenuProps {
  /** Filter name, for example "Category". */
  label: string;
  sections: FilterMenuSection[];
  /** Trigger text after the label while active. Defaults to the selected labels ("Bakery +1"). */
  summary?: string;
  /**
   * chip: a pill filter chip for inline toolbars (Material filter chip with a menu).
   * field: a full-width outlined trigger with a visible label, for filter sheets.
   */
  appearance?: "chip" | "field";
  emptyMessage?: string;
  loading?: boolean;
  disabled?: boolean;
  align?: "start" | "end";
  className?: string;
}

const ANY = "__any";

function selectedLabels(sections: FilterMenuSection[]): string[] {
  return sections.flatMap((s) =>
    s.value.map((v) => s.options.find((o) => o.value === v)?.label ?? v),
  );
}

function defaultSummary(labels: string[]): string {
  if (labels.length === 0) return "";
  const [first] = labels;
  return labels.length === 1 ? (first ?? "") : `${first} +${labels.length - 1}`;
}

/**
 * Filter chip that opens a menu of options (Material 3 filter chip with a dropdown menu). The
 * chip turns tonal with a check while any option is applied, and shows what is applied. Options
 * carry server-side counts. Keyboard: Radix menu model (arrows, Home, End, typeahead, Escape).
 */
export function FilterMenu({
  label,
  sections,
  summary,
  appearance = "chip",
  emptyMessage = "No options yet",
  loading,
  disabled,
  align = "start",
  className,
}: FilterMenuProps) {
  const labelId = React.useId();
  const labels = selectedLabels(sections);
  const active = labels.length > 0;
  const text = summary ?? defaultSummary(labels);
  // The chip's visible text is its name (label in name, WCAG 2.5.3); when the summary shortens the
  // applied options ("Lagos +2"), the full list is the description.
  const fullList = labels.join(", ");
  const describeApplied = active && fullList !== text;
  const clearAll = () => sections.forEach((s) => s.value.length && s.onValueChange([]));

  const trigger =
    appearance === "chip" ? (
      <button
        type="button"
        disabled={disabled}
        aria-describedby={describeApplied ? `${labelId}-applied` : undefined}
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
          {active && text ? <span className="font-normal">: {text}</span> : null}
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
        // Name = field label + current value ("Region Lagos"), so the visible text is in the name.
        aria-labelledby={`${labelId} ${labelId}-value`}
        className={cn(
          fieldClasses,
          "group flex h-10 items-center justify-between gap-2 px-3 text-left text-sm",
        )}
      >
        <span
          id={`${labelId}-value`}
          className={cn("truncate", !active && "text-muted-foreground")}
        >
          {active ? labels.join(", ") : "Any"}
        </span>
        <ChevronDown
          aria-hidden
          className="text-muted-foreground ease-emphasized size-[18px] shrink-0 transition-transform duration-200 group-data-[state=open]:rotate-180 motion-reduce:transition-none"
        />
      </button>
    );

  const menu = (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>{trigger}</DropdownMenuTrigger>
      <DropdownMenuContent
        align={align}
        aria-label={label}
        className={cn(
          "max-h-[min(24rem,var(--radix-dropdown-menu-content-available-height))] overflow-y-auto",
          appearance === "field"
            ? "w-[var(--radix-dropdown-menu-trigger-width)]"
            : "w-[min(18rem,calc(100vw-24px))]",
        )}
      >
        {sections.map((section, i) => (
          <React.Fragment key={section.id}>
            {i > 0 ? <DropdownMenuSeparator /> : null}
            {section.label ? <DropdownMenuLabel>{section.label}</DropdownMenuLabel> : null}
            {loading ? (
              <DropdownMenuItem disabled>Loading</DropdownMenuItem>
            ) : section.options.length === 0 ? (
              <DropdownMenuItem disabled>{emptyMessage}</DropdownMenuItem>
            ) : section.type === "multiple" ? (
              section.options.map((option) => {
                const checked = section.value.includes(option.value);
                return (
                  <DropdownMenuCheckboxItem
                    key={option.value}
                    checked={checked}
                    disabled={option.disabled}
                    onSelect={(e) => e.preventDefault()}
                    onCheckedChange={(next) =>
                      section.onValueChange(
                        next
                          ? [...section.value, option.value]
                          : section.value.filter((v) => v !== option.value),
                      )
                    }
                  >
                    <OptionText option={option} />
                  </DropdownMenuCheckboxItem>
                );
              })
            ) : (
              <DropdownMenuRadioGroup
                value={section.value[0] ?? ANY}
                onValueChange={(v) => section.onValueChange(v === ANY ? [] : [v])}
              >
                <DropdownMenuRadioItem value={ANY}>
                  {section.anyLabel ?? "Any"}
                </DropdownMenuRadioItem>
                {section.options.map((option) => (
                  <DropdownMenuRadioItem
                    key={option.value}
                    value={option.value}
                    disabled={option.disabled}
                  >
                    <OptionText option={option} />
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            )}
          </React.Fragment>
        ))}
        {active ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={clearAll}>
              <X aria-hidden />
              Clear {label.toLowerCase()}
            </DropdownMenuItem>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );

  if (appearance === "chip") {
    if (!describeApplied) return menu;
    return (
      <>
        {menu}
        <span id={`${labelId}-applied`} className="sr-only">
          Applied: {fullList}
        </span>
      </>
    );
  }
  return (
    <div className={cn("flex min-w-0 flex-col gap-1.5", className)}>
      <span id={labelId} className="text-foreground text-sm font-medium leading-5">
        {label}
      </span>
      {menu}
    </div>
  );
}

function OptionText({ option }: { option: FilterMenuOption }) {
  return (
    <span className="flex min-w-0 flex-1 items-center gap-3">
      <span className="break-anywhere min-w-0 flex-1">{option.label}</span>
      {typeof option.count === "number" ? (
        <span className="text-muted-foreground shrink-0 text-xs tabular-nums">
          {option.count.toLocaleString()}
        </span>
      ) : null}
    </span>
  );
}
