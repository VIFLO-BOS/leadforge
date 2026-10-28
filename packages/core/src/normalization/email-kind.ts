import type { EmailKind } from "@leadforge/contracts";

/**
 * Consumer mailbox providers. An address on one of these domains is usually a person's own
 * mailbox (for a sole trader, personal data under the Nigeria Data Protection Act 2023), not a
 * business domain. In Overture's Nigerian places, 80% of emails are on these domains (gmail.com
 * alone 70%). Data only: nothing is blocked because of it.
 */
export const FREE_MAIL_DOMAINS: ReadonlySet<string> = new Set([
  "gmail.com",
  "googlemail.com",
  "yahoo.com",
  "yahoo.co.uk",
  "yahoo.fr",
  "yahoo.ca",
  "yahoo.in",
  "ymail.com",
  "rocketmail.com",
  "hotmail.com",
  "hotmail.co.uk",
  "hotmail.fr",
  "outlook.com",
  "outlook.fr",
  "live.com",
  "live.co.uk",
  "msn.com",
  "icloud.com",
  "me.com",
  "mac.com",
  "aol.com",
  "mail.com",
  "email.com",
  "gmx.com",
  "gmx.net",
  "proton.me",
  "protonmail.com",
  "zoho.com",
  "zohomail.com",
  "yandex.com",
  "yandex.ru",
  "inbox.com",
  "hushmail.com",
  "tutanota.com",
  "fastmail.com",
  "qq.com",
  "163.com",
]);

export function emailKind(domain: string): EmailKind {
  return FREE_MAIL_DOMAINS.has(domain.trim().toLowerCase()) ? "free_mail" : "business";
}
