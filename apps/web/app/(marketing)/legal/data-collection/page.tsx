import type { Metadata } from "next";
import { ContactForm } from "@/components/marketing/contact-form";

export const metadata: Metadata = {
  title: "Data Collection Policy",
  description:
    "Which sources LeadForge collects from, how its website fetcher behaves, and how businesses can request correction or removal.",
};

/*
 * Mirrors docs/SECURITY_AND_DATA_COLLECTION.md section 5 (website fetching), section 6 (sources,
 * prohibited sources, contact verification rules) and section 7 (suppression and requests).
 */
export default function DataCollectionPage() {
  return (
    <>
      <h1 className="text-h1 mb-6 text-balance">Data Collection Policy</h1>
      <p>
        This policy describes where LeadForge&apos;s business information comes from, how it is
        collected, and how a business can ask for its record to be corrected or removed.
      </p>

      <h2>Principles</h2>
      <ul>
        <li>
          Only business-facing information: name, category, address, business phone, business email,
          website and public social profile links.
        </li>
        <li>
          A source is used only when its terms allow it. Being publicly visible is not enough.
        </li>
        <li>
          No logins, CAPTCHAs or paywalls are bypassed, and no addresses or identities are rotated
          to avoid limits.
        </li>
        <li>
          Contact details are never guessed or inferred. A value that was not observed stays empty.
        </li>
        <li>
          Every value is stored with its source, collection date and verification status;
          conflicting observations are kept rather than silently overwritten.
        </li>
      </ul>

      <h2>Sources</h2>
      <ul>
        <li>
          <strong>Overture Maps Places.</strong> An open dataset published monthly by the Overture
          Maps Foundation (data from Meta, Microsoft, Foursquare and others). LeadForge loads each
          release into its own catalogue at most once a day; discovery jobs read that catalogue and
          never call Overture. Places that a newer release no longer contains are marked retired and
          no longer offered. Attribution and licences are on the{" "}
          <a href="/legal/data-sources">Data sources and licences</a> page.
        </li>
        <li>
          <strong>The business&apos;s own website,</strong> when a team asks for a website analysis
          or for contacts to be collected from it (see below).
        </li>
        <li>
          <strong>Our customers&apos; imports and corrections,</strong> recorded with the importing
          or correcting member as their source.
        </li>
      </ul>
      <p>
        Google Places is not used: its terms do not allow storing business names and addresses or
        using them in a directory. LeadForge does not collect from Google Maps pages, social
        networks (Facebook, Instagram, LinkedIn, TikTok), marketplaces (such as Jiji, Konga or
        Jumia), the Corporate Affairs Commission portal, directories whose terms forbid automated
        access, or any site behind a login or a CAPTCHA.
      </p>

      <h2>How the website fetcher behaves</h2>
      <ul>
        <li>
          It identifies itself as <code>LeadForgeBot/1.0</code> with a link to this page, and
          follows the site&apos;s robots.txt (RFC 9309). A page the site disallows is never
          requested.
        </li>
        <li>
          It requests at most one page every 2 seconds from a site, and at most 5 pages for an
          analysis (3 for contact collection): the home page and contact, about, services, menu or
          booking pages.
        </li>
        <li>
          It does not run scripts, store cookies or log in, and it refuses private and internal
          network addresses.
        </li>
        <li>
          Pages are not stored. LeadForge keeps what it found (for example a phone number or the
          platform a site runs on), the page address, the date and a short evidence snippet.
        </li>
      </ul>

      <h2>Verification</h2>
      <ul>
        <li>
          A phone number is marked verified only when it was found on the business&apos;s own
          website.
        </li>
        <li>
          A number is marked as WhatsApp only from a WhatsApp link, or an explicit WhatsApp label
          next to it, on the business&apos;s own website, or when a team member records it after
          contact.
        </li>
        <li>
          Email addresses are checked for format, mail server and disposable domains. Mailboxes are
          never probed, so an email address is never shown as confirmed.
        </li>
        <li>Being found by a source is never treated as verification.</li>
      </ul>

      <h2>Retention</h2>
      <p>
        Where a source limits how long its data may be stored, values from that source are hidden
        when the limit is reached and removed within about 10 minutes; only the fact that a field
        was observed from that source on a date is kept. Overture Maps Places data may be kept under
        its open licences. When a customer deletes its organization, the business records in that
        workspace, with their provenance and verification history, are purged after a 14-day grace
        period. Retention of account and billing data is in the{" "}
        <a href="/legal/privacy">Privacy Policy</a>.
      </p>

      <h2 id="requests">Correction and removal requests</h2>
      <p>
        If you represent a business and want its record corrected or removed, send a request below.
        Our operators add a removal to LeadForge&apos;s platform-wide do-not-collect list, which
        applies to every workspace. We aim to complete requests within 30 days and confirm by email.
      </p>
      <div className="bg-surface-container-low mt-8 rounded-[28px] p-5 [--field-bg:var(--surface-container-low)] sm:p-8">
        <ContactForm defaultKind="data_request" />
      </div>
    </>
  );
}
