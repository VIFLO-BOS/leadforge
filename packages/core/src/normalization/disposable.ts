import { disposableEmailBlocklistSet } from "disposable-email-domains-js";

/**
 * Disposable email domains from `disposable-email-domains-js` (CC0-1.0), a maintained npm
 * packaging of the community list at github.com/disposable-email-domains/disposable-email-domains
 * (also CC0-1.0). Loaded once per process; parent domains are checked too, so
 * `x.mailinator.com` matches `mailinator.com`.
 */
export const DISPOSABLE_LIST_SOURCE =
  "disposable-email-domains-js (CC0-1.0), packaging github.com/disposable-email-domains/disposable-email-domains";

let domains: Set<string> | null = null;

export function isDisposableDomain(domain: string): boolean {
  domains ??= disposableEmailBlocklistSet();
  const labels = domain.trim().toLowerCase().replace(/\.$/, "").split(".");
  for (let i = 0; i < labels.length - 1; i++) {
    if (domains.has(labels.slice(i).join("."))) return true;
  }
  return false;
}
