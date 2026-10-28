import type { Route } from "@playwright/test";
import {
  DEFAULT_PIPELINE_STAGES,
  type Activity,
  type ActivitySummary,
  type BulkOperation,
  type BulkOperationItem,
  type BulkPreview,
  type BusinessListItem,
  type ExportJob,
  type JobSummary,
  type JobsTimeline,
  type Lead,
  type LeadList,
  type LeadListItem,
  type ListItemsResult,
  type OutreachRecord,
  type OverviewMetrics,
  type PipelineBoard,
  type PipelineConfig,
  type PipelineFunnel,
  type QualityDistribution,
  type SourceBreakdown,
  type UsageSummary,
} from "@leadforge/contracts";
import { BUSINESSES, BUSINESS_ID, CONFLICT_ID } from "./fixtures-businesses";

/*
 * Synthetic Phase 5 fixtures (CRM, bulk operations, async exports, reports, usage) and a stateful
 * mock for their endpoints. Factories give every field a default, so an additive contract change
 * needs one edit here. Every business and person is "(Sample)". The mock keeps per-page state
 * (stage moves, assignments, created lists and jobs), so a refetch after a write shows the write.
 */

export const OWNER_ID = "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d";
export const RESEARCHER_ID = "2b3c4d5e-6f7a-4b8c-9d0e-1f2a3b4c5d6e";
/** An active sales representative (added to MEMBERS in fixtures.ts). */
export const SALES_REP_ID = "8e9f0a1b-2c3d-4e5f-9a0b-1c2d3e4f5a6b";

const NOW = "2026-10-25T09:00:00.000Z";
const EARLIER = "2026-10-24T15:30:00.000Z";
const LAST_WEEK = "2026-10-19T11:00:00.000Z";
const oid = (n: number) => `6add8b76520012303c64${n.toString(16).padStart(4, "0")}`;

export const ONITSHA_ID = oid(0x1fa1);
export const EXPIRED_NAME_ID = oid(0x1fa2);
export const GARKI_ID = oid(0x1fa3);
const BAKERY_ID = oid(0x1fb0);

export const LIST_ID = oid(0x5001);
export const REP_LIST_ID = oid(0x5002);
export const EMPTY_LIST_ID = oid(0x5003);
export const UNKNOWN_LIST_ID = oid(0x50ff);

export const LEAD_MAMA_ID = oid(0x5101);
export const LEAD_ONITSHA_ID = oid(0x5102);
export const LEAD_GARKI_ID = oid(0x5103);
export const LEAD_EXPIRED_ID = oid(0x5104);
export const LEAD_YABA_ID = oid(0x5105);
export const LEAD_BAKERY_ID = oid(0x5106);

export const BULK_RUNNING_ID = oid(0x5401);
export const BULK_DONE_ID = oid(0x5402);
export const BULK_CREATED_ID = oid(0x54aa);
export const UNKNOWN_BULK_ID = oid(0x54ff);

export const EXPORT_READY_ID = oid(0x5501);
export const EXPORT_RUNNING_ID = oid(0x5502);
export const EXPORT_EXPIRED_ID = oid(0x5503);
export const EXPORT_CREATED_ID = oid(0x55aa);
export const UNKNOWN_EXPORT_ID = oid(0x55ff);

// ---------------------------------------------------------------------------
// Factories
// ---------------------------------------------------------------------------

export const PIPELINE_CONFIG: PipelineConfig = {
  id: oid(0x5600),
  version: 1,
  stages: DEFAULT_PIPELINE_STAGES.map((s, order) => ({ ...s, order, archived: false })),
  entryStageKey: "new",
  updatedAt: LAST_WEEK,
  updatedByUserId: null,
};

const KIND: Record<string, Lead["stageKind"]> = Object.fromEntries(
  DEFAULT_PIPELINE_STAGES.map((s) => [s.key, s.kind]),
);

function business(id: string): BusinessListItem | undefined {
  return BUSINESSES.find((b) => b.id === id);
}

export function lead(o: Partial<Lead> & Pick<Lead, "id" | "businessId">): Lead {
  const b = business(o.businessId);
  const stageKey = o.stageKey ?? "new";
  return {
    business: b
      ? {
          id: b.id,
          name: b.states.name === "expired" ? null : b.name,
          nameState: b.states.name,
          categories: b.categories.slice(0, 3),
          locality: b.location.locality,
          region: b.location.region,
          fit: b.score?.fit ?? null,
          dataConfidence: b.score?.dataConfidence ?? null,
          suppressed: b.suppressed,
        }
      : {
          id: o.businessId,
          name: "Ikeja Bakery (Sample)",
          nameState: "unverified",
          categories: ["Bakery"],
          locality: "Ikeja",
          region: "Lagos",
          fit: 58,
          dataConfidence: 61,
          suppressed: false,
        },
    stageKey,
    stageKind: KIND[stageKey] ?? "open",
    stageEnteredAt: EARLIER,
    assignedToUserId: null,
    priority: null,
    nextActionAt: null,
    lastActivityAt: null,
    lostReason: null,
    wonValueMinor: null,
    currency: null,
    closedAt: null,
    version: 1,
    createdByUserId: OWNER_ID,
    createdAt: LAST_WEEK,
    updatedAt: EARLIER,
    ...o,
  };
}

export const LEADS: Lead[] = [
  lead({
    id: LEAD_MAMA_ID,
    businessId: BUSINESS_ID,
    stageKey: "qualified",
    assignedToUserId: OWNER_ID,
    lastActivityAt: EARLIER,
    priority: "high",
    version: 3,
  }),
  lead({ id: LEAD_ONITSHA_ID, businessId: ONITSHA_ID, stageKey: "new" }),
  lead({
    id: LEAD_GARKI_ID,
    businessId: GARKI_ID,
    stageKey: "contacted",
    assignedToUserId: SALES_REP_ID,
    lastActivityAt: LAST_WEEK,
  }),
  lead({ id: LEAD_EXPIRED_ID, businessId: EXPIRED_NAME_ID, stageKey: "new" }),
  lead({
    id: LEAD_YABA_ID,
    businessId: CONFLICT_ID,
    stageKey: "interested",
    assignedToUserId: OWNER_ID,
  }),
  lead({
    id: LEAD_BAKERY_ID,
    businessId: BAKERY_ID,
    stageKey: "won",
    assignedToUserId: OWNER_ID,
    closedAt: EARLIER,
  }),
];

/** Leads the board leaves for "Show more" in the New column. */
const SECOND_PAGE_IDS = new Set([LEAD_EXPIRED_ID]);

export function leadList(o: Partial<LeadList> & Pick<LeadList, "id" | "name">): LeadList {
  return {
    description: null,
    ownerUserId: OWNER_ID,
    itemCount: 0,
    createdByUserId: OWNER_ID,
    createdAt: LAST_WEEK,
    updatedAt: EARLIER,
    ...o,
  };
}

export const LISTS: LeadList[] = [
  leadList({
    id: LIST_ID,
    name: "Lagos restaurants (Sample)",
    description: "Restaurants and caterers to call this month (Sample).",
    itemCount: 3,
  }),
  leadList({
    id: REP_LIST_ID,
    name: "Tunde follow-ups (Sample)",
    ownerUserId: SALES_REP_ID,
    createdByUserId: SALES_REP_ID,
    itemCount: 1,
  }),
  leadList({
    id: EMPTY_LIST_ID,
    name: "Abuja clinics (Sample)",
    ownerUserId: RESEARCHER_ID,
    createdByUserId: RESEARCHER_ID,
  }),
];

const LIST_MEMBERS: Record<string, string[]> = {
  [LIST_ID]: [BUSINESS_ID, ONITSHA_ID, EXPIRED_NAME_ID],
  [REP_LIST_ID]: [GARKI_ID],
  [EMPTY_LIST_ID]: [],
};

export function activity(
  o: Partial<Activity> & Pick<Activity, "id" | "type" | "businessId">,
): Activity {
  const b = business(o.businessId);
  return {
    business: b
      ? { id: b.id, name: b.states.name === "expired" ? null : b.name, nameState: b.states.name }
      : null,
    leadId: null,
    outreachId: null,
    direction: null,
    outcome: null,
    body: null,
    target: null,
    occurredAt: EARLIER,
    authorUserId: OWNER_ID,
    stageChange: null,
    assignment: null,
    suppressionOverride: null,
    editedAt: null,
    createdAt: EARLIER,
    ...o,
  };
}

export const ACTIVITIES: Activity[] = [
  activity({
    id: oid(0x5201),
    type: "call",
    businessId: BUSINESS_ID,
    leadId: LEAD_MAMA_ID,
    direction: "outbound",
    outcome: "connected",
    body: "Spoke to the owner about catering for 40 guests (Sample).",
    target: "+234 803 000 0001",
    occurredAt: "2026-10-24T16:00:00.000Z",
  }),
  activity({
    id: oid(0x5202),
    type: "stage_change",
    businessId: BUSINESS_ID,
    leadId: LEAD_MAMA_ID,
    stageChange: { fromStageKey: "new", toStageKey: "qualified" },
    occurredAt: EARLIER,
  }),
  activity({
    id: oid(0x5203),
    type: "assignment",
    businessId: BUSINESS_ID,
    leadId: LEAD_MAMA_ID,
    assignment: { fromUserId: null, toUserId: OWNER_ID },
    occurredAt: "2026-10-24T15:00:00.000Z",
  }),
  activity({
    id: oid(0x5204),
    type: "note",
    businessId: BUSINESS_ID,
    body: "Prefers WhatsApp after 6pm (Sample).",
    authorUserId: RESEARCHER_ID,
    occurredAt: LAST_WEEK,
  }),
  activity({
    id: oid(0x5205),
    type: "whatsapp",
    businessId: GARKI_ID,
    leadId: LEAD_GARKI_ID,
    direction: "outbound",
    outcome: "replied",
    authorUserId: SALES_REP_ID,
    occurredAt: LAST_WEEK,
  }),
  activity({
    id: oid(0x5206),
    type: "email",
    businessId: CONFLICT_ID,
    leadId: LEAD_YABA_ID,
    direction: "inbound",
    outcome: "interested",
    body: "They asked for a quote (Sample).",
    suppressionOverride: {
      reason: "The business emailed us first and asked for a quote (Sample).",
    },
    occurredAt: LAST_WEEK,
  }),
];

export function outreach(
  o: Partial<OutreachRecord> & Pick<OutreachRecord, "id" | "businessId" | "channel">,
): OutreachRecord {
  const b = business(o.businessId);
  return {
    business: b ? { id: b.id, name: b.name, nameState: b.states.name } : null,
    leadId: null,
    target: null,
    status: "planned",
    attempts: 0,
    lastAttemptAt: null,
    lastOutcome: null,
    nextAttemptAt: null,
    ownerUserId: OWNER_ID,
    suppressionOverride: null,
    version: 1,
    createdAt: LAST_WEEK,
    updatedAt: EARLIER,
    ...o,
  };
}

export const OUTREACH: OutreachRecord[] = [
  outreach({
    id: oid(0x5301),
    businessId: BUSINESS_ID,
    channel: "call",
    leadId: LEAD_MAMA_ID,
    status: "in_progress",
    attempts: 2,
    lastAttemptAt: "2026-10-24T16:00:00.000Z",
    lastOutcome: "connected",
    target: "+234 803 000 0001",
    nextAttemptAt: "2026-10-28T10:00:00.000Z",
    version: 2,
  }),
  outreach({ id: oid(0x5302), businessId: BUSINESS_ID, channel: "whatsapp", leadId: LEAD_MAMA_ID }),
  outreach({
    id: oid(0x5303),
    businessId: GARKI_ID,
    channel: "whatsapp",
    status: "replied",
    attempts: 1,
    lastAttemptAt: LAST_WEEK,
    lastOutcome: "replied",
    ownerUserId: SALES_REP_ID,
  }),
];

export function bulkOperation(
  o: Partial<BulkOperation> & Pick<BulkOperation, "id" | "action">,
): BulkOperation {
  return {
    params: { listId: null, assignedToUserId: null, stageKey: null },
    status: "completed",
    selection: { kind: "ids", filter: null },
    progress: {
      total: 0,
      processed: 0,
      changed: 0,
      unchanged: 0,
      skipped: 0,
      failed: 0,
      percent: 100,
    },
    breakdown: [],
    error: null,
    requestedByUserId: OWNER_ID,
    createdAt: EARLIER,
    startedAt: EARLIER,
    finishedAt: EARLIER,
    ...o,
  };
}

const RUNNING_PROGRESS = {
  total: 24,
  processed: 10,
  changed: 9,
  unchanged: 1,
  skipped: 0,
  failed: 0,
  percent: 42,
};
const RUNNING_DONE_PROGRESS = {
  total: 24,
  processed: 24,
  changed: 21,
  unchanged: 2,
  skipped: 1,
  failed: 0,
  percent: 100,
};

export const BULK_RUNNING = bulkOperation({
  id: BULK_RUNNING_ID,
  action: "add_to_list",
  params: { listId: LIST_ID, assignedToUserId: null, stageKey: null },
  status: "running",
  progress: RUNNING_PROGRESS,
  breakdown: [
    { outcome: "added", count: 9 },
    { outcome: "unchanged", count: 1 },
  ],
  finishedAt: null,
});

export const BULK_RUNNING_FINISHED: BulkOperation = {
  ...BULK_RUNNING,
  status: "completed",
  progress: RUNNING_DONE_PROGRESS,
  breakdown: [
    { outcome: "added", count: 21 },
    { outcome: "unchanged", count: 2 },
    { outcome: "suppressed", count: 1 },
  ],
  finishedAt: NOW,
};

export const BULK_DONE = bulkOperation({
  id: BULK_DONE_ID,
  action: "assign",
  params: { listId: null, assignedToUserId: SALES_REP_ID, stageKey: null },
  status: "completed_with_errors",
  selection: { kind: "filter", filter: { suppression: "exclude", region: ["Lagos"] } },
  progress: {
    total: 24,
    processed: 24,
    changed: 21,
    unchanged: 0,
    skipped: 2,
    failed: 1,
    percent: 100,
  },
  breakdown: [
    { outcome: "assigned", count: 18 },
    { outcome: "created_and_assigned", count: 3 },
    { outcome: "suppressed", count: 2 },
    { outcome: "failed", count: 1 },
  ],
});

export function bulkItem(
  o: Partial<BulkOperationItem> & Pick<BulkOperationItem, "businessId" | "outcome">,
): BulkOperationItem {
  const b = business(o.businessId);
  const nameState = b?.states.name ?? null;
  return {
    message: null,
    processedAt: EARLIER,
    // Stage 8: names come with each item; expired names are null with state "expired"; a business
    // outside the organization (not_found) has neither.
    businessName: b && nameState !== "expired" ? b.name : null,
    businessNameState: nameState,
    ...o,
  };
}

export const BULK_ITEMS: BulkOperationItem[] = [
  bulkItem({ businessId: BUSINESS_ID, outcome: "assigned" }),
  bulkItem({ businessId: ONITSHA_ID, outcome: "created_and_assigned" }),
  bulkItem({ businessId: CONFLICT_ID, outcome: "suppressed" }),
  bulkItem({
    businessId: GARKI_ID,
    outcome: "failed",
    message: "Unexpected error while saving the lead (Sample).",
  }),
  bulkItem({ businessId: EXPIRED_NAME_ID, outcome: "unchanged" }),
  bulkItem({ businessId: oid(0x1fff), outcome: "not_found" }),
];

export function exportJob(o: Partial<ExportJob> & Pick<ExportJob, "id" | "kind">): ExportJob {
  return {
    status: "completed",
    format: "zip",
    scope: "all",
    selection: { listId: null, listName: null, idsCount: null, filter: null },
    columns: ["id", "name", "phone", "email", "website", "sources", "attribution", "license_urls"],
    rowCap: 10_000,
    matchedAtRequest: 3,
    rowCount: 3,
    truncated: false,
    progress: { processed: 3, total: 3 },
    file: {
      name: "leadforge-list-2026-10-25T09-00-00.zip",
      bytes: 18_234,
      sha256: "9f2c4a1e7b3d5f60a8c1e2d3b4a5968778695a4b3c2d1e0f9a8b7c6d5e4f3a2b",
      expiresAt: "2026-11-01T09:00:00.000Z",
      available: true,
      licenses: ["CDLA-Permissive-2.0"],
    },
    error: null,
    requestedByUserId: OWNER_ID,
    createdAt: EARLIER,
    startedAt: EARLIER,
    finishedAt: EARLIER,
    ...o,
  };
}

export const EXPORT_READY = exportJob({
  id: EXPORT_READY_ID,
  kind: "list",
  selection: {
    listId: LIST_ID,
    listName: "Lagos restaurants (Sample)",
    idsCount: null,
    filter: null,
  },
});

export const EXPORT_RUNNING = exportJob({
  id: EXPORT_RUNNING_ID,
  kind: "directory",
  status: "running",
  selection: {
    listId: null,
    listName: null,
    idsCount: null,
    filter: { suppression: "exclude", region: ["Lagos"] },
  },
  matchedAtRequest: 240,
  rowCount: null,
  progress: { processed: 120, total: 240 },
  file: null,
  finishedAt: null,
});

export const EXPORT_EXPIRED = exportJob({
  id: EXPORT_EXPIRED_ID,
  kind: "selection",
  status: "expired",
  selection: { listId: null, listName: null, idsCount: 12, filter: null },
  matchedAtRequest: 12,
  rowCount: 12,
  file: {
    name: "leadforge-selection-2026-10-10T09-00-00.zip",
    bytes: 9_120,
    sha256: "0a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f9",
    expiresAt: "2026-10-17T09:00:00.000Z",
    available: false,
    licenses: [],
  },
  createdAt: "2026-10-10T09:00:00.000Z",
  finishedAt: "2026-10-10T09:00:30.000Z",
});

function jobSummary(
  o: Partial<JobSummary> & Pick<JobSummary, "id" | "kind" | "name" | "href">,
): JobSummary {
  return {
    status: "completed",
    kindStatus: "completed",
    progress: { processed: 0, total: null, failed: 0 },
    createdByUserId: OWNER_ID,
    createdAt: EARLIER,
    startedAt: EARLIER,
    finishedAt: EARLIER,
    ...o,
  };
}

export const PHASE5_JOBS: JobSummary[] = [
  jobSummary({
    id: BULK_RUNNING_ID,
    kind: "bulk",
    name: 'Add 24 businesses to "Lagos restaurants (Sample)"',
    status: "running",
    kindStatus: "running",
    progress: { processed: 10, total: 24, failed: 0 },
    finishedAt: null,
    href: `/app/jobs/bulk/${BULK_RUNNING_ID}`,
  }),
  jobSummary({
    id: EXPORT_READY_ID,
    kind: "export",
    name: 'Export of list "Lagos restaurants (Sample)"',
    progress: { processed: 3, total: 3, failed: 0 },
    href: `/app/jobs/exports/${EXPORT_READY_ID}`,
  }),
  jobSummary({
    id: BULK_DONE_ID,
    kind: "bulk",
    name: "Assign 24 businesses to Tunde Sales (Sample)",
    status: "completed_with_warnings",
    kindStatus: "completed_with_errors",
    progress: { processed: 24, total: 24, failed: 1 },
    href: `/app/jobs/bulk/${BULK_DONE_ID}`,
  }),
];

// ---------------------------------------------------------------------------
// Reports, usage and overview
// ---------------------------------------------------------------------------

const header = {
  period: "30d" as const,
  periodStart: "2026-09-25T09:00:00.000Z",
  generatedAt: NOW,
};

const buckets = (counts: number[]) =>
  counts.map((count, i) => ({ min: i * 10, max: i === 9 ? 100 : i * 10 + 9, count }));

export const SOURCE_BREAKDOWN: SourceBreakdown = {
  ...header,
  totalBusinesses: 47,
  sources: [
    { source: "user_import", businesses: 40, share: 0.851 },
    { source: "user_edit", businesses: 12, share: 0.255 },
    { source: "overture_places", businesses: 9, share: 0.191 },
    { source: "website", businesses: 3, share: 0.064 },
  ],
};

export const QUALITY: QualityDistribution = {
  ...header,
  total: 47,
  unscored: 12,
  fit: buckets([1, 2, 3, 6, 8, 7, 4, 2, 1, 1]),
  dataConfidence: buckets([0, 1, 2, 3, 5, 9, 8, 4, 2, 1]),
};

const zero = { discovery: 0, import: 0, analysis: 0, enrichment: 0, export: 0, bulk: 0 };
const DAYS = [
  "2026-10-19",
  "2026-10-20",
  "2026-10-21",
  "2026-10-22",
  "2026-10-23",
  "2026-10-24",
  "2026-10-25",
];

export const JOBS_TIMELINE: JobsTimeline = {
  period: "30d",
  periodStart: header.periodStart,
  generatedAt: NOW,
  days: DAYS.map((day, i) => ({
    day,
    created: {
      ...zero,
      discovery: i % 3 === 0 ? 1 : 0,
      import: i === 2 ? 1 : 0,
      analysis: i % 2,
      export: i === 6 ? 2 : 0,
      bulk: i === 5 ? 1 : 0,
    },
    failed: { ...zero, discovery: i === 3 ? 1 : 0 },
  })),
  totals: {
    created: { discovery: 3, import: 1, analysis: 3, enrichment: 0, export: 2, bulk: 1 },
    failed: { ...zero, discovery: 1 },
  },
};

export const FUNNEL: PipelineFunnel = {
  ...header,
  stages: PIPELINE_CONFIG.stages.map((s, i) => ({
    key: s.key,
    label: s.label,
    kind: s.kind,
    order: s.order,
    archived: false,
    current: [2, 1, 1, 1, 0, 1, 0][i] ?? 0,
    entered: [6, 4, 3, 2, 1, 1, 1][i] ?? 0,
  })),
  totals: {
    leads: 6,
    open: 5,
    won: 1,
    lost: 0,
    winRate: 0.5,
    wonValue: [{ currency: "NGN", valueMinor: 45_000_000 }],
  },
};

export const ACTIVITY_SUMMARY: ActivitySummary = {
  ...header,
  total: 11,
  byType: [
    { type: "note", count: 3 },
    { type: "call", count: 4 },
    { type: "whatsapp", count: 2 },
    { type: "email", count: 1 },
    { type: "meeting", count: 1 },
  ],
  byUser: [
    {
      userId: OWNER_ID,
      name: "Ada Okafor (Sample)",
      total: 7,
      byType: [
        { type: "call", count: 4 },
        { type: "note", count: 2 },
        { type: "email", count: 1 },
      ],
    },
    {
      userId: SALES_REP_ID,
      name: "Tunde Sales (Sample)",
      total: 4,
      byType: [
        { type: "whatsapp", count: 2 },
        { type: "meeting", count: 1 },
        { type: "note", count: 1 },
      ],
    },
  ],
};

export const USAGE: UsageSummary = {
  period: "30d",
  from: DAYS[0]!,
  to: DAYS[6]!,
  computedAt: "2026-10-25T08:50:00.000Z",
  metrics: [
    "credits_used",
    "discovery_jobs",
    "discovery_records",
    "analyses",
    "enrichment_runs",
    "exports",
    "export_rows",
  ],
  series: DAYS.map((day, i) => ({
    day,
    values: {
      credits_used: [0, 12, 0, 30, 1, 0, 4][i] ?? 0,
      discovery_jobs: [0, 1, 0, 1, 0, 0, 1][i] ?? 0,
      discovery_records: [0, 11, 0, 29, 0, 0, 3][i] ?? 0,
      analyses: [0, 1, 0, 1, 1, 0, 1][i] ?? 0,
      enrichment_runs: [1, 0, 2, 0, 0, 1, 0][i] ?? 0,
      exports: [0, 0, 1, 0, 0, 0, 2][i] ?? 0,
      export_rows: [0, 0, 40, 0, 0, 0, 15][i] ?? 0,
    },
  })),
  totals: {
    credits_used: 47,
    discovery_jobs: 3,
    discovery_records: 43,
    analyses: 4,
    enrichment_runs: 4,
    exports: 3,
    export_rows: 55,
  },
  credits: { balance: 953, held: 0 },
};

/** Phase 5 parts of GET /reports/overview, merged into the Phase 3 overview fixture. */
export const OVERVIEW_P5: Pick<OverviewMetrics, "pipeline" | "jobs" | "activity" | "quality"> & {
  credits: OverviewMetrics["credits"];
} = {
  pipeline: {
    openLeads: 5,
    qualifiedLeads: 3,
    unassignedOpenLeads: 2,
    wonInPeriod: 1,
    lostInPeriod: 0,
  },
  jobs: { active: 2, failedInPeriod: 1, recent: PHASE5_JOBS },
  activity: { loggedInPeriod: 11, recent: ACTIVITIES.slice(0, 5) },
  quality: {
    total: QUALITY.total,
    unscored: QUALITY.unscored,
    fit: QUALITY.fit,
    dataConfidence: QUALITY.dataConfidence,
  },
  credits: { balance: 1000, held: 0, usedInPeriod: 47 },
};

export const OVERVIEW_P5_EMPTY: typeof OVERVIEW_P5 = {
  pipeline: {
    openLeads: 0,
    qualifiedLeads: 0,
    unassignedOpenLeads: 0,
    wonInPeriod: 0,
    lostInPeriod: 0,
  },
  jobs: { active: 0, failedInPeriod: 0, recent: [] },
  activity: { loggedInPeriod: 0, recent: [] },
  quality: {
    total: 0,
    unscored: 0,
    fit: buckets(Array(10).fill(0)),
    dataConfidence: buckets(Array(10).fill(0)),
  },
  credits: { balance: 0, held: 0, usedInPeriod: 0 },
};

/** Pages with their primary request, for the controls-fit, motion and a11y suites. */
export const PHASE5_ROUTES = [
  "/app/pipeline",
  `/app/pipeline?assignedToUserId=${OWNER_ID}`,
  "/app/lists",
  `/app/lists/${LIST_ID}`,
  `/app/lists/${EMPTY_LIST_ID}`,
  `/app/lists/${UNKNOWN_LIST_ID}`,
  "/app/activities",
  "/app/outreach",
  "/app/reports",
  `/app/jobs/bulk/${BULK_RUNNING_ID}`,
  `/app/jobs/bulk/${BULK_DONE_ID}`,
  `/app/jobs/bulk/${UNKNOWN_BULK_ID}`,
  `/app/jobs/exports/${EXPORT_READY_ID}`,
  `/app/jobs/exports/${EXPORT_RUNNING_ID}`,
  `/app/jobs/exports/${EXPORT_EXPIRED_ID}`,
  `/app/jobs/exports/${UNKNOWN_EXPORT_ID}`,
  `/app/businesses/${BUSINESS_ID}?tab=activities`,
] as const;

// ---------------------------------------------------------------------------
// Stateful mock
// ---------------------------------------------------------------------------

export interface Phase5Options {
  empty?: boolean;
  role?: string;
  /**
   * The first stage move answers 409 VERSION_CONFLICT. "retry": the lead only changed version
   * (the retry succeeds); "moved": someone else already moved it to Contacted.
   */
  moveConflict?: "retry" | "moved";
  /** POST /activities and attempts answer 409 CONTACT_SUPPRESSED until an override reason is sent. */
  contactSuppressed?: boolean;
  /** Bulk previews match 6,000 businesses (over the 5,000 cap). */
  bulkOverCap?: boolean;
  /** POST /exports answers 422 EXPORT_TOO_LARGE. */
  exportTooLarge?: boolean;
  /** GET /exports/:id/download-url answers with this error code. */
  downloadError?: "EXPORT_NOT_READY" | "EXPORT_EXPIRED" | "DOWNLOAD_LINK_EXPIRED";
  /** The first PUT /pipeline/config answers 409 VERSION_CONFLICT (someone renamed New to "Fresh leads"). */
  configConflict?: boolean;
  /** The first PATCH /pipeline/leads/:id answers 409 VERSION_CONFLICT (someone set its priority to low). */
  leadConflict?: boolean;
}

function json(route: Route, status: number, body: unknown) {
  return route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
}
function err(
  route: Route,
  status: number,
  code: string,
  message: string,
  details?: { path: string; message: string }[],
) {
  return json(route, status, { error: { code, message, details, requestId: "e2e" } });
}
function page<T>(data: T[], extra: Record<string, unknown> = {}) {
  return { data, meta: { nextCursor: null, pageSize: 25, ...extra } };
}

const ASSIGNABLE = new Set([OWNER_ID, SALES_REP_ID]);

/**
 * Creates the Phase 5 mock for one page. Returns null for paths it does not own, so the caller
 * falls through to its other mocks.
 */
export function createPhase5Mock(opts: Phase5Options = {}) {
  const leads = new Map(LEADS.map((l) => [l.id, { ...l }]));
  const lists = new Map(LISTS.map((l) => [l.id, { ...l }]));
  const members: Record<string, string[]> = Object.fromEntries(
    Object.entries(LIST_MEMBERS).map(([k, v]) => [k, [...v]]),
  );
  const activities = [...ACTIVITIES];
  let moveConflictUsed = false;
  let config: PipelineConfig = {
    ...PIPELINE_CONFIG,
    stages: PIPELINE_CONFIG.stages.map((s) => ({ ...s })),
  };
  let configConflictUsed = false;
  let leadConflictUsed = false;
  const activeConfigStages = () =>
    config.stages.filter((s) => !s.archived).sort((a, b) => a.order - b.order);
  const polls: Record<string, number> = {};
  const created: { bulk?: BulkOperation; export?: ExportJob } = {};

  const empty = Boolean(opts.empty);
  const allLeads = () => (empty ? [] : [...leads.values()]);

  const matches = (l: Lead, q: URLSearchParams) => {
    const owner = q.get("assignedToUserId");
    if (owner && l.assignedToUserId !== owner) return false;
    if (q.get("unassigned") === "true" && l.assignedToUserId) return false;
    const listId = q.get("listId");
    if (listId && !(members[listId] ?? []).includes(l.businessId)) return false;
    const businessId = q.get("businessId");
    if (businessId && l.businessId !== businessId) return false;
    return true;
  };

  const listItem = (businessId: string, listId: string): LeadListItem => {
    const l = [...leads.values()].find((x) => x.businessId === businessId);
    return {
      businessId,
      addedAt: EARLIER,
      addedByUserId: lists.get(listId)?.ownerUserId ?? OWNER_ID,
      business: business(businessId) ?? null,
      lead: l
        ? {
            id: l.id,
            stageKey: l.stageKey,
            stageKind: l.stageKind,
            assignedToUserId: l.assignedToUserId,
          }
        : null,
    };
  };

  const listResult = (listId: string, ids: string[], mode: "add" | "remove"): ListItemsResult => {
    const current = members[listId] ?? [];
    const results = ids.map((id) => {
      const b = business(id);
      if (!b) return { businessId: id, outcome: "not_found" as const };
      if (mode === "add") {
        if (b.suppressed) return { businessId: id, outcome: "suppressed" as const };
        if (current.includes(id)) return { businessId: id, outcome: "already_in_list" as const };
        current.push(id);
        return { businessId: id, outcome: "added" as const };
      }
      if (!current.includes(id)) return { businessId: id, outcome: "not_in_list" as const };
      current.splice(current.indexOf(id), 1);
      return { businessId: id, outcome: "removed" as const };
    });
    members[listId] = current;
    const list = lists.get(listId)!;
    list.itemCount = current.length;
    list.updatedAt = NOW;
    const count = (o: string) => results.filter((r) => r.outcome === o).length;
    return {
      list: { ...list },
      results,
      summary: {
        requested: ids.length,
        changed: count("added") + count("removed"),
        unchanged: count("already_in_list") + count("not_in_list"),
        notFound: count("not_found"),
        suppressed: count("suppressed"),
        listFull: 0,
      },
    };
  };

  const moveTo = (l: Lead, stageKey: string): Lead => {
    const next = {
      ...l,
      stageKey,
      stageKind: KIND[stageKey] ?? "open",
      stageEnteredAt: NOW,
      version: l.version + 1,
      updatedAt: NOW,
    };
    leads.set(l.id, next);
    activities.unshift(
      activity({
        id: oid(0x5280 + activities.length),
        type: "stage_change",
        businessId: l.businessId,
        leadId: l.id,
        stageChange: { fromStageKey: l.stageKey, toStageKey: stageKey },
        occurredAt: NOW,
      }),
    );
    return next;
  };

  /** A job that finishes after a couple of polls. */
  const advance = <T>(id: string, running: T, done: T): T => {
    polls[id] = (polls[id] ?? 0) + 1;
    return polls[id]! > 2 ? done : running;
  };

  return function handle(
    route: Route,
    url: URL,
    path: string,
    method: string,
  ): Promise<void> | null {
    // ---- Pipeline ----
    if (method === "GET" && path === "/pipeline/config") return json(route, 200, { data: config });
    if (method === "PUT" && path === "/pipeline/config") {
      const body = route.request().postDataJSON() as {
        version: number;
        stages: { key?: string; label: string; archived?: boolean }[];
      };
      if (opts.configConflict && !configConflictUsed) {
        configConflictUsed = true;
        config = {
          ...config,
          version: config.version + 1,
          stages: config.stages.map((s) => (s.key === "new" ? { ...s, label: "Fresh leads" } : s)),
          updatedAt: NOW,
        };
        return err(route, 409, "VERSION_CONFLICT", "The pipeline configuration changed", [
          { path: "version", message: String(config.version) },
        ]);
      }
      if (body.version !== config.version) {
        return err(route, 409, "VERSION_CONFLICT", "The pipeline configuration changed", [
          { path: "version", message: String(config.version) },
        ]);
      }
      for (const [i, s] of body.stages.entries()) {
        const existing = s.key ? config.stages.find((x) => x.key === s.key) : undefined;
        if (s.archived && existing && !existing.archived) {
          const holding = allLeads().filter((l) => l.stageKey === s.key).length;
          if (holding > 0) {
            return err(route, 409, "STAGE_NOT_EMPTY", "The stage still holds leads", [
              { path: "stageKey", message: s.key! },
              { path: "leads", message: String(holding) },
            ]);
          }
        }
        if (!s.label.trim())
          return err(route, 400, "VALIDATION_FAILED", "Invalid", [
            { path: `stages.${i}.label`, message: "Give the stage a name" },
          ]);
      }
      config = {
        ...config,
        version: config.version + 1,
        updatedAt: NOW,
        stages: body.stages.map((s, order) => {
          const existing = s.key ? config.stages.find((x) => x.key === s.key) : undefined;
          const key =
            existing?.key ??
            (s.label
              .trim()
              .toLowerCase()
              .replace(/[^a-z0-9]+/g, "_")
              .replace(/^_+|_+$/g, "") ||
              `stage_${order}`);
          return {
            key,
            label: s.label.trim(),
            kind: existing?.kind ?? "open",
            order,
            archived: Boolean(s.archived),
          };
        }),
      };
      config.entryStageKey = activeConfigStages().find((s) => s.kind === "open")?.key ?? "new";
      return json(route, 200, { data: config });
    }
    if (method === "GET" && path === "/pipeline/board") {
      const q = url.searchParams;
      const board: PipelineBoard = {
        config,
        columns: activeConfigStages().map((stage) => {
          const inStage = allLeads().filter((l) => l.stageKey === stage.key && matches(l, q));
          const first = inStage.filter((l) => !SECOND_PAGE_IDS.has(l.id));
          return {
            stage,
            count: inStage.length,
            leads: first,
            nextCursor: first.length < inStage.length ? "page-2" : null,
          };
        }),
      };
      return json(route, 200, { data: board });
    }
    if (method === "GET" && path === "/pipeline/leads") {
      const q = url.searchParams;
      const stages = q.getAll("stage");
      let rows = allLeads().filter(
        (l) => matches(l, q) && (!stages.length || stages.includes(l.stageKey)),
      );
      if (stages.length && !q.get("listId")) {
        rows =
          q.get("cursor") === "page-2"
            ? rows.filter((l) => SECOND_PAGE_IDS.has(l.id))
            : rows.filter((l) => !SECOND_PAGE_IDS.has(l.id));
      }
      return json(route, 200, page(rows, { total: rows.length }));
    }
    const leadPath = /^\/pipeline\/leads\/([a-f0-9]{24})(\/move|\/assign)?$/.exec(path);
    if (leadPath) {
      const l = leads.get(leadPath[1]!);
      if (!l) return err(route, 404, "NOT_FOUND", "Lead not found");
      if (method === "GET" && !leadPath[2]) return json(route, 200, { data: l });
      const body = (route.request().postDataJSON() ?? {}) as Record<string, unknown>;
      if (method === "POST" && leadPath[2] === "/move") {
        if (opts.moveConflict && !moveConflictUsed) {
          moveConflictUsed = true;
          if (opts.moveConflict === "moved") moveTo(l, "contacted");
          else leads.set(l.id, { ...l, version: l.version + 1 });
          return err(route, 409, "VERSION_CONFLICT", "The lead changed since it was read", [
            { path: "version", message: String(leads.get(l.id)!.version) },
          ]);
        }
        if (typeof body.version === "number" && body.version !== l.version) {
          return err(route, 409, "VERSION_CONFLICT", "The lead changed since it was read", [
            { path: "version", message: String(l.version) },
          ]);
        }
        const keys = activeConfigStages().map((s) => s.key);
        const i = keys.indexOf(l.stageKey);
        const target =
          typeof body.stageKey === "string"
            ? body.stageKey
            : body.direction === "next"
              ? keys[i + 1]
              : keys[i - 1];
        if (!target)
          return err(route, 400, "VALIDATION_FAILED", "No stage there", [
            { path: "direction", message: "There is no stage there" },
          ]);
        return json(route, 200, { data: moveTo(l, target) });
      }
      if (method === "PATCH" && !leadPath[2]) {
        if (opts.leadConflict && !leadConflictUsed) {
          leadConflictUsed = true;
          leads.set(l.id, { ...l, priority: "low", version: l.version + 1, updatedAt: NOW });
          return err(route, 409, "VERSION_CONFLICT", "The lead changed since it was read", [
            { path: "version", message: String(l.version + 1) },
          ]);
        }
        if (typeof body.version === "number" && body.version !== l.version) {
          return err(route, 409, "VERSION_CONFLICT", "The lead changed since it was read", [
            { path: "version", message: String(l.version) },
          ]);
        }
        const { version: _v, ...fields } = body;
        const next = { ...l, ...(fields as Partial<Lead>), version: l.version + 1, updatedAt: NOW };
        leads.set(l.id, next);
        return json(route, 200, { data: next });
      }
      if (method === "POST" && leadPath[2] === "/assign") {
        const to = body.assignedToUserId as string | null;
        if (to !== null && !ASSIGNABLE.has(to)) {
          return err(route, 422, "INVALID_ASSIGNEE", "The assignee cannot work leads", [
            { path: "assignedToUserId", message: "Not an active member who can work leads" },
          ]);
        }
        const next = { ...l, assignedToUserId: to, version: l.version + 1, updatedAt: NOW };
        leads.set(l.id, next);
        return json(route, 200, { data: next });
      }
    }
    if (method === "POST" && path === "/pipeline/leads") {
      const body = route.request().postDataJSON() as {
        businessId: string;
        assignedToUserId?: string | null;
      };
      const existing = [...leads.values()].find((l) => l.businessId === body.businessId);
      if (existing) return json(route, 200, { data: existing });
      const l = lead({
        id: oid(0x51a0 + leads.size),
        businessId: body.businessId,
        assignedToUserId: body.assignedToUserId ?? null,
        createdAt: NOW,
      });
      leads.set(l.id, l);
      return json(route, 201, { data: l });
    }

    // ---- Lists ----
    if (method === "GET" && path === "/lists") {
      const q = url.searchParams;
      const prefix = (q.get("q") ?? "").toLowerCase();
      const owner = q.get("ownerUserId");
      const businessId = q.get("businessId");
      const rows = (empty ? [] : [...lists.values()]).filter(
        (l) =>
          l.name.toLowerCase().startsWith(prefix) &&
          (!owner || l.ownerUserId === owner) &&
          (!businessId || (members[l.id] ?? []).includes(businessId)),
      );
      return json(route, 200, page(rows));
    }
    if (method === "POST" && path === "/lists") {
      const body = route.request().postDataJSON() as {
        name: string;
        description?: string | null;
        ownerUserId?: string;
      };
      if ([...lists.values()].some((l) => l.name.toLowerCase() === body.name.toLowerCase())) {
        return err(route, 409, "CONFLICT", "A list with this name already exists");
      }
      const l = leadList({
        id: oid(0x50a0 + lists.size),
        name: body.name,
        description: body.description ?? null,
        ownerUserId: body.ownerUserId ?? OWNER_ID,
        createdAt: NOW,
        updatedAt: NOW,
      });
      lists.set(l.id, l);
      members[l.id] = [];
      return json(route, 201, { data: l });
    }
    const listPath = /^\/lists\/([a-f0-9]{24})(\/items|\/items\/remove)?$/.exec(path);
    if (listPath) {
      const l = lists.get(listPath[1]!);
      if (!l) return err(route, 404, "NOT_FOUND", "List not found");
      if (!listPath[2]) {
        if (method === "GET") return json(route, 200, { data: l });
        if (method === "PATCH") {
          const body = route.request().postDataJSON() as Partial<LeadList>;
          Object.assign(l, body, { updatedAt: NOW });
          return json(route, 200, { data: { ...l } });
        }
        if (method === "DELETE") {
          lists.delete(l.id);
          return json(route, 200, { data: { deleted: true, items: l.itemCount } });
        }
      }
      if (method === "GET" && listPath[2] === "/items") {
        return json(
          route,
          200,
          page(
            (members[l.id] ?? []).map((id) => listItem(id, l.id)),
            { total: l.itemCount },
          ),
        );
      }
      if (method === "POST") {
        const body = route.request().postDataJSON() as { businessIds: string[] };
        return json(route, 200, {
          data: listResult(
            l.id,
            body.businessIds,
            listPath[2] === "/items/remove" ? "remove" : "add",
          ),
        });
      }
    }

    // ---- Activities and outreach ----
    if (method === "GET" && path === "/activities") {
      const q = url.searchParams;
      const types = q.getAll("type");
      const rows = (empty ? [] : activities).filter(
        (a) =>
          (!types.length || types.includes(a.type)) &&
          (!q.get("businessId") || a.businessId === q.get("businessId")) &&
          (!q.get("userId") || a.authorUserId === q.get("userId")) &&
          (!q.get("listId") || (members[q.get("listId")!] ?? []).includes(a.businessId)),
      );
      return json(route, 200, page(rows));
    }
    if (method === "POST" && path === "/activities") {
      const body = route.request().postDataJSON() as Record<string, unknown>;
      const contact = body.type !== "note";
      if (
        contact &&
        (opts.contactSuppressed || body.businessId === CONFLICT_ID) &&
        !body.suppressionOverride
      ) {
        return err(route, 409, "CONTACT_SUPPRESSED", "The business is suppressed", [
          {
            path: "suppressionOverride.reason",
            message: "Give a reason to log contact with a suppressed business",
          },
        ]);
      }
      const a = activity({
        id: oid(0x52a0 + activities.length),
        type: body.type as Activity["type"],
        businessId: body.businessId as string,
        body: (body.body as string) ?? null,
        outcome: (body.outcome as Activity["outcome"]) ?? null,
        direction: (body.direction as Activity["direction"]) ?? null,
        target: (body.target as string) ?? null,
        occurredAt: (body.occurredAt as string) ?? NOW,
        suppressionOverride: body.suppressionOverride
          ? { reason: (body.suppressionOverride as { reason: string }).reason }
          : null,
        createdAt: NOW,
      });
      activities.unshift(a);
      const counted = contact && body.type !== "meeting" && body.direction !== "inbound";
      const record = counted
        ? outreach({
            id: oid(0x53a0),
            businessId: a.businessId,
            channel: a.type as OutreachRecord["channel"],
            status: "in_progress",
            attempts: 3,
            lastAttemptAt: a.occurredAt,
            lastOutcome: a.outcome,
          })
        : null;
      return json(route, 201, { data: { activity: a, outreach: record } });
    }
    const activityPath = /^\/activities\/([a-f0-9]{24})$/.exec(path);
    if (activityPath && (method === "PATCH" || method === "DELETE")) {
      const i = activities.findIndex((a) => a.id === activityPath[1]);
      if (i < 0) return err(route, 404, "NOT_FOUND", "Activity not found");
      if (method === "DELETE") {
        activities.splice(i, 1);
        return json(route, 200, { data: { deleted: true } });
      }
      const body = route.request().postDataJSON() as Partial<Activity>;
      activities[i] = { ...activities[i]!, ...body, editedAt: NOW };
      return json(route, 200, { data: activities[i] });
    }
    if (method === "GET" && path === "/outreach") {
      const q = url.searchParams;
      const channels = q.getAll("channel");
      const statuses = q.getAll("status");
      const rows = (empty ? [] : OUTREACH).filter(
        (o) =>
          (!channels.length || channels.includes(o.channel)) &&
          (!statuses.length || statuses.includes(o.status)) &&
          (!q.get("businessId") || o.businessId === q.get("businessId")) &&
          (!q.get("userId") || o.ownerUserId === q.get("userId")),
      );
      return json(route, 200, page(rows));
    }
    const outreachPath = /^\/outreach\/([a-f0-9]{24})(\/attempts)?$/.exec(path);
    if (outreachPath) {
      const o = OUTREACH.find((x) => x.id === outreachPath[1]);
      if (!o) return err(route, 404, "NOT_FOUND", "Outreach record not found");
      const body = (route.request().postDataJSON() ?? {}) as Record<string, unknown>;
      if (method === "POST" && outreachPath[2]) {
        if (opts.contactSuppressed && !body.suppressionOverride) {
          return err(route, 409, "CONTACT_SUPPRESSED", "The business is suppressed", [
            { path: "suppressionOverride.reason", message: "Give a reason" },
          ]);
        }
        const next = {
          ...o,
          attempts: o.attempts + 1,
          lastAttemptAt: NOW,
          lastOutcome: (body.outcome as OutreachRecord["lastOutcome"]) ?? null,
          status: "in_progress" as const,
        };
        return json(route, 201, {
          data: {
            outreach: next,
            activity: activity({
              id: oid(0x52f0),
              type: o.channel,
              businessId: o.businessId,
              outcome: next.lastOutcome,
              occurredAt: NOW,
            }),
          },
        });
      }
      if (method === "PATCH") {
        if (body.version !== o.version)
          return err(route, 409, "VERSION_CONFLICT", "The record changed", [
            { path: "version", message: String(o.version) },
          ]);
        return json(route, 200, { data: { ...o, ...body, version: o.version + 1 } });
      }
    }

    // ---- Bulk operations ----
    if (method === "POST" && path === "/bulk-operations/preview") {
      const body = route.request().postDataJSON() as {
        action: BulkPreview["action"];
        selection: { ids?: string[] };
      };
      const matched = opts.bulkOverCap ? 6000 : (body.selection.ids?.length ?? 240);
      const preview: BulkPreview = {
        action: body.action,
        matched,
        cap: 5000,
        overCap: matched > 5000,
        willChange: matched > 1 ? matched - 1 : matched,
        breakdown: [
          {
            outcome:
              body.action === "add_to_list"
                ? "added"
                : body.action === "move_stage"
                  ? "moved"
                  : body.action === "remove_from_list"
                    ? "removed"
                    : "assigned",
            count: matched > 1 ? matched - 1 : matched,
          },
          {
            outcome: body.action === "move_stage" ? "not_in_pipeline" : "suppressed",
            count: matched > 1 ? 1 : 0,
          },
        ],
      };
      return json(route, 200, { data: preview });
    }
    if (method === "POST" && path === "/bulk-operations") {
      if (!route.request().headers()["idempotency-key"]) {
        return err(route, 400, "VALIDATION_FAILED", "Idempotency-Key is required", [
          { path: "Idempotency-Key", message: "Required" },
        ]);
      }
      const body = route.request().postDataJSON() as {
        action: BulkOperation["action"];
        listId?: string;
        assignedToUserId?: string | null;
        stageKey?: string;
        selection: { ids?: string[] };
      };
      const total = body.selection.ids?.length ?? 240;
      created.bulk = bulkOperation({
        id: BULK_CREATED_ID,
        action: body.action,
        params: {
          listId: body.listId ?? null,
          assignedToUserId: body.assignedToUserId ?? null,
          stageKey: body.stageKey ?? null,
        },
        status: "queued",
        selection: { kind: body.selection.ids ? "ids" : "filter", filter: null },
        progress: {
          total,
          processed: 0,
          changed: 0,
          unchanged: 0,
          skipped: 0,
          failed: 0,
          percent: 0,
        },
        startedAt: null,
        finishedAt: null,
        createdAt: NOW,
      });
      return json(route, 202, { data: created.bulk });
    }
    const bulkPath = /^\/bulk-operations\/([a-f0-9]{24})(\/items)?$/.exec(path);
    if (method === "GET" && bulkPath) {
      const id = bulkPath[1]!;
      if (bulkPath[2]) {
        const outcomes = url.searchParams.getAll("outcome");
        const items =
          id === BULK_DONE_ID || id === BULK_CREATED_ID ? BULK_ITEMS : BULK_ITEMS.slice(0, 2);
        return json(
          route,
          200,
          page(items.filter((i) => !outcomes.length || outcomes.includes(i.outcome))),
        );
      }
      if (id === BULK_RUNNING_ID)
        return json(route, 200, { data: advance(id, BULK_RUNNING, BULK_RUNNING_FINISHED) });
      if (id === BULK_DONE_ID) return json(route, 200, { data: BULK_DONE });
      if (id === BULK_CREATED_ID && created.bulk) {
        const b = created.bulk;
        const total = b.progress.total;
        const done: BulkOperation = {
          ...b,
          status: "completed",
          progress: {
            total,
            processed: total,
            changed: total - 1,
            unchanged: 0,
            skipped: 1,
            failed: 0,
            percent: 100,
          },
          breakdown: [
            {
              outcome:
                b.action === "assign" ? "assigned" : b.action === "move_stage" ? "moved" : "added",
              count: total - 1,
            },
            { outcome: "suppressed", count: 1 },
          ],
          startedAt: NOW,
          finishedAt: NOW,
        };
        return json(route, 200, {
          data: advance(id, { ...b, status: "running", startedAt: NOW }, done),
        });
      }
      return err(route, 404, "NOT_FOUND", "Bulk operation not found");
    }

    // ---- Exports ----
    if (method === "POST" && path === "/exports") {
      if (opts.exportTooLarge) {
        return err(route, 422, "EXPORT_TOO_LARGE", "Too many rows", [
          { path: "rowCap", message: "10000" },
          { path: "matched", message: "12400" },
        ]);
      }
      const body = route.request().postDataJSON() as {
        kind: ExportJob["kind"];
        listId?: string;
        ids?: string[];
      };
      created.export = exportJob({
        id: EXPORT_CREATED_ID,
        kind: body.kind,
        status: "queued",
        selection: {
          listId: body.listId ?? null,
          listName: body.listId ? (lists.get(body.listId)?.name ?? null) : null,
          idsCount: body.ids?.length ?? null,
          filter: null,
        },
        rowCount: null,
        progress: { processed: 0, total: null },
        file: null,
        createdAt: NOW,
        startedAt: null,
        finishedAt: null,
        scope: opts.role === "sales_rep" ? "assigned" : "all",
      });
      return json(route, 202, { data: created.export });
    }
    const exportPath = /^\/exports\/([a-f0-9]{24})(\/download-url|\/download)?$/.exec(path);
    if (method === "GET" && exportPath) {
      const id = exportPath[1]!;
      if (exportPath[2] === "/download-url") {
        if (opts.downloadError) {
          const status = opts.downloadError === "EXPORT_NOT_READY" ? 409 : 410;
          return err(route, status, opts.downloadError, "The file cannot be downloaded");
        }
        return json(route, 200, {
          data: {
            url: `http://127.0.0.1:4999/api/v1/exports/${id}/download?org=6f1c2a7e-3b4d-4e5f-8a9b-0c1d2e3f4a5b&expires=1793000000&sig=e2e-signature-abcdefghijklmnop`,
            expiresAt: "2026-10-25T09:15:00.000Z",
          },
        });
      }
      if (exportPath[2] === "/download") {
        return route.fulfill({
          status: 200,
          contentType: "application/zip",
          headers: { "content-disposition": `attachment; filename="leadforge-export-${id}.zip"` },
          body: Buffer.from("PK\u0003\u0004 e2e sample zip: leadforge-list.csv ATTRIBUTION.txt"),
        });
      }
      if (id === EXPORT_READY_ID) return json(route, 200, { data: EXPORT_READY });
      if (id === EXPORT_EXPIRED_ID) return json(route, 200, { data: EXPORT_EXPIRED });
      if (id === EXPORT_RUNNING_ID) {
        return json(route, 200, {
          data: advance(id, EXPORT_RUNNING, {
            ...EXPORT_RUNNING,
            status: "completed",
            rowCount: 240,
            progress: { processed: 240, total: 240 },
            file: EXPORT_READY.file,
            finishedAt: NOW,
          }),
        });
      }
      if (id === EXPORT_CREATED_ID && created.export) {
        const e = created.export;
        return json(route, 200, {
          data: advance(
            id,
            { ...e, status: "running", startedAt: NOW },
            {
              ...e,
              status: "completed",
              rowCount: 3,
              progress: { processed: 3, total: 3 },
              file: EXPORT_READY.file,
              finishedAt: NOW,
            },
          ),
        });
      }
      return err(route, 404, "NOT_FOUND", "Export not found");
    }

    // ---- Reports and usage ----
    if (method === "GET" && path.startsWith("/reports/") && path !== "/reports/overview") {
      const period = url.searchParams.get("period") ?? "30d";
      const withPeriod = <T extends { period: string }>(r: T): T => ({ ...r, period });
      switch (path) {
        case "/reports/source-breakdown":
          return json(route, 200, {
            data: withPeriod(
              empty ? { ...SOURCE_BREAKDOWN, totalBusinesses: 0, sources: [] } : SOURCE_BREAKDOWN,
            ),
          });
        case "/reports/quality-distribution":
          return json(route, 200, {
            data: withPeriod(empty ? { ...QUALITY, ...OVERVIEW_P5_EMPTY.quality } : QUALITY),
          });
        case "/reports/jobs-timeline":
          return json(route, 200, {
            data: withPeriod(
              empty
                ? {
                    ...JOBS_TIMELINE,
                    days: JOBS_TIMELINE.days.map((d) => ({
                      day: d.day,
                      created: zero,
                      failed: zero,
                    })),
                    totals: { created: zero, failed: zero },
                  }
                : JOBS_TIMELINE,
            ),
          });
        case "/reports/pipeline-funnel":
          return json(route, 200, {
            data: withPeriod(
              empty
                ? {
                    ...FUNNEL,
                    stages: FUNNEL.stages.map((s) => ({ ...s, current: 0, entered: 0 })),
                    totals: { leads: 0, open: 0, won: 0, lost: 0, winRate: null, wonValue: [] },
                  }
                : FUNNEL,
            ),
          });
        case "/reports/activity-summary":
          return json(route, 200, {
            data: withPeriod(
              empty ? { ...ACTIVITY_SUMMARY, total: 0, byType: [], byUser: [] } : ACTIVITY_SUMMARY,
            ),
          });
        default:
          return null;
      }
    }
    if (method === "GET" && path === "/usage") {
      if (opts.role === "sales_rep")
        return err(route, 403, "FORBIDDEN", "Your role cannot do this.");
      const period = (url.searchParams.get("period") ?? "30d") as UsageSummary["period"];
      if (empty) {
        const zeros = {
          credits_used: 0,
          discovery_jobs: 0,
          discovery_records: 0,
          analyses: 0,
          enrichment_runs: 0,
          exports: 0,
          export_rows: 0,
        };
        return json(route, 200, {
          data: {
            ...USAGE,
            period,
            computedAt: null,
            series: USAGE.series.map((s) => ({ day: s.day, values: zeros })),
            totals: zeros,
          },
        });
      }
      return json(route, 200, { data: { ...USAGE, period } });
    }
    return null;
  };
}
