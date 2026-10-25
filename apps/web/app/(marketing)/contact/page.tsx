import type { Metadata } from "next";
import { ContactForm } from "@/components/marketing/contact-form";

export const metadata: Metadata = {
  title: "Contact",
  description:
    "Contact the LeadForge team about the product, early access, partnerships or data requests.",
};

export default function ContactPage() {
  return (
    <div className="container-marketing py-14 md:py-20">
      <div className="grid min-w-0 grid-cols-1 gap-10 lg:grid-cols-[1fr_1.4fr]">
        <div>
          <p className="text-primary text-xs font-semibold uppercase tracking-wider">Contact</p>
          <h1 className="text-h1 mt-2 font-semibold tracking-tight">Talk to us.</h1>
          <p className="text-body-lg text-muted-foreground mt-4">
            Questions about the product, early access, sources for your market, or anything else. If
            you represent a business and want a record corrected or removed, use the data request
            form on our{" "}
            <a
              href="/legal/data-collection#requests"
              className="text-primary underline underline-offset-4"
            >
              data collection page
            </a>
            .
          </p>
        </div>
        <div className="border-border bg-surface min-w-0 rounded-lg border p-5 md:p-8">
          <ContactForm />
        </div>
      </div>
    </div>
  );
}
