import Link from "next/link";
import { Check, Receipt } from "lucide-react";
import { Badge, Button } from "@leadforge/ui";
import { fetchPublicPlans, formatMinor } from "@/lib/plans";

/**
 * Plans and credit packs exactly as configured in the billing system. While plans are
 * placeholders (or the API is unreachable) it shows "Pricing not yet published" and no numbers.
 */
export async function PricingPlans({
  compact = false,
  headingLevel = 3,
}: {
  compact?: boolean;
  /** Level of the component's own headings: 2 when it sits directly under the page h1. */
  headingLevel?: 2 | 3;
}) {
  const result = await fetchPublicPlans();
  const Heading = headingLevel === 2 ? "h2" : "h3";

  if (!result.ok || !result.data.pricingPublished || result.data.plans.length === 0) {
    return (
      <div className="bg-surface-container-low flex flex-col items-center gap-4 rounded-[28px] px-6 py-12 text-center sm:px-10 sm:py-16">
        <span className="bg-primary-container text-primary-container-foreground flex size-14 items-center justify-center rounded-full">
          <Receipt aria-hidden className="size-6" />
        </span>
        <Heading className="text-h3">Pricing not yet published</Heading>
        <p className="text-muted-foreground max-w-prose text-sm leading-relaxed">
          Plans and credit packs are configured on the server and shown here once they are final. We
          do not display placeholder prices.
        </p>
        <Button asChild variant="outline" size="lg" className="mt-2">
          <Link href="/contact">Ask about early access</Link>
        </Button>
      </div>
    );
  }

  const { plans, creditPacks } = result.data;

  return (
    <div className="flex flex-col gap-10">
      <ul className="grid min-w-0 grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {plans.map((plan, i) => (
          <li key={plan.id} className="min-w-0">
            <div
              className={
                i === 1 && plans.length > 2
                  ? "bg-primary-container text-primary-container-foreground flex h-full flex-col gap-6 rounded-[28px] p-6 sm:p-8"
                  : "bg-surface-container-low flex h-full flex-col gap-6 rounded-[28px] p-6 sm:p-8"
              }
            >
              <div className="flex flex-col gap-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <Heading className="text-lg font-medium">{plan.name}</Heading>
                  <Badge variant="outline" className="capitalize">
                    {plan.interval}
                  </Badge>
                </div>
                {plan.description ? <p className="text-sm opacity-80">{plan.description}</p> : null}
              </div>
              <p className="flex flex-wrap items-baseline gap-x-1.5">
                <span className="text-4xl font-normal leading-none tracking-[-0.02em]">
                  {formatMinor(plan.priceMinor, plan.currency)}
                </span>
                <span className="text-sm opacity-80">
                  / {plan.interval === "monthly" ? "month" : "year"}
                </span>
              </p>
              <ul className="flex flex-col gap-3 text-sm">
                {[
                  `${plan.includedCredits.toLocaleString()} credits included`,
                  `Up to ${plan.maxMembers} team members`,
                  `Exports up to ${plan.exportRowCap.toLocaleString()} rows`,
                ].map((line) => (
                  <li key={line} className="flex items-start gap-3">
                    <Check aria-hidden className="mt-0.5 size-4 shrink-0" strokeWidth={2.5} />
                    {line}
                  </li>
                ))}
              </ul>
              {!compact ? (
                <Button asChild size="lg" className="mt-auto w-full">
                  <Link href="/sign-up">Start with {plan.name}</Link>
                </Button>
              ) : null}
            </div>
          </li>
        ))}
      </ul>
      {!compact && creditPacks.length > 0 ? (
        <div className="flex flex-col gap-4">
          <Heading className="text-h3">Credit packs</Heading>
          <ul className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {creditPacks.map((pack) => (
              <li
                key={pack.id}
                className="bg-surface-container-low flex min-w-0 items-center justify-between gap-3 rounded-2xl p-5"
              >
                <div className="min-w-0">
                  <p className="truncate font-medium">{pack.name}</p>
                  <p className="text-muted-foreground text-sm">
                    {pack.credits.toLocaleString()} credits
                  </p>
                </div>
                <p className="shrink-0 text-lg">{formatMinor(pack.priceMinor, pack.currency)}</p>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
