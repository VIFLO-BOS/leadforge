# LeadForge Architecture

Status: Phase 0 proposal, pending approval. Last updated 2026-10-24.

This document defines the system shape for the first production release. It is the authority for module boundaries and database ownership. Detailed data models live in `docs/DATABASE_DESIGN.md`, endpoint shapes in `docs/API_CONTRACTS.md`, and the security model in `docs/SECURITY_AND_DATA_COLLECTION.md`.

## 1. Summary of decisions

| Area                    | Decision                                                                                                                                                                           | Why                                                                                                    |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Deployment shape        | Modular monolith: one Next.js app, one NestJS API, one NestJS worker process sharing the API's modules                                                                             | Independent scaling of collection work without microservice overhead                                   |
| Repository              | pnpm workspace monorepo with Turborepo task orchestration                                                                                                                          | Shared contracts and UI between web, API and worker; single CI                                         |
| Identity ownership      | PostgreSQL owns users, organizations, memberships, invitations, sessions, API keys                                                                                                 | Billing needs referential integrity to orgs and users; low write volume; relational by nature          |
| Business data ownership | MongoDB owns businesses, observations, jobs, analyses, lead lists, activities, audit events                                                                                        | Flexible provenance documents, high write volume, per-org scoped queries                               |
| Billing ownership       | PostgreSQL (Prisma) is the only authority for plans, subscriptions, payments, invoices, credits, entitlements                                                                      | Money needs ACID transactions and a ledger                                                             |
| Authentication          | First-party auth in the API: Argon2id passwords, short-lived access JWT, rotating refresh tokens in httpOnly cookies, email verification, password reset                           | Org scoping and RBAC live in the API anyway; avoids vendor lock-in; no third-party auth cost at launch |
| Validation              | Zod schemas in `packages/contracts`, consumed by both Next.js forms and a NestJS `ZodValidationPipe`                                                                               | One source of truth for request shapes; no duplicated business rules                                   |
| Queue                   | Redis + BullMQ, queues per workload with per-source rate limiters                                                                                                                  | Durable retries, backoff, concurrency control                                                          |
| Payments                | Paystack: server-side initialize, signature-verified idempotent webhooks, verify-before-grant, reconciliation job                                                                  | Required by brief; Flutterwave behind the same `PaymentProvider` interface later                       |
| First discovery source  | Recommended: Google Places API (New) with license-compliant retention, plus the business's own website as an enrichment source, plus CSV import. Requires approval. See section 9. | Official API, strong Nigerian coverage, no scraping of restricted sites                                |
| Language                | TypeScript everywhere. No Python in release 1                                                                                                                                      | Simpler deployment; no workload yet justifies a second runtime                                         |
| Responsive baseline     | 240px minimum viewport width, no horizontal page overflow                                                                                                                          | Product requirement                                                                                    |

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

Queues (BullMQ, one Redis):

| Queue              | Job types                                                  | Concurrency per worker | Rate limit                           | Retries                   |
| ------------------ | ---------------------------------------------------------- | ---------------------- | ------------------------------------ | ------------------------- |
| `discovery`        | `run-discovery-job` (orchestrator), `fetch-source-page`    | 4                      | per-source limiter                   | 3, exponential 30s to 10m |
| `enrichment`       | `normalize-business`, `verify-contact`, `website-contacts` | 8                      | per-provider                         | 3                         |
| `website-analysis` | `analyze-website`                                          | 4                      | per-domain 1 req / 2s, global 10 rps | 2                         |
| `dedup`            | `find-duplicates`                                          | 2                      | none                                 | 2                         |
| `exports`          | `build-export`                                             | 2                      | none                                 | 1                         |
| `billing`          | `verify-payment`, `process-webhook`, `reconcile`           | 2                      | none                                 | 5                         |
| `mail`             | `send-email`                                               | 4                      | provider                             | 5                         |

Every processor is idempotent by `(jobType, payload.idempotencyKey)`. Timeouts per job type. Failed jobs stay in the BullMQ failed set for 14 days and appear in the admin dead-letter view. Graceful shutdown waits for active jobs up to 30s. Logs are structured JSON (pino) with `requestId`, `jobId` and `organizationId`.

## 9. First discovery source: recommendation

The brief requires a permitted source. Evaluation:

| Candidate                                                                            | Permitted method                                         | Nigerian coverage | Retention terms                                                                                                                                                                                                             | Verdict                                                                                         |
| ------------------------------------------------------------------------------------ | -------------------------------------------------------- | ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Google Places API (New)                                                              | Official API, paid                                       | Strong            | Place IDs may be stored indefinitely; other place content may be cached for a limited period (30 days under current policy, to be confirmed against the live terms at Phase 3); attribution required; no bulk export resale | **Recommended first source**, with policy-driven freshness enforcement on Google-sourced fields |
| Foursquare Places API                                                                | Official API                                             | Moderate          | Commercial tiers permit storage; attribution                                                                                                                                                                                | Second candidate                                                                                |
| OpenStreetMap (Overpass)                                                             | Public API, ODbL                                         | Patchy for SMEs   | Share-alike obligations for derivative databases are a legal risk for a proprietary dataset                                                                                                                                 | Not for release 1; needs legal review                                                           |
| Business's own public website                                                        | Direct fetch respecting robots.txt                       | n/a               | Public data; treated as enrichment, not discovery                                                                                                                                                                           | **Included as enrichment source** (contact page, `mailto:`, `tel:`, `wa.me` links)              |
| CSV / manual import                                                                  | n/a                                                      | n/a               | User-supplied; user attests lawful basis                                                                                                                                                                                    | **Included from Phase 2**                                                                       |
| Nigerian CAC portal, Facebook, Instagram, LinkedIn, Jiji, VConnect, Google Maps HTML | Scraping prohibited, login-walled, or anti-bot protected | n/a               | n/a                                                                                                                                                                                                                         | Excluded                                                                                        |

Consequences of the Google Places decision that the product must surface honestly:

- Fields sourced from Google carry `expiresAt` from source policy. After expiry they are marked `expired` and hidden from the canonical profile unless corroborated by another source. The place ID is retained so the record can be refreshed.
- Google attribution appears wherever Google-sourced data is shown.
- WhatsApp status is never inferred from a Google phone number. It is only set when a `wa.me` or `api.whatsapp.com` link, or an explicit WhatsApp label, is observed on the business's own website, or when a team member asserts it after contact.

**This choice requires explicit approval and a Google Maps Platform billing account.** If declined, the Phase 3 fallback is CSV import plus website enrichment, with a directory API added when one is approved.

## 10. Non-functional targets for release 1

- API p95 under 300ms for list endpoints at 100k businesses per org.
- Discovery throughput bounded by source quotas, not by our worker.
- Zero cross-tenant reads: enforced by repository signatures and verified by the tenant-isolation suite.
- Duplicate webhook delivery produces zero duplicate ledger rows: tested.
- 240px to 1440px layouts verified in CI with Playwright viewport checks.
- WCAG 2.1 AA for dashboard controls.

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
