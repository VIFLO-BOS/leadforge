import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Acceptable Use Policy",
  description: "What you may and may not do with LeadForge and the business data in it.",
};

/*
 * The rules here are policy. Where they describe what LeadForge itself enforces (suppression,
 * contact blocking, attribution in exports), the behaviour is in docs/SECURITY_AND_DATA_COLLECTION.md
 * sections 2, 6 and 7.
 */
export default function AcceptableUsePage() {
  return (
    <>
      <h1 className="text-h1 mb-6 text-balance">Acceptable Use Policy</h1>
      <p>
        This policy protects the businesses whose information appears in LeadForge, the open data
        sources LeadForge relies on, and other customers. It forms part of the{" "}
        <a href="/legal/terms">Terms of Service</a>.
      </p>

      <h2>You may</h2>
      <ul>
        <li>Research businesses that are relevant to the products or services you offer.</li>
        <li>
          Contact businesses through the business contact details shown, in line with the law.
        </li>
        <li>Export records your role may export, for use by your organization.</li>
        <li>Import data you have a lawful basis to hold.</li>
      </ul>

      <h2>You may not</h2>
      <ul>
        <li>Send messages that break anti-spam or marketing laws, or ignore an opt-out.</li>
        <li>Use LeadForge to locate, profile or contact private individuals.</li>
        <li>
          Remove the attribution or licence texts from exported data before sharing it, or present
          the data as your own.
        </li>
        <li>Re-import or re-enter a business that was removed or suppressed to get around it.</li>
        <li>
          Try to reach another organization&apos;s data, or test LeadForge for vulnerabilities
          without written permission.
        </li>
        <li>Get around credits, rate limits, plan limits or role permissions.</li>
        <li>Upload content that is unlawful, infringing or malicious.</li>
      </ul>

      <h2>What LeadForge does for you</h2>
      <ul>
        <li>
          Suppressed businesses and contacts are kept out of discovery, website analysis, lists, the
          pipeline and exports.
        </li>
        <li>
          Logging a call, message, email or meeting with a suppressed number or address is refused
          unless a member records why (for example &ldquo;they called us&rdquo;); the reason is kept
          and audited.
        </li>
        <li>
          Sales representatives export only the leads assigned to them; every export carries the
          sources&apos; attribution and licence texts.
        </li>
        <li>
          Businesses that ask to be removed are added to a platform-wide do-not-collect list that
          applies to every workspace.
        </li>
      </ul>

      <h2>Enforcement</h2>
      <p>
        We may warn, suspend or close accounts that break this policy. Where the law requires it, we
        may report unlawful activity.
      </p>
    </>
  );
}
