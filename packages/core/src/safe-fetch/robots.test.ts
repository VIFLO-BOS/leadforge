import { describe, expect, it } from "vitest";
import { isAllowed, parseRobots, patternMatches, policyFromFetch, productToken } from "./robots.js";

const UA = "LeadForgeBot/1.0 (+https://leadforge.example/legal/data-collection)";

function rules(text: string) {
  return { kind: "rules" as const, groups: parseRobots(text) };
}

describe("robots.txt (RFC 9309)", () => {
  it("matches our product token case-insensitively and falls back to *", () => {
    expect(productToken(UA)).toBe("leadforgebot");
    const policy = rules(
      "User-agent: *\nDisallow: /\n\nUser-agent: leadforgebot\nDisallow: /private\n",
    );
    expect(isAllowed(policy, UA, "/")).toBe(true);
    expect(isAllowed(policy, UA, "/private/x")).toBe(false);
    expect(isAllowed(rules("User-agent: *\nDisallow: /\n"), UA, "/contact")).toBe(false);
    expect(isAllowed(rules("User-agent: OtherBot\nDisallow: /\n"), UA, "/contact")).toBe(true);
  });

  it("uses the longest match, and allow wins a tie", () => {
    const policy = rules(
      "User-agent: *\nDisallow: /shop\nAllow: /shop/contact\nDisallow: /a\nAllow: /a\n",
    );
    expect(isAllowed(policy, UA, "/shop/cart")).toBe(false);
    expect(isAllowed(policy, UA, "/shop/contact")).toBe(true);
    expect(isAllowed(policy, UA, "/a/page")).toBe(true);
  });

  it("supports * wildcards and the $ end anchor", () => {
    expect(patternMatches("/*.php$", "/index.php")).toBe(true);
    expect(patternMatches("/*.php$", "/index.php?x=1")).toBe(false);
    expect(patternMatches("/private*/", "/private-area/x")).toBe(true);
    expect(patternMatches("/fish", "/Fish")).toBe(false);
    const policy = rules("User-agent: *\nDisallow: /*?\n");
    expect(isAllowed(policy, UA, "/page?session=1")).toBe(false);
    expect(isAllowed(policy, UA, "/page")).toBe(true);
  });

  it("combines several groups for the same agent and ignores empty disallow and other directives", () => {
    const policy = rules(
      "User-agent: a\nUser-agent: leadforgebot\nDisallow: /x\nSitemap: https://x/s.xml\n\nUser-agent: LeadForgeBot\nDisallow:\nDisallow: /y\n",
    );
    expect(isAllowed(policy, UA, "/x")).toBe(false);
    expect(isAllowed(policy, UA, "/y")).toBe(false);
    expect(isAllowed(policy, UA, "/z")).toBe(true);
  });

  it("always allows /robots.txt itself", () => {
    expect(isAllowed(rules("User-agent: *\nDisallow: /\n"), UA, "/robots.txt")).toBe(true);
  });

  it("maps fetch outcomes: 4xx allows all, 5xx and network failures disallow all", () => {
    expect(policyFromFetch({ status: 404, body: null, error: null }).kind).toBe("allow_all");
    expect(policyFromFetch({ status: 503, body: null, error: null }).kind).toBe("disallow_all");
    expect(policyFromFetch({ status: null, body: null, error: "TOO_MANY_REDIRECTS" }).kind).toBe(
      "disallow_all",
    );
    expect(
      policyFromFetch({ status: 200, body: "User-agent: *\nDisallow: /a", error: null }).kind,
    ).toBe("rules");
  });
});
