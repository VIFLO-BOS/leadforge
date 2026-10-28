import type { SocialPlatform } from "@leadforge/contracts";
import { cleanText } from "./text.js";

export interface SocialProfile {
  platform: SocialPlatform;
  /** Canonical profile URL: https, bare platform host, lowercase handle, no query or fragment. */
  url: string;
  handle: string | null;
}

export const SOCIAL_HOSTS: Record<string, SocialPlatform> = {
  "facebook.com": "facebook",
  "fb.com": "facebook",
  "fb.me": "facebook",
  "instagram.com": "instagram",
  "instagr.am": "instagram",
  "linkedin.com": "linkedin",
  "twitter.com": "x",
  "x.com": "x",
  "tiktok.com": "tiktok",
  "youtube.com": "youtube",
  "youtu.be": "youtube",
};

const CANONICAL_HOST: Record<SocialPlatform, string> = {
  facebook: "facebook.com",
  instagram: "instagram.com",
  linkedin: "linkedin.com",
  x: "x.com",
  tiktok: "tiktok.com",
  youtube: "youtube.com",
};

/** First path segments that are features, not profiles (share links, posts, logins...). */
const RESERVED: Record<SocialPlatform, Set<string>> = {
  facebook: new Set([
    "sharer",
    "sharer.php",
    "share",
    "share.php",
    "dialog",
    "plugins",
    "tr",
    "login",
    "login.php",
    "groups",
    "events",
    "photo.php",
    "photo",
    "photos",
    "watch",
    "story.php",
    "permalink.php",
    "hashtag",
    "help",
    "policies",
    "l.php",
    "privacy",
    "marketplace",
    "gaming",
    "reel",
    "reels",
    "video.php",
    "home.php",
    "search",
  ]),
  instagram: new Set([
    "p",
    "reel",
    "reels",
    "explore",
    "stories",
    "accounts",
    "tv",
    "direct",
    "about",
    "developer",
    "legal",
    "web",
    "challenge",
  ]),
  x: new Set([
    "intent",
    "share",
    "home",
    "search",
    "hashtag",
    "i",
    "settings",
    "login",
    "signup",
    "explore",
    "messages",
    "notifications",
    "tos",
    "privacy",
    "compose",
  ]),
  linkedin: new Set([]),
  tiktok: new Set([]),
  youtube: new Set([]),
};

const HANDLE = /^[\p{L}\p{N}._-]{1,100}$/u;

function decode(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

/** Platform for a host (`m.`, `www.`, `web.`, `mobile.`, `business.` and LinkedIn country prefixes ignored). */
export function socialPlatformForHost(host: string): SocialPlatform | null {
  const h = host.toLowerCase().replace(/\.$/, "");
  if (SOCIAL_HOSTS[h]) return SOCIAL_HOSTS[h];
  return SOCIAL_HOSTS[h.replace(/^(?:www|m|mobile|web|business|[a-z]{2})\./, "")] ?? null;
}

/**
 * Canonical social profile URL, or null when the link is not a profile (a share button, a
 * post, a login page). Handles are lowercased: the six platforms treat them case-insensitively,
 * except YouTube channel ids, which are kept as written.
 */
export function normalizeSocialProfile(raw: string): SocialProfile | null {
  let text = cleanText(raw);
  if (!text) return null;
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(text)) text = `https://${text.replace(/^\/+/, "")}`;
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  const platform = socialPlatformForHost(url.hostname);
  if (!platform) return null;
  const host = CANONICAL_HOST[platform];
  const segments = url.pathname.split("/").filter(Boolean).map(decode);
  const first = segments[0]?.toLowerCase() ?? "";
  if (!first) return null;
  if (RESERVED[platform].has(first)) {
    // Facebook numeric profiles live under profile.php?id=.
    return null;
  }

  switch (platform) {
    case "facebook": {
      if (first === "profile.php") {
        const id = url.searchParams.get("id");
        return id && /^\d{1,30}$/.test(id)
          ? { platform, url: `https://${host}/profile.php?id=${id}`, handle: id }
          : null;
      }
      if (first === "pages" && segments.length >= 2) {
        const id = segments.find((s) => /^\d{5,30}$/.test(s)) ?? null;
        const name = segments[1]!.toLowerCase();
        return {
          platform,
          url: `https://${host}/pages/${encodeURIComponent(name)}${id ? `/${id}` : ""}`,
          handle: id ?? name,
        };
      }
      if (first === "people" && segments.length >= 3) {
        const id = segments[2]!;
        return /^\d{1,30}$/.test(id)
          ? { platform, url: `https://${host}/profile.php?id=${id}`, handle: id }
          : null;
      }
      if (!HANDLE.test(first) || first.endsWith(".php")) return null;
      return { platform, url: `https://${host}/${first}`, handle: first };
    }
    case "instagram":
    case "x": {
      const handle = first.replace(/^@/, "");
      if (!HANDLE.test(handle)) return null;
      return { platform, url: `https://${host}/${handle}`, handle };
    }
    case "linkedin": {
      if (!["company", "in", "school", "showcase"].includes(first) || !segments[1]) return null;
      const slug = segments[1].toLowerCase();
      if (!HANDLE.test(slug)) return null;
      return { platform, url: `https://${host}/${first}/${slug}`, handle: slug };
    }
    case "tiktok": {
      if (!first.startsWith("@")) return null;
      const handle = first.slice(1);
      if (!HANDLE.test(handle)) return null;
      return { platform, url: `https://${host}/@${handle}`, handle };
    }
    case "youtube": {
      if (url.hostname.toLowerCase().endsWith("youtu.be")) return null; // a video link
      if (first.startsWith("@")) {
        const handle = first.slice(1);
        return HANDLE.test(handle) ? { platform, url: `https://${host}/@${handle}`, handle } : null;
      }
      if (first === "channel" && segments[1] && /^[A-Za-z0-9_-]{10,40}$/.test(segments[1])) {
        return { platform, url: `https://${host}/channel/${segments[1]}`, handle: segments[1] };
      }
      if ((first === "c" || first === "user") && segments[1] && HANDLE.test(segments[1])) {
        const name = segments[1].toLowerCase();
        return { platform, url: `https://${host}/${first}/${name}`, handle: name };
      }
      return null;
    }
  }
}
