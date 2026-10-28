"use client";

import * as React from "react";
import { ChevronRight, MoreHorizontal } from "lucide-react";
import { cn } from "../lib/cn";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "./dropdown-menu";

export interface BreadcrumbItem {
  label: string;
  href?: string;
}

export interface BreadcrumbsProps extends React.HTMLAttributes<HTMLElement> {
  items: BreadcrumbItem[];
  /** Render links with the host router's Link component. Defaults to a plain anchor. */
  renderLink?: (item: BreadcrumbItem, className: string) => React.ReactNode;
}

const linkClass =
  "truncate rounded-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline";

/** Full trail from 480px; below that the middle items collapse into a menu. */
export function Breadcrumbs({ items, renderLink, className, ...props }: BreadcrumbsProps) {
  const render = (item: BreadcrumbItem) =>
    item.href ? (
      (renderLink?.(item, linkClass) ?? (
        <a href={item.href} className={linkClass}>
          {item.label}
        </a>
      ))
    ) : (
      <span aria-current="page" className="text-foreground truncate">
        {item.label}
      </span>
    );

  const sep = <ChevronRight aria-hidden className="text-muted-foreground size-3.5 shrink-0" />;
  const collapsible = items.length > 2;
  const first = items[0];
  const last = items[items.length - 1];
  const middle = items.slice(1, -1);

  return (
    <nav aria-label="Breadcrumb" className={cn("min-w-0 text-sm", className)} {...props}>
      <ol className="hidden min-w-0 items-center gap-1.5 min-[480px]:flex">
        {items.map((item, i) => (
          <li key={`${item.label}-${i}`} className="flex min-w-0 items-center gap-1.5">
            {i > 0 ? sep : null}
            {render(item)}
          </li>
        ))}
      </ol>
      <ol className="flex min-w-0 items-center gap-1.5 min-[480px]:hidden">
        {collapsible && first && last ? (
          <>
            <li className="flex min-w-0 items-center">{render(first)}</li>
            <li className="flex items-center gap-1.5">
              {sep}
              <DropdownMenu>
                <DropdownMenuTrigger
                  aria-label="Show hidden breadcrumb items"
                  className="state-layer text-muted-foreground flex size-8 items-center justify-center rounded-full"
                >
                  <MoreHorizontal aria-hidden className="size-4" />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start">
                  {middle.map((item, i) => (
                    <DropdownMenuItem key={`${item.label}-${i}`} asChild={Boolean(item.href)}>
                      {item.href
                        ? (renderLink?.(item, "w-full") ?? <a href={item.href}>{item.label}</a>)
                        : item.label}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            </li>
            <li className="flex min-w-0 items-center gap-1.5">
              {sep}
              {render(last)}
            </li>
          </>
        ) : (
          items.map((item, i) => (
            <li key={`${item.label}-${i}`} className="flex min-w-0 items-center gap-1.5">
              {i > 0 ? sep : null}
              {render(item)}
            </li>
          ))
        )}
      </ol>
    </nav>
  );
}
