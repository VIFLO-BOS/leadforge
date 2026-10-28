import { z } from "zod";
import { IsoDateTime, UuidString } from "../common/ids.js";
import { CollectionMethod, ObservationField, SourceKey } from "../businesses/fields.js";

/**
 * - active: in use now.
 * - configured: credentials (or, in development and tests only, fixture mode) are present.
 * - not_configured: needs credentials or approval before it can be used.
 * - not_available: not part of the product yet.
 */
export const SourceStatus = z.enum(["active", "configured", "not_configured", "not_available"]);
export type SourceStatus = z.infer<typeof SourceStatus>;

/**
 * Why a discovery source cannot run, when it cannot:
 * - provider_terms: the provider's terms forbid LeadForge's use (Google Places: never runnable).
 * - credentials_missing: an API key or similar is not configured.
 * - snapshot_missing: the open-data snapshot has not been loaded yet (Overture: run the sync).
 */
export const SourceStatusReason = z.enum([
  "provider_terms",
  "credentials_missing",
  "snapshot_missing",
]);
export type SourceStatusReason = z.infer<typeof SourceStatusReason>;

/** Licences of data LeadForge stores or derives from. Full texts: GET /public/data-licenses/:id. */
export const DataLicenseId = z.enum([
  "CDLA-Permissive-2.0",
  "Apache-2.0",
  "CC0-1.0",
  "ODbL-1.0",
  "CC-BY-4.0",
]);
export type DataLicenseId = z.infer<typeof DataLicenseId>;

export const DataLicenseRef = z.object({
  id: DataLicenseId,
  name: z.string(),
  /** API path of the licence text (text/plain), relative to the API origin, e.g. `/api/v1/public/data-licenses/Apache-2.0`. */
  textPath: z.string(),
  /** The licence's canonical page. */
  referenceUrl: z.string(),
});
export type DataLicenseRef = z.infer<typeof DataLicenseRef>;

/**
 * What a source requires wherever its data is shown, exported or shared: a short label, the
 * attribution line, verbatim per-dataset lines from the provider, and the licences.
 */
export const SourceLicensing = z.object({
  /** Short label for chips, e.g. "Overture Maps Foundation". */
  label: z.string(),
  /** Line to show next to the data, e.g. "Source: Overture Maps Foundation (overturemaps.org)". */
  text: z.string(),
  url: z.string().nullable(),
  licenses: z.array(DataLicenseRef),
  /** Verbatim attribution line per upstream dataset; show the line of each record's dataset with it. */
  upstream: z.array(z.object({ dataset: z.string(), text: z.string(), license: DataLicenseId })),
  /** Display and redistribution requirements in plain language. */
  requirements: z.array(z.string()),
  /** API path of the full list of licence texts, attributions and notices (GET /public/data-licenses). */
  licensesPath: z.string(),
});
export type SourceLicensing = z.infer<typeof SourceLicensing>;

/**
 * How long a value collected from the source may be kept.
 * - indefinite: no limit.
 * - limited: `days` after collection, then it expires (hidden, then removed).
 * - none: the terms grant no storage; the value expires when collected.
 * - not_collected: storage would be allowed but LeadForge does not request the value.
 */
export const RetentionRule = z.enum(["indefinite", "limited", "none", "not_collected"]);
export type RetentionRule = z.infer<typeof RetentionRule>;

export const FieldRetention = z.object({
  /** Source field or LeadForge field family, e.g. "place_id" or "name, address, phone, website". */
  field: z.string(),
  retention: RetentionRule,
  days: z.number().int().nullable(),
  note: z.string(),
});
export type FieldRetention = z.infer<typeof FieldRetention>;

export const SourceTermsReference = z.object({
  title: z.string(),
  url: z.string(),
  /** "Last modified" or "Last updated" date shown on the page when it was checked. */
  lastModified: z.string().nullable(),
});
export type SourceTermsReference = z.infer<typeof SourceTermsReference>;

export const SourceRegistryEntry = z.object({
  key: SourceKey,
  name: z.string(),
  kind: z.enum(["discovery", "enrichment", "user_supplied"]),
  method: CollectionMethod,
  status: SourceStatus,
  /** Why the source cannot run (null when it can, or for non-discovery sources). */
  statusReason: SourceStatusReason.nullable(),
  statusDetail: z.string(),
  /** Enabled for this organization. Only `configurable` sources can be switched off. */
  enabled: z.boolean(),
  configurable: z.boolean(),
  fieldsProvided: z.array(ObservationField),
  coverage: z.string(),
  policy: z.object({
    storage: z.string(),
    /** Days a collected value may be kept before it expires; null when unlimited. 0 means it expires on collection. */
    retentionDays: z.number().int().nullable(),
    fieldRetention: z.array(FieldRetention),
    attribution: z.string().nullable(),
    rateLimit: z.string().nullable(),
    lawfulBasis: z.string(),
    /** Date the source's terms were last checked by the team, ISO date. */
    termsCheckedAt: z.string().nullable(),
    terms: z.array(SourceTermsReference),
    /** Attribution and licences required with this source's data; null when none apply. */
    licensing: SourceLicensing.nullable(),
  }),
  docsUrl: z.string().nullable(),
  /** Who last changed the organization's setting, when it was changed. */
  config: z.object({ updatedAt: IsoDateTime, updatedByUserId: UuidString.nullable() }).nullable(),
});
export type SourceRegistryEntry = z.infer<typeof SourceRegistryEntry>;

/** `PATCH /sources/:key` (owner and admin). */
export const UpdateSourceConfigRequest = z.object({ enabled: z.boolean() });
export type UpdateSourceConfigRequest = z.infer<typeof UpdateSourceConfigRequest>;

/** API path of the public licences page data; `/:id` returns one licence text as text/plain. */
export const DATA_LICENSES_PATH = "/api/v1/public/data-licenses";

/** Names and canonical pages of the licences in DataLicenseId. */
export const DATA_LICENSES: Record<DataLicenseId, DataLicenseRef> = {
  "CDLA-Permissive-2.0": {
    id: "CDLA-Permissive-2.0",
    name: "Community Data License Agreement – Permissive, Version 2.0",
    textPath: `${DATA_LICENSES_PATH}/CDLA-Permissive-2.0`,
    referenceUrl: "https://cdla.dev/permissive-2-0/",
  },
  "Apache-2.0": {
    id: "Apache-2.0",
    name: "Apache License, Version 2.0",
    textPath: `${DATA_LICENSES_PATH}/Apache-2.0`,
    referenceUrl: "https://www.apache.org/licenses/LICENSE-2.0",
  },
  "CC0-1.0": {
    id: "CC0-1.0",
    name: "Creative Commons Zero v1.0 Universal",
    textPath: `${DATA_LICENSES_PATH}/CC0-1.0`,
    referenceUrl: "https://creativecommons.org/publicdomain/zero/1.0/",
  },
  "ODbL-1.0": {
    id: "ODbL-1.0",
    name: "Open Data Commons Open Database License (ODbL) v1.0",
    textPath: `${DATA_LICENSES_PATH}/ODbL-1.0`,
    referenceUrl: "https://opendatacommons.org/licenses/odbl/1-0/",
  },
  "CC-BY-4.0": {
    id: "CC-BY-4.0",
    name: "Creative Commons Attribution 4.0 International",
    textPath: `${DATA_LICENSES_PATH}/CC-BY-4.0`,
    referenceUrl: "https://creativecommons.org/licenses/by/4.0/",
  },
};

/** `GET /public/data-licenses`: everything the Data sources and licences page shows. */
export const DataLicensesResponse = z.object({
  licenses: z.array(
    DataLicenseRef.extend({
      /** Which data the licence covers, in plain language. */
      appliesTo: z.string(),
      /** True when LeadForge serves the full text at `textPath`; false when only the canonical page is linked. */
      textAvailable: z.boolean(),
    }),
  ),
  sources: z.array(z.object({ source: SourceKey, name: z.string(), licensing: SourceLicensing })),
  /** Notices that must be reproduced in full (Foursquare's NOTICE for Foursquare-derived records). */
  notices: z.array(
    z.object({
      id: z.string(),
      title: z.string(),
      appliesTo: z.string(),
      url: z.string(),
      text: z.string(),
    }),
  ),
  /** LeadForge's changes to the data, stated as the licences require. */
  modifications: z.string(),
  /** No-warranty and no-endorsement statement. */
  disclaimer: z.string(),
  /** Release of the Overture snapshot currently loaded, or null before the first sync. */
  overtureRelease: z.string().nullable(),
});
export type DataLicensesResponse = z.infer<typeof DataLicensesResponse>;
