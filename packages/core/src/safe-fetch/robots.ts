/**
 * robots.txt per RFC 9309. Groups are selected by the crawler's product token (case
 * insensitive), falling back to `*`; several groups for the same agent are combined. The
 * longest matching rule wins and `allow` wins a tie. `*` matches any characters and a final
 * `$` anchors the end. `/robots.txt` itself is always allowed.
 *
 * Fetch outcomes (section 2.3.1): a 2xx body is parsed; a 4xx means "no rules" (allow all);
 * a 5xx, a network failure or a redirect loop means "unreachable" (disallow all).
 */

export interface RobotsRule {
  allow: boolean;
  pattern: string;
}

export interface RobotsGroup {
  agents: string[];
  rules: RobotsRule[];
}

export type RobotsPolicy =
  | { kind: "allow_all"; reason: string }
  | { kind: "disallow_all"; reason: string }
  | { kind: "rules"; groups: RobotsGroup[] };

/** robots.txt files over this size are cut here (RFC 9309 requires at least 500 KiB). */
export const ROBOTS_MAX_BYTES = 500 * 1024;

export function parseRobots(text: string): RobotsGroup[] {
  const groups: RobotsGroup[] = [];
  let current: RobotsGroup | null = null;
  let lastWasAgent = false;
  for (const rawLine of text.slice(0, ROBOTS_MAX_BYTES).split(/\r\n|\r|\n/)) {
    const line = rawLine.replace(/#.*$/, "").trim();
    if (!line) continue;
    const colon = line.indexOf(":");
    if (colon <= 0) continue;
    const key = line.slice(0, colon).trim().toLowerCase();
    const value = line.slice(colon + 1).trim();
    if (key === "user-agent") {
      if (!current || !lastWasAgent) {
        current = { agents: [], rules: [] };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
      continue;
    }
    if (key === "allow" || key === "disallow") {
      lastWasAgent = false;
      if (!current) continue; // rules before any user-agent line belong to no group
      if (key === "disallow" && value === "") continue; // empty disallow: no rule
      if (value === "") continue;
      current.rules.push({ allow: key === "allow", pattern: value });
      continue;
    }
    // Other directives (sitemap, crawl-delay) end a run of user-agent lines but add no rules.
    lastWasAgent = false;
  }
  return groups;
}

/** Product token of a user agent string: "LeadForgeBot/1.0 (+https://...)" gives "leadforgebot". */
export function productToken(userAgent: string): string {
  return (userAgent.split(/[/\s]/)[0] ?? "").toLowerCase();
}

function selectRules(groups: RobotsGroup[], token: string): RobotsRule[] | null {
  const own = groups.filter((g) => g.agents.includes(token));
  if (own.length > 0) return own.flatMap((g) => g.rules);
  const star = groups.filter((g) => g.agents.includes("*"));
  if (star.length > 0) return star.flatMap((g) => g.rules);
  return null;
}

/** Normalizes percent-encoding case so `/%7euser` and `/%7Euser` compare equal. */
function normalizePath(path: string): string {
  return path.replace(/%[0-9a-f]{2}/gi, (m) => m.toUpperCase());
}

/** Linear-time wildcard match of a robots pattern against a path (no regular expressions). */
export function patternMatches(pattern: string, path: string): boolean {
  const anchored = pattern.endsWith("$");
  const pat = normalizePath(anchored ? pattern.slice(0, -1) : pattern);
  const text = normalizePath(path);
  const pieces = pat.split("*");
  // First piece must be a prefix.
  const first = pieces[0]!;
  if (!text.startsWith(first)) return false;
  let pos = first.length;
  if (pieces.length === 1) return anchored ? pos === text.length : true;
  for (let i = 1; i < pieces.length; i++) {
    const piece = pieces[i]!;
    const last = i === pieces.length - 1;
    if (last && anchored) {
      // The final piece must end the text and start at or after pos.
      return text.length - piece.length >= pos && text.endsWith(piece);
    }
    if (piece === "") continue;
    const found = text.indexOf(piece, pos);
    if (found < 0) return false;
    pos = found + piece.length;
  }
  return true;
}

/** Decides whether `path` (path plus query) may be fetched under `policy` for this agent. */
export function isAllowed(policy: RobotsPolicy, userAgent: string, path: string): boolean {
  if (path === "/robots.txt") return true;
  if (policy.kind === "allow_all") return true;
  if (policy.kind === "disallow_all") return false;
  const rules = selectRules(policy.groups, productToken(userAgent));
  if (!rules || rules.length === 0) return true;
  let best: RobotsRule | null = null;
  for (const rule of rules) {
    if (!patternMatches(rule.pattern, path)) continue;
    const length = rule.pattern.length;
    if (
      !best ||
      length > best.pattern.length ||
      (length === best.pattern.length && rule.allow && !best.allow)
    )
      best = rule;
  }
  return best ? best.allow : true;
}

/** Policy from a robots.txt fetch outcome. */
export function policyFromFetch(outcome: {
  status: number | null;
  body: string | null;
  error: string | null;
}): RobotsPolicy {
  if (outcome.error !== null || outcome.status === null) {
    return {
      kind: "disallow_all",
      reason: `robots.txt unreachable (${outcome.error ?? "no response"}); treated as disallow all`,
    };
  }
  if (outcome.status >= 500)
    return {
      kind: "disallow_all",
      reason: `robots.txt returned ${outcome.status}; treated as disallow all`,
    };
  if (outcome.status >= 400)
    return { kind: "allow_all", reason: `robots.txt returned ${outcome.status}; no rules apply` };
  if (outcome.status >= 200 && outcome.status < 300)
    return { kind: "rules", groups: parseRobots(outcome.body ?? "") };
  return {
    kind: "disallow_all",
    reason: `robots.txt returned ${outcome.status}; treated as disallow all`,
  };
}
