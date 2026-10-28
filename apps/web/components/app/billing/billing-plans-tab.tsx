"use client";

import type { BillingCatalogue, BillingCreditPack, BillingPlan } from "@leadforge/contracts";
import { Check, CreditCard, Lock, Minus, Package, ShieldCheck } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import {
  Badge,
  Banner,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
  EmptyState,
  Heading,
  HeadingLevel,
  toast,
} from "@leadforge/ui";
import {
  PRICING_NOT_PUBLISHED,
  checkoutError,
  hasRealPrice,
  intervalPer,
  priceText,
  purchaseState,
} from "@/lib/billing";
import { formatNumber } from "@/lib/format";
import { useCheckout, type CheckoutTarget } from "@/lib/hooks/use-billing";
import { isApiError } from "@/lib/api";

function Feature({ on, children }: { on: boolean; children: React.ReactNode }) {
  const Icon = on ? Check : Minus;
  return (
    <li className="flex min-w-0 items-start gap-2">
      <Icon
        aria-hidden
        className={
          on
            ? "text-success mt-0.5 size-4 shrink-0"
            : "text-muted-foreground mt-0.5 size-4 shrink-0"
        }
      />
      <span className={on ? undefined : "text-muted-foreground"}>
        {children}
        <span className="sr-only">{on ? " (included)" : " (not included)"}</span>
      </span>
    </li>
  );
}

/** The price line: the real price, or "Pricing not yet published" (never ₦0 or a placeholder). */
function Price({
  item,
  pricingPublished,
  per,
  testMode,
}: {
  item: BillingPlan | BillingCreditPack;
  pricingPublished: boolean;
  per?: string;
  testMode: boolean;
}) {
  if (hasRealPrice(item, pricingPublished)) {
    return (
      <p className="flex flex-wrap items-baseline gap-x-1.5" data-testid="price">
        <span className="text-2xl font-normal">{priceText(item, pricingPublished)}</span>
        {per ? <span className="text-muted-foreground text-sm">{per}</span> : null}
      </p>
    );
  }
  return (
    <div className="flex flex-col gap-0.5" data-testid="price">
      <p className="text-muted-foreground text-sm font-medium">{PRICING_NOT_PUBLISHED}</p>
      {testMode && item.purchasable ? (
        <p className="text-muted-foreground text-xs">
          Test mode: the checkout uses the placeholder price and no real money moves.
        </p>
      ) : null}
    </div>
  );
}

function BuyButton({
  label,
  catalogue,
  item,
  pending,
  onBuy,
}: {
  label: string;
  catalogue: BillingCatalogue;
  item: BillingPlan | BillingCreditPack;
  pending: boolean;
  onBuy: () => void;
}) {
  const reasonId = useId();
  const state = purchaseState(item, catalogue);
  const current = item.blocker === "current_plan";
  return (
    <div className="flex w-full min-w-0 flex-col gap-1.5">
      {current ? (
        <Badge variant="primary" className="self-start" data-testid="current-plan">
          Current plan
        </Badge>
      ) : (
        <Button
          className="h-auto min-h-10 w-full whitespace-normal py-2 min-[360px]:w-auto min-[360px]:self-start"
          variant="primary"
          disabled={!state.enabled}
          loading={pending}
          aria-describedby={state.reason ? reasonId : undefined}
          onClick={onBuy}
        >
          {!state.enabled ? <Lock aria-hidden /> : <CreditCard aria-hidden />}
          {label}
        </Button>
      )}
      {state.reason && !current ? (
        <p id={reasonId} className="text-muted-foreground text-xs" data-testid="purchase-blocked">
          {state.reason}
        </p>
      ) : null}
    </div>
  );
}

function PlanCard({
  plan,
  catalogue,
  pending,
  onBuy,
}: {
  plan: BillingPlan;
  catalogue: BillingCatalogue;
  pending: boolean;
  onBuy: () => void;
}) {
  return (
    <Card className="flex h-full flex-col" data-testid="plan-card" data-plan={plan.code}>
      <CardHeader>
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <CardTitle>{plan.name}</CardTitle>
          <Badge variant="outline">{plan.interval === "yearly" ? "Yearly" : "Monthly"}</Badge>
        </div>
        {plan.description ? (
          <CardDescription className="break-words">{plan.description}</CardDescription>
        ) : null}
      </CardHeader>
      <CardContent className="flex min-w-0 flex-1 flex-col gap-4">
        <Price
          item={plan}
          pricingPublished={catalogue.pricingPublished}
          per={intervalPer(plan.interval)}
          testMode={catalogue.provider.mode === "test"}
        />
        <ul className="flex min-w-0 flex-col gap-1.5 text-sm">
          <Feature on={plan.includedCredits > 0}>
            {formatNumber(plan.includedCredits)} credits {intervalPer(plan.interval)}
          </Feature>
          <Feature on>Up to {formatNumber(plan.maxMembers)} members</Feature>
          <Feature on>Up to {formatNumber(plan.exportRowCap)} rows per export</Feature>
          <Feature on={plan.discoveryEnabled}>Discovery</Feature>
          <Feature on={plan.websiteAnalysisEnabled}>Website analysis</Feature>
        </ul>
      </CardContent>
      <CardFooter>
        <BuyButton
          label={`Choose ${plan.name}`}
          catalogue={catalogue}
          item={plan}
          pending={pending}
          onBuy={onBuy}
        />
      </CardFooter>
    </Card>
  );
}

function PackCard({
  pack,
  catalogue,
  pending,
  onBuy,
}: {
  pack: BillingCreditPack;
  catalogue: BillingCatalogue;
  pending: boolean;
  onBuy: () => void;
}) {
  return (
    <Card className="flex h-full flex-col" data-testid="pack-card" data-pack={pack.code}>
      <CardHeader>
        <CardTitle>{pack.name}</CardTitle>
        <CardDescription>
          {formatNumber(pack.credits)} credits, added once Paystack confirms the payment.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex min-w-0 flex-1 flex-col gap-3">
        <Price
          item={pack}
          pricingPublished={catalogue.pricingPublished}
          testMode={catalogue.provider.mode === "test"}
        />
      </CardContent>
      <CardFooter>
        <BuyButton
          label={`Buy ${formatNumber(pack.credits)} credits`}
          catalogue={catalogue}
          item={pack}
          pending={pending}
          onBuy={onBuy}
        />
      </CardFooter>
    </Card>
  );
}

/**
 * Plans and credit packs from GET /billing/plans. Each buy button follows the API's `purchasable`
 * and `blocker`; without a payment provider every button is disabled with the reason beside it.
 * A click creates a checkout with a fresh Idempotency-Key and sends the browser to Paystack.
 */
export function BillingPlansTab({
  catalogue,
  onReload,
  navigate,
}: {
  catalogue: BillingCatalogue;
  onReload: () => void;
  navigate?: (url: string) => void;
}) {
  const checkout = useCheckout(navigate);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [problem, setProblem] = useState<ReturnType<typeof checkoutError> | null>(null);
  const problemRef = useRef<HTMLDivElement>(null);
  const packsRef = useRef<HTMLElement>(null);
  const packsHeadingRef = useRef<HTMLHeadingElement>(null);

  // /app/billing?tab=plans#credit-packs scrolls to the packs and focuses their heading (links
  // from Usage, Discovery and "Buy credits" on the overview).
  useEffect(() => {
    const go = () => {
      if (window.location.hash !== "#credit-packs") return;
      packsRef.current?.scrollIntoView({ block: "start" });
      packsHeadingRef.current?.focus({ preventScroll: true });
    };
    go();
    window.addEventListener("hashchange", go);
    return () => window.removeEventListener("hashchange", go);
  }, []);

  useEffect(() => {
    if (problem) problemRef.current?.focus();
  }, [problem]);

  const buy = (target: CheckoutTarget, id: string) => {
    setProblem(null);
    setPendingId(id);
    checkout.mutate(target, {
      onError: (err) => {
        const p = checkoutError(err);
        setProblem(p);
        toast.error(p.title, { description: p.message });
        if (
          isApiError(err) &&
          (err.code === "PRICE_NOT_PUBLISHED" ||
            err.code === "BILLING_NOT_CONFIGURED" ||
            err.code === "CONFLICT")
        ) {
          onReload();
        }
      },
      // On success the browser is leaving for Paystack; keep the button busy until it does.
      onSettled: (_d, err) => {
        if (err) setPendingId(null);
      },
    });
  };

  const { plans, creditPacks: packs } = catalogue;
  return (
    <div className="flex min-w-0 flex-col gap-6">
      {!catalogue.pricingPublished ? (
        <Banner
          tone="info"
          title={PRICING_NOT_PUBLISHED}
          data-testid="pricing-not-published"
          description="LeadForge has not published its prices yet. Plans and credit packs are listed with what they include; their prices appear here once they are published."
        />
      ) : null}
      {!catalogue.provider.configured ? (
        <Banner
          tone="info"
          icon={Lock}
          title="Payments are not set up yet"
          data-testid="billing-not-configured"
          description="This LeadForge server is not connected to Paystack, so the buttons below are turned off and nothing will be charged."
        />
      ) : null}
      {problem ? (
        <div
          ref={problemRef}
          tabIndex={-1}
          className="focus-visible:ring-ring rounded-md outline-none focus-visible:ring-2"
        >
          <Banner
            tone={problem.tone}
            title={problem.title}
            description={problem.message}
            data-testid="checkout-problem"
          />
        </div>
      ) : null}

      <section aria-labelledby="plans-title" className="flex min-w-0 flex-col gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <Heading id="plans-title" className="text-base font-medium">
            Plans
          </Heading>
          <p className="text-muted-foreground text-sm">
            A plan sets the member and export limits and adds credits every period. Changing plan
            replaces the current one when the new payment is confirmed.
          </p>
        </div>
        <HeadingLevel>
          {plans.length ? (
            <div className="grid min-w-0 grid-cols-1 gap-4 min-[640px]:grid-cols-2 xl:grid-cols-3">
              {plans.map((plan) => (
                <PlanCard
                  key={plan.id}
                  plan={plan}
                  catalogue={catalogue}
                  pending={pendingId === plan.id}
                  onBuy={() => buy({ kind: "subscription", planId: plan.id }, plan.id)}
                />
              ))}
            </div>
          ) : (
            <EmptyState
              size="compact"
              icon={CreditCard}
              title="No plans offered yet"
              description="Plans appear here once LeadForge publishes them."
            />
          )}
        </HeadingLevel>
      </section>

      <section
        ref={packsRef}
        id="credit-packs"
        aria-labelledby="packs-title"
        className="flex min-w-0 scroll-mt-24 flex-col gap-3"
      >
        <div className="flex min-w-0 flex-col gap-1">
          <Heading
            id="packs-title"
            ref={packsHeadingRef}
            tabIndex={-1}
            className="rounded-xs text-base font-medium outline-none"
          >
            Credit packs
          </Heading>
          <p className="text-muted-foreground text-sm">
            One-off credits for discovery and website analysis, with or without a plan. They do not
            expire with the period.
          </p>
        </div>
        <HeadingLevel>
          {packs.length ? (
            <div className="grid min-w-0 grid-cols-1 gap-4 min-[640px]:grid-cols-2 xl:grid-cols-3">
              {packs.map((pack) => (
                <PackCard
                  key={pack.id}
                  pack={pack}
                  catalogue={catalogue}
                  pending={pendingId === pack.id}
                  onBuy={() => buy({ kind: "credits", packId: pack.id }, pack.id)}
                />
              ))}
            </div>
          ) : (
            <EmptyState
              size="compact"
              icon={Package}
              title="No credit packs offered yet"
              description="Credit packs appear here once LeadForge publishes them."
            />
          )}
        </HeadingLevel>
      </section>

      <p className="text-muted-foreground flex items-start gap-1.5 text-xs">
        <ShieldCheck aria-hidden className="mt-px size-3.5 shrink-0" />
        <span>
          Payments are processed by Paystack on its own page; LeadForge never sees card numbers.
          Credits and plans are added only after Paystack confirms the payment to LeadForge&apos;s
          server, never on the redirect back.
        </span>
      </p>
    </div>
  );
}
