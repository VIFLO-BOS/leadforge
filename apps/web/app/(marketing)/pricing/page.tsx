import type { Metadata } from "next";
import { CircleSlash, Coins, PackageCheck } from "lucide-react";
import { Stagger, StaggerItem } from "@leadforge/ui";
import { Faq, FAQ_ITEMS } from "@/components/marketing/faq";
import { PricingPlans } from "@/components/marketing/pricing-preview";
import { PageHero, SectionHeader } from "@/components/marketing/section";

export const metadata: Metadata = {
  title: "Pricing",
  description:
    "LeadForge subscription plans and credit packs, as configured in the billing system.",
};

const CREDIT_FACTS = [
  {
    icon: Coins,
    title: "What costs credits",
    body: "One credit per business record a discovery job produces. One credit per website analysis.",
  },
  {
    icon: PackageCheck,
    title: "What is included",
    body: "CSV import, email checks, deduplication, lead lists, pipeline and exports within your plan cap.",
  },
  {
    icon: CircleSlash,
    title: "Failed work",
    body: "Items that fail because of an error on our side are not billed. Unused reservations are released.",
  },
];

export default function PricingPage() {
  return (
    <>
      <PageHero
        eyebrow="Pricing"
        title="Subscriptions plus credits for the work you run."
        description="A subscription includes a monthly credit allowance and sets team and export limits. Credit packs top up the balance. Discovery jobs reserve credits when queued and settle against what they actually produce."
      />
      <section aria-label="Plans" className="container-marketing pb-16 sm:pb-24">
        <PricingPlans headingLevel={2} />
      </section>
      <section aria-labelledby="credits-title" className="bg-surface-container-low py-16 sm:py-24">
        <div className="container-marketing flex flex-col gap-10">
          <SectionHeader
            id="credits"
            eyebrow="How credits work"
            title="You pay for output, not attempts."
          />
          <Stagger as="ul" className="grid min-w-0 grid-cols-1 gap-4 md:grid-cols-3">
            {CREDIT_FACTS.map((f) => (
              <StaggerItem
                as="li"
                key={f.title}
                className="bg-surface flex min-w-0 flex-col gap-3 rounded-[28px] p-6 sm:p-8"
              >
                <span className="bg-primary-container text-primary-container-foreground flex size-12 items-center justify-center rounded-2xl">
                  <f.icon aria-hidden className="size-6" />
                </span>
                <h3 className="text-h4">{f.title}</h3>
                <p className="text-muted-foreground text-sm leading-relaxed">{f.body}</p>
              </StaggerItem>
            ))}
          </Stagger>
        </div>
      </section>
      <section aria-labelledby="pricing-faq-title" className="py-16 sm:py-24">
        <div className="container-marketing flex flex-col gap-10">
          <SectionHeader id="pricing-faq" eyebrow="FAQ" title="Billing questions." align="center" />
          <Faq items={FAQ_ITEMS.filter((i) => /billing|score|remove/i.test(i.q))} />
        </div>
      </section>
    </>
  );
}
