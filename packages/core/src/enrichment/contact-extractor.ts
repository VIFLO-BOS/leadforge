import type { SocialPlatform } from "@leadforge/contracts";
import { normalizeEmail } from "../normalization/email.js";
import { parsePhone, type ParsedPhone } from "../normalization/phone.js";
import { normalizeSocialProfile } from "../normalization/social.js";
import { snippet, type HtmlDocument, type HtmlElement } from "../html/html-document.js";

/**
 * Contact extraction from one page of a business's own website. Only explicit, machine-readable
 * contact links count: `mailto:`, `tel:`, WhatsApp click-to-chat links (wa.me,
 * api.whatsapp.com) and social profile links, plus a WhatsApp number written right after an
 * explicit "WhatsApp" label. Every value carries its evidence (page, selector, snippet).
 * Nothing is inferred: a phone number is never assumed to be on WhatsApp.
 */

export interface ContactEvidence {
  page: string;
  selector: string;
  snippet: string;
}

export interface FoundPhone {
  phone: ParsedPhone;
  raw: string;
  evidence: ContactEvidence;
}

export interface FoundEmail {
  address: string;
  domain: string;
  raw: string;
  evidence: ContactEvidence;
}

export interface FoundSocial {
  platform: SocialPlatform;
  url: string;
  handle: string | null;
  raw: string;
  evidence: ContactEvidence;
}

export interface FoundWhatsApp {
  /** Null for a click-to-chat link without a number (wa.me/message/...). */
  phone: ParsedPhone | null;
  raw: string;
  method: "wa_link" | "explicit_label";
  evidence: ContactEvidence;
}

export interface PageContacts {
  phones: FoundPhone[];
  emails: FoundEmail[];
  socials: FoundSocial[];
  whatsapp: FoundWhatsApp[];
}

const WHATSAPP_HOSTS = new Set([
  "wa.me",
  "api.whatsapp.com",
  "web.whatsapp.com",
  "whatsapp.com",
  "www.whatsapp.com",
]);
const LABEL = /whats\s?app/i;
const PHONE_CANDIDATE = /\+?\d[\d\s().-]{5,22}\d/g;
const LABEL_WINDOW = 80;

function evidence(doc: HtmlDocument, el: HtmlElement, text: string): ContactEvidence {
  return { page: doc.url.toString(), selector: doc.selector(el), snippet: snippet(text, 200) };
}

/** Number in a WhatsApp click-to-chat URL, as digits; null when the link names no number. */
export function whatsappLinkNumber(href: string): { isWhatsApp: boolean; digits: string | null } {
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return { isWhatsApp: false, digits: null };
  }
  if (url.protocol === "whatsapp:") {
    const phone = url.searchParams.get("phone");
    return { isWhatsApp: true, digits: phone ? phone.replace(/\D/g, "") || null : null };
  }
  if (url.protocol !== "https:" && url.protocol !== "http:")
    return { isWhatsApp: false, digits: null };
  const host = url.hostname.toLowerCase();
  if (!WHATSAPP_HOSTS.has(host)) return { isWhatsApp: false, digits: null };
  if (host === "wa.me") {
    const segments = url.pathname.split("/").filter(Boolean);
    const candidate = segments[0] === "c" ? segments[1] : segments[0];
    const digits =
      candidate && /^\+?\d{6,15}$/.test(candidate) ? candidate.replace(/\D/g, "") : null;
    return { isWhatsApp: true, digits };
  }
  if (/^\/send\/?$/.test(url.pathname) || url.pathname === "/") {
    const phone = url.searchParams.get("phone");
    return { isWhatsApp: true, digits: phone ? phone.replace(/\D/g, "") || null : null };
  }
  return { isWhatsApp: host !== "whatsapp.com" && host !== "www.whatsapp.com", digits: null };
}

function parseInternational(digits: string, defaultCountry: string): ParsedPhone | null {
  const r = parsePhone(`+${digits}`, defaultCountry);
  return r.ok ? r.phone : null;
}

/** Phone numbers written within LABEL_WINDOW characters after a "WhatsApp" label. */
export function labeledWhatsAppNumbers(
  text: string,
  defaultCountry: string,
): Array<{ phone: ParsedPhone; raw: string }> {
  const out: Array<{ phone: ParsedPhone; raw: string }> = [];
  const lower = text;
  let from = 0;
  for (;;) {
    const m = LABEL.exec(lower.slice(from));
    if (!m) break;
    const start = from + m.index + m[0].length;
    const window = lower.slice(start, start + LABEL_WINDOW);
    for (const candidate of window.match(PHONE_CANDIDATE) ?? []) {
      const parsed = parsePhone(candidate, defaultCountry);
      if (parsed.ok && !out.some((o) => o.phone.e164 === parsed.phone.e164))
        out.push({ phone: parsed.phone, raw: candidate.trim() });
    }
    from = start;
  }
  return out;
}

export function extractContacts(doc: HtmlDocument, defaultCountry: string): PageContacts {
  const result: PageContacts = { phones: [], emails: [], socials: [], whatsapp: [] };
  const addPhone = (phone: ParsedPhone, raw: string, ev: ContactEvidence) => {
    if (!result.phones.some((p) => p.phone.e164 === phone.e164))
      result.phones.push({ phone, raw, evidence: ev });
  };
  const addWhatsApp = (w: FoundWhatsApp) => {
    const key = w.phone?.e164 ?? `link:${w.raw}`;
    if (!result.whatsapp.some((x) => (x.phone?.e164 ?? `link:${x.raw}`) === key))
      result.whatsapp.push(w);
  };

  for (const link of doc.links()) {
    const raw = link.raw;
    const lower = raw.toLowerCase();
    if (lower.startsWith("mailto:")) {
      const addresses = decodeSafe(raw.slice(7).split("?")[0] ?? "").split(/[,;]/);
      for (const a of addresses) {
        const e = normalizeEmail(a);
        if (e.ok && !result.emails.some((x) => x.address === e.address)) {
          result.emails.push({
            address: e.address,
            domain: e.domain,
            raw: a.trim(),
            evidence: evidence(doc, link.element, link.text || raw),
          });
        }
      }
      continue;
    }
    if (lower.startsWith("tel:")) {
      const value = decodeSafe(raw.slice(4)).split(";")[0] ?? "";
      const p = parsePhone(value, defaultCountry);
      if (!p.ok) continue;
      const ev = evidence(doc, link.element, link.text || raw);
      addPhone(p.phone, value.trim(), ev);
      if (LABEL.test(link.text))
        addWhatsApp({ phone: p.phone, raw: value.trim(), method: "explicit_label", evidence: ev });
      continue;
    }
    const href = link.href ?? raw;
    const wa = whatsappLinkNumber(href);
    if (wa.isWhatsApp) {
      const phone = wa.digits ? parseInternational(wa.digits, defaultCountry) : null;
      const ev = evidence(doc, link.element, `${link.text} ${href}`.trim());
      addWhatsApp({ phone, raw: href.slice(0, 300), method: "wa_link", evidence: ev });
      if (phone) addPhone(phone, wa.digits!, ev);
      continue;
    }
    if (link.href) {
      const social = normalizeSocialProfile(link.href);
      if (social && !result.socials.some((s) => s.url === social.url)) {
        result.socials.push({
          ...social,
          raw: link.href.slice(0, 300),
          evidence: evidence(doc, link.element, link.text || link.href),
        });
      }
    }
  }

  // Numbers written after an explicit WhatsApp label ("WhatsApp: 0803 123 4567"). Small
  // elements only, so a label is tied to the number next to it, not to the whole page.
  for (const el of doc.elements) {
    if (el.tag === "script" || el.tag === "style" || el.tag === "a") continue;
    const own = el.children.filter((c): c is string => typeof c === "string").join(" ");
    if (!LABEL.test(own)) continue;
    const text = doc.text(el, 400);
    if (text.length > 300) continue;
    for (const found of labeledWhatsAppNumbers(text, defaultCountry)) {
      const ev = evidence(doc, el, text);
      addPhone(found.phone, found.raw, ev);
      addWhatsApp({ phone: found.phone, raw: found.raw, method: "explicit_label", evidence: ev });
    }
  }
  return result;
}

function decodeSafe(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/** Combines contacts from several pages, keeping the first evidence for each value. */
export function mergePageContacts(pages: PageContacts[]): PageContacts {
  const out: PageContacts = { phones: [], emails: [], socials: [], whatsapp: [] };
  for (const p of pages) {
    for (const x of p.phones)
      if (!out.phones.some((y) => y.phone.e164 === x.phone.e164)) out.phones.push(x);
    for (const x of p.emails)
      if (!out.emails.some((y) => y.address === x.address)) out.emails.push(x);
    for (const x of p.socials) if (!out.socials.some((y) => y.url === x.url)) out.socials.push(x);
    for (const x of p.whatsapp) {
      const key = x.phone?.e164 ?? `link:${x.raw}`;
      if (!out.whatsapp.some((y) => (y.phone?.e164 ?? `link:${y.raw}`) === key))
        out.whatsapp.push(x);
    }
  }
  return out;
}
