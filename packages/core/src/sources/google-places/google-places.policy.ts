import type { SourcePolicy } from "../source-adapter.js";

/**
 * Google Places API (New) data policy, from the terms as checked on 2026-10-25
 * (docs/SECURITY_AND_DATA_COLLECTION.md section 6 records the quotes):
 *
 * - Maps Platform Terms of Service (last modified 2026-08-26) section 3.2.3(a) No Scraping:
 *   no pre-fetching, indexing, storing or rehosting content outside the Services, including
 *   "copy and save business names, addresses"; 3.2.3(b) No Caching "except as expressly
 *   permitted under the Maps Service Specific Terms"; 3.2.3(d)(iii) no use "in a listings or
 *   directory service".
 * - Maps Service Specific Terms (last modified 2026-10-15): General Service Terms 3 permits
 *   caching place_id; Places API section 14.3 permits caching latitude and longitude for up to
 *   30 consecutive calendar days. No other Places content is listed.
 * - Places API policies (last updated 2026-10-23): "You must not pre-fetch, cache, or store
 *   Places API content beyond the allowed exceptions"; place IDs may be stored indefinitely;
 *   Google Maps attribution is required when shown without a Google map.
 *
 * LeadForge applies the strictest reading: the place ID is kept indefinitely; coordinates are
 * not requested; every other value (name, address, phone, website, category) expires the
 * moment it is collected, is hidden on read and removed by the retention purge.
 *
 * Decision (2026-10-25, ARCHITECTURE section 9): a lead directory is exactly the use 3.2.3(d)(iii)
 * forbids, so Google Places is unavailable whatever its configuration (`blockedByTerms`). The
 * adapter code is kept, tested and documented, but the registry never lets a job run on it.
 * Overture Maps Places replaces it as the discovery source.
 */
export const GOOGLE_PLACES_TERMS_BLOCK =
  "Unavailable under Google's terms. The Google Maps Platform Terms of Service (last modified 2026-08-26) section 3.2.3 forbid copying and saving business names and addresses (a)(iii), caching content beyond place IDs and, for 30 days, coordinates (b), and using the services in a listings or directory service (d)(iii). LeadForge keeps business records, so this source never runs, with or without an API key. Overture Maps Places is the discovery source.";

export const GOOGLE_PLACES_CONTENT_RETENTION_MS = 0;

export const GOOGLE_PLACES_POLICY: SourcePolicy = {
  storage:
    "Only the Google place ID is stored long term. Under Google's terms, other place details (name, address, phone, website, category) may not be stored, so they expire when collected and are removed.",
  contentRetentionMs: GOOGLE_PLACES_CONTENT_RETENTION_MS,
  externalIdRetentionMs: null,
  fieldRetention: [
    {
      field: "place_id",
      retention: "indefinite",
      days: null,
      note: "Maps Service Specific Terms, General Service Terms 3 (Google ID caching); Places API policies.",
    },
    {
      field: "latitude, longitude",
      retention: "not_collected",
      days: 30,
      note: "Service Specific Terms 14.3 allows caching for up to 30 consecutive calendar days. LeadForge does not request coordinates.",
    },
    {
      field: "name, address, phone, website, category, opening hours",
      retention: "none",
      days: 0,
      note: "No caching permission in the Service Specific Terms; Terms of Service 3.2.3(a) and (b) and the Places API policies forbid storing it. Expires on collection.",
    },
  ],
  attribution: "Google Maps",
  attributionText:
    'Results from Google Places must show the Google Maps attribution (logo, or the text "Google Maps" where space is limited) and any third-party provider named in the place\'s attributions.',
  rateLimit: {
    requestsPerSecond: 5,
    burst: 5,
    description:
      "LeadForge sends at most 5 requests per second to Google Places across all organizations; the Google Cloud project's quota also applies.",
  },
  lawfulBasis:
    "Licensed API access under the Google Maps Platform Terms. Legal review is required before production use: the terms restrict storage and use in listings or directory services.",
  termsCheckedAt: "2026-10-25",
  terms: [
    {
      title: "Google Maps Platform Terms of Service, section 3.2.3",
      url: "https://cloud.google.com/maps-platform/terms",
      lastModified: "2026-08-26",
    },
    {
      title: "Google Maps Platform Service Specific Terms (General Service Terms 3; Places API 14)",
      url: "https://cloud.google.com/maps-platform/terms/maps-service-terms",
      lastModified: "2026-10-15",
    },
    {
      title: "Places API policies",
      url: "https://developers.google.com/maps/documentation/places/web-service/policies",
      lastModified: "2026-10-23",
    },
    {
      title: "Text Search (New) reference",
      url: "https://developers.google.com/maps/documentation/places/web-service/text-search",
      lastModified: "2026-10-23",
    },
  ],
  licensing: null,
  blockedByTerms: { detail: GOOGLE_PLACES_TERMS_BLOCK },
};
