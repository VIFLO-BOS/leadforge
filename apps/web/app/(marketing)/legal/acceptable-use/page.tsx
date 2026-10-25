import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Acceptable Use Policy",
  description: "What you may and may not do with LeadForge.",
};

export default function AcceptableUsePage() {
  return (
    <>
      <h1 className="text-h1 font-semibold tracking-tight">Acceptable Use Policy</h1>
      <p>
        This policy protects the businesses whose information appears in LeadForge, the sources we
        rely on, and other users.
      </p>

      <h2>You may</h2>
      <ul>
        <li>Research businesses that are relevant to products or services you offer.</li>
        <li>
          Contact businesses using the business contact details shown, in line with applicable law.
        </li>
        <li>Export authorized records for use within your organization.</li>
        <li>Import data you have a lawful basis to hold.</li>
      </ul>

      <h2>You may not</h2>
      <ul>
        <li>
          Send unsolicited bulk messages that violate anti-spam or marketing laws, or ignore
          opt-outs.
        </li>
        <li>Resell, redistribute or publish exported data as a dataset.</li>
        <li>Use the service to locate, profile or contact private individuals.</li>
        <li>
          Attempt to access another organization&apos;s data or probe the service for
          vulnerabilities without written permission.
        </li>
        <li>Circumvent credit accounting, rate limits or plan limits.</li>
        <li>Upload content that is unlawful, infringing or malicious.</li>
      </ul>

      <h2>Suppression and removal</h2>
      <p>
        Businesses can ask to be removed. Removed businesses are suppressed across all workspaces
        and excluded from discovery and export. You must not re-import a suppressed business to work
        around this.
      </p>

      <h2>Enforcement</h2>
      <p>
        We may warn, suspend or terminate accounts that violate this policy. Where the law requires,
        we may report unlawful activity.
      </p>
    </>
  );
}
