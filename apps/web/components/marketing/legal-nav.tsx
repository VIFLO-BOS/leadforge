"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@leadforge/ui";

const LEGAL_LINKS = [
  { href: "/legal/privacy", label: "Privacy" },
  { href: "/legal/terms", label: "Terms" },
  { href: "/legal/acceptable-use", label: "Acceptable use" },
  { href: "/legal/data-collection", label: "Data collection" },
  { href: "/legal/data-sources", label: "Data sources" },
];

/** Chip scroller under 1024px; a vertical list with a pill active indicator from 1024px. */
export function LegalNav() {
  const pathname = usePathname();
  return (
    <nav aria-label="Legal documents">
      <p className="text-muted-foreground mb-3 hidden px-4 text-[13px] font-medium lg:block">
        Legal
      </p>
      <ul className="scrollbar-none -mx-1 flex gap-2 overflow-x-auto px-1 pb-1 lg:mx-0 lg:flex-col lg:gap-1 lg:overflow-visible lg:px-0">
        {LEGAL_LINKS.map((l) => {
          const active = pathname === l.href;
          return (
            <li key={l.href} className="shrink-0">
              <Link
                href={l.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "state-layer transition-ui inline-flex h-10 items-center whitespace-nowrap rounded-full px-4 text-sm font-medium lg:flex lg:w-full",
                  active
                    ? "bg-secondary text-secondary-foreground"
                    : "text-muted-foreground hover:text-foreground border-border-strong border lg:border-transparent",
                )}
              >
                {l.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
