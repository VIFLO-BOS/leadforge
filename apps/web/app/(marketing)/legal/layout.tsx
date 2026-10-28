import { Banner } from "@leadforge/ui";
import { LegalNav } from "@/components/marketing/legal-nav";

export default function LegalLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      {/* Reading progress: CSS scroll-driven (progressive enhancement), hidden when unsupported. */}
      <div
        aria-hidden
        className="sda-progress bg-primary pointer-events-none fixed inset-x-0 top-0 z-50 h-[3px]"
      />
      <div className="container-marketing py-10 sm:py-16">
        <div className="grid min-w-0 grid-cols-1 gap-8 lg:grid-cols-[240px_minmax(0,1fr)] lg:gap-16">
          <aside className="min-w-0 lg:sticky lg:top-24 lg:self-start">
            <LegalNav />
          </aside>
          <div className="min-w-0 max-w-3xl">
            <Banner
              tone="warning"
              role="note"
              className="mb-8"
              title="Draft, pending legal review"
              description="This page describes how LeadForge works today. A lawyer has not reviewed it yet, and items in brackets are placeholders for company details that must be completed before launch. Last updated 27 October 2026."
              data-testid="legal-draft-notice"
            />
            <article className="prose-legal min-w-0">{children}</article>
          </div>
        </div>
      </div>
    </>
  );
}
