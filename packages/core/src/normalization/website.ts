import type { SocialPlatform } from "@leadforge/contracts";
import { isIPv4 } from "node:net";
import { isDomainName } from "./dns.js";
import { cleanText } from "./text.js";
import { normalizeSocialProfile, socialPlatformForHost } from "./social.js";

export type WebsiteResult =
  | { ok: true; kind: "website"; url: string; domain: string }
  | { ok: true; kind: "social"; platform: SocialPlatform; url: string; handle: string | null }
  | { ok: false; reason: string };

const BLOCKED_SUFFIXES = [".local", ".internal", ".localhost", ".lan", ".home.arpa"];

/**
 * Canonical website: lowercase host (IDN to punycode), no `www.` in the domain, no query or
 * fragment, no trailing slash. The scheme is kept when present and assumed `https` when the
 * source omits it. Social profile URLs are classified as socials, never as the website, so
 * shared platform domains never drive domain deduplication. IP addresses, single-label hosts
 * and internal suffixes are rejected.
 */
export function canonicalizeWebsite(raw: string): WebsiteResult {
  let text = cleanText(raw);
  if (!text) return { ok: false, reason: "Empty" };
  if (/\s/.test(text)) return { ok: false, reason: "Contains spaces" };
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(text)) {
    if (/^[a-z][a-z0-9+.-]*:/i.test(text) && !/^[^:]+:\d+/.test(text)) {
      return { ok: false, reason: "Only http and https links are accepted" };
    }
    text = `https://${text.replace(/^\/+/, "")}`;
  }

  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return { ok: false, reason: "Not a valid web address" };
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return { ok: false, reason: "Only http and https links are accepted" };
  }
  if (url.username || url.password)
    return { ok: false, reason: "Credentials in URLs are not accepted" };

  const host = url.hostname.replace(/\.$/, "");
  if (!host || host.startsWith("[") || isIPv4(host)) {
    return { ok: false, reason: "IP addresses are not accepted as websites" };
  }
  const labels = host.split(".");
  if (labels.length < 2) return { ok: false, reason: "Missing domain ending" };
  if (host === "localhost" || BLOCKED_SUFFIXES.some((s) => host.endsWith(s))) {
    return { ok: false, reason: "Internal host names are not accepted" };
  }
  if (!isDomainName(host, { allowUnderscore: true })) {
    return { ok: false, reason: "Not a valid domain" };
  }

  const domain = host.replace(/^www\d{0,3}\./, "");
  const path = url.pathname === "/" ? "" : url.pathname.replace(/\/+$/, "");

  // Social platforms are never a business's website: a profile link becomes a social profile,
  // anything else on those hosts (share links, posts) is refused.
  const platform: SocialPlatform | null = socialPlatformForHost(host);
  if (platform) {
    const profile = normalizeSocialProfile(url.toString());
    if (!profile)
      return { ok: false, reason: `That is a ${platform} link, not a profile or a website` };
    return {
      ok: true,
      kind: "social",
      platform: profile.platform,
      url: profile.url,
      handle: profile.handle,
    };
  }

  const port = url.port ? `:${url.port}` : "";
  return { ok: true, kind: "website", url: `${url.protocol}//${host}${port}${path}`, domain };
}
