import {
  OVERTURE_LABEL,
  OVERTURE_LICENSING,
  OVERTURE_SOURCE_LINE,
  OVERTURE_TERMS_CHECKED_AT,
} from "../../overture/overture-licensing.js";
import type { SourcePolicy } from "../source-adapter.js";

/**
 * Overture Maps Places data policy (docs/SECURITY_AND_DATA_COLLECTION.md, source policy table).
 *
 * Licences per record (sources[].license): CDLA-Permissive-2.0 for Meta, Microsoft, Uberall,
 * PinMeTo, DAC and OpenTravel rows (99.3% of Nigeria); CC0-1.0 for AllThePlaces (0.6%);
 * Apache-2.0 for Foursquare (0.1%). All three allow storing, modifying and commercial reuse with
 * no retention limit. Obligations: attribution, the licence texts with shared data, and for
 * Foursquare the NOTICE and a notice of changes. State and LGA labels come from Overture divisions
 * (ODbL, CC BY 4.0), which need their own credit.
 *
 * No retention limit applies; freshness comes from the release date. Places dropped by a later
 * release are marked retired in the staging catalogue (never silently deleted) and are no longer
 * offered; linked businesses show the reference as retired.
 */
export const OVERTURE_PLACES_POLICY: SourcePolicy = {
  storage:
    "Stored indefinitely under the open data licences (CDLA Permissive 2.0, Apache 2.0, CC0 1.0). Freshness follows the monthly release; places a later release drops are marked retired and no longer offered.",
  contentRetentionMs: null,
  externalIdRetentionMs: null,
  fieldRetention: [
    {
      field: "GERS id (Overture place id)",
      retention: "indefinite",
      days: null,
      note: "Stable across releases (GERS registry); stored as the business's source reference.",
    },
    {
      field: "name, category, address, phone, email, website, social",
      retention: "indefinite",
      days: null,
      note: "CDLA-Permissive-2.0 section 1.1, Apache-2.0 section 2 and CC0 allow storage and reuse. Attribution and licence texts are required when shared.",
    },
    {
      field: "state and local government area",
      retention: "indefinite",
      days: null,
      note: "Assigned by LeadForge from Overture division boundaries (ODbL; CC BY 4.0); credit OpenStreetMap contributors, geoBoundaries and Esri Community Maps contributors.",
    },
  ],
  attribution: OVERTURE_LABEL,
  attributionText: `${OVERTURE_SOURCE_LINE}, with the record's dataset line (for example "Data from Meta. Available under CDLA Permissive 2.0."), linked to the data licences page. Foursquare records also carry the Foursquare NOTICE.`,
  rateLimit: {
    requestsPerSecond: 50,
    burst: 50,
    description:
      "Discovery reads LeadForge's own staging catalogue; no call reaches Overture at job time. The catalogue is refreshed from the published release once a month.",
  },
  lawfulBasis:
    "Open data licences permit storage and commercial reuse. Many Nigerian records are sole traders' mobile numbers and free-mail addresses, which are personal data under the Nigeria Data Protection Act 2023: outreach needs a lawful basis (legitimate interest assessment) and suppression requests are honored.",
  termsCheckedAt: OVERTURE_TERMS_CHECKED_AT,
  terms: [
    {
      title: "Overture Maps attribution and licensing",
      url: "https://docs.overturemaps.org/attribution/",
      lastModified: "2026-05-15",
    },
    {
      title: "Community Data License Agreement – Permissive 2.0",
      url: "https://cdla.dev/permissive-2-0/",
      lastModified: null,
    },
    {
      title: "Apache License 2.0",
      url: "https://www.apache.org/licenses/LICENSE-2.0",
      lastModified: null,
    },
    {
      title: "Foursquare OS Places NOTICE",
      url: "https://opensource.foursquare.com/places-notice-txt/",
      lastModified: null,
    },
    {
      title: "Overture release calendar (releases are kept for 60 days)",
      url: "https://docs.overturemaps.org/release-calendar/",
      lastModified: null,
    },
  ],
  licensing: OVERTURE_LICENSING,
  blockedByTerms: null,
};
