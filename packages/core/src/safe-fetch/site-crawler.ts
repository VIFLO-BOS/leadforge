import { HtmlDocument } from "../html/html-document.js";
import { SafeFetch, SafeFetchError, type SafeFetchResponse, type TlsInfo } from "./safe-fetch.js";
import { isAllowed } from "./robots.js";

/**
 * Bounded crawl of a business's own website through SafeFetch: the home page (with retries
 * for transient failures and an http fallback when https fails), then at most `maxPages - 1`
 * same-site pages linked from it (contact, about, services or menu, booking). Used by website
 * analysis and website-contacts enrichment. Pages are parsed in memory and never stored.
 */

export type PageKind = "home" | "contact" | "about" | "services" | "booking";

export interface CrawledPage {
  kind: PageKind;
  url: string;
  finalUrl: string | null;
  status: number | null;
  doc: HtmlDocument | null;
  response: SafeFetchResponse | null;
  error: { code: string; message: string; detail: string | null } | null;
}

export interface CrawlFailure {
  code: string;
  message: string;
  detail: string | null;
  status: number | null;
  attempts: number;
}

export interface CrawlResult {
  startUrl: string;
  /** Host of the start URL without `www.`: the business's own site. */
  siteHost: string;
  /** The home page when it was fetched and parsed. */
  home: CrawledPage | null;
  /** Why the home page could not be analyzed (after retries), else null. */
  homeFailure: CrawlFailure | null;
  /** The https attempt that failed before an http fallback, if any. */
  httpsFailure: { code: string; detail: string | null } | null;
  /** For a site served over http: whether https answered (`null` when not probed). */
  httpsProbe: { ok: boolean; code: string | null; detail: string | null } | null;
  pages: CrawledPage[];
  robots: { fetched: boolean; allowed: boolean | null };
  tls: TlsInfo | null;
}

export interface CrawlOptions {
  maxPages: number;
  /** Linked pages to look for, in priority order. */
  follow: Array<Exclude<PageKind, "home">>;
  /** Extra attempts for the home page on transient failures. */
  retries: number;
  retryDelayMs: number;
}

const TRANSIENT = new Set(["TIMEOUT", "CONNECTION_FAILED", "DNS_FAILED", "RATE_LIMITED"]);
const SKIP_EXT =
  /\.(?:pdf|jpe?g|png|gif|webp|svg|zip|rar|docx?|xlsx?|pptx?|mp4|mp3|mov|avi|apk|exe|dmg|ics|css|js|xml|json)$/i;

const KIND_PATTERNS: Record<Exclude<PageKind, "home">, { path: RegExp; text: RegExp }> = {
  contact: {
    path: /contact|get-in-touch|reach-us|enquir|inquir/i,
    text: /\bcontact\b|get in touch|reach us|enquir|inquir/i,
  },
  about: { path: /about|who-we-are|our-story|company/i, text: /\babout\b|who we are|our story/i },
  services: {
    path: /services|menu|products|pricing|price-list|treatments/i,
    text: /\bservices\b|\bmenu\b|\bproducts\b|pricing|price list|treatments/i,
  },
  booking: {
    path: /book|appointment|reserv|schedule/i,
    text: /\bbook\b|booking|appointment|reserv|schedule/i,
  },
};

export function sameSite(host: string, siteHost: string): boolean {
  const h = host.toLowerCase().replace(/^www\d{0,3}\./, "");
  const s = siteHost.toLowerCase().replace(/^www\d{0,3}\./, "");
  return h === s || h.endsWith(`.${s}`) || s.endsWith(`.${h}`);
}

function failureOf(err: unknown, attempts: number): CrawlFailure {
  if (err instanceof SafeFetchError)
    return { code: err.code, message: err.message, detail: err.detail, status: null, attempts };
  return {
    code: "FETCH_ERROR",
    message: err instanceof Error ? err.message : String(err),
    detail: null,
    status: null,
    attempts,
  };
}

export class SiteCrawler {
  constructor(
    private readonly fetcher: SafeFetch,
    private readonly sleep: (ms: number) => Promise<void> = (ms) =>
      new Promise((r) => setTimeout(r, ms)),
  ) {}

  /** Home page with retries; non-2xx statuses after the retries count as failures. */
  private async fetchHome(
    url: string,
    retries: number,
    delayMs: number,
  ): Promise<{ res: SafeFetchResponse | null; failure: CrawlFailure | null }> {
    let failure: CrawlFailure | null = null;
    for (let attempt = 1; attempt <= retries + 1; attempt++) {
      try {
        const res = await this.fetcher.fetch(url);
        if (res.status >= 200 && res.status < 300) return { res, failure: null };
        failure = {
          code: "HTTP_STATUS",
          message: `The page returned HTTP ${res.status}`,
          detail: String(res.status),
          status: res.status,
          attempts: attempt,
        };
        if (res.status < 500 && res.status !== 429 && res.status !== 408)
          return { res: null, failure };
      } catch (err) {
        failure = failureOf(err, attempt);
        if (!(err instanceof SafeFetchError) || !TRANSIENT.has(err.code))
          return { res: null, failure };
      }
      if (attempt <= retries) await this.sleep(delayMs * attempt);
    }
    return { res: null, failure };
  }

  async crawl(startUrl: string, options: CrawlOptions): Promise<CrawlResult> {
    const start = new URL(startUrl);
    const result: CrawlResult = {
      startUrl,
      siteHost: start.hostname.replace(/^www\d{0,3}\./, ""),
      home: null,
      homeFailure: null,
      httpsFailure: null,
      httpsProbe: null,
      pages: [],
      robots: { fetched: false, allowed: null },
      tls: null,
    };

    let homeUrl = start.toString();
    let { res, failure } = await this.fetchHome(homeUrl, options.retries, options.retryDelayMs);
    if (
      !res &&
      failure &&
      start.protocol === "https:" &&
      ["TLS_INVALID", "CONNECTION_FAILED", "TIMEOUT"].includes(failure.code)
    ) {
      // https failed: record why, then try the same page over http.
      result.httpsFailure = { code: failure.code, detail: failure.detail };
      const http = new URL(start.toString());
      http.protocol = "http:";
      if (http.port === "443") http.port = "";
      homeUrl = http.toString();
      ({ res, failure } = await this.fetchHome(
        homeUrl,
        Math.min(1, options.retries),
        options.retryDelayMs,
      ));
    }

    // Robots: what the policy says for the home page (the fetch above already honored it).
    try {
      const target = new URL(res?.url ?? homeUrl);
      const policy = await this.fetcher.robotsPolicy(target);
      result.robots = {
        fetched: true,
        allowed: isAllowed(
          policy,
          this.fetcher.config.userAgent,
          `${target.pathname}${target.search}`,
        ),
      };
    } catch {
      result.robots = { fetched: false, allowed: null };
    }
    if (failure?.code === "ROBOTS_DISALLOWED") result.robots = { fetched: true, allowed: false };

    if (!res) {
      result.homeFailure = failure;
      result.pages.push({
        kind: "home",
        url: homeUrl,
        finalUrl: null,
        status: failure?.status ?? null,
        doc: null,
        response: null,
        error: failure
          ? { code: failure.code, message: failure.message, detail: failure.detail }
          : null,
      });
      return result;
    }

    let doc: HtmlDocument | null = null;
    try {
      doc = HtmlDocument.parse(res.body, res.url);
    } catch {
      doc = null;
    }
    const home: CrawledPage = {
      kind: "home",
      url: homeUrl,
      finalUrl: res.url,
      status: res.status,
      doc,
      response: res,
      error: doc
        ? null
        : { code: "PARSE_FAILED", message: "The page could not be parsed", detail: null },
    };
    result.home = home;
    result.pages.push(home);
    result.tls = res.tls;

    // Served over http: does https answer at all? One attempt, not counted as a page.
    if (new URL(res.url).protocol === "http:") {
      const probe = new URL(res.url);
      probe.protocol = "https:";
      if (probe.port === "80") probe.port = "";
      try {
        const p = await this.fetcher.fetch(probe.toString());
        result.httpsProbe = {
          ok: p.status < 400 && new URL(p.url).protocol === "https:",
          code: p.status < 400 ? null : "HTTP_STATUS",
          detail: String(p.status),
        };
      } catch (err) {
        result.httpsProbe = {
          ok: false,
          code: err instanceof SafeFetchError ? err.code : "FETCH_ERROR",
          detail: err instanceof SafeFetchError ? err.detail : null,
        };
      }
    }

    if (!doc) return result;
    const finalHost = new URL(res.url).hostname;
    const candidates = this.candidateLinks(doc, finalHost, result.siteHost, options);
    for (const c of candidates.slice(0, Math.max(0, options.maxPages - 1))) {
      try {
        const page = await this.fetcher.fetch(c.url);
        const ok = page.status >= 200 && page.status < 300;
        let pageDoc: HtmlDocument | null = null;
        if (ok) {
          try {
            pageDoc = HtmlDocument.parse(page.body, page.url);
          } catch {
            pageDoc = null;
          }
        }
        result.pages.push({
          kind: c.kind,
          url: c.url,
          finalUrl: page.url,
          status: page.status,
          doc: pageDoc,
          response: page,
          error: ok
            ? null
            : {
                code: "HTTP_STATUS",
                message: `The page returned HTTP ${page.status}`,
                detail: String(page.status),
              },
        });
      } catch (err) {
        const f = failureOf(err, 1);
        result.pages.push({
          kind: c.kind,
          url: c.url,
          finalUrl: null,
          status: null,
          doc: null,
          response: null,
          error: { code: f.code, message: f.message, detail: f.detail },
        });
      }
    }
    return result;
  }

  /** Same-site links for each wanted kind, first match per kind, in priority order. */
  candidateLinks(
    doc: HtmlDocument,
    finalHost: string,
    siteHost: string,
    options: Pick<CrawlOptions, "follow">,
  ): Array<{ kind: Exclude<PageKind, "home">; url: string }> {
    const chosen: Array<{ kind: Exclude<PageKind, "home">; url: string }> = [];
    const seen = new Set<string>([doc.url.toString().replace(/#.*$/, "")]);
    const links = doc.links().filter((l) => l.href !== null);
    for (const kind of options.follow) {
      const pattern = KIND_PATTERNS[kind];
      for (const link of links) {
        let url: URL;
        try {
          url = new URL(link.href!);
        } catch {
          continue;
        }
        url.hash = "";
        const key = url.toString();
        if (seen.has(key)) continue;
        if (url.protocol !== "http:" && url.protocol !== "https:") continue;
        if (!sameSite(url.hostname, siteHost) && !sameSite(url.hostname, finalHost)) continue;
        if (SKIP_EXT.test(url.pathname)) continue;
        if (pattern.path.test(url.pathname) || pattern.text.test(link.text)) {
          chosen.push({ kind, url: key });
          seen.add(key);
          break;
        }
      }
    }
    return chosen;
  }
}
