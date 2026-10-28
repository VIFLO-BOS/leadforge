import type { ErrorDetail, LocationInput, SocialPlatform } from "@leadforge/contracts";
import {
  BUSINESS_NAME_MAX,
  canonicalizeWebsite,
  cleanText,
  formatLocation,
  normalizeBusinessName,
  normalizeEmail,
  normalizeKey,
  normalizePlace,
  normalizeRegion,
  parsePhone,
  placeKey,
  regionKey,
  type LocationParts,
  type ParsedPhone,
} from "../normalization/index.js";

/** A normalized business as produced by import rows, manual creation and (later) discovery. */
export interface PhoneInput extends ParsedPhone {
  raw: string;
  whatsapp: "user_asserted" | "unknown";
}
export interface EmailInput {
  address: string;
  domain: string;
  raw: string;
}
export interface WebsiteInput {
  url: string;
  domain: string;
  raw: string;
}
export interface SocialInput {
  platform: SocialPlatform;
  url: string;
  handle: string | null;
  raw: string;
}
export interface CategoryInput {
  value: string;
  key: string;
  raw: string;
}
export interface NormalizedLocation extends LocationParts {
  formatted: string | null;
  raw: string | null;
  regionKey: string | null;
  localityKey: string | null;
  lgaKey: string | null;
}
export interface BusinessInput {
  name: { value: string; normalized: string; raw: string };
  categories: CategoryInput[];
  website: WebsiteInput | null;
  socials: SocialInput[];
  phones: PhoneInput[];
  emails: EmailInput[];
  location: NormalizedLocation | null;
}

export const MAX_CATEGORIES = 10;
export const CATEGORY_MAX_LENGTH = 80;

export function categoryInput(raw: string): CategoryInput | null {
  const value = cleanText(raw);
  if (!value) return null;
  return { value, key: normalizeKey(value), raw };
}

/**
 * Builds a normalized location from raw parts; null when every part is empty. `country` may be
 * a default (the organization's or the import's); `observedCountry` is what the source actually
 * said, so `raw` only ever contains observed text.
 */
export function buildLocation(
  parts: Partial<Record<keyof LocationParts, string | null | undefined>>,
  observedCountry: string | null = parts.country ?? null,
): NormalizedLocation | null {
  const country = parts.country ? cleanText(parts.country).toUpperCase() || null : null;
  const street = parts.street ? cleanText(parts.street) || null : null;
  const locality = parts.locality ? normalizePlace(parts.locality) || null : null;
  const lga = parts.lga ? normalizePlace(parts.lga) || null : null;
  const region = parts.region ? normalizeRegion(parts.region, country) || null : null;
  const postalCode = parts.postalCode ? cleanText(parts.postalCode).toUpperCase() || null : null;
  if (!street && !locality && !lga && !region && !postalCode && !country) return null;
  const location: LocationParts = { street, locality, lga, region, country, postalCode };
  const raw = [
    parts.street,
    parts.locality,
    parts.lga,
    parts.region,
    parts.postalCode,
    observedCountry,
  ]
    .map((p) => (p ? cleanText(p) : ""))
    .filter(Boolean)
    .join(", ");
  return {
    ...location,
    formatted: formatLocation(location),
    raw: raw || null,
    regionKey: region ? regionKey(region) : null,
    localityKey: locality ? placeKey(locality) : null,
    lgaKey: lga ? placeKey(lga) : null,
  };
}

/** True when the location carries at least one component a person would call an address. */
export function hasLocationValue(
  loc:
    | Pick<LocationParts, "street" | "locality" | "lga" | "region" | "country" | "postalCode">
    | null
    | undefined,
): boolean {
  return Boolean(
    loc && (loc.street || loc.locality || loc.lga || loc.region || loc.postalCode || loc.country),
  );
}

/**
 * Normalizes a manual-create request. Returns validation details instead of throwing so
 * the caller can raise one VALIDATION_FAILED with every problem listed.
 */
export function normalizeCreateRequest(
  req: {
    name: string;
    categories: string[];
    website?: string | undefined;
    phones: string[];
    emails: string[];
    location?: LocationInput | undefined;
  },
  defaultCountry: string,
): { input: BusinessInput | null; errors: ErrorDetail[] } {
  const errors: ErrorDetail[] = [];
  const name = normalizeBusinessName(req.name);
  if (!name.value) errors.push({ path: "name", message: "Name is required" });
  if (name.value.length > BUSINESS_NAME_MAX)
    errors.push({ path: "name", message: "Name is too long" });

  const loc = req.location;
  const anyPart = Boolean(
    loc && (loc.street || loc.locality || loc.lga || loc.region || loc.postalCode),
  );
  // A location typed without a country is taken to be in the organization's country.
  const country = loc?.country ?? (anyPart ? defaultCountry : null);
  const regionCountry = country ?? defaultCountry;
  const location = loc
    ? buildLocation(
        {
          street: loc.street ?? null,
          locality: loc.locality ?? null,
          lga: loc.lga ?? null,
          region: loc.region ?? null,
          country,
          postalCode: loc.postalCode ?? null,
        },
        loc.country ?? null,
      )
    : null;

  let website: WebsiteInput | null = null;
  const socials: SocialInput[] = [];
  if (req.website) {
    const w = canonicalizeWebsite(req.website);
    if (!w.ok) errors.push({ path: "website", message: w.reason });
    else if (w.kind === "website") website = { url: w.url, domain: w.domain, raw: req.website };
    else socials.push({ platform: w.platform, url: w.url, handle: w.handle, raw: req.website });
  }

  const phones: PhoneInput[] = [];
  req.phones.forEach((raw, i) => {
    const p = parsePhone(raw, regionCountry);
    if (!p.ok) errors.push({ path: `phones.${i}`, message: p.reason });
    else if (!phones.some((x) => x.e164 === p.phone.e164))
      phones.push({ ...p.phone, raw, whatsapp: "unknown" });
  });

  const emails: EmailInput[] = [];
  req.emails.forEach((raw, i) => {
    const e = normalizeEmail(raw);
    if (!e.ok) errors.push({ path: `emails.${i}`, message: e.reason });
    else if (!emails.some((x) => x.address === e.address))
      emails.push({ address: e.address, domain: e.domain, raw });
  });

  const categories: CategoryInput[] = [];
  for (const raw of req.categories) {
    const c = categoryInput(raw);
    if (c && !categories.some((x) => x.key === c.key)) categories.push(c);
  }

  if (errors.length > 0) return { input: null, errors };
  return {
    input: {
      name: { ...name, raw: req.name },
      categories: categories.slice(0, MAX_CATEGORIES),
      website,
      socials,
      phones,
      emails,
      location,
    },
    errors,
  };
}
