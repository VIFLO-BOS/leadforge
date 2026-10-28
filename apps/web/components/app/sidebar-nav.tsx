"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { motion } from "framer-motion";
import { SPRING, Tooltip, TooltipContent, TooltipTrigger, cn, useMotionSafe } from "@leadforge/ui";
import { useWorkspace } from "./app-shell";
import { isNavItemActive, navGroupsFor, type NavItem } from "./nav-config";

/**
 * Material navigation drawer (`variant="drawer"`, 256px) or navigation rail (`variant="rail"`,
 * 80px). The active destination gets a pill-shaped indicator in the secondary container.
 * Items without an href are later-phase features: they render disabled with a visible
 * "Soon" label and no link.
 */
export function SidebarNav({
  variant = "drawer",
  onNavigate,
  className,
}: {
  variant?: "drawer" | "rail";
  onNavigate?: () => void;
  className?: string;
}) {
  const pathname = usePathname();
  const { org } = useWorkspace();
  const groups = navGroupsFor(org.role);

  if (variant === "rail") {
    return (
      <nav aria-label="Dashboard" className={cn("flex min-w-0 flex-col", className)}>
        {groups.map((group, gi) => (
          <div key={group.title} className="flex flex-col">
            {gi > 0 ? <div aria-hidden className="bg-border mx-5 my-2 h-px" /> : null}
            <ul className="flex flex-col gap-1">
              {group.items.map((item) => (
                <RailItem
                  key={item.label}
                  item={item}
                  active={isNavItemActive(item, pathname)}
                  onNavigate={onNavigate}
                />
              ))}
            </ul>
          </div>
        ))}
      </nav>
    );
  }

  return (
    <nav aria-label="Dashboard" className={cn("flex min-w-0 flex-col gap-4", className)}>
      {groups.map((group) => (
        <div key={group.title} className="flex min-w-0 flex-col">
          <p className="text-muted-foreground px-4 pb-1.5 pt-1 text-xs font-medium">
            {group.title}
          </p>
          <ul className="flex min-w-0 flex-col gap-0.5">
            {group.items.map((item) => (
              <DrawerItem
                key={item.label}
                item={item}
                active={isNavItemActive(item, pathname)}
                onNavigate={onNavigate}
              />
            ))}
          </ul>
        </div>
      ))}
    </nav>
  );
}

function DrawerItem({
  item,
  active,
  onNavigate,
}: {
  item: NavItem;
  active: boolean;
  onNavigate?: () => void;
}) {
  const Icon = item.icon;
  const motionSafe = useMotionSafe();
  const base =
    "transition-ui flex h-10 w-full min-w-0 items-center gap-3 rounded-full px-4 text-sm font-medium [&_svg]:size-5 [&_svg]:shrink-0";

  if (!item.href) {
    return (
      <li aria-disabled="true" className={cn(base, "text-muted-foreground cursor-not-allowed")}>
        <Icon aria-hidden className="opacity-60" />
        <span className="min-w-0 flex-1 truncate opacity-80">{item.label}</span>
        <span className="border-border-strong text-muted-foreground shrink-0 rounded-full border px-1.5 py-px text-[10px] font-medium leading-4">
          Soon
        </span>
        <span className="sr-only">(coming soon)</span>
      </li>
    );
  }

  return (
    <li className="min-w-0">
      <Link
        href={item.href}
        onClick={onNavigate}
        aria-current={active ? "page" : undefined}
        className={cn(
          base,
          "state-layer",
          active ? "text-secondary-foreground" : "text-foreground",
          active && !motionSafe && "bg-secondary",
        )}
      >
        {active && motionSafe ? (
          // The active pill slides between destinations on navigation.
          <motion.span
            layoutId="nav-drawer-active"
            aria-hidden
            transition={SPRING.slow}
            style={{ borderRadius: 9999 }}
            className="bg-secondary absolute inset-0 -z-[2]"
          />
        ) : null}
        <Icon aria-hidden />
        <span className="truncate">{item.label}</span>
      </Link>
    </li>
  );
}

function RailItem({
  item,
  active,
  onNavigate,
}: {
  item: NavItem;
  active: boolean;
  onNavigate?: () => void;
}) {
  const Icon = item.icon;
  const motionSafe = useMotionSafe();
  const label = item.railLabel ?? item.label.split(" ")[0] ?? item.label;
  const indicator = (
    <span
      className={cn(
        "transition-ui relative isolate flex h-8 w-14 items-center justify-center rounded-full [&_svg]:size-5",
        active && "text-secondary-foreground",
        active && !motionSafe && "bg-secondary",
      )}
    >
      {active && motionSafe ? (
        <motion.span
          layoutId="nav-rail-active"
          aria-hidden
          transition={SPRING.slow}
          style={{ borderRadius: 9999 }}
          className="bg-secondary absolute inset-0 -z-[1]"
        />
      ) : null}
      <Icon aria-hidden />
    </span>
  );
  const text = (
    <span className="max-w-full truncate px-1 text-[11px] font-medium leading-4">{label}</span>
  );

  if (!item.href) {
    return (
      <li>
        <Tooltip>
          <TooltipTrigger asChild>
            <span
              tabIndex={0}
              aria-disabled="true"
              className="text-muted-foreground flex cursor-not-allowed flex-col items-center gap-1 rounded-md py-1 opacity-60"
            >
              {indicator}
              {text}
              <span className="sr-only">{item.label} (coming soon)</span>
            </span>
          </TooltipTrigger>
          <TooltipContent side="right">{item.label}: coming soon</TooltipContent>
        </Tooltip>
      </li>
    );
  }

  return (
    <li>
      <Tooltip>
        <TooltipTrigger asChild>
          <Link
            href={item.href}
            onClick={onNavigate}
            aria-current={active ? "page" : undefined}
            // The name must contain the short rail text (label in name, WCAG 2.5.3).
            aria-label={
              item.label.toLowerCase().includes(label.toLowerCase())
                ? item.label
                : `${label} (${item.label})`
            }
            className={cn(
              "group/rail transition-ui flex flex-col items-center gap-1 rounded-md py-1",
              active ? "text-foreground" : "text-muted-foreground hover:text-foreground",
            )}
          >
            <span className="state-layer rounded-full">{indicator}</span>
            {text}
          </Link>
        </TooltipTrigger>
        <TooltipContent side="right">{item.label}</TooltipContent>
      </Tooltip>
    </li>
  );
}
