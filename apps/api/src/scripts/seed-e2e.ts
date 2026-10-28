/**
 * Release end-to-end seed (Stage 9). Run by `pnpm e2e:release` (infra/e2e/release-stack.mjs)
 * after it recreated the dedicated e2e databases; never by hand against other data.
 *
 * Safety: refuses production, refuses unless BOTH databases are dedicated e2e databases
 * (PostgreSQL database name and MONGODB_DB ending in `_e2e`), and refuses a hosted MongoDB
 * cluster, so it can never write into development, test, load-test or customer data.
 *
 * What it writes (all synthetic and labelled; every business name ends in "(Sample)", every
 * domain and email is under example.test, phones are Ofcom drama numbers reserved for fiction):
 *
 * - For each Playwright project key (w1440, w375, smoke): an owner and a sales rep in one
 *   organization, and a rival owner in a second organization with one business, all with the
 *   password from E2E_SEED_PASSWORD (default below). The first organization gets a ledger `grant`
 *   (never a `purchase`) so its flows do not depend on the payment test.
 * - The Overture staging catalogue through the real sync service: the 25 real fixture records
 *   (core overture/fixtures) plus "(Sample)" pharmacies and bakeries inside an enlarged synthetic
 *   Ikeja boundary, so discovery jobs run against real catalogue code with no network access.
 * - Plans and credit packs from BILLING_CATALOGUE_PATH (infra/e2e/billing-catalogue.e2e.json:
 *   nonzero test prices, still flagged as placeholders, which only a test key may charge).
 *
 * Idempotent: a rerun on the same databases changes nothing it already wrote.
 */
import "reflect-metadata";
import argon2 from "argon2";
import { Module, type DynamicModule } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { v7 as uuidv7 } from "uuid";
import { PrismaService } from "@leadforge/db-postgres";
import {
  arraySnapshot,
  BillingCatalogueService,
  BillingModule,
  BusinessesModule,
  BusinessesService,
  CoreModule,
  CreditsModule,
  CreditsService,
  deterministicObjectId,
  EntitlementsModule,
  EntitlementsService,
  loadBillingCatalogue,
  normalizeCreateRequest,
  OVERTURE_FIXTURE_RELEASE,
  overtureFixtureDivisions,
  overtureFixtureRecords,
  OvertureModule,
  OvertureSyncService,
  SOURCE_CONFIDENCE,
  type OvertureRawPlace,
  type OvertureRawSource,
} from "@leadforge/core";

@Module({})
class E2eSeedModule {
  static forRoot(): DynamicModule {
    return {
      module: E2eSeedModule,
      imports: [
        CoreModule.forRoot(process.env),
        BusinessesModule,
        CreditsModule,
        OvertureModule,
        BillingModule,
        EntitlementsModule,
      ],
    };
  }
}

/** Project keys of apps/web/playwright.release.config.ts; each gets its own organizations. */
export const E2E_PROJECT_KEYS = ["w1440", "w375", "smoke"] as const;
export const E2E_DEFAULT_PASSWORD = "release-e2e-pass-2026";
export const E2E_CREDIT_GRANT = 500;
export const E2E_SAMPLE_PHARMACIES = 12;
export const E2E_SAMPLE_BAKERIES = 4;
const SEED_EPOCH = new Date("2026-10-01T00:00:00.000Z");

export function e2eEmail(role: "owner" | "rep" | "rival", key: string): string {
  return `${role}.${key}@e2e.example.test`;
}

function dbName(url: string): string {
  return new URL(url).pathname.replace(/^\//, "");
}

/** Ofcom drama numbers (+44 20 7946 0000 to 0999) are reserved for fiction: no real line. */
function dramaPhone(n: number): string {
  return `+44207946${String(n % 1000).padStart(4, "0")}`;
}

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

/** Synthetic places on a small grid next to the fixture's real Ikeja point. */
function samplePlaces(): {
  places: OvertureRawPlace[];
  box: { minX: number; minY: number; maxX: number; maxY: number };
} {
  const ikeja = overtureFixtureRecords().find((r) => r.expectedAdmin.lga === "Ikeja")!.place;
  const lon0 = ikeja.lon!;
  const lat0 = ikeja.lat!;
  const places: OvertureRawPlace[] = [];
  const make = (i: number, kind: "pharmacy" | "bakery", n: number): OvertureRawPlace => {
    const confidence = Math.round((0.95 - n * 0.01) * 100) / 100;
    const page = String(3_000_000_000 + i);
    const slug = `${kind}-${n}`;
    return {
      id: `e2e0${kind === "pharmacy" ? "a" : "b"}000-0000-4000-8000-${String(n).padStart(12, "0")}`,
      version: 1,
      name: `Ikeja ${kind === "pharmacy" ? "Pharmacy" : "Bakery"} ${n} (Sample)`,
      basic_category: kind === "pharmacy" ? "pharmacy_and_drug_store" : "bakery",
      taxonomy_primary: kind === "pharmacy" ? "pharmacy" : "bakery",
      taxonomy_hierarchy:
        kind === "pharmacy"
          ? ["shopping", "specialty_store", "pharmacy_and_drug_store", "pharmacy"]
          : ["food_and_drink", "food_and_drink_store", "bakery"],
      taxonomy_alternates: null,
      confidence,
      operating_status: null,
      websites: [`https://${slug}.e2e.example.test`],
      phones: [dramaPhone(100 + i)],
      emails: [`info@${slug}.e2e.example.test`],
      socials: [`https://www.facebook.com/${page}`],
      brand_name: null,
      brand_wikidata: null,
      addresses: [
        {
          freeform: `${n} Allen Avenue (Sample)`,
          locality: "Ikeja",
          postcode: "100001",
          region: "LA",
          country: "NG",
        },
      ],
      lon: lon0 + (i % 8) * 0.0004,
      lat: lat0 + Math.floor(i / 8) * 0.0004,
      sources: metaSources(page, confidence),
    };
  };
  let i = 0;
  for (let n = 1; n <= E2E_SAMPLE_PHARMACIES; n++) places.push(make(i++, "pharmacy", n));
  for (let n = 1; n <= E2E_SAMPLE_BAKERIES; n++) places.push(make(i++, "bakery", n));
  const pad = 0.01;
  return {
    places,
    box: {
      minX: lon0 - pad,
      minY: lat0 - pad,
      maxX: lon0 + 8 * 0.0004 + pad,
      maxY: lat0 + Math.ceil(i / 8) * 0.0004 + pad,
    },
  };
}

async function main(): Promise<void> {
  if (process.env.NODE_ENV === "production")
    throw new Error("Refusing to seed release e2e data in production");
  const mongoDb = process.env.MONGODB_DB ?? "";
  const pgDb = dbName(process.env.DATABASE_URL ?? "postgresql://x/none");
  if (!mongoDb.endsWith("_e2e") || !pgDb.endsWith("_e2e")) {
    throw new Error(
      `Refusing to seed: MONGODB_DB (${mongoDb}) and the DATABASE_URL database (${pgDb}) must both end in _e2e`,
    );
  }
  if (/mongodb\+srv:|mongodb\.net/i.test(process.env.MONGODB_URI ?? ""))
    throw new Error("Refusing to seed a hosted MongoDB cluster");
  const password = process.env.E2E_SEED_PASSWORD ?? E2E_DEFAULT_PASSWORD;

  const app = await NestFactory.createApplicationContext(E2eSeedModule.forRoot(), {
    logger: ["error", "warn"],
  });
  try {
    const prisma = app.get(PrismaService);
    const credits = app.get(CreditsService, { strict: false });
    const entitlements = app.get(EntitlementsService, { strict: false });
    const businesses = app.get(BusinessesService, { strict: false });
    const passwordHash = await argon2.hash(password, {
      type: argon2.argon2id,
      memoryCost: 64 * 1024,
      timeCost: 3,
    });
    const lines: string[] = [];

    const user = async (email: string, name: string) =>
      (await prisma.user.findUnique({ where: { email } })) ??
      prisma.user.create({
        data: { id: uuidv7(), email, name, passwordHash, emailVerifiedAt: new Date() },
      });

    const organization = async (
      slug: string,
      name: string,
      ownerId: string,
      ownerEmail: string,
    ) => {
      const existing = await prisma.organization.findUnique({ where: { slug } });
      if (existing) return existing;
      return prisma.$transaction(async (tx) => {
        const org = await tx.organization.create({
          data: {
            id: uuidv7(),
            name,
            slug,
            country: "NG",
            defaultCurrency: "NGN",
            createdByUserId: ownerId,
          },
        });
        await tx.membership.create({
          data: { id: uuidv7(), organizationId: org.id, userId: ownerId, role: "owner" },
        });
        const customer = await tx.billingCustomer.create({
          data: { id: uuidv7(), organizationId: org.id, email: ownerEmail, currency: "NGN" },
        });
        // A new organization starts on the free tier, exactly as registration does.
        await entitlements.writeForPlanInTx(tx, customer.id, null);
        return org;
      });
    };

    for (const key of E2E_PROJECT_KEYS) {
      const owner = await user(e2eEmail("owner", key), `Release Owner ${key} (Synthetic)`);
      const rep = await user(e2eEmail("rep", key), `Release Rep ${key} (Synthetic)`);
      const rival = await user(e2eEmail("rival", key), `Rival Owner ${key} (Synthetic)`);
      const org = await organization(
        `release-${key}-synthetic`,
        `Release Org ${key} (Synthetic)`,
        owner.id,
        owner.email,
      );
      const rivalOrg = await organization(
        `rival-${key}-synthetic`,
        `Rival Org ${key} (Synthetic)`,
        rival.id,
        rival.email,
      );
      const repMembership = await prisma.membership.findFirst({
        where: { organizationId: org.id, userId: rep.id },
      });
      if (!repMembership)
        await prisma.membership.create({
          data: { id: uuidv7(), organizationId: org.id, userId: rep.id, role: "sales_rep" },
        });
      await credits.grant(org.id, {
        units: E2E_CREDIT_GRANT,
        key: `seed:e2e-grant:${org.id}`,
        description: "Release e2e seed grant (synthetic). Not a purchase.",
        actorUserId: owner.id,
      });

      // One business in the rival organization: the isolation test must never see it.
      const { input, errors } = normalizeCreateRequest(
        {
          name: `Rival Secret Pharmacy ${key} (Sample)`,
          categories: ["Pharmacy"],
          website: `rival-${key}.e2e.example.test`,
          emails: [`hello@rival-${key}.e2e.example.test`],
          phones: [dramaPhone(900 + E2E_PROJECT_KEYS.indexOf(key))],
          location: {
            street: null,
            locality: "Ikeja",
            lga: null,
            region: "Lagos",
            country: "NG",
            postalCode: null,
          },
        },
        "NG",
      );
      if (!input) throw new Error(`Bad rival business: ${JSON.stringify(errors)}`);
      await businesses.ingestBatch(rivalOrg.id, [
        {
          input,
          newId: deterministicObjectId(`e2e:rival:${key}`, SEED_EPOCH),
          createdVia: { kind: "seed", importId: null, userId: rival.id },
          ctx: {
            source: "user_import",
            collectionMethod: "user_import",
            sourceRef: "e2e-seed",
            collectedAt: new Date(),
            confidence: SOURCE_CONFIDENCE.user_import,
            actor: { type: "system", userId: null },
            importId: null,
            note: "Synthetic release e2e record",
            idSeed: `e2e:rival:${key}`,
          },
        },
      ]);
      lines.push(
        `${key}: ${org.name} (${org.id}) owner ${owner.email}, sales rep ${rep.email}; ${rivalOrg.name} (${rivalOrg.id}) owner ${rival.email}`,
      );
    }

    const { places, box } = samplePlaces();
    const run = await app.get(OvertureSyncService, { strict: false }).load(
      arraySnapshot({
        release: OVERTURE_FIXTURE_RELEASE,
        schemaVersion: "2.0.0",
        places: [...overtureFixtureRecords().map((r) => r.place), ...places],
        divisions: overtureFixtureDivisions([{ state: "Lagos", lga: "Ikeja", ...box }]),
      }),
      { trigger: "manual", force: true },
    );
    if (run.status === "failed") throw new Error(`Overture e2e catalogue failed: ${run.error}`);
    lines.push(`Overture catalogue: ${run.status} ${JSON.stringify(run.counts)}`);

    const catalogue = loadBillingCatalogue(process.env.BILLING_CATALOGUE_PATH);
    const report = await app.get(BillingCatalogueService, { strict: false }).sync(catalogue);
    lines.push(
      `Billing catalogue from ${process.env.BILLING_CATALOGUE_PATH ?? "the built-in placeholders"}: ${report.plans.created + report.plans.updated} plans, ${report.creditPacks.created + report.creditPacks.updated} packs, ${report.placeholders} placeholders`,
    );

    process.stdout.write(`Release e2e seed complete.\n${lines.map((l) => `  ${l}`).join("\n")}\n`);
  } finally {
    await app.close();
  }
}

main().catch((err: unknown) => {
  process.stderr.write(`${err instanceof Error ? (err.stack ?? err.message) : String(err)}\n`);
  process.exit(1);
});
