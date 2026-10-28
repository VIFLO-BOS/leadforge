import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, Check } from "lucide-react";
import { Button, Stagger, StaggerItem, cn } from "@leadforge/ui";
import { JumpLinkBar } from "@/components/marketing/jump-link-bar";
import {
  AppFrameMock,
  ContactFieldMock,
  DirectoryMock,
  JobProgressMock,
  MockFigure,
  PipelineMock,
  ScoreBreakdownMock,
} from "@/components/marketing/mocks";
import { Eyebrow, PageHero } from "@/components/marketing/section";

export const metadata: Metadata = {
  title: "Product",
  description:
    "How LeadForge discovers businesses, enriches and verifies contact details, analyzes public websites, scores leads and manages your pipeline.",
};

const SECTIONS = [
  {
    id: "discovery",
    eyebrow: "1. Business discovery",
    title: "Discovery jobs over reviewed sources",
    body: "Define the location, category and limit. The job is queued, processed by background workers with per-source rate limits, and reports its outcome per source: pages fetched, records created or updated, duplicates found, errors and retries.",
    points: [
      "A credit estimate before the job runs; credits are reserved on queue and settled against actual output",
      "Cancel a running job safely or retry only the items that failed",
      "Each source shows its coverage notes and retention rules; nothing claims to be complete",
    ],
    visual: <JobProgressMock state="completed_with_warnings" />,
    caption: "Illustration of a completed discovery job with per-source outcomes. Sample data.",
  },
  {
    id: "enrichment",
    eyebrow: "2. Contact enrichment and verification",
    title: "Normalize, verify, and keep the original",
    body: "Phones are parsed with country awareness. Emails are syntax and mail-server checked, with disposable domains flagged. Domains and social URLs are canonicalized. The raw observed value is kept beside the normalized one.",
    points: [
      "Six field states: verified, unverified, stale, expired, missing, conflicting",
      "WhatsApp confirmed only from an explicit link or label, or a teammate's assertion after contact",
      "Fields age into stale after your freshness window and can be refreshed from their source",
    ],
    visual: <ContactFieldMock kind="phone" />,
    caption: "Illustration of a verified phone field with its source and raw value. Sample data.",
  },
  {
    id: "analysis",
    eyebrow: "3. Website analysis",
    title: "Observed facts about a public website",
    body: "A sandboxed fetcher reads a handful of public pages, respects robots directives, never executes scripts, and records detections with evidence, confidence and the analysis date.",
    points: [
      "Detections such as no HTTPS, no contact form found, no booking flow found, missing viewport meta",
      "Opportunities derived from detections, each linked to the evidence that produced it",
      "Careful wording: “no X was detected”, because a missed detection is not proof",
    ],
    visual: <ContactFieldMock kind="website" />,
    caption: "Illustration of website field analysis. Sample data.",
  },
  {
    id: "scoring",
    eyebrow: "4. Lead scoring and deduplication",
    title: "Explainable fit, cautious merging",
    body: "A fit score from weights you control, shown as a breakdown and separated from data confidence. Duplicates are found by exact domain, phone and email first, then name-and-location similarity; ambiguous matches go to a review queue and merges can be undone.",
    points: [
      "Weights for completeness, verification, website opportunity, industry, location, freshness and source reliability",
      "Similar names never merge automatically; you decide with both records side by side",
      "Every merge keeps a snapshot so an incorrect merge can be reversed",
    ],
    visual: <ScoreBreakdownMock />,
    caption: "Illustration of a fit score breakdown. Sample data.",
  },
  {
    id: "crm",
    eyebrow: "5. Lead management",
    title: "Lists, pipeline, activities and exports",
    body: "Save businesses to lists, move leads through configurable stages, assign owners, log calls, WhatsApp messages, emails and meetings, and export authorized records within your plan's limits.",
    points: [
      "Default stages from New to Won and Lost, customizable per workspace",
      "Activities and outreach records on every lead",
      "Exports respect roles, suppression and your plan's row cap",
    ],
    visual: <PipelineMock />,
    caption: "Illustration of the lead pipeline board. Sample data.",
  },
];

export default function ProductPage() {
  return (
    <>
      <PageHero
        eyebrow="Product"
        title={<>Everything between &ldquo;who should we talk to?&rdquo; and a worked pipeline.</>}
        description="Five connected capabilities, one data model, and a provenance trail on every field."
      >
        <div className="mt-3 flex flex-col gap-3 min-[400px]:flex-row">
          <Button asChild size="lg">
            <Link href="/sign-up">Create your workspace</Link>
          </Button>
          <Button asChild size="lg" variant="tonal">
            <Link href="/pricing">View pricing</Link>
          </Button>
        </div>
      </PageHero>

      <div className="container-marketing pb-16 sm:pb-24">
        <div className="bg-surface-container-high/70 dark:bg-surface-container rounded-[22px] p-1.5 sm:rounded-[32px] sm:p-2.5">
          <MockFigure
            caption="Illustration of the LeadForge business directory. All businesses and values are fictional sample data."
            frameClassName="overflow-hidden rounded-[16px] sm:rounded-[24px]"
          >
            <AppFrameMock>
              <DirectoryMock />
            </AppFrameMock>
          </MockFigure>
        </div>
      </div>

      <JumpLinkBar
        items={[
          { id: "discovery", label: "Discovery" },
          { id: "enrichment", label: "Enrichment" },
          { id: "analysis", label: "Website analysis" },
          { id: "scoring", label: "Scoring" },
          { id: "crm", label: "Lead management" },
        ]}
      />

      {SECTIONS.map((s, i) => (
        <section
          key={s.id}
          id={s.id}
          aria-labelledby={`${s.id}-title`}
          className={cn("py-16 sm:py-24 lg:py-28", i % 2 === 1 && "bg-surface-container-low")}
        >
          <div className="container-marketing grid min-w-0 grid-cols-1 items-center gap-10 lg:grid-cols-2 lg:gap-20">
            <div className={cn("flex min-w-0 flex-col gap-5", i % 2 === 1 && "lg:order-2")}>
              <Eyebrow>{s.eyebrow}</Eyebrow>
              <h2 id={`${s.id}-title`} className="text-h2 text-balance">
                {s.title}
              </h2>
              <p className="text-body-lg text-muted-foreground">{s.body}</p>
              <Stagger as="ul" className="mt-2 flex flex-col gap-3">
                {s.points.map((p) => (
                  <StaggerItem as="li" key={p} className="flex min-w-0 items-start gap-3 text-sm">
                    <span className="bg-primary-container text-primary-container-foreground mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full">
                      <Check aria-hidden className="size-3.5" strokeWidth={3} />
                    </span>
                    <span className="min-w-0">{p}</span>
                  </StaggerItem>
                ))}
              </Stagger>
            </div>
            <div
              className={cn(
                "sda-fade-scale min-w-0 rounded-[24px] p-1.5 sm:rounded-[32px] sm:p-2.5",
                i % 2 === 1
                  ? "bg-surface-container-high dark:bg-surface-container"
                  : "bg-surface-container-high/70 dark:bg-surface-container",
              )}
            >
              <MockFigure
                caption={s.caption}
                frameClassName="bg-surface overflow-hidden rounded-[18px] sm:rounded-[24px]"
              >
                {s.visual}
              </MockFigure>
            </div>
          </div>
        </section>
      ))}

      <section className="py-16 sm:py-24">
        <div className="container-marketing">
          <div className="bg-inverse-surface text-inverse-foreground flex flex-col items-start gap-6 rounded-[32px] p-8 sm:rounded-[48px] sm:p-14 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex max-w-2xl flex-col gap-3">
              <h2 className="text-h2 text-balance">See it with your own market.</h2>
              <p className="text-body-lg opacity-90">
                Create a workspace and run a first discovery job against the sources enabled for it.
              </p>
            </div>
            <Button
              asChild
              size="xl"
              className="bg-inverse-primary text-inverse-surface w-full min-[400px]:w-auto"
            >
              <Link href="/sign-up">
                Create your workspace
                <ArrowRight aria-hidden />
              </Link>
            </Button>
          </div>
        </div>
      </section>
    </>
  );
}
