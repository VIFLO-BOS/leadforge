/**
 * Load-test seed (Phase 7): one synthetic organization with PERF_BUSINESSES (default 100,000)
 * "(Sample)" businesses, written through the real ingest path (normalization, exact dedup,
 * observations, field states, indexes). Used by the k6 scripts in infra/load/.
 *
 * Safety: refuses production, and refuses unless BOTH databases are dedicated load-test
 * databases (PostgreSQL database name and MONGODB_DB ending in `_perf`), so it can never write
 * into development, test or customer data. Every name ends in "(Sample)", every domain and email
 * is under example.test, and the only phone numbers are the Ofcom drama ranges used by the dev
 * seed (4,000 of them), so no value can reach a real business.
 *
 * Idempotent: deterministic ids per index; a rerun skips businesses that already exist.
 *
 * With PERF_OVERTURE_PLACES > 0 (default 20,000) it also loads a synthetic Overture staging
 * catalogue through the real sync service (the 25 fixture records plus that many "(Sample)"
 * pharmacies in a synthetic Ikeja boundary, with example.test websites and emails and no phone
 * numbers), so discovery jobs can be created and processed without any network access.
 *
 *   PERF_BUSINESSES=100000 node -r dotenv/config dist/scripts/seed-perf.js   (with *_perf databases)
 */
import "reflect-metadata";
import argon2 from "argon2";
import { Module, type DynamicModule } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { v7 as uuidv7 } from "uuid";
import { PrismaService } from "@leadforge/db-postgres";
import { Collections, MongoService, ObjectId } from "@leadforge/db-mongo";
import {
  arraySnapshot,
  BusinessesModule,
  BusinessesService,
  CoreModule,
  CreditsModule,
  CreditsService,
  deterministicObjectId,
  normalizeCreateRequest,
  OVERTURE_FIXTURE_RELEASE,
  overtureFixtureDivisions,
  overtureFixtureRecords,
  OvertureModule,
  OvertureSyncService,
  SOURCE_CONFIDENCE,
  type IngestItem,
  type OvertureRawPlace,
} from "@leadforge/core";

@Module({})
class PerfSeedModule {
  static forRoot(): DynamicModule {
    return {
      module: PerfSeedModule,
      imports: [CoreModule.forRoot(process.env), BusinessesModule, CreditsModule, OvertureModule],
    };
  }
}

export const PERF_OWNER_EMAIL = "perf-owner@example.test";
const PERF_ORG_SLUG = "perf-load-test-synthetic";
const EPOCH = new Date("2026-10-01T00:00:00.000Z");
const DAY = 24 * 60 * 60 * 1000;

const CATEGORIES = [
  "Restaurant",
  "Bakery",
  "Pharmacy",
  "Dental clinic",
  "Hospital",
  "Hotel",
  "Supermarket",
  "Fashion boutique",
  "Hair salon",
  "Barber shop",
  "Auto repair",
  "Car dealer",
  "Logistics",
  "Law firm",
  "Accounting firm",
  "School",
  "Church",
  "Gym",
  "Event centre",
  "Printing press",
  "Electronics store",
  "Furniture store",
  "Real estate agency",
  "Travel agency",
  "Laundry",
  "Pharmacy wholesale",
  "Building materials",
  "Photography studio",
  "Catering",
  "Clinic",
];
const PLACES: Array<[region: string, localities: string[]]> = [
  [
    "Lagos",
    [
      "Ikeja",
      "Yaba",
      "Surulere",
      "Lekki",
      "Ikoyi",
      "Victoria Island",
      "Ajah",
      "Apapa",
      "Festac Town",
      "Maryland",
    ],
  ],
  ["Federal Capital Territory", ["Wuse", "Garki", "Maitama", "Gwarinpa", "Kubwa", "Asokoro"]],
  ["Rivers", ["Port Harcourt", "Obio-Akpor", "Eleme"]],
  ["Oyo", ["Ibadan", "Ogbomosho", "Oyo"]],
  ["Kano", ["Kano", "Nassarawa", "Fagge"]],
  ["Kaduna", ["Kaduna", "Zaria"]],
  ["Enugu", ["Enugu", "Nsukka"]],
  ["Anambra", ["Onitsha", "Awka", "Nnewi"]],
  ["Delta", ["Warri", "Asaba"]],
  ["Ogun", ["Abeokuta", "Ota", "Ijebu-Ode"]],
];
const ADJECTIVES = [
  "Golden",
  "Royal",
  "Prime",
  "Eko",
  "Unity",
  "Bright",
  "Grace",
  "Zenith",
  "Delta",
  "Crown",
  "Star",
  "Heritage",
  "Pioneer",
  "Summit",
  "Oasis",
  "Harmony",
];
const DRAMA_RANGES = ["+44 20 7946 0", "+44 113 496 0", "+44 161 496 0", "+44 117 496 0"];

/** Synthetic pharmacies on a grid around the fixture's Ikeja point, inside an enlarged synthetic Ikeja boundary. */
function perfPlaces(n: number): {
  places: OvertureRawPlace[];
  box: { minX: number; minY: number; maxX: number; maxY: number };
} {
  const ikeja = overtureFixtureRecords().find((r) => r.expectedAdmin.lga === "Ikeja")!.place;
  const lon0 = ikeja.lon!;
  const lat0 = ikeja.lat!;
  const side = Math.ceil(Math.sqrt(n));
  const step = 0.0002;
  const places: OvertureRawPlace[] = [];
  for (let i = 0; i < n; i++) {
    const page = String(2_000_000_000 + i);
    places.push({
      id: `7e3f0000-0000-4000-8000-${String(i).padStart(12, "0")}`,
      version: 1,
      name: `Perf Pharmacy ${i} (Sample)`,
      basic_category: "pharmacy_and_drug_store",
      taxonomy_primary: "pharmacy",
      taxonomy_hierarchy: ["shopping", "specialty_store", "pharmacy_and_drug_store", "pharmacy"],
      taxonomy_alternates: null,
      confidence: 0.9,
      operating_status: null,
      websites: [`https://perf-pharmacy-${i}.example.test`],
      phones: null,
      emails: [`info@perf-pharmacy-${i}.example.test`],
      socials: [`https://www.facebook.com/${page}`],
      brand_name: null,
      brand_wikidata: null,
      addresses: [
        {
          freeform: `${i} Perf Avenue (Sample)`,
          locality: "Ikeja",
          postcode: "100001",
          region: "LA",
          country: "NG",
        },
      ],
      lon: lon0 + (i % side) * step,
      lat: lat0 + Math.floor(i / side) * step,
      sources: [
        {
          property: "",
          dataset: "meta",
          license: "CDLA-Permissive-2.0",
          record_id: page,
          update_time: "2026-10-12T00:00:00.000Z",
          confidence: 0.9,
        },
      ],
    });
  }
  const pad = 0.01;
  return {
    places,
    box: {
      minX: lon0 - pad,
      minY: lat0 - pad,
      maxX: lon0 + side * step + pad,
      maxY: lat0 + side * step + pad,
    },
  };
}

function dbName(url: string): string {
  return new URL(url).pathname.replace(/^\//, "");
}

function spec(i: number) {
  const category = CATEGORIES[i % CATEGORIES.length]!;
  const [region, localities] = PLACES[(i * 7) % PLACES.length]!;
  const locality = localities[(i * 13) % localities.length]!;
  const name = `${ADJECTIVES[(i * 3) % ADJECTIVES.length]} ${category} ${locality} ${i} (Sample)`;
  const site = `biz${i}.perf.example.test`;
  return {
    name,
    categories: i % 5 === 0 ? [category, CATEGORIES[(i + 11) % CATEGORIES.length]!] : [category],
    website: i % 5 < 3 ? site : undefined,
    emails: i % 10 < 3 ? [`hello@${site}`] : [],
    phones: i < 4000 ? [`${DRAMA_RANGES[i % 4]}${String(Math.floor(i / 4)).padStart(3, "0")}`] : [],
    location: {
      street: null,
      locality,
      lga: null,
      region,
      country: "NG" as const,
      postalCode: null,
    },
  };
}

async function main(): Promise<void> {
  if (process.env.NODE_ENV === "production")
    throw new Error("Refusing to seed load-test data in production");
  const mongoDb = process.env.MONGODB_DB ?? "";
  const pgDb = dbName(process.env.DATABASE_URL ?? "postgresql://x/none");
  if (!mongoDb.endsWith("_perf") || !pgDb.endsWith("_perf")) {
    throw new Error(
      `Refusing to seed: MONGODB_DB (${mongoDb}) and the DATABASE_URL database (${pgDb}) must both end in _perf`,
    );
  }
  if (/mongodb\+srv:|mongodb\.net/i.test(process.env.MONGODB_URI ?? ""))
    throw new Error("Refusing to seed a hosted MongoDB cluster");
  const total = Number(process.env.PERF_BUSINESSES ?? 100_000);
  const batchSize = Number(process.env.PERF_BATCH ?? 1000);
  const password = process.env.PERF_OWNER_PASSWORD ?? "synthetic-perf-pass-2026";

  const app = await NestFactory.createApplicationContext(PerfSeedModule.forRoot(), {
    logger: ["error", "warn"],
  });
  try {
    const prisma = app.get(PrismaService);
    let owner = await prisma.user.findUnique({ where: { email: PERF_OWNER_EMAIL } });
    if (!owner) {
      const passwordHash = await argon2.hash(password, {
        type: argon2.argon2id,
        memoryCost: 64 * 1024,
        timeCost: 3,
      });
      owner = await prisma.user.create({
        data: {
          id: uuidv7(),
          email: PERF_OWNER_EMAIL,
          name: "Perf Owner (Synthetic)",
          passwordHash,
          emailVerifiedAt: new Date(),
        },
      });
    }
    let org = await prisma.organization.findUnique({ where: { slug: PERF_ORG_SLUG } });
    if (!org) {
      org = await prisma.organization.create({
        data: {
          id: uuidv7(),
          name: "Perf Load Test (Synthetic)",
          slug: PERF_ORG_SLUG,
          country: "NG",
          defaultCurrency: "NGN",
          createdByUserId: owner.id,
        },
      });
      await prisma.membership.create({
        data: { id: uuidv7(), organizationId: org.id, userId: owner.id, role: "owner" },
      });
      await prisma.billingCustomer.create({
        data: { id: uuidv7(), organizationId: org.id, email: owner.email, currency: "NGN" },
      });
    }
    await app
      .get(CreditsService, { strict: false })
      .grant(org.id, {
        units: 1_000_000,
        key: `perf:grant:${org.id}`,
        description: "Load-test grant (synthetic)",
        actorUserId: owner.id,
      });

    const overtureCount = Number(process.env.PERF_OVERTURE_PLACES ?? 20_000);
    if (overtureCount > 0) {
      const t0 = Date.now();
      const { places, box } = perfPlaces(overtureCount);
      const run = await app.get(OvertureSyncService, { strict: false }).load(
        arraySnapshot({
          release: OVERTURE_FIXTURE_RELEASE,
          schemaVersion: "2.0.0",
          places: [...overtureFixtureRecords().map((r) => r.place), ...places],
          divisions: overtureFixtureDivisions([{ state: "Lagos", lga: "Ikeja", ...box }]),
        }),
        { trigger: "manual", force: true },
      );
      process.stdout.write(
        `Overture perf catalogue: ${run.status} ${JSON.stringify(run.counts)} in ${((Date.now() - t0) / 1000).toFixed(0)} s\n`,
      );
    }

    const businesses = app.get(BusinessesService, { strict: false });
    const collection = app.get(MongoService).database.collection(Collections.businesses);
    const started = Date.now();
    let written = 0;
    for (let start = 0; start < total; start += batchSize) {
      const end = Math.min(total, start + batchSize);
      const wanted = Array.from({ length: end - start }, (_, k) => start + k);
      const idsWanted = wanted.map((i) => deterministicObjectId(`perf:${i}`, EPOCH));
      const existing = new Set(
        (
          await collection
            .find({ organizationId: org.id, _id: { $in: idsWanted } }, { projection: { _id: 1 } })
            .toArray()
        ).map((d) => (d._id as ObjectId).toHexString()),
      );
      const items: IngestItem[] = [];
      for (const [k, i] of wanted.entries()) {
        const newId = idsWanted[k]!;
        if (existing.has(newId.toHexString())) continue;
        const { input, errors } = normalizeCreateRequest(spec(i), "NG");
        if (!input) throw new Error(`Bad synthetic business ${i}: ${JSON.stringify(errors)}`);
        const collectedAt = new Date(EPOCH.getTime() - (i % 400) * DAY);
        items.push({
          input,
          newId,
          createdVia: { kind: "seed", importId: null, userId: owner.id },
          ctx: {
            source: "user_import",
            collectionMethod: "user_import",
            sourceRef: "perf-seed",
            collectedAt,
            confidence: SOURCE_CONFIDENCE.user_import,
            actor: { type: "system", userId: null },
            importId: null,
            note: "Synthetic load-test record",
            idSeed: `perf:${i}`,
          },
        });
      }
      if (items.length) await businesses.ingestBatch(org.id, items);
      written += items.length;
      const elapsed = (Date.now() - started) / 1000;
      process.stdout.write(
        `batch ${start}-${end - 1}: +${items.length} (total new ${written}, ${(written / Math.max(elapsed, 0.001)).toFixed(0)}/s, ${elapsed.toFixed(0)} s)\n`,
      );
    }
    const count = await collection.countDocuments({ organizationId: org.id });
    process.stdout.write(
      `Perf seed complete: organization ${org.id}, ${count} businesses. Sign in: ${PERF_OWNER_EMAIL} (password from PERF_OWNER_PASSWORD or the documented default).\n`,
    );
  } finally {
    await app.close();
  }
}

main().catch((err: unknown) => {
  process.stderr.write(`${err instanceof Error ? (err.stack ?? err.message) : String(err)}\n`);
  process.exit(1);
});
