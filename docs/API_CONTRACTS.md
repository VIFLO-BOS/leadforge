# LeadForge API Contracts

Status: Phase 0 proposal, pending approval. Last updated 2026-10-24.

Base path `/api/v1`. JSON only. OpenAPI is generated from NestJS decorators and the Zod schemas in `packages/contracts`, served at `/api/docs` outside production and behind platform-admin auth in production.

## 1. Conventions

### Authentication and scope

- Access token: JWT (15 min) in an `lf_access` httpOnly, Secure, SameSite=Lax cookie. Refresh token (30 days, rotating) in an `lf_refresh` cookie scoped to the auth path.
- Organization scope: `X-Organization-Id: <uuid>` header on every workspace request. The server verifies membership. Missing or non-member yields `403 ORG_FORBIDDEN`.
- CSRF: double-submit `X-CSRF-Token` header required on state-changing browser requests.
- Request ID: `X-Request-Id` echoed in every response and error body.

### Response envelope

```
200: { "data": <object | array>, "meta"?: { "nextCursor": string | null, "prevCursor": string | null, "pageSize": number, "total"?: number, "totalApprox"?: number } }
4xx/5xx: { "error": { "code": "STRING_CODE", "message": "Human readable", "details"?: [{ "path": "field", "message": "..." }], "requestId": "..." } }
```

`total` is included only when cheap to compute. Business search above 10k matches returns `totalApprox` instead.

### Pagination, sorting, filtering

- Cursor pagination: `?cursor=&pageSize=25` (max 100). Cursors are opaque base64 of `[sortValue, _id]`.
- Sorting: `?sort=field:asc|desc` from a per-endpoint allowlist.
- Filtering: explicit query params per endpoint. Arrays as repeated params (`?industry=a&industry=b`).

### Error codes (shared enum in `packages/contracts`)

`VALIDATION_FAILED`, `UNAUTHENTICATED`, `TOKEN_EXPIRED`, `EMAIL_NOT_VERIFIED`, `FORBIDDEN`, `ORG_FORBIDDEN`, `NOT_FOUND`, `CONFLICT`, `RATE_LIMITED`, `INSUFFICIENT_CREDITS`, `ENTITLEMENT_REQUIRED`, `SOURCE_UNAVAILABLE`, `SOURCE_POLICY_BLOCKED`, `INVALID_URL`, `URL_NOT_ALLOWED`, `PAYMENT_PROVIDER_ERROR`, `WEBHOOK_SIGNATURE_INVALID`, `JOB_NOT_CANCELLABLE`, `MERGE_CONFLICT`, `INTERNAL_ERROR`.

Internal errors never leak messages. Clients get `INTERNAL_ERROR` plus the request ID.

### Rate limits (per IP unless noted)

Auth endpoints 10 per minute; public contact 3 per hour; authenticated general 600 per minute per user; exports 10 per hour per org; discovery job creation 30 per hour per org. 429 responses include `Retry-After`.

## 2. Endpoints

### Public

| Method | Path                            | Body or query                               | Returns                                            |
| ------ | ------------------------------- | ------------------------------------------- | -------------------------------------------------- |
| GET    | `/public/plans`                 | none                                        | active plans and credit packs with `isPlaceholder` |
| POST   | `/public/contact`               | `{ name, email, company?, message, kind? }` | `202 { data: { received: true } }`                 |
| GET    | `/public/sources`               | none                                        | source registry with coverage statements           |
| GET    | `/health/live`, `/health/ready` | none                                        | readiness checks Postgres, Mongo, Redis            |

### Auth (`/auth`)

| Method      | Path                                   | Notes                                                                                                                 |
| ----------- | -------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| POST        | `/auth/register`                       | `{ email, password, name, organizationName, country }`; creates user, org, owner membership; sends verification email |
| POST        | `/auth/login`                          | `{ email, password }`; sets cookies; returns `{ user, organizations[] }`                                              |
| POST        | `/auth/logout`                         | revokes session                                                                                                       |
| POST        | `/auth/refresh`                        | rotates tokens; reuse of an old refresh token revokes the family                                                      |
| POST        | `/auth/verify-email`                   | `{ token }`                                                                                                           |
| POST        | `/auth/resend-verification`            |                                                                                                                       |
| POST        | `/auth/forgot-password`                | `{ email }`; always 202                                                                                               |
| POST        | `/auth/reset-password`                 | `{ token, password }`; revokes all sessions                                                                           |
| GET         | `/auth/me`                             | `{ user, organizations: [{ id, name, role }] }`                                                                       |
| GET, DELETE | `/auth/sessions`, `/auth/sessions/:id` | session management                                                                                                    |

### Organizations

| Method            | Path                                       | Notes                                                                     |
| ----------------- | ------------------------------------------ | ------------------------------------------------------------------------- |
| GET               | `/organizations/current`                   | profile, settings, entitlements summary                                   |
| PATCH             | `/organizations/current`                   | `{ name?, country?, freshnessDays?, defaultCurrency? }` (admin and above) |
| GET               | `/organizations/current/members`           | cursor list                                                               |
| PATCH             | `/organizations/current/members/:userId`   | `{ role }` or `{ status }`; cannot demote the last owner                  |
| DELETE            | `/organizations/current/members/:userId`   | admin and above                                                           |
| POST, GET, DELETE | `/organizations/current/invitations[/:id]` | `{ email, role }` on create                                               |
| POST              | `/invitations/:token/accept`               | authenticated user accepts                                                |
| POST              | `/organizations/current/deletion-requests` | owner; starts the 14-day grace                                            |

### Businesses

| Method | Path                                  | Notes                                                                                                                                                                                                      |
| ------ | ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/businesses`                         | query: `q, industry[], country, region, locality, hasPhone, hasEmail, hasWebsite, whatsapp, emailState[], phoneState[], scoreMin, scoreMax, source[], listId, stage, updatedAfter, sort, cursor, pageSize` |
| POST   | `/businesses`                         | manual create (researcher and above); records a `user_edit` observation                                                                                                                                    |
| GET    | `/businesses/:id`                     | full profile plus provenance summary                                                                                                                                                                       |
| PATCH  | `/businesses/:id`                     | corrections `{ field, value, note }`; records `user_edit`; state becomes `unverified` unless a verification method confirms it                                                                             |
| DELETE | `/businesses/:id`                     | soft delete (admin and above)                                                                                                                                                                              |
| GET    | `/businesses/:id/observations`        | `field?, source?, cursor`                                                                                                                                                                                  |
| GET    | `/businesses/:id/verification-events` |                                                                                                                                                                                                            |
| GET    | `/businesses/:id/analyses`            | website analysis history                                                                                                                                                                                   |
| GET    | `/businesses/:id/activities`          |                                                                                                                                                                                                            |
| GET    | `/businesses/:id/duplicates`          | candidates involving this business                                                                                                                                                                         |
| GET    | `/businesses/:id/score`               | breakdown                                                                                                                                                                                                  |
| POST   | `/businesses/:id/whatsapp-assertion`  | `{ phoneE164, status: "user_asserted"                                                                                                                                                                      | "unknown", note }`                                                      |
| POST   | `/businesses/:id/suppress`            | `{ reason, scope: "business"                                                                                                                                                                               | "domain"                                                                | "phone" | "email" }` |
| POST   | `/businesses/bulk`                    | `{ ids[] (max 500)                                                                                                                                                                                         | filter, action, params }`; sync up to 50 ids, otherwise `202 { jobId }` |
| POST   | `/businesses/import`                  | multipart CSV plus mapping JSON; `202 { importJobId }`                                                                                                                                                     |
| GET    | `/businesses/import/:id`              | import status and row errors                                                                                                                                                                               |

### Discovery

| Method | Path                               | Notes                                                                            |
| ------ | ---------------------------------- | -------------------------------------------------------------------------------- |
| GET    | `/discovery/sources`               | enabled sources with capabilities and policy notes                               |
| POST   | `/discovery/jobs/estimate`         | spec; returns `{ credits, basis, warnings[] }` or `{ estimateAvailable: false }` |
| POST   | `/discovery/jobs`                  | spec; `Idempotency-Key` header required; `201` job with `status: queued`         |
| GET    | `/discovery/jobs`                  | `status[], source, cursor`                                                       |
| GET    | `/discovery/jobs/:id`              | job with progress and source outcomes                                            |
| GET    | `/discovery/jobs/:id/items`        | `outcome[], cursor`                                                              |
| POST   | `/discovery/jobs/:id/cancel`       | sets `cancelRequested`; `409 JOB_NOT_CANCELLABLE` if terminal                    |
| POST   | `/discovery/jobs/:id/retry-failed` | re-enqueues failed items with a new hold                                         |
| GET    | `/discovery/jobs/:id/events`       | Server-Sent Events progress stream; polling is the fallback                      |

### Enrichment and analysis

| Method | Path                                          | Notes                                                                         |
| ------ | --------------------------------------------- | ----------------------------------------------------------------------------- |
| POST   | `/enrichment/businesses/:id/website-contacts` | enqueue contact extraction from the business's own site                       |
| POST   | `/enrichment/businesses/:id/verify-email`     | `{ address }`                                                                 |
| POST   | `/analysis/websites`                          | `{ businessId }` or `{ businessIds[] }`; `202 { analysisIds }`; holds credits |
| GET    | `/analysis/websites`                          | `status[], opportunity[], cursor`                                             |
| GET    | `/analysis/websites/:id`                      | detections, opportunities, evidence                                           |

### Scoring

| Method    | Path                                 | Notes                                      |
| --------- | ------------------------------------ | ------------------------------------------ |
| GET, POST | `/scoring/profiles`                  |                                            |
| PATCH     | `/scoring/profiles/:id`              | weights must sum to 100                    |
| POST      | `/scoring/profiles/:id/make-default` |                                            |
| POST      | `/scoring/recompute`                 | `{ profileId?, filter? }`; `202 { jobId }` |

### Deduplication

| Method | Path                            | Notes                                                     |
| ------ | ------------------------------- | --------------------------------------------------------- |
| GET    | `/dedup/candidates`             | `status, minScore, cursor`                                |
| POST   | `/dedup/candidates/:id/merge`   | `{ survivorId, fieldDecisions[] }`                        |
| POST   | `/dedup/candidates/:id/dismiss` |                                                           |
| POST   | `/dedup/merges/:id/undo`        | restores the snapshot; admin, or performer within 30 days |
| POST   | `/dedup/scan`                   | `{ businessIds? }`; `202`                                 |

### CRM

| Method             | Path                           | Notes                                                                                                         |
| ------------------ | ------------------------------ | ------------------------------------------------------------------------------------------------------------- |
| GET, POST          | `/lists`                       |                                                                                                               |
| GET, PATCH, DELETE | `/lists/:id`                   |                                                                                                               |
| GET, POST          | `/lists/:id/items`             | POST `{ businessIds[] }`                                                                                      |
| DELETE             | `/lists/:id/items/:businessId` |                                                                                                               |
| GET, PUT           | `/pipeline/config`             | `{ stages[] }`; requires exactly one won and one lost stage                                                   |
| GET, POST          | `/pipeline/leads`              | GET `stage, ownerUserId, priority, cursor`; POST `{ businessId, stageKey?, ownerUserId? }`                    |
| PATCH              | `/pipeline/leads/:id`          | `{ stageKey?, ownerUserId?, priority?, nextActionAt?, lostReason?, wonValueMinor? }`                          |
| GET, POST          | `/activities`                  | GET `type[], userId, from, to, cursor`; POST `{ businessId, type, body, outcome?, channelRef?, occurredAt? }` |
| PATCH, DELETE      | `/activities/:id`              | author or admin                                                                                               |
| GET                | `/outreach`                    | outbound activities grouped by business                                                                       |

### Exports

| Method | Path                       | Notes                                     |
| ------ | -------------------------- | ----------------------------------------- |
| POST   | `/exports`                 | `{ kind, filter                           | listId, columns[] }`; `202` job; enforces the plan row cap |
| GET    | `/exports`, `/exports/:id` |                                           |
| GET    | `/exports/:id/download`    | signed URL valid 15 minutes; audit logged |

### Usage and billing

| Method | Path                                                | Notes                                                                                                                              |
| ------ | --------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/usage/summary`                                    | `{ period, credits: { balance, held, capturedThisPeriod }, metrics: { discoveredBusinesses, analyses, exports } }` from PostgreSQL |
| GET    | `/usage/ledger`                                     | credit ledger, cursor                                                                                                              |
| GET    | `/billing/overview`                                 | subscription, plan, renewal date, balance, entitlements                                                                            |
| GET    | `/billing/plans`                                    |                                                                                                                                    |
| POST   | `/billing/checkout/subscription`                    | `{ planId }`; returns `{ authorizationUrl, reference }` (owner or admin)                                                           |
| POST   | `/billing/checkout/credits`                         | `{ packId }`; same shape                                                                                                           |
| GET    | `/billing/payments`, `/billing/payments/:reference` | the latter is polled after redirect                                                                                                |
| GET    | `/billing/invoices`, `/billing/invoices/:id/pdf`    |                                                                                                                                    |
| POST   | `/billing/subscription/cancel`                      | `{ atPeriodEnd: true }`                                                                                                            |
| POST   | `/billing/subscription/resume`                      |                                                                                                                                    |

### Webhooks

| Method | Path                 | Notes                                                                                                     |
| ------ | -------------------- | --------------------------------------------------------------------------------------------------------- |
| POST   | `/webhooks/paystack` | raw body; `x-paystack-signature` verified; 401 on bad signature; otherwise 200 after persisting the event |

### Reports

| Method | Path                                                                                   | Notes                                     |
| ------ | -------------------------------------------------------------------------------------- | ----------------------------------------- |
| GET    | `/reports/overview`                                                                    | metrics for the Overview page, `period=7d | 30d | 90d` |
| GET    | `/reports/source-breakdown`, `/reports/quality-distribution`, `/reports/jobs-timeline` |                                           |

### Notifications, audit, admin

| Method   | Path                                                 | Notes                                                                                                              |
| -------- | ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| GET      | `/notifications`                                     |                                                                                                                    |
| POST     | `/notifications/:id/read`, `/notifications/read-all` |                                                                                                                    |
| GET, PUT | `/notifications/preferences`                         |                                                                                                                    |
| GET      | `/audit-events`                                      | admin and above; `resourceType, actorUserId, from, to, cursor`                                                     |
| any      | `/admin/*`                                           | platform admins only: failed jobs, dead letters, reconciliation runs, source health; not linked from the dashboard |

## 3. Key schemas (Zod, abbreviated)

```ts
export const DiscoveryJobSpec = z.object({
  name: z.string().min(2).max(120),
  sources: z.array(SourceKey).min(1).max(3),
  location: z.object({
    country: z.string().length(2),
    region: z.string().max(120).optional(),
    locality: z.string().max(120).optional(),
    query: z.string().max(200).optional(),
    geo: z
      .object({ lat: z.number(), lng: z.number(), radiusM: z.number().int().min(100).max(50000) })
      .optional(),
  }),
  categories: z.array(z.string().max(80)).min(1).max(10),
  domainsInclude: z.array(Domain).max(50).default([]),
  domainsExclude: z.array(Domain).max(50).default([]),
  maxRecords: z.number().int().min(1).max(5000),
  priorityFields: z
    .array(z.enum(["phone", "email", "whatsapp", "website"]))
    .default(["phone", "email"]),
  icpProfileId: ObjectIdString.optional(),
});

export const FieldState = z.enum([
  "verified",
  "unverified",
  "stale",
  "expired",
  "missing",
  "conflicting",
]);

export const BusinessRow = z.object({
  id: ObjectIdString,
  name: z.string(),
  industries: z.array(z.string()),
  location: z.object({
    locality: z.string().nullable(),
    region: z.string().nullable(),
    country: z.string(),
  }),
  website: FieldSummary(z.string().url()).nullable(),
  phone: FieldSummary(z.string()).nullable(),
  whatsapp: z.enum(["confirmed", "user_asserted", "unknown"]),
  emailState: FieldState.nullable(),
  score: z.object({ fit: z.number(), dataConfidence: z.number() }).nullable(),
  sourceCount: z.number().int(),
  lastVerifiedAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
```

## 4. Versioning

Breaking changes create `/api/v2` routes alongside `/api/v1`; `v1` is maintained for at least six months after `v2` ships. Additive changes (new optional fields) do not bump the version.
