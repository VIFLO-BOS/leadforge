import {
  DATA_LICENSES,
  DATA_LICENSES_PATH,
  DataLicenseId,
  type ExportColumn,
} from "@leadforge/contracts";
import type { ExportRow } from "../businesses/businesses.service.js";
import { csvLine } from "../normalization/csv-safety.js";
import { FOURSQUARE_NOTICE_TEXT, LICENSE_TEXTS } from "../overture/license-texts.js";
import {
  DATA_DISCLAIMER,
  OVERTURE_MODIFICATIONS,
  OVERTURE_SOURCE_LINE,
} from "../overture/overture-licensing.js";
import type { ZipEntry } from "../storage/zip.js";

const uniq = (values: Array<string | null | undefined>) => [
  ...new Set(values.filter((v): v is string => Boolean(v))),
];

/** Absolute URLs of the licence texts that apply to a row (the CSV carries no attachments). */
function licenseUrls(r: ExportRow, apiOrigin: string): string[] {
  return uniq(r.attributions.flatMap((a) => a.licenses.map((l) => `${apiOrigin}${l.textPath}`)));
}

export const COLUMN_VALUE: Record<
  ExportColumn,
  (r: ExportRow, apiOrigin: string) => string | null
> = {
  id: (r) => r.item.id,
  name: (r) => r.item.name,
  categories: (r) => r.item.categories.join("; "),
  street: (r) => r.street,
  locality: (r) => r.item.location.locality,
  lga: (r) => r.item.location.lga,
  region: (r) => r.item.location.region,
  country: (r) => r.item.location.country,
  website: (r) => r.item.website?.value ?? null,
  website_state: (r) => r.item.states.website,
  phone: (r) => r.item.phone?.value ?? null,
  phone_state: (r) => r.item.states.phone,
  phones_all: (r) => r.phones.join("; "),
  whatsapp: (r) => r.item.whatsapp,
  email: (r) => r.item.email?.value ?? null,
  email_state: (r) => r.item.states.email,
  emails_all: (r) => r.emails.join("; "),
  sources: (r) => r.item.sources.join("; "),
  source_records: (r) => r.refs.map((x) => `${x.source}:${x.externalId}`).join("; ") || null,
  source_datasets: (r) => uniq(r.refs.map((x) => x.dataset)).join("; ") || null,
  source_licenses: (r) => uniq(r.refs.map((x) => x.license)).join("; ") || null,
  overture_release: (r) =>
    uniq(r.refs.filter((x) => x.source === "overture_places").map((x) => x.release)).join("; ") ||
    null,
  attribution: (r) => r.attributions.map((a) => [a.text, ...a.lines].join(" ")).join(" | ") || null,
  license_urls: (r, apiOrigin) => licenseUrls(r, apiOrigin).join(" ") || null,
  last_verified_at: (r) => r.item.lastVerifiedAt,
  created_at: (r) => r.item.createdAt,
  updated_at: (r) => r.item.updatedAt,
};

/** CSV lines for rows; every cell is neutralized against spreadsheet formula injection by csvLine. */
export function csvRows(rows: ExportRow[], columns: ExportColumn[], apiOrigin: string): string {
  let out = "";
  for (const row of rows) out += csvLine(columns.map((c) => COLUMN_VALUE[c](row, apiOrigin)));
  return out;
}

/** What the rows of an export require: licences, attribution lines and whether the Foursquare NOTICE applies. */
export class AttributionCollector {
  readonly licenses = new Set<DataLicenseId>();
  readonly lines = new Set<string>();
  readonly sources = new Set<string>();
  foursquare = false;
  rows = 0;
  licensedRows = 0;

  add(rows: ExportRow[]): void {
    for (const r of rows) {
      this.rows += 1;
      if (r.attributions.some((a) => a.licenses.length > 0)) this.licensedRows += 1;
      for (const a of r.attributions) {
        this.sources.add(a.text);
        for (const line of a.lines) this.lines.add(line);
        for (const l of a.licenses) {
          const id = DataLicenseId.safeParse(l.id);
          if (id.success) this.licenses.add(id.data);
        }
      }
      if (r.refs.some((x) => x.dataset === "Foursquare" || x.license === "Apache-2.0"))
        this.foursquare = true;
    }
  }
}

export interface ExportManifest {
  exportId: string;
  generatedAt: Date;
  rowCount: number;
  truncated: boolean;
  rowCap: number;
  selection: string;
  scope: "all" | "assigned";
  apiOrigin: string;
  /** Replaces the default line about suppressed businesses and formula-safe cells (organization data export). */
  contentNote?: string;
  /** Title line (default "LeadForge export"). */
  title?: string;
}

/**
 * The ZIP an async export produces: the CSV, ATTRIBUTION.txt (always) and, when rows carry
 * openly licensed data, LICENSES/<licence>.txt for each licence that applies plus the Foursquare
 * NOTICE for Foursquare records (CDLA-Permissive-2.0 section 2.1 and Apache-2.0 section 4 ask
 * for the licence text and notices to travel with shared data).
 */
export function exportArchiveEntries(
  csvName: string,
  csv: string,
  attributions: AttributionCollector,
  manifest: ExportManifest,
): ZipEntry[] {
  const licenses = [...attributions.licenses].sort();
  const lines: string[] = [
    manifest.title ?? "LeadForge export",
    `Export id: ${manifest.exportId}`,
    `Generated: ${manifest.generatedAt.toISOString()}`,
    `Rows: ${manifest.rowCount}${manifest.truncated ? ` (stopped at the row cap of ${manifest.rowCap}; more businesses matched)` : ""}`,
    `Selection: ${manifest.selection}`,
    `Scope: ${manifest.scope === "assigned" ? "only businesses whose lead is assigned to the requester" : "all matching businesses"}`,
    manifest.contentNote ??
      "Suppressed businesses are never exported. Cells that start with = + - @ tab or carriage return are prefixed with a single quote.",
    "",
    "DATA SOURCES AND ATTRIBUTION",
  ];
  if (attributions.licensedRows === 0) {
    lines.push(
      "No row in this export carries openly licensed source data, so no licence text is bundled.",
    );
  } else {
    lines.push(
      `${attributions.licensedRows} of ${attributions.rows} rows carry openly licensed data from Overture Maps Places.`,
    );
    lines.push(OVERTURE_SOURCE_LINE);
    for (const source of [...attributions.sources].sort())
      if (source !== OVERTURE_SOURCE_LINE) lines.push(source);
    if (attributions.lines.size) {
      lines.push("", "Attribution required by the upstream datasets:");
      for (const line of [...attributions.lines].sort()) lines.push(`- ${line}`);
    }
    lines.push("", "Licences (full texts in the LICENSES folder):");
    for (const id of licenses)
      lines.push(
        `- ${DATA_LICENSES[id].name} (${id}): LICENSES/${id}.txt, ${DATA_LICENSES[id].referenceUrl}`,
      );
    if (attributions.foursquare)
      lines.push("- Foursquare OS Places NOTICE: LICENSES/FOURSQUARE-NOTICE.txt");
    lines.push(
      "",
      "Changes made by LeadForge:",
      OVERTURE_MODIFICATIONS,
      "",
      "Disclaimer:",
      DATA_DISCLAIMER,
    );
    lines.push(
      "",
      "Per-row sources, datasets, licences and attribution are in the CSV columns source_records, source_datasets, source_licenses, attribution and license_urls when selected.",
    );
  }
  lines.push(
    "",
    `Licence texts and attributions online: ${manifest.apiOrigin}${DATA_LICENSES_PATH}`,
  );

  const entries: ZipEntry[] = [
    { name: csvName, data: Buffer.from(csv, "utf8") },
    { name: "ATTRIBUTION.txt", data: Buffer.from(lines.join("\n") + "\n", "utf8") },
  ];
  for (const id of licenses) {
    const text =
      LICENSE_TEXTS[id] ||
      `${DATA_LICENSES[id].name}\n\nThe full text is published at ${DATA_LICENSES[id].referenceUrl}\n`;
    entries.push({ name: `LICENSES/${id}.txt`, data: Buffer.from(text, "utf8") });
  }
  if (attributions.foursquare)
    entries.push({
      name: "LICENSES/FOURSQUARE-NOTICE.txt",
      data: Buffer.from(FOURSQUARE_NOTICE_TEXT, "utf8"),
    });
  return entries;
}
