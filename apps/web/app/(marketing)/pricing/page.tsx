import type { Metadata } from "next";
import { PricingPlans } from "@/components/marketing/pricing-preview";

export const metadata: Metadata = {
  title: "Pricing",
  description:
    "LeadForge subscription plans and credit packs, as configured in the billing system.",
};

export default function PricingPage() {
  return (
    <>
      <section className="container-marketing py-14 md:py-20">
        <p className="text-primary text-xs font-semibold uppercase tracking-wider">Pricing</p>
        <h1 className="text-h1 mt-2 max-w-3xl font-semibold tracking-tight">
          Subscriptions plus credits for the work you run.
        </h1>
        <p className="text-body-lg text-muted-foreground mt-4 max-w-2xl">
          A subscription includes a monthly credit allowance and sets team and export limits. Credit
          packs top up the balance. Discovery jobs reserve credits when queued and settle against
          what they actually produce.
        </p>
      </section>
      <section className="container-marketing pb-16 md:pb-24">
        <PricingPlans />
        <div className="text-muted-foreground mt-10 grid min-w-0 grid-cols-1 gap-4 text-sm sm:grid-cols-3">
          <div className="border-border bg-surface rounded-lg border p-4">
            <h2 className="text-foreground font-semibold">What costs credits</h2>
            <p className="mt-1">
              One credit per business record a discovery job produces. One credit per website
              analysis.
            </p>
          </div>
          <div className="border-border bg-surface rounded-lg border p-4">
            <h2 className="text-foreground font-semibold">What is included</h2>
            <p className="mt-1">
              CSV import, email checks, deduplication, lead lists, pipeline and exports within your
              plan cap.
            </p>
          </div>
          <div className="border-border bg-surface rounded-lg border p-4">
            <h2 className="text-foreground font-semibold">Failed work</h2>
            <p className="mt-1">
              Items that fail because of an error on our side are not billed. Unused reservations
              are released.
            </p>
          </div>
        </div>
      </section>
    </>
  );
}
