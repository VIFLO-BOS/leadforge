import type {
  CreditBalance,
  CreditLedgerEntry,
  DiscoveryCategoryOption,
  DiscoveryEstimate,
  DiscoveryJob,
  DiscoveryJobItem,
  DiscoveryLocationOptions,
  DiscoverySourceOption,
  JobSummary,
  Notification,
  NotificationPreferences,
  OverviewMetrics,
  PagedEnvelope,
  SourceLicensing,
  SourceRegistryEntry,
} from "@leadforge/contracts";
import {
  BUSINESS_ID,
  COMPLETED_IMPORT,
  OVERVIEW,
  PROCESSING_IMPORT,
  registryEntry,
} from "./fixtures-businesses";

/*
 * Synthetic Phase 3 API fixtures: discovery sources, estimates, jobs, items, credits, all jobs and
 * notifications. Every object is built by a factory with defaults for every field, so an additive
 * contract change needs one edit per factory. Shapes follow packages/contracts; business names end
 * in "(Sample)" and numbers are invented for the mocked UI only.
 */

const ORG_USER = "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d";
const NOW = "2026-10-25T09:00:00.000Z";
const MINUTE_AGO = "2026-10-25T08:59:00.000Z";
const EARLIER = "2026-10-24T15:30:00.000Z";
const YESTERDAY = "2026-10-24T10:00:00.000Z";

export const RUNNING_JOB_ID = "6add8b76520012303c64d001";
export const COMPLETED_JOB_ID = "6add8b76520012303c64d002";
export const FAILED_JOB_ID = "6add8b76520012303c64d003";
export const WARNINGS_JOB_ID = "6add8b76520012303c64d004";
export const QUEUED_JOB_ID = "6add8b76520012303c64d005";
export const UNKNOWN_JOB_ID = "6add8b76520012303c64dfff";

const oid = (n: number) => `6add8b76520012303c64${n.toString(16).padStart(4, "0")}`;
const uuid = (n: number) => `0b6c3a1e-7d2f-4c8a-9e1b-${n.toString(16).padStart(12, "0")}`;

// ---------------------------------------------------------------------------
// Sources
// ---------------------------------------------------------------------------

export const OVERTURE_LICENSING: SourceLicensing = {
  label: "Overture Maps Foundation",
  text: "Source: Overture Maps Foundation (overturemaps.org)",
  url: "https://overturemaps.org",
  licenses: [
    {
      id: "CDLA-Permissive-2.0",
      name: "Community Data License Agreement – Permissive, Version 2.0",
      textPath: "/api/v1/public/data-licenses/CDLA-Permissive-2.0",
      referenceUrl: "https://cdla.dev/permissive-2-0/",
    },
  ],
  upstream: [],
  requirements: ["Show the attribution wherever the data is displayed or exported."],
  licensesPath: "/api/v1/public/data-licenses",
};

export function discoverySource(
  o: Partial<DiscoverySourceOption> & Pick<DiscoverySourceOption, "key" | "name">,
): DiscoverySourceOption {
  return {
    status: "configured",
    statusReason: null,
    statusDetail: "",
    enabled: true,
    runnable: true,
    maxResultsPerQuery: 0,
    providesFields: [],
    attribution: null,
    retentionSummary: "",
    licensing: null,
    specSupport: {
      location: ["region", "locality", "query"],
      confidence: false,
      requireContact: false,
      priorityFields: true,
      catalog: false,
    },
    snapshot: null,
    ...o,
  };
}

/** The runnable open-data source and Google, which the API reports as never runnable. */
export const DISCOVERY_SOURCES: DiscoverySourceOption[] = [
  discoverySource({
    key: "overture_places",
    name: "Overture Maps Places",
    status: "configured",
    statusDetail: "Snapshot loaded (sample fixture for the mocked UI).",
    runnable: true,
    maxResultsPerQuery: 0,
    providesFields: ["name", "category", "location", "phone", "website", "email"],
    attribution: "Overture Maps Foundation",
    retentionSummary:
      "Open data: kept with its source release and licence; refreshed with each snapshot.",
    licensing: OVERTURE_LICENSING,
    specSupport: {
      location: ["region", "lga", "locality"],
      confidence: true,
      requireContact: true,
      priorityFields: false,
      catalog: true,
    },
    snapshot: { release: "2026-10-21.0", syncedAt: YESTERDAY, places: 48210, offerable: 30115 },
  }),
  discoverySource({
    key: "google_places",
    name: "Google Places API (New)",
    status: "not_available",
    statusReason: "provider_terms",
    statusDetail:
      "Not available: Google's terms do not allow storing place details or using them in a directory.",
    runnable: false,
    maxResultsPerQuery: 60,
    providesFields: ["name", "category", "location", "phone", "website"],
    attribution: "Google Maps",
    retentionSummary:
      "Only the Google place ID could be stored; other details expire when collected.",
  }),
];

export const OVERTURE_REGISTRY: SourceRegistryEntry = registryEntry({
  key: "overture_places",
  name: "Overture Maps Places",
  kind: "discovery",
  method: "dataset_snapshot",
  status: "configured",
  statusDetail: "Snapshot loaded (sample fixture for the mocked UI).",
  enabled: true,
  configurable: true,
  fieldsProvided: ["name", "category", "location", "phone", "website", "email"],
  coverage: "Open map data for Nigeria from the Overture Maps Foundation.",
  policy: {
    storage: "Kept with its source release and licence; refreshed with each snapshot.",
    retentionDays: null,
    attribution: "Overture Maps Foundation",
    lawfulBasis: "Open data under the licences listed.",
    termsCheckedAt: "2026-10-25",
    licensing: OVERTURE_LICENSING,
  },
});

export const CATEGORIES: DiscoveryCategoryOption[] = [
  {
    key: "pharmacy",
    label: "Pharmacy",
    synonyms: ["chemist"],
    sourceCategories: ["pharmacy"],
    kind: "curated",
    places: 2140,
  },
  {
    key: "restaurant",
    label: "Restaurant",
    synonyms: ["buka"],
    sourceCategories: ["restaurant"],
    kind: "curated",
    places: 5310,
  },
  {
    key: "bakery",
    label: "Bakery",
    synonyms: [],
    sourceCategories: ["bakery"],
    kind: "curated",
    places: 640,
  },
  {
    key: "hotel",
    label: "Hotel",
    synonyms: [],
    sourceCategories: ["hotel"],
    kind: "curated",
    places: 1720,
  },
];

export const LOCATIONS: DiscoveryLocationOptions = {
  source: "overture_places",
  release: "2026-10-21.0",
  country: "NG",
  states: [
    {
      key: "lagos",
      name: "Lagos",
      code: "NG-LA",
      places: 12040,
      lgas: [
        { key: "ikeja", name: "Ikeja", places: 1830 },
        { key: "eti-osa", name: "Eti Osa", places: 2410 },
      ],
    },
    {
      key: "federal-capital-territory",
      name: "Federal Capital Territory",
      code: "NG-FC",
      places: 5210,
      lgas: [{ key: "abuja-municipal", name: "Abuja Municipal", places: 3120 }],
    },
  ],
  boundariesAttribution: "Boundaries: Overture Maps Foundation divisions.",
};

// ---------------------------------------------------------------------------
// Estimates
// ---------------------------------------------------------------------------

export function estimate(o: Partial<DiscoveryEstimate> = {}): DiscoveryEstimate {
  return {
    estimateAvailable: true,
    credits: { perRecord: 1, hold: 100, balance: 977, sufficient: true },
    maxRecords: 100,
    sources: [
      {
        source: "overture_places",
        name: "Overture Maps Places",
        status: "configured",
        enabled: true,
        runnable: true,
        queries: 1,
        maxResults: 342,
        exact: true,
        alreadyInDirectory: 12,
        maxRequests: 0,
        providerSku: null,
        fields: ["names", "categories", "addresses", "phones", "websites", "emails"],
        warnings: [],
      },
    ],
    basis:
      "1 credit per business record produced (a new record, or an existing record that gains new observations).",
    warnings: [],
    blockers: [],
    ...o,
  };
}

export const ESTIMATE_OK = estimate();
export const ESTIMATE_INSUFFICIENT = estimate({
  credits: { perRecord: 1, hold: 100, balance: 42, sufficient: false },
  blockers: [
    {
      code: "INSUFFICIENT_CREDITS",
      source: null,
      message: "This job holds 100 credits; 42 are available.",
    },
  ],
});
export const ESTIMATE_BLOCKED = estimate({
  estimateAvailable: false,
  blockers: [
    {
      code: "SOURCE_DISABLED",
      source: "overture_places",
      message: "Overture Maps Places is switched off for this workspace.",
    },
  ],
});

// ---------------------------------------------------------------------------
// Jobs and items
// ---------------------------------------------------------------------------

export function discoveryJob(
  o: Partial<DiscoveryJob> & Pick<DiscoveryJob, "id" | "name">,
): DiscoveryJob {
  return {
    status: "completed",
    spec: {
      name: o.name,
      sources: ["overture_places"],
      location: { country: "NG", region: "Lagos", lga: "Ikeja" },
      categories: ["Pharmacy"],
      domainsInclude: [],
      domainsExclude: [],
      maxRecords: 100,
      priorityFields: ["phone", "website"],
      confidence: "standard",
      requireContact: true,
    },
    estimate: { maxRecords: 100, hold: 100, basis: "1 credit per business record produced." },
    credits: { held: 100, captured: 0, released: 0, settled: false, settledAt: null },
    progress: {
      processed: 0,
      created: 0,
      updated: 0,
      duplicates: 0,
      skipped: 0,
      failed: 0,
      billable: 0,
      pagesFetched: 0,
      limit: 100,
      lastEventAt: null,
    },
    sourceOutcomes: [],
    errors: [],
    warnings: [],
    cancelRequested: false,
    round: 0,
    retryableItems: 0,
    attributions: ["Overture Maps Foundation"],
    sourceReleases: [{ source: "overture_places", release: "2026-10-21.0" }],
    createdByUserId: ORG_USER,
    createdAt: EARLIER,
    updatedAt: NOW,
    queuedAt: EARLIER,
    startedAt: EARLIER,
    finishedAt: null,
    cancelledAt: null,
    timeoutAt: null,
    ...o,
  };
}

export const RUNNING_JOB = discoveryJob({
  id: RUNNING_JOB_ID,
  name: "Pharmacies in Ikeja, Lagos (Sample)",
  status: "running",
  progress: {
    processed: 40,
    created: 31,
    updated: 2,
    duplicates: 1,
    skipped: 6,
    failed: 0,
    billable: 33,
    pagesFetched: 2,
    limit: 100,
    lastEventAt: MINUTE_AGO,
  },
  sourceOutcomes: [
    {
      source: "overture_places",
      status: "running",
      pages: 2,
      records: 40,
      rateLimited: 0,
      errors: [],
    },
  ],
  createdAt: MINUTE_AGO,
  queuedAt: MINUTE_AGO,
  startedAt: MINUTE_AGO,
});

export const COMPLETED_JOB = discoveryJob({
  id: COMPLETED_JOB_ID,
  name: "Bakeries in Yaba, Lagos (Sample)",
  status: "completed",
  spec: {
    ...RUNNING_JOB.spec,
    name: "Bakeries in Yaba, Lagos (Sample)",
    categories: ["Bakery"],
    location: { country: "NG", region: "Lagos", locality: "Yaba" },
  },
  progress: {
    processed: 30,
    created: 26,
    updated: 1,
    duplicates: 0,
    skipped: 3,
    failed: 0,
    billable: 27,
    pagesFetched: 1,
    limit: 30,
    lastEventAt: EARLIER,
  },
  credits: { held: 30, captured: 27, released: 3, settled: true, settledAt: EARLIER },
  sourceOutcomes: [
    {
      source: "overture_places",
      status: "completed",
      pages: 1,
      records: 30,
      rateLimited: 0,
      errors: [],
    },
  ],
  finishedAt: EARLIER,
});

export const WARNINGS_JOB = discoveryJob({
  id: WARNINGS_JOB_ID,
  name: "Hotels and restaurants in Wuse, Federal Capital Territory, with a long name to wrap (Sample)",
  status: "completed_with_warnings",
  spec: {
    ...RUNNING_JOB.spec,
    name: "Hotels and restaurants in Wuse (Sample)",
    categories: ["Hotel", "Restaurant"],
    location: { country: "NG", region: "Federal Capital Territory", locality: "Wuse" },
    domainsExclude: ["chain-hotels.example.test"],
  },
  progress: {
    processed: 58,
    created: 44,
    updated: 3,
    duplicates: 2,
    skipped: 6,
    failed: 3,
    billable: 47,
    pagesFetched: 3,
    limit: 60,
    lastEventAt: YESTERDAY,
  },
  credits: { held: 60, captured: 47, released: 13, settled: true, settledAt: YESTERDAY },
  sourceOutcomes: [
    {
      source: "overture_places",
      status: "completed",
      pages: 3,
      records: 58,
      rateLimited: 1,
      errors: [
        {
          code: "SOURCE_UNAVAILABLE",
          message: "The snapshot store timed out once; retried.",
          count: 1,
        },
      ],
    },
  ],
  warnings: [
    {
      code: "INGEST_FAILED",
      message: "3 items could not be saved. Retry failed items to try them again.",
      at: YESTERDAY,
      source: "overture_places",
    },
  ],
  retryableItems: 3,
  createdAt: YESTERDAY,
  finishedAt: YESTERDAY,
});

export const FAILED_JOB = discoveryJob({
  id: FAILED_JOB_ID,
  name: "Supermarkets in Kano (Sample)",
  status: "failed",
  spec: {
    ...RUNNING_JOB.spec,
    name: "Supermarkets in Kano (Sample)",
    categories: ["Supermarket"],
    location: { country: "NG", region: "Kano" },
  },
  credits: { held: 100, captured: 0, released: 100, settled: true, settledAt: YESTERDAY },
  errors: [
    {
      code: "SOURCE_DISABLED",
      message: "Overture Maps Places was switched off for this workspace before the job started.",
      at: YESTERDAY,
      source: "overture_places",
    },
  ],
  createdAt: YESTERDAY,
  finishedAt: YESTERDAY,
});

export const QUEUED_JOB = discoveryJob({
  id: QUEUED_JOB_ID,
  name: "Restaurant in Ikeja, Lagos (Sample)",
  status: "queued",
  spec: {
    ...RUNNING_JOB.spec,
    name: "Restaurant in Ikeja, Lagos (Sample)",
    categories: ["Restaurant"],
  },
  startedAt: null,
  createdAt: NOW,
  queuedAt: NOW,
});

export const DISCOVERY_JOBS = [QUEUED_JOB, RUNNING_JOB, COMPLETED_JOB, WARNINGS_JOB, FAILED_JOB];

export function jobItem(i: number, o: Partial<DiscoveryJobItem> = {}): DiscoveryJobItem {
  return {
    id: oid(0xe000 + i),
    source: "overture_places",
    externalId: `08f2a1b4c3d5e6f7-${(1000 + i).toString(16)}-sample`,
    outcome: "created",
    billable: true,
    attempts: 1,
    round: 0,
    error: null,
    warnings: [],
    business: {
      id: oid(0xf000 + i),
      name: `Ikeja Pharmacy ${i + 1} (Sample)`,
      nameState: "unverified",
    },
    duplicateOfId: null,
    processedAt: MINUTE_AGO,
    ...o,
  };
}

export const ITEMS: DiscoveryJobItem[] = [
  jobItem(0, {
    business: { id: BUSINESS_ID, name: "Mama Put Kitchen (Sample)", nameState: "unverified" },
    outcome: "updated",
  }),
  jobItem(1),
  jobItem(2, {
    business: { id: oid(0xf002), name: null, nameState: "expired" },
  }),
  jobItem(3, {
    outcome: "duplicate",
    billable: false,
    duplicateOfId: oid(0xf001),
    business: { id: oid(0xf001), name: "Ikeja Pharmacy 2 (Sample)", nameState: "unverified" },
  }),
  jobItem(4, {
    outcome: "skipped",
    billable: false,
    business: null,
    error: {
      code: "PERMANENTLY_CLOSED",
      message: "The source marks this place as permanently closed.",
      retryable: false,
    },
  }),
  jobItem(5, {
    outcome: "created",
    warnings: [
      {
        code: "POSSIBLE_DUPLICATE",
        message:
          "Shares the website domain chain-pharmacy.example.test and the name with another record but is a different source record, so it was kept separate.",
      },
    ],
  }),
  jobItem(6, {
    outcome: "failed",
    billable: false,
    attempts: 3,
    business: null,
    error: {
      code: "INGEST_FAILED",
      message: "Could not save the record. Retry failed items to try again.",
      retryable: true,
    },
  }),
];

export function itemsPage(items: DiscoveryJobItem[]): PagedEnvelope<DiscoveryJobItem> {
  return { data: items, meta: { nextCursor: null, pageSize: 25 } };
}

// ---------------------------------------------------------------------------
// Credits, all jobs, notifications, overview
// ---------------------------------------------------------------------------

export const BALANCE: CreditBalance = {
  balance: 877,
  held: 100,
  openHolds: 1,
  updatedAt: MINUTE_AGO,
};

export function ledgerEntry(
  i: number,
  o: Partial<CreditLedgerEntry> & Pick<CreditLedgerEntry, "entryType">,
): CreditLedgerEntry {
  return {
    id: uuid(i),
    units: 0,
    capturedUnits: null,
    balanceAfter: 1000,
    referenceType: "discovery_job",
    referenceId: COMPLETED_JOB_ID,
    holdId: null,
    description: null,
    actorUserId: ORG_USER,
    createdAt: EARLIER,
    ...o,
  };
}

export const LEDGER: CreditLedgerEntry[] = [
  ledgerEntry(1, {
    entryType: "hold",
    units: -100,
    balanceAfter: 877,
    referenceId: RUNNING_JOB_ID,
    description: "Hold for discovery job",
    createdAt: MINUTE_AGO,
  }),
  ledgerEntry(2, {
    entryType: "release",
    units: 3,
    balanceAfter: 977,
    description: "Unused part of the hold released",
    referenceName: "Bakeries in Yaba, Lagos (Sample)",
  }),
  ledgerEntry(3, {
    entryType: "capture",
    units: 0,
    capturedUnits: 27,
    balanceAfter: 974,
    description: "27 records produced",
  }),
  ledgerEntry(4, {
    entryType: "hold",
    units: -30,
    balanceAfter: 974,
    description: "Hold for discovery job",
    createdAt: "2026-10-24T15:29:00.000Z",
  }),
  ledgerEntry(5, {
    entryType: "grant",
    units: 1004,
    balanceAfter: 1004,
    referenceType: null,
    referenceId: null,
    description:
      "Development grant from the seed script. Not a purchase; purchasing arrives in Phase 6.",
    actorUserId: null,
    createdAt: "2026-10-20T08:00:00.000Z",
  }),
];

export function jobSummary(
  o: Partial<JobSummary> & Pick<JobSummary, "id" | "kind" | "name">,
): JobSummary {
  return {
    status: "completed",
    kindStatus: "completed",
    progress: { processed: 0, total: null, failed: 0 },
    createdByUserId: ORG_USER,
    createdAt: EARLIER,
    startedAt: EARLIER,
    finishedAt: EARLIER,
    href: o.kind === "discovery" ? `/app/discovery/${o.id}` : `/app/businesses?importId=${o.id}`,
    ...o,
  };
}

export const ALL_JOBS: JobSummary[] = [
  jobSummary({
    id: RUNNING_JOB_ID,
    kind: "discovery",
    name: RUNNING_JOB.name,
    status: "running",
    kindStatus: "running",
    progress: { processed: 40, total: null, failed: 0 },
    finishedAt: null,
  }),
  jobSummary({
    id: PROCESSING_IMPORT.id,
    kind: "import",
    name: PROCESSING_IMPORT.fileName,
    status: "running",
    kindStatus: "processing",
    progress: { processed: 60, total: 120, failed: 2 },
    finishedAt: null,
  }),
  jobSummary({
    id: COMPLETED_JOB_ID,
    kind: "discovery",
    name: COMPLETED_JOB.name,
    progress: { processed: 30, total: null, failed: 0 },
  }),
  jobSummary({
    id: COMPLETED_IMPORT.id,
    kind: "import",
    name: COMPLETED_IMPORT.fileName,
    status: "completed_with_warnings",
    kindStatus: "completed_with_errors",
    progress: { processed: 120, total: 120, failed: 5 },
  }),
  jobSummary({
    id: oid(0xa001),
    kind: "analysis",
    name: "Website analysis: mamaput.example.test",
    href: `/app/analysis/${oid(0xa001)}`,
    progress: { processed: 1, total: 1, failed: 0 },
  }),
  jobSummary({
    id: FAILED_JOB_ID,
    kind: "discovery",
    name: FAILED_JOB.name,
    status: "failed",
    kindStatus: "failed",
  }),
];

export function notification(
  i: number,
  o: Partial<Notification> & Pick<Notification, "type" | "title">,
): Notification {
  return {
    id: oid(0xb000 + i),
    body: null,
    href: null,
    readAt: null,
    createdAt: EARLIER,
    ...o,
  };
}

export const NOTIFICATIONS: Notification[] = [
  notification(1, {
    type: "discovery.failed",
    title: `Discovery job "${FAILED_JOB.name}" failed`,
    body: "Overture Maps Places was switched off for this workspace.",
    href: `/app/discovery/${FAILED_JOB_ID}`,
    createdAt: MINUTE_AGO,
  }),
  notification(2, {
    type: "discovery.completed",
    title: `Discovery job "${COMPLETED_JOB.name}" completed`,
    body: "26 new, 1 updated.",
    href: `/app/discovery/${COMPLETED_JOB_ID}`,
  }),
  notification(3, {
    type: "import.completed_with_errors",
    title: `Import of ${COMPLETED_IMPORT.fileName} finished with row errors`,
    body: "112 new, 3 updated, 5 rows failed.",
    href: `/app/businesses/import?id=${COMPLETED_IMPORT.id}`,
    readAt: EARLIER,
    createdAt: YESTERDAY,
  }),
];

export const PREFERENCES: NotificationPreferences = {
  emailJobEvents: true,
  emailBilling: true,
  inappAll: true,
  emailAssignments: true,
};

export const OVERVIEW_P3: OverviewMetrics = {
  ...OVERVIEW,
  discovery: {
    total: 5,
    inProgress: 2,
    completedInPeriod: 2,
    failedInPeriod: 1,
    recent: DISCOVERY_JOBS.slice(0, 4).map((j) => ({
      id: j.id,
      name: j.name,
      status: j.status,
      progress: j.progress,
      createdAt: j.createdAt,
      finishedAt: j.finishedAt,
    })),
  },
  credits: { balance: BALANCE.balance, held: BALANCE.held },
};

export const DISCOVERY_ROUTES = [
  "/app/discovery",
  "/app/discovery?status=completed&status=failed",
  "/app/discovery/new",
  "/app/discovery/new?step=target",
  `/app/discovery/${RUNNING_JOB_ID}`,
  `/app/discovery/${WARNINGS_JOB_ID}?outcome=failed`,
  `/app/discovery/${FAILED_JOB_ID}`,
  `/app/discovery/${UNKNOWN_JOB_ID}`,
  "/app/jobs",
  "/app/jobs?kind=discovery",
  "/app/usage",
  "/app/settings?tab=notifications",
] as const;
