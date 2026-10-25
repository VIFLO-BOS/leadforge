import type { Metadata } from "next";
import Link from "next/link";
import { Button } from "@leadforge/ui";
import { FeatureGrid, Section } from "@/components/marketing/section";

export const metadata: Metadata = {
  title: "Product",
  description:
    "How LeadForge discovers businesses, enriches and verifies contact details, analyzes public websites, scores leads and manages your pipeline.",
};

export default function ProductPage() {
  return (
    <>
      <section className="container-marketing py-14 md:py-20">
        <p className="text-primary text-xs font-semibold uppercase tracking-wider">Product</p>
        <h1 className="text-h1 mt-2 max-w-3xl font-semibold tracking-tight">
          Everything between &ldquo;who should we talk to?&rdquo; and a worked pipeline.
        </h1>
        <p className="text-body-lg text-muted-foreground mt-4 max-w-2xl">
          Five connected capabilities, one data model, and a provenance trail on every field.
        </p>
      </section>

      <Section
        id="discovery"
        tone="surface"
        eyebrow="1. Business discovery"
        title="Discovery jobs over reviewed sources"
        description="Define the location, category and limit. The job is queued, processed by background workers with per-source rate limits, and reports its outcome per source: pages fetched, records created or updated, duplicates found, errors and retries."
      >
        <FeatureGrid
          items={[
            {
              title: "Cost preview",
              body: "A credit estimate before the job runs. Credits are reserved on queue and settled against actual output.",
            },
            {
              title: "Cancellation and retry",
              body: "Cancel a running job safely or retry only the items that failed.",
            },
            {
              title: "Honest coverage",
              body: "Each source shows its coverage notes and retention rules. Nothing claims to be complete.",
            },
          ]}
        />
      </Section>

      <Section
        id="enrichment"
        eyebrow="2. Contact enrichment and verification"
        title="Normalize, verify, and keep the original"
        description="Phones are parsed with country awareness. Emails are syntax and mail-server checked, with disposable domains flagged. Domains and social URLs are canonicalized. The raw observed value is kept beside the normalized one."
      >
        <FeatureGrid
          items={[
            {
              title: "Six field states",
              body: "Verified, unverified, stale, expired, missing, conflicting. Conflicts are shown, never silently resolved.",
            },
            {
              title: "WhatsApp with evidence",
              body: "Marked confirmed only from an explicit link or label on the business's own site, or a team member's assertion after contact.",
            },
            {
              title: "Freshness windows",
              body: "Fields age into stale after your configured window and can be refreshed from their source.",
            },
          ]}
        />
      </Section>

      <Section
        id="analysis"
        tone="surface"
        eyebrow="3. Website analysis"
        title="Observed facts about a public website"
        description="A sandboxed fetcher reads a handful of public pages, respects robots directives, never executes scripts, and records detections with evidence, confidence and the analysis date."
      >
        <FeatureGrid
          items={[
            {
              title: "Detections",
              body: "No reachable website, no HTTPS, no contact form found, no booking flow found, no online ordering found, no WhatsApp link found, missing viewport meta.",
            },
            {
              title: "Opportunities",
              body: "Suggestions derived from detections, each linked to the evidence that produced it.",
            },
            {
              title: "Careful wording",
              body: "The product says 'no X was detected', because a missed detection is not proof that X does not exist.",
            },
          ]}
        />
      </Section>

      <Section
        id="scoring"
        eyebrow="4. Lead scoring and deduplication"
        title="Explainable fit, cautious merging"
        description="A fit score from weights you control, shown as a breakdown and separated from data confidence. Duplicates are found by exact domain, phone and email first, then name-and-location similarity; ambiguous matches go to a review queue and merges can be undone."
      >
        <FeatureGrid
          items={[
            {
              title: "Your criteria",
              body: "Weight contact completeness, verification, website opportunity, industry match, location match, freshness and source reliability.",
            },
            {
              title: "No name-only merges",
              body: "Similar names never merge automatically. You decide, with both records side by side.",
            },
            {
              title: "Merge history",
              body: "Every merge keeps a snapshot so an incorrect merge can be reversed.",
            },
          ]}
        />
      </Section>

      <Section
        id="crm"
        tone="surface"
        eyebrow="5. Lead management"
        title="Lists, pipeline, activities and exports"
        description="Save businesses to lists, move leads through configurable stages, assign owners, log calls, WhatsApp messages, emails and meetings, and export authorized records within your plan's limits."
      >
        <div className="flex flex-col items-start gap-3 min-[360px]:flex-row">
          <Button asChild size="lg">
            <Link href="/sign-up">Create your workspace</Link>
          </Button>
          <Button asChild size="lg" variant="outline">
            <Link href="/pricing">View pricing</Link>
          </Button>
        </div>
      </Section>
    </>
  );
}
