import {
  SCORE_EXPLANATION,
  type BusinessDetail,
  type BusinessListItem,
  type CandidateBusiness,
  type Detection,
  type DetectionKey,
  type DuplicateCandidate,
  type EnrichmentRun,
  type MergeRecord,
  type Opportunity,
  type PagedEnvelope,
  type ScoreSnapshot,
  type ScoringProfile,
  type WebsiteAnalysis,
} from "@leadforge/contracts";
import { BUSINESS_ID, BUSINESS_PAGE, CONFLICT_ID, DETAIL } from "./fixtures-businesses";

/*
 * Synthetic Phase 4 fixtures: website analyses, enrichment runs, scores, the scoring profile,
 * duplicate candidates and merges. Built by factories with a default for every field, so an
 * additive contract change needs one edit here. Every business is "(Sample)" and every site
 * uses the reserved .example.test TLD.
 */

const ORG_USER = "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d";
const OTHER_USER = "2b3c4d5e-6f7a-4b8c-9d0e-1f2a3b4c5d6e";
const NOW = "2026-10-25T09:00:00.000Z";
const MINUTE_AGO = "2026-10-25T08:59:00.000Z";
const EARLIER = "2026-10-24T15:30:00.000Z";
const LAST_MONTH = "2026-09-20T10:00:00.000Z";

const oid = (n: number) => `6add8b76520012303c64${n.toString(16).padStart(4, "0")}`;

/** Same id the Phase 3 all-jobs fixture links to. */
export const ANALYSIS_ID = oid(0xa001);
export const RUNNING_ANALYSIS_ID = oid(0xa002);
export const FAILED_ANALYSIS_ID = oid(0xa003);
export const UNKNOWN_ANALYSIS_ID = oid(0xafff);
export const BATCH_ID = oid(0xb0a1);
export const CANDIDATE_ID = oid(0xc001);
export const DEFERRED_CANDIDATE_ID = oid(0xc002);
export const MERGED_CANDIDATE_ID = oid(0xc003);
export const UNKNOWN_CANDIDATE_ID = oid(0xcfff);
export const MERGE_ID = oid(0xe001);
export const LOCKED_MERGE_ID = oid(0xe002);
export const UNDONE_MERGE_ID = oid(0xe003);
export const DUPLICATE_BUSINESS_ID = oid(0x1fb0);
export const ABSORBED_ID = oid(0x1fb1);
const SPARE_PARTS_ID = oid(0x1f9f + 2);
const GARKI_ID = oid(0x1f9f + 4);

/** An evidence snippet that looks like markup: it must render as text, never as HTML. */
export const MARKUP_SNIPPET =
  '<form action="/newsletter"><input type="email" name="email"><img src=x onerror="alert(1)"></form>';

export function detection(key: DetectionKey, o: Partial<Detection> = {}): Detection {
  return {
    key,
    label: `Check ${key}`,
    observed: "no",
    confidence: 0.8,
    evidence: [],
    observedValue: null,
    analyzedAt: EARLIER,
    ...o,
  };
}

const HOME = "https://mamaput.example.test/";
const CONTACT = "https://mamaput.example.test/contact";

export const DETECTIONS: Detection[] = [
  detection("website_unreachable", {
    label: "The website was reachable",
    observed: "no",
    confidence: 0.95,
    evidence: [{ type: "header", value: "HTTP 200 text/html; charset=utf-8", page: HOME }],
  }),
  detection("mobile_unfriendly", {
    label: "Indicators of a layout that is not mobile-friendly were detected",
    observed: "yes",
    confidence: 0.8,
    evidence: [
      { type: "selector", value: 'head: no <meta name="viewport">', page: HOME },
      { type: "text", value: 'table width="1024" on the home page', page: HOME },
    ],
  }),
  detection("no_contact_form", {
    label: "No contact form was detected",
    observed: "yes",
    confidence: 0.75,
    evidence: [
      { type: "url", value: CONTACT, page: CONTACT },
      { type: "text", value: "Checked 2 pages including the contact page", page: null },
      { type: "selector", value: MARKUP_SNIPPET, page: HOME },
    ],
  }),
  detection("no_booking_flow", {
    label: "No booking flow was detected",
    observed: "yes",
    confidence: 0.7,
    evidence: [
      {
        type: "text",
        value: "No booking links, widgets or booking phrases on 2 pages",
        page: null,
      },
    ],
  }),
  detection("no_online_ordering", {
    label: "An online ordering flow was detected",
    observed: "no",
    confidence: 0.85,
    evidence: [{ type: "selector", value: 'a[href*="chowdeck"] "Order on Chowdeck"', page: HOME }],
  }),
  detection("no_whatsapp_link", {
    label: "A WhatsApp link was detected",
    observed: "no",
    confidence: 0.95,
    evidence: [{ type: "selector", value: 'a[href="https://wa.me/2348031234567"]', page: CONTACT }],
  }),
  detection("no_https", {
    label: "Working HTTPS was detected",
    observed: "no",
    confidence: 0.9,
    evidence: [
      { type: "header", value: "Certificate valid until Jan  9 12:00:00 2027 GMT", page: HOME },
    ],
  }),
  detection("outdated_platform", {
    label: "Platform version could not be checked",
    observed: "unknown",
    confidence: 0.3,
    evidence: [{ type: "text", value: "No generator meta tag on the home page", page: HOME }],
  }),
  detection("missing_seo_metadata", {
    label: "No complete basic SEO metadata was detected",
    observed: "yes",
    confidence: 0.6,
    evidence: [
      { type: "selector", value: "title: Mama Put Kitchen (Sample)", page: HOME },
      { type: "text", value: "No meta description on the home page", page: HOME },
    ],
  }),
];

export const OPPORTUNITIES: Opportunity[] = [
  {
    key: "mobile_friendly_site",
    title: "Mobile-friendly site",
    rationale:
      "Indicators of a layout that is not mobile-friendly were detected: no viewport meta and a 1024px table.",
    confidence: 0.8,
    detectionKeys: ["mobile_unfriendly"],
  },
  {
    key: "contact_form",
    title: "Website contact form",
    rationale:
      "No contact form was detected on the pages checked. Checked 2 pages including the contact page.",
    confidence: 0.75,
    detectionKeys: ["no_contact_form"],
  },
  {
    key: "online_booking",
    title: "Online booking",
    rationale: "No booking flow was detected on the pages checked.",
    confidence: 0.7,
    detectionKeys: ["no_booking_flow"],
  },
  {
    key: "seo_basics",
    title: "SEO basics",
    rationale: "The home page has a title but no meta description.",
    confidence: 0.6,
    detectionKeys: ["missing_seo_metadata"],
  },
];

export function websiteAnalysis(
  o: Partial<WebsiteAnalysis> & Pick<WebsiteAnalysis, "id">,
): WebsiteAnalysis {
  return {
    businessId: BUSINESS_ID,
    business: { name: "Mama Put Kitchen (Sample)", nameState: "unverified" },
    url: "https://mamaput.example.test",
    finalUrl: HOME,
    status: "completed",
    trigger: "single",
    batchId: null,
    fetched: {
      status: 200,
      redirects: [{ url: "http://mamaput.example.test/", status: 301 }],
      bytes: 18234,
      contentType: "text/html; charset=utf-8",
      durationMs: 412,
      tls: {
        secure: true,
        valid: true,
        issuer: "Sample CA / R11 (Sample)",
        validTo: "Jan  9 12:00:00 2027 GMT",
        error: null,
      },
    },
    robots: { fetched: true, allowed: true },
    pagesVisited: [
      {
        url: "https://mamaput.example.test",
        finalUrl: HOME,
        kind: "home",
        status: 200,
        error: null,
      },
      { url: CONTACT, finalUrl: CONTACT, kind: "contact", status: 200, error: null },
    ],
    detections: [],
    opportunities: [],
    credits: { held: 1, captured: 1, released: 0, settled: true },
    error: null,
    requestedByUserId: ORG_USER,
    createdAt: EARLIER,
    startedAt: EARLIER,
    analyzedAt: EARLIER,
    finishedAt: EARLIER,
    ...o,
  };
}

export const COMPLETED_ANALYSIS = websiteAnalysis({
  id: ANALYSIS_ID,
  detections: DETECTIONS,
  opportunities: OPPORTUNITIES,
});

export const RUNNING_ANALYSIS = websiteAnalysis({
  id: RUNNING_ANALYSIS_ID,
  businessId: SPARE_PARTS_ID,
  business: { name: "Onitsha Spare Parts (Sample)", nameState: "unverified" },
  url: "https://onitsha-spares.example.test",
  finalUrl: null,
  status: "running",
  trigger: "bulk",
  batchId: BATCH_ID,
  fetched: null,
  robots: { fetched: false, allowed: null },
  pagesVisited: [],
  credits: { held: 1, captured: 0, released: 0, settled: false },
  createdAt: MINUTE_AGO,
  startedAt: MINUTE_AGO,
  analyzedAt: null,
  finishedAt: null,
});

export const FAILED_ANALYSIS = websiteAnalysis({
  id: FAILED_ANALYSIS_ID,
  businessId: GARKI_ID,
  business: { name: "Garki Medical Centre (Sample)", nameState: "unverified" },
  url: "https://garki-medical-centre-and-diagnostics.example.test",
  finalUrl: null,
  status: "failed",
  trigger: "bulk",
  batchId: BATCH_ID,
  fetched: null,
  robots: { fetched: true, allowed: false },
  pagesVisited: [],
  detections: [],
  opportunities: [],
  credits: { held: 1, captured: 0, released: 1, settled: true },
  error: { code: "ROBOTS_DISALLOWED", message: "robots.txt disallows / for LeadForgeBot" },
  analyzedAt: null,
  finishedAt: EARLIER,
});

export const ANALYSES: WebsiteAnalysis[] = [RUNNING_ANALYSIS, COMPLETED_ANALYSIS, FAILED_ANALYSIS];

export function enrichmentRun(
  o: Partial<EnrichmentRun> & Pick<EnrichmentRun, "id">,
): EnrichmentRun {
  return {
    businessId: BUSINESS_ID,
    kind: "website_contacts",
    status: "completed",
    trigger: "manual",
    input: { url: "https://mamaput.example.test", address: null },
    output: {
      pagesVisited: [],
      observationIds: [],
      found: { phones: 0, emails: 0, socials: 0, whatsapp: 0 },
      phonesVerified: 0,
      whatsappConfirmed: 0,
      emailChecks: [],
      ownSite: true,
    },
    error: null,
    requestedByUserId: ORG_USER,
    createdAt: EARLIER,
    startedAt: EARLIER,
    finishedAt: EARLIER,
    ...o,
  };
}

export const ENRICHMENT_RUNS: EnrichmentRun[] = [
  enrichmentRun({
    id: oid(0xf001),
    output: {
      pagesVisited: [
        { url: HOME, status: 200, error: null },
        { url: CONTACT, status: 200, error: null },
      ],
      observationIds: [oid(0x3005), oid(0x3006)],
      found: { phones: 2, emails: 1, socials: 1, whatsapp: 1 },
      phonesVerified: 1,
      whatsappConfirmed: 1,
      emailChecks: [{ address: "hello@mamaput.example.test", result: "mx_found" }],
      ownSite: true,
    },
  }),
  enrichmentRun({
    id: oid(0xf002),
    kind: "email_check",
    input: { url: null, address: "orders-and-catering-enquiries@mamaput-kitchen.example.test" },
    output: {
      pagesVisited: [],
      observationIds: [],
      found: { phones: 0, emails: 0, socials: 0, whatsapp: 0 },
      phonesVerified: 0,
      whatsappConfirmed: 0,
      emailChecks: [
        {
          address: "orders-and-catering-enquiries@mamaput-kitchen.example.test",
          result: "dns_error",
        },
      ],
      ownSite: null,
    },
    createdAt: LAST_MONTH,
    startedAt: LAST_MONTH,
    finishedAt: LAST_MONTH,
  }),
];

export function scoreSnapshot(o: Partial<ScoreSnapshot> = {}): ScoreSnapshot {
  return {
    fit: 64,
    dataConfidence: 48,
    computedAt: NOW,
    profileId: oid(0xd001),
    profileVersion: 2,
    breakdown: [
      {
        signal: "contactCompleteness",
        label: "Contact completeness",
        weight: 20,
        value: 1,
        points: 20,
        detail: "4 of 4 present: phone, email, website and address",
      },
      {
        signal: "contactVerification",
        label: "Contact verification",
        weight: 15,
        value: 0.25,
        points: 3.75,
        detail: "1 of 4 present fields verified (phone)",
      },
      {
        signal: "websiteOpportunity",
        label: "Website opportunity",
        weight: 20,
        value: 0.67,
        points: 13.4,
        detail:
          "2 opportunities with confidence of at least 0.7 in the website analysis of 2026-10-24: contact_form and online_booking",
      },
      {
        signal: "industryMatch",
        label: "Industry match",
        weight: 15,
        value: 1,
        points: 15,
        detail: "Category Restaurant is in your ICP",
      },
      {
        signal: "locationMatch",
        label: "Location match",
        weight: 15,
        value: 0,
        points: 0,
        detail: "Location is outside your ICP locations",
      },
      {
        signal: "freshness",
        label: "Freshness",
        weight: 10,
        value: 0.85,
        points: 8.5,
        detail: "Last observed or verified 52 days ago (freshness window 180 days)",
      },
      {
        signal: "sourceReliability",
        label: "Source reliability",
        weight: 5,
        value: 0.7,
        points: 3.5,
        detail: "Most reliable source: website (trust 0.7)",
      },
    ],
    dataConfidenceDetail: {
      basis:
        "Average over name, website, phone, email and address of confidence times a state factor (verified 1, unverified 0.8, stale 0.5, conflicting 0.4, missing or expired 0).",
      fields: [
        { field: "name", state: "unverified", confidence: 0.6, quality: 0.48 },
        { field: "website", state: "conflicting", confidence: 0.6, quality: 0.24 },
        { field: "phone", state: "verified", confidence: 0.7, quality: 0.7 },
        { field: "email", state: "unverified", confidence: 0.6, quality: 0.48 },
        { field: "location", state: "unverified", confidence: 0.6, quality: 0.48 },
      ],
    },
    summary:
      "Fit 64 of 100 from contact completeness (20 of 20), industry match (15 of 15), website opportunity (13.4 of 20), freshness (8.5 of 10), contact verification (3.75 of 15) and source reliability (3.5 of 5).",
    explanation: SCORE_EXPLANATION,
    ...o,
  };
}

export const SCORE = scoreSnapshot();

/** The sample business with Phase 4 data: a score, a latest analysis, and duplicates. */
export const DETAIL_P4: BusinessDetail = {
  ...DETAIL,
  score: SCORE,
  latestAnalysis: {
    analysisId: ANALYSIS_ID,
    status: "completed",
    analyzedAt: EARLIER,
    opportunities: ["mobile_friendly_site", "contact_form", "online_booking"],
  },
  dedup: { status: "has_candidates", candidateCount: 1, absorbedIds: [ABSORBED_ID] },
};

/** The directory page with scores on some rows (the rest are not scored yet). */
export const BUSINESS_PAGE_P4: PagedEnvelope<BusinessListItem> = {
  ...BUSINESS_PAGE,
  data: BUSINESS_PAGE.data.map((b, i) =>
    b.id === BUSINESS_ID
      ? { ...b, score: { fit: 64, dataConfidence: 48 } }
      : i === 2
        ? { ...b, score: { fit: 31, dataConfidence: 72 } }
        : b,
  ),
};

export function scoringProfile(o: Partial<ScoringProfile> = {}): ScoringProfile {
  return {
    id: oid(0xd001),
    name: "Default",
    isDefault: true,
    weights: {
      contactCompleteness: 20,
      contactVerification: 15,
      websiteOpportunity: 20,
      industryMatch: 15,
      locationMatch: 15,
      freshness: 10,
      sourceReliability: 5,
    },
    icp: {
      categories: ["Restaurant", "Pharmacy"],
      locations: [
        { country: "NG", region: "Lagos", locality: "Ikeja" },
        { country: "NG", region: "Federal Capital Territory", locality: null },
      ],
    },
    version: 2,
    recompute: {
      status: "completed",
      profileVersion: 2,
      processed: 23,
      total: 23,
      requestedAt: EARLIER,
      startedAt: EARLIER,
      finishedAt: EARLIER,
      error: null,
    },
    updatedByUserId: ORG_USER,
    createdAt: LAST_MONTH,
    updatedAt: EARLIER,
    ...o,
  };
}

export const SCORING_PROFILE = scoringProfile();

export function candidateBusiness(
  o: Partial<CandidateBusiness> & Pick<CandidateBusiness, "id" | "name">,
): CandidateBusiness {
  return {
    nameState: "unverified",
    categories: ["Restaurant"],
    location: {
      formatted: "Ikeja, Lagos, Nigeria",
      locality: "Ikeja",
      lga: "Ikeja",
      region: "Lagos",
    },
    website: null,
    phones: [],
    emails: [],
    sources: ["user_import"],
    suppressed: false,
    live: true,
    createdAt: EARLIER,
    ...o,
  };
}

const MAMA_PUT = candidateBusiness({
  id: BUSINESS_ID,
  name: "Mama Put Kitchen (Sample)",
  categories: ["Restaurant", "Catering"],
  location: {
    formatted: "14 Allen Avenue, Ikeja, Lagos, Nigeria",
    locality: "Ikeja",
    lga: "Ikeja",
    region: "Lagos",
  },
  website: "https://mamaput.example.test",
  phones: ["+2348031234567", "+2348098765432"],
  emails: ["hello@mamaput.example.test"],
  sources: ["user_import", "website", "user_edit"],
  createdAt: "2026-10-01T09:00:00.000Z",
});

const MAMA_PUT_DUP = candidateBusiness({
  id: DUPLICATE_BUSINESS_ID,
  name: "Mama Put Kitchens Ikeja (Sample)",
  categories: ["Restaurant"],
  location: {
    formatted: "Allen Avenue, Ikeja, Lagos",
    locality: "Ikeja",
    lga: "Ikeja",
    region: "Lagos",
  },
  website: "https://mamaput-kitchen.example.test",
  phones: ["+2348031234567"],
  emails: [],
  sources: ["overture_places"],
  createdAt: EARLIER,
});

export function duplicateCandidate(
  o: Partial<DuplicateCandidate> & Pick<DuplicateCandidate, "id">,
): DuplicateCandidate {
  return {
    businessIds: [BUSINESS_ID, DUPLICATE_BUSINESS_ID],
    businesses: [MAMA_PUT, MAMA_PUT_DUP],
    stage: "phone",
    score: 0.91,
    signals: [
      { kind: "shared_phone", aValue: "+2348031234567", bValue: "+2348031234567", similarity: 1 },
      {
        kind: "name_similarity",
        aValue: "Mama Put Kitchen (Sample)",
        bValue: "Mama Put Kitchens Ikeja (Sample)",
        similarity: 0.82,
      },
      { kind: "same_locality", aValue: "Ikeja", bValue: "Ikeja", similarity: 1 },
    ],
    reasons: [
      "Both list +234 803 123 4567",
      'Names are 82% similar ("Mama Put Kitchen (Sample)" and "Mama Put Kitchens Ikeja (Sample)")',
      "Both are in Ikeja",
    ],
    status: "pending",
    decidedByUserId: null,
    decidedAt: null,
    mergeId: null,
    createdAt: MINUTE_AGO,
    updatedAt: MINUTE_AGO,
    ...o,
  };
}

export const CANDIDATE = duplicateCandidate({ id: CANDIDATE_ID });

export const DEFERRED_CANDIDATE = duplicateCandidate({
  id: DEFERRED_CANDIDATE_ID,
  businessIds: [CONFLICT_ID, oid(0x1fb2)],
  businesses: [
    candidateBusiness({
      id: CONFLICT_ID,
      name: "Yaba Tech Hub Coworking and Innovation Centre (Sample)",
      categories: ["Coworking space"],
      location: { formatted: null, locality: "Yaba", lga: "Lagos Mainland", region: "Lagos" },
      emails: ["frontdesk@yabatechhub.example.test"],
      suppressed: true,
    }),
    candidateBusiness({
      id: oid(0x1fb2),
      name: "Yaba Tech Hub (Sample)",
      categories: ["Office space"],
      location: { formatted: null, locality: "Yaba", lga: "Lagos Mainland", region: "Lagos" },
      emails: ["frontdesk@yabatechhub.example.test"],
    }),
  ],
  stage: "email",
  score: 0.77,
  signals: [
    {
      kind: "shared_email",
      aValue: "frontdesk@yabatechhub.example.test",
      bValue: "frontdesk@yabatechhub.example.test",
      similarity: 1,
    },
  ],
  reasons: ["Both list frontdesk@yabatechhub.example.test", "Names are 71% similar"],
  status: "deferred",
  decidedByUserId: ORG_USER,
  decidedAt: EARLIER,
});

export const MERGED_CANDIDATE = duplicateCandidate({
  id: MERGED_CANDIDATE_ID,
  businessIds: [BUSINESS_ID, ABSORBED_ID],
  businesses: [
    MAMA_PUT,
    candidateBusiness({
      id: ABSORBED_ID,
      name: "Mama Put (Sample)",
      live: false,
      phones: ["+2348098765432"],
    }),
  ],
  stage: "phone",
  score: 0.88,
  status: "merged",
  decidedByUserId: ORG_USER,
  decidedAt: EARLIER,
  mergeId: MERGE_ID,
});

export const CANDIDATES: DuplicateCandidate[] = [CANDIDATE, DEFERRED_CANDIDATE, MERGED_CANDIDATE];

export function mergeRecord(o: Partial<MergeRecord> & Pick<MergeRecord, "id">): MergeRecord {
  return {
    candidateId: MERGED_CANDIDATE_ID,
    survivorId: BUSINESS_ID,
    mergedIds: [ABSORBED_ID],
    fieldDecisions: [
      { field: "name", chosenFrom: BUSINESS_ID },
      { field: "website", chosenFrom: BUSINESS_ID },
      { field: "location", chosenFrom: BUSINESS_ID },
    ],
    status: "applied",
    performedByUserId: ORG_USER,
    performedAt: EARLIER,
    undoneAt: null,
    undoneByUserId: null,
    undoForced: false,
    canUndo: true,
    ...o,
  };
}

export const MERGES: MergeRecord[] = [
  mergeRecord({ id: MERGE_ID }),
  mergeRecord({
    id: LOCKED_MERGE_ID,
    candidateId: null,
    mergedIds: [oid(0x1fb3)],
    performedByUserId: OTHER_USER,
    performedAt: LAST_MONTH,
    canUndo: false,
  }),
  mergeRecord({
    id: UNDONE_MERGE_ID,
    candidateId: null,
    mergedIds: [oid(0x1fb4)],
    status: "undone",
    undoneAt: EARLIER,
    undoneByUserId: ORG_USER,
    undoForced: true,
    canUndo: false,
  }),
];

/** Phase 4 pages for the viewport, controls-fit and motion suites. */
export const PHASE4_ROUTES = [
  "/app/analysis",
  `/app/analysis?batchId=${BATCH_ID}`,
  "/app/analysis?status=failed&opportunity=contact_form",
  `/app/analysis/${ANALYSIS_ID}`,
  `/app/analysis/${RUNNING_ANALYSIS_ID}`,
  `/app/analysis/${FAILED_ANALYSIS_ID}`,
  `/app/analysis/${UNKNOWN_ANALYSIS_ID}`,
  `/app/businesses/${BUSINESS_ID}?tab=analysis`,
  `/app/businesses/${BUSINESS_ID}?tab=score`,
  `/app/businesses/${BUSINESS_ID}?tab=opportunities`,
  `/app/businesses/${BUSINESS_ID}?tab=duplicates`,
  `/app/businesses/${CONFLICT_ID}?tab=score`,
  "/app/businesses?fitMin=50&dataConfidenceMin=40&sort=fit:desc",
  "/app/businesses/duplicates",
  "/app/businesses/duplicates?view=deferred",
  "/app/businesses/duplicates?view=history",
  `/app/businesses/duplicates/${CANDIDATE_ID}`,
  `/app/businesses/duplicates/${MERGED_CANDIDATE_ID}`,
  `/app/businesses/duplicates/${UNKNOWN_CANDIDATE_ID}`,
  "/app/settings?tab=scoring",
] as const;
