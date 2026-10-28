/**
 * Development-only sample business data for the seeded organization. Every business name
 * ends in "(Sample)", every domain and email is under the reserved .test TLD, and every phone
 * number comes from Ofcom's geographic ranges reserved for TV and radio drama (020 7946 0xxx,
 * 0113 496 0xxx, 0161 496 0xxx, 0117 496 0xxx), so no sample value can reach a real business
 * or person. (The 07700 900xxx mobile drama range is not accepted as valid by libphonenumber.)
 *
 * The data goes through the real code paths (CSV import, ingest, suppression) and uses
 * deterministic ids, so running the seed again changes nothing.
 */
import "reflect-metadata";
import { Module, type DynamicModule } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { Collections, MongoService, ObjectId } from "@leadforge/db-mongo";
import {
  BusinessesService,
  CoreModule,
  QueueNames,
  QueueService,
  deterministicObjectId,
  ImportsModule,
  ImportsService,
  normalizeCreateRequest,
  SOURCE_CONFIDENCE,
  type IngestItem,
  type ProvenanceContext,
} from "@leadforge/core";
import type { CreateBusinessRequest, ImportMappingEntry } from "@leadforge/contracts";

@Module({})
class SeedModule {
  static forRoot(): DynamicModule {
    return { module: SeedModule, imports: [CoreModule.forRoot(process.env), ImportsModule] };
  }
}

const SEED_EPOCH = new Date("2026-10-01T09:00:00.000Z");
const DAY = 24 * 60 * 60 * 1000;

const LAGOS_CSV = [
  "Business Name,Category,Phone,Email,Website,Address,City,LGA,State,WhatsApp",
  "Mama Put Kitchen (Sample),Restaurant,+44 20 7946 0101,hello@mamaput.example.test,mamaput.example.test,14 Allen Avenue,Ikeja,Ikeja,Lagos,yes",
  "Eko Fresh Bakery (Sample),Bakery,+44 20 7946 0102,,ekofresh.example.test,3 Adeniran Ogunsanya Street,Surulere,Surulere,Lagos,",
  '"Lekki Dental Clinic (Sample)","Dental clinic; Healthcare",+44 20 7946 0103,care@lekkidental.example.test,,21 Admiralty Way,Lekki,Eti-Osa,Lagos State,',
  "Yaba Tech Hub (Sample),Coworking space,,info@yabahub.example.test,yabahub.example.test,7 Herbert Macaulay Way,Yaba,Yaba,LAGOS,",
  "Ikoyi Interiors (Sample),Interior design,+44 113 496 0101,,ikoyiinteriors.example.test,,Ikoyi,Eti-Osa,Lagos,",
  "Apapa Freight Services (Sample),Logistics,+44 113 496 0102,ops@apapafreight.example.test,,Wharf Road,Apapa,Apapa,Lagos,",
  "Ajah Pharmacy (Sample),Pharmacy,+44 113 496 0103,,,,Ajah,Eti-Osa,Lagos,+44 113 496 0103",
  '"Victoria Island Law Chambers (Sample)",Legal services,+44 20 7946 0104,chambers@vilaw.example.test,vilaw.example.test,"5 Adeola Odeku Street, Victoria Island",Victoria Island,Eti-Osa,Lagos,',
  "Festac Auto Repairs (Sample),Auto repair,+44 113 496 0104,,,,Festac Town,Amuwo-Odofin,Lagos,",
  "Mama Put Kitchen (Sample),Catering,+44 20 7946 0101,orders@mamaput.example.test,,,Ikeja,Ikeja,Lagos,",
  "Broken Phone Shop (Sample),Electronics,12345,,,,Ikeja,Ikeja,Lagos,",
  '"=SUM(1,2) (Sample)",Retail,+44 113 496 0105,,,,Ikeja,Ikeja,Lagos,',
];
const LAGOS_MAPPING: ImportMappingEntry[] = [
  { column: 0, field: "name" },
  { column: 1, field: "category" },
  { column: 2, field: "phone" },
  { column: 3, field: "email" },
  { column: 4, field: "website" },
  { column: 5, field: "street" },
  { column: 6, field: "locality" },
  { column: 7, field: "lga" },
  { column: 8, field: "region" },
  { column: 9, field: "whatsapp" },
];

const NATIONAL_CSV = [
  "Name,Industry,Telephone,E-mail,Web,Town,LGA,State,Country",
  '"Wuse Market Textiles (Sample)","Textiles; Retail",+44 161 496 0201,sales@wusetextiles.example.test,,Wuse,Abuja Municipal,FCT,Nigeria',
  "Garki Medical Centre (Sample),Hospital,+44 20 7946 0201,info@garkimed.example.test,garkimed.example.test,Garki,Abuja Municipal,Abuja,NG",
  "Maitama Realty (Sample),Real estate,+44 161 496 0202,,maitamarealty.example.test,Maitama,Abuja Municipal,FCT,NG",
  "GRA Port Harcourt Suites (Sample),Hotel,+44 20 7946 0202,stay@grasuites.example.test,grasuites.example.test,Port Harcourt,Port Harcourt,Rivers,NG",
  "Bodija Printing Press (Sample),Printing,+44 161 496 0203,,,Ibadan,Ibadan North,Oyo,NG",
  "Kano Leather Works (Sample),Leather goods,+44 161 496 0204,info@kanoleather.example.test,,Kano,Kano Municipal,Kano,NG",
  "Yaba Tech Hub (Sample),Coworking space,,info@yabahub.example.test,yabatechhub.example.test,Yaba,Yaba,Lagos,NG",
  "Atlantis Traders (Sample),Retail,+44 161 496 0205,,,Atlantis City,,,Atlantis",
];
const NATIONAL_MAPPING: ImportMappingEntry[] = [
  { column: 0, field: "name" },
  { column: 1, field: "category" },
  { column: 2, field: "phone" },
  { column: 3, field: "email" },
  { column: 4, field: "website" },
  { column: 5, field: "locality" },
  { column: 6, field: "lga" },
  { column: 7, field: "region" },
  { column: 8, field: "country" },
];

type Sample = Partial<CreateBusinessRequest> & { name: string };

/** Entered by hand (user_edit), recent. */
const MANUAL: Sample[] = [
  {
    name: "Ibadan Grains Wholesale (Sample)",
    categories: ["Wholesale", "Agriculture"],
    phones: ["+44 117 496 0301"],
    location: { locality: "Ibadan", lga: "Ibadan South-West", region: "Oyo" },
  },
  {
    name: "Enugu Coal City Cafe (Sample)",
    categories: ["Cafe"],
    emails: ["hello@coalcitycafe.example.test"],
    website: "coalcitycafe.example.test",
    location: { locality: "Enugu", region: "Enugu" },
  },
  {
    name: "Calabar Carnival Events (Sample)",
    categories: ["Event planning"],
    phones: ["+44 20 7946 0301"],
    emails: ["events@calabarcarnival.example.test"],
    location: { locality: "Calabar", region: "Cross River" },
  },
  {
    name: "Jos Plateau Farms (Sample)",
    categories: ["Agriculture"],
    phones: ["+44 117 496 0302"],
    location: { locality: "Jos", region: "Plateau" },
  },
  {
    name: "Benin Bronze Gallery (Sample)",
    categories: ["Art gallery"],
    website: "https://www.beninbronze.example.test",
    location: { locality: "Benin City", region: "Edo" },
  },
  {
    name: "Owerri Tech Repairs (Sample)",
    categories: ["Electronics repair"],
    phones: ["+44 117 496 0303"],
    emails: ["fix@owerritech.example.test"],
    location: { locality: "Owerri", region: "Imo" },
  },
];

/** Observed long ago, so they show as stale under the default 180-day window. */
const STALE: Sample[] = [
  {
    name: "Aba Shoe Makers (Sample)",
    categories: ["Footwear"],
    phones: ["+44 117 496 0401"],
    location: { locality: "Aba", region: "Abia" },
  },
  {
    name: "Onitsha Spare Parts (Sample)",
    categories: ["Auto parts"],
    phones: ["+44 117 496 0402"],
    emails: ["parts@onitshaspares.example.test"],
    location: { locality: "Onitsha", region: "Anambra" },
  },
  {
    name: "Kaduna Textile Traders (Sample)",
    categories: ["Textiles"],
    website: "kadunatextiles.example.test",
    location: { locality: "Kaduna", region: "Kaduna" },
  },
];

function ctx(
  overrides: Partial<ProvenanceContext> & Pick<ProvenanceContext, "idSeed">,
  ownerUserId: string,
): ProvenanceContext {
  return {
    source: "user_edit",
    collectionMethod: "user_edit",
    sourceRef: null,
    collectedAt: SEED_EPOCH,
    confidence: SOURCE_CONFIDENCE.user_edit,
    actor: { type: "user", userId: ownerUserId },
    importId: null,
    note: null,
    metadata: { sample: true },
    ...overrides,
  };
}

function items(
  samples: Sample[],
  key: string,
  ownerUserId: string,
  collectedAt: Date,
): IngestItem[] {
  return samples.map((sample, i) => {
    const { input, errors } = normalizeCreateRequest(
      { categories: [], phones: [], emails: [], ...sample },
      "NG",
    );
    if (!input) throw new Error(`Invalid sample ${sample.name}: ${JSON.stringify(errors)}`);
    return {
      input,
      newId: deterministicObjectId(`seed:${key}:${i}`, collectedAt),
      createdVia: { kind: "seed", importId: null, userId: ownerUserId },
      ctx: ctx({ collectedAt, idSeed: `seed:${key}:${i}` }, ownerUserId),
    };
  });
}

export async function seedSampleBusinesses(
  organizationId: string,
  ownerUserId: string,
): Promise<string[]> {
  process.env.LOG_LEVEL = "warn";
  const app = await NestFactory.createApplicationContext(SeedModule.forRoot(), {
    logger: ["error", "warn"],
  });
  const report: string[] = [];
  try {
    const businesses = app.get(BusinessesService, { strict: false });
    const imports = app.get(ImportsService, { strict: false });
    const db = app.get(MongoService).database;

    // 1. Two CSV imports through upload, commit and the same processing the worker runs.
    for (const [fileName, lines, mapping] of [
      ["sample-lagos-businesses.csv", LAGOS_CSV, LAGOS_MAPPING],
      ["sample-national-businesses.csv", NATIONAL_CSV, NATIONAL_MAPPING],
    ] as const) {
      const existing = await db
        .collection(Collections.importJobs)
        .findOne({ organizationId, fileName });
      if (existing) {
        report.push(`import ${fileName}: already present (${String(existing.status)})`);
        continue;
      }
      const buffer = Buffer.from(lines.join("\r\n") + "\r\n", "utf8");
      const job = await imports.upload(
        organizationId,
        ownerUserId,
        { originalName: fileName, mimeType: "text/csv", size: buffer.length, buffer },
        {},
      );
      await imports.commit(
        organizationId,
        ownerUserId,
        job.id,
        { mapping: [...mapping], defaultCountry: "NG", attestLawfulBasis: true },
        {},
      );
      // Processed here so the seed is complete without a running worker; a worker that picks
      // up the queued job later finds it finished and does nothing.
      const result = await imports.process(organizationId, job.id);
      await (
        await app
          .get(QueueService, { strict: false })
          .queue(QueueNames.imports)
          .getJob(`import-${job.id}`)
      )?.remove();
      const done = await imports.get(organizationId, job.id);
      report.push(`import ${fileName}: ${result.status} (${JSON.stringify(done.progress)})`);
    }

    // 2. Hand-entered and long-ago observed businesses.
    const manual = await businesses.ingestBatch(
      organizationId,
      items(MANUAL, "manual", ownerUserId, SEED_EPOCH),
    );
    const stale = await businesses.ingestBatch(
      organizationId,
      items(STALE, "stale", ownerUserId, new Date(SEED_EPOCH.getTime() - 260 * DAY)),
    );
    report.push(`manual: ${manual.map((r) => r.outcome).join(",")}`);
    report.push(`stale: ${stale.map((r) => r.outcome).join(",")}`);

    // 3. Sample observations from businesses' own websites, then verification results.
    await addWebsiteEvidence(businesses, db, organizationId, ownerUserId, report);

    // 4. One suppressed sample.
    const festac = await db
      .collection(Collections.businesses)
      .findOne({ organizationId, "name.value": "Festac Auto Repairs (Sample)" });
    if (festac && !festac.flags?.suppressed) {
      await businesses.suppress(
        organizationId,
        ownerUserId,
        String(festac._id),
        { scope: "business", reason: "Sample: the owner asked not to be contacted" },
        {},
      );
      report.push("suppressed: Festac Auto Repairs (Sample)");
    }

    const total = await db.collection(Collections.businesses).countDocuments({ organizationId });
    report.push(`businesses in org: ${total}`);
    return report;
  } finally {
    await app.close();
  }
}

async function addWebsiteEvidence(
  businesses: BusinessesService,
  db: MongoService["database"],
  organizationId: string,
  ownerUserId: string,
  report: string[],
): Promise<void> {
  const observedAt = new Date(SEED_EPOCH.getTime() + 2 * DAY);
  const evidence: Array<{ sample: Sample; page: string }> = [
    {
      sample: {
        name: "Mama Put Kitchen (Sample)",
        phones: ["+44 20 7946 0101"],
        emails: ["hello@mamaput.example.test"],
        website: "mamaput.example.test",
      },
      page: "https://mamaput.example.test/contact",
    },
    {
      sample: {
        name: "Garki Medical Centre (Sample)",
        emails: ["info@garkimed.example.test"],
        website: "garkimed.example.test",
      },
      page: "https://garkimed.example.test/contact",
    },
    {
      sample: {
        name: "Victoria Island Law Chambers (Sample)",
        emails: ["chambers@vilaw.example.test"],
        website: "vilaw.example.test",
      },
      page: "https://vilaw.example.test/about",
    },
  ];
  const results = await businesses.ingestBatch(
    organizationId,
    evidence.map(({ sample, page }, i) => {
      const { input } = normalizeCreateRequest(
        { categories: [], phones: [], emails: [], ...sample },
        "NG",
      );
      return {
        input: input!,
        newId: deterministicObjectId(`seed:web:${i}`, observedAt),
        createdVia: { kind: "seed", importId: null, userId: ownerUserId },
        ctx: ctx(
          {
            source: "website",
            collectionMethod: "website_fetch",
            sourceRef: page,
            collectedAt: observedAt,
            confidence: SOURCE_CONFIDENCE.website,
            actor: { type: "system", userId: null },
            idSeed: `seed:web:${i}`,
          },
          ownerUserId,
        ),
      };
    }),
  );
  report.push(`website evidence: ${results.map((r) => r.outcome).join(",")}`);

  const col = db.collection(Collections.businesses);
  const verifiedAt = new Date(observedAt.getTime() + 60 * 60 * 1000);
  const verify = async (
    name: string,
    field: "phone" | "email",
    key: string,
    method: string,
    result: "passed" | "failed",
    details: string,
  ) => {
    const doc = await col.findOne({ organizationId, "name.value": name });
    if (!doc) return;
    const arrayPath = field === "phone" ? "phones" : "emails";
    const keyPath = field === "phone" ? "e164" : "address";
    if (result === "passed") {
      await col.updateOne(
        { _id: doc._id, organizationId, [`${arrayPath}.${keyPath}`]: key },
        {
          $set: {
            [`${arrayPath}.$.state`]: "verified",
            [`${arrayPath}.$.lastVerifiedAt`]: verifiedAt,
            ...(field === "email"
              ? {
                  [`${arrayPath}.$.verification`]: {
                    method,
                    result: "passed",
                    checkedAt: verifiedAt,
                  },
                }
              : {}),
            lastVerifiedAt: verifiedAt,
          },
          $inc: { version: 1 },
        },
      );
    }
    const eventId = deterministicObjectId(`seed:verify:${name}:${field}:${key}`, verifiedAt);
    await db.collection(Collections.verificationEvents).updateOne(
      { _id: eventId, organizationId },
      {
        $setOnInsert: {
          organizationId,
          businessId: doc._id,
          field,
          fieldKey: key,
          method,
          result,
          details,
          actorType: "system",
          actorId: null,
          occurredAt: verifiedAt,
        },
      },
      { upsert: true },
    );
  };
  await verify(
    "Mama Put Kitchen (Sample)",
    "phone",
    "+442079460101",
    "observed_on_own_site",
    "passed",
    "Sample: number listed on the business's contact page",
  );
  await verify(
    "Garki Medical Centre (Sample)",
    "email",
    "info@garkimed.example.test",
    "mx_smtp_check",
    "passed",
    "Sample: MX found and recipient accepted",
  );
  await verify(
    "Victoria Island Law Chambers (Sample)",
    "email",
    "chambers@vilaw.example.test",
    "mx_smtp_check",
    "passed",
    "Sample: MX found and recipient accepted",
  );
  await verify(
    "Apapa Freight Services (Sample)",
    "email",
    "ops@apapafreight.example.test",
    "mx_smtp_check",
    "failed",
    "Sample: domain has no MX record",
  );

  // WhatsApp confirmed only with explicit evidence: a wa.me link observed on the business's own site.
  const mama = await col.findOne({ organizationId, "name.value": "Mama Put Kitchen (Sample)" });
  if (mama) {
    const obsId = deterministicObjectId("seed:whatsapp:mamaput", observedAt);
    await db.collection(Collections.sourceObservations).updateOne(
      { _id: obsId, organizationId },
      {
        $setOnInsert: {
          organizationId,
          businessId: mama._id,
          source: "website",
          sourceRef: "https://mamaput.example.test/contact",
          sourceExternalId: null,
          field: "whatsapp",
          fieldKey: "+442079460101",
          rawValue: "https://wa.me/442079460101",
          normalizedValue: "confirmed",
          collectedAt: observedAt,
          collectionMethod: "website_fetch",
          verification: {
            method: "explicit_link",
            status: "verified",
            checkedAt: observedAt,
            details: "Sample: wa.me link on the contact page",
          },
          confidence: 0.9,
          actor: { type: "system", userId: null },
          note: null,
          action: "set",
          policy: null,
          redactedAt: null,
          metadata: { sample: true },
        },
      },
      { upsert: true },
    );
    await col.updateOne(
      { _id: mama._id, organizationId, "phones.e164": "+442079460101" },
      {
        $set: {
          "phones.$.whatsapp": {
            status: "confirmed",
            evidenceObservationId: obsId,
            assertedByUserId: null,
            assertedAt: null,
          },
          whatsappStatus: "confirmed",
        },
        $addToSet: { "phones.$.observationIds": obsId as ObjectId },
        $inc: { version: 1 },
      },
    );
  }
}
