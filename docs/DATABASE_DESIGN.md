# LeadForge Database Design

Status: Phase 0 proposal, pending approval. Last updated 2026-10-24.

Two databases, strict ownership. MongoDB holds business intelligence. PostgreSQL holds identity and money. Nothing authoritative is duplicated across them.

## 1. Conventions

- PostgreSQL IDs: UUID v7 generated in the application; timestamps `timestamptz`; money as `bigint` minor units plus `char(3)` currency.
- MongoDB IDs: `ObjectId` for `_id`; `organizationId` is the PostgreSQL UUID as a string; timestamps are BSON dates; every collection has a JSON Schema validator (`validationLevel: moderate`).
- Soft delete only where workflows need it (businesses, leads); hard delete for tokens and ephemeral data.
- Every org-scoped collection's indexes begin with `organizationId`.

## 2. MongoDB collections

### `businesses` (canonical profile, one per org per business)

```
{
  _id, organizationId,
  name: { value, normalized, state, confidence },
  slug,                                   // org-unique, derived from normalized name + locality
  categories: [{ value, taxonomy: "leadforge" | "google" | "user", observationIds }],
  location: {
    formatted, street, locality, region, country (ISO 3166-1 alpha-2), postalCode,
    geo: { type: "Point", coordinates: [lng, lat] } | null,
    state, confidence
  },
  website: { value, domain, state, confidence, lastObservedAt, lastVerifiedAt, expiresAt, observationIds },
  phones: [{
    e164, raw, country, type: "mobile" | "fixed" | "unknown", state, confidence,
    whatsapp: { status: "confirmed" | "user_asserted" | "unknown", evidenceObservationId, assertedByUserId, assertedAt },
    observationIds, lastObservedAt, lastVerifiedAt, expiresAt
  }],
  emails: [{ address, domain, state, confidence, verification: { method, result, checkedAt }, observationIds, lastObservedAt, lastVerifiedAt, expiresAt }],
  socials: [{ platform: "facebook" | "instagram" | "linkedin" | "x" | "tiktok" | "youtube", url, handle, state, observationIds }],
  externalRefs: [{ source: "google_places", externalId, lastFetchedAt, expiresAt }],
  sourceSummary: [{ source, firstSeenAt, lastSeenAt, observationCount }],
  score: { fit, dataConfidence, profileId, computedAt, breakdown: [{ signal, weight, value, contribution }] },
  latestWebsiteAnalysisId,
  dedup: { status: "unique" | "has_candidates" | "merged_into", mergedIntoId, candidateCount },
  flags: { suppressed, suppressedReason, doNotContact },
  createdAt, updatedAt, deletedAt, createdByJobId, createdByUserId
}
```

Indexes:

- `{ organizationId: 1, slug: 1 }` unique
- `{ organizationId: 1, "website.domain": 1 }` partial on domain existing
- `{ organizationId: 1, "phones.e164": 1 }`
- `{ organizationId: 1, "emails.address": 1 }` (not unique: shared emails are legitimate)
- `{ organizationId: 1, "categories.value": 1, "location.locality": 1 }`
- `{ organizationId: 1, "score.fit": -1, _id: -1 }`
- `{ organizationId: 1, updatedAt: -1, _id: -1 }`
- `{ organizationId: 1, "externalRefs.source": 1, "externalRefs.externalId": 1 }`
- Text index on `name.normalized`, `website.domain`, `location.formatted` (or Atlas Search if hosted on Atlas; decided in Phase 1)
- `{ "location.geo": "2dsphere" }`

Document growth is bounded: `observationIds` arrays are capped at 50 per field; older IDs are dropped from the array while the observations themselves remain queryable by `businessId`.

### `source_observations` (immutable provenance)

```
{
  _id, organizationId, businessId, source, sourceRef (URL or API path), sourceExternalId,
  field: "name" | "website" | "phone" | "email" | "social" | "category" | "location" | "whatsapp" | "hours" | "description",
  rawValue, normalizedValue,
  collectedAt, collectionMethod: "api" | "website_fetch" | "user_import" | "user_edit",
  verification: { method, status: "verified" | "unverified" | "failed", checkedAt, details },
  confidence, discoveryJobId, enrichmentRunId,
  policy: { retainValueUntil },            // only for retention-limited sources
  redactedAt,                              // set when the value was removed per policy; metadata kept
  metadata
}
```

Indexes: `{ organizationId: 1, businessId: 1, field: 1, collectedAt: -1 }`, `{ organizationId: 1, source: 1, collectedAt: -1 }`, `{ organizationId: 1, discoveryJobId: 1 }`, `{ "policy.retainValueUntil": 1 }` for the redaction job. No TTL index: a scheduled job redacts `rawValue` and `normalizedValue` after `retainValueUntil` so the fact that "field X was observed from source Y on date Z" survives without the restricted value.

### `verification_events`

`{ _id, organizationId, businessId, field, fieldKey (e164 or address), method, result, details, actorType: "system" | "user", actorId, occurredAt }`. Index `{ organizationId: 1, businessId: 1, occurredAt: -1 }`.

### `discovery_jobs`

```
{
  _id, organizationId, name,
  status: "draft" | "queued" | "running" | "completed" | "completed_with_warnings" | "failed" | "cancelled",
  spec: {
    sources: [sourceKey],
    location: { query, country, region, locality, geo, radiusM },
    categories: [], domainsInclude: [], domainsExclude: [],
    maxRecords, priorityFields: ["phone", "email", "whatsapp"], icpProfileId
  },
  estimate: { credits, basis },
  credits: { holdId, heldUnits, capturedUnits, releasedUnits, settledAt },
  progress: { discovered, created, updated, duplicates, skipped, failed, pagesFetched, lastEventAt },   // updated by worker events only
  sourceOutcomes: [{ source, status, pages, records, errors: [{ code, message, count }], rateLimited }],
  errors: [{ code, message, at }], warnings: [],
  queue: { bullJobId, attempts, lastAttemptAt },
  createdByUserId, createdAt, startedAt, finishedAt, cancelledAt, cancelRequested, updatedAt
}
```

Indexes: `{ organizationId: 1, createdAt: -1 }`, `{ organizationId: 1, status: 1, createdAt: -1 }`, `{ status: 1, finishedAt: 1 }` for reconciliation, `{ "credits.settledAt": 1, status: 1 }`.

### `discovery_job_items`

`{ _id, organizationId, jobId, source, externalId, outcome: "created" | "updated" | "duplicate" | "skipped" | "failed", businessId, duplicateOfId, error, attempts, billable, processedAt }`. Unique `{ jobId: 1, source: 1, externalId: 1 }` for idempotent reprocessing; `{ organizationId: 1, jobId: 1, outcome: 1 }`.

### `enrichment_runs`

`{ _id, organizationId, businessId, kind: "website_contacts" | "normalize" | "email_check", status, input, output: { observationIds }, error, startedAt, finishedAt, triggeredBy }`. Index `{ organizationId: 1, businessId: 1, startedAt: -1 }`.

### `website_analyses`

```
{
  _id, organizationId, businessId, url, finalUrl,
  fetched: { status, redirects: [], bytes, contentType, durationMs, tls: { valid, issuer } },
  detections: [{ key, observed: "yes" | "no" | "unknown", confidence, evidence: [{ type: "selector" | "url" | "text" | "header", value, page }] }],
  opportunities: [{ key, title, rationale, confidence, detectionKeys: [] }],
  pagesVisited: [{ url, status }], robots: { fetched, allowed },
  credits: { holdId, captured },
  status: "queued" | "running" | "completed" | "failed", error, analyzedAt, createdAt
}
```

Indexes: `{ organizationId: 1, businessId: 1, analyzedAt: -1 }`, `{ organizationId: 1, status: 1 }`, `{ organizationId: 1, "opportunities.key": 1 }`.

### `scoring_profiles`

`{ _id, organizationId, name, isDefault, weights: { contactCompleteness, contactVerification, websiteOpportunity, industryMatch, locationMatch, freshness, sourceReliability }, icp: { categories: [], locations: [], countries: [] }, version, createdAt, updatedAt }`. Unique `{ organizationId: 1, name: 1 }`.

### `duplicate_candidates`

`{ _id, organizationId, businessIds: [a, b] (sorted), stage: "domain" | "phone" | "email" | "name_location", score, signals: [{ kind, aValue, bValue, similarity }], status: "pending" | "merged" | "dismissed", decidedByUserId, decidedAt, createdAt }`. Unique `{ organizationId: 1, businessIds: 1 }`; `{ organizationId: 1, status: 1, score: -1 }`.

### `merge_history`

`{ _id, organizationId, survivorId, mergedIds: [], snapshotBefore: { survivor, merged: [] }, fieldDecisions: [{ field, chosenFrom }], performedByUserId, performedAt, undoneAt, undoneByUserId }`. Indexes `{ organizationId: 1, survivorId: 1 }`, `{ organizationId: 1, mergedIds: 1 }`.

### `lead_lists` and `lead_list_items`

`lead_lists`: `{ _id, organizationId, name, description, ownerUserId, itemCount, createdAt, updatedAt }`, unique `{ organizationId: 1, name: 1 }`.
`lead_list_items`: `{ _id, organizationId, listId, businessId, addedByUserId, addedAt }`, unique `{ listId: 1, businessId: 1 }`, index `{ organizationId: 1, businessId: 1 }`.

### `leads` (pipeline state, separate from business facts and score)

`{ _id, organizationId, businessId, stageKey, stageEnteredAt, ownerUserId, priority, nextActionAt, lastActivityAt, lostReason, wonValueMinor, currency, tags: [], createdByUserId, createdAt, updatedAt }`. Unique `{ organizationId: 1, businessId: 1 }`; `{ organizationId: 1, stageKey: 1, updatedAt: -1 }`; `{ organizationId: 1, ownerUserId: 1, nextActionAt: 1 }`.

`pipeline_configs`: `{ _id, organizationId, stages: [{ key, label, order, isWon, isLost }], updatedAt }`, unique on `organizationId`.

### `lead_activities`

`{ _id, organizationId, businessId, leadId, type: "note" | "call" | "whatsapp" | "email" | "meeting" | "stage_change" | "assignment", body, outcome, channelRef, occurredAt, createdByUserId, createdAt }`. Indexes `{ organizationId: 1, businessId: 1, occurredAt: -1 }`, `{ organizationId: 1, createdByUserId: 1, occurredAt: -1 }`.

### `export_jobs`

`{ _id, organizationId, kind: "businesses" | "list" | "pipeline", filter, columns, status, rowCount, rowCap, file: { key, bytes, expiresAt }, requestedByUserId, createdAt, finishedAt, error }`. Index `{ organizationId: 1, createdAt: -1 }`; a cleanup job removes stored files after `file.expiresAt`.

### `suppression_entries`

`{ _id, organizationId, kind: "domain" | "phone" | "email" | "business", value, reason, createdByUserId, createdAt }`. Unique `{ organizationId: 1, kind: 1, value: 1 }`. Checked at ingest, merge, bulk actions and export. A platform-wide list uses `organizationId: null`.

### `source_configs`

`{ _id, organizationId | null (platform default), sourceKey, enabled, settings, rateLimit, retentionDays, policy, lastHealthAt, lastHealthStatus }`. Unique `{ organizationId: 1, sourceKey: 1 }`.

### `notifications`

`{ _id, organizationId, userId, type, title, body, href, readAt, createdAt }`. Index `{ userId: 1, readAt: 1, createdAt: -1 }`; TTL 90 days on `createdAt`.

### `audit_events`

`{ _id, organizationId, actorUserId, actorType, action, resourceType, resourceId, before, after, ip, userAgent, requestId, occurredAt }`. Indexes `{ organizationId: 1, occurredAt: -1 }`, `{ organizationId: 1, resourceType: 1, resourceId: 1 }`. Append-only; the application database role has no update or delete privilege on this collection.

## 3. PostgreSQL schema (Prisma)

### Identity

```
users(id uuid pk, email citext unique, email_verified_at, password_hash, name, avatar_url, locale,
      is_platform_admin bool default false, created_at, updated_at, deleted_at)
sessions(id uuid pk, user_id fk users on delete cascade, refresh_token_hash unique, family_id uuid,
         user_agent, ip, created_at, last_used_at, expires_at, revoked_at)
email_tokens(id uuid pk, user_id fk, purpose enum(verify_email, reset_password), token_hash unique, expires_at, consumed_at)
organizations(id uuid pk, name, slug citext unique, country char(2), default_currency char(3),
              freshness_days int default 180, created_by_user_id fk users, created_at, updated_at, deleted_at, deletion_requested_at)
memberships(id uuid pk, organization_id fk on delete cascade, user_id fk on delete cascade,
            role enum(owner, admin, researcher, sales_rep, analyst), status enum(active, suspended), created_at,
            unique(organization_id, user_id))
invitations(id uuid pk, organization_id fk, email citext, role, token_hash unique, invited_by_user_id, expires_at, accepted_at, revoked_at)
  partial unique(organization_id, email) where accepted_at is null and revoked_at is null
api_keys(id uuid pk, organization_id fk, name, key_prefix, key_hash unique, scopes text[], created_by, last_used_at, revoked_at)
  -- table created in Phase 1, feature disabled in release 1
notification_preferences(user_id fk, organization_id fk, email_job_events bool, email_billing bool, inapp_all bool, updated_at,
                         primary key(user_id, organization_id))
```

### Billing

```
billing_customers(id uuid pk, organization_id fk unique, provider enum(paystack), provider_customer_code unique,
                  email, credit_balance int not null default 0, currency char(3), created_at, updated_at)
plans(id uuid pk, code text unique, name, description, interval enum(monthly, yearly), price_minor bigint, currency char(3),
      included_credits int, max_members int, export_row_cap int, is_active bool, is_placeholder bool,
      provider_plan_code text unique null, sort_order int, created_at, updated_at)
credit_packs(id uuid pk, code unique, name, credits int, price_minor bigint, currency, is_active, is_placeholder, created_at)
subscriptions(id uuid pk, billing_customer_id fk, plan_id fk, status enum(incomplete, active, past_due, cancelled, expired),
              provider_subscription_code unique null, provider_email_token, current_period_start, current_period_end,
              cancel_at_period_end bool, cancelled_at, created_at, updated_at)
invoices(id uuid pk, billing_customer_id fk, subscription_id fk null, number text unique,
         status enum(draft, open, paid, void, uncollectible), subtotal_minor, tax_minor, total_minor, currency,
         issued_at, due_at, paid_at, provider_invoice_code unique null, pdf_key)
payments(id uuid pk, billing_customer_id fk, invoice_id fk null, purpose enum(subscription, credit_pack), purpose_ref uuid,
         provider, provider_reference text unique not null, provider_transaction_id text unique null,
         amount_minor bigint, currency, status enum(pending, success, failed, reversed, abandoned), channel,
         authorization_masked jsonb,     -- last4, brand, bank, expiry only; never PAN
         initiated_at, verified_at, failed_at, reversed_at, last_event_id uuid null, idempotency_key text unique)
refunds(id uuid pk, payment_id fk, provider_refund_reference unique, amount_minor, currency,
        status enum(pending, processed, failed), reason, created_at, processed_at)
payment_webhook_events(id uuid pk, provider, provider_event_id text, event_type, reference text, signature_valid bool,
                       payload jsonb, received_at, processed_at, processing_status enum(received, processed, ignored, failed), error,
                       unique(provider, provider_event_id), index(reference))
credit_ledger(id uuid pk, billing_customer_id fk,
              entry_type enum(grant, purchase, hold, capture, release, adjustment, refund_reversal, expiry),
              units int not null,            -- signed
              captured_units int null,       -- set on capture rows only
              balance_after int not null, reference_type text, reference_id text, hold_id uuid null fk credit_ledger,
              idempotency_key text unique not null, description, actor_user_id uuid null, created_at)
entitlements(id uuid pk, billing_customer_id fk, key text, value_int, value_bool, source enum(plan, override),
             valid_from, valid_to, unique(billing_customer_id, key, source))
reconciliation_runs(id uuid pk, kind enum(payments, holds, subscriptions), started_at, finished_at, checked int, fixed int, errors jsonb)
billing_audit(id uuid pk, billing_customer_id fk, actor_type, actor_id, action, before jsonb, after jsonb, request_id, created_at)
usage_daily(id uuid pk, organization_id fk, day date, metric text, value bigint, unique(organization_id, day, metric))
contact_submissions(id uuid pk, kind enum(contact, data_request), name, email, company, message, ip_hash, created_at, handled_at)
```

Monetary precision: all `*_minor` columns are `bigint` (Prisma `BigInt`). Paystack amounts in kobo map directly. Credits are integer units, not money.

Paystack webhook payloads do not carry a stable event ID in every event type. `provider_event_id` is therefore computed as `sha256(event_type + ":" + data.reference + ":" + data.id + ":" + data.status)` when the provider does not supply one. This is confirmed against the live payload shapes in Phase 6 and documented there.

Deletion: organization deletion is a workflow (request, 14-day grace, worker purges Mongo collections by `organizationId` and anonymizes PG user rows while retaining billing records for the statutory period). Cascades are limited to sessions, memberships, invitations and preferences.

## 4. Credit ledger semantics

Balance invariant: `billing_customers.credit_balance` equals the signed sum of `credit_ledger.units` for that customer. `grant`, `purchase`, `release` and positive `adjustment` are positive; `hold`, `expiry`, `refund_reversal` and negative `adjustment` are negative.

A hold debits the balance immediately, so settlement must not debit again. The convention for a job that held `h` units and produced `n` billable units is:

- `hold`: `units = -h` (balance drops by h at queue time)
- `release`: `units = +(h - n)` (unused portion returned at settlement)
- `capture`: `units = 0`, with `n` recorded in a `captured_units` column; it exists for reporting and marks the hold closed

The net effect of a settled job is exactly `-n`. A `capture` always references its `hold_id` and `n` never exceeds `h`. Tests assert the balance invariant after every scenario, including partial failure and reconciliation.

Hold procedure (one PG transaction):

1. `SELECT ... FROM billing_customers WHERE id = $1 FOR UPDATE`
2. If an entry with this `idempotency_key` exists, return it (no-op).
3. Check `credit_balance >= h`, else raise `INSUFFICIENT_CREDITS`.
4. Insert ledger row, update cached balance, commit.

Settle procedure: under the same lock, insert `capture` and `release` with keys `job:<id>:capture` and `job:<id>:release`; both idempotent.

## 5. Payment workflow (PostgreSQL only)

1. API creates a `payments` row with `status = pending`, our own `provider_reference` (UUID-derived), and `idempotency_key = checkout:<orgId>:<purpose>:<purposeRef>:<minute-bucket>` so a double click reuses the same checkout.
2. API calls Paystack transaction initialize with `reference`, `amount`, `email`, `callback_url`, and `plan` for subscriptions. The returned `authorization_url` goes to the browser.
3. Browser returns to `callback_url`; the page shows "Confirming payment" and polls the payment by reference. Nothing is granted here.
4. Webhook endpoint verifies `x-paystack-signature` (HMAC SHA-512 of the raw body with the secret key, constant-time compare). It inserts `payment_webhook_events`; on unique conflict it returns 200 and stops. Otherwise it enqueues `process-webhook` and returns 200.
5. Worker loads the event, calls Paystack transaction verify by reference, and only if `status = success` with matching amount and currency performs one PG transaction: payment to `success`, invoice to `paid`, ledger `purchase` or `grant` with `idempotency_key = payment:<paymentId>:grant`, subscription activated or extended, `billing_audit` written, event marked processed. The ledger key makes any replay a no-op even if the event dedupe were bypassed.
6. Failed charge or failed invoice events set payment `failed`, subscription `past_due`, and notify. Refund or reversal events create a `refunds` row and a negative `refund_reversal` ledger entry (balance may go negative; discovery is blocked until positive), and adjust the subscription.
7. Reconciliation every 15 minutes: pending payments older than 20 minutes are verified directly; `past_due` subscriptions beyond the grace period become `expired` and entitlements are recalculated; orphan holds older than 24h are released.

## 6. Entitlements

Derived on plan or subscription status change into `entitlements` rows: `max_members`, `export_row_cap`, `discovery_enabled`, `website_analysis_enabled`, `monthly_included_credits`. The API reads entitlements, never the plan directly, so overrides are possible. Included monthly credits are granted as a ledger `grant` at each successful period payment with key `sub:<id>:period:<period_start>`.

## 7. Migrations and seeds

- Prisma migrations in `packages/db-postgres/prisma/migrations`, applied by `pnpm db:migrate`.
- Mongo validators and indexes applied idempotently by `pnpm db:mongo:sync`.
- `pnpm db:seed` creates one synthetic organization named "Acme Demo (Synthetic)", users with `@example.test` emails, placeholder plans flagged `is_placeholder`, and 200 clearly synthetic businesses whose names end in "(Sample)" and whose domains are under `example.test`. Seeds refuse to run when `NODE_ENV=production`.

## 8. Backup and retention

- PostgreSQL: daily dump plus provider point-in-time recovery where available. Retention 30 days.
- MongoDB: daily snapshots. `audit_events` and `merge_history` retained 2 years; `notifications` 90 days; export files 7 days.
- Restore drill documented in `docs/OPERATIONS.md` during Phase 7.
