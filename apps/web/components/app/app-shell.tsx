"use client";

import type { MeResponse } from "@leadforge/contracts";
import { Menu, PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { Button, ErrorState, Sheet, SheetContent, SheetTitle, Skeleton, cn } from "@leadforge/ui";
import { isApiError } from "@/lib/api";
import { friendlyMessage, requestIdOf } from "@/lib/errors";
import { useActiveOrg, useMe } from "@/lib/hooks/use-me";
import { pageTitleFor } from "./nav-config";
import { OrgSwitcher } from "./org-switcher";
import { SidebarNav } from "./sidebar-nav";
import { ThemeToggle } from "./theme-toggle";
import { UserMenu } from "./user-menu";
import { VerifyGate } from "./verify-gate";

const COLLAPSE_KEY = "lf.sidebarCollapsed";

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

export function AppShell({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const me = useMe();
  const { org, setOrg } = useActiveOrg(me.data);
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

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
      router.replace(`/sign-in?next=${encodeURIComponent(pathname)}`);
    }
  }, [me.isError, me.error, router, pathname]);

  useEffect(() => setMobileOpen(false), [pathname]);

  const title = useMemo(() => pageTitleFor(pathname), [pathname]);

  if (me.isPending) {
    return (
      <div className="flex min-h-dvh">
        <aside className="border-border hidden w-[var(--sidebar-w)] shrink-0 border-r lg:block">
          <Skeleton className="m-3 h-8" />
          <div className="flex flex-col gap-2 p-3">
            {Array.from({ length: 8 }).map((_, i) => (
              <Skeleton key={i} className="h-9" />
            ))}
          </div>
        </aside>
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="border-border h-[var(--topbar-h)] border-b" />
          <div className="flex flex-col gap-4 p-[var(--page-pad)]">
            <Skeleton className="h-8 w-1/3" />
            <Skeleton className="h-40" />
          </div>
        </div>
      </div>
    );
  }

  if (me.isError) {
    const unauthenticated = isApiError(me.error) && me.error.status === 401;
    return (
      <main id="main" className="page-pad flex min-h-dvh items-center justify-center">
        <div className="w-full max-w-md">
          {unauthenticated ? (
            <p className="text-muted-foreground text-center text-sm">Redirecting to sign in.</p>
          ) : (
            <ErrorState
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
      <main id="main" className="page-pad flex min-h-dvh items-center justify-center">
        <div className="w-full max-w-md">
          <ErrorState
            title="No organization"
            message="Your account is not a member of any organization. Accept an invitation or create a new workspace."
            onRetry={() => void me.refetch()}
            retryLabel="Refresh"
          />
        </div>
      </main>
    );
  }

  return (
    <WorkspaceContext.Provider value={{ me: data, org }}>
      <div className="flex min-h-dvh">
        <aside
          className={cn(
            "border-border bg-surface hidden shrink-0 border-r transition-[width] duration-150 motion-reduce:transition-none lg:block",
            collapsed ? "w-[var(--sidebar-w-compact)]" : "w-[var(--sidebar-w)]",
          )}
        >
          <div className="sticky top-0 flex h-dvh flex-col">
            <SidebarNav collapsed={collapsed} />
            <div className="border-border border-t p-2">
              <Button
                variant="ghost"
                size="sm"
                className="w-full justify-center"
                onClick={toggleCollapsed}
                aria-pressed={collapsed}
                aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
              >
                {collapsed ? <PanelLeftOpen aria-hidden /> : <PanelLeftClose aria-hidden />}
                {!collapsed ? <span>Collapse</span> : null}
              </Button>
            </div>
          </div>
        </aside>

        <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
          <SheetContent side="left" className="w-full min-[480px]:w-[var(--sidebar-w)]" hideClose>
            <SheetTitle className="sr-only">Navigation</SheetTitle>
            <SidebarNav onNavigate={() => setMobileOpen(false)} />
          </SheetContent>
        </Sheet>

        <div className="flex min-w-0 flex-1 flex-col">
          <header className="border-border bg-background/90 page-pad sticky top-0 z-30 flex h-[var(--topbar-h)] shrink-0 items-center gap-1 border-b backdrop-blur">
            <Button
              variant="ghost"
              size="icon"
              className="lg:hidden"
              onClick={() => setMobileOpen(true)}
              aria-label="Open navigation"
            >
              <Menu aria-hidden />
            </Button>
            <h2 className="min-w-0 flex-1 truncate text-sm font-medium">{title}</h2>
            <div className="flex shrink-0 items-center gap-0.5">
              <OrgSwitcher organizations={data.organizations} active={org} onSelect={setOrg} />
              <span className="hidden min-[360px]:inline-flex">
                <ThemeToggle />
              </span>
              <UserMenu user={data.user} />
            </div>
          </header>
          <main
            id="main"
            className="mx-auto w-full min-w-0 max-w-[1440px] flex-1 p-[var(--page-pad)]"
          >
            {children}
          </main>
        </div>
      </div>
    </WorkspaceContext.Provider>
  );
}
