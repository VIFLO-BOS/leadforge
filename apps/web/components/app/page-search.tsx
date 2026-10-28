"use client";

import { Search, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Kbd, cn } from "@leadforge/ui";
import { useWorkspace } from "./app-shell";
import { SEARCH_DESTINATIONS, visibleTo, type SearchDestination } from "./nav-config";

function matches(dest: SearchDestination, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return [dest.label, dest.group, ...dest.keywords].some((s) => s.toLowerCase().includes(q));
}

/**
 * Top-app-bar search over workspace destinations (pages and settings sections). A combobox with a
 * listbox popup: arrow keys move, Enter opens, Escape closes. Destinations that arrive in a later
 * release are listed as "Coming soon" and cannot be opened. Press "/" anywhere to focus it.
 */
export function PageSearch({ className }: { className?: string }) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const listId = useId();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);

  const { org } = useWorkspace();
  const results = useMemo(
    () => SEARCH_DESTINATIONS.filter((d) => visibleTo(org.role, d) && matches(d, query)),
    [query, org.role],
  );

  useEffect(() => {
    setActive(0);
  }, [query]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "/" || e.metaKey || e.ctrlKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName))
      ) {
        return;
      }
      e.preventDefault();
      inputRef.current?.focus();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const optionId = (i: number) => `${listId}-option-${i}`;
  const go = (dest: SearchDestination | undefined) => {
    if (!dest?.href) return;
    setOpen(false);
    setQuery("");
    inputRef.current?.blur();
    router.push(dest.href);
  };

  const activeDest = results[active];
  const showList = open;

  return (
    <div className={cn("relative min-w-0", className)}>
      <div role="search" aria-label="Pages and settings" className="relative flex items-center">
        <Search
          aria-hidden
          className="text-muted-foreground pointer-events-none absolute left-4 size-5"
        />
        <input
          ref={inputRef}
          type="text"
          role="combobox"
          aria-label="Search pages and settings"
          aria-expanded={showList}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={showList && activeDest ? optionId(active) : undefined}
          placeholder="Search pages and settings"
          autoComplete="off"
          spellCheck={false}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setOpen(false)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setOpen(true);
              setActive((a) => (results.length ? (a + 1) % results.length : 0));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setOpen(true);
              setActive((a) => (results.length ? (a - 1 + results.length) % results.length : 0));
            } else if (e.key === "Enter") {
              e.preventDefault();
              go(activeDest);
            } else if (e.key === "Tab") {
              // Leave the combobox: close the list first so Tab moves on to the next control.
              setOpen(false);
            } else if (e.key === "Escape") {
              if (query) setQuery("");
              else {
                setOpen(false);
                inputRef.current?.blur();
              }
            }
          }}
          className="bg-surface-container-high text-foreground placeholder:text-muted-foreground hover:bg-surface-container-highest focus:bg-surface focus:border-primary h-12 w-full min-w-0 rounded-full border border-transparent pl-12 pr-12 text-base outline-none focus:shadow-[inset_0_0_0_1px_var(--primary)] focus-visible:outline-none"
        />
        <span className="absolute right-3 flex items-center">
          {query ? (
            <button
              type="button"
              aria-label="Clear search"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => setQuery("")}
              className="state-layer text-muted-foreground flex size-8 items-center justify-center rounded-full"
            >
              <X aria-hidden className="size-[18px]" />
            </button>
          ) : (
            <span aria-hidden className="hidden lg:inline-flex">
              <Kbd>/</Kbd>
            </span>
          )}
        </span>
      </div>

      {showList ? (
        <div className="bg-surface-elevated shadow-2 absolute inset-x-0 top-[calc(100%+6px)] z-40 overflow-hidden rounded-lg py-2">
          {/* tabIndex -1: options are reached with the arrow keys (aria-activedescendant). Without
              it Chrome makes this scrolling list a Tab stop, and the input's blur then unmounts
              it under the focus, dropping focus to <body>. */}
          <ul
            id={listId}
            role="listbox"
            aria-label="Destinations"
            tabIndex={-1}
            className="max-h-[min(24rem,60dvh)] overflow-y-auto"
          >
            {results.length === 0 ? (
              <li role="presentation" className="text-muted-foreground px-4 py-3 text-sm">
                No pages match &ldquo;{query.trim()}&rdquo;.
              </li>
            ) : (
              results.map((dest, i) => {
                const Icon = dest.icon;
                const disabled = !dest.href;
                return (
                  <li
                    key={dest.id}
                    id={optionId(i)}
                    role="option"
                    aria-selected={i === active}
                    aria-disabled={disabled || undefined}
                    onMouseDown={(e) => e.preventDefault()}
                    onMouseMove={() => setActive(i)}
                    onClick={() => go(dest)}
                    className={cn(
                      "flex min-h-11 cursor-default items-center gap-3 px-4 py-2 text-sm",
                      // Focus state layer; a surface token is invisible on the dark popup.
                      i === active && "bg-foreground/12",
                    )}
                  >
                    <Icon
                      aria-hidden
                      className={cn(
                        "size-5 shrink-0",
                        disabled ? "text-muted-foreground opacity-60" : "text-muted-foreground",
                      )}
                    />
                    <span
                      className={cn("min-w-0 flex-1 truncate", disabled && "text-muted-foreground")}
                    >
                      {dest.label}
                    </span>
                    <span className="text-muted-foreground shrink-0 text-xs">
                      {disabled ? "Coming soon" : dest.group}
                    </span>
                  </li>
                );
              })
            )}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
