import type { Metadata } from "next";
import Link from "next/link";
import { Ban, Eye, Globe2, Scale } from "lucide-react";
import { Button, Stagger, StaggerItem } from "@leadforge/ui";
import { PageHero } from "@/components/marketing/section";

export const metadata: Metadata = {
  title: "About",
  description:
    "Why LeadForge exists, why it starts with Nigerian businesses, and how it plans to expand.",
};

const PRINCIPLES = [
  {
    icon: Eye,
    title: "Show the work",
    body: "Every field carries its source, its collection date and its verification status.",
  },
  {
    icon: Scale,
    title: "Claim no more than the data supports",
    body: "A missing detection is “not detected”. A score measures fit, not intent.",
  },
  {
    icon: Ban,
    title: "Collect only what is permitted",
    body: "Reviewed sources, robots directives honoured, no bypassing of access controls.",
  },
  {
    icon: Globe2,
    title: "Built to travel",
    body: "Country-aware from the data model up, so new markets are configuration, not a rebuild.",
  },
];

export default function AboutPage() {
  return (
    <>
      <PageHero
        eyebrow="About"
        title="Lead intelligence that shows its work."
        description="Sales and research teams spend their best hours assembling lists by hand: searching maps, copying numbers, guessing which email still works. The tools that promise to fix this usually hide where their data came from, and the result is a list nobody fully trusts."
      />

      <section aria-label="Principles" className="container-marketing pb-16 sm:pb-24">
        <Stagger as="ul" className="grid min-w-0 grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {PRINCIPLES.map((p, i) => (
            <StaggerItem
              as="li"
              key={p.title}
              className={
                i === 0
                  ? "bg-primary-container text-primary-container-foreground flex min-w-0 flex-col gap-4 rounded-[28px] p-6 sm:p-7"
                  : "bg-surface-container-low flex min-w-0 flex-col gap-4 rounded-[28px] p-6 sm:p-7"
              }
            >
              <p.icon aria-hidden className="size-7" />
              <h2 className="text-h4">{p.title}</h2>
              <p className="text-sm leading-relaxed opacity-85">{p.body}</p>
            </StaggerItem>
          ))}
        </Stagger>
      </section>

      <div className="container-prose flex flex-col gap-14 pb-20 sm:pb-28">
        <section aria-labelledby="rule-title" className="flex flex-col gap-4">
          <h2 id="rule-title" className="text-h3">
            One rule
          </h2>
          <p className="text-body-lg text-muted-foreground">
            LeadForge is built around one rule: every field carries its source, its collection date
            and its verification status, and the interface never claims more than the data supports.
            A missing detection is reported as &ldquo;not detected&rdquo;, a phone number is only
            called a WhatsApp contact when there is evidence, and a lead score is a measure of fit
            against your own criteria, not a prediction.
          </p>
        </section>

        <section aria-labelledby="nigeria-title" className="flex flex-col gap-4">
          <h2 id="nigeria-title" className="text-h3">
            Why Nigeria first
          </h2>
          <p className="text-body-lg text-muted-foreground">
            Nigeria has a very large population of small and medium businesses, many of which run on
            a phone number and a WhatsApp line rather than a website. That makes contact discovery
            valuable and verification essential. It also means the common assumptions baked into
            international tools, from phone formats to payment rails, do not hold. Starting here
            forces the product to get those details right: country-aware phone parsing, Paystack
            billing in naira, and sources evaluated for their coverage of Nigerian businesses
            specifically.
          </p>
        </section>

        <section aria-labelledby="expansion-title" className="flex flex-col gap-4">
          <h2 id="expansion-title" className="text-h3">
            How expansion works
          </h2>
          <p className="text-body-lg text-muted-foreground">
            Nothing in the data model is Nigeria-only. Locations carry ISO country codes,
            normalization is country-aware, sources are configured per country, and billing supports
            additional providers and currencies. Adding a market means reviewing and enabling
            sources for it, not rebuilding the platform.
          </p>
        </section>

        <section
          aria-labelledby="wont-title"
          className="bg-surface-container-low flex flex-col gap-5 rounded-[28px] p-6 sm:p-10"
        >
          <h2 id="wont-title" className="text-h3">
            What we will not do
          </h2>
          <ul className="text-muted-foreground flex flex-col gap-3 text-sm leading-relaxed">
            {[
              "Scrape sites whose terms or robots directives forbid it, or bypass logins, CAPTCHAs or rate limits.",
              "Invent or infer contact details that were not observed.",
              "Publish customer counts, performance claims or testimonials we cannot substantiate.",
              "Ignore a correction or removal request from a business.",
            ].map((line) => (
              <li key={line} className="flex items-start gap-3">
                <Ban aria-hidden className="text-destructive mt-1 size-4 shrink-0" />
                <span className="min-w-0">{line}</span>
              </li>
            ))}
          </ul>
        </section>

        <div className="flex flex-col gap-3 min-[400px]:flex-row">
          <Button asChild size="lg">
            <Link href="/sign-up">Create your workspace</Link>
          </Button>
          <Button asChild size="lg" variant="tonal">
            <Link href="/contact">Contact us</Link>
          </Button>
        </div>
      </div>
    </>
  );
}
