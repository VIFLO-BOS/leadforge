# LeadForge Architecture

Status: approved at Gate 0 and built through Phase 7; sections 8 and 10 describe what shipped. Last updated 2026-10-27.

This document defines the system shape for the first production release. It is the authority for module boundaries and database ownership. Detailed data models live in `docs/DATABASE_DESIGN.md`, endpoint shapes in `docs/API_CONTRACTS.md`, and the security model in `docs/SECURITY_AND_DATA_COLLECTION.md`.

## 1. Summary of decisions

| Area                    | Decision                                                                                                                                                                                                                                                | Why                                                                                                             |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Deployment shape        | Modular monolith: one Next.js app, one NestJS API, one NestJS worker process sharing the API's modules                                                                                                                                                  | Independent scaling of collection work without microservice overhead                                            |
| Repository              | pnpm workspace monorepo with Turborepo task orchestration                                                                                                                                                                                               | Shared contracts and UI between web, API and worker; single CI                                                  |
| Identity ownership      | PostgreSQL owns users, organizations, memberships, invitations, sessions, API keys                                                                                                                                                                      | Billing needs referential integrity to orgs and users; low write volume; relational by nature                   |
| Business data ownership | MongoDB owns businesses, observations, jobs, analyses, lead lists, activities, audit events                                                                                                                                                             | Flexible provenance documents, high write volume, per-org scoped queries                                        |
| Billing ownership       | PostgreSQL (Prisma) is the only authority for plans, subscriptions, payments, invoices, credits, entitlements                                                                                                                                           | Money needs ACID transactions and a ledger                                                                      |
| Authentication          | First-party auth in the API: Argon2id passwords, short-lived access JWT, rotating refresh tokens in httpOnly cookies, email verification, password reset                                                                                                | Org scoping and RBAC live in the API anyway; avoids vendor lock-in; no third-party auth cost at launch          |
| Validation              | Zod schemas in `packages/contracts`, consumed by both Next.js forms and a NestJS `ZodValidationPipe`                                                                                                                                                    | One source of truth for request shapes; no duplicated business rules                                            |
| Queue                   | Redis + BullMQ, queues per workload with per-source rate limiters                                                                                                                                                                                       | Durable retries, backoff, concurrency control                                                                   |
| Payments                | Paystack: server-side initialize, signature-verified idempotent webhooks, verify-before-grant, reconciliation job                                                                                                                                       | Required by brief; Flutterwave behind the same `PaymentProvider` interface later                                |
| First discovery source  | **Overture Maps Places** (open data, monthly release) loaded into a platform-level staging catalogue, plus the business's own website as enrichment, plus CSV import. Google Places is unavailable under its terms (decided 2026-10-25). See section 9. | Openly licensed for storage and commercial reuse; Google's terms forbid storing place content and directory use |
| Language                | TypeScript everywhere. No Python in release 1                                                                                                                                                                                                           | Simpler deployment; no workload yet justifies a second runtime                                                  |
| Responsive baseline     | 240px minimum viewport width, no horizontal page overflow                                                                                                                                                                                               | Product requirement                                                                                             |

## 2. System context

```
                 +------------------------------+
  Browser -----> | apps/web (Next.js App Router) |
                 |  (marketing) + (app) routes   |
                 +--------------+---------------+
                                | HTTPS, cookies, /api/v1
                 +--------------v---------------+
                 | apps/api (NestJS REST)        |<---- Paystack webhooks
                 +---+-------------+--------+---+
                     |             |        | enqueue
            +--------v---+  +------v----+ +-v--------------+
            | PostgreSQL |  |  MongoDB  | | Redis / BullMQ  |
            | identity + |  | business  | +-+--------------+
            | billing    |  | intel     |   | consume
            +------------+  +-----^-----+ +-v------------------+
                                  +-------| apps/worker (NestJS)|--> Source APIs,
                                          | discovery, enrich,  |    public websites
                                          | analysis, export    |    (egress-filtered)
                                          +---------------------+
```

Three deployable processes at launch: `web`, `api`, `worker`. The worker is the same NestJS codebase booted with a different entry module so it registers BullMQ processors but no HTTP controllers. Workers can be scaled per queue later by passing a queue allowlist via environment variable.

## 3. Repository layout

```
LeadForge/
  apps/
    web/                 Next.js 15 App Router, TypeScript strict, Tailwind
      app/(marketing)/   public site: /, /product, /pricing, /about, /contact, /legal/*
      app/(auth)/        /sign-in, /sign-up, /verify-email, /forgot-password, /reset-password
      app/(app)/         authenticated dashboard under /app/*
    api/                 NestJS HTTP entry (main.ts): controllers + module wiring
    worker/              NestJS standalone entry: registers processors only
  packages/
    contracts/           Zod schemas, DTO types, enums, error codes shared by all apps
    ui/                  Design tokens, Tailwind preset, shadcn/Radix components
    db-postgres/         Prisma schema, migrations, generated client, repositories
    db-mongo/            MongoDB driver wrapper, collection validators, index definitions, repositories
    core/                NestJS modules shared by api and worker (business, discovery, billing, ...)
    config/              Shared tsconfig, eslint, prettier
  docs/                  Product and engineering documentation
  infra/
    docker-compose.yml   Postgres 16, MongoDB 7, Redis 7, Mailpit for local dev
    monitoring/          Prometheus alert rules and scrape example, Grafana dashboard (Phase 7)
    load/                k6 load tests and their results (Phase 7)
    backup/              backup and restore scripts with count verification (Phase 7)
  .github/workflows/     lint, typecheck, test, build
```

`packages/core` holds NestJS modules so the API and worker both import the same services. Controllers live only in `apps/api`; processors live only in `apps/worker`. This keeps business logic in one place.

## 4. Module boundaries

Each module exports a public service interface and owns its persistence. Cross-module calls go through services, never through another module's repository.

| Module             | Responsibility                                                                                                     | Owns (storage)                                                               | Depends on                                                         |
| ------------------ | ------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| `auth`             | Registration, login, sessions, email verification, password reset, API keys                                        | PG: users, sessions, email_tokens, api_keys                                  | `mail`, `audit`                                                    |
| `organizations`    | Orgs, memberships, roles, invitations, org settings                                                                | PG: organizations, memberships, invitations                                  | `auth`, `audit`, `billing` (creates customer on org creation)      |
| `authz`            | Guards, permission matrix, org-scope resolution                                                                    | none                                                                         | `organizations`                                                    |
| `businesses`       | Canonical business profiles, field state (verified/unverified/stale/expired/conflicting), corrections, suppression | Mongo: businesses, suppression_entries                                       | `provenance`, `audit`                                              |
| `provenance`       | Source observations, field-level history, verification records                                                     | Mongo: source_observations, verification_events                              | none                                                               |
| `sources`          | Source registry, adapter contract, per-source config, rate limits, coverage disclosure                             | Mongo: source_configs                                                        | none                                                               |
| `discovery`        | Discovery job lifecycle, queueing, progress, results, retries, cancellation                                        | Mongo: discovery_jobs, discovery_job_items                                   | `sources`, `businesses`, `provenance`, `dedup`, `credits`, `queue` |
| `enrichment`       | Contact normalization, verification workflows, enrichment runs                                                     | Mongo: enrichment_runs                                                       | `businesses`, `provenance`, `credits`                              |
| `website-analysis` | SSRF-safe fetch, HTML feature detection, opportunity suggestions with evidence                                     | Mongo: website_analyses                                                      | `businesses`, `credits`, `queue`                                   |
| `scoring`          | Configurable, explainable lead score and ICP profiles                                                              | Mongo: scoring_profiles; score snapshot embedded on business                 | `businesses`, `website-analysis`                                   |
| `dedup`            | Candidate generation, match scoring, merge/unmerge with history                                                    | Mongo: duplicate_candidates, merge_history                                   | `businesses`, `provenance`                                         |
| `crm`              | Lead lists, pipeline stages, lead status, assignment, notes, activities, outreach records                          | Mongo: lead_lists, lead_list_items, leads, pipeline_configs, lead_activities | `businesses`, `organizations`                                      |
| `exports`          | CSV export jobs, size limits, signed download                                                                      | Mongo: export_jobs; object storage for files                                 | `crm`, `businesses`, `credits`, `queue`                            |
| `billing`          | Plans, Paystack integration, subscriptions, invoices, payments, refunds, webhooks, reconciliation                  | PG: billing tables                                                           | `organizations`, `credits`, `audit`                                |
| `credits`          | Credit ledger, holds, captures, releases, balance, entitlement checks                                              | PG: credit_ledger, entitlements                                              | none (pure PG)                                                     |
| `usage`            | Usage metering and summaries for the dashboard                                                                     | PG: usage_daily; reads credits                                               | `credits`                                                          |
| `notifications`    | In-app notifications, email dispatch, preferences                                                                  | PG: notification_preferences; Mongo: notifications                           | `mail`                                                             |
| `reports`          | Overview metrics, source breakdown, quality distribution                                                           | reads Mongo + PG                                                             | `businesses`, `discovery`, `crm`, `credits`                        |
| `audit`            | Append-only audit events for sensitive actions                                                                     | Mongo: audit_events (app); PG: billing_audit (money)                         | none                                                               |
| `admin`            | Internal operator views: failed jobs, reconciliation, source health                                                | reads all                                                                    | everything                                                         |
| `queue`            | BullMQ queue registry, job options, dead-letter inspection                                                         | Redis                                                                        | none                                                               |
| `mail`             | Transactional email transport (SMTP via Nodemailer; Mailpit locally)                                               | none                                                                         | none                                                               |

## 5. Request lifecycle and tenant scoping

1. Browser sends request with the access-token cookie to `apps/api`.
2. `AuthGuard` validates the JWT and loads `userId`.
3. `OrgScopeGuard` resolves the active organization from the `X-Organization-Id` header, verifies the user's membership in PostgreSQL, and attaches `{ organizationId, role, permissions }` to the request. A client-supplied organization ID is only ever an assertion checked against membership. It is never trusted on its own.
4. `PermissionsGuard` checks the route's required permission against the role.
5. Every repository method takes `organizationId` as a required first argument. Mongo repositories add `{ organizationId }` to every filter. Prisma repositories add it to every `where`. No repository method can read across organizations except in the `admin` module, which is guarded by a platform-admin flag and is not reachable from the dashboard.
6. Background jobs carry `organizationId` in their payload and re-verify that the organization is active before doing work.

## 6. Database ownership

### MongoDB (business intelligence)

Owns: businesses, source observations, verification events, discovery jobs and items, enrichment runs, website analyses, scoring profiles, duplicate candidates, merge history, lead lists, leads (pipeline state), pipeline configs, lead activities, export jobs, notifications, application audit events, suppression entries, source configs.

Rules:

- Every org-owned document has `organizationId: string` (UUID from PostgreSQL) and compound indexes starting with it.
- JSON Schema validators on every collection at `moderate` level.
- Cursor pagination on all list endpoints; no unbounded `find()`.
- Controlled growth: observation ID arrays capped per field (default 50), job items in a separate collection rather than an embedded array.

### PostgreSQL (identity and money)

Owns: users, organizations, memberships, invitations, sessions, API keys, notification preferences, billing customers, plans, credit packs, subscriptions, invoices, payments, refunds, webhook events, credit ledger, entitlements, reconciliation records, billing audit, usage aggregates, contact submissions.

Rules:

- Money stored as `BIGINT` minor units (kobo) with ISO currency code. No floats.
- Ledger is append-only. Balance is derived; a cached balance column is updated inside the same transaction as the ledger insert.
- All provider references have unique constraints.

### Identifier mapping

| Entity                      | ID type  | Minted by  | Referenced in                                                                      |
| --------------------------- | -------- | ---------- | ---------------------------------------------------------------------------------- |
| User                        | UUID v7  | PostgreSQL | Mongo as `createdByUserId`, `assignedToUserId`, etc.                               |
| Organization                | UUID v7  | PostgreSQL | Mongo as `organizationId` on every doc                                             |
| Business                    | ObjectId | MongoDB    | PG never references businesses directly; usage events store `resourceRef: string`  |
| Discovery job               | ObjectId | MongoDB    | PG credit ledger stores `reference_type = 'discovery_job'`, `reference_id = <hex>` |
| Plan, subscription, payment | UUID v7  | PostgreSQL | Mongo never stores billing state                                                   |

### Cross-database workflows

No distributed transactions. Each workflow is a state machine with durable state in the owning database plus idempotency keys.

**Discovery job with credits**

1. API: validate request, compute `maxRecords`. Mint the job ObjectId up front.
2. PG transaction: insert `credit_ledger` HOLD row with `idempotency_key = job:<jobId>:hold`; fail with `INSUFFICIENT_CREDITS` if balance is short.
3. Mongo: insert `discovery_jobs` doc with `status: queued` and `credits.holdId`.
4. Enqueue BullMQ job `{ jobId, organizationId }`.
5. If step 3 or 4 fails: PG RELEASE of the hold (compensating action, idempotent by key).
6. Worker processes pages, writes items and observations, updates job progress.
7. On completion: PG transaction CAPTURE `billableUnits` and RELEASE the remainder, keyed `job:<jobId>:capture` and `job:<jobId>:release`. Then Mongo job gets terminal status and `credits.settledAt`.
8. Reconciliation job (every 10 min): find Mongo jobs in a terminal state without `settledAt` older than 5 min and settle them; find PG holds older than 24h with no live job and release them.

**Payment to credits** lives entirely inside PostgreSQL. See `docs/DATABASE_DESIGN.md` section 5. MongoDB is not involved.

## 7. Frontend architecture

- One Next.js app with route groups: `(marketing)`, `(auth)`, `(app)`. Marketing pages are static or ISR; dashboard pages are dynamic and fetch through a typed API client.
- Server Components for initial data; TanStack Query on the client for tables, filters, job-status polling and mutations.
- Forms: React Hook Form + Zod resolvers using schemas imported from `packages/contracts`.
- Tables: TanStack Table with server-side pagination, sorting and filtering; column state persisted per user in `localStorage` only (non-authoritative).
- Theming: CSS custom properties defined in `packages/ui/src/tokens.css`; a Tailwind preset maps semantic tokens. Light and dark via `data-theme` and `prefers-color-scheme`.
- Motion: Framer Motion, wrapped in a `useMotionSafe` helper that disables non-essential animation under `prefers-reduced-motion`.
- Responsive baseline is 240px. See `docs/DESIGN_SYSTEM.md` section 7.

## 8. Background processing

Queues (BullMQ, one Redis, every key under `QUEUE_PREFIX`), as built:

| Queue              | Job types                                                                                                                                                                                                                                                                                                                                                                                                               | Concurrency per worker | Rate limit                                                                                  | Attempts                                                                             |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------- | ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `mail`             | `send-email`                                                                                                                                                                                                                                                                                                                                                                                                            | 4                      | provider                                                                                    | 5, exponential from 10 s                                                             |
| `imports`          | `commit-import`                                                                                                                                                                                                                                                                                                                                                                                                         | 2                      | none                                                                                        | 3, exponential from 30 s (resumes)                                                   |
| `discovery`        | `run-discovery-job` (orchestrator), `fetch-source-page`                                                                                                                                                                                                                                                                                                                                                                 | 4                      | per-source token bucket in Redis                                                            | orchestrator 5; pages 4, capped exponential 30 s to 10 min                           |
| `enrichment`       | `website-contacts`, `verify-contact`                                                                                                                                                                                                                                                                                                                                                                                    | 8                      | SafeFetch: 1 request per 2 s per host, 10 per s overall; 600 runs per hour per organization | 3, exponential from 15 s                                                             |
| `website-analysis` | `analyze-website`                                                                                                                                                                                                                                                                                                                                                                                                       | 4                      | SafeFetch (as above)                                                                        | 3, exponential from 15 s                                                             |
| `scoring`          | `recompute-scores`, `score-businesses`                                                                                                                                                                                                                                                                                                                                                                                  | 2                      | none                                                                                        | 3, exponential from 10 s                                                             |
| `dedup`            | `find-duplicates`                                                                                                                                                                                                                                                                                                                                                                                                       | 2                      | none                                                                                        | 2, exponential from 10 s                                                             |
| `exports`          | `build-export`; Stage 10: `build-organization-export` (whole-organization data export, owner only)                                                                                                                                                                                                                                                                                                                      | 2                      | none                                                                                        | 3, exponential from 15 s                                                             |
| `bulk`             | `run-bulk-operation`                                                                                                                                                                                                                                                                                                                                                                                                    | 2                      | none                                                                                        | 3, exponential from 10 s (resumes)                                                   |
| `billing`          | `process-webhook`, `verify-payment`, `generate-invoice-pdf`; repeatable every 10 min: `reconcile-credits` (unsettled jobs, orphan holds), `reconcile-billing` (stuck payments, unprocessed webhooks, subscriptions past their period)                                                                                                                                                                                   | 2                      | none                                                                                        | 5, exponential from 15 s; repeatables 1                                              |
| `maintenance`      | repeatable every 10 min: `purge-expired-content`, `refresh-scores`, `recover-enrichment`, `cleanup-exports`, `recover-crm-jobs`, `rollup-usage`, `scan-organization-deletions` (Stage 10: deletion reminders, then one `purge-organization` job per organization past its 14-day grace); daily: `rollup-usage` (90 days, scheduler `rollup-usage-full`), `overture-sync` (STAC check, on by default in production only) | 1                      | none                                                                                        | 1 (usage full 2, Overture 3 an hour apart, purge 3 and re-enqueued by the next scan) |

The Phase 0 table listed `normalize-business` (normalization runs inline at ingest instead) and a single `reconcile` job (split into `reconcile-credits` and `reconcile-billing`).

Every processor is idempotent: deterministic job ids per resource (`import-<id>`, `analysis-<id>`, `export-<id>`, `bulk-<id>`, `webhook-<event>-a<attempt>`, `verify-payment-<id>-<bucket>`), resumable work (imports and bulk operations continue after the last recorded row), upserts keyed by deterministic ids (discovery items, observations) and ledger idempotency keys. Payloads are validated with Zod and loaded with the payload's `organizationId`; a malformed payload or a resource outside that organization fails at once with `UnrecoverableError` (no retries), which the tenant-isolation suite checks for every job type. Failed jobs stay in the BullMQ failed set for 14 days; that set is the dead-letter queue, inspected and retried with `pnpm queue:admin` (docs/OPERATIONS.md). Graceful shutdown waits for active jobs up to 30 s. `WORKER_QUEUES` dedicates a worker process to some queues; any process running `billing` or `maintenance` registers the repeatable schedules. Logs are structured JSON (pino) with `requestId`, `jobId` and `organizationId`; job outcomes, durations and enqueue-to-start waits are Prometheus metrics (docs/OPERATIONS.md, "Monitoring").

## 9. First discovery source: decision

**Decided 2026-10-25: Overture Maps Places is the first discovery source. Google Places is unavailable.**

### Why not Google Places

The Phase 0 recommendation was Google Places API (New). The live Google Maps Platform Terms of Service (last modified 2026-08-26), checked on 2026-10-25, rule it out for a lead directory. Section 3.2.3 says customers will not:

- **(a)(iii)** "copy and save business names, addresses, or user reviews";
- **(b)** cache Google Maps content except as the Maps Service Specific Terms allow, which is only place IDs (indefinitely) and latitude and longitude (30 consecutive calendar days, Places API section 14.3);
- **(d)(iii)** "use the Google Maps Core Services in a listings or directory service".

LeadForge stores business records and is a directory of them, so no retention setting makes Google Places compliant. The adapter code (`packages/core/src/sources/google-places`) is kept and tested, but its policy is `blockedByTerms`: the registry reports it as `not_available` with reason `provider_terms` whether or not a key is set, and every estimate or job on it is refused with `SOURCE_POLICY_BLOCKED`. Values collected before the decision keep their zero-day retention and are purged.

### Overture Maps Places

| Item                   | Decision                                                                                                                                                                                                                                                                                                                                                                          |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Data                   | Overture Maps Foundation places theme (schema v2.0.0; release 2026-10-21.0 has 162,475 Nigerian places, 98% from Meta)                                                                                                                                                                                                                                                            |
| Licences               | Per record (`sources[].license`): CDLA-Permissive-2.0 (99.3%), CC0-1.0 (AllThePlaces, 0.6%), Apache-2.0 (Foursquare, 0.1%). All allow storage, modification and commercial reuse with no retention limit. Obligations: attribution, the licence text with shared data, and for Foursquare the NOTICE and a notice of changes (docs/SECURITY_AND_DATA_COLLECTION.md section 6)     |
| Ingestion              | Monthly snapshot into the platform-level staging collection `overture_places` (keyed by GERS id). The worker's `overture-sync` maintenance job checks the STAC catalogue daily and loads a new release once; `pnpm overture:sync` runs it by hand. DuckDB (`@duckdb/node-api`) reads only the release files whose bounding boxes overlap Nigeria (bbox pushdown, then country NG) |
| States and LGAs        | Point-in-polygon against the release's Overture division areas (37 states, 773 LGAs), in one in-memory pass with a grid index (6 s for Nigeria; DuckDB's spatial join measured 20 s plus 3 s to load the extension, with the same result). Overture's own address regions are half empty and not ISO codes. Boundaries are ODbL and CC BY 4.0 and are credited                    |
| Discovery              | Jobs query the staging catalogue (indexed by state, LGA, city, category, confidence and location); they never call Overture. The estimate is an exact count, so the credit hold is exact                                                                                                                                                                                          |
| Duplicates             | Places sharing an upstream record (7% of Nigeria, same Facebook page under two GERS ids) or a numeric Facebook page and name across datasets are grouped at sync time; one representative is offered. A business keeps the group's keys, so later jobs never offer, or charge for, the same place again                                                                           |
| Freshness and removals | Field freshness is the release date. Places a release drops are marked retired, never deleted, and are no longer offered; a sync that would retire more than 5% of places stops and needs `--force`                                                                                                                                                                               |
| Coverage caveats       | Thin outside Lagos and the FCT (14 states under 1,000 places); 96% of phones are mobile numbers and 80% of emails free-mail, often personal data under the Nigeria Data Protection Act 2023                                                                                                                                                                                       |

Other candidates, unchanged from Phase 0:

| Candidate                                                                   | Verdict                                                                 |
| --------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| Foursquare Places API                                                       | Possible later source (commercial tiers permit storage)                 |
| OpenStreetMap (Overpass)                                                    | Not for release 1: ODbL share-alike risk for derivative databases       |
| Business's own public website                                               | Included as enrichment (contact page, `mailto:`, `tel:`, `wa.me` links) |
| CSV and manual import                                                       | Included from Phase 2                                                   |
| CAC portal, Facebook, Instagram, LinkedIn, Jiji, VConnect, Google Maps HTML | Excluded (scraping prohibited, login-walled or anti-bot protected)      |

WhatsApp status is still never inferred from a phone number: only an explicit `wa.me` link or WhatsApp label on the business's own website, or a team member's assertion, sets it.

## 10. Non-functional targets for release 1

- API p95 under 300ms for list endpoints at 100k businesses per org. Measured in Phase 7 (`infra/load/README.md`) on the development laptop with every service in Docker on the same machine: 265 ms p95 across list requests at 2 concurrent users (27 requests per second), with three heavier shapes above target (field-state filters 453 ms, two-word search 415 ms, filter plus a different sort 312 ms); at 8 users the shared host saturates (804 ms). Confirm on production-like infrastructure before launch.
- Discovery throughput bounded by source quotas, not by our worker. Overture discovery reads a local catalogue, so it is bounded by MongoDB: measured 4.7 job creations per second sustained with no errors; processing was slower (6.6 s per page attempt) in a worst case where 295 jobs searched the same places, and scales with worker concurrency and a dedicated database host.
- Zero cross-tenant reads: enforced by repository signatures and verified by the tenant-isolation suite (`route-isolation.test.ts`: every route and every queue job type, docs/SECURITY_AND_DATA_COLLECTION.md section 3).
- Duplicate webhook delivery produces zero duplicate ledger rows: tested.
- 240px to 1440px layouts verified in CI with Playwright viewport checks.
- WCAG 2.1 AA for dashboard controls.
- Observability: Prometheus metrics from the API and the worker, a Grafana dashboard and alert rules (`infra/monitoring/`); backups with a tested restore (docs/OPERATIONS.md: RPO 5 minutes with managed point-in-time recovery, 24 hours with dumps only; RTO 4 hours).

## 11. Risks

| Risk                                  | Mitigation                                                                                                                          |
| ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Source terms limit retention          | Field-level `expiresAt` from source policy; stale/expired states in UI; refresh jobs                                                |
| Paystack webhook delays or loss       | Verify endpoint + reconciliation job; never grant on redirect                                                                       |
| Credit double-spend under concurrency | Ledger insert under `SELECT ... FOR UPDATE` on the customer balance row; idempotency keys                                           |
| SSRF via website analysis             | DNS resolve + IP deny list checked on every hop; IP pinning; worker egress allowlist at deployment                                  |
| Tenant leak through a missed filter   | Repository API requires `organizationId` positional arg; lint rule bans raw collection access outside repositories; isolation tests |
| Scope creep in UI                     | Navigation shows only implemented features; unavailable items are disabled with a "Coming soon" badge and no route                  |
| Windows developer environment         | Docker Compose for services; scripts are cross-platform Node scripts, no bash-only steps                                            |

## 12. Open questions for approval (Gate 0)

1. Approve Google Places API (New) as the first discovery source, with policy-driven retention handling? Alternative: start with CSV import plus website enrichment only.
2. Approve first-party authentication (instead of Clerk or Auth.js)?
3. Approve PostgreSQL as the owner of users and organizations (Mongo holds references only)?
4. Approve the credit model: hold on queue, capture per produced record, release remainder; website analysis 1 credit each; exports free within plan cap?
5. Approve the monorepo layout in section 3?
6. Customer API keys: defer beyond release 1? Recommendation: defer.
7. Dark mode: ship in release 1? Recommendation: ship, since tokens support it from day one.
8. Project location: the repository was created at `C:\Users\user\LeadForge`. Confirm or name a different path.
