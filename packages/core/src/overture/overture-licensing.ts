import {
  DATA_LICENSES,
  DATA_LICENSES_PATH,
  DataLicenseId,
  type DataLicenseRef,
  type SourceLicensing,
} from "@leadforge/contracts";

/**
 * Overture Maps Places licensing, from https://docs.overturemaps.org/attribution/ (page last
 * updated 2026-05-15, checked 2026-10-25). Every record carries its own licence in
 * `sources[].license`; the lines below are the verbatim attribution Overture lists per dataset.
 * CDLA-Permissive-2.0 (section 2.1) requires the licence text to be made available with shared
 * data; Apache-2.0 (Foursquare) also requires the NOTICE content and a notice of changes.
 */
export const OVERTURE_TERMS_CHECKED_AT = "2026-10-25";

export interface DatasetAttribution {
  /** `sources[].dataset` as Overture writes it. */
  dataset: string;
  /** Display name used in the attribution line. */
  name: string;
  license: DataLicenseId;
  /** Verbatim line from the Overture attribution page. */
  line: string;
}

const cdla = (dataset: string, name = dataset): DatasetAttribution => ({
  dataset,
  name,
  license: "CDLA-Permissive-2.0",
  line: `Data from ${name}. Available under CDLA Permissive 2.0.`,
});

/** Places datasets on the attribution page (Nigeria has Meta, Microsoft, Uberall, AllThePlaces, Foursquare, PinMeTo, DAC, OpenTravel). */
export const OVERTURE_DATASETS: DatasetAttribution[] = [
  cdla("meta", "Meta"),
  cdla("Microsoft"),
  cdla("PinMeTo"),
  cdla("Krick"),
  cdla("RenderSEO"),
  cdla("DAC"),
  cdla("BrightQuery"),
  cdla("Birdeye"),
  cdla("Uberall"),
  cdla("OpenTravel", "OpenTravel Alliance"),
  {
    dataset: "Foursquare",
    name: "Foursquare",
    license: "Apache-2.0",
    line: "Data from Foursquare. Copyright 2024 Foursquare Labs, Inc. All rights reserved. Available under Apache 2.0. Foursquare data was transformed to the Overture schema. Changed: 2026-03-18. See the Foursquare NOTICE.",
  },
  {
    dataset: "AllThePlaces",
    name: "AllThePlaces",
    license: "CC0-1.0",
    line: "Data from AllThePlaces. Available under CC0 1.0.",
  },
];

const BY_DATASET = new Map(OVERTURE_DATASETS.map((d) => [d.dataset.toLowerCase(), d]));

/** Overture-computed values (confidence, operating-status signals). */
export const OVERTURE_SELF_DATASETS = new Set(["overture", "overture-signals"]);

/** Licence of a record: the root source's SPDX id when it is one we know, else from the dataset table. */
const KNOWN_LICENSES: ReadonlySet<string> = new Set(DataLicenseId.options);

export function licenseFor(
  dataset: string | null | undefined,
  spdx: string | null | undefined,
): DataLicenseId | null {
  if (spdx && KNOWN_LICENSES.has(spdx)) return spdx as DataLicenseId;
  return dataset ? (BY_DATASET.get(dataset.toLowerCase())?.license ?? null) : null;
}

/** Attribution line for a record from this dataset (generic CDLA line for unknown datasets with that licence). */
export function attributionLineFor(
  dataset: string | null | undefined,
  license: DataLicenseId | null,
): string | null {
  if (!dataset) return null;
  const known = BY_DATASET.get(dataset.toLowerCase());
  if (known) return known.line;
  if (license === "CDLA-Permissive-2.0")
    return `Data from ${dataset}. Available under CDLA Permissive 2.0.`;
  if (license === "CC0-1.0") return `Data from ${dataset}. Available under CC0 1.0.`;
  if (license === "Apache-2.0") return `Data from ${dataset}. Available under Apache 2.0.`;
  return `Data from ${dataset}.`;
}

export const OVERTURE_LABEL = "Overture Maps Foundation";
export const OVERTURE_SOURCE_LINE = "Source: Overture Maps Foundation (overturemaps.org)";

/** Full attribution for one record, e.g. "Source: Overture Maps Foundation (overturemaps.org). Data from Meta. Available under CDLA Permissive 2.0." */
export function recordAttribution(
  dataset: string | null | undefined,
  license: DataLicenseId | null,
): string {
  const line = attributionLineFor(dataset, license);
  return line ? `${OVERTURE_SOURCE_LINE}. ${line}` : OVERTURE_SOURCE_LINE;
}

/** Boundaries used to assign states and LGAs (Overture divisions theme). */
export const DIVISIONS_ATTRIBUTION =
  "States and LGAs assigned from Overture Maps divisions boundaries: © OpenStreetMap contributors, available under the Open Database License (ODbL); geoBoundaries and Esri Community Maps contributors, available under CC BY 4.0.";

export const OVERTURE_MODIFICATIONS =
  "LeadForge changed the Overture Maps Places data it stores: phone numbers are normalized to international (E.164) format, website and social links are cleaned (tracking parameters, social and messaging links separated), invalid postcodes are dropped, places that share an upstream record or Facebook page are de-duplicated, and each place is assigned a state and local government area by point-in-polygon against Overture's division boundaries. Values may also be corrected or enriched by LeadForge users after import.";

export const DATA_DISCLAIMER =
  'Open data is provided by its publishers "as is", without warranties or conditions of any kind. LeadForge does not claim the data is accurate or verified unless a field says so, and no data provider endorses LeadForge or its customers.';

export function licenseRef(id: DataLicenseId): DataLicenseRef {
  return DATA_LICENSES[id];
}

/** Licensing block for the Overture Maps Places source (registry, wizard, public licences page). */
export const OVERTURE_LICENSING: SourceLicensing = {
  label: OVERTURE_LABEL,
  text: OVERTURE_SOURCE_LINE,
  url: "https://overturemaps.org",
  licenses: [
    licenseRef("CDLA-Permissive-2.0"),
    licenseRef("Apache-2.0"),
    licenseRef("CC0-1.0"),
    licenseRef("ODbL-1.0"),
    licenseRef("CC-BY-4.0"),
  ],
  upstream: OVERTURE_DATASETS.map((d) => ({
    dataset: d.dataset,
    text: d.line,
    license: d.license,
  })),
  requirements: [
    'Wherever Overture-derived values appear (discovery results, business detail, provenance, directory source chips), show "Source: Overture Maps Foundation (overturemaps.org)" and the record\'s dataset line, linked to the data licences page.',
    "Exports and API responses carrying the data must include the attribution and the licence texts, or links to them (CDLA-Permissive-2.0 section 2.1).",
    "Records from Foursquare (Apache-2.0) must also carry the Foursquare copyright line, the NOTICE content and a notice that LeadForge changed the data.",
    "State and LGA labels come from boundaries under ODbL and CC BY 4.0: credit OpenStreetMap contributors, geoBoundaries and Esri Community Maps contributors.",
    "Plain text only: no Overture, Meta or Foursquare logos, and nothing implying their endorsement.",
  ],
  licensesPath: DATA_LICENSES_PATH,
};
