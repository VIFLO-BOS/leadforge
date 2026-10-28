import type { Page, Route } from "@playwright/test";
import {
  BUSINESS_ID,
  COMPLETED_IMPORT,
  COMPLETED_IMPORT_ID,
  CONFLICT_ID,
  EMPTY_PAGE,
  FACETS,
  FAILED_ROWS,
  IMPORTS_PAGE,
  OBSERVATIONS,
  PREVIEW,
  PROCESSING_IMPORT,
  PROCESSING_IMPORT_ID,
  SOURCES,
  SUPPRESSED_DETAIL,
  UNKNOWN_BUSINESS_ID,
  UPLOADED_IMPORT,
  UPLOADED_IMPORT_ID,
  VERIFICATION_EVENTS,
} from "./fixtures-businesses";
import {
  ALL_JOBS,
  BALANCE,
  CATEGORIES,
  DISCOVERY_JOBS,
  DISCOVERY_ROUTES,
  DISCOVERY_SOURCES,
  ESTIMATE_BLOCKED,
  ESTIMATE_INSUFFICIENT,
  ESTIMATE_OK,
  ITEMS,
  LEDGER,
  LOCATIONS,
  NOTIFICATIONS,
  OVERTURE_REGISTRY,
  OVERVIEW_P3,
  PREFERENCES,
  QUEUED_JOB,
  RUNNING_JOB_ID,
  itemsPage,
} from "./fixtures-discovery";
import {
  ANALYSES,
  BATCH_ID,
  BUSINESS_PAGE_P4,
  CANDIDATES,
  COMPLETED_ANALYSIS,
  DETAIL_P4,
  ENRICHMENT_RUNS,
  MERGES,
  PHASE4_ROUTES,
  RUNNING_ANALYSIS,
  SCORE,
  SCORING_PROFILE,
  enrichmentRun,
  websiteAnalysis,
} from "./fixtures-phase4";
import {
  OVERVIEW_P5,
  OVERVIEW_P5_EMPTY,
  PHASE5_JOBS,
  PHASE5_ROUTES,
  SALES_REP_ID,
  createPhase5Mock,
  type Phase5Options,
} from "./fixtures-phase5";
import { PHASE6_ROUTES, createPhase6Mock, type Phase6Options } from "./fixtures-phase6";
import { STAGE10_ROUTES, createStage10Mock, type Stage10Options } from "./fixtures-stage10";
import type {
  InvitationSummary,
  MeResponse,
  MemberSummary,
  OrganizationProfile,
  PagedEnvelope,
  SessionSummary,
} from "@leadforge/contracts";

/*
 * Synthetic API fixtures for the dashboard shell. Shapes follow packages/contracts exactly; every
 * name is labelled "(Sample)" so a screenshot can never be mistaken for real data.
 */

const ORG_ID = "6f1c2a7e-3b4d-4e5f-8a9b-0c1d2e3f4a5b";
const USER_ID = "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d";
const NOW = "2026-10-25T09:00:00.000Z";

export const ME: MeResponse = {
  user: {
    id: USER_ID,
    email: "owner@example.test",
    name: "Ada Okafor (Sample)",
    emailVerifiedAt: "2026-10-01T08:00:00.000Z",
    createdAt: "2026-10-01T08:00:00.000Z",
  },
  organizations: [
    {
      id: ORG_ID,
      name: "Sample Logistics Ltd (Sample)",
      slug: "sample-logistics",
      country: "NG",
      role: "owner",
      deletionRequestedAt: null,
      purgeAfter: null,
    },
    {
      id: "7a8b9c0d-1e2f-4a3b-9c4d-5e6f7a8b9c0d",
      name: "Sample Agency (Sample)",
      slug: "sample-agency",
      country: "NG",
      role: "researcher",
      deletionRequestedAt: null,
      purgeAfter: null,
    },
  ],
};

export const PROFILE: OrganizationProfile = {
  id: ORG_ID,
  name: "Sample Logistics Ltd (Sample)",
  slug: "sample-logistics",
  country: "NG",
  defaultCurrency: "NGN",
  freshnessDays: 180,
  createdAt: "2026-10-01T08:00:00.000Z",
  memberCount: 3,
  role: "owner",
  deletionRequestedAt: null,
  purgeAfter: null,
};

export const MEMBERS: PagedEnvelope<MemberSummary> = {
  data: [
    {
      userId: USER_ID,
      email: "owner@example.test",
      name: "Ada Okafor (Sample)",
      role: "owner",
      status: "active",
      joinedAt: "2026-10-01T08:00:00.000Z",
    },
    {
      userId: "2b3c4d5e-6f7a-4b8c-9d0e-1f2a3b4c5d6e",
      email: "a-very-long-researcher-address@subdomain.example.test",
      name: "Chinedu Researcher-Okonkwo-Adeyemi (Sample)",
      role: "researcher",
      status: "active",
      joinedAt: "2026-10-03T10:00:00.000Z",
    },
    {
      userId: "3c4d5e6f-7a8b-4c9d-8e0f-2a3b4c5d6e7f",
      email: "sales@example.test",
      name: "Bisi Sales (Sample)",
      role: "sales_rep",
      status: "suspended",
      joinedAt: "2026-10-05T10:00:00.000Z",
    },
    {
      userId: SALES_REP_ID,
      email: "tunde.sales@example.test",
      name: "Tunde Sales (Sample)",
      role: "sales_rep",
      status: "active",
      joinedAt: "2026-10-06T10:00:00.000Z",
    },
  ],
  meta: { nextCursor: null, pageSize: 100 },
};

export const INVITATIONS: PagedEnvelope<InvitationSummary> = {
  data: [
    {
      id: "4d5e6f7a-8b9c-4d0e-9f1a-3b4c5d6e7f8a",
      email: "new.analyst@example.test",
      role: "analyst",
      invitedBy: { id: USER_ID, name: "Ada Okafor (Sample)" },
      expiresAt: "2026-11-01T09:00:00.000Z",
      createdAt: NOW,
    },
  ],
  meta: { nextCursor: null, pageSize: 25 },
};

export const SESSIONS: SessionSummary[] = [
  {
    id: "5e6f7a8b-9c0d-4e1f-8a2b-4c5d6e7f8a9b",
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36",
    ip: "192.0.2.10",
    createdAt: "2026-10-20T09:00:00.000Z",
    lastUsedAt: NOW,
    expiresAt: "2026-11-20T09:00:00.000Z",
    current: true,
  },
  {
    id: "6f7a8b9c-0d1e-4f2a-9b3c-5d6e7f8a9b0c",
    userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Safari/604.1",
    ip: "198.51.100.24",
    createdAt: "2026-10-18T09:00:00.000Z",
    lastUsedAt: "2026-10-24T18:00:00.000Z",
    expiresAt: "2026-11-18T09:00:00.000Z",
    current: false,
  },
];

function json(route: Route, status: number, body: unknown, headers?: Record<string, string>) {
  return route.fulfill({
    status,
    contentType: "application/json",
    body: JSON.stringify(body),
    headers,
  });
}

function paged<T>(data: T[]) {
  return { data, meta: { nextCursor: null, pageSize: 25 } };
}

export function errorBody(code: string, message: string) {
  return { error: { code, message, requestId: "e2e" } };
}

export interface MockOptions
  extends
    Omit<Phase5Options, "empty" | "role">,
    Omit<Phase6Options, "empty" | "role">,
    Omit<Stage10Options, "role"> {
  /** Role in the active (first) organization. Defaults to owner. */
  role?: MeResponse["organizations"][number]["role"];
  /** The directory and overview answer as an empty workspace. */
  empty?: boolean;
  /** Which estimate POST /discovery/jobs/estimate returns. Defaults to "ok". */
  estimate?: "ok" | "insufficient" | "blocked" | "billing";
  /** POST /discovery/jobs answers with this error instead of creating a job. */
  createError?: {
    status: number;
    code: string;
    message: string;
    details?: unknown[];
    retryAfter?: number;
  };
  /** POST /analysis/websites and POST /businesses/:id/refresh answer with this error. */
  analysisError?: { status: number; code: string; message: string; details?: unknown[] };
  /** POST /dedup/merges/:id/undo answers 409 MERGE_CONFLICT unless the body has force: true. */
  undoConflict?: boolean;
  /** PATCH /scoring/profile answers 409 CONFLICT (a stale version). */
  scoringConflict?: boolean;
}

function errorFrom(
  route: Route,
  e: { status: number; code: string; message: string; details?: unknown[] },
) {
  return json(route, e.status, {
    error: { code: e.code, message: e.message, details: e.details, requestId: "e2e" },
  });
}

/**
 * Mocks every same-origin API call the dashboard makes, so shell pages render fully without a
 * backend. Unknown endpoints answer with a 404 envelope, which pages must handle.
 */
export async function mockWorkspaceApi(page: Page, opts: MockOptions = {}): Promise<void> {
  const me: MeResponse =
    opts.role && opts.role !== "owner"
      ? {
          ...ME,
          organizations: ME.organizations.map((o, i) => (i === 0 ? { ...o, role: opts.role! } : o)),
        }
      : ME;
  const phase5 = createPhase5Mock({ ...opts, empty: opts.empty, role: opts.role });
  const phase6 = createPhase6Mock({ ...opts, empty: opts.empty, role: opts.role });
  const stage10 = createStage10Mock({ ...opts, role: opts.role });
  await page.route("**/api/v1/**", (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname.replace(/^\/api\/v1/, "");
    const method = route.request().method();
    // Stage 10 first: the deletion state, the organization export, and the work a pending deletion refuses.
    const lifecycle = stage10.handle(route, url, path, method);
    if (lifecycle) return lifecycle;

    if (method === "GET") {
      if (path === "/auth/me") return json(route, 200, { data: stage10.me(me) });
      if (path === "/auth/sessions") return json(route, 200, { data: SESSIONS });
      if (path === "/organizations/current")
        return json(route, 200, { data: stage10.profile(PROFILE) });
      if (path === "/organizations/current/members") return json(route, 200, MEMBERS);
      if (path === "/organizations/current/invitations") return json(route, 200, INVITATIONS);

      if (path === "/businesses")
        return json(route, 200, opts.empty ? EMPTY_PAGE : BUSINESS_PAGE_P4);
      if (path === "/businesses/facets") {
        return json(route, 200, {
          data: opts.empty
            ? {
                ...FACETS,
                total: 0,
                categories: [],
                regions: [],
                localities: [],
                sources: [],
                whatsapp: [],
              }
            : FACETS,
        });
      }
      if (path === `/businesses/${BUSINESS_ID}`) return json(route, 200, { data: DETAIL_P4 });

      // Phase 4: website analysis, enrichment, scoring and duplicate review.
      if (path === "/analysis/websites") {
        const statuses = url.searchParams.getAll("status");
        const opps = url.searchParams.getAll("opportunity");
        const batchId = url.searchParams.get("batchId");
        const businessId = url.searchParams.get("businessId");
        const list = opts.empty
          ? []
          : ANALYSES.filter(
              (a) =>
                (!statuses.length || statuses.includes(a.status)) &&
                (!opps.length || a.opportunities.some((o) => opps.includes(o.key))) &&
                (!batchId || a.batchId === batchId) &&
                (!businessId || a.businessId === businessId),
            );
        return json(route, 200, paged(list));
      }
      const analysisMatch = /^\/analysis\/websites\/([a-f0-9]{24})$/.exec(path);
      if (analysisMatch) {
        const a = ANALYSES.find((x) => x.id === analysisMatch[1]);
        return a
          ? json(route, 200, { data: a })
          : json(route, 404, errorBody("NOT_FOUND", "Website analysis not found"));
      }
      if (/^\/businesses\/[a-f0-9]{24}\/analysis$/.test(path)) {
        return json(route, 200, { data: path.includes(BUSINESS_ID) ? COMPLETED_ANALYSIS : null });
      }
      if (/^\/businesses\/[a-f0-9]{24}\/enrichment-runs$/.test(path)) {
        return json(route, 200, paged(path.includes(BUSINESS_ID) ? ENRICHMENT_RUNS : []));
      }
      if (/^\/businesses\/[a-f0-9]{24}\/score$/.test(path)) {
        return json(route, 200, { data: path.includes(BUSINESS_ID) ? SCORE : null });
      }
      if (path === "/scoring/profile") return json(route, 200, { data: SCORING_PROFILE });
      if (path === "/dedup/candidates") {
        const statuses = url.searchParams.getAll("status");
        const businessId = url.searchParams.get("businessId");
        const wanted = statuses.length ? statuses : ["pending"];
        const list = opts.empty
          ? []
          : CANDIDATES.filter(
              (c) =>
                wanted.includes(c.status) && (!businessId || c.businessIds.includes(businessId)),
            );
        return json(route, 200, paged(list));
      }
      const candidateMatch = /^\/dedup\/candidates\/([a-f0-9]{24})$/.exec(path);
      if (candidateMatch) {
        const c = CANDIDATES.find((x) => x.id === candidateMatch[1]);
        return c
          ? json(route, 200, { data: c })
          : json(route, 404, errorBody("NOT_FOUND", "Candidate not found"));
      }
      if (path === "/dedup/merges") {
        const businessId = url.searchParams.get("businessId");
        const list = opts.empty
          ? []
          : MERGES.filter(
              (m) => !businessId || m.survivorId === businessId || m.mergedIds.includes(businessId),
            );
        return json(route, 200, paged(list));
      }
      if (path === `/businesses/${CONFLICT_ID}`)
        return json(route, 200, { data: SUPPRESSED_DETAIL });
      if (/^\/businesses\/[a-f0-9]{24}\/observations$/.test(path)) {
        return json(route, 200, { data: OBSERVATIONS, meta: { nextCursor: null, pageSize: 25 } });
      }
      if (/^\/businesses\/[a-f0-9]{24}\/verification-events$/.test(path)) {
        return json(route, 200, {
          data: VERIFICATION_EVENTS,
          meta: { nextCursor: null, pageSize: 25 },
        });
      }
      if (/^\/businesses\/[a-f0-9]{24}$/.test(path)) {
        return json(route, 404, errorBody("NOT_FOUND", "Business not found"));
      }
      if (path === "/imports") return json(route, 200, IMPORTS_PAGE);
      if (path === `/imports/${UPLOADED_IMPORT_ID}`)
        return json(route, 200, { data: UPLOADED_IMPORT });
      if (path === `/imports/${PROCESSING_IMPORT_ID}`)
        return json(route, 200, { data: PROCESSING_IMPORT });
      if (path === `/imports/${COMPLETED_IMPORT_ID}`)
        return json(route, 200, { data: COMPLETED_IMPORT });
      if (path === `/imports/${COMPLETED_IMPORT_ID}/rows`) return json(route, 200, FAILED_ROWS);
      if (path === "/sources") return json(route, 200, paged([...SOURCES, OVERTURE_REGISTRY]));

      // Phase 3: discovery, jobs, credits, notifications.
      if (path === "/discovery/sources") return json(route, 200, paged(DISCOVERY_SOURCES));
      if (path === "/discovery/categories") {
        const q = (url.searchParams.get("q") ?? "").toLowerCase();
        return json(
          route,
          200,
          paged(CATEGORIES.filter((c) => c.label.toLowerCase().startsWith(q))),
        );
      }
      if (path === "/discovery/locations") return json(route, 200, { data: LOCATIONS });
      if (path === "/discovery/jobs") {
        const statuses = url.searchParams.getAll("status");
        const jobs = opts.empty
          ? []
          : DISCOVERY_JOBS.filter((j) => !statuses.length || statuses.includes(j.status));
        return json(route, 200, paged(jobs));
      }
      const jobMatch = /^\/discovery\/jobs\/([a-f0-9]{24})(\/items)?$/.exec(path);
      if (jobMatch) {
        const job = DISCOVERY_JOBS.find((j) => j.id === jobMatch[1]);
        if (!job) return json(route, 404, errorBody("NOT_FOUND", "Discovery job not found"));
        if (!jobMatch[2]) return json(route, 200, { data: job });
        const outcomes = url.searchParams.getAll("outcome");
        const items = job.id === QUEUED_JOB.id ? [] : ITEMS;
        return json(
          route,
          200,
          itemsPage(items.filter((i) => !outcomes.length || outcomes.includes(i.outcome))),
        );
      }
      if (path === "/jobs") {
        const kinds = url.searchParams.getAll("kind");
        const jobs = opts.empty
          ? []
          : [...PHASE5_JOBS, ...ALL_JOBS].filter((j) => !kinds.length || kinds.includes(j.kind));
        return json(route, 200, paged(jobs));
      }
      if (path === "/credits/balance") return json(route, 200, { data: BALANCE });
      if (path === "/credits/ledger") {
        if (me.organizations[0]?.role === "sales_rep") {
          return json(route, 403, errorBody("FORBIDDEN", "Your role cannot do this."));
        }
        return json(route, 200, paged(opts.empty ? [] : LEDGER));
      }
      if (path === "/notifications/unread-count") {
        const unread = opts.empty ? 0 : NOTIFICATIONS.filter((n) => !n.readAt).length;
        return json(route, 200, { data: { unread } });
      }
      if (path === "/notifications") {
        const unread = url.searchParams.get("unread") === "true";
        const list = opts.empty ? [] : NOTIFICATIONS.filter((n) => !unread || !n.readAt);
        return json(route, 200, paged(list));
      }
      if (path === "/notifications/preferences") return json(route, 200, { data: PREFERENCES });

      if (path === "/reports/overview") {
        return json(route, 200, {
          data: opts.empty
            ? {
                ...OVERVIEW_P3,
                businesses: { total: 0, suppressed: 0, addedInPeriod: 0 },
                contacts: {
                  withPhone: 0,
                  withEmail: 0,
                  withWebsite: 0,
                  verifiedPhone: 0,
                  verifiedEmail: 0,
                  verifiedWebsite: 0,
                  whatsappConfirmed: 0,
                  whatsappUserAsserted: 0,
                },
                sources: [],
                imports: { total: 0, inProgress: 0, recent: [] },
                discovery: {
                  total: 0,
                  inProgress: 0,
                  completedInPeriod: 0,
                  failedInPeriod: 0,
                  recent: [],
                },
                ...OVERVIEW_P5_EMPTY,
              }
            : { ...OVERVIEW_P3, ...OVERVIEW_P5 },
        });
      }
    }
    if (method === "POST" && path === "/discovery/jobs/estimate") {
      const est =
        opts.estimate === "insufficient"
          ? ESTIMATE_INSUFFICIENT
          : opts.estimate === "blocked"
            ? ESTIMATE_BLOCKED
            : opts.estimate === "billing"
              ? {
                  ...ESTIMATE_OK,
                  blockers: [
                    {
                      code: "ENTITLEMENT_REQUIRED",
                      source: null,
                      message:
                        "Your plan does not include discovery. Change the plan on the Billing page.",
                    },
                    {
                      code: "CREDIT_BALANCE_NEGATIVE",
                      source: null,
                      message:
                        "The credit balance is -120 after a refund or reversal. Buy credits to bring it above zero.",
                    },
                  ],
                }
              : ESTIMATE_OK;
      return json(route, 200, { data: est });
    }
    if (method === "POST" && path === "/discovery/jobs") {
      const e = opts.createError;
      if (e) {
        return json(
          route,
          e.status,
          { error: { code: e.code, message: e.message, details: e.details, requestId: "e2e" } },
          e.retryAfter !== undefined ? { "retry-after": String(e.retryAfter) } : undefined,
        );
      }
      return json(route, 201, { data: QUEUED_JOB });
    }
    if (method === "POST" && /^\/discovery\/jobs\/[a-f0-9]{24}\/cancel$/.test(path)) {
      const job = DISCOVERY_JOBS.find((j) => path.includes(j.id));
      return json(route, 200, { data: { ...job, cancelRequested: true } });
    }
    if (method === "POST" && path === "/analysis/websites") {
      if (opts.analysisError) return errorFrom(route, opts.analysisError);
      const body = route.request().postDataJSON() as {
        businessId?: string;
        businessIds?: string[];
      };
      if (body.businessId) {
        const queued = websiteAnalysis({
          id: "6add8b76520012303c64a0aa",
          businessId: body.businessId,
          status: "queued",
          fetched: null,
          pagesVisited: [],
          credits: { held: 1, captured: 0, released: 0, settled: false },
          startedAt: null,
          analyzedAt: null,
          finishedAt: null,
        });
        return json(route, 202, {
          data: {
            analyses: [queued],
            alreadyInProgress: [],
            skipped: [],
            batchId: null,
            credits: { held: 1 },
          },
        });
      }
      const ids = body.businessIds ?? [];
      const [skip, ...rest] = ids;
      const started = rest.map((id, i) =>
        websiteAnalysis({
          id: `6add8b76520012303c64a1${(i + 16).toString(16).padStart(2, "0")}`,
          businessId: id,
          status: "queued",
          batchId: BATCH_ID,
          trigger: "bulk",
          credits: { held: 1, captured: 0, released: 0, settled: false },
        }),
      );
      return json(route, 202, {
        data: {
          analyses: [...started, RUNNING_ANALYSIS],
          alreadyInProgress: [RUNNING_ANALYSIS.id],
          skipped: skip
            ? [
                {
                  businessId: skip,
                  code: "WEBSITE_MISSING",
                  message: "The business has no website on record",
                },
              ]
            : [],
          batchId: BATCH_ID,
          credits: { held: started.length },
        },
      });
    }
    if (method === "POST" && /^\/businesses\/[a-f0-9]{24}\/refresh$/.test(path)) {
      if (opts.analysisError) return errorFrom(route, opts.analysisError);
      const run = enrichmentRun({
        id: "6add8b76520012303c64f0aa",
        status: "queued",
        trigger: "refresh",
        startedAt: null,
        finishedAt: null,
      });
      return json(route, 202, {
        data: {
          enrichmentRun: run,
          analysis: { ...COMPLETED_ANALYSIS, status: "queued", trigger: "refresh" },
          analysisAlreadyInProgress: false,
        },
      });
    }
    if (
      method === "POST" &&
      /^\/enrichment\/businesses\/[a-f0-9]{24}\/(website-contacts|check-email)$/.test(path)
    ) {
      if (opts.analysisError) return errorFrom(route, opts.analysisError);
      const email = path.endsWith("check-email");
      const body = email ? (route.request().postDataJSON() as { address: string }) : null;
      return json(route, 202, {
        data: enrichmentRun({
          id: email ? "6add8b76520012303c64f0ab" : "6add8b76520012303c64f0ac",
          kind: email ? "email_check" : "website_contacts",
          status: "queued",
          input: {
            url: email ? null : "https://mamaput.example.test",
            address: body?.address ?? null,
          },
          startedAt: null,
          finishedAt: null,
        }),
      });
    }
    if (method === "PATCH" && path === "/scoring/profile") {
      if (opts.scoringConflict) {
        return json(
          route,
          409,
          errorBody("CONFLICT", "The scoring profile changed; reload it and try again."),
        );
      }
      const body = route.request().postDataJSON() as {
        version: number;
        weights?: Record<string, number>;
        icp?: typeof SCORING_PROFILE.icp;
      };
      const sum = Object.values(body.weights ?? SCORING_PROFILE.weights).reduce((a, b) => a + b, 0);
      if (sum !== 100) {
        return json(route, 400, {
          error: {
            code: "VALIDATION_FAILED",
            message: "Invalid",
            details: [
              { path: "weights", message: `Weights must add up to 100 (they add up to ${sum})` },
            ],
            requestId: "e2e",
          },
        });
      }
      return json(route, 200, {
        data: {
          ...SCORING_PROFILE,
          weights: { ...SCORING_PROFILE.weights, ...body.weights },
          icp: body.icp
            ? {
                categories: body.icp.categories,
                locations: body.icp.locations.map((l) => ({
                  country: l.country ?? null,
                  region: l.region ?? null,
                  locality: l.locality ?? null,
                })),
              }
            : SCORING_PROFILE.icp,
          version: body.version + 1,
          recompute: {
            ...SCORING_PROFILE.recompute,
            status: "completed",
            profileVersion: body.version + 1,
            finishedAt: new Date().toISOString(),
          },
        },
      });
    }
    if (method === "POST" && path === "/scoring/recompute") {
      return json(route, 202, { data: SCORING_PROFILE });
    }
    const decision = /^\/dedup\/candidates\/([a-f0-9]{24})\/(merge|reject|defer)$/.exec(path);
    if (method === "POST" && decision) {
      const c = CANDIDATES.find((x) => x.id === decision[1]);
      if (!c) return json(route, 404, errorBody("NOT_FOUND", "Candidate not found"));
      if (decision[2] === "merge") {
        const body = route.request().postDataJSON() as { survivorId: string };
        return json(route, 200, {
          data: {
            merge: {
              ...MERGES[0],
              id: "6add8b76520012303c64e0aa",
              candidateId: c.id,
              survivorId: body.survivorId,
              mergedIds: c.businessIds.filter((id) => id !== body.survivorId),
            },
            candidate: { ...c, status: "merged", mergeId: "6add8b76520012303c64e0aa" },
          },
        });
      }
      return json(route, 200, {
        data: { ...c, status: decision[2] === "reject" ? "rejected" : "deferred" },
      });
    }
    const undo = /^\/dedup\/merges\/([a-f0-9]{24})\/undo$/.exec(path);
    if (method === "POST" && undo) {
      const m = MERGES.find((x) => x.id === undo[1]);
      if (!m) return json(route, 404, errorBody("NOT_FOUND", "Merge not found"));
      const body = (route.request().postDataJSON() ?? {}) as { force?: boolean };
      if (opts.undoConflict && !body.force) {
        return json(
          route,
          409,
          errorBody(
            "MERGE_CONFLICT",
            "A record changed after the merge; undo with force to discard those changes.",
          ),
        );
      }
      return json(route, 200, {
        data: {
          ...m,
          status: "undone",
          undoneAt: new Date().toISOString(),
          undoneByUserId: ME.user.id,
          undoForced: Boolean(body.force),
          canUndo: false,
        },
      });
    }
    if (method === "POST" && path === "/dedup/scan") {
      return json(route, 202, { data: { queued: true, scope: "organization", businesses: null } });
    }
    if (method === "POST" && /^\/notifications\/[a-f0-9]{24}\/read$/.test(path)) {
      const n = NOTIFICATIONS.find((x) => path.includes(x.id));
      return json(route, 200, { data: { ...n, readAt: new Date().toISOString() } });
    }
    if (method === "POST" && path === "/notifications/read-all") {
      return json(route, 200, { data: { updated: 2 } });
    }
    if (method === "PUT" && path === "/notifications/preferences") {
      const body = route.request().postDataJSON() as Partial<typeof PREFERENCES>;
      return json(route, 200, { data: { ...PREFERENCES, ...body } });
    }
    if (method === "PATCH" && /^\/sources\/[a-z_]+$/.test(path)) {
      const body = route.request().postDataJSON() as { enabled: boolean };
      return json(route, 200, { data: { ...OVERTURE_REGISTRY, enabled: body.enabled } });
    }

    if (method === "POST" && path === `/imports/${UPLOADED_IMPORT_ID}/preview`) {
      return json(route, 200, { data: PREVIEW });
    }
    const billing = phase6(route, url, path, method);
    if (billing) return billing;
    const handled = phase5(route, url, path, method);
    if (handled) return handled;
    return json(route, 404, errorBody("NOT_FOUND", "Not available in the e2e fixture."));
  });
}

/** The invitation preview fails, so the invite page shows its error state. */
export async function mockMissingInvitation(page: Page): Promise<void> {
  await page.route("**/api/v1/invitations/**", (route) =>
    json(route, 404, errorBody("NOT_FOUND", "Invitation not found")),
  );
}

/** Session probe answers 401, as it does for a signed-out visitor. */
export async function mockSignedOut(page: Page): Promise<void> {
  await page.route("**/api/v1/auth/me", (route) =>
    json(route, 401, errorBody("UNAUTHENTICATED", "Sign in required")),
  );
}

export const MARKETING_ROUTES = [
  "/legal/data-sources",
  "/",
  "/product",
  "/pricing",
  "/about",
  "/contact",
  "/legal/privacy",
  "/legal/terms",
  "/legal/acceptable-use",
  "/legal/data-collection",
] as const;

export const AUTH_ROUTES = [
  "/sign-in",
  "/sign-up",
  "/verify-email",
  "/forgot-password",
  "/reset-password",
  "/reset-password?token=sample-token",
  "/invite/sample-token",
] as const;

export const SHELL_ROUTES = [
  "/app",
  "/app/team",
  "/app/settings",
  "/app/settings?tab=security",
] as const;

/** Phase 2 pages: directory, detail (tabs, conflicts, suppression, 404), import steps, sources. */
export const BUSINESS_ROUTES = [
  "/app/businesses",
  "/app/businesses?region=lagos&phoneState=verified&suppression=include&q=mama",
  `/app/businesses/${BUSINESS_ID}`,
  `/app/businesses/${BUSINESS_ID}?tab=provenance`,
  `/app/businesses/${BUSINESS_ID}?tab=verification`,
  `/app/businesses/${CONFLICT_ID}`,
  `/app/businesses/${UNKNOWN_BUSINESS_ID}`,
  "/app/businesses/import",
  `/app/businesses/import?id=${UPLOADED_IMPORT_ID}`,
  `/app/businesses/import?id=${PROCESSING_IMPORT_ID}`,
  `/app/businesses/import?id=${COMPLETED_IMPORT_ID}`,
  "/app/sources",
] as const;

/** Phase 3 pages: discovery list, wizard, job detail states, all jobs, usage, notification settings. */
export { DISCOVERY_ROUTES, RUNNING_JOB_ID };

/** Phase 4 pages: analyses, analysis detail states, business tabs, duplicates, scoring settings. */
export { PHASE4_ROUTES };

/** Phase 5 pages: pipeline, lists, activities, outreach, reports, bulk and export jobs. */
export { PHASE5_ROUTES };

/** Phase 6 pages: billing (overview, plans, payments, invoices, the return page) and pipeline stages. */
export { PHASE6_ROUTES };

/** Stage 10: Settings, Organization with "Data and deletion". */
export { STAGE10_ROUTES };

export {
  BUSINESS_ID,
  CONFLICT_ID,
  UNKNOWN_BUSINESS_ID,
  UPLOADED_IMPORT_ID,
  PROCESSING_IMPORT_ID,
  COMPLETED_IMPORT_ID,
};

/** Fails the test if the page is wider than the viewport. */
export async function horizontalOverflow(page: Page) {
  return page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth,
  }));
}
