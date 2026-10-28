"use client";

import { Coins, CreditCard, Wallet } from "lucide-react";
import Link from "next/link";
import { Banner, Button, cn, type ButtonProps } from "@leadforge/ui";
import { usePermissions } from "@/lib/hooks/use-permissions";
import { entitlementFeature, friendlyMessage, negativeBalanceOf } from "@/lib/errors";
import { isApiError } from "@/lib/api";

export const BILLING_PLANS_HREF = "/app/billing?tab=plans";
export const BUY_CREDITS_HREF = "/app/billing?tab=plans#credit-packs";

/**
 * "Buy credits" for the roles that manage billing (a link to the credit packs); everyone else
 * gets a sentence saying who can, never a dead or "coming soon" button.
 */
export function BuyCreditsAction({
  variant = "outline",
  size = "sm",
  className,
}: {
  variant?: ButtonProps["variant"];
  size?: ButtonProps["size"];
  className?: string;
}) {
  const { can } = usePermissions();
  if (can("billing:manage")) {
    return (
      <Button asChild variant={variant} size={size} className={className}>
        <Link href={BUY_CREDITS_HREF}>
          <Coins aria-hidden /> Buy credits
        </Link>
      </Button>
    );
  }
  return (
    <span className={cn("text-muted-foreground text-xs", className)} data-testid="buy-credits-note">
      Owners and administrators can buy credits.
    </span>
  );
}

export type BillingBlockCode = "ENTITLEMENT_REQUIRED" | "CREDIT_BALANCE_NEGATIVE";

export function isBillingBlockCode(code: string): code is BillingBlockCode {
  return code === "ENTITLEMENT_REQUIRED" || code === "CREDIT_BALANCE_NEGATIVE";
}

/**
 * Work that billing blocks: the plan does not include discovery or website analysis
 * (`ENTITLEMENT_REQUIRED`), or the credit balance is below zero after a refund
 * (`CREDIT_BALANCE_NEGATIVE`). Owners and administrators get the way to fix it; other roles are
 * told who can. Takes an API error or a discovery estimate blocker (`code`, `message`).
 */
export function BillingBlockBanner({
  error,
  blocker,
  className,
}: {
  error?: unknown;
  blocker?: { code: string; message: string };
  className?: string;
}) {
  const { can } = usePermissions();
  const manager = can("billing:manage");
  const code = isApiError(error) ? error.code : blocker?.code;
  if (!code || !isBillingBlockCode(code)) return null;
  const negative = code === "CREDIT_BALANCE_NEGATIVE";
  const feature = entitlementFeature(error);
  const balance = negativeBalanceOf(error);
  const detail = error ? friendlyMessage(error) : (blocker?.message ?? "");
  const fix = negative
    ? manager
      ? "Buy credits to bring the balance above zero."
      : "Ask an owner or administrator to buy credits."
    : manager
      ? "Change the plan on the Billing page."
      : "Ask an owner or administrator to change the plan.";
  return (
    <Banner
      tone="warning"
      icon={negative ? Wallet : CreditCard}
      className={className}
      data-testid="billing-block"
      data-code={code}
      title={
        negative
          ? `Credit balance below zero${balance !== null ? ` (${balance})` : ""}`
          : `Not included in the workspace's plan${feature ? `: ${feature}` : ""}`
      }
      description={
        <span className="flex flex-col gap-1">
          <span className="break-words">{detail}</span>
          <span>{fix}</span>
        </span>
      }
      actions={
        manager ? (
          <Button asChild size="sm" variant="outline">
            <Link href={negative ? BUY_CREDITS_HREF : BILLING_PLANS_HREF}>
              {negative ? (
                <>
                  <Coins aria-hidden /> Buy credits
                </>
              ) : (
                <>
                  <CreditCard aria-hidden /> See plans
                </>
              )}
            </Link>
          </Button>
        ) : undefined
      }
    />
  );
}

/** A label and a value in a definition list. */
export function Fact({
  label,
  children,
  className,
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex min-w-0 flex-col gap-0.5", className)}>
      <dt className="text-muted-foreground text-xs">{label}</dt>
      <dd className="min-w-0 break-words">{children}</dd>
    </div>
  );
}
