import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Terms of Service",
  description: "Terms governing use of LeadForge.",
};

export default function TermsPage() {
  return (
    <>
      <h1 className="text-h1 font-semibold tracking-tight">Terms of Service</h1>
      <p>
        These terms govern your use of LeadForge. By creating an account you agree to them on behalf
        of yourself and, where applicable, your organization.
      </p>

      <h2>The service</h2>
      <p>
        LeadForge provides business discovery, contact enrichment, website analysis, lead scoring
        and lead management. Coverage depends on the sources enabled for your workspace. We do not
        promise that any list is complete or that any contact detail is current.
      </p>

      <h2>Accounts and organizations</h2>
      <p>
        You are responsible for the accuracy of your account information and for activity under your
        credentials. Organization owners are responsible for the members they invite and the roles
        they assign.
      </p>

      <h2>Acceptable use</h2>
      <p>
        You must use data obtained through LeadForge lawfully, including compliance with applicable
        data protection, marketing and anti-spam laws. The{" "}
        <a href="/legal/acceptable-use">Acceptable Use Policy</a> forms part of these terms.
      </p>

      <h2>Billing</h2>
      <p>
        Subscriptions renew for the selected interval until cancelled. Credits are reserved when a
        job is queued and settled against the job&apos;s actual output. Credits for work that fails
        because of an error on our side are released. Prices shown in the application are
        authoritative.
      </p>

      <h2>Data you import</h2>
      <p>
        When you import data you confirm that you have a lawful basis to hold and process it.
        Imported data is marked with you as its source.
      </p>

      <h2>Termination</h2>
      <p>
        You may request deletion of your organization at any time. We may suspend accounts that
        violate these terms or the Acceptable Use Policy, with notice where practical.
      </p>

      <h2>Liability</h2>
      <p>
        LeadForge is provided as described. To the extent permitted by law, we are not liable for
        indirect or consequential loss arising from use of the service or reliance on collected
        data.
      </p>

      <h2>Changes</h2>
      <p>
        We will notify account holders by email of material changes to these terms before they take
        effect.
      </p>
    </>
  );
}
