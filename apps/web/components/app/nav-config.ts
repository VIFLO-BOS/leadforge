import type { LucideIcon } from "lucide-react";
import {
  Activity,
  BarChart3,
  Building2,
  CalendarClock,
  Compass,
  CreditCard,
  Database,
  Globe,
  Home,
  Kanban,
  ListChecks,
  MessageSquare,
  Receipt,
  Settings,
  Users,
  Workflow,
} from "lucide-react";

export interface NavItem {
  label: string;
  icon: LucideIcon;
  /** Only implemented features get an href. Everything else renders disabled. */
  href?: string;
  exact?: boolean;
}

export interface NavGroup {
  title: string;
  items: NavItem[];
}

/** Navigation per docs/PRODUCT_REQUIREMENTS.md section 9. Phase 1 routes: Overview, Team, Settings. */
export const NAV_GROUPS: NavGroup[] = [
  {
    title: "Workspace",
    items: [
      { label: "Overview", icon: Home, href: "/app", exact: true },
      { label: "Businesses", icon: Building2 },
      { label: "Discovery", icon: Compass },
      { label: "Lead Lists", icon: ListChecks },
      { label: "Website Analysis", icon: Globe },
      { label: "Reports", icon: BarChart3 },
    ],
  },
  {
    title: "Sales",
    items: [
      { label: "Lead Pipeline", icon: Kanban },
      { label: "Activities", icon: Activity },
      { label: "Outreach Records", icon: MessageSquare },
    ],
  },
  {
    title: "Automation",
    items: [
      { label: "Discovery Jobs", icon: Workflow },
      { label: "Scheduled Jobs", icon: CalendarClock },
      { label: "Sources", icon: Database },
    ],
  },
  {
    title: "Account",
    items: [
      { label: "Usage and Credits", icon: Receipt },
      { label: "Billing", icon: CreditCard },
      { label: "Team Members", icon: Users, href: "/app/team" },
      { label: "Settings", icon: Settings, href: "/app/settings" },
    ],
  },
];

export function pageTitleFor(pathname: string): string {
  for (const group of NAV_GROUPS) {
    for (const item of group.items) {
      if (!item.href) continue;
      if (
        item.exact
          ? pathname === item.href
          : pathname === item.href || pathname.startsWith(`${item.href}/`)
      ) {
        return item.label;
      }
    }
  }
  return "Workspace";
}
