"use client";

import type { UserSummary } from "@leadforge/contracts";
import { MailCheck } from "lucide-react";
import { ResendVerificationButton } from "@/components/auth/verify-email";
import { Logo } from "@/components/marketing/logo";
import { UserMenu } from "./user-menu";

export function VerifyGate({ user }: { user: UserSummary }) {
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="border-border page-pad flex h-[var(--topbar-h)] items-center justify-between border-b">
        <Logo />
        <UserMenu user={user} />
      </header>
      <main id="main" className="page-pad flex flex-1 items-center justify-center py-10">
        <div className="border-border bg-surface w-full max-w-md rounded-lg border p-6 text-center sm:p-8">
          <span className="bg-primary-subtle text-primary mx-auto mb-4 flex size-12 items-center justify-center rounded-full">
            <MailCheck aria-hidden className="size-6" />
          </span>
          <h1 className="text-xl font-semibold">Verify your email</h1>
          <p className="text-muted-foreground mt-2 text-sm">
            We sent a verification link to{" "}
            <span className="break-anywhere text-foreground font-medium">{user.email}</span>. Your
            workspace unlocks as soon as you open it.
          </p>
          <ResendVerificationButton className="mt-6 flex flex-col items-center" />
        </div>
      </main>
    </div>
  );
}
