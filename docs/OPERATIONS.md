# LeadForge Operations

Status: release 1 runbooks, written in Phase 7; Stage 10 added "Organization deletion" and the re-application of deletions after a restore. Last updated 2026-10-28.

Who this is for: whoever is on call for a LeadForge deployment. Deployment itself (processes, environment, migrations, scaling) is in `docs/DEPLOYMENT.md`; the security model is in `docs/SECURITY_AND_DATA_COLLECTION.md`.

Ground rules for every runbook below:

- Never grant credits, mark a payment paid or edit the ledger by hand. Credits move only through the services (`CreditsService`, payment settlement, reconciliation), which keep the ledger, the cached balance and the audit trail consistent. Read-only SQL is fine for diagnosis.
- Never print or paste secrets (keys, tokens, connection strings) into tickets or chat. Logs already redact cookies, authorization headers, CSRF and webhook signature headers, passwords, emails in bodies, signed-link signatures and invitation tokens in URLs.
- Every customer-visible incident gets a short written timeline (see "Incident response basics").

## 1. Processes, health and logs

| Process         | Start                                   | Health                                                                                                   | Notes                                                 |
| --------------- | --------------------------------------- | -------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| web (Next.js)   | `pnpm --filter @leadforge/web start`    | `GET /`                                                                                                  | Proxies `/api/*` to the API (`API_URL` at build time) |
| api (NestJS)    | `pnpm --filter @leadforge/api start`    | `GET /api/v1/health/live` (process up), `GET /api/v1/health/ready` (Postgres, Mongo, Redis with latency) | Serves `GET /metrics` outside `/api/v1`               |
| worker (NestJS) | `pnpm --filter @leadforge/worker start` | metrics server `GET /metrics` on `WORKER_METRICS_HOST:WORKER_METRICS_PORT`                               | `WORKER_QUEUES` limits a process to some queues       |

Logs are JSON lines (pino) on stdout. Every API line carries `requestId` (also returned as `X-Request-Id` and inside every error body), `userId` and `organizationId`; worker lines carry `queue` and `jobId`. When a customer quotes a request id, search the API logs for it first.

Graceful shutdown: the worker waits up to 30 seconds for active jobs on SIGTERM; a job cut off later is retried (every processor is idempotent).

## 2. Monitoring

### Endpoints

- API: `GET /metrics` (Prometheus text). Platform gauges are computed on scrape and cached 30 seconds, so scraping every 30 seconds or slower costs one set of database counts per interval.
- Worker: `GET /metrics` on its own small HTTP server (default `127.0.0.1:9464`; `WORKER_METRICS_PORT=0` turns it off).
- Protection: with `METRICS_TOKEN` set, both require `Authorization: Bearer <token>` (constant-time compare); anyone else gets a plain 404. Without a token the API answers loopback callers only and never in production, and the worker binds to loopback (the environment schema refuses a non-loopback worker bind in production without a token). The web app's `/api` rewrite cannot reach `/metrics`.

### Series

| Series                                                                                       | Source | Meaning                                                                                                                                       |
| -------------------------------------------------------------------------------------------- | ------ | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `leadforge_http_request_duration_seconds` (histogram), `leadforge_http_requests_total`       | api    | By `method`, `route` (template such as `/api/v1/businesses/:id`, never raw URLs) and `status`                                                 |
| `leadforge_http_errors_total`                                                                | api    | By API error `code` and `status`                                                                                                              |
| `leadforge_queue_jobs`                                                                       | api    | Jobs per `queue` and `state` (waiting, active, delayed, prioritized, waiting-children, paused, failed, completed)                             |
| `leadforge_jobs_total`                                                                       | worker | Attempts per `queue`, `name`, `outcome` (completed, retrying, failed = no attempt left or unrecoverable, delayed = rate-limited and put back) |
| `leadforge_job_duration_seconds`, `leadforge_job_wait_seconds`                               | worker | Attempt duration; enqueue-to-first-attempt delay                                                                                              |
| `leadforge_reconciliation_runs_total`, `leadforge_reconciliation_items_total`                | worker | Passes of `credits` and `billing` reconciliation by outcome; items by the reconciler's own field names                                        |
| `leadforge_reconciliation_last_run_timestamp_seconds`, `_last_run_fixed`, `_last_run_errors` | api    | Latest finished pass per kind (payments, holds, subscriptions, webhooks)                                                                      |
| `leadforge_billing_payments`, `_payments_stuck`, `_payments_flagged`                         | api    | Payments by status; pending over 60 minutes; flagged for review                                                                               |
| `leadforge_billing_webhook_events`, `_webhook_events_stale`                                  | api    | Webhook events by processing status; received or failed and unprocessed over 30 minutes                                                       |
| `leadforge_credits_negative_balances`, `leadforge_credits_ledger_units_24h`                  | api    | Organizations below zero; units moved in 24 hours by ledger type                                                                              |
| `leadforge_jobs_unsettled`                                                                   | api    | Finished discovery jobs and analyses whose credits are unsettled after 30 minutes                                                             |
| `leadforge_overture_sync_*`                                                                  | api    | Last success time, last run failed, failed runs in 7 days, running                                                                            |
| Node.js defaults                                                                             | both   | CPU, memory, event loop lag, GC (label `service`)                                                                                             |

### Dashboard and alerts

- `infra/monitoring/grafana/leadforge-overview.json`: import into Grafana (it asks for the Prometheus data source). Rows: API, queues and jobs, billing and credits and reconciliation, Overture sync, processes.
- `infra/monitoring/alerts.yml`: 19 Prometheus rules (checked with `promtool check rules`), each with a `runbook` link into this file. `infra/monitoring/prometheus.yml` is an example scrape configuration.

| Alert                                                                                                                  | Severity       | Runbook                             |
| ---------------------------------------------------------------------------------------------------------------------- | -------------- | ----------------------------------- |
| LeadForgeTargetDown                                                                                                    | page           | Incident response basics            |
| LeadForgeApiErrorRateHigh (5xx over 2% for 10 min)                                                                     | page           | Incident response basics            |
| LeadForgeDirectoryLatencyP95High (over 300 ms), LeadForgeApiLatencyP95High (over 1 s)                                  | ticket         | Slow directory                      |
| LeadForgeQueueBacklog, LeadForgeQueueStalled, LeadForgeFailedJobsGrowing, LeadForgeFailedSetLarge                      | ticket or page | Failed jobs and the dead-letter set |
| LeadForgeStuckPayments, LeadForgePaymentFlagged                                                                        | page, ticket   | Stuck payments                      |
| LeadForgeWebhookBacklog, LeadForgeWebhookFailures                                                                      | page, ticket   | Webhook replay                      |
| LeadForgeNegativeBalances, LeadForgeUnreconciledJobs, LeadForgeReconciliationNotRunning, LeadForgeReconciliationErrors | ticket or page | Credit reconciliation               |
| LeadForgeOvertureSyncFailed, LeadForgeOvertureSyncStale                                                                | ticket         | Overture sync                       |
| LeadForgeOrganizationPurgeFailing (Stage 10)                                                                           | ticket         | Organization deletion               |

### Error tracking (Sentry)

Not wired in release 1 (no new dependency was added for it). The hook points are: `AppExceptionFilter.catch` in `packages/core/src/common/errors/http-exception.filter.ts` for API errors with status 500 and above (it already logs them with the request id), and the worker's `failed` handler in `apps/worker/src/worker.runtime.ts`. Add `@sentry/node`, initialize it in `apps/api/src/main.ts` and `apps/worker/src/main.ts` when `SENTRY_DSN` is set, and call `captureException` at those two points with `requestId`, `jobId` and `organizationId` as tags (never request bodies).

## 3. Runbooks

### Failed jobs and the dead-letter set

BullMQ keeps failed jobs in each queue's failed set for 14 days; that set is the dead-letter queue. Jobs that fail for good are either out of attempts (see the attempts per job type in `ARCHITECTURE.md` section 8) or unrecoverable on purpose (a malformed payload, or a payload naming a resource outside its organization: these must not be retried).

1. Look: `pnpm queue:admin counts` (every queue and state), then `pnpm queue:admin failed <queue> 50`. Output is one JSON line per job with its id, name, attempts, a shortened reason (email addresses masked) and the ids in its payload, never the full payload.
2. Decide by reason:
   - Infrastructure (timeouts, connection resets, a database or Redis outage, a deploy mid-job): fix the cause, then `pnpm queue:admin retry <queue> all` (or one job id). Every processor is idempotent: imports resume after the last processed row, discovery pages upsert items by deterministic id, exports rebuild the file, bulk operations resume after the last recorded business, billing jobs re-check state under row locks.
   - `Invalid ... payload`, `not found in organization`, `Unknown ... job`: do not retry. These are refusals; find the producer bug.
   - Source errors in discovery (rate limited, auth failed): the job already settled its credits; the customer can use "retry failed items" in the app.
3. Remove only after handling: `pnpm queue:admin remove <queue> <jobId>`.
4. A queue with waiting jobs and no progress (LeadForgeQueueStalled) means no worker consumes it: check the worker processes, their `WORKER_QUEUES` and `QUEUE_PREFIX` (a worker on another prefix never sees these jobs), and the worker logs for "Worker error".

`queue:admin` reads `REDIS_URL` and `QUEUE_PREFIX` like the worker; run it from a host that can reach Redis.

### Slow directory

Target: p95 under 300 ms for list endpoints at 100k businesses per organization (`ARCHITECTURE.md` section 10).

1. Find the route and filter shape: the dashboard's "p95 latency, top routes", then the API logs for slow requests (search text and emails are redacted in logged URLs; filters and sorts are visible).
2. Check the plan with `explain("executionStats")` in `mongosh` against a replica or the load-test database: look for `COLLSCAN`, large `totalDocsExamined`, or an in-memory `SORT`. The API test `business-repository.test.ts` fails on any collection scan across 13 filter shapes and 4 sorts.
3. Known costs measured in Phase 7 (`infra/load/README.md`): multi-word search reads every record matching the longest word; field-state filters (verified, stale) evaluate dates per record and cannot be answered from an index alone. On a managed MongoDB with enough memory for the working set these stay well inside the target; on an undersized host they are the first to slow down.
4. Reproduce with the load test (`pnpm perf:seed` on dedicated `*_perf` databases, then the k6 scripts) before and after a fix.

### Stuck payments

States: `pending` → `success` | `failed` | `abandoned` | `reversed`. Credits are granted only after Paystack's verify confirms the same reference, amount and currency (docs/SECURITY_AND_DATA_COLLECTION.md section 8).

1. `reconcile-billing` runs every 10 minutes: it verifies pending payments older than `BILLING_PENDING_VERIFY_AFTER_MINUTES` (20) with Paystack and settles them (granted, failed or abandoned after `BILLING_PENDING_ABANDON_AFTER_HOURS`). LeadForgeStuckPayments fires when a payment is still pending after 60 minutes, which means reconciliation is failing or Paystack does not answer.
2. Check the worker logs for "Billing reconciliation ran" and errors, and `leadforge_reconciliation_runs_total{kind="billing"}`. Check Paystack's status page.
3. A customer can trigger a verify from the return page, and an owner or admin can call `POST /api/v1/billing/payments/<reference>/verify`. Both only queue `verify-payment`; nothing is granted on the redirect.
4. Flagged payments (LeadForgePaymentFlagged) never settle automatically: the verify disagreed (amount, currency, reference) or a dispute opened. Compare `billing_audit` rows for the payment with the Paystack dashboard. If Paystack confirms the charge and the amounts match, fix the cause (usually a catalogue price changed mid-checkout) and contact the customer; refunds go through `POST /billing/payments/:id/refund` (owner only). Never clear `flag_reason` to force a grant.
5. Useful read-only query: `SELECT provider_reference, status, initiated_at, verify_attempts, provider_status, flag_reason FROM payments WHERE status = 'pending' ORDER BY initiated_at;`

### Webhook replay

Paystack retries webhooks itself; LeadForge stores each signed event once (`payment_webhook_events`, unique per provider event key) and processes it on the `billing` queue.

1. Unprocessed events (status `received` or `failed`) are re-enqueued by `reconcile-billing` up to 10 attempts. LeadForgeWebhookBacklog means events sit unprocessed for 30 minutes: check that a worker runs the `billing` queue.
2. After 10 attempts an event stays `failed` with its `error`. Fix the cause, then reset it so reconciliation picks it up within 10 minutes: `UPDATE payment_webhook_events SET attempts = 0, processing_status = 'received' WHERE id = '<event id>';` (processing is idempotent: settlement runs under the customer row lock and the ledger key `payment:<id>:grant` is unique).
3. Events Paystack never delivered (endpoint down, wrong URL): resend them from the Paystack dashboard (webhook logs). Pending payments also settle without any webhook through reconciliation's verify.
4. `pnpm billing:webhook:replay` is a development tool (it signs a file with the test key and refuses production and live keys). Do not use it against production.
5. Unsigned or wrongly signed requests are answered 401 and never stored; a burst of them in the logs is someone probing the endpoint, not lost events. With `PAYSTACK_WEBHOOK_IP_ALLOWLIST` set, check that `TRUST_PROXY_HOPS` matches the proxy chain, or genuine events get 403.

### Overture sync

The worker checks the STAC catalogue daily (`overture-sync`, maintenance queue, on by default in production) and loads a release once, when a new one appears. Releases come monthly and stay online about 60 days.

1. LeadForgeOvertureSyncFailed: read the run's `error` (`db.overture_sync_runs.find().sort({startedAt:-1}).limit(1)`) and the worker log. The previous release stays in use; discovery keeps working.
2. Run by hand: `pnpm overture:sync` (latest), `pnpm overture:sync --release=<yyyy-mm-dd.x>` (a specific release). A load takes 7 to 26 minutes depending on the link and database.
3. A release that would retire more than 5% of places stops with a warning. Look at the counts first; if the drop is genuine, rerun with `--force`.
4. One sync runs at a time (a lease in `overture_sync_runs`); a run silent for 10 minutes is treated as dead and the lease is released. A second process starting meanwhile exits without loading.
5. LeadForgeOvertureSyncStale (40 days without success): fix the sync before the loaded release falls out of Overture's 60-day window; record removals (retired places) are part of honoring erasure requests.

### Credit reconciliation

`reconcile-credits` (billing queue, every 10 minutes) settles finished discovery jobs and website analyses whose holds were never captured or released, and releases orphan holds; each pass writes `reconciliation_runs`.

1. LeadForgeUnreconciledJobs: finished jobs still hold credits after 30 minutes. Check the worker log for "Credit reconciliation ran" and its `errors`. A job stuck in a non-terminal state times out after `DISCOVERY_JOB_TIMEOUT_MS` (2 hours) and is settled then.
2. LeadForgeReconciliationNotRunning: no pass for 30 minutes. The repeatable schedules are registered by any worker that runs the `billing` or `maintenance` queue; make sure one does.
3. Ledger invariant (must always hold, read-only): `SELECT c.organization_id, c.credit_balance, COALESCE(SUM(l.units), 0) AS ledger FROM billing_customers c LEFT JOIN credit_ledger l ON l.billing_customer_id = c.id GROUP BY c.id HAVING c.credit_balance <> COALESCE(SUM(l.units), 0);` returns no rows. If it returns rows, stop and escalate: do not "fix" balances by hand.
4. LeadForgeNegativeBalances: a refund or reversal took back credits already spent. The organization's discovery and analysis are paused (`CREDIT_BALANCE_NEGATIVE`) and every member sees a banner. This is expected behavior, not an incident; the owner tops up or support agrees a resolution.

### Organization deletion

The workflow (docs/DATABASE_DESIGN.md, "Organization deletion (Stage 10)"): an owner requests the deletion (typed name and password), every member sees a banner for 14 days, owners and admins get an email at once and about 3 days before, and any owner can cancel in Settings, Organization. The `scan-organization-deletions` maintenance job (every 10 minutes) then enqueues `purge-organization` for each organization past `organizations.purge_after`. Operators never delete organization data by hand.

What the purge deletes, anonymizes and keeps:

|            |                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Deleted    | Every MongoDB document with the organization's id in every organization-scoped collection of the schema registry (businesses, provenance, jobs and their items, analyses, enrichment runs, scoring profile, duplicates and merge history, lists, leads, activities, outreach, bulk operations, imports and staged rows, exports, organization data exports, suppression entries, source switches, pipeline configuration, notifications); export and organization-export files; memberships, invitations, notification preferences, API keys, `usage_daily` rows; queued and delayed jobs. |
| Anonymized | Members who belong to no other organization (email `erased+<userId>@erased.invalid`, name and password cleared, sessions revoked); the billing customer's contact email; the organization's name and slug.                                                                                                                                                                                                                                                                                                                                                                                 |
| Kept       | Payments, invoices (frozen bill-to) and invoice PDFs, refunds, disputes, the credit ledger, entitlements, `billing_audit`, webhook events, the organization's `audit_events`, the organization row (closed and marked purged), members of other organizations. Global data (the Overture catalogue, platform suppression entries and source switches) is never touched.                                                                                                                                                                                                                    |

1. **Check progress** (read-only): `SELECT organization_id, trigger, attempts, completed_at, last_error, steps FROM organization_erasures ORDER BY started_at DESC LIMIT 20;`. `steps` lists each finished step (`stop_work`, `subscription`, `storage`, `mongo`, `postgres`, `finalize`) with its counts.
2. **LeadForgeOrganizationPurgeFailing**: read `last_error` and the worker log ("Organization purge step failed"). The purge resumes after its last finished step on the next scan. The usual cause is Paystack refusing or not answering the subscription disable (the step retries rather than leave a renewing subscription behind): check Paystack's status, then let the next scan run, or resume at once with `pnpm org:purge <organizationId>`. The organization is already closed to its members from the first step, so nobody can work in a half-purged workspace.
3. **Paystack not configured** on this server: the `subscription` step records `providerSkipped`; disable the subscription in the Paystack dashboard by hand (the code is in `subscriptions.provider_subscription_code`).
4. **A customer asks to undo** after the purge started: it cannot be undone (step 1 closed the organization; later steps delete data). Before the purge, any owner can cancel in Settings; support cannot cancel on their behalf without an owner's written request (then clear the request with an owner session, never by SQL).
5. **Erasure receipts**: each finished purge writes `erasures/<organizationId>.json` to object storage (ids, timestamps and counts, no personal data) and logs "Organization purged" with the same content. Object storage is not part of the database backups, so these receipts are the log of erasures to re-apply after a restore (next section). Keep them for as long as the oldest backup.

### Rotating secrets

Rotate on a schedule (at least yearly), when someone with access leaves, and at once on suspected exposure. Change the value in the platform's secret store, then restart the processes listed.

| Secret                                                          | Restart                 | Effect of rotation                                                                                                                                                                                                                             |
| --------------------------------------------------------------- | ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `JWT_PRIVATE_KEY` / `JWT_PUBLIC_KEY` (`pnpm gen:keys`)          | api                     | Every access token becomes invalid; browsers refresh with their refresh cookie (refresh tokens are opaque and stored hashed, so sessions survive)                                                                                              |
| `CSRF_SECRET`                                                   | api                     | CSRF tokens change; signed-in browsers get `CSRF_FAILED` until they refresh their session (sign-in or refresh issues a new token). Also changes the derived export-link key unless `EXPORT_SIGNING_SECRET` is set                              |
| `EXPORT_SIGNING_SECRET`                                         | api                     | Open download links (15 minutes) stop working; users request a new link                                                                                                                                                                        |
| `PAYSTACK_SECRET_KEY`                                           | api, worker             | Roll in the Paystack dashboard first; webhooks are signed with the key, so events signed with the old key fail with 401 after the switch and Paystack retries them. Do it in a quiet hour; reconciliation verifies pending payments afterwards |
| `METRICS_TOKEN`                                                 | api, worker, Prometheus | Update Prometheus's credentials file at the same time                                                                                                                                                                                          |
| Database passwords (`DATABASE_URL`, `MONGODB_URI`), `REDIS_URL` | api, worker             | Create the new credential, deploy, then revoke the old one                                                                                                                                                                                     |
| `OBJECT_STORAGE_ACCESS_KEY_ID` / `_SECRET_ACCESS_KEY`           | api, worker             | Presigned links in flight expire within minutes                                                                                                                                                                                                |
| `SMTP_URL`                                                      | worker                  | Mail jobs fail and retry until the new credential is live                                                                                                                                                                                      |

To sign everyone out (suspected token theft), rotate the JWT keys and revoke all sessions: `UPDATE sessions SET revoked_at = now() WHERE revoked_at IS NULL;` (refresh then fails and users sign in again).

### Backup and restore

Targets for release 1:

|                       | Target                                                                          | How                                                                                                                                                                                              |
| --------------------- | ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| RPO (data loss)       | 5 minutes with managed point-in-time recovery; 24 hours with logical dumps only | MongoDB Atlas continuous cloud backup and the managed PostgreSQL provider's PITR (WAL) are the primary backups. The logical dumps below are the portable, provider-independent copy, taken daily |
| RTO (time to restore) | 4 hours for a full restore of both databases                                    | Measured drill below: about 1 minute for a small database; scale with data size and network                                                                                                      |
| Retention             | Daily dumps 7 days, weekly 5 weeks, monthly 12 months                           | Store encrypted (provider-side encryption plus a separate key), in another account or region, readable by operators only                                                                         |

Scripts (Node, no dependencies; `docker` mode runs the tools inside the database containers, `native` mode uses `pg_dump`, `mongodump`, `psql`, `mongosh` from PATH with `PG_URL` and `MONGO_URI`; connection strings are never printed):

```bash
pnpm backup  --out backups/2026-10-27 --pg-db leadforge --mongo-db leadforge
pnpm restore --from backups/2026-10-27 --pg-target leadforge_restore --mongo-target leadforge_restore
```

`backup.mjs` writes `postgres-<db>.dump` (`pg_dump -Fc`, no owner or privileges), `mongo-<db>.archive.gz` (`mongodump --archive --gzip`) and `manifest.json` (exact row count per table and document count per collection taken just before the dump, sizes, SHA-256). `restore.mjs` refuses non-empty targets (unless `--replace`) and the source database names (unless `CONFIRM_RESTORE` names them as well), restores, compares every count with the manifest (exit 1 on any difference), then revokes every session and unused email link in the restored PostgreSQL database.

Drill (2026-10-27, local Docker, this development machine): backup of the development PostgreSQL database `leadforge` (25 tables, 2,758 rows, 121 KB dump, 0.8 s) and the MongoDB database `leadforge_local` (27 collections, 163,468 documents including the 162,475-place Overture catalogue, 58 MB archive, 20 s); restore into scratch databases `leadforge_restore_drill`: PostgreSQL 1.6 s, MongoDB 43 s, 49 s in total. Every table and collection count matched the manifest; 161 MongoDB indexes and 27 validators came back; 45 sessions and 3 email links were revoked in the restored copy. The scratch databases and the dump files were deleted afterwards. Repeat the drill quarterly and after major schema changes.

What must not be restored or kept:

- **Redis.** Never backed up or restored. It holds queues, caches, rate-limit counters and revocation keys. After a restore, start with an empty Redis (or flush the LeadForge prefix): reconciliation re-verifies pending payments and settles holds, and stuck jobs are recovered by the maintenance jobs.
- **Sessions and email links from the backup.** Revoked by `restore.mjs`; everyone signs in again. Otherwise sessions signed out or revoked after the backup would work again.
- **Deletions made after the backup.** Re-apply them before reopening: organization deletions, suppression and do-not-collect entries, data-subject erasure and correction requests (`contact_submissions` of kind `data_request` handled since the backup), and Overture places retired since (rerun `pnpm overture:sync --force`). Keep a log of erasure actions outside the database for exactly this purpose. Organization deletions (Stage 10): list the erasure receipts in object storage (`erasures/*.json`, for example `aws s3 ls s3://<bucket>/erasures/` or the local storage directory) whose `completedAt` is later than the backup, and for each run `pnpm org:purge <organizationId> --reapply` against the restored databases before reopening. It runs every purge step again (idempotent): the restored documents, memberships and user details of the purged organization are deleted or anonymized again, and billing records stay. Then check `organization_erasures` shows `trigger = reapply` and a `completed_at` for each.
- **Expired source content.** After a restore, run the retention purge at once (the maintenance queue runs `purge-expired-content` every 10 minutes); it removes values whose source retention has ended.
- **Export files and invoice PDFs in object storage.** Not part of the database backup; export files expire after 7 days anyway, and invoice PDFs are regenerated on demand (`generate-invoice-pdf`).
- **Test and load-test databases** (`*_test`, `*_perf`): never backed up, never restored into anything else.
- **Backups past their retention.** Delete them; they contain personal data (business contacts, user emails and password hashes).

### Incident response basics

1. **Declare.** Anyone can declare an incident. Name an incident lead (decides) and a scribe (keeps the timeline with UTC times).
2. **Severity.** SEV1: data exposure across organizations, money moved wrongly, or the product down for everyone. SEV2: a core flow broken (sign-in, discovery, payments) or an alert that pages. SEV3: degraded or a single customer.
3. **Stabilize first.** Roll back the last deploy if it correlates; scale the worker or pause a queue's worker (`WORKER_QUEUES`) if one workload starves the others; for suspected credential theft rotate secrets and revoke sessions (see above).
4. **Billing incidents.** Stop the bleeding without touching balances by hand: disable checkout by removing `PAYSTACK_SECRET_KEY` from the API (billing shows "not configured"; webhooks are refused and Paystack retries them later), keep the worker running so reconciliation continues.
5. **Personal data breach.** Preserve logs and evidence, and inform the people responsible for compliance at once: the Nigeria Data Protection Act 2023 requires notifying the Nigeria Data Protection Commission within 72 hours of becoming aware of a breach likely to risk individuals' rights, and the affected people without undue delay where the risk is high (GDPR has the same 72-hour rule for EU data). Legal review of this procedure is a pre-launch item.
6. **Communicate.** Status updates to affected customers at least hourly for SEV1 and SEV2, with what is known, what is affected and the next update time. No speculation about causes.
7. **Close.** Within 5 working days: a blameless write-up (timeline, impact, root cause, what went well, actions with owners), linked from this file's change log.
