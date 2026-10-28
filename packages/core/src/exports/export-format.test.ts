import { describe, expect, it } from "vitest";
import { DATA_LICENSES } from "@leadforge/contracts";
import type { ExportRow } from "../businesses/businesses.service.js";
import { AttributionCollector, csvRows, exportArchiveEntries } from "./export-format.js";

function row(overrides: Partial<ExportRow> & { name: string }): ExportRow {
  return {
    item: {
      id: "65f000000000000000000001",
      name: overrides.name,
      slug: "x",
      categories: [],
      location: { formatted: null, locality: "Ikeja", lga: null, region: "Lagos", country: "NG" },
      website: null,
      phone: {
        value: "+2348031234567",
        international: "+234 803 123 4567",
        state: "unverified",
        whatsapp: "unknown",
      },
      phoneCount: 1,
      email: null,
      emailCount: 0,
      whatsapp: "unknown",
      states: {
        name: "unverified",
        website: "missing",
        phone: "unverified",
        email: "missing",
        location: "unverified",
      },
      score: null,
      sources: ["user_import"],
      sourceCount: 1,
      suppressed: false,
      lastVerifiedAt: null,
      createdAt: "2026-10-26T00:00:00.000Z",
      updatedAt: "2026-10-26T00:00:00.000Z",
    },
    street: null,
    phones: ["+2348031234567"],
    emails: [],
    refs: [],
    attributions: [],
    ...overrides,
  };
}

const manifest = {
  exportId: "65f0",
  generatedAt: new Date("2026-10-26T10:00:00Z"),
  rowCount: 1,
  truncated: false,
  rowCap: 10,
  selection: "lead list",
  scope: "all" as const,
  apiOrigin: "https://api.example.test",
};

describe("export archive", () => {
  it("neutralizes formula cells but keeps E.164 numbers", () => {
    const csv = csvRows(
      [row({ name: '=HYPERLINK("http://evil.example")' })],
      ["name", "phone"],
      "",
    );
    expect(csv).toBe('"\'=HYPERLINK(""http://evil.example"")",+2348031234567\r\n');
  });

  it("bundles no licence text when no row carries open data", () => {
    const collector = new AttributionCollector();
    collector.add([row({ name: "Imported Only" })]);
    const entries = exportArchiveEntries("x.csv", "csv", collector, manifest);
    expect(entries.map((e) => e.name)).toEqual(["x.csv", "ATTRIBUTION.txt"]);
    expect(entries[1]!.data.toString()).toMatch(
      /No row in this export carries openly licensed source data/,
    );
  });

  it("bundles each licence that applies, the Foursquare NOTICE and the attribution lines", () => {
    const licensed = row({
      name: "Pharmacy",
      refs: [
        {
          source: "overture_places",
          externalId: "gers-1",
          dataset: "Foursquare",
          license: "Apache-2.0",
          release: "2026-10-21.0",
        } as ExportRow["refs"][number],
      ],
      attributions: [
        {
          source: "overture_places",
          text: "Source: Overture Maps Foundation (overturemaps.org)",
          lines: ["Data from Foursquare OS Places. Available under Apache 2.0."],
          licenses: [DATA_LICENSES["Apache-2.0"], DATA_LICENSES["ODbL-1.0"]],
        },
      ],
    });
    const collector = new AttributionCollector();
    collector.add([licensed, row({ name: "Imported" })]);
    const entries = exportArchiveEntries("x.csv", "csv", collector, { ...manifest, rowCount: 2 });
    expect(entries.map((e) => e.name)).toEqual([
      "x.csv",
      "ATTRIBUTION.txt",
      "LICENSES/Apache-2.0.txt",
      "LICENSES/ODbL-1.0.txt",
      "LICENSES/FOURSQUARE-NOTICE.txt",
    ]);
    const attribution = entries[1]!.data.toString();
    expect(attribution).toMatch(/1 of 2 rows carry openly licensed data/);
    expect(attribution).toMatch(/Data from Foursquare OS Places/);
    expect(attribution).toMatch(/LICENSES\/Apache-2.0.txt/);
    expect(attribution).toMatch(/https:\/\/api.example.test\/api\/v1\/public\/data-licenses/);
    expect(entries[2]!.data.toString()).toMatch(/Apache License/);
    expect(entries[4]!.data.toString()).toMatch(/Foursquare OS Places Notice/);
  });
});
