"use client";

import { ROLE_LABELS } from "@leadforge/contracts";
import { Coins, Lock, Wallet } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  Banner,
  Button,
  EmptyState,
  ErrorState,
  PageHeader,
  Skeleton,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@leadforge/ui";
import { useWorkspace } from "@/components/app/app-shell";
import { INVOICE_DOWNLOAD_ERROR_MESSAGES, invoiceDownloadErrorFrom } from "@/lib/billing";
import { friendlyMessage, isForbidden, requestIdOf } from "@/lib/errors";
import { formatRelative } from "@/lib/format";
import { useBillingOverview, useBillingPlans } from "@/lib/hooks/use-billing";
import { usePermissions } from "@/lib/hooks/use-permissions";
import { useUrlState } from "@/lib/hooks/use-url-state";
import { BillingOverviewTab } from "./billing-overview-tab";
import { BillingPlansTab } from "./billing-plans-tab";
import { InvoicesTab, PaymentsTab } from "./billing-history";

export const BILLING_TABS = ["overview", "plans", "payments", "invoices"] as const;
export type BillingTab = (typeof BILLING_TABS)[number];

export function parseBillingParams(params: URLSearchParams): { tab: BillingTab } {
  const t = params.get("tab");
  return { tab: BILLING_TABS.includes(t as BillingTab) ? (t as BillingTab) : "overview" };
}

export function serializeBillingState(state: { tab: BillingTab }): URLSearchParams {
  return new URLSearchParams(state.tab === "overview" ? {} : { tab: state.tab });
}

function Loading({ label }: { label: string }) {
  return (
    <div role="status" aria-busy="true" aria-label={label} className="flex min-w-0 flex-col gap-4">
      <div className="grid min-w-0 grid-cols-1 gap-4 lg:grid-cols-2">
        <Skeleton className="h-56 rounded-lg" />
        <Skeleton className="h-56 rounded-lg" />
      </div>
      <Skeleton className="h-40 rounded-lg" />
    </div>
  );
}

function OverviewPanel({
  onTab,
  navigate,
}: {
  onTab: (tab: BillingTab, hash?: string) => void;
  navigate?: (url: string) => void;
}) {
  const overview = useBillingOverview();
  if (overview.isPending) return <Loading label="Loading billing" />;
  if (overview.isError && !overview.data) {
    return (
      <ErrorState
        title={
          isForbidden(overview.error) ? "Your role cannot manage billing" : "Could not load billing"
        }
        message={friendlyMessage(overview.error)}
        requestId={requestIdOf(overview.error)}
        onRetry={isForbidden(overview.error) ? undefined : () => void overview.refetch()}
      />
    );
  }
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <BillingOverviewTab overview={overview.data!} onTab={onTab} navigate={navigate} />
      <p className="text-muted-foreground text-xs">
        From LeadForge&apos;s billing records · loaded{" "}
        {formatRelative(new Date(overview.dataUpdatedAt).toISOString())}
      </p>
    </div>
  );
}

function PlansPanel({ navigate }: { navigate?: (url: string) => void }) {
  const plans = useBillingPlans();
  if (plans.isPending) return <Loading label="Loading plans and credit packs" />;
  if (plans.isError && !plans.data) {
    return (
      <ErrorState
        title={
          isForbidden(plans.error) ? "Your role cannot manage billing" : "Could not load plans"
        }
        message={friendlyMessage(plans.error)}
        requestId={requestIdOf(plans.error)}
        onRetry={isForbidden(plans.error) ? undefined : () => void plans.refetch()}
      />
    );
  }
  return (
    <BillingPlansTab
      catalogue={plans.data!}
      onReload={() => void plans.refetch()}
      navigate={navigate}
    />
  );
}

/**
 * Billing (/app/billing, owners and administrators): the plan and its limits, credits, plans and
 * credit packs to buy through Paystack, payments with refunds (owners) and invoices. The tab is in
 * the URL (`?tab=`). Other roles see who manages billing instead of the page.
 */
export function BillingPage({ navigate }: { navigate?: (url: string) => void }) {
  const { org } = useWorkspace();
  const { can } = usePermissions();
  const [state, setState] = useUrlState(parseBillingParams, serializeBillingState);
  const params = useSearchParams();
  const [linkError, setLinkError] = useState<keyof typeof INVOICE_DOWNLOAD_ERROR_MESSAGES | null>(
    null,
  );
  const linkErrorRef = useRef<HTMLDivElement>(null);

  // A failed invoice link lands on /app/billing?downloadError=<code> (303 from the API). Say what
  // happened once, open Invoices, and drop the parameter so a reload or a shared URL does not
  // repeat it.
  const downloadError = invoiceDownloadErrorFrom(params.get("downloadError"));
  useEffect(() => {
    if (!downloadError) return;
    setLinkError(downloadError);
    setState({ tab: "invoices" });
  }, [downloadError, setState]);
  useEffect(() => {
    if (linkError) linkErrorRef.current?.focus();
  }, [linkError]);

  const onTab = useCallback(
    (tab: BillingTab, hash?: string) => {
      setState({ tab });
      if (hash) {
        // The plans tab scrolls to the section named by the hash once its content renders.
        const { pathname, search } = window.location;
        window.history.replaceState(null, "", `${pathname}${search}#${hash}`);
        window.dispatchEvent(new HashChangeEvent("hashchange"));
      }
    },
    [setState],
  );

  if (!can("billing:manage")) {
    return (
      <div className="flex min-w-0 flex-col gap-6">
        <PageHeader
          eyebrow="Account"
          title="Billing"
          description="Plans, credit purchases, payments and invoices."
        />
        <EmptyState
          icon={Lock}
          title="Billing is managed by owners and administrators"
          description={`Your role (${ROLE_LABELS[org.role]}) can see the credit balance on Usage and credits. Ask an owner or administrator to buy credits or change the plan.`}
          action={
            <Button asChild variant="outline">
              <Link href="/app/usage">
                <Wallet aria-hidden /> Usage and credits
              </Link>
            </Button>
          }
          data-testid="billing-forbidden"
        />
      </div>
    );
  }

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <PageHeader
        eyebrow="Account"
        title="Billing"
        description={`Plan, credits, payments and invoices for ${org.name}. Payments are processed by Paystack; LeadForge never stores card numbers.`}
        actions={
          state.tab !== "plans" ? (
            <Button variant="tonal" onClick={() => onTab("plans", "credit-packs")}>
              <Coins aria-hidden /> Buy credits
            </Button>
          ) : undefined
        }
      />
      {linkError ? (
        <div
          ref={linkErrorRef}
          tabIndex={-1}
          className="focus-visible:ring-ring rounded-md outline-none focus-visible:ring-2"
        >
          <Banner
            tone="warning"
            title={INVOICE_DOWNLOAD_ERROR_MESSAGES[linkError].title}
            description={INVOICE_DOWNLOAD_ERROR_MESSAGES[linkError].message}
            onDismiss={() => setLinkError(null)}
            dismissLabel="Dismiss: download problem"
            data-testid="invoice-link-problem"
          />
        </div>
      ) : null}
      <Tabs value={state.tab} onValueChange={(v) => setState({ tab: v as BillingTab })}>
        <TabsList aria-label="Billing sections">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="plans">Plans and credits</TabsTrigger>
          <TabsTrigger value="payments">Payments</TabsTrigger>
          <TabsTrigger value="invoices">Invoices</TabsTrigger>
        </TabsList>
        <TabsContent value="overview" className="pt-5">
          <OverviewPanel onTab={onTab} navigate={navigate} />
        </TabsContent>
        <TabsContent value="plans" className="pt-5">
          <PlansPanel navigate={navigate} />
        </TabsContent>
        <TabsContent value="payments" className="pt-5">
          <PaymentsTab />
        </TabsContent>
        <TabsContent value="invoices" className="pt-5">
          <InvoicesTab navigate={navigate} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
