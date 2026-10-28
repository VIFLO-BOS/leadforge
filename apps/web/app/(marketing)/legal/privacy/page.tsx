import type { Metadata } from "next";
import { LegalPlaceholder } from "@/components/marketing/legal-placeholder";

export const metadata: Metadata = {
  title: "Privacy Policy",
  description:
    "What LeadForge stores about account holders and about businesses, for how long, and how to ask about it.",
};

/*
 * Every statement here is checkable against docs/SECURITY_AND_DATA_COLLECTION.md (sections 1, 5,
 * 6, 7, 8 and 10) and docs/DATABASE_DESIGN.md section 8. It describes how the product handles data;
 * it does not state legal conclusions. Company details are placeholders until they are known.
 */
export default function PrivacyPage() {
  return (
    <>
      <h1 className="text-h1 mb-6 text-balance">Privacy Policy</h1>
      <p>
        This policy explains what LeadForge stores, why, for how long, and how to ask about it. It
        covers two groups of people: those who use LeadForge (account holders and their team
        members) and businesses, including sole traders, whose information appears in LeadForge
        workspaces.
      </p>

      <h2>Who is responsible</h2>
      <p>
        LeadForge is operated by <LegalPlaceholder>legal entity name</LegalPlaceholder>, registered
        at <LegalPlaceholder>registered address</LegalPlaceholder>. Privacy questions and requests:{" "}
        <LegalPlaceholder>privacy contact email</LegalPlaceholder>, or the{" "}
        <a href="/contact">contact form</a>.
      </p>

      <h2>Information about account holders</h2>
      <ul>
        <li>
          <strong>Account:</strong> your name, email address and a one-way hash of your password
          (Argon2id). We never store the password itself. Workspaces open only after you verify your
          email address.
        </li>
        <li>
          <strong>Sessions:</strong> for each signed-in device, the browser&apos;s user agent, the
          IP address and when the session was created, last used and expires. You can review and
          revoke sessions under Settings, Security. Revoking a session or resetting your password
          ends those sessions at once.
        </li>
        <li>
          <strong>Activity in your organization:</strong> an audit log of sensitive actions, such as
          sign-ins, invitations and role changes, corrections, merges, suppressions, exports, views
          of contact details and billing actions. Credit movements are kept in a ledger with the
          member who caused them.
        </li>
        <li>
          <strong>Payments:</strong> payments are processed by Paystack on its own hosted page, so
          card numbers never reach LeadForge. We keep the payment reference, amount, currency and
          status, and the masked card details Paystack returns (brand, last four digits, expiry
          month and year, bank, card type and channel). Paystack&apos;s webhook messages are stored
          with the reusable authorization code and card signature removed.
        </li>
        <li>
          <strong>Email:</strong> we send transactional email (verification, password reset,
          invitations, receipts and the notifications you choose) through{" "}
          <LegalPlaceholder>email delivery provider</LegalPlaceholder>.
        </li>
        <li>
          <strong>In your browser:</strong> three cookies that keep you signed in and protect forms
          (<code>lf_access</code>, <code>lf_refresh</code>, <code>lf_csrf</code>), and local
          settings such as the active workspace, the theme and a collapsed sidebar. LeadForge uses
          no advertising or analytics trackers.
        </li>
      </ul>

      <h2>Information about businesses</h2>
      <p>
        LeadForge stores business-facing information only: business name, category, address,
        business phone, business email, website and public social profile links. It does not collect
        employee lists, personal profiles or private contact details. Values come from these
        sources:
      </p>
      <ul>
        <li>
          <strong>Overture Maps Places</strong>, an open dataset from the Overture Maps Foundation
          (data from Meta, Microsoft, Foursquare and other contributors under open licences). See{" "}
          <a href="/legal/data-sources">Data sources and licences</a>.
        </li>
        <li>
          <strong>The business&apos;s own website</strong>, read by our fetcher LeadForgeBot under
          the rules on the <a href="/legal/data-collection">Data Collection Policy</a>. Pages are
          not stored; only the values found, the page address and a short evidence snippet are kept.
        </li>
        <li>
          <strong>Our customers</strong>, who import files or enter and correct records. Importers
          confirm they have a lawful basis for the data they import.
        </li>
      </ul>
      <p>
        Every value is stored with its source, the date it was collected and its verification
        status. A phone number counts as verified only when it was found on the business&apos;s own
        website. Email addresses are checked for format, mail server and disposable domains, but
        LeadForge never probes mailboxes, so emails are always shown as &ldquo;Mailbox not
        confirmed&rdquo;. Missing values stay missing: LeadForge never guesses or invents contact
        details.
      </p>
      <p>
        A sole trader&apos;s business phone or email can also identify a person. For each phone we
        record its type (for example mobile or fixed line), and for each email whether it is on a
        consumer mail domain (for example gmail.com), so that customers can take this into account.
      </p>

      <h2>Data protection law</h2>
      <p>
        LeadForge is designed with the Nigeria Data Protection Act 2023 in mind, and with the GDPR
        or UK GDPR where customers work in those markets. How we handle data today: business contact
        details that are also personal are handled as business contact information on the basis of
        legitimate interest; removal requests are honoured across all workspaces; suppressed
        contacts are excluded from discovery, analysis, lists, the pipeline and exports; and contact
        with a suppressed number or address is refused unless a member records a reason, which is
        audited. Each customer organization decides how it contacts the businesses in its workspace
        and is responsible for doing so lawfully. Whether these measures meet every legal
        requirement is part of the pending legal review.
      </p>

      <h2>How long we keep information</h2>
      <ul>
        <li>Accounts and workspace data: while the account and the organization exist.</li>
        <li>Audit log and merge history: 2 years.</li>
        <li>In-app notifications: 90 days.</li>
        <li>
          Export files: 7 days after they are built (each download uses a new, short-lived link).
        </li>
        <li>
          Rows staged from an imported file: 30 days after upload. The file itself is not stored.
        </li>
        <li>Results of bulk operations: 30 days.</li>
        <li>
          Billing records (payments, invoices, refunds, the credit ledger and billing audit): for
          the statutory period, <LegalPlaceholder>statutory retention period</LegalPlaceholder>,
          including after an organization is deleted.
        </li>
        <li>
          Values from a source that limits storage are hidden when the limit passes and removed
          within about 10 minutes.
        </li>
        <li>
          Backups: daily copies kept 7 days, weekly copies 5 weeks and monthly copies 12 months, so
          deleted data can remain in a backup until that backup expires.
        </li>
      </ul>

      <h2 id="organization-export-and-deletion">Exporting and deleting an organization</h2>
      <p>
        Organization owners do both themselves in LeadForge, under Settings, Organization,
        &ldquo;Data and deletion&rdquo;.
      </p>
      <ul>
        <li>
          <strong>Export:</strong> an owner can download a copy of everything the organization holds
          as one ZIP of JSON and CSV files: the organization profile, members (name, email address,
          role and when they joined), businesses with their stored values and where each came from,
          lists, leads, activities, outreach, imports and jobs, the credit ledger, invoices and
          payments (never card numbers, which LeadForge does not hold), usage and the audit log.
          Values whose source storage limit has passed are left out, as in every export, and the
          licence texts and attribution of open data travel with the file. The file is built in the
          background, kept 7 days, and each download uses a new link that works for 15 minutes for
          that owner only. Because the file contains every member&apos;s email address, only owners
          can request it.
        </li>
        <li>
          <strong>Deletion request:</strong> an owner confirms by typing the organization&apos;s
          name and their current password. Every owner and administrator is emailed, every member
          sees a notice in the app, and owners and administrators are emailed again about 3 days
          before the end of the 14-day grace period. During the grace period the workspace keeps
          working, except that new discovery, website analysis, imports, purchases and invitations
          are paused, and any owner can cancel the deletion.
        </li>
        <li>
          <strong>After the grace period:</strong> the organization&apos;s queued work is stopped,
          any active subscription is cancelled with the payment provider, and its workspace data is
          deleted: businesses and their provenance, lists, leads, activities, outreach, imports,
          jobs, export files, notifications, memberships, invitations and notification preferences.
          Accounts that belong to no other organization are anonymized: the email address and name
          are erased, the password hash is removed and every session is signed out. People who also
          belong to another organization keep their account there.
        </li>
        <li>
          <strong>What is kept:</strong> payments, invoices and their PDFs, refunds, the credit
          ledger and the billing audit trail, for the statutory period, because billing law requires
          them; and the security audit log, for its 2-year retention. The invoices keep the name and
          address they were issued to; elsewhere the organization&apos;s name is replaced by a
          neutral label.
        </li>
        <li>
          <strong>Backups:</strong> deleted data can remain in a backup until that backup expires on
          the schedule above. If a backup is ever restored, completed deletions are applied again
          before the service reopens.
        </li>
      </ul>

      <h2>Requests</h2>
      <ul>
        <li>
          Businesses can ask for their record to be corrected or removed on the{" "}
          <a href="/legal/data-collection#requests">Data Collection Policy</a> page.
        </li>
        <li>
          Organization owners export the organization&apos;s data and request its deletion
          themselves, as described <a href="#organization-export-and-deletion">above</a>.
        </li>
        <li>
          Anyone can ask what information LeadForge holds about them, or ask for it to be corrected
          or deleted, through the <a href="/contact">contact form</a>.
        </li>
      </ul>
      <p>We aim to complete requests within 30 days and confirm by email.</p>

      <h2>Security</h2>
      <p>
        Access is limited by role inside each organization and checked on the server for every
        request. Organizations are isolated from each other, and that isolation is tested for every
        route of the API. Sessions use short-lived tokens, sensitive actions are audited, and the
        website fetcher refuses private and internal network addresses.
      </p>

      <h2>Changes</h2>
      <p>
        We will tell account holders by email before a material change to this policy takes effect.
      </p>
    </>
  );
}
