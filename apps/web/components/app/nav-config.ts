import { roleHasPermission, type OrganizationRole, type Permission } from "@leadforge/contracts";
import type { LucideIcon } from "lucide-react";
import {
  Activity,
  BarChart3,
  Coins,
  Columns3,
  Building2,
  CalendarClock,
  Compass,
  CopyCheck,
  CreditCard,
  Database,
  Gauge,
  Globe,
  House,
  KeyRound,
  Kanban,
  ListChecks,
  MessageSquare,
  Receipt,
  Settings,
  Shield,
  Bell,
  Upload,
  Users,
  Workflow,
} from "lucide-react";

export interface NavItem {
  label: string;
  icon: LucideIcon;
  /** Only implemented features get an href. Everything else renders disabled with "Coming soon". */
  href?: string;
  exact?: boolean;
  /** Short label for the navigation rail (defaults to the first word of `label`). */
  railLabel?: string;
  /** Extra words the page search matches on. */
  keywords?: string[];
  /** Hidden from roles without this permission (the page itself also explains, and the API decides). */
  permission?: Permission;
}

export interface NavGroup {
  title: string;
  items: NavItem[];
}

/**
 * Navigation per docs/PRODUCT_REQUIREMENTS.md section 9. Phase 1 routes: Overview, Team, Settings.
 * Phase 2 routes: Businesses (directory, detail, CSV import) and Sources.
 * Phase 3 routes: Discovery (jobs, wizard, detail), Discovery Jobs (all background jobs at
 * /app/jobs) and Usage and Credits. Scheduled Jobs stays disabled with no route.
 * Phase 4 routes: Website Analysis (/app/analysis) and Duplicate Review
 * (/app/businesses/duplicates, nested under Businesses, so the most specific match wins).
 * Phase 5 routes: Lead Lists, Reports, Lead Pipeline, Activities and Outreach Records. Bulk
 * operation and export pages live under /app/jobs (Discovery Jobs).
 * Phase 6 routes: Billing (/app/billing and the Paystack return page), for owners and
 * administrators only (hidden from other roles). Scheduled Jobs stays disabled.
 * Later phases enable an item by giving it an href; nothing else needs to change.
 */
export const NAV_GROUPS: NavGroup[] = [
  {
    title: "Workspace",
    items: [
      {
        label: "Overview",
        icon: House,
        href: "/app",
        exact: true,
        keywords: ["home", "dashboard"],
      },
      {
        label: "Businesses",
        icon: Building2,
        href: "/app/businesses",
        keywords: ["directory", "companies", "records", "export"],
      },
      {
        label: "Duplicate Review",
        icon: CopyCheck,
        href: "/app/businesses/duplicates",
        railLabel: "Duplicates",
        keywords: ["duplicates", "merge", "dedup", "undo"],
      },
      {
        label: "Discovery",
        icon: Compass,
        href: "/app/discovery",
        keywords: ["find", "search", "discover", "places"],
      },
      {
        label: "Lead Lists",
        icon: ListChecks,
        href: "/app/lists",
        railLabel: "Lists",
        keywords: ["lists", "groups", "segments", "export list"],
      },
      {
        label: "Website Analysis",
        icon: Globe,
        href: "/app/analysis",
        railLabel: "Analysis",
        keywords: ["website", "opportunities", "detections", "evidence"],
      },
      {
        label: "Reports",
        icon: BarChart3,
        href: "/app/reports",
        keywords: ["charts", "analytics", "funnel", "quality", "sources", "trends"],
      },
    ],
  },
  {
    title: "Sales",
    items: [
      {
        label: "Lead Pipeline",
        icon: Kanban,
        href: "/app/pipeline",
        railLabel: "Pipeline",
        keywords: ["board", "stages", "deals", "leads", "assign"],
      },
      {
        label: "Activities",
        icon: Activity,
        href: "/app/activities",
        keywords: ["notes", "calls", "whatsapp", "emails", "meetings", "log"],
      },
      {
        label: "Outreach Records",
        icon: MessageSquare,
        href: "/app/outreach",
        railLabel: "Outreach",
        keywords: ["attempts", "contact", "follow up", "channels"],
      },
    ],
  },
  {
    title: "Automation",
    items: [
      {
        label: "Discovery Jobs",
        icon: Workflow,
        href: "/app/jobs",
        railLabel: "Jobs",
        keywords: ["background", "imports", "progress", "queue"],
      },
      { label: "Scheduled Jobs", icon: CalendarClock, railLabel: "Scheduled" },
      {
        label: "Sources",
        icon: Database,
        href: "/app/sources",
        keywords: ["registry", "retention", "attribution", "policy"],
      },
    ],
  },
  {
    title: "Account",
    items: [
      {
        label: "Usage and Credits",
        icon: Receipt,
        href: "/app/usage",
        railLabel: "Usage",
        keywords: ["credits", "balance", "ledger", "holds"],
      },
      {
        label: "Billing",
        icon: CreditCard,
        href: "/app/billing",
        keywords: [
          "plan",
          "subscription",
          "payments",
          "invoices",
          "buy credits",
          "paystack",
          "refund",
        ],
        permission: "billing:manage",
      },
      {
        label: "Team Members",
        icon: Users,
        href: "/app/team",
        railLabel: "Team",
        keywords: ["members", "invite", "roles"],
      },
      { label: "Settings", icon: Settings, href: "/app/settings", keywords: ["preferences"] },
    ],
  },
];

export interface SearchDestination {
  id: string;
  label: string;
  group: string;
  icon: LucideIcon;
  href?: string;
  keywords: string[];
  permission?: Permission;
}

/** Task destinations inside implemented pages, reachable from the page search. */
const TASK_DESTINATIONS: SearchDestination[] = [
  {
    id: "task-import-csv",
    label: "Import businesses from CSV",
    group: "Businesses",
    icon: Upload,
    href: "/app/businesses/import",
    keywords: ["upload", "spreadsheet", "csv", "import"],
  },
  {
    id: "task-create-discovery",
    label: "Create a discovery job",
    group: "Discovery",
    icon: Compass,
    href: "/app/discovery/new",
    keywords: ["new", "find", "search", "wizard", "estimate"],
  },
  {
    id: "task-add-business",
    label: "Add a business",
    group: "Businesses",
    icon: Building2,
    href: "/app/businesses?add=1",
    keywords: ["create", "new", "manual"],
  },
  {
    id: "task-buy-credits",
    label: "Buy credits",
    group: "Billing",
    icon: Coins,
    href: "/app/billing?tab=plans#credit-packs",
    keywords: ["credit pack", "top up", "purchase", "balance"],
    permission: "billing:manage",
  },
];

/** Settings tabs reachable from the page search. API keys is out of scope for release 1. */
const SETTINGS_DESTINATIONS: SearchDestination[] = [
  {
    id: "settings-organization",
    label: "Organization profile",
    group: "Settings",
    icon: Building2,
    href: "/app/settings?tab=organization",
    keywords: ["name", "country", "currency", "freshness"],
  },
  {
    id: "settings-security",
    label: "Security and sessions",
    group: "Settings",
    icon: Shield,
    href: "/app/settings?tab=security",
    keywords: ["sign out", "devices", "sessions"],
  },
  {
    id: "settings-scoring",
    label: "Scoring weights and ideal customer profile",
    group: "Settings",
    icon: Gauge,
    href: "/app/settings?tab=scoring",
    keywords: ["score", "fit", "weights", "icp", "recompute"],
  },
  {
    id: "settings-pipeline",
    label: "Pipeline stages",
    group: "Settings",
    icon: Columns3,
    href: "/app/settings?tab=pipeline",
    keywords: ["stages", "pipeline", "won", "lost", "reorder", "rename", "archive"],
  },
  {
    id: "settings-notifications",
    label: "Notification preferences",
    group: "Settings",
    icon: Bell,
    href: "/app/settings?tab=notifications",
    keywords: ["email", "alerts"],
  },
  {
    id: "settings-api-keys",
    label: "API keys",
    group: "Settings",
    icon: KeyRound,
    keywords: ["token"],
  },
];

export const SEARCH_DESTINATIONS: SearchDestination[] = [
  ...NAV_GROUPS.flatMap((group) =>
    group.items.map<SearchDestination>((item) => ({
      id: `nav-${item.label}`,
      label: item.label,
      group: group.title,
      icon: item.icon,
      href: item.href,
      keywords: item.keywords ?? [],
      permission: item.permission,
    })),
  ),
  ...TASK_DESTINATIONS,
  ...SETTINGS_DESTINATIONS,
];

/** Whether a role sees an item or destination (those without a permission are for everyone). */
export function visibleTo(role: OrganizationRole, item: { permission?: Permission }): boolean {
  return !item.permission || roleHasPermission(role, item.permission);
}

/** The navigation for a role: items it cannot use are left out, and empty groups with them. */
export function navGroupsFor(role: OrganizationRole): NavGroup[] {
  return NAV_GROUPS.map((g) => ({ ...g, items: g.items.filter((i) => visibleTo(role, i)) })).filter(
    (g) => g.items.length > 0,
  );
}

function matchesPath(item: NavItem, pathname: string): boolean {
  if (!item.href) return false;
  return item.exact
    ? pathname === item.href
    : pathname === item.href || pathname.startsWith(`${item.href}/`);
}

const ALL_ITEMS = NAV_GROUPS.flatMap((g) => g.items);

/**
 * An item is active when it matches the path and no other item matches more specifically, so
 * /app/businesses/duplicates highlights Duplicate Review and not Businesses as well.
 */
export function isNavItemActive(item: NavItem, pathname: string): boolean {
  if (!matchesPath(item, pathname)) return false;
  return !ALL_ITEMS.some(
    (other) =>
      other !== item &&
      other.href &&
      item.href &&
      other.href.length > item.href.length &&
      matchesPath(other, pathname),
  );
}

export function pageTitleFor(pathname: string): string {
  for (const item of ALL_ITEMS) {
    if (isNavItemActive(item, pathname)) return item.label;
  }
  return "Workspace";
}
