import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Privacy Policy",
  description: "How LeadForge handles personal information.",
};

export default function PrivacyPage() {
  return (
    <>
      <h1 className="text-h1 font-semibold tracking-tight">Privacy Policy</h1>
      <p>
        This policy explains what personal information LeadForge collects, why, and the choices
        available to you. It covers two groups: people who use LeadForge (account holders and team
        members) and businesses whose public information appears in LeadForge workspaces.
      </p>

      <h2>Information about account holders</h2>
      <p>
        When you create an account we collect your name, email address and a password hash. We
        record sign-in sessions (browser, approximate IP address, time) so you can review and revoke
        them. We log actions that affect your organization, such as invitations, role changes,
        exports and billing events, to provide an audit trail.
      </p>
      <p>
        Payment is processed by Paystack. We never receive or store card numbers. We store the
        payment reference, amount, status and a masked card summary (brand and last four digits)
        that Paystack returns.
      </p>

      <h2>Information about businesses</h2>
      <p>
        LeadForge collects business-facing information: business name, category, address, business
        phone number, business email address, website and public social profile links. We collect it
        only from sources that are officially provided, permitted by their terms, or supplied by our
        users. We do not collect employee lists, personal profiles or private contact details. Where
        a sole trader&apos;s business contact is also a personal contact, we treat it as business
        contact information under legitimate interest and honor removal requests.
      </p>
      <p>
        Each collected value is stored with its source, collection date and verification status.
        Values from sources with retention limits are removed when those limits are reached.
      </p>

      <h2>Legal basis and jurisdiction</h2>
      <p>
        We process personal information under the Nigeria Data Protection Act 2023. Where we serve
        users or process data about businesses in other jurisdictions, applicable local law such as
        the GDPR or UK GDPR also applies.
      </p>

      <h2>Your rights</h2>
      <ul>
        <li>
          Account holders can export their organization&apos;s data and request deletion from
          Settings.
        </li>
        <li>
          Businesses can request correction or removal of their record through the data collection
          page.
        </li>
        <li>Anyone can ask what information we hold about them by contacting us.</li>
      </ul>
      <p>We aim to respond to requests within 30 days.</p>

      <h2>Retention</h2>
      <p>
        Account data is kept while the account is active and removed after deletion with a 14-day
        grace period. Billing records are retained for the statutory period. Audit logs are retained
        for two years.
      </p>

      <h2>Contact</h2>
      <p>
        Use the <a href="/contact">contact form</a> for privacy questions or requests.
      </p>
    </>
  );
}
