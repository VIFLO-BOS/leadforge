"use client";

import type { MeResponse } from "@leadforge/contracts";
import { Menu, X } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { createContext, useContext, useEffect, useMemo, useState } from "react";
import {
  Button,
  ErrorState,
  Sheet,
  SheetClose,
  SheetContent,
  SheetTitle,
  Skeleton,
  cn,
  useMediaQuery,
} from "@leadforge/ui";
import { Logo, LogoMark } from "@/components/marketing/logo";
import { isApiError } from "@/lib/api";
import { friendlyMessage, requestIdOf } from "@/lib/errors";
import { useActiveOrg, useMe } from "@/lib/hooks/use-me";
import { ensureActiveOrgId } from "@/lib/org";
import { signInUrl } from "@/lib/session";
import { BillingBanners } from "./billing/billing-banners";
import { CreditsChip } from "./credits-chip";
import { pageTitleFor } from "./nav-config";
import { NotificationCenter } from "./notifications/notification-center";
import { OrgDeletionBanner } from "./org-deletion-banner";
import { OrgSwitcher } from "./org-switcher";
import { PageSearch } from "./page-search";
import { SidebarNav } from "./sidebar-nav";
import { ThemeToggle } from "./theme-toggle";
import { UserMenu } from "./user-menu";
import { VerifyGate } from "./verify-gate";

const COLLAPSE_KEY = "lf.sidebarCollapsed";
const DRAWER_ID = "app-navigation-drawer";

interface WorkspaceContextValue {
  me: MeResponse;
  org: NonNullable<ReturnType<typeof useActiveOrg>["org"]>;
}

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);

export function useWorkspace(): WorkspaceContextValue {
  const ctx = useContext(WorkspaceContext);
  if (!ctx) throw new Error("useWorkspace must be used inside AppShell");
  return ctx;
}

/**
 * Workspace shell in the Google Workspace / Cloud console idiom: a tinted shell plane holding the
 * top app bar and navigation, and a rounded content panel in the surface colour (full-bleed under
 * 768px so the 240px viewport keeps a 216px content box).
 */
export function AppShell({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const me = useMe();
  const { org, setOrg } = useActiveOrg(me.data);
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const tiny = useMediaQuery("(max-width: 359.98px)");

  useEffect(() => {
    try {
      setCollapsed(window.localStorage.getItem(COLLAPSE_KEY) === "1");
    } catch {
      /* storage unavailable */
    }
  }, []);

  const toggleCollapsed = () => {
    setCollapsed((c) => {
      try {
        window.localStorage.setItem(COLLAPSE_KEY, c ? "0" : "1");
      } catch {
        /* storage unavailable */
      }
      return !c;
    });
  };

  useEffect(() => {
    if (
      me.isError &&
      isApiError(me.error) &&
      (me.error.status === 401 || me.error.code === "UNAUTHENTICATED")
    ) {
      // Usually the session watcher has already navigated (a 401 that survived the refresh);
      // this covers a refresh that could not be checked.
      router.replace(signInUrl(`${pathname}${window.location.search}`, window.location.origin));
    }
  }, [me.isError, me.error, router, pathname]);

  useEffect(() => {
    setMobileOpen(false);
    setNotificationsOpen(false);
  }, [pathname]);

  const title = useMemo(() => pageTitleFor(pathname), [pathname]);

  if (me.isPending) {
    return <ShellSkeleton />;
  }

  if (me.isError) {
    const unauthenticated = isApiError(me.error) && me.error.status === 401;
    return (
      <main
        id="main"
        className="page-pad bg-surface-container-low dark:bg-background flex min-h-dvh items-center justify-center"
      >
        <div className="bg-surface flex w-full max-w-md flex-col gap-5 rounded-2xl p-6 sm:p-8">
          <LogoMark />
          {unauthenticated ? (
            <p className="text-muted-foreground text-sm">Redirecting to sign in.</p>
          ) : (
            <ErrorState
              titleAs="h1"
              title="Could not load your workspace"
              message={friendlyMessage(me.error)}
              requestId={requestIdOf(me.error)}
              onRetry={() => void me.refetch()}
            />
          )}
        </div>
      </main>
    );
  }

  const data = me.data;

  if (!data.user.emailVerifiedAt) {
    return <VerifyGate user={data.user} />;
  }

  if (!org) {
    return (
      <main
        id="main"
        className="page-pad bg-surface-container-low dark:bg-background flex min-h-dvh items-center justify-center"
      >
        <div className="bg-surface flex w-full max-w-md flex-col gap-5 rounded-2xl p-6 sm:p-8">
          <LogoMark />
          <ErrorState
            titleAs="h1"
            title="No organization"
            message="Your account is not a member of any organization. Accept an invitation or create a new workspace."
            onRetry={() => void me.refetch()}
            retryLabel="Refresh"
          />
        </div>
      </main>
    );
  }

  // Child queries read the organization header from storage; make sure it is set first.
  ensureActiveOrgId(org.id);

  return (
    <WorkspaceContext.Provider value={{ me: data, org }}>
      <div className="bg-surface-tint flex min-h-dvh flex-col">
        <header className="bg-surface-tint sticky top-0 z-30 flex h-14 shrink-0 items-center gap-1 px-1 min-[360px]:px-2 md:h-16 md:gap-2 md:px-3">
          <Button
            variant="ghost"
            size="icon"
            className="lg:hidden"
            onClick={() => setMobileOpen(true)}
            aria-label="Open navigation"
          >
            <Menu aria-hidden />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="hidden lg:inline-flex"
            onClick={toggleCollapsed}
            aria-controls={DRAWER_ID}
            aria-expanded={!collapsed}
            aria-label={collapsed ? "Expand navigation" : "Collapse navigation"}
          >
            <Menu aria-hidden />
          </Button>
          <Logo href="/app" label="LeadForge overview" className="mr-2 hidden md:flex lg:mr-6" />
          <p className="min-w-0 flex-1 truncate pl-1 text-base font-medium md:hidden">{title}</p>
          <div className="hidden min-w-0 flex-1 md:flex md:justify-center">
            <PageSearch className="w-full max-w-[720px]" />
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <CreditsChip className="mr-1 hidden lg:inline-flex" />
            <OrgSwitcher
              organizations={data.organizations}
              active={org}
              onSelect={setOrg}
              className="hidden min-[360px]:flex"
            />
            <span className="hidden min-[480px]:inline-flex">
              <ThemeToggle />
            </span>
            <NotificationCenter
              open={notificationsOpen}
              onOpenChange={setNotificationsOpen}
              showTrigger={!tiny}
            />
            <UserMenu
              user={data.user}
              compact={tiny}
              onOpenNotifications={() => setNotificationsOpen(true)}
              organizations={data.organizations}
              activeOrgId={org.id}
              onSelectOrg={setOrg}
            />
          </div>
        </header>

        <div className="flex min-h-0 flex-1">
          <div
            id={DRAWER_ID}
            className={cn(
              "hidden shrink-0 lg:block",
              collapsed ? "w-[var(--rail-w)]" : "w-[var(--sidebar-w)]",
            )}
          >
            <div
              className={cn(
                "scrollbar-thin sticky top-16 h-[calc(100dvh-4rem)] overflow-y-auto pb-6",
                collapsed ? "px-0 pt-1" : "pl-3 pr-3 pt-1",
              )}
            >
              <SidebarNav variant={collapsed ? "rail" : "drawer"} />
            </div>
          </div>

          <main
            id="main"
            className="bg-surface min-w-0 flex-1 md:mx-3 md:mb-3 md:min-h-[calc(100dvh-4.75rem)] md:rounded-2xl lg:ml-0"
          >
            <div className="mx-auto w-full max-w-[1440px] px-[var(--page-pad)] pb-10 pt-5 md:pt-7">
              <OrgDeletionBanner />
              <BillingBanners />
              {children}
            </div>
          </main>
        </div>
      </div>

      <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
        <SheetContent
          side="left"
          hideClose
          className="w-full min-[480px]:w-[var(--sidebar-w)]"
          aria-describedby={undefined}
        >
          <SheetTitle className="sr-only">Navigation</SheetTitle>
          <div className="flex h-14 shrink-0 items-center justify-between gap-2 pl-4 pr-2">
            <Logo href="/app" label="LeadForge overview" />
            <SheetClose asChild>
              <Button variant="ghost" size="icon" aria-label="Close navigation">
                <X aria-hidden />
              </Button>
            </SheetClose>
          </div>
          <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto px-3 pb-6 pt-2">
            <SidebarNav onNavigate={() => setMobileOpen(false)} />
          </div>
        </SheetContent>
      </Sheet>
    </WorkspaceContext.Provider>
  );
}

function ShellSkeleton() {
  return (
    <div
      className="bg-surface-tint flex min-h-dvh flex-col"
      role="status"
      aria-busy="true"
      aria-label="Loading workspace"
    >
      <div className="flex h-14 items-center gap-3 px-3 md:h-16">
        <Skeleton className="size-9 rounded-full" />
        <Skeleton className="h-5 w-32" />
        <Skeleton className="ml-auto hidden h-12 w-full max-w-[560px] rounded-full md:block" />
        <Skeleton className="ml-auto size-9 rounded-full md:ml-0" />
      </div>
      <div className="flex flex-1">
        <div className="hidden w-[var(--sidebar-w)] shrink-0 flex-col gap-2 px-3 pt-2 lg:flex">
          {Array.from({ length: 9 }).map((_, i) => (
            <Skeleton key={i} className="h-10 rounded-full" />
          ))}
        </div>
        <div className="bg-surface min-w-0 flex-1 md:mx-3 md:mb-3 md:rounded-2xl lg:ml-0">
          <div className="flex flex-col gap-4 px-[var(--page-pad)] pt-5 md:pt-7">
            <Skeleton className="h-8 w-48 max-w-full" />
            <Skeleton className="h-4 w-72 max-w-full" />
            <div className="grid grid-cols-1 gap-3 min-[480px]:grid-cols-2 xl:grid-cols-4">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-28 rounded-md" />
              ))}
            </div>
            <Skeleton className="h-56 rounded-lg" />
          </div>
        </div>
      </div>
    </div>
  );
}
