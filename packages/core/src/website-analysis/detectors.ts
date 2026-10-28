import type {
  DetectionKey,
  DetectionObserved,
  EvidenceType,
  OpportunityKey,
} from "@leadforge/contracts";
import { HtmlDocument, snippet, type HtmlElement } from "../html/html-document.js";
import { whatsappLinkNumber } from "../enrichment/contact-extractor.js";
import type { CrawlResult, CrawledPage } from "../safe-fetch/site-crawler.js";

/**
 * Website analysis detections (PRODUCT_REQUIREMENTS section 6). Each detection reports what
 * was observed on the pages that were fetched, with evidence and a confidence. Copy always
 * reads "No X was detected": a gap in what we could see, never a claim that the business has
 * no X (pages rendered by JavaScript, external stylesheets and pages we did not fetch are
 * invisible to this analysis, which is why no confidence is 1 for a "yes").
 */

export interface DetectionEvidence {
  type: EvidenceType;
  value: string;
  page: string | null;
}

export interface DetectionResult {
  key: DetectionKey;
  label: string;
  observed: DetectionObserved;
  confidence: number;
  evidence: DetectionEvidence[];
  observedValue: string | null;
}

export interface OpportunityResult {
  key: OpportunityKey;
  title: string;
  rationale: string;
  confidence: number;
  detectionKeys: DetectionKey[];
}

/** Display copy per detection and observed value. */
export const DETECTION_LABELS: Record<DetectionKey, Record<DetectionObserved, string>> = {
  website_unreachable: {
    yes: "No reachable website was detected",
    no: "The website was reachable",
    unknown: "Website reachability could not be checked",
  },
  mobile_unfriendly: {
    yes: "Indicators of a layout that is not mobile-friendly were detected",
    no: "No indicators of a layout that is not mobile-friendly were detected",
    unknown: "Mobile friendliness could not be checked",
  },
  no_contact_form: {
    yes: "No contact form was detected",
    no: "A contact form was detected",
    unknown: "Contact forms could not be checked",
  },
  no_booking_flow: {
    yes: "No booking flow was detected",
    no: "A booking flow was detected",
    unknown: "Booking could not be checked",
  },
  no_online_ordering: {
    yes: "No online ordering flow was detected",
    no: "An online ordering flow was detected",
    unknown: "Online ordering could not be checked",
  },
  no_whatsapp_link: {
    yes: "No WhatsApp link was detected",
    no: "A WhatsApp link was detected",
    unknown: "WhatsApp links could not be checked",
  },
  no_https: {
    yes: "No working HTTPS was detected",
    no: "HTTPS with a valid certificate was detected",
    unknown: "HTTPS could not be checked",
  },
  outdated_platform: {
    yes: "An old platform version string was detected",
    no: "No old platform version string was detected",
    unknown: "No platform version string was detected",
  },
  missing_seo_metadata: {
    yes: "No complete basic SEO metadata was detected",
    no: "Basic SEO metadata was detected",
    unknown: "SEO metadata could not be checked",
  },
};

const OPPORTUNITIES: Record<DetectionKey, { key: OpportunityKey; title: string }> = {
  website_unreachable: { key: "website_rebuild", title: "Website recovery or rebuild" },
  mobile_unfriendly: { key: "mobile_friendly_site", title: "Mobile-friendly website" },
  no_contact_form: { key: "contact_form", title: "Website contact form" },
  no_booking_flow: { key: "online_booking", title: "Online booking" },
  no_online_ordering: { key: "online_ordering", title: "Online ordering" },
  no_whatsapp_link: { key: "whatsapp_click_to_chat", title: "WhatsApp click-to-chat link" },
  no_https: { key: "https_setup", title: "HTTPS and certificate setup" },
  outdated_platform: { key: "platform_update", title: "Platform update" },
  missing_seo_metadata: { key: "seo_basics", title: "Basic SEO metadata" },
};

function detection(
  key: DetectionKey,
  observed: DetectionObserved,
  confidence: number,
  evidence: DetectionEvidence[],
  observedValue: string | null = null,
): DetectionResult {
  return {
    key,
    label: DETECTION_LABELS[key][observed],
    observed,
    confidence: round(confidence),
    evidence: evidence.slice(0, 10),
    observedValue,
  };
}

function round(n: number): number {
  return Math.round(Math.max(0, Math.min(1, n)) * 100) / 100;
}

function parsedPages(crawl: CrawlResult): Array<CrawledPage & { doc: HtmlDocument }> {
  return crawl.pages.filter((p): p is CrawledPage & { doc: HtmlDocument } => p.doc !== null);
}

function ev(type: EvidenceType, value: string, page: string | null): DetectionEvidence {
  return { type, value: snippet(value, 300), page };
}

function elEvidence(doc: HtmlDocument, el: HtmlElement, text?: string): DetectionEvidence[] {
  const out: DetectionEvidence[] = [ev("selector", doc.selector(el), doc.url.toString())];
  if (text) out.push(ev("text", text, doc.url.toString()));
  return out;
}

const UNREACHABLE_CONFIDENCE: Record<string, number> = {
  DNS_FAILED: 0.9,
  CONNECTION_FAILED: 0.8,
  TIMEOUT: 0.7,
  TLS_INVALID: 0.8,
  TOO_MANY_REDIRECTS: 0.7,
  HTTP_STATUS: 0.75,
};

/** Home failures that are about the site (it could not be reached), not about our policies. */
export const UNREACHABLE_CODES = new Set(Object.keys(UNREACHABLE_CONFIDENCE));

export function detectReachability(crawl: CrawlResult): DetectionResult {
  if (crawl.home) {
    const page = crawl.home.finalUrl ?? crawl.home.url;
    return detection("website_unreachable", "no", 1, [
      ev("url", page, page),
      ev("text", `HTTP ${crawl.home.status}`, page),
    ]);
  }
  const f = crawl.homeFailure;
  if (!f || !UNREACHABLE_CODES.has(f.code))
    return detection(
      "website_unreachable",
      "unknown",
      0,
      f ? [ev("text", f.message, crawl.startUrl)] : [],
    );
  let confidence = UNREACHABLE_CONFIDENCE[f.code] ?? 0.7;
  if (f.code === "HTTP_STATUS" && f.status !== null && f.status >= 500) confidence = 0.7;
  return detection("website_unreachable", "yes", confidence, [
    ev("url", crawl.startUrl, crawl.startUrl),
    ev(
      "text",
      `${f.message}${f.detail && f.code !== "HTTP_STATUS" ? ` (${f.detail})` : ""} after ${f.attempts} attempt${f.attempts === 1 ? "" : "s"}`,
      crawl.startUrl,
    ),
  ]);
}

export function detectMobile(crawl: CrawlResult): DetectionResult {
  const home = crawl.home?.doc;
  if (!home) return detection("mobile_unfriendly", "unknown", 0, []);
  const page = home.url.toString();
  const evidence: DetectionEvidence[] = [];
  let confidence = 0;
  const viewport = home.meta("viewport");
  if (!viewport) {
    evidence.push(ev("selector", "head (no meta[name=viewport])", page));
    confidence = Math.max(confidence, 0.8);
  } else if (
    /width\s*=\s*\d{3,4}/i.test(viewport.content) &&
    !/device-width/i.test(viewport.content)
  ) {
    evidence.push(...elEvidence(home, viewport.element, `viewport: ${viewport.content}`));
    confidence = Math.max(confidence, 0.7);
  }
  for (const p of parsedPages(crawl)) {
    const css = p.doc.styleText();
    const fixed = [...css.matchAll(/(?:^|[\s;{])(?:min-)?width\s*:\s*(\d{3,4})px/gi)].find(
      (m) => Number(m[1]) >= 960,
    );
    if (fixed) {
      evidence.push(
        ev("text", `Fixed width declaration: ${fixed[0].trim()}`, p.doc.url.toString()),
      );
      confidence = Math.max(confidence, 0.5);
    }
    const table = p.doc.byTag("table").find((t) => Number(t.attrs.width) >= 960);
    if (table) {
      evidence.push(...elEvidence(p.doc, table, `table width="${table.attrs.width}"`));
      confidence = Math.max(confidence, 0.5);
    }
    const tiny = [...css.matchAll(/font-size\s*:\s*([\d.]{1,6})px/gi)].find(
      (m) => Number(m[1]) > 0 && Number(m[1]) < 12,
    );
    if (tiny) {
      evidence.push(ev("text", `Small font declaration: ${tiny[0].trim()}`, p.doc.url.toString()));
      confidence = Math.max(confidence, 0.4);
    }
    const font = p.doc.byTag("font").find((f) => f.attrs.size === "1" || f.attrs.size === "-2");
    if (font) {
      evidence.push(...elEvidence(p.doc, font, `font size="${font.attrs.size}"`));
      confidence = Math.max(confidence, 0.4);
    }
  }
  if (evidence.length > 0) return detection("mobile_unfriendly", "yes", confidence, evidence);
  return detection(
    "mobile_unfriendly",
    "no",
    0.6,
    viewport ? elEvidence(home, viewport.element, `viewport: ${viewport.content}`) : [],
  );
}

const FORM_PROVIDERS =
  /(?:docs\.google\.com\/forms|forms\.gle|typeform\.com|jotform\.com|tally\.so|hsforms\.(?:com|net)|forms\.hubspot\.com|formstack\.com|wufoo\.com|cognitoforms\.com|forms\.zohopublic\.com|formspree\.io|paperform\.co|123formbuilder\.com)/i;

function isContactForm(doc: HtmlDocument, form: HtmlElement): { contact: boolean; reason: string } {
  const fields = doc.elements.filter(
    (e) =>
      (e.tag === "input" || e.tag === "textarea" || e.tag === "select") &&
      HtmlDocument.within(e, "form") === form,
  );
  const describe = (e: HtmlElement) =>
    `${e.attrs.name ?? ""} ${e.attrs.id ?? ""} ${e.attrs.placeholder ?? ""} ${e.attrs["aria-label"] ?? ""}`.toLowerCase();
  const text = doc.text(form, 600).toLowerCase();
  const visible = fields.filter(
    (f) =>
      !["hidden", "submit", "button", "image", "reset"].includes(
        (f.attrs.type ?? "").toLowerCase(),
      ),
  );
  const hasEmail = visible.some(
    (f) => (f.attrs.type ?? "").toLowerCase() === "email" || /e-?mail/.test(describe(f)),
  );
  const hasMessage = visible.some(
    (f) => f.tag === "textarea" || /message|enquiry|inquiry|comment|question/.test(describe(f)),
  );
  const search =
    form.attrs.role === "search" ||
    (visible.length === 1 && /(^|\s)(q|s|search|query)(\s|$)/.test(describe(visible[0]!)));
  if (search) return { contact: false, reason: "search form" };
  if (hasMessage) return { contact: true, reason: "form with a message field" };
  if (hasEmail && visible.length === 1 && /subscribe|newsletter|sign up|signup/.test(text))
    return { contact: false, reason: "newsletter sign-up" };
  if (hasEmail) return { contact: true, reason: "form with an email field" };
  return { contact: false, reason: "no email or message field" };
}

export function detectContactForm(crawl: CrawlResult): DetectionResult {
  const pages = parsedPages(crawl).filter((p) => p.kind === "home" || p.kind === "contact");
  if (pages.length === 0) return detection("no_contact_form", "unknown", 0, []);
  for (const p of pages) {
    for (const form of p.doc.byTag("form")) {
      const verdict = isContactForm(p.doc, form);
      if (verdict.contact)
        return detection("no_contact_form", "no", 0.9, elEvidence(p.doc, form, verdict.reason));
    }
    for (const frame of [...p.doc.sources("iframe"), ...p.doc.sources("script")]) {
      if (FORM_PROVIDERS.test(frame.url))
        return detection("no_contact_form", "no", 0.8, [
          ...elEvidence(p.doc, frame.element),
          ev("url", frame.url, p.doc.url.toString()),
        ]);
    }
  }
  const checked = pages.map((p) => ev("url", p.doc.url.toString(), p.doc.url.toString()));
  const contactPageChecked = pages.some((p) => p.kind === "contact");
  return detection("no_contact_form", "yes", contactPageChecked ? 0.75 : 0.6, [
    ...checked,
    ev(
      "text",
      `Checked ${pages.length} page${pages.length === 1 ? "" : "s"}${contactPageChecked ? " including the contact page" : " (no contact page was linked from the home page)"}`,
      null,
    ),
  ]);
}

const BOOKING_HOSTS =
  /(?:calendly\.com|acuityscheduling\.com|squareup\.com\/appointments|app\.squareup\.com\/appointments|booksy\.com|fresha\.com|setmore\.com|simplybook\.me|vagaro\.com|schedulicity\.com|opentable\.com|resy\.com|sevenrooms\.com|tablein\.com|eatapp\.co|mindbodyonline\.com|zocdoc\.com|appointy\.com|youcanbook\.me|tidycal\.com|cal\.com|bookeo\.com|picktime\.com|booking\.com|setster\.com|10to8\.com|zcal\.co)/i;
const BOOKING_TEXT =
  /\b(?:book (?:now|online|an appointment|a table|a session|a consultation|your)|make a (?:booking|reservation)|reserve (?:a table|now|online)|schedule (?:an appointment|a consultation|a visit|appointment)|book appointment|online booking)\b/i;

function findSignal(
  crawl: CrawlResult,
  hosts: RegExp,
  text: RegExp,
  pathRe: RegExp | null,
): { found: DetectionEvidence[] } {
  for (const p of parsedPages(crawl)) {
    const page = p.doc.url.toString();
    for (const src of [...p.doc.sources("script"), ...p.doc.sources("iframe")]) {
      if (hosts.test(src.url))
        return { found: [...elEvidence(p.doc, src.element), ev("url", src.url, page)] };
    }
    for (const link of p.doc.links()) {
      if (link.href && hosts.test(link.href))
        return {
          found: [...elEvidence(p.doc, link.element, link.text), ev("url", link.href, page)],
        };
      if (text.test(link.text)) return { found: elEvidence(p.doc, link.element, link.text) };
      if (pathRe && link.href) {
        try {
          const u = new URL(link.href);
          if (pathRe.test(u.pathname))
            return {
              found: [...elEvidence(p.doc, link.element, link.text), ev("url", link.href, page)],
            };
        } catch {
          // ignore
        }
      }
    }
    for (const b of p.doc.byTag("button")) {
      const t = p.doc.text(b, 200);
      if (text.test(t)) return { found: elEvidence(p.doc, b, t) };
    }
  }
  return { found: [] };
}

export function detectBooking(crawl: CrawlResult): DetectionResult {
  if (parsedPages(crawl).length === 0) return detection("no_booking_flow", "unknown", 0, []);
  const { found } = findSignal(
    crawl,
    BOOKING_HOSTS,
    BOOKING_TEXT,
    /\/(?:book(?:ing|ings)?|appointments?|reservations?)(?:\/|$)/i,
  );
  if (found.length > 0) return detection("no_booking_flow", "no", 0.8, found);
  return detection(
    "no_booking_flow",
    "yes",
    0.6,
    pagesChecked(crawl, "No booking keywords, links or known booking widgets"),
  );
}

const ORDERING_HOSTS =
  /(?:myshopify\.com|cdn\.shopify\.com|chowdeck\.com|glovoapp\.com|food\.jumia\.com|heyfood\.africa|ubereats\.com|doordash\.com|deliveroo\.|food\.bolt\.eu|ecwid\.com|bigcommerce\.com|paystack\.shop|selar\.(?:co|com)|flutterwave\.com\/store|order\.online|toasttab\.com|square\.site)/i;
const ORDERING_TEXT =
  /\b(?:add to (?:cart|basket|bag)|order (?:now|online|here|food)|buy now|shop now|place (?:an|your) order|view cart|checkout)\b/i;

export function detectOrdering(crawl: CrawlResult): DetectionResult {
  if (parsedPages(crawl).length === 0) return detection("no_online_ordering", "unknown", 0, []);
  const { found } = findSignal(
    crawl,
    ORDERING_HOSTS,
    ORDERING_TEXT,
    /\/(?:cart|checkout|basket|shop|store|order(?:-online)?)(?:\/|$)/i,
  );
  if (found.length > 0) return detection("no_online_ordering", "no", 0.8, found);
  for (const p of parsedPages(crawl)) {
    const woo = p.doc.elements.find((e) =>
      /\bwoocommerce\b|\bwc-block-cart\b|\bwixstores\b/i.test(e.attrs.class ?? ""),
    );
    if (woo)
      return detection(
        "no_online_ordering",
        "no",
        0.7,
        elEvidence(p.doc, woo, `class="${(woo.attrs.class ?? "").slice(0, 80)}"`),
      );
  }
  return detection(
    "no_online_ordering",
    "yes",
    0.6,
    pagesChecked(crawl, "No cart, checkout, order links or known ordering platforms"),
  );
}

export function detectWhatsApp(crawl: CrawlResult): DetectionResult {
  if (parsedPages(crawl).length === 0) return detection("no_whatsapp_link", "unknown", 0, []);
  for (const p of parsedPages(crawl)) {
    for (const link of p.doc.links()) {
      const target = link.href ?? link.raw;
      if (whatsappLinkNumber(target).isWhatsApp)
        return detection("no_whatsapp_link", "no", 0.95, [
          ...elEvidence(p.doc, link.element, link.text),
          ev("url", target, p.doc.url.toString()),
        ]);
    }
  }
  return detection(
    "no_whatsapp_link",
    "yes",
    0.7,
    pagesChecked(crawl, "No wa.me, api.whatsapp.com or whatsapp: links"),
  );
}

export function detectHttps(crawl: CrawlResult): DetectionResult {
  if (!crawl.home) return detection("no_https", "unknown", 0, []);
  const final = new URL(crawl.home.finalUrl ?? crawl.home.url);
  const page = final.toString();
  if (crawl.httpsFailure?.code === "TLS_INVALID") {
    return detection("no_https", "yes", 0.9, [
      ev(
        "text",
        `The HTTPS certificate was not valid (${crawl.httpsFailure.detail ?? "TLS error"}); the site answered over http`,
        crawl.startUrl,
      ),
    ]);
  }
  if (final.protocol === "https:") {
    const tls = crawl.tls;
    return detection("no_https", "no", 0.95, [
      ev("url", page, page),
      ...(tls?.issuer
        ? [
            ev(
              "header",
              `Certificate issuer: ${tls.issuer}${tls.validTo ? `, valid to ${tls.validTo}` : ""}`,
              page,
            ),
          ]
        : []),
    ]);
  }
  const probe = crawl.httpsProbe;
  if (probe?.ok)
    return detection("no_https", "no", 0.7, [
      ev("text", "The site is served over http; https also answered", page),
    ]);
  if (probe?.code === "TLS_INVALID")
    return detection("no_https", "yes", 0.9, [
      ev("url", page, page),
      ev("text", `HTTPS certificate not valid (${probe.detail ?? "TLS error"})`, page),
    ]);
  const reason = crawl.httpsFailure
    ? `https failed (${crawl.httpsFailure.code})`
    : probe
      ? `https did not answer (${probe.code ?? "error"})`
      : "served over http";
  return detection("no_https", "yes", 0.8, [
    ev("url", page, page),
    ev("text", `The site is served over http; ${reason}`, page),
  ]);
}

interface PlatformRule {
  name: RegExp;
  outdated: (major: number, minor: number) => boolean;
}
const PLATFORMS: PlatformRule[] = [
  { name: /^wordpress\b/i, outdated: (major) => major < 5 },
  { name: /^joomla!?/i, outdated: (major) => major < 3 },
  { name: /^drupal\b/i, outdated: (major) => major < 8 },
  { name: /^typo3\b/i, outdated: (major) => major < 9 },
];
const ALWAYS_OUTDATED = /microsoft frontpage|adobe golive|iweb|netobjects fusion/i;

export function detectPlatform(crawl: CrawlResult): DetectionResult {
  const home = crawl.home?.doc;
  if (!home) return detection("outdated_platform", "unknown", 0, []);
  const gen = home.meta("generator");
  if (!gen || !gen.content) return detection("outdated_platform", "unknown", 0, []);
  const value = gen.content.slice(0, 120);
  const evidence = elEvidence(home, gen.element, `generator: ${value}`);
  if (ALWAYS_OUTDATED.test(value))
    return detection("outdated_platform", "yes", 0.6, evidence, value);
  for (const rule of PLATFORMS) {
    if (!rule.name.test(value)) continue;
    // First version number in the string, e.g. "WordPress 4.9.8" gives 4 and 9.
    const version = /\d{1,4}[\d.]{0,15}/.exec(value)?.[0];
    if (!version) return detection("outdated_platform", "unknown", 0, evidence, value);
    const [major, minor] = version.split(".").map(Number);
    const outdated = rule.outdated(major ?? 0, minor ?? 0);
    return detection(
      "outdated_platform",
      outdated ? "yes" : "no",
      outdated ? 0.6 : 0.5,
      evidence,
      value,
    );
  }
  return detection("outdated_platform", "no", 0.4, evidence, value);
}

export function detectSeo(crawl: CrawlResult): DetectionResult {
  const home = crawl.home?.doc;
  if (!home) return detection("missing_seo_metadata", "unknown", 0, []);
  const page = home.url.toString();
  const title = home.title();
  const description = home.meta("description")?.content || null;
  const missing = [!title ? "title" : null, !description ? "meta description" : null].filter(
    Boolean,
  ) as string[];
  if (missing.length > 0)
    return detection("missing_seo_metadata", "yes", 0.9, [
      ev("text", `Not found on the home page: ${missing.join(" and ")}`, page),
    ]);
  return detection("missing_seo_metadata", "no", 0.9, [
    ev("text", `title: ${title}`, page),
    ev("text", `description: ${description}`, page),
  ]);
}

function pagesChecked(crawl: CrawlResult, note: string): DetectionEvidence[] {
  const pages = parsedPages(crawl);
  return [
    ...pages.map((p) => ev("url", p.doc.url.toString(), p.doc.url.toString())),
    ev("text", `${note} on ${pages.length} page${pages.length === 1 ? "" : "s"} checked`, null),
  ];
}

/** Every detection, in a stable order. When the site is unreachable the rest are unknown. */
export function runDetections(crawl: CrawlResult): DetectionResult[] {
  const reach = detectReachability(crawl);
  if (reach.observed !== "no") {
    const unknown = (
      [
        "mobile_unfriendly",
        "no_contact_form",
        "no_booking_flow",
        "no_online_ordering",
        "no_whatsapp_link",
        "no_https",
        "outdated_platform",
        "missing_seo_metadata",
      ] as DetectionKey[]
    ).map((k) => detection(k, "unknown", 0, []));
    return [reach, ...unknown];
  }
  return [
    reach,
    detectMobile(crawl),
    detectContactForm(crawl),
    detectBooking(crawl),
    detectOrdering(crawl),
    detectWhatsApp(crawl),
    detectHttps(crawl),
    detectPlatform(crawl),
    detectSeo(crawl),
  ];
}

/** One suggestion per observed gap, linked to the detection that carries its evidence. */
export function buildOpportunities(detections: DetectionResult[]): OpportunityResult[] {
  return detections
    .filter((d) => d.observed === "yes")
    .map((d) => {
      const o = OPPORTUNITIES[d.key];
      const first = d.evidence.find((e) => e.type === "text")?.value;
      const valueNote = d.observedValue ? ` Observed: ${d.observedValue}.` : "";
      return {
        key: o.key,
        title: o.title,
        rationale:
          `${d.label} on the pages checked.${first ? ` ${first}.` : ""}${valueNote}`.replace(
            /\.\./g,
            ".",
          ),
        confidence: d.confidence,
        detectionKeys: [d.key],
      };
    })
    .sort((a, b) => b.confidence - a.confidence);
}
