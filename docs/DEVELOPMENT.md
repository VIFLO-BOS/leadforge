# LeadForge Development Guide

## Prerequisites

- Node.js 22 or newer (24 is used in CI)
- pnpm 11 (`corepack enable` or `npm i -g pnpm`)
- Docker Desktop (Postgres 16, MongoDB 7 replica set, Redis 7 and Mailpit run in containers)

## First-time setup

```bash
pnpm install
cp .env.example .env            # Windows PowerShell: Copy-Item .env.example .env
pnpm gen:keys --write           # writes JWT_PRIVATE_KEY / JWT_PUBLIC_KEY into .env
pnpm dev:infra                  # starts postgres, mongo (+ replica set init), redis, mailpit
pnpm db:migrate:deploy          # prisma generate + apply migrations
pnpm db:mongo:sync              # create collections, validators and indexes
pnpm db:seed                    # synthetic org + placeholder plans (development only)
pnpm build                      # builds every workspace once so dist/ exists
pnpm dev                        # web :3000, api :4000, worker, with watchers
```

Mailpit UI: http://localhost:8025 (all outgoing email lands here). API docs: http://localhost:4000/api/docs.

Synthetic sign-in after seeding: `owner@example.test` / `synthetic-owner-pass-2026`. The seeded organization is named "Acme Demo (Synthetic)" and the seeded plans are flagged as placeholders, so the pricing page shows "Pricing not yet published".

## Repository layout

See `ARCHITECTURE.md` section 3. In short: `apps/web` (Next.js), `apps/api` (NestJS HTTP), `apps/worker` (BullMQ processors), `packages/contracts` (Zod schemas shared by all), `packages/core` (NestJS modules shared by api and worker), `packages/db-postgres` (Prisma), `packages/db-mongo` (driver, validators, indexes), `packages/ui` (tokens and components), `packages/config` (eslint and tsconfig presets).

Node packages build to `dist/` with `tsc`; the web app consumes `@leadforge/ui` from source via `transpilePackages`.

## Everyday commands

| Command                                                                                       | What it does                                                                                                                                                                  |
| --------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm dev`                                                                                    | All apps in watch mode (Turborepo)                                                                                                                                            |
| `pnpm build`                                                                                  | Build everything in dependency order                                                                                                                                          |
| `pnpm typecheck`                                                                              | `tsc --noEmit` everywhere                                                                                                                                                     |
| `pnpm lint`                                                                                   | ESLint (flat config, security plugin, repository import rule)                                                                                                                 |
| `pnpm test`                                                                                   | Vitest unit and integration tests (integration tests need the Docker services)                                                                                                |
| `pnpm test:e2e`                                                                               | Playwright viewport suite for the web app (240 to 1440 px)                                                                                                                    |
| `pnpm e2e:release`                                                                            | Release suite: the 16 acceptance criteria through the real UI on a live stack (see below)                                                                                     |
| `pnpm e2e:release:up` / `:down` / `:drop`                                                     | Start the release stack and keep it running / stop it / drop its `*_e2e` databases                                                                                            |
| `pnpm db:migrate`                                                                             | Create a new Prisma migration from schema changes (interactive)                                                                                                               |
| `pnpm db:migrate:deploy`                                                                      | Apply pending migrations (CI and production)                                                                                                                                  |
| `pnpm db:mongo:sync`                                                                          | Idempotently apply Mongo validators and indexes                                                                                                                               |
| `pnpm overture:sync`                                                                          | Load the latest Overture Maps Places release into the staging catalogue (see below)                                                                                           |
| `pnpm billing:catalogue`                                                                      | Upsert plans and credit packs from `BILLING_CATALOGUE_PATH` (or the placeholder catalogue)                                                                                    |
| `pnpm billing:webhook:replay <file> [url]`                                                    | Sign a Paystack webhook body with the test key and post it to the local API (development only)                                                                                |
| `pnpm queue:admin counts \| failed <queue> \| retry <queue> <id\|all> \| remove <queue> <id>` | Inspect and retry BullMQ jobs, including the failed set (docs/OPERATIONS.md)                                                                                                  |
| `pnpm org:purge <organizationId> [--reapply]`                                                 | Stage 10: resume an organization purge past its grace period now, or (`--reapply`) run it again after restoring an older backup (docs/OPERATIONS.md, "Organization deletion") |
| `pnpm perf:seed`                                                                              | Load-test data on dedicated `*_perf` databases only (infra/load/README.md)                                                                                                    |
| `pnpm backup --out <dir>` / `pnpm restore --from <dir> ...`                                   | Logical backup and verified restore of both databases (docs/OPERATIONS.md)                                                                                                    |
| `pnpm format`                                                                                 | Prettier                                                                                                                                                                      |

## Environment variables

Every variable is documented in `.env.example`. Two matter when several stacks share infrastructure:

- `QUEUE_PREFIX` (default `leadforge`): the BullMQ key prefix. The API (producer) and the worker read the same variable, so they always agree; a second stack on the same Redis (another developer, an agent, a demo) sets its own prefix, for example `QUEUE_PREFIX=leadforge-ada`, and its worker never takes your jobs. Changing the prefix leaves jobs queued under the old prefix where they are. Tests use `leadforge-test` on Redis database 9.
- `MONGODB_DB`: the database name (the Overture staging catalogue lives in the same database as the organization data). The API and worker validate the environment at boot with the `ServerEnv` schema in `packages/contracts/src/env.ts` and refuse to start if anything is missing or malformed. Secrets never go in the repository; production uses the hosting platform's secret store.

## Export files and object storage (Phase 5)

Async exports are built by the worker as a ZIP (the CSV, `ATTRIBUTION.txt` and a `LICENSES/` folder for the open-data licences that apply) and stored through an `ObjectStorage` driver. The API streams a file only through a signed link (`GET /exports/:id/download-url`, valid `EXPORT_DOWNLOAD_URL_TTL_SECONDS`, default 15 minutes, bound to the user, the organization and the export). The maintenance queue deletes files after `EXPORT_FILE_TTL_HOURS` (default 168, 7 days).

| Variable                                                                                    | Default                                  | Meaning                                                                                                         |
| ------------------------------------------------------------------------------------------- | ---------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `OBJECT_STORAGE_DRIVER`                                                                     | `local`                                  | `local` or `s3`                                                                                                 |
| `OBJECT_STORAGE_LOCAL_DIR`                                                                  | `<os temp dir>/leadforge-object-storage` | Root for the `local` driver. The API and the worker must see the same directory (same host or a shared volume). |
| `OBJECT_STORAGE_ENDPOINT`                                                                   | `https://s3.<region>.amazonaws.com`      | S3 or S3-compatible endpoint, e.g. `http://127.0.0.1:9000` for MinIO                                            |
| `OBJECT_STORAGE_REGION`                                                                     | `us-east-1`                              | Signing region                                                                                                  |
| `OBJECT_STORAGE_BUCKET`, `OBJECT_STORAGE_ACCESS_KEY_ID`, `OBJECT_STORAGE_SECRET_ACCESS_KEY` | none                                     | Required with `s3`; the process refuses to start without them                                                   |
| `OBJECT_STORAGE_FORCE_PATH_STYLE`                                                           | `true`                                   | `endpoint/bucket/key` URLs (MinIO and most S3-compatible services); `false` for virtual-hosted AWS URLs         |
| `EXPORT_SIGNING_SECRET`                                                                     | derived from `CSRF_SECRET`               | HMAC key for download links (32+ characters). Rotating it invalidates open links.                               |
| `EXPORT_DOWNLOAD_URL_TTL_SECONDS`                                                           | `900`                                    | Download link lifetime (30 to 3,600)                                                                            |
| `EXPORT_FILE_TTL_HOURS`                                                                     | `168`                                    | Export file retention                                                                                           |
| `EXPORT_DEFAULT_ROW_CAP`                                                                    | `10000`                                  | Async export row cap when the organization has no `export_row_cap` entitlement                                  |

The `s3` driver signs every request itself (AWS Signature Version 4, query-string presigning, no SDK); a unit test reproduces the presigned-URL example from the S3 API reference. No live S3 test runs in CI. API integration tests use the `local` driver under `<os temp dir>/leadforge-object-storage-test`.

The worker also rolls up usage (`usage_daily`) on the maintenance queue: the last 2 UTC days every 10 minutes and the last 90 days once a day. To fill the Usage page right away on a development database, start the worker (the 90-day rollup runs when its schedule is registered).

## Billing with Paystack test mode (Phase 6)

Billing runs without keys: the Billing page reports "not configured", checkout answers `422 BILLING_NOT_CONFIGURED` and nothing is faked. Automated tests never call Paystack; they point a harness at a local fixture server (`apps/api/test/paystack-fake.ts`, hand-built payloads in Paystack's documented shapes).

**The manual Paystack test-mode run is pending keys.** Once a Paystack test account exists:

1. Put the **test** secret key in the root `.env`: `PAYSTACK_SECRET_KEY=sk_test_...` (never a live key on a development machine). Leave `PAYSTACK_BASE_URL` at its default.
2. Give the catalogue test prices. Copy the shape of `DEFAULT_BILLING_CATALOGUE` (`packages/core/src/billing/catalogue.ts`) into a JSON file outside the repository, set real kobo amounts (for example `"priceMinor": 500000` for NGN 5,000.00) and keep `"isPlaceholder": true` until prices are approved (placeholders can be bought with a test key, never with a live key). Then `BILLING_CATALOGUE_PATH=/path/to/catalogue.json pnpm billing:catalogue`.
3. Start the API and the worker (`pnpm dev`, or the API and worker on their own). The worker registers `reconcile-billing` every 10 minutes and processes `process-webhook`, `verify-payment` and `generate-invoice-pdf` on the `billing` queue.
4. Webhooks need a public URL: expose the API with a tunnel (for example `ngrok http 4000` or `cloudflared tunnel --url http://localhost:4000`) and set the **test** webhook URL in the Paystack dashboard (Settings, API Keys and Webhooks) to `https://<tunnel>/api/v1/webhooks/paystack`. Without a tunnel, payments still settle: the return page triggers a verify, and reconciliation verifies pending payments after `BILLING_PENDING_VERIFY_AFTER_MINUTES` (20).
5. On the Billing page buy a credit pack and pay with a Paystack test card (Paystack's docs list test cards, for example a successful Visa and a declined card). Check: the return page shows "Confirming payment" and then success; `GET /api/v1/billing/payments/<reference>` is `success`; the ledger has one `purchase`; an invoice PDF downloads. Subscribe to a plan, then use the dashboard to cancel or let a renewal fail with a test card that fails.
6. Record the transaction references you used, the events received (`payment_webhook_events`) and anything that differed from docs/SECURITY_AND_DATA_COLLECTION.md section 8 ("Points to confirm in test mode"), and update that section with the date.

**Replaying webhooks locally.** `pnpm billing:webhook:replay <event.json> [url]` signs a JSON file with `PAYSTACK_SECRET_KEY` (HMAC-SHA512 over the file's exact bytes, as Paystack does) and posts it to `<API_URL>/api/v1/webhooks/paystack` (or the given URL). It refuses production and live keys. Use a payload copied from the Paystack dashboard's webhook log, or a hand-built one such as:

```json
{
  "event": "charge.success",
  "data": {
    "id": 1,
    "status": "success",
    "reference": "lf-<payment id>",
    "amount": 500000,
    "currency": "NGN",
    "customer": { "customer_code": "CUS_..." }
  }
}
```

A replayed `charge.success` only settles a transaction that Paystack itself reports as successful (the worker always verifies), and replaying the same file twice is a no-op (`duplicate: true`). Inspect state with SQL: `payments`, `payment_webhook_events`, `credit_ledger`, `invoices`, `reconciliation_runs`, `billing_audit`.

Prices and plans: the built-in catalogue's prices are all 0 and flagged `is_placeholder` (pricing has not been decided); `pnpm billing:catalogue` upserts plans and packs by code from `BILLING_CATALOGUE_PATH` in any environment and never touches Paystack plan codes. A published plan's price change needs a new plan code (Paystack keeps charging existing subscribers the amount the plan was created with). The development seed adds `override` entitlements for the seeded organization (25 members, discovery and analysis on) so local flows are not limited by the free tier.

## Testing notes

- API integration tests live in `apps/api/test` and run against the real Postgres, Mongo and Redis from Docker. Outside CI they automatically use a separate Postgres database (`<name>_test`, created and migrated by the vitest global setup), the Mongo database `leadforge_test` and Redis database 9, so they never touch your development data.
- Connection defaults in `apps/api/test/setup.ts`: Postgres `127.0.0.1:5432` and Redis `127.0.0.1:6379` (IPv4, so a machine where `localhost` resolves to `::1` first still connects; CI sets its own URLs). Mongo defaults to `mongodb://localhost:27017/?replicaSet=rs0&directConnection=true`, because a native Windows MongoDB can also listen on `127.0.0.1:27017` and would shadow the Docker replica set. To point the tests at the Docker replica set another way, set `TEST_MONGODB_URI` (it wins over `MONGODB_URI`, and turbo passes it through to `pnpm test`), for example:

  ```bash
  TEST_MONGODB_URI="mongodb://192.168.56.1:27017/?replicaSet=rs0&directConnection=true" pnpm --filter @leadforge/api test
  ```

  Whatever the URI, the database is always `leadforge_test`, Postgres always `<name>_test`, Redis always db 9, and hosted Mongo URIs (`mongodb+srv:`, `mongodb.net`) are refused.

- Billing tests (`apps/api/test/billing-*.test.ts`) run a local fixture server in place of Paystack (`paystack-fake.ts`; `PAYSTACK_BASE_URL` points at it, which the environment schema allows outside production only) and an in-process worker on the `billing` queue with the same `BillingQueueHandler` as `apps/worker`. `setup.ts` removes any Paystack variables from the environment first.
- Email flows are tested end to end by reading the queued mail job from BullMQ and extracting the link token. No worker needs to run during tests.
- Website analysis and enrichment tests never touch the internet. Unit tests (`packages/core/src/safe-fetch`, `website-analysis`) run SafeFetch against local HTTP and HTTPS servers with a stub DNS that maps test names to public-looking addresses and a dial hook that connects those to `127.0.0.1`. API tests serve a local site through `SAFE_FETCH_HOST_OVERRIDES` and stub the DNS resolver (`DNS_RESOLVER`) for MX lookups and deny-list cases. Phase 4 queues (`website-analysis`, `enrichment`, `scoring`, `dedup`) run on in-process BullMQ workers wired with the same handlers as `apps/worker` (`apps/api/test/phase4-helpers.ts`).

## Release end-to-end suite (Stage 9)

`pnpm e2e:release` proves the brief's 16 Final Acceptance Criteria through the real UI against a live API, worker and web app, with local stand-ins for every outside service. It is `node infra/e2e/release-stack.mjs run`, which:

1. Refuses anything that is not a dedicated e2e target: PostgreSQL and MongoDB databases must end in `_e2e`, a hosted MongoDB (`mongodb+srv:`, `mongodb.net`) is refused, Redis databases 0, 3, 4 and 9 are refused, and so are ports 3000, 3100, 4000 and 4200. It checks that its own ports (web 3300, API 4100, Paystack fixture 4310, test website 4320) are free first.
2. Recreates PostgreSQL `leadforge_e2e` (migrated), MongoDB `leadforge_e2e` (validators and indexes synced) and Redis db 5, then runs `apps/api/dist/scripts/seed-e2e.js`: per Playwright project (`w1440`, `w375`, `smoke`) an owner and a sales rep in one organization (with a 500-credit ledger grant) and a rival owner in another; the Overture catalogue (the 25 real fixture records plus "(Sample)" Ikeja pharmacies and bakeries) loaded through the real sync service; and plans and packs from `infra/e2e/billing-catalogue.e2e.json` (nonzero test prices, still placeholders, so only a test key can charge them; the default placeholder catalogue is untouched). Seeded users sign in with `release-e2e-pass-2026` (override with `E2E_SEED_PASSWORD`).
3. Starts the Paystack fixture (`apps/api/test/paystack-fake.ts`, loaded with Node's type stripping, behind a front on 4310 that also serves a test checkout page and the `/__e2e/` control routes), a test website on 4320 (mapped with `SAFE_FETCH_HOST_OVERRIDES`), the API on 4100, the worker (`WORKER_METRICS_PORT=0`, `QUEUE_PREFIX=leadforge-e2e`) and the web app on 3300, built into `apps/web/.next-e2e-release`. Mail goes to Mailpit (SMTP 1025, API 8025). The JWT keys and CSRF secret are generated per run; the root `.env` is never read.
4. Runs `apps/web/playwright.release.config.ts` with `E2E_RELEASE=1`, one worker, projects `setup`, `release-1440`, `release-375` (the whole flow on a desktop and on a phone) and `smoke-240`, `smoke-768`, `smoke-1024`, then stops everything it started.

Build the backend first (`pnpm exec turbo run build --filter=@leadforge/api --filter=@leadforge/worker`, or pass `--build-backend`) and install Chromium once (`pnpm --filter @leadforge/web exec playwright install chromium`). Options: `--reuse-web-build` skips `next build` when the existing build targets the same API; `--keep-data` keeps the databases; `--drop` drops them after the run; arguments after `--` go to Playwright, for example `pnpm e2e:release -- --project=setup --project=release-1440 c03`.

Environment (all optional): `E2E_DATABASE_URL` (default `postgresql://leadforge:leadforge@127.0.0.1:5432/leadforge_e2e`), `E2E_MONGODB_URI` (default the replica set on `127.0.0.1:27017`), `E2E_MONGODB_DB`, `E2E_REDIS_URL` (`redis://127.0.0.1:6379/5`), `E2E_SMTP_URL`, `E2E_MAILPIT_URL`, `E2E_LOG_DIR` (process logs; default `<tmp>/leadforge-e2e-release/logs`), `E2E_SCREENS_DIR` (screenshots of each step), `E2E_OUTPUT_DIR`, and `E2E_WEB_PORT`, `E2E_API_PORT`, `E2E_PAYSTACK_PORT`, `E2E_SITE_PORT`. On a machine where a native MongoDB also listens on `127.0.0.1:27017`, point `E2E_MONGODB_URI` at the Docker replica set's own address.

To work on one spec, keep a stack running and call Playwright yourself:

```bash
pnpm e2e:release:up                     # leave running; stop with Ctrl+C or pnpm e2e:release:down
cd apps/web && E2E_RELEASE=1 pnpm exec playwright test -c playwright.release.config.ts --project=setup --project=release-375 c09
```

The specs (`apps/web/e2e/release/`) are named after their criteria (`c01-register` to `c16-security`, plus `honesty.spec.ts` for the brief's "never fabricate" rule and, from Stage 10, `c17-org-lifecycle.spec.ts` for the organization data export and the deletion request, banner and cancellation) and are listed with their results in docs/IMPLEMENTATION_PLAN.md, "Release acceptance mapping (web half)". They create their own "(Sample)" data, and several (discovery, retry, payment) count credits and records exactly, so they expect a freshly seeded stack: rerunning them on the same databases can fail where a second discovery finds only places it already holds. The fixture control routes they use (`/__e2e/checkout/*`, `/__e2e/paystack/settle|webhook|calls`, `/__e2e/faults/businesses`, `/__e2e/maintenance/rollup-usage`) exist only in this stack: the fault route changes the `businesses` validator of the `_e2e` database for the retry test and refuses any other database. CI runs the suite in the `e2e-release` job (pull requests to main, nightly, on demand) and uploads the Playwright report and the stack logs.

What it cannot prove locally: a real Paystack test-mode payment (pending keys; see "Billing with Paystack test mode"), real Overture releases from S3 (`pnpm overture:sync`), and delivery through a real mail provider.

## Overture Maps Places sync

Discovery reads a staging catalogue of Overture places (`overture_places`), loaded from a monthly release:

```bash
pnpm overture:sync                          # latest release named by https://stac.overturemaps.org/catalog.json
pnpm overture:sync --force                  # reload a release already loaded; also retires places past the 5% safety limit
pnpm overture:sync --release=2026-10-21.0   # a specific release (releases stay online for about 60 days)
```

The command builds the worker, reads only the release files that overlap Nigeria with DuckDB (`@duckdb/node-api`, prebuilt for Windows, Linux and macOS; the `httpfs` extension is downloaded on first use for remote reads), assigns states and LGAs from the release's division boundaries, writes new and changed places, groups duplicates, retires places the release dropped and records the run in `overture_sync_runs`. It prints the counts and one progress line per 1,000 places. A release that is already loaded is skipped in seconds; a rerun is idempotent. One sync runs at a time per MongoDB database (a lease in `overture_sync_runs`, whatever `REDIS_URL` says): a second one fails at once with "Another Overture sync is running". If a sync is killed or loses its connection, its run stays `running` until its heartbeat is 10 minutes old; the next `pnpm overture:sync` then marks it `failed` and proceeds, so after an interruption wait 10 minutes or just rerun later.

For development without the network, point it at local files (refused in production):

```bash
OVERTURE_LOCAL_PLACES_PATH=/path/overture_places_ng_2026-10-21.0.parquet \
OVERTURE_LOCAL_DIVISIONS_PATH=/path/divisions_ng_2026-10-21.0.parquet \
pnpm overture:sync
```

The places file may use the raw Overture schema or the flattened extract layout (`name`, `taxonomy_*`, `lon`, `lat`); set `OVERTURE_LOCAL_RELEASE` when the file has no `overture_release` column. The worker also runs the sync on the maintenance queue (`overture-sync`, daily STAC check) when `OVERTURE_SYNC_SCHEDULE=true` (default: on in production only). Measured on the development machine (Docker MongoDB in WSL2 on Windows, reached over a host-only adapter): a first load of Nigeria (162,475 places) took 7 to 9 minutes, bound by MongoDB index writes (about 430 inserts per second, four batches in flight; reading the Parquet, assigning states and LGAs and normalizing take about 2 minutes of CPU and overlap the writes); a rerun of an already loaded release with no changes took about 6 minutes, mostly reading and normalizing the file again. A managed MongoDB should be several times faster. The MongoDB client compresses traffic (zlib). A real sync of release 2026-10-21.0 from the STAC catalogue and S3 (no local files) took 26 minutes on a slow link (6 to 9 seconds per HTTPS request): about 10 minutes to resolve the release and read the division boundaries and Parquet footers, 6 minutes to stream the 162,475 Nigerian places (all unchanged against the local extract, so the S3 read and the local file agree exactly) and 9 minutes of duplicate grouping while the test suite shared the database.

Tests never touch the network: they load the 25 real fixture records plus synthetic `(Sample)` places through the same sync service (`apps/api/test/overture-helpers.ts`), and the worker's DuckDB reader is tested on Parquet files built from the fixtures in a temporary directory.

## Running website analysis locally

The worker fetches websites only through SafeFetch, which refuses private, loopback and link-local addresses. To try an analysis against a page on your own machine, serve it under a made-up host name and map that exact name with the development-only override (refused when `NODE_ENV=production`):

```bash
# a site on 127.0.0.1:4299, analyzed as http://smoke-site.test
SAFE_FETCH_HOST_OVERRIDES="smoke-site.test=127.0.0.1:4299" pnpm --filter @leadforge/worker start
```

Give a business the website `http://smoke-site.test`, then request an analysis (1 credit) or a website-contacts run (free). Every other host still goes through DNS and the deny list. `SAFE_FETCH_HOST_RPS` (default 0.5, one request every 2 seconds per host) can be raised locally to speed this up.

- Tenant isolation, CSRF, refresh-token reuse detection, last-owner protection and rate limits each have explicit failing-path tests.

## Conventions

- Every route handler declares `@Public()`, `@AuthOnly()` or `@RequirePermission(...)`. The API refuses to boot otherwise (`assertRoutePolicies`).
- Repositories take `organizationId` as a required argument for org-owned data. Importing `PrismaClient`, `MongoClient` or `Db` outside repositories fails lint.
- Request bodies are validated with Zod schemas from `@leadforge/contracts` through `ZodBody`; the same schemas drive the frontend forms.
- Money is `BigInt` minor units. Credits are integers. No floats.
- Responses use the `{ data, meta? }` envelope; errors use `{ error: { code, message, details?, requestId } }`.
