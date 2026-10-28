import type {
  BusinessDetail,
  BusinessFacets,
  BusinessListItem,
  ImportJob,
  ImportPreviewResponse,
  ImportRowResult,
  Observation,
  OverviewMetrics,
  PagedEnvelope,
  SourceRegistryEntry,
  VerificationEvent,
} from "@leadforge/contracts";

/*
 * Synthetic Phase 2 API fixtures (businesses, imports, sources, overview). Shapes follow
 * packages/contracts exactly; every business is labelled "(Sample)" and every domain uses the
 * reserved .example.test TLD, so a screenshot can never be mistaken for real data.
 */

const ORG_USER = "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d";
const NOW = "2026-10-25T09:00:00.000Z";
const EARLIER = "2026-10-24T15:30:00.000Z";
const OLD = "2026-03-02T10:00:00.000Z";

export const BUSINESS_ID = "6add8b76520012303c641f9f";
export const CONFLICT_ID = "6add8b76520012303c641fa0";
export const UNKNOWN_BUSINESS_ID = "6add8b76520012303c64ffff";
export const UPLOADED_IMPORT_ID = "6add8b76520012303c6420a1";
export const PROCESSING_IMPORT_ID = "6add8b76520012303c6420a2";
export const COMPLETED_IMPORT_ID = "6add8b76520012303c6420a3";

const oid = (n: number) => `6add8b76520012303c64${n.toString(16).padStart(4, "0")}`;

function listItem(
  i: number,
  overrides: Partial<BusinessListItem> & Pick<BusinessListItem, "name">,
): BusinessListItem {
  return {
    id: oid(0x1f9f + i),
    slug: overrides.name.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
    categories: ["Restaurant"],
    location: { formatted: null, locality: "Ikeja", lga: "Ikeja", region: "Lagos", country: "NG" },
    website: null,
    phone: null,
    phoneCount: 0,
    email: null,
    emailCount: 0,
    whatsapp: "unknown",
    states: {
      name: "unverified",
      website: "missing",
      phone: "missing",
      email: "missing",
      location: "unverified",
    },
    score: null,
    sources: ["user_import"],
    sourceCount: 1,
    suppressed: false,
    lastVerifiedAt: null,
    createdAt: EARLIER,
    updatedAt: NOW,
    ...overrides,
  };
}

export const BUSINESSES: BusinessListItem[] = [
  listItem(0, {
    id: BUSINESS_ID,
    name: "Mama Put Kitchen (Sample)",
    categories: ["Restaurant", "Catering", "Buka"],
    website: {
      value: "https://mamaput.example.test",
      domain: "mamaput.example.test",
      state: "unverified",
    },
    phone: {
      value: "+2348031234567",
      international: "+234 803 123 4567",
      state: "verified",
      whatsapp: "confirmed",
    },
    phoneCount: 2,
    email: { value: "hello@mamaput.example.test", state: "unverified" },
    emailCount: 2,
    whatsapp: "confirmed",
    states: {
      name: "unverified",
      website: "unverified",
      phone: "verified",
      email: "unverified",
      location: "unverified",
    },
    sources: ["user_import", "website", "user_edit"],
    sourceCount: 3,
    lastVerifiedAt: "2026-10-03T10:00:00.000Z",
  }),
  listItem(1, {
    id: CONFLICT_ID,
    name: "Yaba Tech Hub Coworking and Innovation Centre (Sample)",
    categories: ["Coworking space"],
    location: {
      formatted: null,
      locality: "Yaba",
      lga: "Lagos Mainland",
      region: "Lagos",
      country: "NG",
    },
    website: {
      value: "https://yabahub.example.test",
      domain: "yabahub.example.test",
      state: "conflicting",
    },
    email: {
      value: "a-very-long-reservations-address@yabatechhub-coworking.example.test",
      state: "unverified",
    },
    emailCount: 1,
    states: {
      name: "unverified",
      website: "conflicting",
      phone: "missing",
      email: "unverified",
      location: "unverified",
    },
  }),
  listItem(2, {
    name: "Onitsha Spare Parts (Sample)",
    categories: ["Auto parts"],
    location: {
      formatted: null,
      locality: "Onitsha",
      lga: "Onitsha North",
      region: "Anambra",
      country: "NG",
    },
    phone: {
      value: "+2348129876543",
      international: "+234 812 987 6543",
      state: "stale",
      whatsapp: "user_asserted",
    },
    phoneCount: 1,
    whatsapp: "user_asserted",
    states: {
      name: "unverified",
      website: "missing",
      phone: "stale",
      email: "missing",
      location: "stale",
    },
    sources: ["user_edit"],
    updatedAt: OLD,
    createdAt: OLD,
  }),
  listItem(3, {
    name: "Name expired under source terms",
    categories: [],
    location: {
      formatted: null,
      locality: null,
      lga: null,
      region: "Federal Capital Territory",
      country: "NG",
    },
    phone: { value: null, international: null, state: "expired", whatsapp: "unknown" },
    phoneCount: 1,
    states: {
      name: "expired",
      website: "missing",
      phone: "expired",
      email: "missing",
      location: "unverified",
    },
    sources: ["google_places"],
  }),
  listItem(4, {
    name: "Garki Medical Centre (Sample)",
    categories: ["Hospital"],
    location: {
      formatted: null,
      locality: "Garki",
      lga: "AMAC",
      region: "Federal Capital Territory",
      country: "NG",
    },
    website: {
      value: "https://garkimed.example.test",
      domain: "garkimed.example.test",
      state: "unverified",
    },
    phone: {
      value: "+2348091112222",
      international: "+234 809 111 2222",
      state: "unverified",
      whatsapp: "unknown",
    },
    phoneCount: 1,
    email: { value: "info@garkimed.example.test", state: "verified" },
    emailCount: 1,
    states: {
      name: "unverified",
      website: "unverified",
      phone: "unverified",
      email: "verified",
      location: "unverified",
    },
    suppressed: true,
    lastVerifiedAt: "2026-10-03T10:00:00.000Z",
  }),
];

export const BUSINESS_PAGE: PagedEnvelope<BusinessListItem> = {
  data: BUSINESSES,
  meta: { nextCursor: "WyJuZXh0Il0", pageSize: 25, total: 48 },
};

export const EMPTY_PAGE: PagedEnvelope<BusinessListItem> = {
  data: [],
  meta: { nextCursor: null, pageSize: 25, total: 0 },
};

export const FACETS: BusinessFacets = {
  total: 47,
  categories: [
    { value: "restaurant", label: "Restaurant", count: 9 },
    { value: "pharmacy", label: "Pharmacy", count: 6 },
    { value: "coworking space", label: "Coworking space", count: 2 },
    { value: "hospital", label: "Hospital", count: 2 },
  ],
  regions: [
    { value: "lagos", label: "Lagos", count: 30 },
    { value: "federal capital territory", label: "Federal Capital Territory", count: 10 },
    { value: "anambra", label: "Anambra", count: 7 },
  ],
  localities: [
    { value: "ikeja", label: "Ikeja", count: 12 },
    { value: "yaba", label: "Yaba", count: 8 },
  ],
  sources: [
    { value: "user_import", label: "user_import", count: 40 },
    { value: "user_edit", label: "user_edit", count: 12 },
    { value: "website", label: "website", count: 3 },
  ],
  whatsapp: [
    { value: "unknown", label: "unknown", count: 44 },
    { value: "confirmed", label: "confirmed", count: 1 },
    { value: "user_asserted", label: "user_asserted", count: 2 },
  ],
  generatedAt: NOW,
  maxAgeSeconds: 60,
};

function observation(
  i: number,
  o: Partial<Observation> & Pick<Observation, "field" | "source">,
): Observation {
  return {
    id: oid(0x3000 + i),
    businessId: BUSINESS_ID,
    sourceRef: o.source === "user_import" ? `import:${COMPLETED_IMPORT_ID}` : null,
    fieldKey: null,
    rawValue: null,
    normalizedValue: null,
    collectedAt: EARLIER,
    collectionMethod:
      o.source === "user_import"
        ? "user_import"
        : o.source === "website"
          ? "website_fetch"
          : "user_edit",
    verification: null,
    confidence: o.source === "user_edit" ? 0.8 : 0.6,
    importId: o.source === "user_import" ? COMPLETED_IMPORT_ID : null,
    actor: {
      type: o.source === "website" ? "system" : "user",
      userId: o.source === "website" ? null : ORG_USER,
    },
    note: null,
    action: "set",
    redacted: false,
    sourceExternalId: null,
    discoveryJobId: null,
    retainValueUntil: null,
    attribution: null,
    enrichmentRunId: null,
    evidence: null,
    licensing: null,
    ...o,
  };
}

export const OBSERVATIONS: Observation[] = [
  observation(1, {
    field: "phone",
    source: "user_edit",
    fieldKey: "+2348098765432",
    rawValue: "0809 876 5432",
    normalizedValue: "+2348098765432",
    collectedAt: NOW,
    note: "Called and confirmed the new line",
  }),
  observation(2, {
    field: "name",
    source: "user_import",
    rawValue: "MAMA PUT KITCHEN (Sample)",
    normalizedValue: "Mama Put Kitchen (Sample)",
  }),
  observation(3, {
    field: "phone",
    source: "user_import",
    fieldKey: "+2348031234567",
    rawValue: "0803 123 4567",
    normalizedValue: "+2348031234567",
  }),
  observation(4, {
    field: "location",
    source: "user_import",
    rawValue: "14 Allen Avenue, Ikeja, LAGOS",
    normalizedValue: {
      street: "14 Allen Avenue",
      locality: "Ikeja",
      region: "Lagos",
      country: "NG",
    },
  }),
  observation(5, {
    field: "whatsapp",
    source: "website",
    fieldKey: "+2348031234567",
    rawValue: "https://wa.me/2348031234567",
    normalizedValue: "confirmed",
    collectedAt: "2026-10-03T10:00:00.000Z",
    evidence: {
      page: "https://mamaput.example.test/contact",
      selector: "a[href^='https://wa.me']",
      snippet: "Chat with us on WhatsApp",
    },
    verification: {
      method: "explicit_link",
      status: "verified",
      checkedAt: "2026-10-03T10:00:00.000Z",
      details: null,
    },
    confidence: 0.9,
  }),
  observation(6, {
    field: "email",
    source: "user_import",
    fieldKey: "hello@mamaput.example.test",
    rawValue: "Hello@MamaPut.example.test",
    normalizedValue: "hello@mamaput.example.test",
  }),
  observation(7, {
    field: "website",
    source: "website",
    fieldKey: "mamaput-kitchen.example.test",
    rawValue: "mamaput-kitchen.example.test",
    normalizedValue: "https://mamaput-kitchen.example.test",
    collectedAt: "2026-10-03T10:00:00.000Z",
  }),
  observation(8, {
    field: "website",
    source: "user_import",
    fieldKey: "mamaput.example.test",
    rawValue: "mamaput.example.test",
    normalizedValue: "https://mamaput.example.test",
  }),
];

export const VERIFICATION_EVENTS: VerificationEvent[] = [
  {
    id: oid(0x4001),
    businessId: BUSINESS_ID,
    field: "phone",
    fieldKey: "+2348031234567",
    method: "website_match",
    result: "passed",
    details: "Number appears on the business's own contact page.",
    actorType: "system",
    actorId: null,
    occurredAt: "2026-10-03T10:00:00.000Z",
  },
  {
    id: oid(0x4002),
    businessId: BUSINESS_ID,
    field: "email",
    fieldKey: "orders@mamaput.example.test",
    method: "email_mx",
    result: "inconclusive",
    details: "The domain's mail server did not answer in time.",
    actorType: "system",
    actorId: null,
    occurredAt: "2026-10-03T10:05:00.000Z",
  },
];

const meta = (ids: string[], at = EARLIER) => ({
  confidence: 0.6,
  observationIds: ids,
  lastObservedAt: at,
  lastVerifiedAt: null,
  expiresAt: null,
});

export const DETAIL: BusinessDetail = {
  id: BUSINESS_ID,
  slug: "mama-put-kitchen-sample-ikeja",
  name: {
    value: "Mama Put Kitchen (Sample)",
    rawValue: "MAMA PUT KITCHEN (Sample)",
    state: "unverified",
    ...meta([oid(0x3002)]),
  },
  categories: [
    { value: "Restaurant", key: "restaurant", taxonomy: "user", observationIds: [oid(0x3002)] },
    { value: "Catering", key: "catering", taxonomy: "user", observationIds: [oid(0x3002)] },
  ],
  location: {
    value: {
      formatted: "14 Allen Avenue, Ikeja, Lagos, Nigeria",
      street: "14 Allen Avenue",
      locality: "Ikeja",
      lga: "Ikeja",
      region: "Lagos",
      country: "NG",
      postalCode: null,
    },
    rawValue: "14 Allen Avenue, Ikeja, LAGOS",
    state: "unverified",
    alternatives: [],
    ...meta([oid(0x3004)]),
  },
  website: {
    value: "https://mamaput.example.test",
    rawValue: "mamaput.example.test",
    domain: "mamaput.example.test",
    state: "conflicting",
    alternatives: [
      {
        value: "https://mamaput-kitchen.example.test",
        rawValue: "mamaput-kitchen.example.test",
        observationIds: [oid(0x3007)],
        lastObservedAt: "2026-10-03T10:00:00.000Z",
      },
    ],
    ...meta([oid(0x3008)]),
  },
  phones: [
    {
      value: "+2348031234567",
      rawValue: "0803 123 4567",
      e164: "+2348031234567",
      national: "0803 123 4567",
      international: "+234 803 123 4567",
      country: "NG",
      type: "mobile",
      state: "verified",
      whatsapp: {
        status: "confirmed",
        evidenceObservationId: oid(0x3005),
        assertedByUserId: null,
        assertedAt: null,
      },
      ...meta([oid(0x3003), oid(0x3005)]),
      lastVerifiedAt: "2026-10-03T10:00:00.000Z",
    },
    {
      value: "+2348098765432",
      rawValue: "0809 876 5432",
      e164: "+2348098765432",
      national: "0809 876 5432",
      international: "+234 809 876 5432",
      country: "NG",
      type: "mobile",
      state: "unverified",
      whatsapp: {
        status: "user_asserted",
        evidenceObservationId: null,
        assertedByUserId: ORG_USER,
        assertedAt: NOW,
      },
      ...meta([oid(0x3001)], NOW),
      confidence: 0.8,
    },
    {
      value: null,
      rawValue: null,
      e164: null,
      national: null,
      international: null,
      country: "NG",
      type: "fixed_line",
      state: "expired",
      whatsapp: {
        status: "unknown",
        evidenceObservationId: null,
        assertedByUserId: null,
        assertedAt: null,
      },
      ...meta([]),
      expiresAt: "2026-09-01T00:00:00.000Z",
    },
  ],
  emails: [
    {
      value: "hello@mamaput.example.test",
      rawValue: "Hello@MamaPut.example.test",
      address: "hello@mamaput.example.test",
      domain: "mamaput.example.test",
      kind: "business",
      verification: null,
      state: "unverified",
      ...meta([oid(0x3006)]),
    },
    {
      value: "orders-and-catering-enquiries@mamaput-kitchen.example.test",
      rawValue: "orders-and-catering-enquiries@mamaput-kitchen.example.test",
      address: "orders-and-catering-enquiries@mamaput-kitchen.example.test",
      domain: "mamaput-kitchen.example.test",
      kind: "business",
      verification: {
        method: "syntax_mx_disposable",
        result: "dns_error",
        checkedAt: "2026-10-03T10:05:00.000Z",
      },
      state: "stale",
      ...meta([], OLD),
    },
  ],
  socials: [
    {
      platform: "instagram",
      url: "https://instagram.com/mamaputkitchen.sample",
      handle: "mamaputkitchen.sample",
      state: "unverified",
      ...meta([]),
    },
  ],
  whatsapp: "confirmed",
  states: {
    name: "unverified",
    website: "conflicting",
    phone: "verified",
    email: "unverified",
    location: "unverified",
  },
  sources: [
    { source: "user_import", observationCount: 6, firstSeenAt: EARLIER, lastSeenAt: EARLIER },
    {
      source: "website",
      observationCount: 2,
      firstSeenAt: "2026-10-03T10:00:00.000Z",
      lastSeenAt: "2026-10-03T10:00:00.000Z",
    },
    { source: "user_edit", observationCount: 1, firstSeenAt: NOW, lastSeenAt: NOW },
  ],
  provenance: { totalObservations: OBSERVATIONS.length, recent: OBSERVATIONS },
  recentVerificationEvents: VERIFICATION_EVENTS,
  suppression: {
    suppressed: false,
    reason: null,
    suppressedAt: null,
    suppressedByUserId: null,
    entries: [],
  },
  score: null,
  latestAnalysis: null,
  dedup: { status: "unique", candidateCount: 0, absorbedIds: [] },
  createdVia: {
    kind: "import",
    importId: COMPLETED_IMPORT_ID,
    userId: ORG_USER,
    discoveryJobId: null,
  },
  externalRefs: [],
  attributions: [],
  freshnessDays: 180,
  lastVerifiedAt: "2026-10-03T10:00:00.000Z",
  createdAt: EARLIER,
  updatedAt: NOW,
};

/** A suppressed business, for the suppressed banner and unsuppress path. */
export const SUPPRESSED_DETAIL: BusinessDetail = {
  ...DETAIL,
  id: CONFLICT_ID,
  name: { ...DETAIL.name, value: "Yaba Tech Hub Coworking and Innovation Centre (Sample)" },
  suppression: {
    suppressed: true,
    reason: "Asked not to be contacted",
    suppressedAt: NOW,
    suppressedByUserId: ORG_USER,
    entries: [
      {
        id: oid(0x5001),
        kind: "business",
        value: CONFLICT_ID,
        reason: "Asked not to be contacted",
        createdByUserId: ORG_USER,
        createdAt: NOW,
      },
    ],
  },
};

const HEADERS = [
  "Business Name",
  "Phone",
  "E-mail",
  "Website",
  "City",
  "State",
  "Category",
  "Notes",
];

function importJob(id: string, overrides: Partial<ImportJob>): ImportJob {
  return {
    id,
    status: "uploaded",
    fileName: "lagos-restaurants-and-pharmacies-october.csv",
    sizeBytes: 18_234,
    encoding: "utf-8",
    delimiter: ",",
    headers: HEADERS,
    rowCount: 120,
    blankRowsSkipped: 2,
    sampleRows: [
      [
        "Acme Foods (Sample)",
        "0803 123 4567",
        "info@acme.example.test",
        "acme.example.test",
        "Ikeja",
        "Lagos",
        "Restaurant",
        "Met at expo",
      ],
      ["Bola Pharmacy (Sample)", "0812 555 0101", "", "", "Yaba", "Lagos State", "Pharmacy", ""],
      [
        '=HYPERLINK("x") (Sample)',
        "12345",
        "ops@delta",
        "facebook.com/delta",
        "Warri",
        "Delta",
        "Logistics",
        "",
      ],
    ],
    suggestedMapping: [
      { column: 0, field: "name" },
      { column: 1, field: "phone" },
      { column: 2, field: "email" },
      { column: 3, field: "website" },
      { column: 4, field: "locality" },
      { column: 5, field: "region" },
      { column: 6, field: "category" },
    ],
    mapping: null,
    defaultCountry: "NG",
    progress: {
      total: 0,
      processed: 0,
      created: 0,
      updated: 0,
      suppressed: 0,
      failed: 0,
      percent: 0,
    },
    error: null,
    createdByUserId: ORG_USER,
    createdAt: EARLIER,
    updatedAt: EARLIER,
    queuedAt: null,
    startedAt: null,
    finishedAt: null,
    rowsExpireAt: "2026-11-24T15:30:00.000Z",
    ...overrides,
  };
}

export const UPLOADED_IMPORT = importJob(UPLOADED_IMPORT_ID, {});
export const PROCESSING_IMPORT = importJob(PROCESSING_IMPORT_ID, {
  status: "processing",
  mapping: UPLOADED_IMPORT.suggestedMapping,
  progress: {
    total: 120,
    processed: 80,
    created: 70,
    updated: 6,
    suppressed: 1,
    failed: 3,
    percent: 66,
  },
  queuedAt: NOW,
  startedAt: NOW,
});
export const COMPLETED_IMPORT = importJob(COMPLETED_IMPORT_ID, {
  status: "completed_with_errors",
  mapping: UPLOADED_IMPORT.suggestedMapping,
  progress: {
    total: 120,
    processed: 120,
    created: 104,
    updated: 9,
    suppressed: 2,
    failed: 5,
    percent: 100,
  },
  queuedAt: EARLIER,
  startedAt: EARLIER,
  finishedAt: EARLIER,
});

export const IMPORTS_PAGE: PagedEnvelope<ImportJob> = {
  data: [PROCESSING_IMPORT, COMPLETED_IMPORT, UPLOADED_IMPORT],
  meta: { nextCursor: null, pageSize: 10 },
};

export const PREVIEW: ImportPreviewResponse = {
  rows: [
    {
      rowNumber: 2,
      valid: true,
      expectedOutcome: "create",
      matchedBusinessId: null,
      values: {
        name: "Acme Foods (Sample)",
        categories: ["Restaurant"],
        website: "https://acme.example.test",
        domain: "acme.example.test",
        phones: [
          {
            e164: "+2348031234567",
            international: "+234 803 123 4567",
            country: "NG",
            type: "mobile",
            whatsapp: "unknown",
          },
        ],
        emails: ["info@acme.example.test"],
        socials: [],
        location: {
          street: null,
          locality: "Ikeja",
          lga: null,
          region: "Lagos",
          country: "NG",
          postalCode: null,
        },
      },
      errors: [],
      warnings: [],
    },
    {
      rowNumber: 3,
      valid: true,
      expectedOutcome: "update",
      matchedBusinessId: BUSINESS_ID,
      values: {
        name: "Bola Pharmacy (Sample)",
        categories: ["Pharmacy"],
        website: null,
        domain: null,
        phones: [
          {
            e164: "+2348125550101",
            international: "+234 812 555 0101",
            country: "NG",
            type: "mobile",
            whatsapp: "unknown",
          },
        ],
        emails: [],
        socials: [],
        location: {
          street: null,
          locality: "Yaba",
          lga: null,
          region: "Lagos",
          country: "NG",
          postalCode: null,
        },
      },
      errors: [],
      warnings: [
        {
          column: 1,
          header: "Phone",
          field: "phone",
          code: "POSSIBLE_DUPLICATE",
          message:
            "Shares a phone with “Bola Chemists (Sample)”; kept separate because the names differ.",
        },
      ],
    },
    {
      rowNumber: 4,
      valid: false,
      expectedOutcome: "invalid",
      matchedBusinessId: null,
      values: {
        name: null,
        categories: ["Logistics"],
        website: null,
        domain: null,
        phones: [],
        emails: [],
        socials: [{ platform: "facebook", url: "https://facebook.com/delta" }],
        location: {
          street: null,
          locality: "Warri",
          lga: null,
          region: "Delta",
          country: "NG",
          postalCode: null,
        },
      },
      errors: [
        {
          column: 0,
          header: "Business Name",
          field: "name",
          code: "FORMULA_INJECTION",
          message:
            "Starts with a spreadsheet formula character (=, +, -, @, tab or carriage return)",
        },
        {
          column: 1,
          header: "Phone",
          field: "phone",
          code: "INVALID_PHONE",
          message: '"12345": Not a valid phone number for NG or with a country code',
        },
        {
          column: 2,
          header: "E-mail",
          field: "email",
          code: "INVALID_EMAIL",
          message: '"ops@delta": Invalid domain',
        },
      ],
      warnings: [
        {
          column: 3,
          header: "Website",
          field: "website",
          code: "SOCIAL_PROFILE",
          message: "Saved as a Facebook profile, not a website.",
        },
      ],
    },
  ],
  summary: { totalRows: 120, checked: 100, valid: 97, invalid: 3 },
};

export const FAILED_ROWS: PagedEnvelope<ImportRowResult> = {
  data: [
    {
      rowNumber: 4,
      outcome: "failed",
      businessId: null,
      cells: [
        '=HYPERLINK("x") (Sample)',
        "12345",
        "ops@delta",
        "facebook.com/delta",
        "Warri",
        "Delta",
        "Logistics",
        "",
      ],
      errors: PREVIEW.rows[2]?.errors ?? [],
      warnings: [],
      processedAt: EARLIER,
    },
    {
      rowNumber: 57,
      outcome: "failed",
      businessId: null,
      cells: [
        "Delta Logistics (Sample)",
        "0803",
        "ops@delta.example.test",
        "",
        "Warri",
        "Delta",
        "Logistics",
        "",
      ],
      errors: [
        {
          column: 1,
          header: "Phone",
          field: "phone",
          code: "INVALID_PHONE",
          message: '"0803": Not a valid phone number for NG or with a country code',
        },
      ],
      warnings: [],
      processedAt: EARLIER,
    },
  ],
  meta: { nextCursor: null, pageSize: 25 },
};

/**
 * Registry entry factory. Defaults cover every field, so an additive contract change (a new
 * required field) needs one edit here rather than one per fixture.
 */
export function registryEntry(
  o: Partial<Omit<SourceRegistryEntry, "policy">> &
    Pick<SourceRegistryEntry, "key" | "name"> & { policy?: Partial<SourceRegistryEntry["policy"]> },
): SourceRegistryEntry {
  const { policy, ...rest } = o;
  return {
    kind: "user_supplied",
    method: "user_import",
    status: "active",
    statusReason: null,
    statusDetail: "",
    enabled: true,
    configurable: false,
    fieldsProvided: [],
    coverage: "",
    docsUrl: null,
    config: null,
    ...rest,
    policy: {
      storage: "",
      retentionDays: null,
      fieldRetention: [],
      attribution: null,
      rateLimit: null,
      lawfulBasis: "",
      termsCheckedAt: null,
      terms: [],
      licensing: null,
      ...policy,
    },
  };
}

export const SOURCES: SourceRegistryEntry[] = [
  registryEntry({
    key: "user_import",
    name: "CSV import",
    kind: "user_supplied",
    method: "user_import",
    status: "active",
    statusDetail:
      "Upload a CSV from Businesses. Rows are normalized, validated and recorded with provenance.",
    enabled: true,
    configurable: false,
    fieldsProvided: ["name", "category", "website", "phone", "email", "whatsapp", "location"],
    coverage: "Whatever your file contains. LeadForge does not add to it.",
    policy: {
      storage: "Kept indefinitely as observations linked to the import that supplied them.",
      retentionDays: null,
      fieldRetention: [
        {
          field: "all values",
          retention: "indefinite",
          days: null,
          note: "No source retention limit.",
        },
      ],
      attribution: 'Shown as "Imported" with the import and the importing user.',
      rateLimit: "30 uploads per hour per user.",
      lawfulBasis: "The importing user attests a lawful basis for the data on every import.",
    },
  }),
  registryEntry({
    key: "google_places",
    name: "Google Places API (New)",
    kind: "discovery",
    method: "api",
    status: "not_available",
    statusReason: "provider_terms",
    statusDetail:
      "Not available: Google's terms do not allow storing place details or using them in a directory.",
    enabled: true,
    configurable: false,
    fieldsProvided: ["name", "category", "location", "phone", "website", "hours"],
    coverage:
      "Official Google Maps Platform data. Coverage of small Nigerian businesses varies by area.",
    policy: {
      storage: "Only the place ID is stored long term; other place details expire when collected.",
      retentionDays: 0,
      fieldRetention: [
        {
          field: "place_id",
          retention: "indefinite",
          days: null,
          note: "Place IDs may be cached indefinitely.",
        },
        {
          field: "name, address, phone, website, category, opening hours",
          retention: "none",
          days: null,
          note: "No caching permission; expires on collection.",
        },
      ],
      attribution: "Results from Google Places must show the Google Maps attribution.",
      rateLimit: "At most 5 requests per second across all organizations.",
      lawfulBasis: "Licensed API access under the Google Maps Platform Terms.",
      termsCheckedAt: "2026-10-25",
      terms: [
        {
          title: "Google Maps Platform Terms of Service",
          url: "https://cloud.google.com/maps-platform/terms",
          lastModified: "2026-08-26",
        },
      ],
    },
    docsUrl: "https://developers.google.com/maps/documentation/places/web-service/op-overview",
  }),
];

export const OVERVIEW: OverviewMetrics = {
  period: "30d",
  periodStart: "2026-09-25T09:00:00.000Z",
  generatedAt: NOW,
  freshnessDays: 180,
  businesses: { total: 48, suppressed: 1, addedInPeriod: 41 },
  contacts: {
    withPhone: 39,
    withEmail: 26,
    withWebsite: 18,
    verifiedPhone: 4,
    verifiedEmail: 2,
    verifiedWebsite: 0,
    whatsappConfirmed: 1,
    whatsappUserAsserted: 2,
  },
  sources: [
    { source: "user_import", businesses: 40 },
    { source: "user_edit", businesses: 12 },
    { source: "website", businesses: 3 },
  ],
  imports: {
    total: 3,
    inProgress: 1,
    recent: [PROCESSING_IMPORT, COMPLETED_IMPORT].map((j) => ({
      id: j.id,
      status: j.status,
      fileName: j.fileName,
      rowCount: j.rowCount,
      progress: j.progress,
      createdAt: j.createdAt,
      finishedAt: j.finishedAt,
    })),
  },
  discovery: { total: 0, inProgress: 0, completedInPeriod: 0, failedInPeriod: 0, recent: [] },
  credits: { balance: 1000, held: 0 },
};
