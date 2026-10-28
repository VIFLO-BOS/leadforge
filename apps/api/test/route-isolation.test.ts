import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { Worker, type Job } from "bullmq";
import { Redis } from "ioredis";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Collections, EJSON, MongoService, ObjectId } from "@leadforge/db-mongo";
import { CSRF_HEADER, ORGANIZATION_HEADER, type Permission } from "@leadforge/contracts";
import {
  AnalysisQueueHandler,
  BillingQueueHandler,
  BulkQueueHandler,
  DedupQueueHandler,
  DiscoveryQueueHandler,
  EnrichmentQueueHandler,
  ExportQueueHandler,
  ImportsService,
  OrganizationExportQueueHandler,
  OrganizationPurgeService,
  PaymentSettlementService,
  QueueNames,
  ScoringQueueHandler,
} from "@leadforge/core";
import {
  addMember,
  API,
  createHarness,
  csrfFrom,
  orgHeaders,
  TEST_QUEUE_PREFIX,
  type Harness,
} from "./harness.js";
import { createOwner, csvBuffer, seedBusinesses, uploadCsv, type OrgUser } from "./fixtures.js";
import { createJob, DISCOVERY_TEST_ENV, grant, spec, type Json } from "./discovery-helpers.js";
import { forgetOverture, seedOverture } from "./overture-helpers.js";
import { startPhase4Workers, waitFor } from "./phase4-helpers.js";
import { download, isTerminal, navigate, pollUntil, startPhase5Workers } from "./phase5-helpers.js";
import {
  billingEnv,
  startFakePaystack,
  transactionData,
  type FakePaystack,
} from "./paystack-fake.js";
import { createPack } from "./billing-helpers.js";
import { discoverRoutes, type DiscoveredRoute } from "./route-table.js";

/**
 * Route-level tenant isolation and access policy, systematically (docs/SECURITY_AND_DATA_COLLECTION.md
 * section 3, Phase 7). The route list comes from Nest's own controller metadata; ROUTES below must
 * classify every one of them, so a new route fails this suite until someone decides how it is
 * scoped, what it needs, and how another organization is kept out of it.
 *
 * Organization A ("victim") gets one of every resource. Organization B ("attacker") then:
 * - calls every route that takes an id with A's ids and gets 404 (403 where documented);
 * - calls every list, aggregate and report and never sees A's ids, names or members;
 * - names A in X-Organization-Id on every organization route and gets 403 ORG_FORBIDDEN;
 * and every non-public route refuses anonymous callers, every state-changing route outside the
 * CSRF exemptions refuses a request without the session's CSRF token, and A's stored data is
 * byte-for-byte unchanged afterwards. Every queue job type is classified the same way (JOBS,
 * checked against QueueJobMap in packages/core): each organization-scoped processor is handed a
 * payload naming B's organization and A's resource and must refuse it or find nothing.
 */

type Policy = "public" | "auth" | Permission | Permission[];

interface Ids {
  biz: string;
  twin: string;
  importId: string;
  job: string;
  analysis: string;
  run: string;
  candidate: string;
  merge: string;
  lead: string;
  list: string;
  activity: string;
  outreach: string;
  bulk: string;
  exportId: string;
  invitation: string;
  member: string;
  session: string;
  notification: string;
  paymentRef: string;
  paymentId: string;
  invoice: string;
  /** Stage 10: A's organization data export. */
  orgExport: string;
}

/** One request B makes with A's identifiers. `expect` defaults to [404]. */
interface Probe {
  path: (i: Ids) => string;
  body?: (i: Ids) => object;
  headers?: () => Record<string, string>;
  expect?: number[];
}

type Entry =
  /** No authentication: public pages, auth flows, health, licences, the signed webhook, metrics. */
  | { scope: "public"; policy: "public"; why: string }
  /** Signed-in user, no organization header: the caller's own account, sessions and signed links. */
  | { scope: "user"; policy: "auth"; probes: Probe[]; why: string }
  /** Organization data. `probes` name A's resources; `list` routes must never show A's data; `own` explains routes that cannot name another organization. */
  | { scope: "org"; policy: Policy; probes?: Probe[]; list?: true; own?: string };

const key = () => ({ "Idempotency-Key": randomUUID() });
const READ: Policy = "businesses:read";
const WRITE: Policy = "businesses:write";
const LISTS: Policy = ["lists:manage", "lists:manage_own"];
const EXPORTS: Policy = ["exports:create", "exports:create_assigned"];
const BULK: Policy = ["lists:manage", "lists:manage_own", "leads:assign", "pipeline:write"];
const id = (path: (i: Ids) => string, extra: Omit<Probe, "path"> = {}): Probe => ({
  path,
  ...extra,
});

/** Every route the API serves. Keys are `METHOD /path` exactly as Nest registers them. */
const ROUTES: Record<string, Entry> = {
  // Health, public pages, licences, metrics
  "GET /api/v1/health/live": { scope: "public", policy: "public", why: "liveness" },
  "GET /api/v1/health/ready": {
    scope: "public",
    policy: "public",
    why: "readiness (dependency status only)",
  },
  "GET /api/v1/public/data-licenses": {
    scope: "public",
    policy: "public",
    why: "licence texts must reach anyone receiving data",
  },
  "GET /api/v1/public/data-licenses/:id": {
    scope: "public",
    policy: "public",
    why: "licence text",
  },
  "GET /api/v1/public/data-licenses/notices/foursquare": {
    scope: "public",
    policy: "public",
    why: "Apache-2.0 NOTICE",
  },
  "GET /api/v1/public/plans": { scope: "public", policy: "public", why: "marketing pricing" },
  "GET /api/v1/public/sources": { scope: "public", policy: "public", why: "marketing source list" },
  "POST /api/v1/public/contact": {
    scope: "public",
    policy: "public",
    why: "contact form (3 per hour per IP)",
  },
  "GET /metrics": {
    scope: "public",
    policy: "public",
    why: "Prometheus; token or loopback check inside the handler",
  },
  "POST /api/v1/webhooks/paystack": {
    scope: "public",
    policy: "public",
    why: "HMAC-signed by Paystack",
  },
  // Authentication
  "POST /api/v1/auth/register": { scope: "public", policy: "public", why: "sign-up" },
  "POST /api/v1/auth/login": {
    scope: "public",
    policy: "public",
    why: "sign-in (per-IP and per-account limits)",
  },
  "POST /api/v1/auth/refresh": {
    scope: "public",
    policy: "public",
    why: "refresh cookie is the credential",
  },
  "POST /api/v1/auth/verify-email": {
    scope: "public",
    policy: "public",
    why: "one-time token is the credential",
  },
  "POST /api/v1/auth/forgot-password": { scope: "public", policy: "public", why: "always 202" },
  "POST /api/v1/auth/reset-password": {
    scope: "public",
    policy: "public",
    why: "one-time token is the credential",
  },
  "GET /api/v1/invitations/:token": {
    scope: "public",
    policy: "public",
    why: "invitation preview; token is the credential",
  },
  "GET /api/v1/auth/me": { scope: "user", policy: "auth", probes: [], why: "the caller only" },
  "GET /api/v1/auth/sessions": {
    scope: "user",
    policy: "auth",
    probes: [],
    why: "the caller's sessions only",
  },
  "DELETE /api/v1/auth/sessions/:id": {
    scope: "user",
    policy: "auth",
    probes: [id((i) => `/auth/sessions/${i.session}`)],
    why: "another user's session is 404",
  },
  "POST /api/v1/auth/logout": {
    scope: "user",
    policy: "auth",
    probes: [],
    why: "the caller's session",
  },
  "POST /api/v1/auth/resend-verification": {
    scope: "user",
    policy: "auth",
    probes: [],
    why: "the caller's address",
  },
  "POST /api/v1/invitations/:token/accept": {
    scope: "user",
    policy: "auth",
    probes: [],
    why: "accept needs the invited address; probed separately with A's real token",
  },
  "GET /api/v1/exports/:id/download": {
    scope: "user",
    policy: "auth",
    probes: [],
    why: "signed link bound to org, export and user; probed with A's real link",
  },
  "GET /api/v1/billing/invoices/:id/download": {
    scope: "user",
    policy: "auth",
    probes: [],
    why: "signed link bound to org, invoice and user; probed with A's real link",
  },
  "GET /api/v1/organizations/current/data-exports/:id/download": {
    scope: "user",
    policy: "auth",
    probes: [],
    why: "signed link bound to org, organization export and owner; probed with A's real link",
  },
  // Organization and members
  "GET /api/v1/organizations/current": { scope: "org", policy: READ, list: true },
  "PATCH /api/v1/organizations/current": {
    scope: "org",
    policy: "organization:settings",
    own: "edits the header's organization only",
  },
  "GET /api/v1/organizations/current/members": { scope: "org", policy: READ, list: true },
  "PATCH /api/v1/organizations/current/members/:userId": {
    scope: "org",
    policy: "members:manage",
    probes: [
      id((i) => `/organizations/current/members/${i.member}`, {
        body: () => ({ role: "analyst" }),
      }),
    ],
  },
  "DELETE /api/v1/organizations/current/members/:userId": {
    scope: "org",
    policy: "members:manage",
    probes: [id((i) => `/organizations/current/members/${i.member}`)],
  },
  "GET /api/v1/organizations/current/invitations": {
    scope: "org",
    policy: "members:manage",
    list: true,
  },
  "POST /api/v1/organizations/current/invitations": {
    scope: "org",
    policy: "members:manage",
    own: "invites into the header's organization only",
  },
  "DELETE /api/v1/organizations/current/invitations/:id": {
    scope: "org",
    policy: "members:manage",
    probes: [id((i) => `/organizations/current/invitations/${i.invitation}`)],
  },
  "POST /api/v1/organizations/current/deletion-requests": {
    scope: "org",
    policy: "organization:delete",
    own: "requests deletion of the header's organization only",
  },
  "DELETE /api/v1/organizations/current/deletion-requests": {
    scope: "org",
    policy: "organization:delete",
    own: "cancels the header's organization's pending deletion only",
  },
  // Stage 10: whole-organization data export (owner only)
  "POST /api/v1/organizations/current/data-exports": {
    scope: "org",
    policy: "organization:export",
    own: "exports the header's organization only",
  },
  "GET /api/v1/organizations/current/data-exports": {
    scope: "org",
    policy: "organization:export",
    list: true,
  },
  "GET /api/v1/organizations/current/data-exports/:id": {
    scope: "org",
    policy: "organization:export",
    probes: [id((i) => `/organizations/current/data-exports/${i.orgExport}`)],
  },
  "GET /api/v1/organizations/current/data-exports/:id/download-url": {
    scope: "org",
    policy: "organization:export",
    probes: [id((i) => `/organizations/current/data-exports/${i.orgExport}/download-url`)],
  },
  // Businesses
  "GET /api/v1/businesses": {
    scope: "org",
    policy: READ,
    list: true,
    probes: [
      id((i) => `/businesses?importId=${i.importId}`),
      // Stage 8: an id selection naming A's businesses matches nothing (200, empty), like unknown ids.
      id((i) => `/businesses?ids=${i.biz},${i.twin}&suppression=include`, { expect: [200] }),
    ],
  },
  "GET /api/v1/businesses/facets": { scope: "org", policy: READ, list: true },
  "POST /api/v1/businesses": {
    scope: "org",
    policy: WRITE,
    own: "creates in the header's organization",
  },
  "POST /api/v1/businesses/suppress": {
    scope: "org",
    policy: WRITE,
    probes: [
      id(() => "/businesses/suppress", {
        body: (i) => ({ ids: [i.biz], scope: "business", reason: "Cross-organization probe" }),
        expect: [200],
      }),
    ],
  },
  "GET /api/v1/businesses/:id": {
    scope: "org",
    policy: READ,
    probes: [id((i) => `/businesses/${i.biz}`)],
  },
  "PATCH /api/v1/businesses/:id": {
    scope: "org",
    policy: WRITE,
    probes: [
      id((i) => `/businesses/${i.biz}`, { body: () => ({ field: "name", value: "Hijacked" }) }),
    ],
  },
  "GET /api/v1/businesses/:id/observations": {
    scope: "org",
    policy: READ,
    probes: [id((i) => `/businesses/${i.biz}/observations`)],
  },
  "GET /api/v1/businesses/:id/verification-events": {
    scope: "org",
    policy: READ,
    probes: [id((i) => `/businesses/${i.biz}/verification-events`)],
  },
  "POST /api/v1/businesses/:id/suppress": {
    scope: "org",
    policy: WRITE,
    probes: [
      id((i) => `/businesses/${i.biz}/suppress`, {
        body: () => ({ scope: "business", reason: "cross org" }),
      }),
    ],
  },
  "DELETE /api/v1/businesses/:id/suppression": {
    scope: "org",
    policy: WRITE,
    probes: [id((i) => `/businesses/${i.biz}/suppression`)],
  },
  "GET /api/v1/businesses/:id/analysis": {
    scope: "org",
    policy: READ,
    probes: [id((i) => `/businesses/${i.biz}/analysis`)],
  },
  "GET /api/v1/businesses/:id/enrichment-runs": {
    scope: "org",
    policy: READ,
    probes: [id((i) => `/businesses/${i.biz}/enrichment-runs`)],
  },
  "GET /api/v1/businesses/:id/score": {
    scope: "org",
    policy: READ,
    probes: [id((i) => `/businesses/${i.biz}/score`)],
  },
  "POST /api/v1/businesses/:id/refresh": {
    scope: "org",
    policy: "analysis:run",
    probes: [id((i) => `/businesses/${i.biz}/refresh`)],
  },
  // Imports
  "POST /api/v1/imports": {
    scope: "org",
    policy: WRITE,
    own: "uploads into the header's organization",
  },
  "GET /api/v1/imports": { scope: "org", policy: READ, list: true },
  "GET /api/v1/imports/:id": {
    scope: "org",
    policy: READ,
    probes: [id((i) => `/imports/${i.importId}`)],
  },
  "GET /api/v1/imports/:id/rows": {
    scope: "org",
    policy: READ,
    probes: [id((i) => `/imports/${i.importId}/rows`)],
  },
  "POST /api/v1/imports/:id/preview": {
    scope: "org",
    policy: WRITE,
    probes: [
      id((i) => `/imports/${i.importId}/preview`, {
        body: () => ({ mapping: [{ column: 0, field: "name" }] }),
      }),
    ],
  },
  "POST /api/v1/imports/:id/commit": {
    scope: "org",
    policy: WRITE,
    probes: [
      id((i) => `/imports/${i.importId}/commit`, {
        body: () => ({ mapping: [{ column: 0, field: "name" }], attestLawfulBasis: true }),
      }),
    ],
  },
  // Exports
  "POST /api/v1/exports/businesses": {
    scope: "org",
    policy: EXPORTS,
    probes: [
      id(() => "/exports/businesses", {
        body: (i) => ({ ids: [i.biz, i.twin], columns: ["name"] }),
        expect: [200],
      }),
      id(() => "/exports/businesses", { body: (i) => ({ filter: { importId: i.importId } }) }),
    ],
  },
  "POST /api/v1/exports": {
    scope: "org",
    policy: EXPORTS,
    probes: [id(() => "/exports", { body: (i) => ({ kind: "list", listId: i.list }) })],
  },
  "GET /api/v1/exports": { scope: "org", policy: EXPORTS, list: true },
  "GET /api/v1/exports/:id": {
    scope: "org",
    policy: EXPORTS,
    probes: [id((i) => `/exports/${i.exportId}`)],
  },
  "GET /api/v1/exports/:id/download-url": {
    scope: "org",
    policy: EXPORTS,
    probes: [id((i) => `/exports/${i.exportId}/download-url`)],
  },
  // Sources and discovery
  "GET /api/v1/sources": { scope: "org", policy: READ, list: true },
  "PATCH /api/v1/sources/:key": {
    scope: "org",
    policy: "settings:sources",
    own: "per-organization source switch of the header's organization",
  },
  "GET /api/v1/discovery/sources": { scope: "org", policy: READ, list: true },
  "GET /api/v1/discovery/categories": { scope: "org", policy: READ, list: true },
  "GET /api/v1/discovery/locations": { scope: "org", policy: READ, list: true },
  "POST /api/v1/discovery/jobs/estimate": {
    scope: "org",
    policy: "discovery:run",
    own: "estimates against the caller's directory and balance",
  },
  "POST /api/v1/discovery/jobs": {
    scope: "org",
    policy: "discovery:run",
    own: "creates in the header's organization",
  },
  "GET /api/v1/discovery/jobs": { scope: "org", policy: READ, list: true },
  "GET /api/v1/discovery/jobs/:id": {
    scope: "org",
    policy: READ,
    probes: [id((i) => `/discovery/jobs/${i.job}`)],
  },
  "GET /api/v1/discovery/jobs/:id/items": {
    scope: "org",
    policy: READ,
    probes: [id((i) => `/discovery/jobs/${i.job}/items`)],
  },
  "POST /api/v1/discovery/jobs/:id/cancel": {
    scope: "org",
    policy: "discovery:run",
    probes: [id((i) => `/discovery/jobs/${i.job}/cancel`)],
  },
  "POST /api/v1/discovery/jobs/:id/retry-failed": {
    scope: "org",
    policy: "discovery:run",
    probes: [id((i) => `/discovery/jobs/${i.job}/retry-failed`)],
  },
  "GET /api/v1/jobs": { scope: "org", policy: READ, list: true },
  // Credits, usage, reports
  "GET /api/v1/credits/balance": { scope: "org", policy: READ, list: true },
  "GET /api/v1/credits/ledger": { scope: "org", policy: "usage:read", list: true },
  "GET /api/v1/usage": { scope: "org", policy: "usage:read", list: true },
  "GET /api/v1/reports/overview": { scope: "org", policy: READ, list: true },
  "GET /api/v1/reports/source-breakdown": { scope: "org", policy: READ, list: true },
  "GET /api/v1/reports/quality-distribution": { scope: "org", policy: READ, list: true },
  "GET /api/v1/reports/jobs-timeline": { scope: "org", policy: READ, list: true },
  "GET /api/v1/reports/pipeline-funnel": { scope: "org", policy: READ, list: true },
  "GET /api/v1/reports/activity-summary": { scope: "org", policy: READ, list: true },
  // Notifications (organization and user)
  "GET /api/v1/notifications": { scope: "org", policy: "notifications:read", list: true },
  "GET /api/v1/notifications/unread-count": {
    scope: "org",
    policy: "notifications:read",
    list: true,
  },
  "POST /api/v1/notifications/read-all": {
    scope: "org",
    policy: "notifications:read",
    own: "marks the caller's own notifications in the header's organization",
  },
  "POST /api/v1/notifications/:id/read": {
    scope: "org",
    policy: "notifications:read",
    probes: [id((i) => `/notifications/${i.notification}/read`)],
  },
  "GET /api/v1/notifications/preferences": {
    scope: "org",
    policy: "notifications:read",
    list: true,
  },
  "PUT /api/v1/notifications/preferences": {
    scope: "org",
    policy: "notifications:read",
    own: "the caller's own preferences",
  },
  // Website analysis, enrichment, scoring
  "POST /api/v1/analysis/websites": {
    scope: "org",
    policy: "analysis:run",
    probes: [
      id(() => "/analysis/websites", { body: (i) => ({ businessId: i.biz }) }),
      id(() => "/analysis/websites", { body: (i) => ({ businessIds: [i.biz] }), expect: [202] }),
    ],
  },
  "GET /api/v1/analysis/websites": {
    scope: "org",
    policy: READ,
    list: true,
    probes: [id((i) => `/analysis/websites?businessId=${i.biz}`)],
  },
  "GET /api/v1/analysis/websites/:id": {
    scope: "org",
    policy: READ,
    probes: [id((i) => `/analysis/websites/${i.analysis}`)],
  },
  "POST /api/v1/enrichment/businesses/:id/website-contacts": {
    scope: "org",
    policy: "analysis:run",
    probes: [id((i) => `/enrichment/businesses/${i.biz}/website-contacts`)],
  },
  "POST /api/v1/enrichment/businesses/:id/check-email": {
    scope: "org",
    policy: "analysis:run",
    probes: [
      id((i) => `/enrichment/businesses/${i.biz}/check-email`, {
        body: () => ({ address: "hello@zebramark.example.test" }),
      }),
    ],
  },
  "GET /api/v1/enrichment/runs/:id": {
    scope: "org",
    policy: READ,
    probes: [id((i) => `/enrichment/runs/${i.run}`)],
  },
  "GET /api/v1/scoring/profile": { scope: "org", policy: READ, list: true },
  "PATCH /api/v1/scoring/profile": {
    scope: "org",
    policy: "settings:scoring",
    own: "the header's organization's profile",
  },
  "POST /api/v1/scoring/recompute": {
    scope: "org",
    policy: "settings:scoring",
    own: "recomputes the header's organization",
  },
  // Duplicates
  "GET /api/v1/dedup/candidates": {
    scope: "org",
    policy: READ,
    list: true,
    probes: [id((i) => `/dedup/candidates?businessId=${i.biz}`)],
  },
  "GET /api/v1/dedup/candidates/:id": {
    scope: "org",
    policy: READ,
    probes: [id((i) => `/dedup/candidates/${i.candidate}`)],
  },
  "POST /api/v1/dedup/candidates/:id/merge": {
    scope: "org",
    policy: "dedup:write",
    probes: [
      id((i) => `/dedup/candidates/${i.candidate}/merge`, { body: (i) => ({ survivorId: i.biz }) }),
    ],
  },
  "POST /api/v1/dedup/candidates/:id/reject": {
    scope: "org",
    policy: "dedup:write",
    probes: [id((i) => `/dedup/candidates/${i.candidate}/reject`)],
  },
  "POST /api/v1/dedup/candidates/:id/defer": {
    scope: "org",
    policy: "dedup:write",
    probes: [id((i) => `/dedup/candidates/${i.candidate}/defer`)],
  },
  "GET /api/v1/dedup/merges": {
    scope: "org",
    policy: READ,
    list: true,
    probes: [id((i) => `/dedup/merges?businessId=${i.biz}`)],
  },
  "GET /api/v1/dedup/merges/:id": {
    scope: "org",
    policy: READ,
    probes: [id((i) => `/dedup/merges/${i.merge}`)],
  },
  "POST /api/v1/dedup/merges/:id/undo": {
    scope: "org",
    policy: "dedup:write",
    probes: [id((i) => `/dedup/merges/${i.merge}/undo`, { body: () => ({}) })],
  },
  "POST /api/v1/dedup/scan": {
    scope: "org",
    policy: "dedup:write",
    probes: [
      id(() => "/dedup/scan", { body: (i) => ({ businessIds: [i.biz] }), expect: [202, 404] }),
    ],
  },
  // Pipeline, lists, activities, outreach, bulk
  "GET /api/v1/pipeline/config": { scope: "org", policy: READ, list: true },
  "PUT /api/v1/pipeline/config": {
    scope: "org",
    policy: "settings:pipeline",
    own: "the header's organization's stages",
  },
  "GET /api/v1/pipeline/board": {
    scope: "org",
    policy: READ,
    list: true,
    probes: [
      id((i) => `/pipeline/board?assignedToUserId=${i.member}`, { expect: [200, 404] }),
      id((i) => `/pipeline/board?listId=${i.list}`),
    ],
  },
  "GET /api/v1/pipeline/leads": {
    scope: "org",
    policy: READ,
    list: true,
    probes: [id((i) => `/pipeline/leads?listId=${i.list}`)],
  },
  "GET /api/v1/pipeline/leads/:id": {
    scope: "org",
    policy: READ,
    probes: [id((i) => `/pipeline/leads/${i.lead}`)],
  },
  "POST /api/v1/pipeline/leads": {
    scope: "org",
    policy: ["pipeline:write", "leads:assign"],
    probes: [id(() => "/pipeline/leads", { body: (i) => ({ businessId: i.biz }) })],
  },
  "POST /api/v1/pipeline/leads/:id/move": {
    scope: "org",
    policy: "pipeline:write",
    probes: [id((i) => `/pipeline/leads/${i.lead}/move`, { body: () => ({ direction: "next" }) })],
  },
  "PATCH /api/v1/pipeline/leads/:id": {
    scope: "org",
    policy: "pipeline:write",
    probes: [id((i) => `/pipeline/leads/${i.lead}`, { body: () => ({ priority: "low" }) })],
  },
  "POST /api/v1/pipeline/leads/:id/assign": {
    scope: "org",
    policy: "leads:assign",
    probes: [
      id((i) => `/pipeline/leads/${i.lead}/assign`, { body: () => ({ assignedToUserId: null }) }),
    ],
  },
  "GET /api/v1/lists": { scope: "org", policy: READ, list: true },
  "POST /api/v1/lists": {
    scope: "org",
    policy: LISTS,
    own: "creates in the header's organization",
  },
  "GET /api/v1/lists/:id": { scope: "org", policy: READ, probes: [id((i) => `/lists/${i.list}`)] },
  "PATCH /api/v1/lists/:id": {
    scope: "org",
    policy: LISTS,
    probes: [id((i) => `/lists/${i.list}`, { body: () => ({ name: "Renamed" }) })],
  },
  "DELETE /api/v1/lists/:id": {
    scope: "org",
    policy: LISTS,
    probes: [id((i) => `/lists/${i.list}`)],
  },
  "GET /api/v1/lists/:id/items": {
    scope: "org",
    policy: READ,
    probes: [id((i) => `/lists/${i.list}/items`)],
  },
  "POST /api/v1/lists/:id/items": {
    scope: "org",
    policy: LISTS,
    probes: [id((i) => `/lists/${i.list}/items`, { body: (i) => ({ businessIds: [i.biz] }) })],
  },
  "POST /api/v1/lists/:id/items/remove": {
    scope: "org",
    policy: LISTS,
    probes: [
      id((i) => `/lists/${i.list}/items/remove`, { body: (i) => ({ businessIds: [i.biz] }) }),
    ],
  },
  "DELETE /api/v1/lists/:id/items/:businessId": {
    scope: "org",
    policy: LISTS,
    probes: [id((i) => `/lists/${i.list}/items/${i.biz}`)],
  },
  "GET /api/v1/activities": {
    scope: "org",
    policy: READ,
    list: true,
    probes: [
      id((i) => `/activities?businessId=${i.biz}`),
      id((i) => `/activities?leadId=${i.lead}`),
    ],
  },
  "GET /api/v1/activities/:id": {
    scope: "org",
    policy: READ,
    probes: [id((i) => `/activities/${i.activity}`)],
  },
  "POST /api/v1/activities": {
    scope: "org",
    policy: "pipeline:write",
    probes: [
      id(() => "/activities", { body: (i) => ({ businessId: i.biz, type: "note", body: "x" }) }),
    ],
  },
  "PATCH /api/v1/activities/:id": {
    scope: "org",
    policy: "pipeline:write",
    probes: [id((i) => `/activities/${i.activity}`, { body: () => ({ body: "y" }) })],
  },
  "DELETE /api/v1/activities/:id": {
    scope: "org",
    policy: "pipeline:write",
    probes: [id((i) => `/activities/${i.activity}`)],
  },
  "GET /api/v1/outreach": {
    scope: "org",
    policy: READ,
    list: true,
    probes: [id((i) => `/outreach?businessId=${i.biz}`)],
  },
  "GET /api/v1/outreach/:id": {
    scope: "org",
    policy: READ,
    probes: [id((i) => `/outreach/${i.outreach}`)],
  },
  "POST /api/v1/outreach": {
    scope: "org",
    policy: "pipeline:write",
    probes: [id(() => "/outreach", { body: (i) => ({ businessId: i.biz, channel: "call" }) })],
  },
  "PATCH /api/v1/outreach/:id": {
    scope: "org",
    policy: "pipeline:write",
    probes: [id((i) => `/outreach/${i.outreach}`, { body: () => ({ status: "closed" }) })],
  },
  "POST /api/v1/outreach/:id/attempts": {
    scope: "org",
    policy: "pipeline:write",
    probes: [id((i) => `/outreach/${i.outreach}/attempts`, { body: () => ({ outcome: "sent" }) })],
  },
  "POST /api/v1/bulk-operations/preview": {
    scope: "org",
    policy: BULK,
    probes: [
      id(() => "/bulk-operations/preview", {
        body: (i) => ({ action: "add_to_list", listId: i.list, selection: { ids: [i.biz] } }),
      }),
    ],
  },
  "POST /api/v1/bulk-operations": {
    scope: "org",
    policy: BULK,
    probes: [
      id(() => "/bulk-operations", {
        body: (i) => ({ action: "add_to_list", listId: i.list, selection: { ids: [i.biz] } }),
        headers: key,
      }),
    ],
  },
  "GET /api/v1/bulk-operations": { scope: "org", policy: READ, list: true },
  "GET /api/v1/bulk-operations/:id": {
    scope: "org",
    policy: READ,
    probes: [id((i) => `/bulk-operations/${i.bulk}`)],
  },
  "GET /api/v1/bulk-operations/:id/items": {
    scope: "org",
    policy: READ,
    probes: [id((i) => `/bulk-operations/${i.bulk}/items`)],
  },
  // Billing
  "GET /api/v1/billing/overview": { scope: "org", policy: "billing:manage", list: true },
  "GET /api/v1/billing/banners": { scope: "org", policy: READ, list: true },
  "GET /api/v1/billing/plans": { scope: "org", policy: "billing:manage", list: true },
  "POST /api/v1/billing/checkout/credits": {
    scope: "org",
    policy: "billing:manage",
    own: "checkout for the header's organization",
  },
  "POST /api/v1/billing/checkout/subscription": {
    scope: "org",
    policy: "billing:manage",
    own: "checkout for the header's organization",
  },
  "GET /api/v1/billing/payments": { scope: "org", policy: "billing:manage", list: true },
  "GET /api/v1/billing/payments/:reference": {
    scope: "org",
    policy: "billing:manage",
    probes: [
      id((i) => `/billing/payments/${i.paymentRef}`),
      id((i) => `/billing/payments/${i.paymentId}`),
    ],
  },
  "POST /api/v1/billing/payments/:reference/verify": {
    scope: "org",
    policy: "billing:manage",
    probes: [id((i) => `/billing/payments/${i.paymentRef}/verify`)],
  },
  "POST /api/v1/billing/payments/:id/refund": {
    scope: "org",
    policy: "billing:refund",
    probes: [
      id((i) => `/billing/payments/${i.paymentId}/refund`, {
        body: () => ({ reason: "Not mine at all" }),
      }),
    ],
  },
  "GET /api/v1/billing/invoices": { scope: "org", policy: "billing:manage", list: true },
  "GET /api/v1/billing/invoices/:id": {
    scope: "org",
    policy: "billing:manage",
    probes: [id((i) => `/billing/invoices/${i.invoice}`)],
  },
  "GET /api/v1/billing/invoices/:id/download-url": {
    scope: "org",
    policy: "billing:manage",
    probes: [id((i) => `/billing/invoices/${i.invoice}/download-url`)],
  },
  "POST /api/v1/billing/subscription/cancel": {
    scope: "org",
    policy: "billing:manage",
    own: "the header's organization's subscription",
  },
  "POST /api/v1/billing/subscription/resume": {
    scope: "org",
    policy: "billing:manage",
    own: "the header's organization's subscription",
  },
  "GET /api/v1/billing/subscription/manage-link": {
    scope: "org",
    policy: "billing:manage",
    own: "the header's organization's subscription",
  },
};

/**
 * Every queue job type. `org` jobs carry an organization id and a resource id; the handler is run
 * with B's organization and A's resource. `own` jobs name only an organization, so they can only
 * act on that organization's records. `platform` jobs carry no organization (maintenance,
 * reconciliation, provider events matched by reference) and say why that is safe.
 */
type JobEntry =
  | { kind: "org"; run: (i: Ids, orgB: string) => Promise<unknown>; expect: "rejects" | "no-op" }
  | { kind: "own"; why: string }
  | { kind: "platform"; why: string };

const fakeJob = (name: string, data: object) =>
  ({ name, data, opts: { attempts: 3 }, attemptsMade: 0, id: `iso-${name}` }) as unknown as Job;
const handler = <T>(cls: abstract new (...args: never[]) => T): T =>
  h.app.get(cls, { strict: false });

const JOBS: Record<string, JobEntry> = {
  "mail:send-email": {
    kind: "platform",
    why: "a rendered message to one recipient, built by the producer; no organization data is read",
  },
  "imports:commit-import": {
    kind: "org",
    expect: "rejects",
    run: (i, b) => handler(ImportsService).process(b, i.importId),
  },
  "discovery:run-discovery-job": {
    kind: "org",
    expect: "rejects",
    run: (i, b) =>
      handler(DiscoveryQueueHandler).handle(
        fakeJob("run-discovery-job", {
          organizationId: b,
          jobId: i.job,
          round: 1,
          reason: "start",
        }),
      ),
  },
  "discovery:fetch-source-page": {
    kind: "org",
    expect: "rejects",
    run: (i, b) =>
      handler(DiscoveryQueueHandler).handle(
        fakeJob("fetch-source-page", {
          organizationId: b,
          jobId: i.job,
          round: 1,
          source: "overture_places",
          unit: "q0",
          cursor: { kind: "search", queryIndex: 0, pageIndex: 0, pageToken: null },
        }),
      ),
  },
  "billing:reconcile-credits": {
    kind: "platform",
    why: "maintenance over unsettled jobs and holds; each repair is loaded and settled within the hold's own organization",
  },
  "billing:reconcile-billing": {
    kind: "platform",
    why: "maintenance over stuck payments and webhooks; matched by provider reference, never by a client value",
  },
  "billing:process-webhook": {
    kind: "platform",
    why: "a stored, signature-verified provider event; the payment is found by provider reference and verified with Paystack",
  },
  "billing:verify-payment": {
    kind: "platform",
    why: "a payment id created server-side at checkout; the payment row names its customer and organization",
  },
  "billing:generate-invoice-pdf": {
    kind: "org",
    expect: "rejects",
    run: (i, b) =>
      handler(BillingQueueHandler).handle(
        fakeJob("generate-invoice-pdf", { organizationId: b, invoiceId: i.invoice }),
      ),
  },
  "maintenance:purge-expired-content": {
    kind: "platform",
    why: "retention purge by expiry date within each organization's own records",
  },
  "maintenance:refresh-scores": {
    kind: "platform",
    why: "re-scores stale snapshots per organization with that organization's profile",
  },
  "maintenance:recover-enrichment": { kind: "platform", why: "marks stuck runs failed in place" },
  "maintenance:overture-sync": {
    kind: "platform",
    why: "platform-level reference catalogue, no organization data",
  },
  "maintenance:cleanup-exports": {
    kind: "platform",
    why: "deletes expired export files through their own records",
  },
  "maintenance:recover-crm-jobs": {
    kind: "platform",
    why: "re-queues stuck bulk operations with their own organization id",
  },
  "maintenance:rollup-usage": {
    kind: "platform",
    why: "aggregates each organization's ledger into its own usage rows",
  },
  "maintenance:scan-organization-deletions": {
    kind: "platform",
    why: "finds organizations past their own purge date; reminders go to each organization's own owners and admins",
  },
  // Names only an organization: B's purge job does nothing, because B has no deletion past its grace.
  "maintenance:purge-organization": {
    kind: "org",
    expect: "no-op",
    run: (_i, b) =>
      handler(OrganizationPurgeService).handle(
        fakeJob("purge-organization", { organizationId: b }),
      ),
  },
  "exports:build-export": {
    kind: "org",
    expect: "rejects",
    run: (i, b) =>
      handler(ExportQueueHandler).handle(
        fakeJob("build-export", { organizationId: b, exportId: i.exportId }),
      ),
  },
  "exports:build-organization-export": {
    kind: "org",
    expect: "rejects",
    run: (i, b) =>
      handler(OrganizationExportQueueHandler).handle(
        fakeJob("build-organization-export", { organizationId: b, exportId: i.orgExport }),
      ),
  },
  "bulk:run-bulk-operation": {
    kind: "org",
    expect: "rejects",
    run: (i, b) =>
      handler(BulkQueueHandler).handle(
        fakeJob("run-bulk-operation", { organizationId: b, operationId: i.bulk }),
      ),
  },
  "website-analysis:analyze-website": {
    kind: "org",
    expect: "rejects",
    run: (i, b) =>
      handler(AnalysisQueueHandler).handle(
        fakeJob("analyze-website", { organizationId: b, analysisId: i.analysis }),
      ),
  },
  "enrichment:website-contacts": {
    kind: "org",
    expect: "rejects",
    run: (i, b) =>
      handler(EnrichmentQueueHandler).handle(
        fakeJob("website-contacts", { organizationId: b, runId: i.run }),
      ),
  },
  "enrichment:verify-contact": {
    kind: "org",
    expect: "rejects",
    run: (i, b) =>
      handler(EnrichmentQueueHandler).handle(
        fakeJob("verify-contact", { organizationId: b, runId: i.run }),
      ),
  },
  "scoring:recompute-scores": {
    kind: "own",
    why: "names only an organization and a profile version: re-scores that organization's own records",
  },
  "scoring:score-businesses": {
    kind: "org",
    expect: "no-op",
    run: (i, b) =>
      handler(ScoringQueueHandler).handle(
        fakeJob("score-businesses", { organizationId: b, businessIds: [i.biz, i.twin] }),
      ),
  },
  "dedup:find-duplicates": {
    kind: "org",
    expect: "no-op",
    run: (i, b) =>
      handler(DedupQueueHandler).handle(
        fakeJob("find-duplicates", { organizationId: b, businessIds: [i.biz, i.twin] }),
      ),
  },
};

/** `queue:job` for every job type declared in QueueJobMap (packages/core/src/queue/queue.constants.ts). */
function declaredJobTypes(): string[] {
  const src = readFileSync(
    new URL("../../../packages/core/src/queue/queue.constants.ts", import.meta.url),
    "utf8",
  );
  const start = src.indexOf("export interface QueueJobMap");
  const block = src.slice(start, src.indexOf("\n}\n", start));
  const out: string[] = [];
  for (const m of block.matchAll(/\[QueueNames\.(\w+)\]:\s*\{([^}]*)\}/g)) {
    const queue = (QueueNames as Record<string, string>)[m[1]!];
    if (!queue) throw new Error(`Unknown queue key ${m[1]}`);
    for (const j of m[2]!.matchAll(/"([\w-]+)"\s*:/g)) out.push(`${queue}:${j[1]}`);
  }
  return out.sort();
}

const MUTATING = new Set(["POST", "PATCH", "PUT", "DELETE"]);
const MARKER = "zebramark";

let h: Harness;
let fake: FakePaystack;
let routes: DiscoveredRoute[];
let A: OrgUser;
let rep: { agent: OrgUser["agent"]; userId: string };
let B: OrgUser;
let Badmin: OrgUser;
let ids: Ids;
let secrets: string[];
let exportUrl: string;
let invoiceUrl: string;
let orgExportUrl: string;
let invitationToken: string;

/** Every MongoDB document and PostgreSQL row that belongs to an organization, serialized. */
async function snapshot(organizationId: string): Promise<string> {
  const db = h.app.get(MongoService).database;
  const parts: string[] = [];
  const names = (await db.listCollections({}, { nameOnly: true }).toArray())
    .map((c) => c.name)
    .sort();
  for (const name of names) {
    if (name === Collections.auditEvents) continue; // B's refused attempts are audited under B, never A; checked below
    const docs = await db.collection(name).find({ organizationId }).sort({ _id: 1 }).toArray();
    if (docs.length) parts.push(`${name}:${EJSON.stringify(docs, { relaxed: false })}`);
  }
  const customer = await h.prisma.billingCustomer.findUnique({
    where: { organizationId },
    include: {
      ledger: true,
      payments: true,
      invoices: true,
      entitlements: true,
      subscriptions: true,
    },
  });
  const org = await h.prisma.organization.findUnique({
    where: { id: organizationId },
    include: { memberships: true, invitations: true },
  });
  parts.push(
    JSON.stringify({ customer, org }, (_k, v) => (typeof v === "bigint" ? v.toString() : v)),
  );
  return parts.join("\n");
}

function asB(
  u: OrgUser,
  method: string,
  path: string,
  opts: { body?: object; headers?: Record<string, string>; org?: string; csrf?: boolean } = {},
) {
  const verb = method.toLowerCase() as "get" | "post" | "patch" | "put" | "delete";
  let req = u.agent[verb](`${API}${path}`);
  if (opts.org !== undefined) req = req.set(ORGANIZATION_HEADER, opts.org);
  if (opts.csrf !== false) req = req.set(CSRF_HEADER, csrfFrom(u.agent));
  if (opts.headers) req = req.set(opts.headers);
  return verb === "get" || verb === "delete" ? req : req.send(opts.body ?? {});
}

/** Fills a route template with A's ids so a request reaches the guards with a well-formed path. */
function concrete(path: string): string {
  return path
    .replace(/^\/api\/v1/, "")
    .replace(":userId", ids.member)
    .replace(":businessId", ids.biz)
    .replace(":reference", ids.paymentRef)
    .replace(":token", "x".repeat(43))
    .replace(":key", "overture_places")
    .replace(":id", new ObjectId().toHexString());
}

beforeAll(async () => {
  fake = await startFakePaystack();
  h = await createHarness({ ...DISCOVERY_TEST_ENV, ...billingEnv(fake) });
  await h.resetState();
  forgetOverture(h);
  await seedOverture(h);
  routes = discoverRoutes(h.app);

  // Organization A with one of everything.
  A = await createOwner(h, "victim-owner@example.test", "Zebramark Victim Org");
  const repMember = await addMember(h, A.orgId, "sales_rep", "victim-rep@example.test");
  rep = repMember;
  B = await createOwner(h, "attacker-owner@example.test", "Attacker Org");
  const bAdmin = await addMember(h, B.orgId, "admin", "attacker-admin@example.test");
  Badmin = { agent: bAdmin.agent, orgId: B.orgId, userId: bAdmin.userId };
  await grant(h, A.orgId, 50);
  await grant(h, B.orgId, 50);
  const hdr = () => orgHeaders(A.agent, A.orgId);
  const [biz, twin] = await seedBusinesses(h, A.orgId, [
    {
      name: "Zebramark Bakery (Sample)",
      website: "zebramark.example.test",
      emails: ["hello@zebramark.example.test"],
      phones: ["0803 555 0101"],
      location: { locality: "Ikeja", region: "Lagos" },
    },
    { name: "Zebramark Bakery Ikeja (Sample)", location: { locality: "Ikeja", region: "Lagos" } },
  ]);
  const w4 = startPhase4Workers(h, ["dedup"]);
  let candidate: Json;
  try {
    candidate = await waitFor(
      async () =>
        ((await A.agent.get(`${API}/dedup/candidates`).set(hdr())).body.data as Json[])[0],
      30_000,
      "candidate",
    );
  } finally {
    await w4.close();
  }
  const upload = await uploadCsv(
    A,
    csvBuffer(["Name,Phone", "Zebramark Imported (Sample),0812 000 1111"]),
  ).expect(201);
  const job = await createJob(
    A.agent,
    A.orgId,
    spec({ name: "Zebramark discovery", maxRecords: 5 }),
  ).expect(201);
  const analysis = (
    await A.agent.post(`${API}/analysis/websites`).set(hdr()).send({ businessId: biz }).expect(202)
  ).body.data.analyses[0] as Json;
  const run = (
    await A.agent
      .post(`${API}/enrichment/businesses/${biz}/website-contacts`)
      .set(hdr())
      .expect(202)
  ).body.data as Json;
  const lead = (
    await A.agent.post(`${API}/pipeline/leads`).set(hdr()).send({ businessId: biz }).expect(201)
  ).body.data as Json;
  await A.agent
    .post(`${API}/pipeline/leads/${lead.id}/assign`)
    .set(hdr())
    .send({ assignedToUserId: rep.userId })
    .expect(200);
  const list = (
    await A.agent.post(`${API}/lists`).set(hdr()).send({ name: "Zebramark prospects" }).expect(201)
  ).body.data as Json;
  await A.agent
    .post(`${API}/lists/${list.id}/items`)
    .set(hdr())
    .send({ businessIds: [biz] })
    .expect(200);
  const activity = (
    await A.agent
      .post(`${API}/activities`)
      .set(hdr())
      .send({ businessId: biz, type: "note", body: "Zebramark private note" })
      .expect(201)
  ).body.data.activity as Json;
  const outreach = (
    await A.agent
      .post(`${API}/outreach`)
      .set(hdr())
      .send({ businessId: biz, channel: "call" })
      .expect(201)
  ).body.data as Json;
  const bulkOp = (
    await A.agent
      .post(`${API}/bulk-operations`)
      .set(hdr())
      .set(key())
      .send({ action: "add_to_list", listId: list.id, selection: { ids: [biz] } })
      .expect(202)
  ).body.data as Json;
  const exp = (
    await A.agent
      .post(`${API}/exports`)
      .set(hdr())
      .send({ kind: "list", listId: list.id })
      .expect(202)
  ).body.data as Json;
  const w5 = startPhase5Workers(h);
  try {
    await pollUntil(A, `/exports/${exp.id}`, isTerminal);
    await pollUntil(A, `/bulk-operations/${bulkOp.id}`, isTerminal);
  } finally {
    await w5.close();
  }
  exportUrl = (await A.agent.get(`${API}/exports/${exp.id}/download-url`).set(hdr()).expect(200))
    .body.data.url as string;
  const merge = (
    await A.agent
      .post(`${API}/dedup/candidates/${candidate.id}/merge`)
      .set(hdr())
      .send({ survivorId: biz })
      .expect(200)
  ).body.data.merge as Json;
  const invite = (
    await A.agent
      .post(`${API}/organizations/current/invitations`)
      .set(hdr())
      .send({ email: "victim-invitee@example.test", role: "researcher" })
      .expect(201)
  ).body.data as Json;
  invitationToken = await h.tokenFromMail("victim-invitee@example.test", "/invite/");
  const sessions = (await A.agent.get(`${API}/auth/sessions`).expect(200)).body.data as Json[];

  // A pays for a credit pack: a payment, an invoice, owner notifications.
  const pack = await createPack(h, { credits: 50, priceMinor: 150_000 });
  const checkout = (
    await A.agent
      .post(`${API}/billing/checkout/credits`)
      .set(hdr())
      .set(key())
      .send({ packId: pack.id })
      .expect(201)
  ).body.data as Json;
  fake.transactions.set(
    checkout.reference,
    transactionData({ reference: checkout.reference, amount: 150_000 }),
  );
  expect(
    await h.app
      .get(PaymentSettlementService, { strict: false })
      .verifyAndSettle(checkout.paymentId, { trigger: "webhook" }),
  ).toBe("granted");
  const invoice = await h.prisma.invoice.findFirstOrThrow({
    where: { billingCustomer: { organizationId: A.orgId } },
  });
  invoiceUrl = (
    await A.agent.get(`${API}/billing/invoices/${invoice.id}/download-url`).set(hdr()).expect(200)
  ).body.data.url as string;
  const notes = (await A.agent.get(`${API}/notifications`).set(hdr()).expect(200)).body
    .data as Json[];
  expect(notes.length).toBeGreaterThan(0);

  // Stage 10: A's organization data export, built by the same handler as apps/worker.
  const orgExport = (
    await A.agent.post(`${API}/organizations/current/data-exports`).set(hdr()).expect(202)
  ).body.data as Json;
  const orgExportWorker = new Worker(
    QueueNames.exports,
    (job: Job) => handler(OrganizationExportQueueHandler).handle(job),
    {
      connection: new Redis(process.env.REDIS_URL!, { maxRetriesPerRequest: null }),
      prefix: TEST_QUEUE_PREFIX,
    },
  );
  try {
    await pollUntil(A, `/organizations/current/data-exports/${orgExport.id}`, isTerminal);
  } finally {
    await orgExportWorker.close();
  }
  orgExportUrl = (
    await A.agent
      .get(`${API}/organizations/current/data-exports/${orgExport.id}/download-url`)
      .set(hdr())
      .expect(200)
  ).body.data.url as string;

  ids = {
    biz: biz!,
    twin: twin!,
    importId: upload.body.data.id as string,
    job: job.body.data.id as string,
    analysis: analysis.id,
    run: run.id,
    candidate: candidate.id,
    merge: merge.id,
    lead: lead.id,
    list: list.id,
    activity: activity.id,
    outreach: outreach.id,
    bulk: bulkOp.id,
    exportId: exp.id,
    invitation: invite.id,
    member: rep.userId,
    session: sessions[0]!.id,
    notification: notes[0]!.id,
    paymentRef: checkout.reference,
    paymentId: checkout.paymentId,
    invoice: invoice.id,
    orgExport: orgExport.id,
  };
  // What must never appear in B's responses: A's ids, organization, members and marker text.
  secrets = [
    ...new Set([
      ...Object.values(ids),
      A.orgId,
      A.userId,
      rep.userId,
      "victim-owner@example.test",
      "victim-rep@example.test",
      "victim-invitee",
    ]),
  ];
}, 300_000);

afterAll(async () => {
  await h?.close();
  await fake?.close();
});

describe("route inventory", () => {
  it("classifies every route the API serves, and nothing else", () => {
    const served = new Set(routes.map((r) => r.key));
    const unclassified = [...served].filter((k) => !(k in ROUTES));
    const stale = Object.keys(ROUTES).filter((k) => !served.has(k));
    expect(
      unclassified,
      "new routes need an entry in ROUTES (scope, policy, cross-organization probes)",
    ).toEqual([]);
    expect(stale, "ROUTES names routes the API no longer serves").toEqual([]);
    expect(routes.length).toBe(Object.keys(ROUTES).length);
  });

  it("declares exactly the access policy the table documents (the permission matrix per route)", () => {
    const mismatches = routes
      .filter((r) => JSON.stringify(r.policy) !== JSON.stringify(ROUTES[r.key]?.policy))
      .map(
        (r) =>
          `${r.key}: declared ${JSON.stringify(r.policy)}, table ${JSON.stringify(ROUTES[r.key]?.policy)}`,
      );
    expect(mismatches).toEqual([]);
    // Every organization route that names a resource by id has a cross-organization probe.
    const unprobed = routes
      .filter(
        (r) => ROUTES[r.key]?.scope === "org" && /:(id|reference|userId|businessId)/.test(r.path),
      )
      .filter((r) => !(ROUTES[r.key] as { probes?: Probe[] }).probes?.length)
      .map((r) => r.key);
    expect(unprobed).toEqual([]);
    // Only sign-in flows, the contact form and the signed webhook skip the CSRF token.
    expect(
      routes
        .filter((r) => r.skipCsrf)
        .map((r) => r.key)
        .sort(),
    ).toEqual(
      [
        "POST /api/v1/auth/forgot-password",
        "POST /api/v1/auth/login",
        "POST /api/v1/auth/refresh",
        "POST /api/v1/auth/register",
        "POST /api/v1/auth/reset-password",
        "POST /api/v1/auth/verify-email",
        "POST /api/v1/public/contact",
        "POST /api/v1/webhooks/paystack",
      ].sort(),
    );
  });
});

describe("cross-organization isolation on every route", () => {
  let before: string;
  beforeAll(async () => {
    // Warm-up: A reads every list once, so settings created lazily on first read (pipeline
    // stages, scoring profile, source switches) exist before the reference snapshot.
    for (const r of routes) {
      const entry = ROUTES[r.key];
      if (entry?.scope === "org" && entry.list)
        await A.agent.get(`${API}${concrete(r.path)}`).set(orgHeaders(A.agent, A.orgId));
    }
    before = await snapshot(A.orgId);
  });

  it("refuses anonymous callers on every non-public route", async () => {
    const failures: string[] = [];
    for (const r of routes) {
      if (ROUTES[r.key]?.scope === "public") continue;
      const req = h
        .agent()
        [r.method.toLowerCase() as "get"](
          r.path.startsWith("/api/v1") ? `${API}${concrete(r.path)}` : r.path,
        );
      const res = await req;
      if (res.status !== 401) failures.push(`${r.key}: ${res.status}`);
    }
    expect(failures).toEqual([]);
  });

  it("refuses every state-changing request without the session's CSRF token", async () => {
    const failures: string[] = [];
    for (const r of routes) {
      if (!MUTATING.has(r.method) || r.skipCsrf || ROUTES[r.key]?.scope === "public") continue;
      const res = await asB(Badmin, r.method, concrete(r.path), { org: B.orgId, csrf: false });
      if (res.status !== 403 || res.body.error?.code !== "CSRF_FAILED")
        failures.push(`${r.key}: ${res.status} ${res.body.error?.code}`);
    }
    expect(failures).toEqual([]);
  });

  it("refuses another organization's scope header on every organization route", async () => {
    const failures: string[] = [];
    for (const r of routes) {
      if (ROUTES[r.key]?.scope !== "org") continue;
      const res = await asB(Badmin, r.method, concrete(r.path), { org: A.orgId });
      if (res.status !== 403 || res.body.error?.code !== "ORG_FORBIDDEN")
        failures.push(`${r.key}: ${res.status} ${res.body.error?.code}`);
    }
    expect(failures).toEqual([]);
  });

  it("answers 404 (or a documented no-op) for A's ids on every route that takes one, without leaking A's data", async () => {
    const failures: string[] = [];
    let probes = 0;
    for (const r of routes) {
      const entry = ROUTES[r.key];
      if (!entry || entry.scope === "public") continue;
      for (const probe of entry.probes ?? []) {
        probes += 1;
        const res = await asB(B, r.method, probe.path(ids), {
          org: entry.scope === "org" ? B.orgId : undefined,
          body: probe.body?.(ids),
          headers: probe.headers?.(),
        });
        const allowed = probe.expect ?? [404];
        const text = `${res.text ?? ""}${JSON.stringify(res.body ?? "")}`.toLowerCase();
        if (!allowed.includes(res.status))
          failures.push(
            `${r.key} ${probe.path(ids)}: ${res.status} ${JSON.stringify(res.body?.error ?? "")}`,
          );
        // Echoing back the ids B itself sent (for example a per-item `not_found`) is not a leak.
        const sent = `${probe.path(ids)}${JSON.stringify(probe.body?.(ids) ?? {})}`.toLowerCase();
        const leaked = secrets
          .filter((s) => text.includes(s.toLowerCase()) && !sent.includes(s.toLowerCase()))
          .concat(text.includes(MARKER) && !sent.includes(MARKER) ? [MARKER] : []);
        // Neither a 404 nor a documented no-op may carry anything of A's that B did not send.
        if (leaked.length) failures.push(`${r.key} ${probe.path(ids)} leaked ${leaked.join(", ")}`);
      }
    }
    expect(failures).toEqual([]);
    expect(probes).toBeGreaterThanOrEqual(80);
  });

  it("never shows A's records in any list, aggregate, report or settings read", async () => {
    const failures: string[] = [];
    let positive = 0;
    for (const r of routes) {
      const entry = ROUTES[r.key];
      if (entry?.scope !== "org" || !entry.list) continue;
      const path = concrete(r.path);
      const asA = await A.agent.get(`${API}${path}`).set(orgHeaders(A.agent, A.orgId));
      const res = await B.agent.get(`${API}${path}`).set(orgHeaders(B.agent, B.orgId));
      if (res.status !== 200) failures.push(`${r.key}: ${res.status}`);
      const text = JSON.stringify(res.body).toLowerCase();
      const leaked = secrets
        .filter((s) => text.includes(s.toLowerCase()))
        .concat(text.includes(MARKER) ? [MARKER] : []);
      if (leaked.length) failures.push(`${r.key} leaked ${leaked.join(", ")}`);
      const own = JSON.stringify(asA.body).toLowerCase();
      if (secrets.some((s) => own.includes(s.toLowerCase())) || own.includes(MARKER)) positive += 1;
    }
    expect(failures).toEqual([]);
    // Positive control: most of these reads do show A its own data, so B's empty answers are meaningful.
    expect(positive).toBeGreaterThanOrEqual(20);
  });

  it("keeps signed links and invitation tokens bound to their organization and user", async () => {
    for (const [label, url] of [
      ["export", exportUrl],
      ["invoice", invoiceUrl],
      ["organization export", orgExportUrl],
    ] as const) {
      const res = await download(B.agent, url);
      expect(res.status, `${label} as B`).toBe(403);
      expect(res.body.toString("utf8")).not.toContain("%PDF");
      // Re-pointing the link at B's organization breaks the signature.
      const swapped = new URL(url);
      swapped.searchParams.set("org", B.orgId);
      const forged = await download(B.agent, swapped.toString());
      expect(forged.status, `${label} forged`).toBe(403);
      expect(forged.json?.error?.code).toBe("DOWNLOAD_LINK_INVALID");
      // Opened in B's browser: 303 to B's own app with the id from the URL and a fixed code, nothing of A's.
      const opened = await navigate(B.agent, url);
      expect(opened.status, `${label} navigated`).toBe(303);
      expect(opened.headers.location, `${label} navigated`).toMatch(
        /^http:\/\/localhost:3000\/app\/(jobs\/exports\/[a-f0-9]{24}\?|billing\?|settings\?tab=organization&)downloadError=DOWNLOAD_LINK_INVALID$/,
      );
      expect(opened.body.toString("utf8")).not.toContain("%PDF");
    }
    // A's invitation token cannot be accepted by B's members (it names another address).
    const accept = await B.agent
      .post(`${API}/invitations/${encodeURIComponent(invitationToken)}/accept`)
      .set(CSRF_HEADER, csrfFrom(B.agent));
    expect(accept.status).toBe(403);
    expect(
      await h.prisma.membership.count({ where: { organizationId: A.orgId, userId: B.userId } }),
    ).toBe(0);
  });

  it("classifies every queue job type, and rejects or ignores payloads naming A's resources under B's organization", async () => {
    const declared = declaredJobTypes();
    expect(declared.length).toBeGreaterThanOrEqual(24);
    expect(
      declared.filter((k) => !(k in JOBS)),
      "new job types need an entry in JOBS",
    ).toEqual([]);
    expect(
      Object.keys(JOBS).filter((k) => !declared.includes(k)),
      "JOBS names job types that no longer exist",
    ).toEqual([]);
    const failures: string[] = [];
    for (const [name, entry] of Object.entries(JOBS)) {
      if (entry.kind !== "org") continue;
      const outcome = await entry.run(ids, B.orgId).then(
        () => "resolved",
        (err: unknown) => `rejected: ${(err as Error).name} ${(err as Error).message}`,
      );
      if (entry.expect === "rejects") {
        // Refused before any work: UnrecoverableError (no retries) or the service's not-found.
        if (!/^rejected: \w+ .*(not found|invalid|organization)/i.test(outcome))
          failures.push(`${name}: ${outcome}`);
      } else if (outcome !== "resolved") failures.push(`${name}: expected a no-op, got ${outcome}`);
    }
    expect(failures).toEqual([]);
    // Nothing was created in B that refers to A's records (no candidates, scores, items, files).
    const bState = (await snapshot(B.orgId)).toLowerCase();
    expect(secrets.filter((x) => bState.includes(x.toLowerCase()))).toEqual([]);
  });

  it("left every one of A's records exactly as it was, and audited B's attempts under B only", async () => {
    expect(await snapshot(A.orgId)).toBe(before);
    const db = h.app.get(MongoService).database;
    const bUsersInA = await db
      .collection(Collections.auditEvents)
      .countDocuments({ organizationId: A.orgId, actorUserId: { $in: [B.userId, Badmin.userId] } });
    expect(bUsersInA).toBe(0);
  });

  it("still serves A's signed links to A's owner, who they were issued to", async () => {
    expect((await download(A.agent, exportUrl)).status).toBe(200);
    expect((await download(A.agent, invoiceUrl)).status).toBe(200);
    expect((await download(A.agent, orgExportUrl)).status).toBe(200);
  });
});
