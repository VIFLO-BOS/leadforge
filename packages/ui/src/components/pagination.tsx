"use client";

import * as React from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "../lib/cn";
import { Button } from "./button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./select";

export interface PaginationProps extends React.HTMLAttributes<HTMLElement> {
  hasPrevious: boolean;
  hasNext: boolean;
  onPrevious: () => void;
  onNext: () => void;
  pageSize: number;
  pageSizeOptions?: number[];
  onPageSizeChange?: (size: number) => void;
  /** Rows on the current page. */
  pageCount?: number;
  /** Only when the server reports an exact count. Never estimated. */
  totalCount?: number | null;
  /** Disables controls while the next page loads. */
  loading?: boolean;
  /** Noun for the summary, for example "businesses". */
  itemLabel?: string;
}

/**
 * Cursor pagination: Previous and Next plus page size. Shows counts only when they are known.
 * Stacks vertically under 480px.
 */
export function Pagination({
  hasPrevious,
  hasNext,
  onPrevious,
  onNext,
  pageSize,
  pageSizeOptions = [25, 50, 100],
  onPageSizeChange,
  pageCount,
  totalCount,
  loading,
  itemLabel = "rows",
  className,
  ...props
}: PaginationProps) {
  const sizeId = React.useId();
  const summary =
    typeof totalCount === "number"
      ? `${totalCount.toLocaleString()} ${itemLabel} in total`
      : typeof pageCount === "number"
        ? `${pageCount.toLocaleString()} ${itemLabel} on this page`
        : null;

  return (
    <nav
      aria-label="Pagination"
      className={cn(
        "flex min-w-0 flex-col gap-3 min-[480px]:flex-row min-[480px]:items-center min-[480px]:justify-between",
        className,
      )}
      {...props}
    >
      <div className="text-muted-foreground flex min-w-0 flex-wrap items-center gap-x-4 gap-y-2 text-[13px]">
        {onPageSizeChange ? (
          <div className="flex items-center gap-2">
            <label htmlFor={sizeId}>Rows per page</label>
            <Select
              value={String(pageSize)}
              onValueChange={(v) => onPageSizeChange(Number(v))}
              disabled={loading}
            >
              <SelectTrigger id={sizeId} size="sm" className="w-20">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {pageSizeOptions.map((n) => (
                  <SelectItem key={n} value={String(n)}>
                    {n}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        ) : null}
        {summary ? (
          <span aria-live="polite" className="tabular-nums">
            {summary}
          </span>
        ) : null}
      </div>
      <div className="flex flex-wrap items-center gap-2 [&>*]:flex-1 min-[480px]:[&>*]:flex-none">
        <Button variant="outline" size="sm" onClick={onPrevious} disabled={!hasPrevious || loading}>
          <ChevronLeft aria-hidden />
          Previous
        </Button>
        <Button variant="outline" size="sm" onClick={onNext} disabled={!hasNext || loading}>
          Next
          <ChevronRight aria-hidden />
        </Button>
      </div>
    </nav>
  );
}
