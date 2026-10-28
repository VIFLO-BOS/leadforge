import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SiteCrawler, type CrawlResult } from "../safe-fetch/site-crawler.js";
import {
  html,
  startServer,
  StubResolver,
  testFetcher,
  type TestServer,
} from "../safe-fetch/test-support.js";
import { ANALYSIS_FOLLOW } from "./website-analysis.runner.js";
import {
  buildOpportunities,
  DETECTION_LABELS,
  runDetections,
  type DetectionResult,
} from "./detectors.js";

/**
 * Detection fixtures (IMPLEMENTATION_PLAN Phase 4): pages with and without forms, booking
 * widgets and viewport meta, crawled through SafeFetch from local servers (no internet).
 */

const ROBOTS = html("User-agent: *\nAllow: /\n", 200, { "content-type": "text/plain" });

const MODERN_HOME = `<!doctype html><html><head>
<title>Mama Put Kitchen (Sample)</title>
<meta name="description" content="Home-style meals in Ikeja">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="generator" content="WordPress 6.4.2">
</head><body>
<nav><a href="/contact-us">Contact us</a> <a href="/about">About</a> <a href="/menu">Our menu</a></nav>
<a class="btn" href="https://calendly.com/mamaput/table">Book a table</a>
<a href="https://wa.me/2348031234567">Chat on WhatsApp</a>
<button>Add to cart</button>
</body></html>`;

const MODERN_CONTACT = `<!doctype html><html><head><title>Contact</title></head><body>
<form action="/send" method="post"><label>Email <input type="email" name="email"></label>
<label>Message <textarea name="message"></textarea></label><button type="submit">Send</button></form>
</body></html>`;

const OLD_HOME = `<html><head><meta name="generator" content="WordPress 4.9.8"><style>body { width: 980px; font-size: 10px }</style></head>
<body><table width="980"><tr><td><font size="1">Welcome to Old Bakery (Sample)</font></td></tr></table>
<form><input type="email" name="email" placeholder="Your email"><button>Subscribe to our newsletter</button></form>
<form role="search"><input name="q"></form>
<p>Call 0803 123 4567</p>
</body></html>`;

const EMBED_HOME = `<html><head><title>Embed Clinic (Sample)</title><meta name="description" content="Clinic"><meta name="viewport" content="width=device-width"></head>
<body><iframe src="https://docs.google.com/forms/d/e/abc/viewform?embedded=true"></iframe>
<script src="https://assets.calendly.com/assets/external/widget.js"></script>
<a href="https://chowdeck.com/store/embed-clinic">Order on Chowdeck</a></body></html>`;

let modern: TestServer;
let old: TestServer;
let embed: TestServer;

beforeAll(async () => {
  modern = await startServer({
    "/robots.txt": ROBOTS,
    "/": html(MODERN_HOME),
    "/contact-us": html(MODERN_CONTACT),
    "/about": html("<p>About</p>"),
    "/menu": html("<p>Menu</p>"),
  });
  old = await startServer({ "/robots.txt": ROBOTS, "/": html(OLD_HOME) });
  embed = await startServer({ "/robots.txt": ROBOTS, "/": html(EMBED_HOME) });
});

afterAll(async () => {
  await Promise.all([modern.close(), old.close(), embed.close()]);
});

async function crawl(url: string): Promise<CrawlResult> {
  const resolver = new StubResolver({
    "modern.example.ng": [{ address: "93.184.216.40", family: 4 }],
    "old.example.ng": [{ address: "93.184.216.41", family: 4 }],
    "embed.example.ng": [{ address: "93.184.216.42", family: 4 }],
  });
  const fetcher = testFetcher({
    resolver,
    dialMap: {
      "93.184.216.40": modern.port,
      "93.184.216.41": old.port,
      "93.184.216.42": embed.port,
    },
    config: { timeoutMs: 1_500 },
  });
  return new SiteCrawler(fetcher, async () => undefined).crawl(url, {
    maxPages: 5,
    follow: ANALYSIS_FOLLOW,
    retries: 2,
    retryDelayMs: 0,
  });
}

function byKey(detections: DetectionResult[]): Record<string, DetectionResult> {
  return Object.fromEntries(detections.map((d) => [d.key, d]));
}

describe("website detections", () => {
  it("sees a contact form, booking widget, ordering, WhatsApp, viewport and SEO metadata on a modern site", async () => {
    const result = await crawl("http://modern.example.ng/");
    expect(result.pages.map((p) => p.kind)).toEqual(["home", "contact", "about", "services"]);
    const d = byKey(runDetections(result));
    expect(d.website_unreachable!.observed).toBe("no");
    expect(d.no_contact_form).toMatchObject({
      observed: "no",
      label: "A contact form was detected",
    });
    expect(
      d.no_contact_form!.evidence.some(
        (e) => e.type === "selector" && e.value.includes("form") && e.page?.endsWith("/contact-us"),
      ),
    ).toBe(true);
    expect(d.no_booking_flow!.observed).toBe("no");
    expect(d.no_booking_flow!.evidence.some((e) => e.value.includes("calendly.com"))).toBe(true);
    expect(d.no_online_ordering!.observed).toBe("no");
    expect(d.no_whatsapp_link!.observed).toBe("no");
    expect(d.mobile_unfriendly!.observed).toBe("no");
    expect(d.missing_seo_metadata!.observed).toBe("no");
    expect(d.outdated_platform).toMatchObject({ observed: "no", observedValue: "WordPress 6.4.2" });
    // Served over http and nothing answers https on this host.
    expect(d.no_https!.observed).toBe("yes");
    expect(buildOpportunities(runDetections(result)).map((o) => o.key)).toEqual(["https_setup"]);
  });

  it("reports the gaps it can observe on an old site, with evidence and the observed version string only", async () => {
    const result = await crawl("http://old.example.ng/");
    const detections = runDetections(result);
    const d = byKey(detections);
    expect(d.mobile_unfriendly).toMatchObject({ observed: "yes", confidence: 0.8 });
    const mobileEvidence = d.mobile_unfriendly!.evidence.map((e) => e.value).join(" | ");
    expect(mobileEvidence).toMatch(/no meta\[name=viewport\]/);
    expect(mobileEvidence).toMatch(/table width="980"/);
    expect(mobileEvidence).toMatch(/font-size: 10px/);
    // A newsletter sign-up and a search box are not contact forms.
    expect(d.no_contact_form).toMatchObject({
      observed: "yes",
      label: "No contact form was detected",
      confidence: 0.6,
    });
    expect(d.no_booking_flow).toMatchObject({
      observed: "yes",
      label: "No booking flow was detected",
    });
    expect(d.no_online_ordering).toMatchObject({
      observed: "yes",
      label: "No online ordering flow was detected",
    });
    expect(d.no_whatsapp_link).toMatchObject({
      observed: "yes",
      label: "No WhatsApp link was detected",
    });
    expect(d.outdated_platform).toMatchObject({
      observed: "yes",
      observedValue: "WordPress 4.9.8",
    });
    expect(d.missing_seo_metadata!.observed).toBe("yes");
    expect(d.missing_seo_metadata!.evidence[0]!.value).toMatch(/title and meta description/);

    const opportunities = buildOpportunities(detections);
    expect(opportunities.map((o) => o.key).sort()).toEqual(
      [
        "contact_form",
        "https_setup",
        "mobile_friendly_site",
        "online_booking",
        "online_ordering",
        "platform_update",
        "seo_basics",
        "whatsapp_click_to_chat",
      ].sort(),
    );
    for (const o of opportunities) {
      // Every suggestion links to the detection that carries its evidence.
      expect(o.detectionKeys).toHaveLength(1);
      expect(d[o.detectionKeys[0]!]!.observed).toBe("yes");
      expect(d[o.detectionKeys[0]!]!.evidence.length).toBeGreaterThan(0);
    }
  });

  it("recognizes embedded form providers, booking scripts and delivery platforms", async () => {
    const d = byKey(runDetections(await crawl("http://embed.example.ng/")));
    expect(d.no_contact_form!.observed).toBe("no");
    expect(d.no_contact_form!.evidence.some((e) => e.value.includes("docs.google.com/forms"))).toBe(
      true,
    );
    expect(d.no_booking_flow!.observed).toBe("no");
    expect(d.no_online_ordering!.observed).toBe("no");
  });

  it("marks an unreachable website and leaves every other detection unknown", async () => {
    const result = await crawl("http://gone.example.ng/");
    const detections = runDetections(result);
    const d = byKey(detections);
    expect(d.website_unreachable).toMatchObject({
      observed: "yes",
      label: "No reachable website was detected",
    });
    expect(
      d.website_unreachable!.evidence.some(
        (e) => /did not resolve/.test(e.value) && /3 attempts/.test(e.value),
      ),
    ).toBe(true);
    expect(
      detections
        .filter((x) => x.key !== "website_unreachable")
        .every((x) => x.observed === "unknown" && x.confidence === 0),
    ).toBe(true);
    expect(buildOpportunities(detections).map((o) => o.key)).toEqual(["website_rebuild"]);
  });

  it("phrases every label as an observation, never as a claim about the business", () => {
    for (const [key, labels] of Object.entries(DETECTION_LABELS)) {
      for (const label of Object.values(labels)) {
        expect(label, key).not.toMatch(/\bhas no\b|\bdoes not have\b|\blacks\b/i);
        expect(label, key).toMatch(/detected|checked|reachable/);
      }
      if (key.startsWith("no_") || key === "website_unreachable")
        expect(labels.yes, key).toMatch(/^No .* was detected$/);
    }
  });
});
