import type { EmailCheckResult, EnrichmentRun } from "@leadforge/contracts";
import type { StatusTone } from "@leadforge/ui";
import { humanizeKey } from "./labels";

/*
 * Enrichment wording. Release 1 checks an email's syntax, its domain's mail server (MX) and
 * disposable domains only: no mailbox is ever probed, so an email is never "verified" and the UI
 * always says "Mailbox not confirmed".
 */

export const MAILBOX_NOT_CONFIRMED = "Mailbox not confirmed";

export const MAILBOX_NOTE =
  "LeadForge checks the address format, whether its domain has a mail server and whether the domain is disposable. It never contacts the mailbox, so an email is not confirmed to exist.";

export const EMAIL_CHECK_META: Record<EmailCheckResult, { label: string; tone: StatusTone }> = {
  mx_found: { label: "Mail server found for the domain", tone: "info" },
  no_mx: { label: "No mail server found for the domain", tone: "warning" },
  disposable: { label: "Disposable email domain", tone: "warning" },
  invalid_syntax: { label: "Not a valid email address", tone: "destructive" },
  dns_error: { label: "Mail server check inconclusive", tone: "neutral" },
};

export function emailCheckMeta(result: string): { label: string; tone: StatusTone } {
  return (
    EMAIL_CHECK_META[result as EmailCheckResult] ?? { label: humanizeKey(result), tone: "neutral" }
  );
}

export const RUN_KIND_LABELS: Record<EnrichmentRun["kind"], string> = {
  website_contacts: "Contacts from the website",
  email_check: "Email check",
};

export function runKindLabel(kind: string): string {
  return RUN_KIND_LABELS[kind as EnrichmentRun["kind"]] ?? humanizeKey(kind);
}

const RUN_FAILURES: Record<string, string> = {
  WEBSITE_MISSING: "The business has no usable website",
  SUPPRESSED: "The business is suppressed",
  BUSINESS_GONE: "The business was merged or deleted",
  ACCESS_REVOKED: "The person who asked for it no longer has permission",
  EMAIL_NOT_ON_BUSINESS: "That address is not on the business",
  ROBOTS_DISALLOWED: "The site's robots.txt does not allow fetching",
  DNS_FAILED: "The website's domain did not resolve",
  CONNECTION_FAILED: "The website did not accept a connection",
  TIMEOUT: "The website took too long to answer",
  TLS_INVALID: "The website's certificate is not valid",
  ADDRESS_NOT_ALLOWED: "The website resolves to a private or reserved address",
  HTTP_STATUS: "The website answered with an error",
  RUN_TIMEOUT: "The run took too long",
  ENRICHMENT_ERROR: "The run failed on our side",
};

export function runFailureLabel(code: string): string {
  return RUN_FAILURES[code] ?? humanizeKey(code.toLowerCase());
}

/** "2 phones, 1 email, 1 social profile and 2 WhatsApp links found". */
export function foundSummary(run: EnrichmentRun): string {
  const f = run.output.found;
  const parts = [
    [f.phones, "phone", "phones"],
    [f.emails, "email", "emails"],
    [f.socials, "social profile", "social profiles"],
    [f.whatsapp, "WhatsApp link", "WhatsApp links"],
  ]
    .filter(([n]) => (n as number) > 0)
    .map(([n, one, many]) => `${n} ${(n as number) === 1 ? one : many}`);
  if (parts.length === 0) return "No contact details were found on the pages checked";
  const last = parts.pop();
  return `${parts.length ? `${parts.join(", ")} and ${last}` : last} found`;
}
