import Link from "next/link";
import {
  ArrowRight,
  Database,
  FileSearch,
  Fingerprint,
  Globe,
  ListChecks,
  Lock,
  Phone,
  ShieldCheck,
  Target,
} from "lucide-react";
import { Button, FadeIn } from "@leadforge/ui";
import { Faq } from "@/components/marketing/faq";
import { InterfacePreview } from "@/components/marketing/interface-preview";
import { PricingPlans } from "@/components/marketing/pricing-preview";
import { FeatureGrid, Section } from "@/components/marketing/section";

export default function HomePage() {
  return (
    <>
      <section className="bg-glow relative overflow-hidden">
        <div
          aria-hidden
          className="bg-grid pointer-events-none absolute inset-0 [mask-image:radial-gradient(60%_60%_at_50%_0%,black,transparent)]"
        />
        <div className="container-marketing relative flex flex-col items-center gap-8 py-16 text-center md:py-24">
          <FadeIn>
            <p className="border-border bg-surface text-muted-foreground mb-4 inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-medium">
              <span className="bg-primary size-1.5 rounded-full" aria-hidden />
              Business discovery for Nigeria, with provenance
            </p>
            <h1 className="break-anywhere text-display font-semibold tracking-tight">
              Find the businesses worth your next conversation.
            </h1>
          </FadeIn>
          <FadeIn delay={0.08}>
            <p className="text-body-lg text-muted-foreground mx-auto max-w-2xl">
              LeadForge discovers businesses through permitted sources, verifies the public contact
              details it finds, shows you where every field came from, and helps your team work the
              leads that fit.
            </p>
          </FadeIn>
          <FadeIn
            delay={0.14}
            className="flex w-full flex-col items-stretch gap-3 min-[360px]:w-auto min-[360px]:flex-row"
          >
            <Button asChild size="lg">
              <Link href="/sign-up">
                Get started
                <ArrowRight aria-hidden />
              </Link>
            </Button>
            <Button asChild size="lg" variant="outline">
              <Link href="/product">Explore the product</Link>
            </Button>
          </FadeIn>
          <FadeIn delay={0.2} className="w-full max-w-5xl">
            <InterfacePreview />
          </FadeIn>
        </div>
      </section>

      <Section
        id="discovery"
        eyebrow="Business discovery"
        title="Discover businesses through sources you are allowed to use."
        description="Create a discovery job for a location and industry. LeadForge queries only reviewed, permitted sources, respects their rate limits and retention rules, and records what each one returned."
      >
        <FeatureGrid
          items={[
            {
              icon: <Target />,
              title: "Targeted jobs",
              body: "Pick a city, a category and a record limit. Preview the cost before anything runs.",
            },
            {
              icon: <Database />,
              title: "Source adapters",
              body: "Each source has a documented contract: method, pagination, limits and retention policy.",
            },
            {
              icon: <ListChecks />,
              title: "Transparent results",
              body: "See created, updated, duplicate and failed records per source, with retry for what failed.",
            },
          ]}
        />
      </Section>

      <Section
        id="enrichment"
        tone="surface"
        eyebrow="Contact enrichment"
        title="Contact details with a verification status, not a guess."
        description="Phones are parsed country-aware. Emails are checked for syntax and mail servers. WhatsApp is marked only with explicit evidence. Anything we cannot verify stays labelled unverified."
      >
        <FeatureGrid
          items={[
            {
              icon: <Phone />,
              title: "Field-level states",
              body: "Verified, unverified, stale, expired, missing or conflicting. Every contact field carries one.",
            },
            {
              icon: <Fingerprint />,
              title: "Provenance on every field",
              body: "Source, URL, collection date, verification method and confidence are stored and shown.",
            },
            {
              icon: <Globe />,
              title: "Website enrichment",
              body: "The business's own public site is read for contact pages, mailto and tel links and WhatsApp links.",
            },
          ]}
        />
      </Section>

      <Section
        id="qualification"
        eyebrow="Lead qualification"
        title="Scores you can explain to your team."
        description="A fit score built from weights you set: contact completeness, verification, website opportunities, industry and location. Shown as a breakdown, kept separate from data confidence, and never presented as purchase intent."
      >
        <FeatureGrid
          items={[
            {
              icon: <FileSearch />,
              title: "Website analysis",
              body: "Detects what can be observed: no contact form found, no booking flow found, no HTTPS. Each with evidence.",
            },
            {
              icon: <Target />,
              title: "Configurable criteria",
              body: "Define your ideal customer profile per workspace and reweight the score whenever it changes.",
            },
            {
              icon: <ListChecks />,
              title: "Pipeline and activities",
              body: "Move leads through stages, assign owners, log calls and WhatsApp outreach.",
            },
          ]}
        />
      </Section>

      <Section
        id="workflow"
        tone="surface"
        eyebrow="Workflow"
        title="From a discovery job to a worked pipeline."
      >
        <ol className="grid min-w-0 grid-cols-1 gap-4 md:grid-cols-4">
          {[
            ["Create a job", "Choose location, industry, sources and a record limit."],
            [
              "Review results",
              "Inspect records, provenance and duplicates. Merge or dismiss candidates.",
            ],
            ["Qualify", "Run website analysis, review the score breakdown, build lead lists."],
            ["Work the pipeline", "Assign, contact, log activities and export authorized records."],
          ].map(([title, body], i) => (
            <li key={title} className="border-border bg-background min-w-0 rounded-lg border p-5">
              <p className="text-muted-foreground font-mono text-xs">0{i + 1}</p>
              <h3 className="mt-2 text-base font-semibold">{title}</h3>
              <p className="text-muted-foreground mt-1 text-sm">{body}</p>
            </li>
          ))}
        </ol>
      </Section>

      <Section
        id="sources"
        eyebrow="Supported sources"
        title="A short list of reviewed sources, not universal scraping."
        description="Sources are added one at a time after a review of their terms, access rules and retention requirements. Your workspace shows which sources are enabled and what each one can and cannot provide. We do not bypass logins, CAPTCHAs or rate limits, and we do not collect from social networks or marketplaces."
      >
        <div className="border-border bg-surface text-muted-foreground rounded-lg border p-5 text-sm">
          <p>
            The first release launches with a small number of sources: an official places API for
            discovery, the business&apos;s own public website for enrichment, and your own CSV
            imports. Each one is documented in the Sources page of your workspace with its coverage
            notes and limits.
          </p>
        </div>
      </Section>

      <Section
        id="security"
        tone="surface"
        eyebrow="Security and provenance"
        title="Built so you can show where every value came from."
        description="Organization isolation on every request, job and export. Role-based access. Audit logs for sensitive actions. Website analysis runs in a sandboxed fetcher that refuses private networks. Suppression lists and removal requests are honored across the platform."
      >
        <FeatureGrid
          items={[
            {
              icon: <Lock />,
              title: "Tenant isolation",
              body: "Every record carries its organization. Cross-organization access is blocked at the data layer and tested.",
            },
            {
              icon: <ShieldCheck />,
              title: "Verified billing",
              body: "Payments are confirmed with the provider before any entitlement is granted. Duplicate webhooks cannot grant twice.",
            },
            {
              icon: <Fingerprint />,
              title: "Correction and removal",
              body: "Businesses can request corrections or removal. Suppressed records are excluded from discovery and export.",
            },
          ]}
        />
      </Section>

      <Section
        id="pricing"
        eyebrow="Pricing"
        title="Plans and credits, published when they are final."
        description="Prices come from the billing system, not from this page."
      >
        <PricingPlans compact />
        <div className="mt-6">
          <Button asChild variant="link">
            <Link href="/pricing">
              See full pricing details
              <ArrowRight aria-hidden />
            </Link>
          </Button>
        </div>
      </Section>

      <Section id="faq" tone="surface" eyebrow="FAQ" title="Questions we get asked.">
        <Faq />
      </Section>

      <section className="py-16 md:py-24">
        <div className="container-marketing">
          <div className="border-border bg-surface relative overflow-hidden rounded-lg border p-8 text-center md:p-14">
            <div aria-hidden className="bg-glow pointer-events-none absolute inset-0 opacity-70" />
            <div className="relative">
              <h2 className="text-h2 font-semibold tracking-tight">
                Start with your first discovery job.
              </h2>
              <p className="text-body-lg text-muted-foreground mx-auto mt-3 max-w-xl">
                Create a workspace, invite your team and see exactly what each source returns.
              </p>
              <div className="mt-6 flex flex-col items-stretch justify-center gap-3 min-[360px]:flex-row">
                <Button asChild size="lg">
                  <Link href="/sign-up">Create your workspace</Link>
                </Button>
                <Button asChild size="lg" variant="outline">
                  <Link href="/contact">Talk to us</Link>
                </Button>
              </div>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
