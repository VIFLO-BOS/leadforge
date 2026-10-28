# LeadForge Deployment

Status: release 1 deployment guide, written in Phase 7. Last updated 2026-10-27.

Operations after go-live (monitoring, runbooks, backups, incidents) are in `docs/OPERATIONS.md`. Local development is in `docs/DEVELOPMENT.md`.

## 1. Processes

LeadForge is three processes built from this monorepo (Node.js 22 or newer; CI uses 24) plus three managed data stores.

| Process                      | Build                                                                                                      | Start                                | Listens                                                                  | Scale                                                                   |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------- | ------------------------------------ | ------------------------------------------------------------------------ | ----------------------------------------------------------------------- |
| web (Next.js)                | `pnpm --filter @leadforge/web build` with `API_URL` (rewrite target) and `NEXT_PUBLIC_*` set at build time | `pnpm --filter @leadforge/web start` | 3000                                                                     | Stateless; any number of replicas                                       |
| api (NestJS)                 | `pnpm exec turbo run build --filter=@leadforge/api`                                                        | `node apps/api/dist/main.js`         | `API_PORT` (4000), `/api/v1/*` and `/metrics`                            | Stateless; any number of replicas behind the web app or a load balancer |
| worker (NestJS, no HTTP API) | `pnpm exec turbo run build --filter=@leadforge/worker`                                                     | `node apps/worker/dist/main.js`      | metrics only, `WORKER_METRICS_HOST:WORKER_METRICS_PORT` (127.0.0.1:9464) | One or more; split by queue with `WORKER_QUEUES`                        |

| Store      | Version                       | Notes                                                                                                                                                              |
| ---------- | ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| PostgreSQL | 16                            | Identity, organizations, billing, credits, usage. Managed service with point-in-time recovery                                                                      |
| MongoDB    | 7, replica set (transactions) | Business data, jobs, audit, Overture staging catalogue. MongoDB Atlas (M10 or larger for the 160k-place catalogue plus organizations' data) with continuous backup |
| Redis      | 7                             | BullMQ queues, rate limits, caches, session revocation keys. `maxmemory-policy noeviction` (evicting queue keys loses jobs); persistence (AOF) on                  |

Object storage (S3 or compatible) holds export ZIPs and invoice PDFs. SMTP delivers mail (any provider; Mailpit locally).

The browser talks only to the web app. The web app's `/api/:path*` rewrite proxies to the API, so cookies are first-party and CORS is not involved in normal use (the API still allows only `APP_URL`). Do not expose the API's `/metrics` publicly without `METRICS_TOKEN`.

### Startup order and checks

1. Data stores up; PostgreSQL migrations applied; MongoDB collections synced (below).
2. API and worker: both validate the whole environment at boot (Zod schema `packages/contracts/src/env.ts`) and exit with the list of bad variables. Readiness: `GET /api/v1/health/ready` (Postgres, Mongo, Redis with latencies).
3. Web last (its build bakes `API_URL`).

## 2. Environment variables

Secrets come from the hosting platform's secret store, never from files in the image. "Secret" means: rotate it as described in `docs/OPERATIONS.md` and never log it. "API" and "worker" say which process reads the variable (both validate the same schema, so unset optional values are fine).

### Core

| Variable        | Default       | Secret | Used by                | Notes                                                                                                                                                |
| --------------- | ------------- | ------ | ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `NODE_ENV`      | `development` |        | all                    | `production` in production. Turns on production-only refusals (below)                                                                                |
| `LOG_LEVEL`     | `info`        |        | api, worker            | `fatal` to `trace`, or `silent`                                                                                                                      |
| `APP_URL`       | required      |        | api, worker            | Public web origin, e.g. `https://app.leadforge.example`. Email links, CORS origin, cross-site check                                                  |
| `API_URL`       | required      |        | api, worker, web build | Public API origin (licence links in exports); for the web build, where the rewrite proxies to                                                        |
| `API_PORT`      | `4000`        |        | api                    | Port the API binds                                                                                                                                   |
| `DATABASE_URL`  | required      | yes    | api, worker            | PostgreSQL connection string                                                                                                                         |
| `MONGODB_URI`   | required      | yes    | api, worker            | MongoDB connection string (replica set)                                                                                                              |
| `MONGODB_DB`    | required      |        | api, worker            | Database name (organization data and the Overture catalogue)                                                                                         |
| `REDIS_URL`     | required      | yes    | api, worker            | Redis URL (include the database number if shared)                                                                                                    |
| `QUEUE_PREFIX`  | `leadforge`   |        | api, worker            | BullMQ key prefix; API and worker must agree. Give staging its own prefix on a shared Redis                                                          |
| `WORKER_QUEUES` | empty (all)   |        | worker                 | Comma list of queues this worker runs: `mail, imports, discovery, enrichment, website-analysis, dedup, scoring, exports, bulk, billing, maintenance` |

### Authentication and HTTP security

| Variable                  | Default             | Secret | Used by      | Notes                                                                                                                                                                                                                                                                                                                                                                                   |
| ------------------------- | ------------------- | ------ | ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `JWT_PRIVATE_KEY`         | none                | yes    | **api only** | Ed25519 JWK, base64url (`pnpm gen:keys`). The API refuses to start without it; leave it unset on workers                                                                                                                                                                                                                                                                                |
| `JWT_PUBLIC_KEY`          | required            |        | api, worker  | The matching public key                                                                                                                                                                                                                                                                                                                                                                 |
| `JWT_ACCESS_TTL_SECONDS`  | `900`               |        | api          | Access token lifetime                                                                                                                                                                                                                                                                                                                                                                   |
| `JWT_REFRESH_TTL_SECONDS` | `2592000`           |        | api          | Refresh token (session) lifetime, 30 days                                                                                                                                                                                                                                                                                                                                               |
| `COOKIE_DOMAIN`           | `localhost`         |        | api          | Cookie domain; the web app's host in production                                                                                                                                                                                                                                                                                                                                         |
| `COOKIE_SECURE`           | `false`             |        | api          | **Must be `true` in production** (the API refuses to start otherwise)                                                                                                                                                                                                                                                                                                                   |
| `CSRF_SECRET`             | required, 32+ chars | yes    | api          | Session-bound CSRF tokens; also derives the export link key when `EXPORT_SIGNING_SECRET` is unset                                                                                                                                                                                                                                                                                       |
| `TRUST_PROXY_HOPS`        | `1`                 |        | api          | Proxies in front of the API that append to `X-Forwarded-For`. Count every hop on the way in: load balancer or CDN, plus the web app when browsers reach the API through its `/api` rewrite (typically 2). Rate limits, audit IPs and the webhook IP allowlist read the address this many hops from the right; a wrong value either lumps users together or lets clients spoof addresses |
| `RATE_LIMIT_PER_MINUTE`   | `600`               |        | api          | Requests per minute per user (or per address when signed out); sensitive routes keep their own tighter limits. Raise only for load tests                                                                                                                                                                                                                                                |

### Discovery, Overture and website fetching

| Variable                                                                                | Default                                               | Secret | Used by     | Notes                                                                                           |
| --------------------------------------------------------------------------------------- | ----------------------------------------------------- | ------ | ----------- | ----------------------------------------------------------------------------------------------- |
| `OVERTURE_STAC_URL`                                                                     | `https://stac.overturemaps.org/catalog.json`          |        | worker      | Release catalogue                                                                               |
| `OVERTURE_SYNC_SCHEDULE`                                                                | on in production                                      |        | worker      | Registers the daily STAC check                                                                  |
| `OVERTURE_SYNC_INTERVAL_MS`                                                             | `86400000`                                            |        | worker      | Check interval                                                                                  |
| `OVERTURE_PAGE_SIZE`                                                                    | `100`                                                 |        | worker      | Places per discovery page                                                                       |
| `OVERTURE_LOCAL_PLACES_PATH`, `OVERTURE_LOCAL_DIVISIONS_PATH`, `OVERTURE_LOCAL_RELEASE` | empty                                                 |        | worker      | Development only; refused in production                                                         |
| `DISCOVERY_JOB_TIMEOUT_MS`                                                              | `7200000`                                             |        | worker      | A job running longer is stopped and settled                                                     |
| `DISCOVERY_RETRY_BASE_MS` / `DISCOVERY_RETRY_MAX_MS`                                    | `30000` / `600000`                                    |        | worker      | Page retry backoff                                                                              |
| `DISCOVERY_PAGE_ATTEMPTS`                                                               | `4`                                                   |        | worker      | Attempts per page                                                                               |
| `DISCOVERY_JOBS_PER_HOUR`                                                               | `30`                                                  |        | api         | Job creations per organization per hour                                                         |
| `GOOGLE_PLACES_API_KEY`                                                                 | empty                                                 | yes    | api, worker | Kept for the adapter's tests; Google is unavailable under its terms whether or not a key is set |
| `GOOGLE_PLACES_FIXTURE_MODE`                                                            | `false`                                               |        | api, worker | Development and tests only; refused in production                                               |
| `SAFE_FETCH_USER_AGENT`                                                                 | `LeadForgeBot/1.0 (+<APP_URL>/legal/data-collection)` |        | worker      | Must start with a product token                                                                 |
| `SAFE_FETCH_HOST_RPS` / `SAFE_FETCH_GLOBAL_RPS`                                         | `0.5` / `10`                                          |        | worker      | Per-host and global fetch rates                                                                 |
| `SAFE_FETCH_TIMEOUT_MS` / `SAFE_FETCH_RETRY_DELAY_MS`                                   | `10000` / `2000`                                      |        | worker      | Deadline per request; retry delay for an unreachable home page                                  |
| `SAFE_FETCH_HOST_OVERRIDES`                                                             | empty                                                 |        | worker      | Development and tests only; refused in production                                               |

### Exports and object storage

| Variable                                                            | Default                    | Secret | Used by     | Notes                                                                                                                                   |
| ------------------------------------------------------------------- | -------------------------- | ------ | ----------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `OBJECT_STORAGE_DRIVER`                                             | `local`                    |        | api, worker | `s3` in production (`local` needs a directory shared by the API and the worker)                                                         |
| `OBJECT_STORAGE_LOCAL_DIR`                                          | OS temp dir                |        | api, worker | For `local`                                                                                                                             |
| `OBJECT_STORAGE_ENDPOINT`                                           | AWS for the region         |        | api, worker | MinIO, R2 and other S3-compatible services                                                                                              |
| `OBJECT_STORAGE_REGION`                                             | `us-east-1`                |        | api, worker |                                                                                                                                         |
| `OBJECT_STORAGE_BUCKET`                                             | none                       |        | api, worker | Required for `s3`. Private bucket, no public access, server-side encryption on, lifecycle rule deleting `exports/` objects after 8 days |
| `OBJECT_STORAGE_ACCESS_KEY_ID` / `OBJECT_STORAGE_SECRET_ACCESS_KEY` | none                       | yes    | api, worker | Required for `s3`; least privilege: get, put, delete on the bucket only                                                                 |
| `OBJECT_STORAGE_FORCE_PATH_STYLE`                                   | `true`                     |        | api, worker | `false` for AWS virtual-hosted style                                                                                                    |
| `EXPORT_SIGNING_SECRET`                                             | derived from `CSRF_SECRET` | yes    | api         | HMAC key for download links (32+ chars)                                                                                                 |
| `EXPORT_DOWNLOAD_URL_TTL_SECONDS`                                   | `900`                      |        | api         | Link lifetime                                                                                                                           |
| `EXPORT_FILE_TTL_HOURS`                                             | `168`                      |        | worker      | Export files are deleted after this                                                                                                     |
| `EXPORT_DEFAULT_ROW_CAP`                                            | `10000`                    |        | api, worker | Row cap without an `export_row_cap` entitlement                                                                                         |

### Billing (Paystack)

| Variable                               | Default                          | Secret | Used by     | Notes                                                                                     |
| -------------------------------------- | -------------------------------- | ------ | ----------- | ----------------------------------------------------------------------------------------- |
| `PAYSTACK_SECRET_KEY`                  | empty (billing "not configured") | yes    | api, worker | `sk_test_...` for staging, `sk_live_...` for production; also verifies webhook signatures |
| `PAYSTACK_WEBHOOK_IP_ALLOWLIST`        | empty                            |        | api         | Paystack's published webhook IPs; needs a correct `TRUST_PROXY_HOPS`                      |
| `PAYSTACK_BASE_URL`                    | `https://api.paystack.co`        |        | api, worker | Production must use the default                                                           |
| `BILLING_CALLBACK_URL`                 | `<APP_URL>/app/billing/return`   |        | api         | Where Paystack returns the browser                                                        |
| `BILLING_PENDING_VERIFY_AFTER_MINUTES` | `20`                             |        | worker      | Reconciliation verifies pending payments after this                                       |
| `BILLING_PENDING_ABANDON_AFTER_HOURS`  | `24`                             |        | worker      | Unpaid checkouts become abandoned                                                         |
| `BILLING_PAST_DUE_GRACE_DAYS`          | `7`                              |        | worker      | A past-due subscription expires after this                                                |
| `BILLING_FREE_MAX_MEMBERS`             | `5`                              |        | api         | Member cap without a subscription (free tier, a product assumption pending approval)      |
| `BILLING_CATALOGUE_PATH`               | built-in placeholders            |        | scripts     | JSON catalogue for `pnpm billing:catalogue`                                               |

### Mail and metrics

| Variable              | Default     | Secret | Used by                   | Notes                                                                                         |
| --------------------- | ----------- | ------ | ------------------------- | --------------------------------------------------------------------------------------------- |
| `SMTP_URL`            | required    | yes    | worker (api validates it) | e.g. `smtps://user:pass@smtp.provider:465`                                                    |
| `MAIL_FROM`           | required    |        | worker                    | e.g. `LeadForge <no-reply@leadforge.example>`; set SPF, DKIM and DMARC for the domain         |
| `METRICS_TOKEN`       | empty       | yes    | api, worker               | 24+ chars. Required in production when the worker metrics server binds a non-loopback address |
| `WORKER_METRICS_PORT` | `9464`      |        | worker                    | `0` turns the server off                                                                      |
| `WORKER_METRICS_HOST` | `127.0.0.1` |        | worker                    | `0.0.0.0` inside a container that Prometheus scrapes (with `METRICS_TOKEN`)                   |

### Web build

| Variable               | Default                 | Notes                                                                 |
| ---------------------- | ----------------------- | --------------------------------------------------------------------- |
| `API_URL`              | `http://localhost:4000` | Where `/api/*` is proxied; baked in at build time                     |
| `NEXT_PUBLIC_API_BASE` | `/api`                  | Browser-side API base (keep the default so requests stay same-origin) |
| `NEXT_PUBLIC_APP_NAME` | `LeadForge`             |                                                                       |

### Script and tooling variables (not read by the running services)

`PERF_BUSINESSES`, `PERF_OVERTURE_PLACES`, `PERF_BATCH`, `PERF_OWNER_PASSWORD` (load-test seed, `*_perf` databases only); `PG_URL`, `MONGO_URI`, `PGUSER`, `CONFIRM_RESTORE` (backup and restore scripts); `TEST_MONGODB_URI` (test runs).

### Production refusals

The API and worker refuse to start in production with: `COOKIE_SECURE` not `true`; `GOOGLE_PLACES_FIXTURE_MODE` on; `SAFE_FETCH_HOST_OVERRIDES` set; local Overture files; a `PAYSTACK_BASE_URL` other than Paystack's; a worker metrics server on a non-loopback address without `METRICS_TOKEN`. The API also refuses to start without `JWT_PRIVATE_KEY`. Swagger (`/api/docs`) is not served in production.

## 3. Database setup and migrations

PostgreSQL (Prisma migrations in `packages/db-postgres/prisma/migrations`):

```bash
DATABASE_URL=... pnpm db:migrate:deploy        # prisma generate + prisma migrate deploy
```

Run it as a release step before starting the new API and worker. Migrations are additive; a release that needs a destructive change ships it in two steps (stop using the column, then drop it in a later release).

MongoDB validators and indexes (idempotent; creates collections, applies validators, creates missing indexes, never drops data):

```bash
MONGODB_URI=... MONGODB_DB=... pnpm db:mongo:sync
```

Run it on every release before the new processes start. Index builds on large collections run in the background on MongoDB 7, but schedule a release that adds a business index outside busy hours.

Seed data: `pnpm db:seed` is development only (refuses production). Production starts empty: the first user signs up and gets an organization.

## 4. Overture Maps sync

The discovery source is the Overture Maps Places release, loaded into the platform-level staging catalogue `overture_places`.

1. First load before launch, from a host near the data (AWS us-west-2 or a fast link): `pnpm overture:sync` (7 to 26 minutes for Nigeria's ~160k places; it streams only the Nigerian part of the release through DuckDB's bounding-box pushdown).
2. Then the worker's daily STAC check loads each new monthly release once (`OVERTURE_SYNC_SCHEDULE`, on by default in production). The worker needs outbound HTTPS to `stac.overturemaps.org` and to the release's file host the catalogue names (Overture's public S3 bucket in AWS us-west-2).
3. A release that would retire more than 5% of places stops for review (`docs/OPERATIONS.md`, "Overture sync").

## 5. Billing catalogue and Paystack

1. Prices: copy `DEFAULT_BILLING_CATALOGUE` (`packages/core/src/billing/catalogue.ts`) to a JSON file outside the repository, set approved prices in kobo, set `"isPlaceholder": false`, then `BILLING_CATALOGUE_PATH=/path/catalogue.json pnpm billing:catalogue`. A live key refuses placeholder or zero prices (`PRICE_NOT_PUBLISHED`), so nothing can be sold before prices are approved.
2. Keys: put the secret key in the secret store (`PAYSTACK_SECRET_KEY`). Test keys on staging, live keys on production only.
3. Webhook: in the Paystack dashboard (Settings, API Keys and Webhooks) set the webhook URL to `https://<web host>/api/v1/webhooks/paystack` (through the web app's rewrite, or the API's own public host). Optionally set `PAYSTACK_WEBHOOK_IP_ALLOWLIST` to Paystack's published IPs once `TRUST_PROXY_HOPS` is right; the signature is always checked.
4. Callback: `BILLING_CALLBACK_URL` defaults to `<APP_URL>/app/billing/return`.
5. Before live: run the Paystack test-mode checklist in `docs/DEVELOPMENT.md` ("Billing with Paystack test mode") on staging and record the transaction references.

## 6. Object storage

Create a private bucket (block all public access), enable default encryption and a lifecycle rule deleting `exports/` objects after 8 days (the app deletes them after 7). Give the API and the worker one access key limited to that bucket (get, put, delete). Downloads are always presigned by the API after a signed-link check; the bucket is never addressed by browsers directly except through those short-lived URLs.

## 7. Network and egress

- Inbound: only the web app (443) is public. If the API has its own public host (for webhooks), expose `/api/v1/*` only; keep `/metrics` internal or token-protected.
- The worker fetches third-party websites (SafeFetch). SafeFetch already refuses private and reserved addresses on every connection; add a network egress policy where the platform supports it: allow 80 and 443 to the public internet, deny RFC 1918, link-local (cloud metadata `169.254.169.254`), the cluster's service ranges and the data stores' admin ports. The API needs egress only to the data stores, SMTP and `api.paystack.co`.
- Data stores: private networking or IP allowlists (MongoDB Atlas access list) limited to the API and worker hosts.

## 8. Scaling notes

- API: stateless, CPU-bound on JSON and Argon2 (sign-in and sign-up hash with 64 MiB of memory each; size memory for concurrent sign-ins). Scale horizontally. Rate limits and caches live in Redis, so replicas share them.
- Worker: split workloads with `WORKER_QUEUES`, for example one process for `discovery,imports,exports,bulk`, one for `website-analysis,enrichment` (slow external fetches, bounded by the per-host rate limit), and one for `billing,maintenance,mail,scoring,dedup`. Exactly one or more processes must run `billing` and `maintenance` (they register the repeatable reconciliation, retention, usage and Overture schedules). Concurrency per queue is in `ARCHITECTURE.md` section 8.
- MongoDB: the directory's indexes are all prefixed by `organizationId`; size memory for the indexes of the largest organizations (the 100k-business load test is in `infra/load/README.md`). Consider Atlas Search for multi-word search at larger scale.
- Redis: small (queues, counters); `noeviction` and persistence on.
- Load test before launch on production-like infrastructure with the k6 scripts in `infra/load/`.

## 9. Continuous integration

`.github/workflows/ci.yml` runs on every push to `main` and every pull request:

| Job         | What                                                                                                                                                                                                          | Blocking |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| static      | install (frozen lockfile), lint, typecheck, build                                                                                                                                                             | yes      |
| unit        | unit and component tests of every package except the API integration suite                                                                                                                                    | yes      |
| integration | PostgreSQL 16 and Redis 7 services, a MongoDB 7 single-node replica set container; `pnpm db:migrate:deploy`; Mongo sync; the API integration suite (tenant isolation, permissions, billing, workflows)        | yes      |
| e2e         | the web viewport suite as the frontend lane defined it (build, Playwright Chromium, `pnpm test:e2e`)                                                                                                          | yes      |
| audit       | `pnpm audit --prod --audit-level=critical` blocks; `pnpm audit --audit-level=high` runs and reports without blocking (accepted findings and their reasons: `docs/SECURITY_AND_DATA_COLLECTION.md` section 13) | partly   |
| secrets     | gitleaks over the full history and the working tree with `.github/gitleaks.toml` (default rules plus an allowlist of the synthetic test fixtures by value)                                                    | yes      |

The workflow was written and its YAML validated locally; GitHub Actions itself could not be run from the development environment, so the first run on GitHub is part of the pre-launch checklist.

## 10. Pre-launch checklist

Items that need the product owner or an operator (they cannot be done from code):

- [ ] **MongoDB Atlas access list**: add the production (and development) hosts' egress IPs; development currently cannot reach Atlas (TLS alert 80). Confirm continuous backup is on.
- [ ] **Paystack**: create the business account, run the test-mode checklist end to end with test cards, record transaction references, confirm the points listed in `docs/SECURITY_AND_DATA_COLLECTION.md` section 8 ("Points to confirm in test mode"), then add live keys and the live webhook URL.
- [ ] **Prices and plans**: approve prices, credit packs and plan limits; load them with `pnpm billing:catalogue` (placeholders cannot be sold on a live key).
- [ ] **Free tier**: confirm or change the assumed free tier (5 members, 10,000 export rows, discovery and analysis on; `docs/PRODUCT_REQUIREMENTS.md` section 8).
- [ ] **Legal reviews**: privacy policy, terms, acceptable use and data collection pages; the Nigeria Data Protection Act position on Overture contacts (96% mobile numbers, 80% free-mail addresses; legitimate-interest assessment); whether ODbL share-alike reaches derived state and LGA labels in exports; the Foursquare NOTICE presentation; the breach-notification procedure in `docs/OPERATIONS.md`.
- [ ] **Secrets**: generate production values (`pnpm gen:keys` for JWT, 32+ random characters for `CSRF_SECRET`, `EXPORT_SIGNING_SECRET`, `METRICS_TOKEN`) in the secret store; nothing from development reused.
- [ ] **Domains and mail**: `APP_URL`, `API_URL`, `COOKIE_DOMAIN`, `COOKIE_SECURE=true`, TLS certificates, SPF, DKIM and DMARC for `MAIL_FROM`.
- [ ] **Proxy hops**: set `TRUST_PROXY_HOPS` for the real chain and verify with one request that the audit log shows your own public IP.
- [ ] **Object storage**: private bucket, encryption, lifecycle rule, scoped key.
- [ ] **Egress policy** for the worker (section 7).
- [ ] **Monitoring**: Prometheus scraping both processes with `METRICS_TOKEN`, the alert rules loaded, the Grafana dashboard imported, alert routing to an on-call person; optional Sentry (hook points in `docs/OPERATIONS.md`).
- [ ] **Backups**: managed PITR on both databases, daily logical dumps with `pnpm backup` to separate encrypted storage, and one restore drill on the production-like environment.
- [ ] **First Overture load** (section 4) and a discovery smoke job on staging.
- [ ] **CI**: first green run of `.github/workflows/ci.yml` on GitHub; branch protection requiring it.
- [ ] **Load test** on production-like infrastructure (`infra/load/`), confirming the 300 ms p95 target there.
- [ ] **Accepted dependency findings** reviewed (section 13 of the security document), and Next.js updated when a release with a fixed PostCSS is available.
