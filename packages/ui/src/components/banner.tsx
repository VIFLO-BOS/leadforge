"use client";

import * as React from "react";
import { CircleAlert, CircleCheck, Info, TriangleAlert, X, type LucideIcon } from "lucide-react";
import { cn } from "../lib/cn";

export type BannerTone = "info" | "success" | "warning" | "destructive";

const TONE: Record<BannerTone, { container: string; icon: string; Icon: LucideIcon }> = {
  info: { container: "bg-info-subtle", icon: "text-info", Icon: Info },
  success: { container: "bg-success-subtle", icon: "text-success", Icon: CircleCheck },
  warning: { container: "bg-warning-subtle", icon: "text-warning", Icon: TriangleAlert },
  destructive: { container: "bg-destructive-subtle", icon: "text-destructive", Icon: CircleAlert },
};

export interface BannerProps extends Omit<React.HTMLAttributes<HTMLDivElement>, "title"> {
  tone?: BannerTone;
  title: React.ReactNode;
  description?: React.ReactNode;
  /** Action buttons (for example "Update payment method"). */
  actions?: React.ReactNode;
  /** Shows a dismiss button. Omit for alerts that must stay until resolved (failed payment). */
  onDismiss?: () => void;
  /** Accessible name of the dismiss button when several banners can show at once ("Dismiss: …"). */
  dismissLabel?: string;
  icon?: LucideIcon;
}

/**
 * In-app alert for account-level conditions (failed payment, credits running low, a source
 * disabled). Destructive banners are announced assertively (role="alert"); others politely.
 */
export function Banner({
  tone = "info",
  title,
  description,
  actions,
  onDismiss,
  dismissLabel = "Dismiss",
  icon,
  className,
  ...props
}: BannerProps) {
  const t = TONE[tone];
  const Icon = icon ?? t.Icon;
  return (
    <div
      role={tone === "destructive" ? "alert" : "status"}
      className={cn(
        "flex min-w-0 flex-col gap-3 rounded-md p-4 min-[640px]:flex-row min-[640px]:items-center",
        t.container,
        className,
      )}
      {...props}
    >
      <div className="flex min-w-0 flex-1 items-start gap-3">
        <Icon aria-hidden className={cn("mt-0.5 size-5 shrink-0", t.icon)} />
        <div className="flex min-w-0 flex-col gap-0.5">
          <p className="text-foreground text-sm font-medium">{title}</p>
          {description ? <div className="text-foreground text-sm">{description}</div> : null}
        </div>
      </div>
      {actions || onDismiss ? (
        <div className="flex min-w-0 shrink-0 flex-wrap items-center gap-2 min-[360px]:pl-8 min-[640px]:pl-0">
          {actions}
          {onDismiss ? (
            <button
              type="button"
              onClick={onDismiss}
              aria-label={dismissLabel}
              className="state-layer text-foreground flex size-9 items-center justify-center rounded-full"
            >
              <X aria-hidden className="size-[18px]" />
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
