"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Badge, Tooltip, TooltipContent, TooltipTrigger, cn } from "@leadforge/ui";
import { LogoMark } from "@/components/marketing/logo";
import { SITE_NAME } from "@/lib/site";
import { NAV_GROUPS, type NavItem } from "./nav-config";

export function SidebarNav({
  collapsed = false,
  onNavigate,
}: {
  collapsed?: boolean;
  onNavigate?: () => void;
}) {
  const pathname = usePathname();

  const isActive = (item: NavItem) =>
    Boolean(item.href) &&
    (item.exact
      ? pathname === item.href
      : pathname === item.href || pathname.startsWith(`${item.href}/`));

  return (
    <nav aria-label="Dashboard" className="flex h-full min-w-0 flex-col">
      <div
        className={cn(
          "border-border flex h-[var(--topbar-h)] shrink-0 items-center gap-2 border-b px-3",
          collapsed && "justify-center px-0",
        )}
      >
        <Link
          href="/app"
          className="flex min-w-0 items-center gap-2 rounded-md"
          aria-label={`${SITE_NAME} overview`}
        >
          <LogoMark />
          {!collapsed ? <span className="truncate text-sm font-semibold">{SITE_NAME}</span> : null}
        </Link>
      </div>

      <div className="scrollbar-thin flex-1 overflow-y-auto px-2 py-3">
        {NAV_GROUPS.map((group) => (
          <div key={group.title} className="mb-4">
            {!collapsed ? (
              <p className="text-muted-foreground px-2 pb-1 text-[11px] font-semibold uppercase tracking-wider">
                {group.title}
              </p>
            ) : (
              <div aria-hidden className="bg-border mx-2 mb-2 h-px" />
            )}
            <ul className="flex flex-col gap-0.5">
              {group.items.map((item) => {
                const Icon = item.icon;
                const active = isActive(item);
                const base =
                  "flex min-h-10 w-full min-w-0 items-center gap-2.5 rounded-md px-2 text-sm";

                if (!item.href) {
                  const row = (
                    <li
                      key={item.label}
                      aria-disabled="true"
                      className={cn(
                        base,
                        "text-muted-foreground/70 cursor-not-allowed",
                        collapsed && "justify-center px-0",
                      )}
                    >
                      <Icon aria-hidden className="size-4 shrink-0" />
                      {!collapsed ? (
                        <>
                          <span className="flex-1 truncate">{item.label}</span>
                          <Badge variant="outline" className="shrink-0 text-[10px]">
                            Coming soon
                          </Badge>
                        </>
                      ) : (
                        <span className="sr-only">{item.label} (coming soon)</span>
                      )}
                    </li>
                  );
                  return collapsed ? (
                    <Tooltip key={item.label}>
                      <TooltipTrigger asChild>{row}</TooltipTrigger>
                      <TooltipContent side="right">{item.label}: coming soon</TooltipContent>
                    </Tooltip>
                  ) : (
                    row
                  );
                }

                const link = (
                  <li key={item.label}>
                    <Link
                      href={item.href}
                      onClick={onNavigate}
                      aria-current={active ? "page" : undefined}
                      className={cn(
                        base,
                        "text-muted-foreground hover:bg-muted hover:text-foreground transition-colors",
                        active && "bg-primary-subtle text-foreground font-medium",
                        collapsed && "justify-center px-0",
                      )}
                    >
                      <Icon
                        aria-hidden
                        className={cn("size-4 shrink-0", active && "text-primary")}
                      />
                      {!collapsed ? (
                        <span className="truncate">{item.label}</span>
                      ) : (
                        <span className="sr-only">{item.label}</span>
                      )}
                    </Link>
                  </li>
                );
                return collapsed ? (
                  <Tooltip key={item.label}>
                    <TooltipTrigger asChild>{link}</TooltipTrigger>
                    <TooltipContent side="right">{item.label}</TooltipContent>
                  </Tooltip>
                ) : (
                  link
                );
              })}
            </ul>
          </div>
        ))}
      </div>
    </nav>
  );
}
