import type { Metadata } from "next";
import { LegalPlaceholder } from "@/components/marketing/legal-placeholder";

export const metadata: Metadata = {
  title: "Terms of Service",
  description:
    "The terms for using LeadForge: the service, credits, payments through Paystack, data licences and accounts.",
};

/*
 * Describes the product as built (docs/SECURITY_AND_DATA_COLLECTION.md sections 2, 6 and 8;
 * docs/DATABASE_DESIGN.md sections 5 and 7). Company details and legal choices the operator has not
 * made yet are placeholders.
 */
export default function TermsPage() {
  return (
    <>
      <h1 className="text-h1 mb-6 text-balance">Terms of Service</h1>
      <p>
        These terms govern your use of LeadForge, provided by{" "}
        <LegalPlaceholder>legal entity name</LegalPlaceholder>. By creating an account you agree to
        them for yourself and, where you act for one, for your organization.
      </p>

      <h2>The service</h2>
      <p>
        LeadForge finds businesses in an open dataset (Overture Maps Places), analyzes their public
        websites, collects contact details from those websites, scores leads and helps your team
        manage them in lists and a pipeline. Coverage depends on what the sources contain. LeadForge
        does not promise that any list is complete or that any contact detail is current: every
        value shows its source, its collection date and whether it was verified. Google Places is
        not used, because its terms do not allow storing business details in a directory.
      </p>

      <h2>Accounts and organizations</h2>
      <p>
        You must verify your email address before using a workspace. You are responsible for
        activity under your credentials. Owners and administrators are responsible for the members
        they invite and the roles they give them; what each role may do is enforced by
        LeadForge&apos;s servers. The number of members, export rows and included credits depends on
        your plan, or on the free tier without one.
      </p>

      <h2>Credits</h2>
      <ul>
        <li>
          A discovery job holds 1 credit for each record it may produce when it is queued. When it
          finishes, it charges 1 credit for each new business, or existing business that gained new
          details, and returns the rest. Records that fail on our side are not charged and can be
          retried.
        </li>
        <li>
          A website analysis holds 1 credit, charged when the analysis completes and returned if it
          fails. Collecting contacts from a website and checking email addresses are free.
        </li>
        <li>The Usage page lists every credit movement.</li>
      </ul>

      <h2>Payments</h2>
      <ul>
        <li>
          Payments are processed by Paystack. You pay on Paystack&apos;s page; LeadForge never sees
          your card number.
        </li>
        <li>
          Credits and plans are added only after Paystack confirms the payment to LeadForge&apos;s
          server, never on the strength of a redirect alone. A payment that cannot be confirmed adds
          nothing.
        </li>
        <li>
          Prices come from LeadForge&apos;s servers and are shown in the application. While pricing
          has not been published, the application says so and nothing can be bought with live keys.
        </li>
        <li>
          Subscriptions renew each month or year until cancelled. A cancellation takes effect at the
          end of the paid period. If a renewal payment fails, the plan ends 7 days later unless a
          payment succeeds.
        </li>
        <li>
          If a payment is refunded, the credits it bought are taken back; a balance below zero
          pauses new discovery jobs and website analyses until credits are bought. Refunds are
          requested by the organization&apos;s owner.{" "}
          <LegalPlaceholder>refund policy</LegalPlaceholder>
        </li>
      </ul>

      <h2>Data licences</h2>
      <p>
        Business data from Overture Maps Places is shared under open licences (mainly CDLA
        Permissive 2.0, with Apache 2.0 and CC0 1.0 for some records). Exports include the
        attribution and the licence texts. When you share exported data, keep the attribution and
        the licence texts with it, as those licences require. Details are on the{" "}
        <a href="/legal/data-sources">Data sources and licences</a> page.
      </p>

      <h2>Acceptable use and data you import</h2>
      <p>
        You must use LeadForge and the data from it lawfully, including data protection, marketing
        and anti-spam laws. The <a href="/legal/acceptable-use">Acceptable Use Policy</a> forms part
        of these terms. When you import data you confirm that you have a lawful basis to hold and
        process it; imported values are recorded with your import as their source.
      </p>

      <h2>Ending the service</h2>
      <p>
        An organization owner can download the organization&apos;s data at any time, and can delete
        the organization, in Settings, Organization. A deletion is confirmed with the
        organization&apos;s name and the owner&apos;s password and takes effect after a 14-day grace
        period, during which any owner can cancel it and new discovery, analysis, imports, purchases
        and invitations are paused. After it, the workspace data is deleted and accounts that belong
        to no other organization are anonymized; payments, invoices, refunds, the credit ledger and
        the audit logs are kept for the statutory period. An active subscription is cancelled when
        the deletion takes effect. Details are in the{" "}
        <a href="/legal/privacy#organization-export-and-deletion">Privacy Policy</a>. We may suspend
        accounts that break these terms or the Acceptable Use Policy, with notice where practical.
      </p>

      <h2>Liability and law</h2>
      <p>
        <LegalPlaceholder>limitation of liability</LegalPlaceholder>
      </p>
      <p>
        These terms are governed by <LegalPlaceholder>governing law and courts</LegalPlaceholder>.
      </p>

      <h2>Changes</h2>
      <p>
        We will tell account holders by email before a material change to these terms takes effect.
        Questions: <LegalPlaceholder>contact email</LegalPlaceholder> or the{" "}
        <a href="/contact">contact form</a>.
      </p>
    </>
  );
}
