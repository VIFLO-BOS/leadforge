import { createHash } from "node:crypto";
import type { DataLicenseId } from "@leadforge/contracts";
import {
  BUSINESS_NAME_MAX,
  canonicalizeWebsite,
  cleanText,
  emailKind,
  normalizeBusinessName,
  normalizeEmail,
  normalizeSocialProfile,
  parsePhone,
  placeKey,
  searchWords,
} from "../normalization/index.js";
import type { AdminAssignment } from "./admin-index.js";
import { licenseFor, OVERTURE_SELF_DATASETS } from "./overture-licensing.js";
import type { OverturePlaceDocument, OvertureRawPlace, WebsiteKind } from "./overture.types.js";

/** Messaging, link-in-bio and URL-shortener hosts: never a business's own website. */
const MESSAGING_HOSTS = new Set([
  "wa.me",
  "api.whatsapp.com",
  "chat.whatsapp.com",
  "whatsapp.com",
  "web.whatsapp.com",
  "t.me",
  "telegram.me",
  "m.me",
  "wa.link",
]);
const LINK_HUB_HOSTS = new Set([
  "linktr.ee",
  "linktree.com",
  "beacons.ai",
  "bio.link",
  "lnk.bio",
  "taplink.cc",
  "campsite.bio",
  "linkin.bio",
  "solo.to",
  "tap.bio",
  "flow.page",
  "msha.ke",
]);
const SHORTENER_HOSTS = new Set([
  "bit.ly",
  "tinyurl.com",
  "goo.gl",
  "t.co",
  "ow.ly",
  "rebrand.ly",
  "cutt.ly",
  "shorturl.at",
  "is.gd",
  "buff.ly",
  "s.id",
  "tiny.cc",
  "rb.gy",
]);

function hostOf(raw: string): string | null {
  try {
    const url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`);
    return url.hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
}

/** Classifies one Overture `websites[]` value; only `website` values become a business website. */
export function classifyWebsite(raw: string): OverturePlaceDocument["websites"][number] {
  const text = cleanText(raw);
  const host = text ? hostOf(text) : null;
  if (!text || !host) return { raw, url: null, domain: null, kind: "invalid" };
  const kind: WebsiteKind | null = MESSAGING_HOSTS.has(host)
    ? "messaging"
    : LINK_HUB_HOSTS.has(host)
      ? "link_hub"
      : SHORTENER_HOSTS.has(host)
        ? "shortener"
        : null;
  if (kind) return { raw, url: null, domain: host, kind };
  const w = canonicalizeWebsite(text);
  if (!w.ok) return { raw, url: null, domain: null, kind: "invalid" };
  if (w.kind === "social") return { raw, url: w.url, domain: null, kind: "social" };
  return { raw, url: w.url, domain: w.domain, kind: "website" };
}

/** Six-digit Nigerian postcodes only; "+234", "234", "<<not-applicable>>" and the like are dropped. */
export function cleanPostcode(raw: string | null | undefined): string | null {
  const text = raw ? cleanText(raw) : "";
  return /^\d{6}$/.test(text) ? text : null;
}

/** Overture update_time comes as `2026-10-12T00:00:00.000Z` or without a zone; both are read as UTC. */
export function parseUpdateTime(raw: string | null | undefined): Date | null {
  if (!raw) return null;
  const text = raw.trim();
  const withZone = /[zZ]|[+-]\d{2}:?\d{2}$/.test(text) ? text : `${text}Z`;
  const d = new Date(withZone);
  return Number.isNaN(d.getTime()) ? null : d;
}

const NUMERIC_FB = /^\d{5,30}$/;

export type NormalizedPlace = Omit<
  OverturePlaceDocument,
  | "canonicalId"
  | "isCanonical"
  | "groupKeys"
  | "offerable"
  | "syncRunId"
  | "createdAt"
  | "updatedAt"
  | "firstSeenRelease"
  | "retiredAt"
  | "retiredInRelease"
>;

export type NormalizeResult =
  | { ok: true; place: NormalizedPlace }
  | { ok: false; reason: "missing_id" | "missing_name" | "not_nigeria" };

/**
 * One Overture place to its staging form: phones parsed with Nigeria as the default region and
 * typed (mobile or fixed line), emails typed (free-mail or business domain), websites split from
 * social, messaging, link-hub and shortener links, junk postcodes dropped, provenance and licence
 * taken from the root source item, and the state and LGA from the division polygons.
 */
export function normalizeOverturePlace(
  row: OvertureRawPlace,
  ctx: { release: string; schemaVersion: string | null; admin: AdminAssignment },
): NormalizeResult {
  const id = typeof row.id === "string" ? row.id.trim().toLowerCase() : "";
  if (!id) return { ok: false, reason: "missing_id" };
  const address = (row.addresses ?? [])[0] ?? null;
  const country = address?.country ? cleanText(address.country).toUpperCase() : null;
  if (country && country !== "NG" && !ctx.admin.stateKey)
    return { ok: false, reason: "not_nigeria" };

  const rawName = row.name ?? "";
  const name = normalizeBusinessName(rawName);
  if (!name.value || !name.normalized) return { ok: false, reason: "missing_name" };
  const displayName = name.value.slice(0, BUSINESS_NAME_MAX);

  const hierarchy = (row.taxonomy_hierarchy ?? []).filter(
    (n): n is string => typeof n === "string" && n.length > 0,
  );
  const alternates = (row.taxonomy_alternates ?? []).filter(
    (n): n is string => typeof n === "string" && n.length > 0,
  );
  const categoryNodes = [
    ...new Set([...hierarchy, ...alternates, ...(row.basic_category ? [row.basic_category] : [])]),
  ];

  const phones: NormalizedPlace["phones"] = [];
  for (const raw of row.phones ?? []) {
    if (typeof raw !== "string" || !raw.trim()) continue;
    const p = parsePhone(raw, "NG");
    const entry = p.ok
      ? { raw, e164: p.phone.e164, type: p.phone.type, country: p.phone.country }
      : { raw, e164: null, type: null, country: null };
    if (!entry.e164 || !phones.some((x) => x.e164 === entry.e164)) phones.push(entry);
  }

  const emails: NormalizedPlace["emails"] = [];
  for (const raw of row.emails ?? []) {
    if (typeof raw !== "string" || !raw.trim()) continue;
    const e = normalizeEmail(raw);
    const entry = e.ok
      ? { raw, address: e.address, domain: e.domain, kind: emailKind(e.domain) }
      : { raw, address: null, domain: null, kind: null };
    if (!entry.address || !emails.some((x) => x.address === entry.address)) emails.push(entry);
  }

  const websites = (row.websites ?? [])
    .filter((w): w is string => typeof w === "string" && w.trim().length > 0)
    .map(classifyWebsite);

  const socials: NormalizedPlace["socials"] = [];
  const socialRaws = [
    ...(row.socials ?? []),
    ...websites.filter((w) => w.kind === "social").map((w) => w.raw),
  ];
  for (const raw of socialRaws) {
    if (typeof raw !== "string" || !raw.trim()) continue;
    const s = normalizeSocialProfile(raw);
    const entry = s
      ? { raw, platform: s.platform, url: s.url, handle: s.handle }
      : { raw, platform: null, url: null, handle: null };
    if (!entry.url || !socials.some((x) => x.url === entry.url)) socials.push(entry);
  }

  const sources: NormalizedPlace["sources"] = (row.sources ?? []).map((s) => ({
    property: s.property ?? "",
    dataset: s.dataset ?? null,
    license: s.license ?? null,
    recordId: s.record_id ?? null,
    updateTime: s.update_time ?? null,
    provider: s.provider ?? null,
    resource: s.resource ?? null,
    version: s.version ?? null,
  }));
  const root =
    sources.find(
      (s) => s.property === "" && s.dataset && !OVERTURE_SELF_DATASETS.has(s.dataset.toLowerCase()),
    ) ??
    sources.find((s) => s.property === "") ??
    null;
  const rootLicense = root ? licenseFor(root.dataset, root.license) : null;
  const licenses = [
    ...new Set(
      sources
        .map((s) => licenseFor(s.dataset, s.license))
        .filter((l): l is DataLicenseId => l !== null),
    ),
  ].sort();

  const upstreamKey =
    root?.dataset && root.recordId && !OVERTURE_SELF_DATASETS.has(root.dataset.toLowerCase())
      ? `up:${root.dataset.toLowerCase()}:${root.recordId}`
      : null;
  const socialKeys = new Set<string>();
  if (root?.dataset?.toLowerCase() === "meta" && root.recordId && NUMERIC_FB.test(root.recordId))
    socialKeys.add(`fb:${root.recordId}`);
  for (const s of socials)
    if (s.platform === "facebook" && s.handle && NUMERIC_FB.test(s.handle))
      socialKeys.add(`fb:${s.handle}`);

  const confidence =
    typeof row.confidence === "number" && Number.isFinite(row.confidence)
      ? Math.min(1, Math.max(0, row.confidence))
      : 0;
  const status = row.operating_status ? cleanText(row.operating_status).toLowerCase() : null;
  const closed = status === "permanently_closed" || status === "temporarily_closed";

  const freeform = address?.freeform ? cleanText(address.freeform) || null : null;
  const locality = address?.locality ? cleanText(address.locality) || null : null;
  const hasPhone = phones.some((p) => p.e164);
  const hasEmail = emails.some((e) => e.address);
  const hasWebsite = websites.some((w) => w.kind === "website");
  const lon = typeof row.lon === "number" && Number.isFinite(row.lon) ? row.lon : null;
  const lat = typeof row.lat === "number" && Number.isFinite(row.lat) ? row.lat : null;

  const place: NormalizedPlace = {
    _id: id,
    release: ctx.release,
    schemaVersion: ctx.schemaVersion,
    featureVersion: typeof row.version === "number" ? row.version : null,
    contentHash: "",
    name: displayName,
    nameKey: name.normalized,
    nameTokens: [...new Set(searchWords(displayName))].slice(0, 50),
    basicCategory: row.basic_category ?? null,
    taxonomy: { primary: row.taxonomy_primary ?? null, hierarchy, alternates },
    categoryNodes,
    confidence,
    operatingStatus: status,
    closed,
    phones,
    emails,
    websites,
    socials,
    brand:
      row.brand_name || row.brand_wikidata
        ? { name: row.brand_name ?? null, wikidata: row.brand_wikidata ?? null }
        : null,
    address: {
      freeform,
      locality,
      localityKey: locality ? placeKey(locality) : null,
      postcode: cleanPostcode(address?.postcode),
      regionRaw: address?.region ? cleanText(address.region) || null : null,
      country,
    },
    addressTokens: [...new Set([...searchWords(freeform), ...searchWords(locality)])].slice(0, 60),
    admin: { ...ctx.admin },
    location:
      lon !== null && lat !== null && Math.abs(lon) <= 180 && Math.abs(lat) <= 90
        ? { type: "Point", coordinates: [lon, lat] }
        : null,
    rootSource: {
      dataset: root?.dataset ?? null,
      recordId: root?.recordId ?? null,
      license: rootLicense,
      licenseRaw: root?.license ?? null,
      updateTime: parseUpdateTime(root?.updateTime),
      provider: root?.provider ?? null,
      version: root?.version ?? null,
    },
    sources,
    licenses,
    upstreamKey,
    socialKeys: [...socialKeys].sort(),
    contacts: {
      phone: hasPhone,
      email: hasEmail,
      website: hasWebsite,
      any: hasPhone || hasEmail || hasWebsite,
      score: Number(hasPhone) + Number(hasEmail) + Number(hasWebsite),
    },
  };
  place.contentHash = contentHash(place);
  return { ok: true, place };
}

/** Hash of the normalized payload, without release bookkeeping, so an unchanged place is not rewritten. */
export function contentHash(place: NormalizedPlace): string {
  const { release: _r, schemaVersion: _s, contentHash: _h, ...payload } = place;
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

/** Release "2026-10-21.0" to its date (field freshness for Overture values). */
export function releaseDate(release: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(release);
  if (!m) return null;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return Number.isNaN(d.getTime()) ? null : d;
}
