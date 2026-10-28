"use client";

import type { OrganizationMembershipSummary, UserSummary } from "@leadforge/contracts";
import { useQueryClient } from "@tanstack/react-query";
import { Bell, Building2, LogOut, Palette, Settings, Shield } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  Avatar,
  AvatarFallback,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
  initials,
  toast,
} from "@leadforge/ui";
import { apiFetch } from "@/lib/api";
import { friendlyMessage } from "@/lib/errors";
import { setActiveOrgId } from "@/lib/org";
import { OrgMenuItem } from "./org-switcher";
import { ThemeRadioGroup } from "./theme-toggle";

/**
 * Account menu. Under 360px the top app bar keeps only this menu, so organization switching and
 * the theme choice move in here (`compact`).
 */
export function UserMenu({
  user,
  compact = false,
  organizations,
  activeOrgId,
  onSelectOrg,
  onOpenNotifications,
}: {
  user: UserSummary;
  compact?: boolean;
  organizations?: OrganizationMembershipSummary[];
  activeOrgId?: string | null;
  onSelectOrg?: (id: string) => void;
  /** Under 360px the bell is not in the top bar; the account menu opens notifications instead. */
  onOpenNotifications?: () => void;
}) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);

  const signOut = async () => {
    setBusy(true);
    try {
      await apiFetch("/auth/logout", { method: "POST", noOrg: true });
    } catch (err) {
      toast.error(friendlyMessage(err, "Sign-out did not complete."));
    } finally {
      setActiveOrgId(null);
      queryClient.clear();
      setBusy(false);
      router.push("/sign-in");
    }
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className="state-layer flex size-10 shrink-0 items-center justify-center rounded-full"
        // Starts with the visible initials, so voice control ("click AO") matches (WCAG 2.5.3).
        aria-label={`${initials(user.name)}, Account menu for ${user.name}`}
      >
        <Avatar aria-hidden>
          <AvatarFallback>{initials(user.name)}</AvatarFallback>
        </Avatar>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-72">
        <div className="flex min-w-0 items-center gap-3 px-3 pb-3 pt-2">
          <Avatar size="lg" aria-hidden>
            <AvatarFallback>{initials(user.name)}</AvatarFallback>
          </Avatar>
          <div className="flex min-w-0 flex-col">
            <span className="text-foreground truncate text-sm font-medium">{user.name}</span>
            <span className="break-anywhere text-muted-foreground text-xs">{user.email}</span>
          </div>
        </div>
        <DropdownMenuSeparator />
        {compact && onOpenNotifications ? (
          <DropdownMenuItem onSelect={onOpenNotifications}>
            <Bell aria-hidden /> Notifications
          </DropdownMenuItem>
        ) : null}
        {compact && organizations && onSelectOrg ? (
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>
              <Building2 aria-hidden /> Switch organization
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent className="w-64">
              {organizations.map((org) => (
                <OrgMenuItem
                  key={org.id}
                  org={org}
                  active={org.id === activeOrgId}
                  onSelect={onSelectOrg}
                />
              ))}
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        ) : null}
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            <Palette aria-hidden /> Theme
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent>
            <ThemeRadioGroup />
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuItem asChild>
          <Link href="/app/settings">
            <Settings aria-hidden /> Settings
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href="/app/settings?tab=security">
            <Shield aria-hidden /> Security
          </Link>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => void signOut()} disabled={busy}>
          <LogOut aria-hidden /> Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
