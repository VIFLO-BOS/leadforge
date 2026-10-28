"use client";

import type { UserSummary } from "@leadforge/contracts";
import { MailCheck } from "lucide-react";
import { ResendVerificationButton } from "@/components/auth/verify-email";
import { Logo } from "@/components/marketing/logo";
import { UserMenu } from "./user-menu";

/** Shown instead of the workspace until the account's email address is verified. */
export function VerifyGate({ user }: { user: UserSummary }) {
  return (
    <div className="bg-surface min-[480px]:bg-surface-container-low dark:min-[480px]:bg-background flex min-h-dvh flex-col">
      <header className="page-pad flex h-16 items-center justify-between gap-2">
        <Logo />
        <UserMenu user={user} />
      </header>
      <main
        id="main"
        className="flex flex-1 items-start justify-center py-6 min-[480px]:items-center min-[480px]:px-6 min-[480px]:py-10"
      >
        <div className="bg-surface flex w-full max-w-[480px] flex-col items-start gap-5 px-[var(--page-pad)] py-6 min-[480px]:rounded-2xl min-[480px]:p-10">
          <span className="bg-primary-container text-primary-container-foreground flex size-12 items-center justify-center rounded-full">
            <MailCheck aria-hidden className="size-6" />
          </span>
          <div className="flex flex-col gap-2">
            <h1 className="text-2xl font-normal leading-8 tracking-[-0.01em]">Verify your email</h1>
            <p className="text-muted-foreground text-sm leading-6">
              We sent a verification link to{" "}
              <span className="break-anywhere text-foreground font-medium">{user.email}</span>. Your
              workspace unlocks as soon as you open it.
            </p>
          </div>
          <ResendVerificationButton />
        </div>
      </main>
    </div>
  );
}
