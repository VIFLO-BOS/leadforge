"use client";

import type { BillingBanner } from "@leadforge/contracts";
import { CreditCard, Wallet } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { Banner, Button, type BannerTone } from "@leadforge/ui";
import { useWorkspace } from "@/components/app/app-shell";
import { bannerDismissKey, bannerDismissible, bannerHref, visibleBanners } from "@/lib/billing";
import { useBillingBanners } from "@/lib/hooks/use-billing";
import { usePermissions } from "@/lib/hooks/use-permissions";

const TONE: Record<BillingBanner["severity"], BannerTone> = {
  info: "info",
  warning: "warning",
  error: "destructive",
};

function readDismissed(keys: string[]): Set<string> {
  const out = new Set<string>();
  try {
    for (const k of keys) if (window.sessionStorage.getItem(k) === "1") out.add(k);
  } catch {
    /* storage unavailable: nothing stays dismissed */
  }
  return out;
}

function actionLabel(b: BillingBanner): string {
  switch (b.kind) {
    case "negative_balance":
      return "Buy credits";
    case "past_due":
    case "payment_failed":
      return "Open billing";
    case "not_configured":
      return "Billing";
    default:
      return "Open";
  }
}

/**
 * Account-wide billing conditions (GET /billing/banners) at the top of every dashboard page: a
 * negative credit balance for everyone; payments not set up, an overdue renewal and a failed
 * payment for owners and administrators. Re-read on focus and every 5 minutes. Informational
 * banners can be dismissed for the rest of the tab session; a negative balance and an overdue
 * renewal stay until resolved. A failed request shows nothing (the page's own data still loads).
 */
export function BillingBanners() {
  const { org } = useWorkspace();
  const { can } = usePermissions();
  const manager = can("billing:manage");
  const pathname = usePathname();
  const banners = useBillingBanners();
  const list = visibleBanners(banners.data?.banners ?? [], manager).filter(
    // The Billing page explains a missing payment provider itself.
    (b) => !(b.kind === "not_configured" && pathname.startsWith("/app/billing")),
  );
  const keys = list.map((b) => bannerDismissKey(org.id, b));
  const keyString = keys.join("|");
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  useEffect(() => {
    setDismissed(readDismissed(keyString ? keyString.split("|") : []));
  }, [keyString]);

  const shown = list.filter(
    (b) => !(bannerDismissible(b) && dismissed.has(bannerDismissKey(org.id, b))),
  );
  if (!shown.length) return null;

  return (
    <div className="mb-5 flex min-w-0 flex-col gap-2" data-testid="billing-banners">
      {shown.map((b) => {
        const target = bannerHref(b, manager);
        const link =
          b.kind === "negative_balance" && target === "/app/billing"
            ? "/app/billing?tab=plans#credit-packs"
            : target;
        // No link to the page the person is already on.
        const href = link && link !== pathname ? link : null;
        const key = bannerDismissKey(org.id, b);
        return (
          <Banner
            key={key}
            tone={TONE[b.severity] ?? "info"}
            icon={
              b.kind === "negative_balance"
                ? Wallet
                : b.kind === "not_configured"
                  ? undefined
                  : CreditCard
            }
            title={b.title}
            description={b.message}
            data-banner={b.kind}
            actions={
              href ? (
                <Button asChild size="sm" variant={b.severity === "error" ? "primary" : "outline"}>
                  <Link href={href}>{actionLabel(b)}</Link>
                </Button>
              ) : undefined
            }
            dismissLabel={`Dismiss: ${b.title}`}
            onDismiss={
              bannerDismissible(b)
                ? () => {
                    try {
                      window.sessionStorage.setItem(key, "1");
                    } catch {
                      /* storage unavailable */
                    }
                    setDismissed((d) => new Set(d).add(key));
                  }
                : undefined
            }
          />
        );
      })}
    </div>
  );
}
