"use client";

import { Coins } from "lucide-react";
import Link from "next/link";
import { Skeleton, Tooltip, TooltipContent, TooltipTrigger, cn } from "@leadforge/ui";
import { formatNumber } from "@/lib/format";
import { useCreditBalance } from "@/lib/hooks/use-credits";

/**
 * Top-bar credit balance from GET /credits/balance, linking to Usage and credits. Renders nothing
 * when the balance cannot be loaded (the Usage page shows that error); never a guessed number.
 */
export function CreditsChip({ className }: { className?: string }) {
  const balance = useCreditBalance();
  if (balance.isPending) {
    return <Skeleton className={cn("h-8 w-28 rounded-full", className)} aria-hidden />;
  }
  if (!balance.data) return null;
  const b = balance.data;
  const unit = b.balance === 1 ? "credit" : "credits";
  const label = `${formatNumber(b.balance)} ${unit} available${
    b.held ? `, ${formatNumber(b.held)} held by running jobs` : ""
  }`;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Link
          href="/app/usage"
          aria-label={`${label}. Open usage and credits`}
          data-testid="credits-chip"
          className={cn(
            "transition-ui state-layer press-scale border-border-strong text-foreground inline-flex h-8 items-center gap-1.5 whitespace-nowrap rounded-full border px-3 text-[13px] font-medium tabular-nums",
            className,
          )}
        >
          <Coins aria-hidden className="text-primary size-4" />
          {/* The visible "877 credits" starts the accessible name (label in name, 2.5.3). */}
          {formatNumber(b.balance)}{" "}
          <span className="text-muted-foreground font-normal">{unit}</span>
        </Link>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}
