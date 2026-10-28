import type { Metadata } from "next";
import Link from "next/link";
import { FileWarning, Mail, Map } from "lucide-react";
import { ContactForm } from "@/components/marketing/contact-form";
import { Eyebrow } from "@/components/marketing/section";

export const metadata: Metadata = {
  title: "Contact",
  description:
    "Contact the LeadForge team about the product, early access, partnerships or data requests.",
};

export default function ContactPage() {
  return (
    <div className="container-marketing py-12 sm:py-20 lg:py-24">
      <div className="grid min-w-0 grid-cols-1 gap-10 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:gap-16">
        <div className="flex min-w-0 flex-col gap-5">
          <Eyebrow>Contact</Eyebrow>
          <h1 className="text-h1 text-balance">Talk to us.</h1>
          <p className="text-body-lg text-muted-foreground">
            Questions about the product, early access, sources for your market, or anything else. We
            read every message and reply by email.
          </p>
          <ul className="mt-4 flex flex-col gap-3">
            {[
              {
                icon: Mail,
                title: "Product and early access",
                body: "Use the form; it goes straight to the team.",
              },
              {
                icon: Map,
                title: "Sources for your market",
                body: "Tell us the country and industries you need.",
              },
            ].map((item) => (
              <li
                key={item.title}
                className="bg-surface-container-low flex min-w-0 items-start gap-4 rounded-2xl p-4"
              >
                <span className="bg-surface text-primary flex size-10 shrink-0 items-center justify-center rounded-full">
                  <item.icon aria-hidden className="size-5" />
                </span>
                <span className="min-w-0">
                  <span className="block font-medium">{item.title}</span>
                  <span className="text-muted-foreground block text-sm">{item.body}</span>
                </span>
              </li>
            ))}
            <li className="bg-surface-container-low flex min-w-0 items-start gap-4 rounded-2xl p-4">
              <span className="bg-surface text-primary flex size-10 shrink-0 items-center justify-center rounded-full">
                <FileWarning aria-hidden className="size-5" />
              </span>
              <span className="min-w-0">
                <span className="block font-medium">Correction or removal of a business</span>
                <span className="text-muted-foreground block text-sm">
                  Use the request form on our{" "}
                  <Link
                    href="/legal/data-collection#requests"
                    className="text-primary underline underline-offset-4"
                  >
                    data collection page
                  </Link>
                  .
                </span>
              </span>
            </li>
          </ul>
        </div>
        <div className="bg-surface-container-low min-w-0 rounded-[28px] p-5 [--field-bg:var(--surface-container-low)] sm:p-8 lg:p-10">
          <ContactForm />
        </div>
      </div>
    </div>
  );
}
