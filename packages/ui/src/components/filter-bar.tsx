"use client";

import * as React from "react";
import { ListFilter } from "lucide-react";
import { cn } from "../lib/cn";
import { MEDIA, useMediaQuery } from "../hooks/use-media-query";
import { Button } from "./button";
import { Chip } from "./chip";
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "./sheet";

export interface ActiveFilter {
  id: string;
  /** Chip text including the field, for example "Industry: Bakery". */
  label: string;
  onRemove: () => void;
}

export interface FilterBarProps extends Omit<React.HTMLAttributes<HTMLDivElement>, "children"> {
  /** Currently applied filters, rendered as removable input chips. */
  filters: ActiveFilter[];
  onClearAll?: () => void;
  /** Filter controls (Selects, Comboboxes, filter Chips). Inline from 768px, in a sheet below. */
  children: React.ReactNode;
  /** Always-visible leading control, usually a SearchField. */
  search?: React.ReactNode;
  sheetTitle?: string;
  sheetDescription?: string;
  /** Called by the sheet's primary button. Defaults to closing the sheet. */
  onApply?: () => void;
  applyLabel?: string;
}

/**
 * Filter toolbar. From 768px the controls sit inline with a chip row of applied filters; under
 * 768px they collapse into a "Filters (n)" button that opens a full-height sheet.
 */
export function FilterBar({
  filters,
  onClearAll,
  children,
  search,
  sheetTitle = "Filters",
  sheetDescription,
  onApply,
  applyLabel = "Show results",
  className,
  ...props
}: FilterBarProps) {
  const compact = useMediaQuery(MEDIA.belowMd);
  const [open, setOpen] = React.useState(false);
  const count = filters.length;

  const chips =
    count > 0 ? (
      <div
        className="flex min-w-0 flex-wrap items-center gap-2"
        aria-label="Applied filters"
        role="group"
      >
        {filters.map((f) => (
          <Chip
            key={f.id}
            variant="input"
            onRemove={f.onRemove}
            removeLabel={`Remove filter ${f.label}`}
          >
            {f.label}
          </Chip>
        ))}
        {onClearAll ? (
          <Button variant="text" size="sm" onClick={onClearAll}>
            Clear all
          </Button>
        ) : null}
      </div>
    ) : null;

  if (compact) {
    return (
      <div className={cn("flex min-w-0 flex-col gap-2", className)} {...props}>
        <div className="flex min-w-0 flex-col gap-2 min-[360px]:flex-row min-[360px]:items-center">
          {search ? <div className="min-w-0 flex-1">{search}</div> : null}
          <Sheet open={open} onOpenChange={setOpen}>
            <SheetTrigger asChild>
              <Button
                variant="outline"
                className={cn(
                  "w-full shrink-0 min-[360px]:w-auto",
                  !search && "min-[360px]:w-full",
                )}
              >
                <ListFilter aria-hidden />
                {count > 0 ? `Filters (${count})` : "Filters"}
              </Button>
            </SheetTrigger>
            <SheetContent side="right">
              <SheetHeader>
                <SheetTitle className="text-xl font-normal leading-7">{sheetTitle}</SheetTitle>
                {sheetDescription ? (
                  <SheetDescription className="text-muted-foreground text-sm">
                    {sheetDescription}
                  </SheetDescription>
                ) : (
                  <SheetDescription className="sr-only">
                    Choose filters for the list. Changes apply immediately.
                  </SheetDescription>
                )}
              </SheetHeader>
              <SheetBody className="flex flex-col gap-5">
                {chips}
                <div className="flex min-w-0 flex-col gap-4 [&>*]:w-full">{children}</div>
              </SheetBody>
              <SheetFooter>
                <Button
                  className="w-full min-[360px]:w-auto"
                  onClick={() => {
                    onApply?.();
                    setOpen(false);
                  }}
                >
                  {applyLabel}
                </Button>
              </SheetFooter>
            </SheetContent>
          </Sheet>
        </div>
      </div>
    );
  }

  return (
    <div className={cn("flex min-w-0 flex-col gap-3", className)} {...props}>
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        {/* A real basis keeps the search usable; the chips wrap to the next line instead. */}
        {search ? <div className="min-w-0 max-w-sm flex-[1_1_18rem]">{search}</div> : null}
        <div className="flex min-w-0 flex-wrap items-center gap-2">{children}</div>
      </div>
      {chips}
    </div>
  );
}
