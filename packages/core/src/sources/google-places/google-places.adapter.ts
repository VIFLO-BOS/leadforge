import { Inject, Injectable, Optional } from "@nestjs/common";
import type { DiscoveryJobSpec, ErrorDetail } from "@leadforge/contracts";
import {
  BUSINESS_NAME_MAX,
  canonicalizeWebsite,
  countryName,
  normalizeBusinessName,
  parsePhone,
} from "../../normalization/index.js";
import {
  buildLocation,
  categoryInput,
  type BusinessInput,
  type PhoneInput,
  type SocialInput,
  type WebsiteInput,
} from "../../businesses/business-input.js";
import {
  SourceError,
  type MapContext,
  type MappedRecord,
  type SearchCursor,
  type SearchOptions,
  type SourceAdapter,
  type SourceDescription,
  type SourceEstimate,
  type SourcePage,
} from "../source-adapter.js";
import { GOOGLE_PLACES_POLICY } from "./google-places.policy.js";
import { PLACES_TRANSPORT, type PlacesTransport } from "./places-transport.js";
import type { Place, PlaceAddressComponent, PlacesSearchTextRequest } from "./places.types.js";

/** Text Search returns at most 60 results per query, 20 per page (documented; "subject to change"). */
export const PLACES_PAGE_SIZE = 20;
export const PLACES_MAX_RESULTS_PER_QUERY = 60;

/** Essentials (IDs only) and Pro SKU fields: identity, name, address, category, status. */
const BASE_FIELDS = [
  "id",
  "attributions",
  "displayName",
  "formattedAddress",
  "addressComponents",
  "types",
  "primaryType",
  "primaryTypeDisplayName",
  "businessStatus",
] as const;
/** Enterprise SKU fields, requested only when the job asks for them. */
const PHONE_FIELDS = ["nationalPhoneNumber", "internationalPhoneNumber"] as const;
const WEBSITE_FIELDS = ["websiteUri"] as const;

/**
 * Google Places API (New) Text Search adapter. One query per category ("<category> in
 * <area>, <region>, <country>"), paginated with nextPageToken, with explicit field masks.
 * Values carry the strict retention in GOOGLE_PLACES_POLICY. WhatsApp is never inferred from a
 * Google phone number. Without GOOGLE_PLACES_API_KEY (and outside fixture mode) the source is
 * `not_configured` and every call throws SOURCE_NOT_CONFIGURED; it never returns made-up data.
 */
@Injectable()
export class GooglePlacesAdapter implements SourceAdapter<Place> {
  readonly key = "google_places" as const;
  readonly policy = GOOGLE_PLACES_POLICY;

  constructor(
    @Optional() @Inject(PLACES_TRANSPORT) private readonly transport: PlacesTransport | null = null,
  ) {}

  describe(): SourceDescription {
    const fixture = this.transport?.mode === "fixture";
    const configured = Boolean(this.transport);
    return {
      key: this.key,
      name: "Google Places API (New)",
      kind: "discovery",
      method: "api",
      status: configured ? "configured" : "not_configured",
      statusDetail: fixture
        ? "Fixture mode (development and tests only): jobs replay hand-built sample responses, not Google data."
        : configured
          ? "Configured with an API key. Under Google's terms only place IDs are kept; other place details expire when collected."
          : "Not configured: no Google Places API key is set, so discovery jobs with this source cannot run.",
      fieldsProvided: ["name", "category", "location", "phone", "website"],
      coverage:
        "Official Google Maps Platform data. Coverage of small Nigerian businesses varies by area; at most 60 results per query.",
      docsUrl: "https://developers.google.com/maps/documentation/places/web-service/text-search",
      fixtureMode: fixture,
      maxResultsPerQuery: PLACES_MAX_RESULTS_PER_QUERY,
    };
  }

  private requireTransport(): PlacesTransport {
    if (!this.transport) {
      throw new SourceError(
        "SOURCE_NOT_CONFIGURED",
        "Google Places is not configured (no API key)",
        false,
      );
    }
    return this.transport;
  }

  /** Field names (without the `places.` prefix) for this spec. */
  fieldsFor(spec: DiscoveryJobSpec): string[] {
    const fields: string[] = [...BASE_FIELDS];
    if (spec.priorityFields.includes("phone")) fields.push(...PHONE_FIELDS);
    if (spec.priorityFields.includes("website") || spec.priorityFields.includes("email"))
      fields.push(...WEBSITE_FIELDS);
    return fields;
  }

  searchFieldMask(spec: DiscoveryJobSpec): string {
    return [...this.fieldsFor(spec).map((f) => `places.${f}`), "nextPageToken"].join(",");
  }

  detailsFieldMask(spec: DiscoveryJobSpec): string {
    return this.fieldsFor(spec).join(",");
  }

  /** One text query per category, e.g. "Restaurant in Allen Avenue, Ikeja, Lagos, Nigeria". */
  queriesFor(spec: DiscoveryJobSpec): string[] {
    const area = [
      spec.location.query,
      spec.location.locality,
      spec.location.region,
      countryName(spec.location.country),
    ]
      .filter((p): p is string => Boolean(p))
      .join(", ");
    return spec.categories.map((c) => `${c} in ${area}`);
  }

  /** Request body; identical across pages except pageToken, as the API requires. */
  requestFor(
    spec: DiscoveryJobSpec,
    queryIndex: number,
    pageToken: string | null,
  ): PlacesSearchTextRequest {
    const textQuery = this.queriesFor(spec)[queryIndex];
    if (!textQuery)
      throw new SourceError("SOURCE_REQUEST_INVALID", `No query ${queryIndex} in this job`, false);
    const geo = spec.location.geo;
    return {
      textQuery,
      pageSize: PLACES_PAGE_SIZE,
      regionCode: spec.location.country,
      languageCode: "en",
      ...(geo
        ? {
            locationBias: {
              circle: { center: { latitude: geo.lat, longitude: geo.lng }, radius: geo.radiusM },
            },
          }
        : {}),
      ...(pageToken ? { pageToken } : {}),
    };
  }

  validateSpec(spec: DiscoveryJobSpec): ErrorDetail[] {
    const errors: ErrorDetail[] = [];
    if (
      !spec.location.locality &&
      !spec.location.region &&
      !spec.location.query &&
      !spec.location.geo
    ) {
      errors.push({
        path: "location",
        message: "Give a city, state, area or map point so Google Places can search a place",
      });
    }
    if (
      spec.priorityFields.length > 0 &&
      spec.priorityFields.every((f) => f === "email" || f === "whatsapp")
    ) {
      errors.push({
        path: "priorityFields",
        message: "Google Places provides neither emails nor WhatsApp; include phone or website",
      });
    }
    return errors;
  }

  estimate(spec: DiscoveryJobSpec): SourceEstimate {
    const queries = spec.categories.length;
    const maxResults = Math.min(spec.maxRecords, queries * PLACES_MAX_RESULTS_PER_QUERY);
    const fields = this.fieldsFor(spec);
    const enterprise = fields.some(
      (f) =>
        (PHONE_FIELDS as readonly string[]).includes(f) ||
        (WEBSITE_FIELDS as readonly string[]).includes(f),
    );
    const warnings: string[] = [];
    if (spec.maxRecords > queries * PLACES_MAX_RESULTS_PER_QUERY) {
      warnings.push(
        `Google Places returns at most ${PLACES_MAX_RESULTS_PER_QUERY} results per query, so ${queries} ${queries === 1 ? "category" : "categories"} can produce at most ${queries * PLACES_MAX_RESULTS_PER_QUERY} records. Add categories or narrower areas for more.`,
      );
    }
    if (spec.priorityFields.includes("email"))
      warnings.push("Google Places does not provide email addresses.");
    if (spec.priorityFields.includes("whatsapp"))
      warnings.push("WhatsApp is never inferred from a Google phone number.");
    warnings.push(
      "Under Google's terms only place IDs are kept; other place details expire when collected.",
    );
    return {
      queries,
      maxResults,
      maxRequests: queries * Math.ceil(PLACES_MAX_RESULTS_PER_QUERY / PLACES_PAGE_SIZE),
      providerSku: enterprise ? "Text Search Enterprise" : "Text Search Pro",
      fields,
      warnings,
    };
  }

  async *search(
    spec: DiscoveryJobSpec,
    options: SearchOptions = {},
  ): AsyncGenerator<SourcePage<Place>> {
    const transport = this.requireTransport();
    const queries = this.queriesFor(spec);
    const mask = this.searchFieldMask(spec);
    let cursor: SearchCursor = options.from ?? { queryIndex: 0, pageIndex: 0, pageToken: null };
    while (cursor.queryIndex < queries.length) {
      const res = await transport.searchText(
        this.requestFor(spec, cursor.queryIndex, cursor.pageToken),
        mask,
        options.signal,
      );
      const records = (res.places ?? []).filter((p) => typeof p.id === "string" && p.id.length > 0);
      const morePages =
        Boolean(res.nextPageToken) &&
        (cursor.pageIndex + 1) * PLACES_PAGE_SIZE < PLACES_MAX_RESULTS_PER_QUERY;
      const nextCursor: SearchCursor | null = morePages
        ? {
            queryIndex: cursor.queryIndex,
            pageIndex: cursor.pageIndex + 1,
            pageToken: res.nextPageToken!,
          }
        : cursor.queryIndex + 1 < queries.length
          ? { queryIndex: cursor.queryIndex + 1, pageIndex: 0, pageToken: null }
          : null;
      yield { cursor, nextCursor, records };
      if (!nextCursor) return;
      cursor = nextCursor;
    }
  }

  async fetchRecord(
    externalId: string,
    spec: DiscoveryJobSpec,
    signal?: AbortSignal,
  ): Promise<Place | null> {
    return this.requireTransport().getPlace(externalId, this.detailsFieldMask(spec), signal);
  }

  mapToObservations(place: Place, ctx: MapContext): MappedRecord {
    const retention = this.policy.contentRetentionMs;
    const expiresAt = retention === null ? null : new Date(ctx.collectedAt.getTime() + retention);
    const thirdParty = (place.attributions ?? []).map((a) => a.provider).filter(Boolean);
    const provenance: MappedRecord["provenance"] = {
      sourceRef: `places/${place.id}`,
      expiresAt,
      externalIdExpiresAt:
        this.policy.externalIdRetentionMs === null
          ? null
          : new Date(ctx.collectedAt.getTime() + this.policy.externalIdRetentionMs),
      categoryTaxonomy: "google",
      attribution: [this.policy.attribution, ...thirdParty].filter(Boolean).join("; ") || null,
    };
    const base = { externalId: place.id, provenance };
    const warnings: MappedRecord["warnings"] = [];

    if (place.businessStatus === "CLOSED_PERMANENTLY") {
      return {
        ...base,
        input: null,
        skip: {
          code: "PERMANENTLY_CLOSED",
          message: "Google lists this place as permanently closed",
        },
        warnings,
      };
    }
    const rawName = place.displayName?.text ?? "";
    const name = normalizeBusinessName(rawName);
    if (!name.value || !name.normalized) {
      return {
        ...base,
        input: null,
        skip: { code: "MISSING_NAME", message: "The place has no usable name" },
        warnings,
      };
    }
    if (name.value.length > BUSINESS_NAME_MAX) {
      return {
        ...base,
        input: null,
        skip: { code: "INVALID_VALUE", message: "The place name is longer than 200 characters" },
        warnings,
      };
    }
    if (place.businessStatus === "CLOSED_TEMPORARILY") {
      warnings.push({
        code: "TEMPORARILY_CLOSED",
        message: "Google lists this place as temporarily closed",
      });
    }

    const parts = addressParts(place.addressComponents ?? []);
    const country = parts.country ?? ctx.spec.location.country;
    const location = buildLocation(
      {
        street: parts.street,
        locality: parts.locality,
        lga: parts.lga,
        region: parts.region,
        postalCode: parts.postalCode,
        country,
      },
      parts.country,
    );
    if (location && place.formattedAddress) {
      location.raw = place.formattedAddress;
      location.formatted = place.formattedAddress;
    }

    const phones: PhoneInput[] = [];
    const rawPhone = place.internationalPhoneNumber ?? place.nationalPhoneNumber ?? null;
    if (rawPhone) {
      const parsed = parsePhone(rawPhone, country);
      // WhatsApp is never inferred from a Google phone number: always "unknown" here.
      if (parsed.ok) phones.push({ ...parsed.phone, raw: rawPhone, whatsapp: "unknown" });
      else
        warnings.push({
          code: "INVALID_VALUE",
          message: `Phone "${rawPhone}" was not kept: ${parsed.reason}`,
        });
    }

    let website: WebsiteInput | null = null;
    const socials: SocialInput[] = [];
    if (place.websiteUri) {
      const w = canonicalizeWebsite(place.websiteUri);
      if (!w.ok)
        warnings.push({
          code: "INVALID_VALUE",
          message: `Website "${place.websiteUri}" was not kept: ${w.reason}`,
        });
      else if (w.kind === "website")
        website = { url: w.url, domain: w.domain, raw: place.websiteUri };
      else
        socials.push({ platform: w.platform, url: w.url, handle: w.handle, raw: place.websiteUri });
    }

    const categoryLabel =
      place.primaryTypeDisplayName?.text ??
      (place.primaryType ? humanizeType(place.primaryType) : null);
    const category = categoryLabel ? categoryInput(categoryLabel) : null;

    const input: BusinessInput = {
      name: { ...name, raw: rawName },
      categories: category ? [category] : [],
      website,
      socials,
      phones,
      emails: [],
      location,
    };
    return { ...base, input, skip: null, warnings };
  }
}

function humanizeType(type: string): string {
  const words = type.replace(/_/g, " ").trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

interface AddressParts {
  street: string | null;
  locality: string | null;
  lga: string | null;
  region: string | null;
  postalCode: string | null;
  country: string | null;
}

/** Address components to LeadForge location parts (Nigeria: state is level 1, LGA level 2). */
export function addressParts(components: PlaceAddressComponent[]): AddressParts {
  const find = (...types: string[]) => {
    for (const t of types) {
      const c = components.find((x) => x.types.includes(t));
      if (c) return c;
    }
    return null;
  };
  const number = find("street_number")?.longText ?? null;
  const route = find("route")?.longText ?? null;
  return {
    street: [number, route].filter(Boolean).join(" ") || null,
    locality:
      find(
        "locality",
        "postal_town",
        "sublocality",
        "sublocality_level_1",
        "neighborhood",
        "administrative_area_level_3",
      )?.longText ?? null,
    lga: find("administrative_area_level_2")?.longText ?? null,
    region: find("administrative_area_level_1")?.longText ?? null,
    postalCode: find("postal_code")?.longText ?? null,
    country: find("country")?.shortText?.toUpperCase() ?? null,
  };
}
