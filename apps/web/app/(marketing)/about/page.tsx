import type { Metadata } from "next";
import Link from "next/link";
import { Button } from "@leadforge/ui";

export const metadata: Metadata = {
  title: "About",
  description:
    "Why LeadForge exists, why it starts with Nigerian businesses, and how it plans to expand.",
};

export default function AboutPage() {
  return (
    <div className="container-prose py-14 md:py-20">
      <p className="text-primary text-xs font-semibold uppercase tracking-wider">About</p>
      <h1 className="text-h1 mt-2 font-semibold tracking-tight">
        Lead intelligence that shows its work.
      </h1>

      <div className="text-body-lg text-muted-foreground mt-8 flex flex-col gap-6">
        <p>
          Sales and research teams spend their best hours assembling lists by hand: searching maps,
          copying numbers, guessing which email still works, and wondering whether a business
          already has the thing they want to sell. The tools that promise to fix this usually hide
          where their data came from, and the result is a list nobody fully trusts.
        </p>
        <p>
          LeadForge is built around one rule: every field carries its source, its collection date
          and its verification status, and the interface never claims more than the data supports. A
          missing detection is reported as &ldquo;not detected&rdquo;, a phone number is only called
          a WhatsApp contact when there is evidence, and a lead score is a measure of fit against
          your own criteria, not a prediction.
        </p>

        <h2 className="text-h3 text-foreground mt-4 font-semibold">Why Nigeria first</h2>
        <p>
          Nigeria has a very large population of small and medium businesses, many of which run on a
          phone number and a WhatsApp line rather than a website. That makes contact discovery
          valuable and verification essential. It also means the common assumptions baked into
          international tools, from phone formats to payment rails, do not hold. Starting here
          forces the product to get those details right: country-aware phone parsing, Paystack
          billing in naira, and sources evaluated for their coverage of Nigerian businesses
          specifically.
        </p>

        <h2 className="text-h3 text-foreground mt-4 font-semibold">How expansion works</h2>
        <p>
          Nothing in the data model is Nigeria-only. Locations carry ISO country codes,
          normalization is country-aware, sources are configured per country, and billing supports
          additional providers and currencies. Adding a market means reviewing and enabling sources
          for it, not rebuilding the platform.
        </p>

        <h2 className="text-h3 text-foreground mt-4 font-semibold">What we will not do</h2>
        <ul className="list-disc space-y-2 pl-5">
          <li>
            Scrape sites whose terms or robots directives forbid it, or bypass logins, CAPTCHAs or
            rate limits.
          </li>
          <li>Invent or infer contact details that were not observed.</li>
          <li>
            Publish customer counts, performance claims or testimonials we cannot substantiate.
          </li>
          <li>Ignore a correction or removal request from a business.</li>
        </ul>
      </div>

      <div className="mt-10 flex flex-col gap-3 min-[360px]:flex-row">
        <Button asChild size="lg">
          <Link href="/sign-up">Create your workspace</Link>
        </Button>
        <Button asChild size="lg" variant="outline">
          <Link href="/contact">Contact us</Link>
        </Button>
      </div>
    </div>
  );
}
