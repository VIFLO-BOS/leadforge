import Link from "next/link";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@leadforge/ui";
import { fetchPublicPlans, formatMinor } from "@/lib/plans";

export async function PricingPlans({ compact = false }: { compact?: boolean }) {
  const result = await fetchPublicPlans();

  if (!result.ok || !result.data.pricingPublished || result.data.plans.length === 0) {
    return (
      <div className="border-border bg-surface rounded-lg border border-dashed p-6 text-center">
        <h3 className="text-base font-semibold">Pricing not yet published</h3>
        <p className="text-muted-foreground mx-auto mt-2 max-w-prose text-sm">
          Plans and credit packs are configured on the server and shown here once they are final. We
          do not display placeholder prices.
        </p>
        <Button asChild variant="outline" className="mt-4">
          <Link href="/contact">Ask about early access</Link>
        </Button>
      </div>
    );
  }

  const { plans, creditPacks } = result.data;

  return (
    <div className="flex flex-col gap-8">
      <ul className="grid min-w-0 grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {plans.map((plan) => (
          <li key={plan.id} className="min-w-0">
            <Card className="h-full">
              <CardHeader>
                <div className="flex items-center justify-between gap-2">
                  <CardTitle>{plan.name}</CardTitle>
                  <Badge variant="outline">{plan.interval}</Badge>
                </div>
                {plan.description ? <CardDescription>{plan.description}</CardDescription> : null}
              </CardHeader>
              <CardContent className="flex flex-col gap-4">
                <p className="text-2xl font-semibold tracking-tight">
                  {formatMinor(plan.priceMinor, plan.currency)}
                  <span className="text-muted-foreground text-sm font-normal">
                    {" "}
                    / {plan.interval === "monthly" ? "month" : "year"}
                  </span>
                </p>
                <ul className="text-muted-foreground flex flex-col gap-1.5 text-sm">
                  <li>{plan.includedCredits.toLocaleString()} credits included</li>
                  <li>Up to {plan.maxMembers} team members</li>
                  <li>Exports up to {plan.exportRowCap.toLocaleString()} rows</li>
                </ul>
                {!compact ? (
                  <Button asChild className="w-full">
                    <Link href="/sign-up">Start with {plan.name}</Link>
                  </Button>
                ) : null}
              </CardContent>
            </Card>
          </li>
        ))}
      </ul>
      {!compact && creditPacks.length > 0 ? (
        <div>
          <h3 className="text-base font-semibold">Credit packs</h3>
          <ul className="mt-3 grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {creditPacks.map((pack) => (
              <li
                key={pack.id}
                className="border-border bg-surface flex items-center justify-between gap-3 rounded-lg border p-4"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{pack.name}</p>
                  <p className="text-muted-foreground text-xs">
                    {pack.credits.toLocaleString()} credits
                  </p>
                </div>
                <p className="shrink-0 font-mono text-sm">
                  {formatMinor(pack.priceMinor, pack.currency)}
                </p>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
