import { NIGERIAN_STATES } from "@leadforge/contracts";
import { isPhoneCountry, phoneCountries } from "./phone.js";
import { cleanText, normalizeKey, titleCaseIfUniform } from "./text.js";

// The state list lives in contracts so the web app can use it too; re-exported for core callers.
export { NIGERIAN_STATES };

const NG_STATE_BY_KEY = new Map<string, string>(NIGERIAN_STATES.map((s) => [s.toLowerCase(), s]));
const NG_ALIASES: Record<string, string> = {
  fct: "Federal Capital Territory",
  abuja: "Federal Capital Territory",
  "fct abuja": "Federal Capital Territory",
  "abuja fct": "Federal Capital Territory",
  "federal capital territory abuja": "Federal Capital Territory",
  nassarawa: "Nasarawa",
  "akwa-ibom": "Akwa Ibom",
  akwaibom: "Akwa Ibom",
  "cross-river": "Cross River",
  crossriver: "Cross River",
};

function regionLookupKey(raw: string): string {
  return normalizeKey(raw)
    .replace(/[_.]/g, " ")
    .replace(/\s+state$/, "")
    .replace(/^state of\s+/, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Canonical Nigerian state name for common spellings, or null. */
export function nigerianState(raw: string): string | null {
  const key = regionLookupKey(raw);
  return NG_STATE_BY_KEY.get(key) ?? NG_ALIASES[key] ?? NG_ALIASES[key.replace(/\s/g, "")] ?? null;
}

/** Display form of a region: canonical for Nigerian states, otherwise tidied as typed. */
export function normalizeRegion(raw: string, country: string | null): string {
  const cleaned = cleanText(raw);
  if (!country || country === "NG") {
    const state = nigerianState(cleaned);
    if (state) return state;
  }
  return titleCaseIfUniform(cleaned);
}

/** Filter/facet key for a region; "Lagos State", "LAGOS" and "lagos" share one key. */
export function regionKey(raw: string): string {
  const state = nigerianState(raw);
  return normalizeKey(state ?? raw);
}

export function normalizePlace(raw: string): string {
  return titleCaseIfUniform(cleanText(raw));
}

export function placeKey(raw: string): string {
  return normalizeKey(raw);
}

let countryNames: Map<string, string> | null = null;

function countryNameIndex(): Map<string, string> {
  if (countryNames) return countryNames;
  const names = new Map<string, string>();
  const display = new Intl.DisplayNames(["en"], { type: "region" });
  for (const code of phoneCountries()) {
    const name = display.of(code);
    if (name) names.set(normalizeKey(name), code);
  }
  const aliases: Record<string, string> = {
    uk: "GB",
    "great britain": "GB",
    england: "GB",
    usa: "US",
    "united states of america": "US",
    america: "US",
    "ivory coast": "CI",
    "cote d'ivoire": "CI",
    naija: "NG",
  };
  for (const [alias, code] of Object.entries(aliases)) names.set(alias, code);
  countryNames = names;
  return names;
}

/** ISO 3166-1 alpha-2 code from a code or an English country name, or null. */
export function parseCountry(raw: string): string | null {
  const cleaned = cleanText(raw);
  if (!cleaned) return null;
  const upper = cleaned.toUpperCase();
  if (/^[A-Z]{2}$/.test(upper)) {
    if (upper === "UK") return "GB";
    return isPhoneCountry(upper) ? upper : null;
  }
  return countryNameIndex().get(normalizeKey(cleaned)) ?? null;
}

export function countryName(code: string | null): string | null {
  if (!code) return null;
  try {
    return new Intl.DisplayNames(["en"], { type: "region" }).of(code) ?? code;
  } catch {
    return code;
  }
}

export interface LocationParts {
  street: string | null;
  locality: string | null;
  lga: string | null;
  region: string | null;
  country: string | null;
  postalCode: string | null;
}

export function formatLocation(parts: LocationParts): string | null {
  const segments = [
    parts.street,
    parts.locality,
    parts.lga,
    parts.region,
    countryName(parts.country),
  ]
    .map((s) => (s ? s.trim() : ""))
    .filter((s) => s.length > 0);
  const unique = segments.filter(
    (s, i) => segments.findIndex((o) => o.toLowerCase() === s.toLowerCase()) === i,
  );
  return unique.length > 0 ? unique.join(", ") : null;
}
