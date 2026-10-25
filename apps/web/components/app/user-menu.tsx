"use client";

import type { UserSummary } from "@leadforge/contracts";
import { useQueryClient } from "@tanstack/react-query";
import { LogOut, Settings, Shield } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  Avatar,
  AvatarFallback,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  initials,
  toast,
} from "@leadforge/ui";
import { apiFetch } from "@/lib/api";
import { friendlyMessage } from "@/lib/errors";
import { setActiveOrgId } from "@/lib/org";

export function UserMenu({ user }: { user: UserSummary }) {
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
        className="hover:bg-muted flex size-10 items-center justify-center rounded-md"
        aria-label={`Account menu for ${user.name}`}
      >
        <Avatar>
          <AvatarFallback>{initials(user.name)}</AvatarFallback>
        </Avatar>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60">
        <DropdownMenuLabel className="flex flex-col gap-0.5">
          <span className="text-foreground truncate text-sm font-medium">{user.name}</span>
          <span className="break-anywhere font-normal">{user.email}</span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
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
        <DropdownMenuItem onSelect={() => void signOut()} disabled={busy} destructive>
          <LogOut aria-hidden /> Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
