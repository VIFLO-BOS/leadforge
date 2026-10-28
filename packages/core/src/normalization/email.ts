import { isDomainName } from "./dns.js";
import { cleanText } from "./text.js";

export type EmailResult =
  { ok: true; address: string; domain: string } | { ok: false; reason: string };

const LOCAL_CHARS = /^[a-z0-9!#$%&'*+/=?^_`{|}~.-]+$/;

/**
 * Syntax-level email normalization: trims, removes a `mailto:` prefix and angle brackets,
 * lowercases, and checks the local part and every domain label. MX and disposable-domain
 * checks belong to verification and run later; a syntactically valid address stays
 * `unverified`.
 */
export function normalizeEmail(raw: string): EmailResult {
  let text = cleanText(raw).replace(/^mailto:/i, "");
  const angle = /<([^<>]+)>/.exec(text);
  if (angle?.[1]) text = angle[1];
  text = text.trim().toLowerCase();
  if (text.length > 254) return { ok: false, reason: "Email address is too long" };

  const at = text.lastIndexOf("@");
  if (at <= 0 || at === text.length - 1) return { ok: false, reason: "Missing @ or domain" };
  const local = text.slice(0, at);
  const domain = text.slice(at + 1).replace(/\.$/, "");
  const dotsOk = !local.startsWith(".") && !local.endsWith(".") && !local.includes("..");
  if (local.length > 64 || !LOCAL_CHARS.test(local) || !dotsOk) {
    return { ok: false, reason: "Invalid characters before @" };
  }
  if (!isDomainName(domain)) return { ok: false, reason: "Invalid domain" };
  return { ok: true, address: `${local}@${domain}`, domain };
}
