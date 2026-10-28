import Link from "next/link";
import {
  ArrowRight,
  Ban,
  CalendarX2,
  Database,
  FileSearch,
  FileUp,
  Globe,
  Lock,
  Mail,
  MessageCircle,
  MonitorSmartphone,
  Phone,
  ScrollText,
  SearchX,
  ShieldOff,
  ShoppingCart,
  Smartphone,
  Tags,
} from "lucide-react";
import { Button, Stagger, StaggerItem } from "@leadforge/ui";
import { Carousel } from "@/components/marketing/carousel";
import { Faq } from "@/components/marketing/faq";
import { FeatureTabs } from "@/components/marketing/feature-tabs";
import { HeroCopy, HeroShowcase } from "@/components/marketing/hero-showcase";
import { JumpLinkBar } from "@/components/marketing/jump-link-bar";
import {
  AuditMock,
  ContactFieldMock,
  IsolationMock,
  JobProgressMock,
  JobWizardMock,
  MockFigure,
  PipelineMock,
  ProvenanceMock,
  ScoreBreakdownMock,
} from "@/components/marketing/mocks";
import { ParallaxMediaCard } from "@/components/marketing/parallax-card";
import { PricingPlans } from "@/components/marketing/pricing-preview";
import { Scrollytelling } from "@/components/marketing/scrollytelling";
import { Eyebrow, Section, SectionHeader } from "@/components/marketing/section";

const JUMP_LINKS = [
  { id: "discovery", label: "Discovery" },
  { id: "enrichment", label: "Enrichment" },
  { id: "qualification", label: "Qualification" },
  { id: "workflow", label: "Workflow" },
  { id: "sources", label: "Sources" },
  { id: "security", label: "Security" },
  { id: "pricing", label: "Pricing" },
  { id: "faq", label: "FAQ" },
];

const DETECTIONS = [
  {
    icon: Globe,
    title: "No reachable website was detected",
    body: "DNS failure, timeout, or an error status after retries. Recorded with the last attempt time.",
    evidence: "Timed out after 10s on 3 attempts",
  },
  {
    icon: Smartphone,
    title: "Not-mobile-friendly indicators",
    body: "A missing viewport meta tag, fixed-width layout hints or tiny font declarations.",
    evidence: "No <meta name=viewport> on /",
  },
  {
    icon: Mail,
    title: "No observable contact form",
    body: "No form with email or message fields on the home or contact pages that were read.",
    evidence: "Checked / and /contact",
  },
  {
    icon: CalendarX2,
    title: "No observable booking flow",
    body: "No booking keywords, links or widgets were found on the pages analysed.",
    evidence: "0 booking patterns on 4 pages",
  },
  {
    icon: ShoppingCart,
    title: "No observable online ordering",
    body: "No cart, order or menu-ordering patterns were detected.",
    evidence: "0 cart or order patterns",
  },
  {
    icon: MessageCircle,
    title: "No observable WhatsApp link",
    body: "No wa.me or WhatsApp link on the business's own pages. We never infer one from a phone number.",
    evidence: "0 wa.me links found",
  },
  {
    icon: ShieldOff,
    title: "No HTTPS or an invalid certificate",
    body: "The site answered over plain HTTP, or its certificate did not validate.",
    evidence: "Served over http://",
  },
  {
    icon: MonitorSmartphone,
    title: "Outdated platform indicators",
    body: "A generator tag for a very old CMS version, reported as the observed version string only.",
    evidence: "generator: CMS 3.x",
  },
  {
    icon: Tags,
    title: "Missing basic SEO metadata",
    body: "No page title or meta description on the home page.",
    evidence: "No meta description on /",
  },
];

export default function HomePage() {
  return (
    <>
      {/* Hero. The text is server-rendered and never animated, so it paints without JS. */}
      <section className="relative overflow-x-clip">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-[38%] -z-10 mx-auto h-[70%] max-w-6xl rounded-full bg-[radial-gradient(closest-side,var(--primary-container),transparent)] opacity-60 blur-3xl dark:opacity-25"
        />
        <HeroCopy className="container-marketing flex flex-col items-center pb-12 pt-10 text-center sm:pb-16 sm:pt-20 lg:pt-24">
          <p className="bg-surface-container-high text-foreground mb-6 inline-flex max-w-full items-center gap-2 rounded-full px-3.5 py-1.5 text-[13px] font-medium sm:mb-8">
            <span aria-hidden className="bg-primary size-1.5 shrink-0 rounded-full" />
            <span className="break-anywhere">
              Business discovery with provenance.
              <span className="hidden sm:inline"> Built first for Nigeria.</span>
            </span>
          </p>
          <h1 className="text-display max-w-4xl text-balance">
            Find the businesses <span className="text-primary">worth your next conversation.</span>
          </h1>
          <p className="text-lead text-muted-foreground mt-5 max-w-2xl sm:mt-6">
            LeadForge discovers businesses through permitted sources, verifies the public contact
            details it finds, shows you where every field came from, and helps your team work the
            leads that fit.
          </p>
          <div className="mt-8 flex w-full flex-col items-stretch gap-3 min-[400px]:w-auto min-[400px]:flex-row min-[400px]:items-center">
            <Button asChild size="lg">
              <Link href="/sign-up">
                Get started
                <ArrowRight aria-hidden />
              </Link>
            </Button>
            <Button asChild size="lg" variant="tonal">
              <Link href="/product">Explore the product</Link>
            </Button>
          </div>
        </HeroCopy>
        <div className="container-marketing pb-16 sm:pb-24">
          <HeroShowcase />
        </div>
      </section>

      <JumpLinkBar items={JUMP_LINKS} />

      {/* Discovery */}
      <section id="discovery" aria-labelledby="discovery-title" className="py-16 sm:py-24 lg:py-32">
        <div className="container-marketing grid min-w-0 grid-cols-1 items-center gap-12 lg:grid-cols-2 lg:gap-20">
          <div className="flex min-w-0 flex-col gap-8">
            <SectionHeader
              id="discovery"
              eyebrow="Business discovery"
              title={
                <>
                  Discover businesses{" "}
                  <span className="text-muted-foreground">
                    through sources you are allowed to use.
                  </span>
                </>
              }
              description="Create a discovery job for a location and industry. LeadForge queries only reviewed, permitted sources, respects their rate limits and retention rules, and records what each one returned."
            />
            <Stagger as="ul" className="flex flex-col gap-5">
              {[
                [
                  "Targeted jobs",
                  "Pick a city, a category and a record limit. See the credit estimate before anything runs.",
                ],
                [
                  "Documented source adapters",
                  "Each source has a contract: method, pagination, limits and retention policy.",
                ],
                [
                  "Transparent results",
                  "Created, updated, duplicate and failed records per source, with retry for what failed.",
                ],
              ].map(([title, body]) => (
                <StaggerItem
                  as="li"
                  key={title}
                  className="border-primary flex flex-col gap-1 border-l-2 pl-5"
                >
                  <h3 className="text-title">{title}</h3>
                  <p className="text-muted-foreground text-sm leading-relaxed">{body}</p>
                </StaggerItem>
              ))}
            </Stagger>
          </div>
          <div className="sda-fade-scale bg-surface-container-high/70 dark:bg-surface-container min-w-0 rounded-[24px] p-1.5 sm:rounded-[32px] sm:p-2.5">
            <MockFigure
              caption="Illustration of the discovery job form with a credit estimate. All values are sample data."
              frameClassName="bg-surface overflow-hidden rounded-[18px] sm:rounded-[24px]"
            >
              <JobWizardMock />
            </MockFigure>
          </div>
        </div>
      </section>

      {/* Enrichment: tabbed feature switcher */}
      <Section
        id="enrichment"
        tone="tint"
        headerAlign="center"
        eyebrow="Contact enrichment"
        title={
          <>
            Contact details with a verification status,{" "}
            <span className="text-muted-foreground">not a guess.</span>
          </>
        }
        description="Phones are parsed country-aware, emails are checked for syntax and mail servers, and WhatsApp is marked only with explicit evidence. Anything we cannot verify stays labelled unverified."
      >
        <FeatureTabs
          label="Contact field types"
          tabs={[
            {
              id: "phone",
              label: "Phones",
              icon: <Phone aria-hidden />,
              title: "Country-aware phone numbers",
              body: "Numbers are normalized with Nigerian formats in mind, and the raw observed value is kept beside the normalized one.",
              points: [
                "Verified only when valid and observed on the business's own site",
                "Conflicts between sources are shown, never silently resolved",
              ],
              visual: (
                <MockFigure caption="Illustration of a verified phone field with its source. Sample data.">
                  <ContactFieldMock kind="phone" />
                </MockFigure>
              ),
            },
            {
              id: "email",
              label: "Emails",
              icon: <Mail aria-hidden />,
              title: "Emails checked, not assumed",
              body: "Syntax, mail-server (MX) and disposable-domain checks. A passing check is shown as exactly that, nothing more.",
              points: [
                "Release 1 does syntax, MX and disposable checks",
                "Unconfirmed mailboxes stay unverified",
              ],
              visual: (
                <MockFigure caption="Illustration of an unverified email field with its checks. Sample data.">
                  <ContactFieldMock kind="email" />
                </MockFigure>
              ),
            },
            {
              id: "website",
              label: "Websites",
              icon: <Globe aria-hidden />,
              title: "Websites canonicalized and kept fresh",
              body: "Domains are canonicalized, and every field ages into stale once it passes your workspace's freshness window.",
              points: ["Freshness window set per workspace", "Refresh from the original source"],
              visual: (
                <MockFigure caption="Illustration of a stale website field. Sample data.">
                  <ContactFieldMock kind="website" />
                </MockFigure>
              ),
            },
            {
              id: "whatsapp",
              label: "WhatsApp",
              icon: <MessageCircle aria-hidden />,
              title: "WhatsApp only with evidence",
              body: "Confirmed only from an explicit wa.me link or label on the business's own site, or when a teammate confirms it after contact. There is no “probably”.",
              points: [
                "Three values only: confirmed, user asserted, unknown",
                "Never inferred from a phone number",
              ],
              visual: (
                <MockFigure caption="Illustration of a confirmed WhatsApp field with its evidence. Sample data.">
                  <ContactFieldMock kind="whatsapp" />
                </MockFigure>
              ),
            },
          ]}
        />
      </Section>

      {/* Qualification + detections carousel */}
      <section
        id="qualification"
        aria-labelledby="qualification-title"
        className="py-16 sm:py-24 lg:py-32"
      >
        <div className="container-marketing flex flex-col gap-16 sm:gap-24">
          <div className="grid min-w-0 grid-cols-1 items-center gap-12 lg:grid-cols-2 lg:gap-20">
            <div className="sda-fade-scale bg-surface-container-high/70 dark:bg-surface-container order-2 min-w-0 rounded-[24px] p-1.5 sm:rounded-[32px] sm:p-2.5 lg:order-1">
              <MockFigure
                caption="Illustration of a fit score broken down signal by signal. Sample data."
                frameClassName="bg-surface overflow-hidden rounded-[18px] sm:rounded-[24px]"
              >
                <ScoreBreakdownMock />
              </MockFigure>
            </div>
            <div className="order-1 flex min-w-0 flex-col gap-8 lg:order-2">
              <SectionHeader
                id="qualification"
                eyebrow="Lead qualification"
                title={
                  <>
                    Scores you can explain{" "}
                    <span className="text-muted-foreground">to your team.</span>
                  </>
                }
                description="A fit score built from weights you set: contact completeness, verification, website opportunities, industry and location. Shown as a breakdown, kept separate from data confidence, and never presented as purchase intent."
              />
            </div>
          </div>
          <div className="flex min-w-0 flex-col gap-8">
            <div className="flex max-w-3xl flex-col gap-3">
              <Eyebrow>Website analysis</Eyebrow>
              <h3 className="text-h3">
                Observed facts about a public website, each with evidence.
              </h3>
              <p className="text-muted-foreground text-sm leading-relaxed">
                A sandboxed fetcher reads a handful of public pages, respects robots directives and
                never runs scripts. It reports what it could not find as &ldquo;not detected&rdquo;,
                because a missed detection is not proof that something does not exist.
              </p>
            </div>
            <Carousel
              label="What website analysis can detect"
              slides={DETECTIONS.map((d) => ({
                id: d.title,
                content: (
                  <article className="bg-surface-container-low flex w-full min-w-0 flex-col gap-4 rounded-[28px] p-6 sm:p-7">
                    <span className="bg-primary-container text-primary-container-foreground flex size-12 items-center justify-center rounded-2xl">
                      <d.icon aria-hidden className="size-6" />
                    </span>
                    <h4 className="text-h4">{d.title}</h4>
                    <p className="text-muted-foreground text-sm leading-relaxed">{d.body}</p>
                    <p className="border-border mt-auto flex min-w-0 items-center gap-2 border-t pt-4 text-[13px]">
                      <SearchX aria-hidden className="text-muted-foreground size-4 shrink-0" />
                      <span className="break-anywhere min-w-0">
                        Evidence: <span className="font-mono">{d.evidence}</span> (Sample)
                      </span>
                    </p>
                  </article>
                ),
              }))}
            />
          </div>
        </div>
      </section>

      {/* Workflow: pinned scrollytelling */}
      <Section
        id="workflow"
        tone="tint"
        eyebrow="Workflow"
        title={
          <>
            From a discovery job{" "}
            <span className="text-muted-foreground">to a worked pipeline.</span>
          </>
        }
        description="Four steps, one data model, and a provenance trail that follows every record through them."
      >
        <Scrollytelling
          label="LeadForge workflow"
          steps={[
            {
              id: "create",
              title: "Create a job",
              body: "Choose a location, an industry, the sources to query and a record limit. The credit estimate is shown before anything runs.",
              visual: (
                <MockFigure caption="Illustration of creating a discovery job. Sample data.">
                  <JobWizardMock />
                </MockFigure>
              ),
            },
            {
              id: "review",
              title: "Review results",
              body: "Watch the job run with per-source outcomes. Inspect records, provenance and duplicates, and retry only what failed.",
              visual: (
                <MockFigure caption="Illustration of a running discovery job with per-source outcomes. Sample data.">
                  <JobProgressMock />
                </MockFigure>
              ),
            },
            {
              id: "qualify",
              title: "Qualify",
              body: "Run website analysis, read the score breakdown and build lead lists from the businesses that fit your criteria.",
              visual: (
                <MockFigure caption="Illustration of a fit score breakdown. Sample data.">
                  <ScoreBreakdownMock />
                </MockFigure>
              ),
            },
            {
              id: "work",
              title: "Work the pipeline",
              body: "Assign owners, move leads through stages, log calls and WhatsApp outreach, and export authorized records.",
              visual: (
                <MockFigure caption="Illustration of the lead pipeline board. Sample data.">
                  <PipelineMock />
                </MockFigure>
              ),
            },
          ]}
        />
      </Section>

      {/* Sources and honest coverage */}
      <section id="sources" aria-labelledby="sources-title" className="py-16 sm:py-24 lg:py-32">
        <div className="container-marketing flex flex-col gap-12">
          <SectionHeader
            id="sources"
            eyebrow="Sources and coverage"
            title={
              <>
                A short list of reviewed sources,{" "}
                <span className="text-muted-foreground">not universal scraping.</span>
              </>
            }
            description="Sources are added one at a time after a review of their terms, access rules and retention requirements. Your workspace shows which sources are enabled and what each one can and cannot provide."
          />
          <div className="grid min-w-0 grid-cols-1 gap-4 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]">
            <div className="bg-surface-container-low flex min-w-0 flex-col gap-6 rounded-[28px] p-6 sm:p-10">
              <h3 className="text-h3">What the first release uses</h3>
              <Stagger as="ul" className="grid min-w-0 grid-cols-1 gap-4 sm:grid-cols-3">
                {[
                  {
                    icon: Database,
                    title: "An official places API",
                    body: "For discovery, within its terms, quotas and retention rules.",
                  },
                  {
                    icon: Globe,
                    title: "The business's own website",
                    body: "For enrichment, read within robots directives.",
                  },
                  {
                    icon: FileUp,
                    title: "Your CSV imports",
                    body: "Recorded as a user-supplied source with full provenance.",
                  },
                ].map((s) => (
                  <StaggerItem
                    as="li"
                    key={s.title}
                    className="bg-surface flex min-w-0 flex-col gap-3 rounded-2xl p-5"
                  >
                    <s.icon aria-hidden className="text-primary size-6" />
                    <p className="font-medium">{s.title}</p>
                    <p className="text-muted-foreground text-sm leading-relaxed">{s.body}</p>
                  </StaggerItem>
                ))}
              </Stagger>
              <p className="text-muted-foreground text-sm leading-relaxed">
                Each source is documented on the Sources page of your workspace with its coverage
                notes and limits.
              </p>
            </div>
            <div className="bg-inverse-surface text-inverse-foreground flex min-w-0 flex-col gap-6 rounded-[28px] p-6 sm:p-10">
              <h3 className="text-h3">An honest coverage statement</h3>
              <p className="text-base leading-relaxed">
                LeadForge does not find every business. Coverage depends on the sources enabled for
                your workspace, and every screen that shows discovered data shows which sources were
                used and when.
              </p>
              <ul className="flex flex-col gap-3 text-sm">
                {[
                  "No bypassing logins, CAPTCHAs or rate limits",
                  "No collection from social networks or marketplaces",
                  "No invented or inferred contact details",
                ].map((line) => (
                  <li key={line} className="flex items-start gap-3">
                    <Ban aria-hidden className="text-inverse-primary mt-0.5 size-4 shrink-0" />
                    {line}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </section>

      {/* Security and provenance: parallax media cards */}
      <Section
        id="security"
        tone="tint"
        eyebrow="Security and provenance"
        title={
          <>
            Built so you can show{" "}
            <span className="text-muted-foreground">where every value came from.</span>
          </>
        }
        description="Organization isolation on every request, job and export. Role-based access. Audit logs for sensitive actions. Website analysis runs in a sandboxed fetcher that refuses private networks."
      >
        <ul className="grid min-w-0 grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3 lg:gap-6">
          <li className="min-w-0">
            <ParallaxMediaCard
              tone="primary"
              eyebrow="Provenance"
              title="Every field shows its origin"
              body="Source, URL, collection date, verification method and confidence are stored for every value and shown beside it."
              media={
                <MockFigure caption="Illustration of a field provenance trail. Sample data.">
                  <ProvenanceMock className="shadow-none" />
                </MockFigure>
              }
            />
          </li>
          <li className="min-w-0">
            <ParallaxMediaCard
              tone="tertiary"
              eyebrow="Tenant isolation"
              title="Organizations never see each other"
              body="Every record carries its organization. Cross-organization access is blocked at the data layer and covered by tests."
              media={
                <MockFigure caption="Illustration of two isolated workspaces. Sample data.">
                  <IsolationMock />
                </MockFigure>
              }
            />
          </li>
          <li className="min-w-0 md:col-span-2 lg:col-span-1">
            <ParallaxMediaCard
              tone="neutral"
              eyebrow="Accountability"
              title="Audit, correction and removal"
              body="Sensitive actions are audit logged. Businesses can request corrections or removal, and suppressed records are excluded from discovery and export."
              media={
                <MockFigure caption="Illustration of an audit log. Sample data.">
                  <AuditMock />
                </MockFigure>
              }
            />
          </li>
        </ul>
        <div className="mt-6 flex flex-wrap gap-x-6 gap-y-3 text-sm">
          {[
            { icon: Lock, label: "Role-based access for five roles" },
            { icon: ScrollText, label: "Audit logs for sensitive actions" },
            { icon: FileSearch, label: "Robots-aware, sandboxed website fetching" },
          ].map((f) => (
            <span key={f.label} className="text-muted-foreground inline-flex items-center gap-2">
              <f.icon aria-hidden className="text-primary size-4" />
              {f.label}
            </span>
          ))}
        </div>
      </Section>

      {/* Pricing preview from live plans */}
      <Section
        id="pricing"
        eyebrow="Pricing"
        title={
          <>
            Plans and credits,{" "}
            <span className="text-muted-foreground">published when they are final.</span>
          </>
        }
        description="Prices come from the billing system, not from this page."
      >
        <PricingPlans compact />
        <div className="mt-8">
          <Button asChild variant="text" size="lg" className="-ml-4">
            <Link href="/pricing">
              See full pricing details
              <ArrowRight aria-hidden />
            </Link>
          </Button>
        </div>
      </Section>

      <Section
        id="faq"
        tone="tint"
        headerAlign="center"
        eyebrow="FAQ"
        title="Questions we get asked."
      >
        <Faq />
      </Section>

      {/* Final CTA */}
      <section className="py-16 sm:py-24 lg:py-32">
        <div className="container-marketing">
          <div className="bg-primary-container text-primary-container-foreground relative overflow-hidden rounded-[32px] px-6 py-14 text-center sm:rounded-[48px] sm:px-12 sm:py-24">
            <div className="relative mx-auto flex max-w-3xl flex-col items-center gap-6">
              <h2 className="text-h2 text-balance">Start with your first discovery job.</h2>
              <p className="text-body-lg max-w-xl opacity-90">
                Create a workspace, invite your team and see exactly what each source returns.
              </p>
              <div className="mt-2 flex w-full flex-col items-stretch gap-3 min-[400px]:w-auto min-[400px]:flex-row">
                <Button asChild size="xl">
                  <Link href="/sign-up">Create your workspace</Link>
                </Button>
                <Button
                  asChild
                  size="xl"
                  variant="outline"
                  className="border-primary-container-foreground/40 text-primary-container-foreground"
                >
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
