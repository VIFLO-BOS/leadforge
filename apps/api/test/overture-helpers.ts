import { Collections, MongoService, ObjectId } from "@leadforge/db-mongo";
import { DiscoveryJobSpec, type DiscoveryJobSpecInput } from "@leadforge/contracts";
import {
  arraySnapshot,
  BusinessesService,
  OverturePlacesAdapter,
  SOURCE_CONFIDENCE,
  type OverturePlaceDocument,
  OVERTURE_FIXTURE_RELEASE,
  OvertureCatalogService,
  overtureFixtureDivisions,
  overtureFixtureRecords,
  OvertureSyncService,
  type OvertureRawPlace,
  type OvertureRawSource,
  type OvertureSyncRunDocument,
} from "@leadforge/core";
import type { Harness } from "./harness.js";

/**
 * Overture test data. Discovery tests read the staging catalogue loaded through the real sync
 * service: the 25 real fixture records (core overture/fixtures) plus synthetic "(Sample)" pharmacies
 * in Ikeja, placed inside the fixture's synthetic Ikeja boundary. The samples cover every rule:
 *
 * - 1 to 22: ordinary places, confidence 0.94 down to 0.73, phone, email and website.
 * - 23: confidence 0.55 (offered under `standard`, flagged LOWER_CONFIDENCE; not under `high`).
 * - 24: confidence 0.45, below the floor (never offered).
 * - 25: permanently closed (never offered).
 * - 26: no phone, email or website, only a Facebook page (offered only with requireContact false).
 * - 27: the same Meta page as 3 under another GERS id (a duplicate; hidden, 3 is offered).
 * - 28: Uberall listing with the same Facebook page and name as 4 (a duplicate across datasets; hidden).
 * - 29: a chain branch with the same name and Facebook page as 5 but its own Meta page (kept).
 *
 * So a standard Ikeja pharmacy search matches 24 places (1-23 and 29); `high` matches 22.
 */
export const SAMPLE_MATCHES_STANDARD = 24;
export const SAMPLE_MATCHES_HIGH = 22;

const ikeja = overtureFixtureRecords().find((r) => r.expectedAdmin.lga === "Ikeja")!.place;
export const IKEJA_POINT = { lon: ikeja.lon!, lat: ikeja.lat! };

export function sampleId(i: number): string {
  return `5a3b1e00-0000-4000-8000-${String(i).padStart(12, "0")}`;
}

export function sampleName(i: number): string {
  return `Ikeja Pharmacy ${i} (Sample)`;
}

const pageId = (i: number) => String(1_000_000_000 + i);

function metaSources(record: string, confidence: number): OvertureRawSource[] {
  return [
    {
      property: "",
      dataset: "meta",
      license: "CDLA-Permissive-2.0",
      record_id: record,
      update_time: "2026-10-12T00:00:00.000Z",
      confidence,
      provider: "meta",
      resource: "meta",
      version: "2026-10-12",
    },
    {
      property: "/properties/confidence",
      dataset: "Overture",
      license: "CDLA-Permissive-2.0",
      record_id: null,
      update_time: "2026-10-15T18:00:21Z",
      confidence: null,
      provider: "overture",
      resource: "confidence_calculation",
      version: "2026-10-15",
    },
  ];
}

export function samplePlace(
  i: number,
  overrides: Partial<OvertureRawPlace> = {},
): OvertureRawPlace {
  const confidence = overrides.confidence ?? Math.round((0.95 - i * 0.01) * 100) / 100;
  return {
    id: sampleId(i),
    version: 1,
    name: sampleName(i),
    basic_category: "pharmacy_and_drug_store",
    taxonomy_primary: "pharmacy",
    taxonomy_hierarchy: ["shopping", "specialty_store", "pharmacy_and_drug_store", "pharmacy"],
    taxonomy_alternates: null,
    confidence,
    operating_status: null,
    websites: [`https://pharmacy-${i}.example.test`],
    phones: [`+234803100${String(i).padStart(4, "0")}`],
    emails: [`info@pharmacy-${i}.example.test`],
    socials: [`https://www.facebook.com/${pageId(i)}`],
    brand_name: null,
    brand_wikidata: null,
    addresses: [
      {
        freeform: `${i} Allen Avenue (Sample)`,
        locality: "Ikeja",
        postcode: "100001",
        region: "LA",
        country: "NG",
      },
    ],
    lon: IKEJA_POINT.lon + (i % 10) * 0.0004,
    lat: IKEJA_POINT.lat + Math.floor(i / 10) * 0.0004,
    sources: metaSources(pageId(i), confidence),
    ...overrides,
  };
}

export function sampleDataset(): OvertureRawPlace[] {
  const out: OvertureRawPlace[] = [];
  for (let i = 1; i <= 22; i++) out.push(samplePlace(i));
  out.push(samplePlace(23, { confidence: 0.55 }));
  out.push(samplePlace(24, { confidence: 0.45 }));
  out.push(samplePlace(25, { operating_status: "permanently_closed" }));
  out.push(samplePlace(26, { phones: null, emails: null, websites: null }));
  out.push(
    samplePlace(27, {
      name: sampleName(3),
      confidence: 0.6,
      sources: metaSources(pageId(3), 0.6),
      socials: [`https://www.facebook.com/${pageId(3)}`],
    }),
  );
  out.push(
    samplePlace(28, {
      name: sampleName(4),
      confidence: 0.6,
      sources: [
        {
          property: "",
          dataset: "Uberall",
          license: "CDLA-Permissive-2.0",
          record_id: "uberall-28",
          update_time: "2026-10-01T00:00:00.000Z",
          confidence: 0.6,
        },
      ],
      socials: [`https://www.facebook.com/${pageId(4)}`],
      phones: ["+2348031009928"],
      emails: null,
      websites: null,
    }),
  );
  out.push(
    samplePlace(29, {
      name: sampleName(5),
      socials: [`https://www.facebook.com/${pageId(29)}`, `https://www.facebook.com/${pageId(5)}`],
    }),
  );
  return out;
}

/** Loads the 25 real fixtures plus the samples (or `places`) into the staging catalogue. */
export async function seedOverture(
  h: Harness,
  options: { places?: OvertureRawPlace[]; release?: string; force?: boolean } = {},
): Promise<OvertureSyncRunDocument> {
  const places = options.places ?? [
    ...overtureFixtureRecords().map((r) => r.place),
    ...sampleDataset(),
  ];
  const run = await h.app
    .get(OvertureSyncService, { strict: false })
    .load(
      arraySnapshot({
        release: options.release ?? OVERTURE_FIXTURE_RELEASE,
        schemaVersion: "2.0.0",
        places,
        divisions: overtureFixtureDivisions(),
      }),
      { trigger: "test", force: options.force },
    );
  if (run.status === "failed") throw new Error(`Overture seed failed: ${run.error}`);
  return run;
}

/** Forget the cached snapshot (after resetState emptied the catalogue). */
export function forgetOverture(h: Harness): void {
  h.app.get(OvertureCatalogService, { strict: false }).invalidate();
}

/** The default wizard spec for tests: pharmacies in Ikeja LGA, Lagos. */
export function overtureSpec(
  overrides: Partial<DiscoveryJobSpecInput> = {},
): DiscoveryJobSpecInput {
  return {
    name: "Ikeja pharmacies",
    sources: ["overture_places"],
    location: { country: "NG", region: "Lagos", lga: "Ikeja" },
    categories: ["Pharmacy"],
    maxRecords: 50,
    ...overrides,
  };
}

/**
 * Links a business in the organization to an Overture place through the real ingest path, as
 * a discovery job would (mapToObservations, then ingestBatch with the source reference).
 */
export async function ingestOverturePlace(
  h: Harness,
  organizationId: string,
  placeId: string,
): Promise<string> {
  const db = h.app.get(MongoService).database;
  const place = await db
    .collection<OverturePlaceDocument>(Collections.overturePlaces)
    .findOne({ _id: placeId });
  if (!place) throw new Error(`No staged place ${placeId}`);
  const adapter = h.app.get(OverturePlacesAdapter, { strict: false });
  await adapter.refreshState();
  const mapped = adapter.mapToObservations(place, {
    spec: DiscoveryJobSpec.parse(overtureSpec()),
    collectedAt: new Date(),
  });
  const jobId = new ObjectId();
  const [result] = await h.app
    .get(BusinessesService, { strict: false })
    .ingestBatch(organizationId, [
      {
        input: mapped.input!,
        newId: new ObjectId(),
        createdVia: { kind: "discovery", importId: null, userId: null, discoveryJobId: jobId },
        ctx: {
          source: "overture_places",
          collectionMethod: "dataset_snapshot",
          sourceRef: mapped.provenance.sourceRef,
          collectedAt: new Date(),
          observedAt: mapped.provenance.observedAt ?? null,
          confidence: SOURCE_CONFIDENCE.overture_places,
          actor: { type: "system", userId: null },
          importId: null,
          note: null,
          idSeed: null,
          metadata: mapped.provenance.metadata,
          attribution: mapped.provenance.attribution,
          sourceExternalId: place._id,
          discoveryJobId: jobId,
          categoryTaxonomy: "overture",
          externalRef: {
            source: "overture_places",
            externalId: place._id,
            expiresAt: null,
            matchKeys: mapped.provenance.matchKeys,
            ...mapped.provenance.ref,
          },
        },
      },
    ]);
  return result!.businessId!.toHexString();
}
