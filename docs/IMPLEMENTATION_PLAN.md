# LeadForge Implementation Plan

Status: Phase 0 proposal, pending approval. Last updated 2026-10-24.

Each phase ends with a report covering what was implemented, files created or changed, database changes, tests executed with their actual results, build and type-check output, known limitations, security notes, and what needs approval. Each phase then stops for explicit approval.

## Phase 0: Architecture (this phase)

Deliverables: `ARCHITECTURE.md`, `docs/PRODUCT_REQUIREMENTS.md`, `docs/DESIGN_SYSTEM.md`, `docs/DATABASE_DESIGN.md`, `docs/API_CONTRACTS.md`, `docs/SECURITY_AND_DATA_COLLECTION.md`, this plan.

Gate 0 questions are listed in `ARCHITECTURE.md` section 12.

## Phase 1: Foundation

Scope:

1. Monorepo: pnpm workspaces, Turborepo, shared strict `tsconfig` with `noUncheckedIndexedAccess`, ESLint flat config, Prettier, Husky plus lint-staged, conventional commits.
2. `infra/docker-compose.yml`: Postgres 16, MongoDB 7 (single-node replica set so transactions work), Redis 7, Mailpit. A `pnpm dev:infra` script.
3. `packages/contracts`: env schema, error codes, pagination schemas, auth and organization DTOs.
4. `packages/db-postgres`: Prisma schema for identity tables and billing tables (billing tables are created now and used from Phase 3 for credits and Phase 6 for payments), initial migration, repository base with org scoping.
5. `packages/db-mongo`: connection module, index and validator sync script, validators for all release-1 collections, repository base requiring `organizationId`.
6. `packages/core`: `auth`, `organizations`, `authz`, `mail`, `audit`, `queue`, `health`, logging interceptor, exception filter, request-id middleware, CSRF, Redis-backed rate limiting.
7. `apps/api`: bootstraps core, Swagger, health, auth and organization endpoints.
8. `apps/worker`: bootstraps the queue module with a `send-email` processor only.
9. `packages/ui`: tokens, Tailwind preset, fonts, base components (Button, Input, Textarea, Select, Badge, StatusIndicator, Card, PageHeader, Breadcrumbs, EmptyState, Skeleton, ErrorState, Dialog, ConfirmDialog, Sheet, Toast, Tooltip, DropdownMenu, Tabs, Avatar), theme provider, `useMotionSafe`.
10. `apps/web`: route groups, marketing shell (nav, footer, home sections with real copy and no fabricated data), auth pages wired to the API, dashboard shell (sidebar, topbar, org switcher, Overview with empty state), all 240px-safe.
11. CI: lint, typecheck, unit tests, build on push and pull request.

Tests: auth unit tests (hashing, token rotation, reuse detection), authz matrix tests, organization membership integration tests against Dockerized Postgres, tenant-scope repository tests, Playwright smoke at 240, 320, 375, 768, 1024 and 1440 px for shell pages with an overflow assertion.

Gate 1: review of repository structure, auth flows and shell UI at all widths.

## Phase 2: Business records and dashboard

Scope: `businesses` and `provenance` modules; business repository with cursor pagination and filters; business endpoints; CSV import (user source) with mapping UI and provenance; directory page (DataTable, FilterBar, SearchField, row selection, suppress action; add-to-list arrives with lists in Phase 5 and is hidden until then); detail page with overview, contacts with field states, provenance panel, verification history, corrections dialog; synthetic seed data labeled "(Sample)"; export foundation (synchronous CSV up to 1,000 rows; async jobs in Phase 5); Overview metrics that exist at this point (business counts, verified contact counts); Sources page showing the registry read-only.

Tests: repository filter and pagination tests; import parser tests (malformed rows, formula injection, phone and email normalization); tenant isolation on all business endpoints; component tests for DataTable at narrow widths; end-to-end: import CSV, see rows, open detail, correct a field, provenance shows the `user_edit` observation.

Gate 2: directory and detail UX, import behavior, provenance display.

## Phase 3: Discovery engine

Entry condition: Gate 0 source decision approved and the source's terms reviewed.

Scope: `sources` registry and adapter contract (`describe()`, `validateSpec()`, `estimate()`, `search()` as an async iterator of pages, `mapToObservations()`, `policy`); the first approved adapter with field-level `expiresAt`; `discovery` module with job lifecycle, BullMQ orchestrator and page processors, idempotent item upserts, per-source rate limiter, retries with backoff, cancellation, progress events; `credits` module with hold, capture and release against the PostgreSQL ledger (development organizations receive a seeded grant until purchasing arrives in Phase 6); dedup stages 1 to 3 (exact domain, phone, email) at ingest; job wizard with estimate; job list; job detail with items, errors, source outcomes and retry-failed; notifications for job completion and failure; the all-jobs page.

Tests: adapter contract tests with recorded fixtures (no live calls in CI); orchestrator tests for retry, backoff, cancel and timeout; idempotent reprocessing of the same page; credit hold, capture and release including partial failure; concurrent hold test; reconciliation of unsettled jobs; tenant isolation on jobs. One manual live run against the real API in a development project, documented with actual output.

Gate 3: adapter reliability on real runs, cost per record, retention handling, job UX.

## Phase 4: Enrichment and qualification

Scope: contact normalization service (country-aware phone parsing with libphonenumber-js, email syntax plus MX plus disposable-domain checks, domain canonicalization, social URL normalization); website-contacts enrichment via `SafeFetch`; email verification workflow and verification events; website analysis module with detections, opportunities and evidence; scoring profiles, recompute job, per-business explanation; dedup stages 4 to 6 (name plus location similarity, candidate scoring, review queue, merge and undo with history); freshness, stale and expired indicators with a refresh action; website analysis list page and detail panels; duplicate review UI; scoring settings UI.

Tests: SSRF deny list including DNS rebinding and IPv6-mapped addresses, redirect hop re-validation, size and timeout aborts, robots handling; detection fixtures (pages with and without forms, booking widgets, viewport meta); scoring determinism and weight validation; merge and undo round-trip restores exact snapshots; similarity thresholds never merge name-only matches.

Gate 4: evidence quality of detections, dedup false-positive rate, score explanation clarity.

## Phase 5: CRM and exports

Scope: lead lists; pipeline config and board (keyboard-accessible stage moves; drag optional); lead assignment; notes, activities and outreach records; bulk operations with confirmation and async execution; async export jobs with row caps and signed downloads; usage aggregates; Reports page; Activities and Outreach pages; Overview completed with recent activity, jobs and breakdowns.

Tests: permission matrix for sales rep versus researcher; export cap enforcement and permission-scoped exports; bulk action idempotency; pipeline config validation; end-to-end: add to list, move stage, log activity, export list.

Gate 5: CRM flows and export behavior.

## Phase 6: Billing

Scope: plans and credit packs seeded with placeholder flags; Paystack provider behind a `PaymentProvider` interface; checkout endpoints; webhook endpoint with raw-body signature verification and event dedupe; `process-webhook` and `verify-payment` processors; subscription lifecycle (incomplete, active, past_due, cancelled, expired); invoices with PDF generation; refunds and reversals; entitlement derivation and enforcement (member cap, export cap, discovery enabled); reconciliation processors; Billing and Usage pages; pricing page and marketing pricing preview from live plans; failed-payment notifications and in-app banners.

Tests: signature verification (valid, tampered body, wrong secret); the same webhook replayed 10 times concurrently yields one payment and one grant; verify mismatch on amount or currency yields no grant and an alert; concurrent credit consumption; failed job refund path; reversal drives balance negative and blocks discovery; reconciliation fixes stuck pending payments and orphan holds; entitlement recalculation on plan change. Manual test against Paystack test mode with documented transaction references.

Gate 6: billing correctness and reconciliation evidence.

## Phase 7: Hardening and release

Scope: security review against the security document; tenant-isolation suite completion; load test of the directory and discovery queue with k6; audit of error, empty and loading states on every page; accessibility pass (axe plus manual keyboard and screen reader on key flows); responsive pass at 240 to 1440 px with screenshot comparison in CI; monitoring dashboards and alerts; backup and restore drill; `docs/OPERATIONS.md` and `docs/DEPLOYMENT.md`; environment documentation; release end-to-end suite covering the sixteen acceptance criteria; legal pages finalized with the data collection policy.

Gate 7: release approval.

## Testing strategy summary

| Layer                                                    | Tool                                                                       | Runs                           |
| -------------------------------------------------------- | -------------------------------------------------------------------------- | ------------------------------ |
| Unit                                                     | Vitest                                                                     | every push                     |
| Integration (Postgres, Mongo, Redis via Docker services) | Vitest with compose services in CI                                         | every push                     |
| API contract                                             | Supertest against the Nest app with real databases                         | every push                     |
| Frontend components                                      | Vitest plus Testing Library                                                | every push                     |
| End-to-end                                               | Playwright at 240, 320, 375, 768, 1024, 1440 px, reduced motion on and off | pull requests to main, nightly |
| Load                                                     | k6                                                                         | Phase 7 and before releases    |
| Security static                                          | eslint-plugin-security, gitleaks, pnpm audit                               | every push                     |

Failure scenarios are first-class: every module's test file includes at least one test per documented error code it can raise.

## Environment variables (initial list, finalized in the Phase 1 `.env.example`)

`NODE_ENV`, `APP_URL`, `API_URL`, `PORT`, `DATABASE_URL`, `MONGODB_URI`, `MONGODB_DB`, `REDIS_URL`, `JWT_PRIVATE_KEY`, `JWT_PUBLIC_KEY`, `JWT_ACCESS_TTL`, `JWT_REFRESH_TTL`, `COOKIE_DOMAIN`, `CSRF_SECRET`, `SMTP_URL`, `MAIL_FROM`, `PAYSTACK_SECRET_KEY`, `PAYSTACK_WEBHOOK_IP_ALLOWLIST` (optional), `GOOGLE_PLACES_API_KEY` (if approved), `SAFE_FETCH_USER_AGENT`, `OBJECT_STORAGE_*` (Phase 5), `SENTRY_DSN` (optional), `LOG_LEVEL`, `WORKER_QUEUES` (optional comma list).

## Definition of done (every phase)

- Type check, lint, unit, integration and relevant end-to-end tests pass locally and in CI, with output included in the phase report.
- No placeholder buttons. Unavailable features are disabled with a visible label and no dead route.
- Loading, empty, error and success states implemented for every new screen.
- Responsive from 240px, verified by the Playwright viewport suite.
- `API_CONTRACTS.md` and `DATABASE_DESIGN.md` updated to reflect the shipped shape.
- A security considerations section in the phase report.
