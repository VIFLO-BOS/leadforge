import type { Metadata } from "next";
import { ContactForm } from "@/components/marketing/contact-form";

export const metadata: Metadata = {
  title: "Data Collection Policy",
  description:
    "Which sources LeadForge collects from, how, and how businesses can request correction or removal.",
};

export default function DataCollectionPage() {
  return (
    <>
      <h1 className="text-h1 font-semibold tracking-tight">Data Collection Policy</h1>
      <p>
        This policy describes how LeadForge collects business information, which sources it uses,
        and how businesses can ask for corrections or removal.
      </p>

      <h2>Principles</h2>
      <ul>
        <li>
          We collect only business-facing information: name, category, address, business phone,
          business email, website, public social profile links, opening hours and description.
        </li>
        <li>
          We use official APIs, publicly accessible business websites whose terms and robots
          directives allow automated access, and files our users import.
        </li>
        <li>
          We do not bypass logins, CAPTCHAs, paywalls or rate limits, and we do not rotate addresses
          or identities to evade limits.
        </li>
        <li>We never invent or infer contact details. A field we did not observe stays empty.</li>
        <li>
          We mark a number as a WhatsApp contact only with explicit evidence, such as a WhatsApp
          link or label on the business&apos;s own website, or confirmation after contact.
        </li>
        <li>
          Every value is stored with its source, collection date and verification status, and
          conflicting observations are kept rather than silently overwritten.
        </li>
      </ul>

      <h2>Sources</h2>
      <p>
        Sources are added one at a time after a review of their terms, access rules and retention
        requirements. Sources are never enabled merely because their content is publicly visible.
        The current list of sources, with each one&apos;s permitted method, retention rule and
        attribution, is shown on the Sources page inside every workspace.
      </p>
      <p>
        We do not collect from social networks, online marketplaces, government registries without
        an official API, or directories whose terms forbid automated access.
      </p>

      <h2>Website fetching</h2>
      <p>
        When a business&apos;s own website is analyzed, our fetcher identifies itself as
        LeadForgeBot, reads the site&apos;s robots file and honors it, fetches at most a few pages
        at a slow rate, and never executes scripts. Analysis results describe what was observed and
        are dated.
      </p>

      <h2>Retention</h2>
      <p>
        Where a source limits how long its data may be stored, values from that source are removed
        when the limit is reached. Only the fact that a field was observed from that source on a
        given date is kept.
      </p>

      <h2 id="requests">Correction and removal requests</h2>
      <p>
        If you represent a business and want your record corrected or removed, submit a request
        below. Removal applies across all LeadForge workspaces and prevents re-collection from our
        sources. We aim to complete requests within 30 days and will confirm by email.
      </p>
      <div className="not-prose border-border bg-surface mt-6 rounded-lg border p-5">
        <ContactForm defaultKind="data_request" />
      </div>
    </>
  );
}
