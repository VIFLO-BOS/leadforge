# LeadForge API Contracts

Status: Phases 1 to 6 shipped (auth, organizations, business records, CSV import, synchronous and asynchronous export, sources with per-organization settings, discovery jobs, credits, all-jobs listing, notifications, overview; website analysis, enrichment and refresh, scoring, duplicate review; CRM pipeline, leads, lists, activities, outreach, bulk operations, usage aggregates and reports; billing with Paystack: plans and credit packs, checkout, webhooks, payments, invoices, subscriptions, refunds, entitlements, reconciliation). Phase 7 added no endpoints or response fields; it hardened the transport (section 1, "Security and transport") and added the operations endpoint `GET /metrics` outside `/api/v1`. Stage 8 (2026-10-27) added no routes; its changes are additive and marked "Stage 8": the `ids` directory filter, `listId` on `GET /pipeline/board`, `businessName` and `businessNameState` on bulk operation items, `303` redirects when a browser opens a failed signed download link, and the lead list visibility rule written out under "Lead lists". Stage 9 (2026-10-27) added no routes either; its changes are additive and marked "Stage 9": the real wait on `429` responses (`Retry-After` and a `retryAfterSeconds` detail), a `303` to sign-in when a signed-out browser opens a download link, and the optional `authorizationUrl` and `authorizationUrlExpiresAt` on `BillingOverview.pendingSubscription`. Stage 10 (2026-10-28) added the organization deletion workflow (request with re-authentication, cancel, the `409 ORGANIZATION_PENDING_DELETION` grace rules, the purge) and the owner-only organization data export, under "Organization deletion and data export"; `deletionRequestedAt` and `purgeAfter` on `OrganizationProfile` and on `/auth/me` memberships; the `organization:export` permission; and the error codes `ORGANIZATION_PENDING_DELETION` and `REAUTH_FAILED`. Later sections describe planned endpoints and are marked as such. Last updated 2026-10-28.

Base path `/api/v1`. JSON only. OpenAPI is generated from NestJS decorators and the Zod schemas in `packages/contracts`, served at `/api/docs` outside production only (not served in production).

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

- Cursor pagination: `?cursor=&pageSize=25` (max 100). Cursors are opaque (base64url of `[sortValue, _id, sort]`); treat them as tokens. A cursor only works with the sort it was issued for, and a malformed or mismatched cursor is `400 VALIDATION_FAILED` on `cursor`. Ties on the sort value break on `_id`, so pages never repeat or skip rows.
- Sorting: `?sort=field:asc|desc` from a per-endpoint allowlist.
- Filtering: explicit query params per endpoint. Arrays as repeated params (`?industry=a&industry=b`).

### Error codes (shared enum in `packages/contracts`)

`VALIDATION_FAILED` (400), `UNAUTHENTICATED` (401), `TOKEN_EXPIRED` (401), `INVALID_CREDENTIALS` (401), `INVALID_TOKEN` (400), `EMAIL_NOT_VERIFIED` (403), `FORBIDDEN` (403), `ORG_FORBIDDEN` (403), `CSRF_FAILED` (403), `NOT_FOUND` (404), `CONFLICT` (409), `LAST_OWNER` (409), `JOB_NOT_CANCELLABLE` (409), `JOB_NOT_RETRYABLE` (409), `MERGE_CONFLICT` (409), `WEBSITE_MISSING` (422), `PAYLOAD_TOO_LARGE` (413), `UNSUPPORTED_MEDIA_TYPE` (415), `IMPORT_INVALID` (422), `EXPORT_TOO_LARGE` (422), `SOURCE_NOT_CONFIGURED` (422), `SOURCE_DISABLED` (422), `SOURCE_POLICY_BLOCKED` (422), `URL_NOT_ALLOWED` (422), `INVALID_URL` (400), `RATE_LIMITED` (429), `INSUFFICIENT_CREDITS` (402), `ENTITLEMENT_REQUIRED` (402), `PAYMENT_PROVIDER_ERROR` (502), `SOURCE_UNAVAILABLE` (503), `WEBHOOK_SIGNATURE_INVALID` (401), `INTERNAL_ERROR` (500). Phase 2 added `PAYLOAD_TOO_LARGE`, `UNSUPPORTED_MEDIA_TYPE`, `IMPORT_INVALID` and `EXPORT_TOO_LARGE`; Phase 3 added `SOURCE_NOT_CONFIGURED`, `SOURCE_DISABLED` and `JOB_NOT_RETRYABLE` and started using `INSUFFICIENT_CREDITS` and `JOB_NOT_CANCELLABLE`. Phase 4 added `WEBSITE_MISSING` (the business has no usable website to analyze, enrich or refresh) and started using `MERGE_CONFLICT`. Stage 4 started using `SOURCE_POLICY_BLOCKED` (422): the source's provider terms forbid the use (Google Places), whatever its configuration. Phase 5 added `VERSION_CONFLICT` (409: the lead, pipeline configuration or outreach record changed since it was read; details `version` carries the current version), `STAGE_NOT_EMPTY` (409: a stage being archived still holds leads), `INVALID_ASSIGNEE` (422: not an active owner, admin or sales rep), `CONTACT_SUPPRESSED` (409: contact with a suppressed business or contact without `suppressionOverride.reason`), `BULK_LIMIT_EXCEEDED` (422: more than 5,000 businesses), `EXPORT_NOT_READY` (409), `EXPORT_EXPIRED` (410), `DOWNLOAD_LINK_INVALID` (403) and `DOWNLOAD_LINK_EXPIRED` (410), and started using `EXPORT_TOO_LARGE` for the async export row cap. Phase 6 added `BILLING_NOT_CONFIGURED` (422: no Paystack key on the server; nothing was charged), `PRICE_NOT_PUBLISHED` (422: the plan or pack price is a placeholder or zero and is never charged on a live key), `MEMBER_LIMIT_REACHED` (402: the plan's member cap, counting active members plus live invitations when inviting; details `members.cap`, `members.used`) and `CREDIT_BALANCE_NEGATIVE` (402: the credit balance is below zero after a refund or reversal, so new discovery jobs and website analyses are refused until it is topped up; details `credits.balance`), and started using `ENTITLEMENT_REQUIRED` (402: the plan does not include discovery or website analysis; details `entitlement` = `discovery_enabled` or `website_analysis_enabled`), `PAYMENT_PROVIDER_ERROR` (502: Paystack could not be reached or refused; never carries the provider's raw message or any key) and `WEBHOOK_SIGNATURE_INVALID` (401). The discovery estimate's `blockers` gained the codes `ENTITLEMENT_REQUIRED` and `CREDIT_BALANCE_NEGATIVE`. Stage 10 added `ORGANIZATION_PENDING_DELETION` (409: the organization is in its 14-day deletion grace, so new discovery, website analysis and enrichment, imports, checkouts and plan changes, and invitations are refused; details `purgeAfter` carries the ISO purge date) and `REAUTH_FAILED` (403, never 401: the current password given to confirm a destructive action is wrong; the session stays valid).

Internal errors never leak messages. Clients get `INTERNAL_ERROR` plus the request ID.

### Rate limits (per IP unless noted)

"Per IP" is the client address Express derives from the connection and `TRUST_PROXY_HOPS` trusted proxy hops; client-supplied `X-Forwarded-For` entries are ignored (Phase 7). Auth endpoints 10 per minute; sign-in additionally 10 failed attempts per account per 15 minutes from any addresses (then `429 RATE_LIMITED` even with the right password, Phase 7); token refresh 30 per minute; invitation preview 20 per minute; public contact 3 per hour; authenticated general 600 per minute per user (`RATE_LIMIT_PER_MINUTE`); synchronous exports 10 per hour per user; CSV uploads 30 per hour per user; discovery job creation 30 per hour per organization (`DISCOVERY_JOBS_PER_HOUR`; replays of an Idempotency-Key are not counted). 429 responses include `Retry-After`.

Retry time (Stage 9): the per-account sign-in lock and the per-IP or per-user route limits send the real wait. `Retry-After` is the whole number of seconds left (the time left on the account's lock, which runs 15 minutes from the first counted failure; or the time left on the throttler's block, which lasts the route's window, for example up to an hour for the contact form), at least 1. The body carries the same number as `details: [{ path: "retryAfterSeconds", message: "<seconds>" }]` (`RETRY_AFTER_DETAIL_PATH` in `packages/contracts`). The per-account message keeps its wording with the minutes left, rounded up: "Too many failed sign-in attempts for this account. Try again in 9 minutes."; the route limits keep "Too many requests. Try again shortly". The lock is keyed on the email whether or not an account exists, and checked before the account is looked up, so an unknown email gets the same status, body shape, message and timing once it is locked. Other 429s (per-organization quotas such as discovery jobs, exports and enrichment runs, the verification-email limit) are unchanged: `Retry-After: 60` and no detail.

### Security and transport (Phase 7)

- Every response carries `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Content-Security-Policy: default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'`, `Referrer-Policy: no-referrer`, `Cross-Origin-Opener-Policy: same-origin`, `Cross-Origin-Resource-Policy: same-site` and, in production, `Strict-Transport-Security`. `Cache-Control: no-store` unless an endpoint sets its own (the public licence texts are cacheable).
- Cross-site state-changing requests are refused before routing with `403 CSRF_FAILED` ("Cross-site request refused"): `Sec-Fetch-Site: cross-site`, or, from browsers that send no Fetch Metadata, an `Origin` that is not `APP_URL` or `API_URL` (or is `null`). This applies to public routes too (sign-in, sign-up, password reset). `POST /webhooks/paystack` is exempt. Clients that send neither header (servers, scripts) are unaffected.
- CORS: only `APP_URL`, with credentials. The web app proxies `/api/*`, so browsers normally make same-origin requests.
- A session revoked by sign-out, "sign out this device", a password reset or refresh-token reuse detection stops working at once: its access token gets `401 UNAUTHENTICATED` (on public routes it is treated as anonymous). Clients should treat `UNAUTHENTICATED` (as opposed to `TOKEN_EXPIRED`) as signed out.
- Errors the framework raises have fixed messages, never echoing the request: malformed JSON is `400 VALIDATION_FAILED` "The request body is not valid JSON"; a body over the limit (JSON 100 kB, CSV uploads 20 MB) is `413 PAYLOAD_TOO_LARGE`; an unknown route is `404 NOT_FOUND` "No such endpoint". Every error body, including these, carries the request's `requestId`, equal to the `X-Request-Id` response header (the client's own `X-Request-Id` is kept when it is 8 to 128 word characters, dots or dashes).

### Operations endpoint (Phase 7)

`GET /metrics` (no `/api/v1` prefix, not in OpenAPI): Prometheus text for operators (docs/OPERATIONS.md, "Monitoring"). With `METRICS_TOKEN` configured it requires `Authorization: Bearer <token>`; without it only loopback callers outside production. Anyone else gets `404 NOT_FOUND`. The web app's `/api` rewrite does not reach it.

## 2. Endpoints

### Public

| Method | Path                                       | Body or query                                                                 | Returns                                                                                                                                                                                                                                                                                                                                                                          |
| ------ | ------------------------------------------ | ----------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/public/plans`                            | none                                                                          | active plans and credit packs with `isPlaceholder`                                                                                                                                                                                                                                                                                                                               |
| POST   | `/public/contact`                          | `{ name, email, company?, message, kind? }`                                   | `202 { data: { received: true } }`                                                                                                                                                                                                                                                                                                                                               |
| GET    | `/public/sources`                          | none                                                                          | `200 { data: { items: SourceRegistryEntry[] } }`: the registry with coverage and data policy, without organization settings (`config: null`, `enabled` is the default)                                                                                                                                                                                                           |
| GET    | `/public/data-licenses`                    | none                                                                          | `200 { data: DataLicensesResponse }`: licences (`id, name, textPath, referenceUrl, appliesTo, textAvailable`), per-source `licensing`, `notices` (the Foursquare NOTICE in full), `modifications` (LeadForge's changes to the data), `disclaimer`, `overtureRelease`. `Cache-Control: public, max-age=3600`. The web app's Data sources and licences page renders this (Stage 4) |
| GET    | `/public/data-licenses/:id`                | `id`: `CDLA-Permissive-2.0`, `Apache-2.0`, `CC0-1.0`, `ODbL-1.0`, `CC-BY-4.0` | `200 text/plain`: the full licence text (no envelope); unknown id `404 NOT_FOUND`                                                                                                                                                                                                                                                                                                |
| GET    | `/public/data-licenses/notices/foursquare` | none                                                                          | `200 text/plain`: the Foursquare OS Places NOTICE                                                                                                                                                                                                                                                                                                                                |
| GET    | `/health/live`, `/health/ready`            | none                                                                          | readiness checks Postgres, Mongo, Redis                                                                                                                                                                                                                                                                                                                                          |

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

| Method    | Path                                                   | Notes                                                                                     |
| --------- | ------------------------------------------------------ | ----------------------------------------------------------------------------------------- |
| GET       | `/organizations/current`                               | profile, settings, entitlements summary                                                   |
| PATCH     | `/organizations/current`                               | `{ name?, country?, freshnessDays?, defaultCurrency? }` (owner: `organization:settings`)  |
| GET       | `/organizations/current/members`                       | paged envelope; release 1 returns all members (capped at 500) with nextCursor null        |
| PATCH     | `/organizations/current/members/:userId`               | `{ role }` or `{ status }`; cannot demote the last owner                                  |
| DELETE    | `/organizations/current/members/:userId`               | admin and above                                                                           |
| POST, GET | `/organizations/current/invitations`                   | `{ email, role }` on create (admin and above; `MEMBER_LIMIT_REACHED` at the plan's cap)   |
| DELETE    | `/organizations/current/invitations/:id`               | revoke a pending invitation (admin and above)                                             |
| GET       | `/invitations/:token`                                  | public preview of an invitation (organization, inviter, role); 20 per minute per address  |
| POST      | `/invitations/:token/accept`                           | authenticated user accepts; the signed-in email must be the invited one (`403` otherwise) |
| POST      | `/organizations/current/deletion-requests`             | owner; `{ confirmName, password }`; starts the 14-day grace (Stage 10, below)             |
| DELETE    | `/organizations/current/deletion-requests`             | owner; cancels a pending deletion before the purge starts (Stage 10)                      |
| POST, GET | `/organizations/current/data-exports`                  | owner; whole-organization data export (Stage 10, below)                                   |
| GET       | `/organizations/current/data-exports/:id`              | owner; one export (poll while queued or running)                                          |
| GET       | `/organizations/current/data-exports/:id/download-url` | owner; signed link, 15 minutes                                                            |
| GET       | `/organizations/current/data-exports/:id/download`     | signed link (signed in, no organization header); the ZIP                                  |

#### Organization deletion and data export (Stage 10)

`GET /organizations/current` and every membership in `GET /auth/me` (`organizations[]`) carry `deletionRequestedAt` and `purgeAfter` (ISO, both `null` when no deletion is pending), so the app shell shows every member a banner.

| Method | Path                                                               | Permission                    | Body or headers                                         | Returns                                                                      |
| ------ | ------------------------------------------------------------------ | ----------------------------- | ------------------------------------------------------- | ---------------------------------------------------------------------------- |
| POST   | `/organizations/current/deletion-requests`                         | `organization:delete` (owner) | `RequestOrganizationDeletion { confirmName, password }` | `202 OrganizationDeletionStatus { deletionRequestedAt, purgeAfter }`         |
| DELETE | `/organizations/current/deletion-requests`                         | `organization:delete`         | none                                                    | `204` (also when nothing is pending)                                         |
| POST   | `/organizations/current/data-exports`                              | `organization:export` (owner) | optional `Idempotency-Key` (8-128 chars)                | `202 OrganizationDataExport` (`200` when the key replays)                    |
| GET    | `/organizations/current/data-exports`                              | `organization:export`         | none                                                    | `200` paged envelope of the 10 newest `OrganizationDataExport`, newest first |
| GET    | `/organizations/current/data-exports/:id`                          | `organization:export`         | none                                                    | `200 OrganizationDataExport`                                                 |
| GET    | `/organizations/current/data-exports/:id/download-url`             | `organization:export`         | none                                                    | `200 { url, expiresAt }` (15 minutes)                                        |
| GET    | `/organizations/current/data-exports/:id/download?org&expires&sig` | signed in (`@AuthOnly`)       | none                                                    | `200 application/zip`                                                        |

Deletion request:

- `confirmName` must equal the organization's name exactly (`400 VALIDATION_FAILED`, detail path `confirmName`); `password` is the owner's current password (`403 REAUTH_FAILED`). Wrong passwords count toward the per-account sign-in lock (10 per 15 minutes); while locked the answer is `429 RATE_LIMITED` with `Retry-After` and the `retryAfterSeconds` detail. Rate limit: 10 per minute per user.
- Idempotent while pending: the same `{ deletionRequestedAt, purgeAfter }` comes back, with no second notice. `purgeAfter` = `deletionRequestedAt` + 14 days (`ORGANIZATION_DELETION_GRACE_DAYS`).
- Every active owner and admin gets an in-app notice (`organization.deletion_requested`) and an email at once, and a reminder email about 3 days before the purge (`ORGANIZATION_DELETION_REMINDER_DAYS`). Cancelling sends `organization.deletion_cancelled` and an email. These notices ignore notification preferences. Audited: `org.deletion_requested`, `org.deletion_reauth_failed`, `org.deletion_cancelled`, `org.purge_started`, `org.purged`.
- During the grace period these routes answer `409 ORGANIZATION_PENDING_DELETION` (checked after the permission, so a member without the permission still gets `403`): `POST /discovery/jobs`, `POST /discovery/jobs/:id/retry-failed`, `POST /analysis/websites`, `POST /businesses/:id/refresh`, `POST /enrichment/businesses/:id/website-contacts`, `POST /enrichment/businesses/:id/check-email`, `POST /imports`, `POST /imports/:id/commit`, `POST /billing/checkout/credits`, `POST /billing/checkout/subscription`, `POST /billing/subscription/resume`, `POST /organizations/current/invitations`, and accepting an invitation (`POST /invitations/:token/accept`). Everything else keeps working: reads, reports, exports (including the organization data export), CRM edits (lists, leads, activities, outreach, bulk operations), duplicate review, settings, member management, subscription cancellation and refunds, and cancelling the deletion. Jobs already running finish normally.
- Once the purge starts (`organizations.deleted_at` is set) nobody can open the organization: every request with its id is `403 ORG_FORBIDDEN`, and it no longer appears in `/auth/me`.

Organization data export (owner only, because it holds every member's email):

- One export may be queued or running per organization: another request is `409 CONFLICT` with details `[{ path: "activeExportId", message: <id> }]`. Rate limit: 10 per hour per user.
- `OrganizationDataExport`: `{ id, status: queued|running|completed|failed|expired, progress: { completedSections, totalSections, currentSection }, sections: [{ key, rows }], file: { name, bytes, sha256, expiresAt, available } | null, error, requestedByUserId, createdAt, startedAt, finishedAt }`.
- The ZIP (built in the worker, queue `exports`, job `build-organization-export`): `README.txt`, `ATTRIBUTION.txt`, `LICENSES/` (as for exports), and per section JSON plus CSV: `organization.json`; `members` (name, email, role, status, joined); `businesses` (`businesses.json` holds every stored field as the detail view shows it, suppressed businesses included with their flag; `businesses.csv` the export columns); `observations` and `verification_events` (provenance); `lists`, `list_items`, `leads`, `activities`, `outreach`; `imports` (one summary row per import); `jobs` (discovery, website analyses, enrichment runs, bulk operations, exports); `credit_ledger`, `invoices`, `payments` (metadata only: no masked card, authorization URL or access code), `usage`; `audit_events` (without IP addresses and user agents). Values whose source retention has expired are left out exactly as reads hide them; CSV cells are formula-safe; files are deleted after 7 days (`cleanup-exports`). The requester gets an in-app notice (`organization.export_completed` or `organization.export_failed`). Audited: `org.data_export_requested`, `org.data_export_finished`, `org.data_export_downloaded`.
- Downloads: the signed link is bound to the owner, the organization and the export (HMAC, namespace `org-export:`). The download re-checks that the caller is still an owner (`403 ORG_FORBIDDEN` or `FORBIDDEN`). A browser navigation that fails with `DOWNLOAD_LINK_INVALID`, `DOWNLOAD_LINK_EXPIRED`, `EXPORT_EXPIRED` or `EXPORT_NOT_READY` (a damaged query counts as `DOWNLOAD_LINK_INVALID`) gets `303 See Other` to `<APP_URL>/app/settings?tab=organization&downloadError=<code>`; a signed-out navigation gets `303` to `<APP_URL>/sign-in?next=%2Fapp%2Fsettings%3Ftab%3Dorganization`. Scripts keep the JSON error.

### Businesses (shipped in Phase 2)

Every route needs a signed-in, email-verified member, the `X-Organization-Id` header and, for `POST`, `PATCH` and `DELETE`, the `X-CSRF-Token` header. Ids are 24-character hex ObjectIds: a malformed id is `400 VALIDATION_FAILED`; an id that does not exist in the caller's organization (including another organization's id) is `404 NOT_FOUND`, never `403`.

| Method | Path                                  | Permission         | Body or query                         | Returns                                                             |
| ------ | ------------------------------------- | ------------------ | ------------------------------------- | ------------------------------------------------------------------- |
| GET    | `/businesses`                         | `businesses:read`  | `BusinessListQuery` (below)           | `200` page of `BusinessListItem`                                    |
| GET    | `/businesses/facets`                  | `businesses:read`  | none                                  | `200 BusinessFacets`                                                |
| POST   | `/businesses`                         | `businesses:write` | `CreateBusinessRequest`               | `201 BusinessDetail`                                                |
| GET    | `/businesses/:id`                     | `businesses:read`  | none                                  | `200 BusinessDetail` (access audited as `business.contacts_viewed`) |
| PATCH  | `/businesses/:id`                     | `businesses:write` | `CorrectionRequest`                   | `200 BusinessDetail`                                                |
| GET    | `/businesses/:id/observations`        | `businesses:read`  | `field?, source?, cursor?, pageSize?` | `200` page of `Observation`, newest first                           |
| GET    | `/businesses/:id/verification-events` | `businesses:read`  | `cursor?, pageSize?`                  | `200` page of `VerificationEvent`, newest first                     |
| POST   | `/businesses/:id/suppress`            | `businesses:write` | `SuppressRequest`                     | `200 BusinessDetail`                                                |
| DELETE | `/businesses/:id/suppression`         | `businesses:write` | none                                  | `200 BusinessDetail`                                                |

Roles (docs/SECURITY_AND_DATA_COLLECTION.md section 2): `businesses:read` is held by every role (Owner, Administrator, Researcher, Sales Representative, Read-only Analyst); `businesses:write` by Owner, Administrator and Researcher; `exports:create` by Owner, Administrator, Researcher and Read-only Analyst. Sales Representatives hold `exports:create_assigned`, which unlocks exporting assigned leads once lead assignment ships in Phase 5; until then their export requests get `403 FORBIDDEN`. A denied permission is `403 FORBIDDEN`.

Phase 4 added business-scoped routes documented in their sections: `GET /businesses/:id/analysis`, `GET /businesses/:id/score`, `GET /businesses/:id/enrichment-runs`, `POST /businesses/:id/refresh`; duplicate candidates of a business are `GET /dedup/candidates?businessId=`. Not yet shipped (later phases): `DELETE /businesses/:id` (soft delete), `/activities`, `POST /businesses/bulk`. WhatsApp assertion is a correction (`field: "whatsapp"`), not a separate route.

#### `GET /businesses` query (`BusinessListQuery`)

All filters are optional and combine with AND. Array filters repeat the parameter (`?category=Bakery&category=Pharmacy`) and match any value.

| Param                                            | Type                                                                                            | Meaning                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ------------------------------------------------ | ----------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `q`                                              | string, max 200                                                                                 | Prefix search over words of the name, categories, locality, LGA, region, street, website domain, email addresses and social handles, plus phone digits. Every word must prefix-match (`acme food`). A phone-like query (`0803 123 4567`, `+234 803`) is reduced to its digits and matches E.164, national and national-without-trunk-0 digit strings. Regex characters are literal.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `category[]`                                     | string, max 80, up to 20                                                                        | Category label, case-insensitive                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `country`                                        | ISO 3166-1 alpha-2                                                                              | Location country                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `region[]`                                       | string                                                                                          | State or region. Nigerian spellings are canonicalized: `Lagos`, `Lagos State`, `LAGOS` match the same records; `FCT` and `Abuja` mean Federal Capital Territory                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `locality[]`, `lga[]`                            | string                                                                                          | City or town, local government area; case-insensitive exact                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `hasWebsite`, `hasPhone`, `hasEmail`             | `true` or `false`                                                                               | Presence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `whatsapp[]`                                     | `confirmed`, `user_asserted`, `unknown`                                                         | Business-level WhatsApp status (best across its phones)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `websiteState[]`, `phoneState[]`, `emailState[]` | `FieldState`                                                                                    | At least one value of that field in one of the states; `missing` means no value. `stale` and `verified` use the organization's freshness window                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `source[]`                                       | `overture_places`, `google_places`, `website`, `user_import`, `user_edit` (up to 5)             | Businesses observed from any of these sources                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `suppression`                                    | `exclude` (default), `include`, `only`                                                          | Suppressed businesses are hidden unless asked for                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `ids`                                            | ObjectId, up to 100 (Stage 8)                                                                   | Only these businesses. One comma-separated parameter (`?ids=a,b`), repeated parameters (`?ids=a&ids=b`) or both; in JSON bodies (`BusinessListFilter` in exports and bulk selections) an array. Empty parts are ignored. More than 100 values (`BUSINESS_IDS_FILTER_MAX`, counted as sent) or a malformed id is `400 VALIDATION_FAILED` on `ids`. Combines with every other filter, including the default `suppression=exclude` (send `suppression=include` to get suppressed ones too). Ids that are not businesses of the caller's organization (another organization's, merged away, unknown) simply match nothing: unlike `importId` this is a selection of records, not a reference to one parent, and foreign and unknown ids are indistinguishable, so nothing is revealed. Use it to fetch directory rows for a known set of businesses (for example the rows of a bulk result) |
| `importId`                                       | ObjectId                                                                                        | Businesses created or updated by this import. An import id from another organization is `404`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `updatedAfter`                                   | ISO date-time                                                                                   | `updatedAt >= value`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `fitMin`, `fitMax`                               | integer 0 to 100                                                                                | Fit score range, inclusive (Phase 4). Unscored businesses never match                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `dataConfidenceMin`, `dataConfidenceMax`         | integer 0 to 100                                                                                | Data confidence range, inclusive (Phase 4)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `sort`                                           | `updatedAt`, `createdAt`, `name`, `lastVerifiedAt`, `fit`, `dataConfidence` + `:asc` or `:desc` | Default `updatedAt:desc`. Ties break on `_id` in the same direction; null `lastVerifiedAt` and unscored businesses sort last descending and first ascending. Every filter shape under every sort is index-backed (explain test)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `cursor`                                         | opaque string                                                                                   | From `meta.nextCursor`. A cursor is bound to its sort: replaying it under another sort, or sending a damaged cursor, is `400 VALIDATION_FAILED` on `cursor`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `pageSize`                                       | 1 to 100, default 25                                                                            |                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |

Response:

```json
{
  "data": [
    {
      "id": "6add8b76520012303c641f9f",
      "name": "Mama Put Kitchen (Sample)",
      "slug": "mama-put-kitchen-sample-ikeja",
      "categories": ["Restaurant", "Catering"],
      "location": {
        "formatted": "14 Allen Avenue, Ikeja, Lagos, Nigeria",
        "locality": "Ikeja",
        "lga": "Ikeja",
        "region": "Lagos",
        "country": "NG"
      },
      "website": {
        "value": "https://mamaput.example.test",
        "domain": "mamaput.example.test",
        "state": "unverified"
      },
      "phone": {
        "value": "+442079460101",
        "international": "+44 20 7946 0101",
        "state": "verified",
        "whatsapp": "confirmed"
      },
      "phoneCount": 1,
      "email": { "value": "hello@mamaput.example.test", "state": "unverified" },
      "emailCount": 2,
      "whatsapp": "confirmed",
      "states": {
        "website": "unverified",
        "phone": "verified",
        "email": "unverified",
        "location": "unverified"
      },
      "score": null,
      "sources": ["user_import", "website"],
      "sourceCount": 2,
      "suppressed": false,
      "lastVerifiedAt": "2026-10-03T10:00:00.000Z",
      "createdAt": "2026-10-25T04:53:10.000Z",
      "updatedAt": "2026-10-25T04:56:40.000Z"
    }
  ],
  "meta": { "nextCursor": "WyJtYW1hIHB1dC...", "pageSize": 25, "total": 23 }
}
```

`phone` and `email` are the primary values (best state first, then most recently observed); `null` when the business has none. Values in `expired` state are returned as `null` with their state. `states.name` (Phase 3) is `expired` when the name came only from a source whose retention has passed (Google Places content, see "Source retention" below); `name` is then the fixed label `EXPIRED_NAME_LABEL` ("Name expired under source terms", exported from contracts) instead of the stored value, and expired categories are left out. `meta.total` is returned on the first page only (no `cursor`); above 10,000 matches `meta.totalApprox: 10000` is returned instead and means "10,000 or more". `score` is `{ fit, dataConfidence }` (two separate numbers, 0 to 100) once the business is scored (Phase 4), else `null`.

#### `GET /businesses/facets`

Counts over the organization's non-suppressed businesses for the filter UI, cached per organization for up to 60 seconds and refreshed after imports, corrections and suppression. `value` is what to send back as the filter value.

```json
{
  "data": {
    "total": 23,
    "categories": [{ "value": "restaurant", "label": "Restaurant", "count": 4 }],
    "regions": [
      { "value": "lagos", "label": "Lagos", "count": 8 },
      { "value": "federal capital territory", "label": "Federal Capital Territory", "count": 3 }
    ],
    "localities": [{ "value": "ikeja", "label": "Ikeja", "count": 3 }],
    "sources": [{ "value": "user_import", "label": "user_import", "count": 14 }],
    "whatsapp": [{ "value": "unknown", "label": "unknown", "count": 21 }],
    "generatedAt": "2026-10-25T04:56:30.000Z",
    "maxAgeSeconds": 60
  }
}
```

Each list holds at most 25 buckets, largest first.

#### Field model in `BusinessDetail`

Every contact-bearing field carries `value` (normalized), `rawValue` (as observed), `state` (`verified`, `unverified`, `stale`, `expired`, `missing`, `conflicting`), `confidence` (0 to 1), `observationIds` (provenance references, newest last, at most 50), `lastObservedAt`, `lastVerifiedAt` and `expiresAt`. State is derived when read:

1. `missing` when there is no value.
2. `expired` when `expiresAt` has passed (source retention). `value` and `rawValue` are `null`; metadata stays.
3. `conflicting` when sources disagree on a single-valued field (website, location). The competing values are in `alternatives[]`.
4. `stale` when the most recent of `lastObservedAt` and `lastVerifiedAt` is older than the organization's `freshnessDays` (default 180; `PATCH /organizations/current`).
5. Otherwise the stored `verified` or `unverified`.

WhatsApp has three values only: `confirmed` (explicit evidence such as a `wa.me` link on the business's own site, referenced by `evidenceObservationId`), `user_asserted` (a team member said so, by correction or an import's WhatsApp column; `assertedByUserId`, `assertedAt`) and `unknown`.

```json
{
  "data": {
    "id": "6add8b76520012303c641f9f",
    "slug": "mama-put-kitchen-sample-ikeja",
    "name": {
      "value": "Mama Put Kitchen (Sample)",
      "rawValue": "Mama Put Kitchen (Sample)",
      "state": "unverified",
      "confidence": 0.7,
      "observationIds": ["..."],
      "lastObservedAt": "...",
      "lastVerifiedAt": null,
      "expiresAt": null
    },
    "categories": [
      { "value": "Restaurant", "key": "restaurant", "taxonomy": "user", "observationIds": ["..."] }
    ],
    "location": {
      "value": {
        "formatted": "14 Allen Avenue, Ikeja, Lagos, Nigeria",
        "street": "14 Allen Avenue",
        "locality": "Ikeja",
        "lga": "Ikeja",
        "region": "Lagos",
        "country": "NG",
        "postalCode": null
      },
      "rawValue": "14 Allen Avenue, Ikeja, Ikeja, Lagos",
      "state": "unverified",
      "confidence": 0.6,
      "observationIds": ["..."],
      "lastObservedAt": "...",
      "lastVerifiedAt": null,
      "expiresAt": null,
      "alternatives": []
    },
    "website": {
      "value": "https://mamaput.example.test",
      "rawValue": "mamaput.example.test",
      "domain": "mamaput.example.test",
      "state": "unverified",
      "alternatives": [],
      "confidence": 0.7,
      "observationIds": ["..."],
      "lastObservedAt": "...",
      "lastVerifiedAt": null,
      "expiresAt": null
    },
    "phones": [
      {
        "value": "+442079460101",
        "rawValue": "+44 20 7946 0101",
        "e164": "+442079460101",
        "national": "020 7946 0101",
        "international": "+44 20 7946 0101",
        "country": "GB",
        "type": "fixed_line",
        "state": "verified",
        "whatsapp": {
          "status": "confirmed",
          "evidenceObservationId": "...",
          "assertedByUserId": null,
          "assertedAt": null
        },
        "confidence": 0.7,
        "observationIds": ["..."],
        "lastObservedAt": "...",
        "lastVerifiedAt": "...",
        "expiresAt": null
      }
    ],
    "emails": [
      {
        "value": "hello@mamaput.example.test",
        "rawValue": "hello@mamaput.example.test",
        "address": "hello@mamaput.example.test",
        "domain": "mamaput.example.test",
        "verification": null,
        "state": "unverified",
        "confidence": 0.7,
        "observationIds": ["..."],
        "lastObservedAt": "...",
        "lastVerifiedAt": null,
        "expiresAt": null
      }
    ],
    "socials": [],
    "whatsapp": "confirmed",
    "states": {
      "name": "unverified",
      "website": "unverified",
      "phone": "verified",
      "email": "unverified",
      "location": "unverified"
    },
    "sources": [
      { "source": "website", "observationCount": 5, "firstSeenAt": "...", "lastSeenAt": "..." },
      { "source": "user_import", "observationCount": 12, "firstSeenAt": "...", "lastSeenAt": "..." }
    ],
    "provenance": { "totalObservations": 17, "recent": ["Observation, newest first, at most 20"] },
    "recentVerificationEvents": ["VerificationEvent, newest first, at most 5"],
    "suppression": {
      "suppressed": false,
      "reason": null,
      "suppressedAt": null,
      "suppressedByUserId": null,
      "entries": []
    },
    "score": "ScoreSnapshot (see Scoring) or null",
    "latestAnalysis": {
      "analysisId": "...",
      "status": "completed",
      "analyzedAt": "...",
      "opportunities": ["contact_form"],
      "activeAnalysisId": null
    },
    "dedup": { "status": "unique", "candidateCount": 0, "absorbedIds": [] },
    "createdVia": { "kind": "import", "importId": "6add8b76...", "userId": "01a170ea-..." },
    "freshnessDays": 180,
    "lastVerifiedAt": "...",
    "createdAt": "...",
    "updatedAt": "..."
  }
}
```

Phase 6 (backlog 9) added `latestAnalysis.activeAnalysisId`: the queued or running analysis of the business (poll `GET /analysis/websites/:id`), else `null`; when no analysis has finished yet, `latestAnalysis` is that active analysis itself (`status` `queued` or `running`, `analyzedAt` null, `opportunities` empty). Phase 4 added `score` (the full `ScoreSnapshot` with breakdown and explanation, or `null`), `latestAnalysis` (the latest completed website analysis with its opportunities of confidence at least 0.7, or `null`) and `dedup.absorbedIds` (businesses merged into this one; `provenance`, `sources` counts and verification events include theirs). `emails[].verification` is `{ method: "syntax_mx_disposable", result: "mx_found" | "no_mx" | "disposable" | "invalid_syntax" | "dns_error", checkedAt }` after an email check; the email's `state` stays `unverified`. `website` is always an object; with no website its `state` is `missing` and the values are `null`. `phones[].e164` and `emails[].address` are `null` only for expired values. `name.value` and `name.rawValue` are `null` when the name is expired. Phase 3 added `createdVia.discoveryJobId` (the job that created the record, else `null`) and `externalRefs: [{ source, externalId, lastFetchedAt, expiresAt }]`, the source records the business is linked to (a Google place ID, kept indefinitely so the record can be refreshed).

#### Source retention in responses (Phase 3)

A value collected from a source with a retention limit carries `expiresAt` (field level) and its observation carries `retainValueUntil`. From that moment it is hidden on every read: the field state is `expired`, values are `null`, observation `rawValue`, `normalizedValue` and `fieldKey` are `null` with `redacted: true`, and exports leave it out. A purge job then removes it from storage. A value that another source without a limit also observed (an import, a correction) has no expiry. Google Places content expires when collected (see docs/SECURITY_AND_DATA_COLLECTION.md section 6): a business found only through Google shows its place ID, its source and dates, and nothing else. Since Stage 4 Google is never used; only data collected before can still appear. Overture Maps Places values have no retention limit (`expiresAt: null`); their `lastObservedAt` is the release date.

Stage 4 additions to `BusinessDetail` (new required fields):

- `emails[].kind`: `free_mail` (gmail.com and other consumer mailbox domains) or `business`. Data only, for data-protection review; phones already carry `type` (`mobile`, `fixed_line`, ...).
- `externalRefs[]` gains `release`, `dataset`, `recordId`, `license` (Overture provenance; `null` for other sources) and `status`: `active`, `retired` (the latest Overture release dropped the place: review its values) or `unknown` (sources without a snapshot).
- `attributions[]`: `{ source, text, lines[], licenses: DataLicenseRef[] }`, what this record must show wherever its data is displayed. For Overture: `text` "Source: Overture Maps Foundation (overturemaps.org)", `lines` the dataset line of each linked record (for example "Data from Meta. Available under CDLA Permissive 2.0.") and the boundary credit for states and LGAs, `licenses` with `textPath` links. For legacy Google values: `{ source: "google_places", text: "Google Maps", lines: [], licenses: [] }`.
- `categories[].taxonomy` may be `overture`.

`Observation`:

```json
{
  "id": "...",
  "businessId": "...",
  "source": "user_edit",
  "sourceRef": null,
  "field": "phone",
  "fieldKey": "+2348098765432",
  "rawValue": "0809 876 5432",
  "normalizedValue": "+2348098765432",
  "collectedAt": "...",
  "collectionMethod": "user_edit",
  "verification": null,
  "confidence": 0.8,
  "importId": null,
  "actor": { "type": "user", "userId": "01a170ea-..." },
  "note": "Called and confirmed new line",
  "action": "set",
  "redacted": false,
  "sourceExternalId": null,
  "discoveryJobId": null,
  "retainValueUntil": null,
  "attribution": null,
  "enrichmentRunId": null,
  "evidence": null,
  "licensing": null
}
```

`source` is one of `overture_places`, `google_places`, `website`, `user_import`, `user_edit`; `collectionMethod` one of `api`, `dataset_snapshot` (Overture), `website_fetch`, `user_import`, `user_edit`. Overture observations (Stage 4) carry `sourceRef: "overture:<release>:places/place/<GERS id>"`, `sourceExternalId` (the GERS id), `discoveryJobId`, `retainValueUntil: null`, `confidence: 0.6`, `attribution` ("Source: Overture Maps Foundation (overturemaps.org). Data from Meta. Available under CDLA Permissive 2.0.") and `licensing: { release, dataset, recordId, license, licenseTextPath }` (the upstream record and its licence; `null` for other sources; new required field). `field` one of `name`, `website`, `phone`, `email`, `social`, `category`, `location`, `whatsapp`, `hours`, `description`. Discovered observations carry `sourceExternalId` (the place ID), `discoveryJobId`, `retainValueUntil` and the required `attribution` ("Google Maps", plus any third-party provider Google names). `fieldKey` identifies the value of a multi-valued field (E.164, email address, website domain, category key). `normalizedValue` is a string, a string array (categories) or an object (location parts). `action: "remove"` records a correction that deleted a value. Imported observations carry `importId` and `sourceRef: "import:<id>"`. Website observations (Phase 4) have `source: "website"`, `collectionMethod: "website_fetch"`, `sourceRef` = the page URL, `enrichmentRunId`, and `evidence: { page, selector, snippet }` (where on the page the value was found; snippet at most 200 characters); `evidence` is `null` for other sources. `field: "whatsapp"` observations from a website carry the E.164 number in `fieldKey` (or `null` for a WhatsApp link that names no number).

`VerificationEvent`: `{ id, businessId, field, fieldKey, method, result: "passed" | "failed" | "inconclusive", details, actorType: "system" | "user", actorId, occurredAt }`. Written by enrichment (Phase 4): `phone` / `website_presence` (valid number found on the business's own website), `whatsapp` / `whatsapp_link` or `whatsapp_label` (explicit evidence on the own site), and per email check `email` / `email_syntax`, `email_mx`, `email_disposable`. No event makes an email verified (release 1 does no mailbox probing).

#### `PATCH /businesses/:id` corrections (`CorrectionRequest`)

One field per request, discriminated by `field`. Every correction writes a `user_edit` observation (with the optional `note`, max 500), updates the canonical value, sets it to `unverified` with confidence 0.8, resolves a conflict on that field, writes the `business.corrected` audit event (before and after), and returns the updated `BusinessDetail`. If a corrected phone, email or domain matches a suppression entry the business becomes suppressed.

| `field`      | Body                                                                      | Notes                                                                                                                                                                                                                                                            |
| ------------ | ------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `name`       | `{ value: string 1..200 }`                                                | Slug does not change                                                                                                                                                                                                                                             |
| `website`    | `{ value: url \| null }`                                                  | `null` removes it. Social profile URLs are rejected                                                                                                                                                                                                              |
| `phone`      | `{ target?: string, value: string \| null, country?: "NG" }`              | No `target` adds; `target` (E.164 or any format that parses to a phone on the business) replaces; `target` with `value: null` removes. `country` is the parsing region for numbers without a country code (default: business country, then organization country) |
| `email`      | `{ target?: string, value: string \| null }`                              | Same add, replace, remove rules                                                                                                                                                                                                                                  |
| `whatsapp`   | `{ target: string, value: "user_asserted" \| "unknown" }`                 | `confirmed` cannot be set by hand                                                                                                                                                                                                                                |
| `categories` | `{ value: string[] (max 10, each 1..80) }`                                | Replaces the list; duplicates collapse case-insensitively                                                                                                                                                                                                        |
| `location`   | `{ value: { street?, locality?, lga?, region?, country?, postalCode? } }` | Replaces the location. Without `country` the business or organization country is used                                                                                                                                                                            |

Errors: `400 VALIDATION_FAILED` with `details[{ path: "value" | "target", message }]` (for example `value: "Not a valid phone number for NG or with a country code"`, `target: "That phone number is not on this business"`), `404 NOT_FOUND`, `409 CONFLICT` if the record changed three times during the write.

#### `POST /businesses` manual create (`CreateBusinessRequest`)

`{ name: string 1..200, categories?: string[] (max 10), website?: string, phones?: string[] (max 10), emails?: string[] (max 10), location?: LocationInput, country?: "NG", note?: string }`. Values are normalized exactly like import rows and recorded as `user_edit` observations. Errors: `400 VALIDATION_FAILED` with one detail per bad value (`phones.0`, `emails.1`, `website`); `409 CONFLICT` when a business with the same normalized name shares a domain, phone or email (`details[0] = { path: "existingBusinessId", message: "<id>" }`), or when an identifier is suppressed.

#### Suppression

`POST /businesses/:id/suppress` body `{ scope: "business" | "domain" | "phone" | "email", reason: string 3..500, value?: string }`. `value` picks which phone or email for those scopes (default: the first). It creates a suppression entry (checked at import and export), flags every business in the organization that matches it (all businesses on that domain, phone or email), writes `business.suppressed`, and returns the detail. `400 VALIDATION_FAILED` on `scope` when the business has no domain, phone or email for that scope.

`DELETE /businesses/:id/suppression` removes the entries created from this business and clears the flag on every business no other entry still matches. Entries created from another business (for example the same domain) keep it suppressed; they are listed in `suppression.entries`. Writes `business.unsuppressed`.

`POST /businesses/suppress` (Stage 4, `businesses:write`): bulk suppression. Body `{ ids: ObjectId[] (1..100, distinct), scope: "business" | "domain" | "phone" | "email", reason: string 3..500 }`; phone and email scopes use each business's primary value. Returns `200 BulkSuppressResult`:

```json
{
  "results": [
    {
      "id": "...",
      "outcome": "suppressed",
      "value": "+2348031110001",
      "entryId": "...",
      "message": null
    },
    {
      "id": "...",
      "outcome": "no_value",
      "value": null,
      "entryId": null,
      "message": "That phone number is not on this business"
    },
    {
      "id": "...",
      "outcome": "not_found",
      "value": null,
      "entryId": null,
      "message": "No business with this id in the organization"
    }
  ],
  "summary": {
    "requested": 3,
    "suppressed": 1,
    "alreadySuppressed": 0,
    "notFound": 1,
    "noValue": 1,
    "failed": 0,
    "businessesAffected": 1
  }
}
```

Outcomes: `suppressed`, `already_suppressed` (an entry for this scope and value exists and the business is already flagged), `not_found` (no live business with that id in the organization; other organizations' ids look the same), `no_value` (no domain, phone or email for the scope), `failed` (retry the item). `businessesAffected` counts every business flagged, including others sharing a suppressed value. `400 VALIDATION_FAILED` for more than 100 ids (`path: "ids"`, message "At most 100 businesses per request"), duplicate or malformed ids, or a bad scope. One audit event `business.bulk_suppressed` records the scope, reason, counts and per-id outcomes.

Suppressed businesses are excluded from the directory by default, from facets and overview contact counts, and always from exports.

### Imports (CSV, shipped in Phase 2)

Flow: upload (staged and parsed) → optional preview with a mapping → commit (queued to the worker) → poll status → read per-row results. Commit runs in the worker (BullMQ queue `imports`) because a file can hold 50,000 rows that each need normalization, suppression and dedup lookups and writes; the worker processes 200-row batches, survives restarts by resuming from the first unprocessed row, and retries up to 3 times with backoff. Business and observation ids are derived from the import and row number, so a retried batch never duplicates records.

| Method | Path                   | Permission         | Body or query                       | Returns                                       |
| ------ | ---------------------- | ------------------ | ----------------------------------- | --------------------------------------------- |
| POST   | `/imports`             | `businesses:write` | `multipart/form-data`, field `file` | `201 ImportJob` (status `uploaded`)           |
| GET    | `/imports`             | `businesses:read`  | `status[]?, cursor?, pageSize?`     | `200` page of `ImportJob`, newest first       |
| GET    | `/imports/:id`         | `businesses:read`  | none                                | `200 ImportJob` (poll this)                   |
| POST   | `/imports/:id/preview` | `businesses:write` | `ImportPreviewRequest`              | `200 ImportPreviewResponse`                   |
| POST   | `/imports/:id/commit`  | `businesses:write` | `ImportCommitRequest`               | `202 ImportJob` (status `queued`)             |
| GET    | `/imports/:id/rows`    | `businesses:read`  | `outcome[]?, cursor?, pageSize?`    | `200` page of `ImportRowResult` in file order |

Upload limits and checks (`IMPORT_LIMITS` in contracts): 20 MB, 50,000 data rows, 100 columns, 2,000 characters per cell, 5 values per multi-valued cell; extensions `.csv`, `.tsv`, `.txt`; MIME `text/csv`, `application/csv`, `text/plain`, `application/vnd.ms-excel` (what Windows reports for .csv) and similar. Content is sniffed: Excel workbooks, PDFs, images, archives and binary data are refused even when named `.csv`. Encodings: UTF-8 with or without BOM, UTF-16 LE or BE with BOM, Windows-1252 fallback. Delimiter: comma, semicolon or tab, detected from the header. Quoted fields may contain delimiters, doubled quotes and newlines. Blank lines are skipped and counted. Rate limit: 30 uploads per hour per user.

`ImportJob`:

```json
{
  "id": "6add8b76520012303c641f9f",
  "status": "processing",
  "fileName": "businesses.csv",
  "sizeBytes": 18234,
  "encoding": "utf-8",
  "delimiter": ",",
  "headers": ["Business Name", "Phone", "Email", "Website", "City", "State", "Category"],
  "rowCount": 120,
  "blankRowsSkipped": 2,
  "sampleRows": [
    [
      "Acme Foods",
      "0803 123 4567",
      "info@acme.example.test",
      "acme.example.test",
      "Ikeja",
      "Lagos",
      "Restaurant"
    ]
  ],
  "suggestedMapping": [
    { "column": 0, "field": "name" },
    { "column": 1, "field": "phone" }
  ],
  "mapping": [
    { "column": 0, "field": "name" },
    { "column": 1, "field": "phone" }
  ],
  "defaultCountry": "NG",
  "progress": {
    "total": 120,
    "processed": 80,
    "created": 70,
    "updated": 6,
    "suppressed": 1,
    "failed": 3,
    "percent": 66
  },
  "error": null,
  "createdByUserId": "01a170ea-...",
  "createdAt": "...",
  "updatedAt": "...",
  "queuedAt": "...",
  "startedAt": "...",
  "finishedAt": null,
  "rowsExpireAt": "..."
}
```

Statuses: `uploaded` → `queued` → `processing` → `completed` (no failed rows), `completed_with_errors` (some rows failed) or `failed` (stopped after retries, or the importing user lost import permission; `error = { code, message }`, rows already processed are kept). Poll `GET /imports/:id` every 1 to 2 seconds while `queued` or `processing`; `progress` is updated after every 200-row batch. `rowsExpireAt` is upload time plus 30 days, after which staged rows and the per-row report are deleted; the import record and the businesses stay.

Mapping (`ImportMapping`): an array of `{ column, field }` with zero-based column indexes. `field` is one of `name`, `category`, `website`, `phone`, `email`, `whatsapp`, `street`, `locality`, `lga`, `region`, `country`, `postalCode`. Exactly one column maps to `name`; `phone`, `email` and `category` may map from several columns; every other field from at most one; a column maps once. Unmapped columns are ignored. A column index beyond the file is `400` on `mapping.<i>.column`. `suggestedMapping` comes from header names (for example "Business Name", "Company", "Phone Number", "Tel", "E-mail", "Website", "City", "State", "LGA").

`ImportPreviewRequest`: `{ mapping, defaultCountry?: "NG", limit?: 1..200 (default 50) }`. Normalizes the first `limit` rows and predicts what commit would do against current data without writing anything; saves the mapping as a draft. `409 CONFLICT` once committed.

```json
{
  "data": {
    "rows": [
      {
        "rowNumber": 2,
        "valid": true,
        "expectedOutcome": "create",
        "matchedBusinessId": null,
        "values": {
          "name": "Acme Foods",
          "categories": ["Restaurant", "Catering"],
          "website": "https://www.acme.example.test",
          "domain": "acme.example.test",
          "phones": [
            {
              "e164": "+2348031234567",
              "international": "+234 803 123 4567",
              "country": "NG",
              "type": "mobile",
              "whatsapp": "unknown"
            }
          ],
          "emails": ["info@acme.example.test"],
          "socials": [],
          "location": {
            "street": null,
            "locality": "Ikeja",
            "lga": null,
            "region": "Lagos",
            "country": "NG",
            "postalCode": null
          }
        },
        "errors": [],
        "warnings": []
      },
      {
        "rowNumber": 5,
        "valid": false,
        "expectedOutcome": "invalid",
        "matchedBusinessId": null,
        "values": { "...": "..." },
        "errors": [
          {
            "column": 0,
            "header": "Business Name",
            "field": "name",
            "code": "FORMULA_INJECTION",
            "message": "Starts with a spreadsheet formula character (=, +, -, @, tab or carriage return)"
          }
        ],
        "warnings": []
      }
    ],
    "summary": { "totalRows": 120, "checked": 50, "valid": 47, "invalid": 3 }
  }
}
```

`ImportCommitRequest`: `{ mapping, defaultCountry?: "NG", attestLawfulBasis: true }`. The attestation is required (security policy section 6). Returns `202` with status `queued`; a second commit is `409 CONFLICT`. The queue job id is `import-<importId>`, so double submission enqueues once.

`ImportRowResult` (`GET /imports/:id/rows?outcome=failed`):

```json
{
  "rowNumber": 6,
  "outcome": "failed",
  "businessId": null,
  "cells": ["Delta Logistics", "12345", "ops@delta", "", "Warri", "Delta", "Logistics"],
  "errors": [
    {
      "column": 1,
      "header": "Phone",
      "field": "phone",
      "code": "INVALID_PHONE",
      "message": "\"12345\": Not a valid phone number for NG or with a country code"
    },
    {
      "column": 2,
      "header": "Email",
      "field": "email",
      "code": "INVALID_EMAIL",
      "message": "\"ops@delta\": Invalid domain"
    }
  ],
  "warnings": [],
  "processedAt": "..."
}
```

`rowNumber` is the spreadsheet row (header is row 1), so users can find it in Excel. `outcome` is `created`, `updated` (merged into an existing business), `suppressed` (skipped), `failed`, or `null` while pending.

Row rules (each row is valid only if every mapped value is valid; invalid rows are reported, never imported partially or dropped silently):

| Issue code              | Kind             | When                                                                                                                                                            |
| ----------------------- | ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `REQUIRED`              | error            | Name blank or only punctuation (also a warning when a WhatsApp "yes" has no phone)                                                                              |
| `CELL_TOO_LONG`         | error            | Cell over 2,000 characters, name over 200, category over 80                                                                                                     |
| `FORMULA_INJECTION`     | error            | Cell starts with `=`, `+`, `-`, `@`, tab or carriage return (phone and WhatsApp columns may start with `+`)                                                     |
| `INVALID_PHONE`         | error            | Not valid for its numbering plan (libphonenumber-js, full metadata). Numbers without a country code are read in the row's country column, else `defaultCountry` |
| `INVALID_EMAIL`         | error            | Fails syntax (local part and every domain label checked)                                                                                                        |
| `INVALID_WEBSITE`       | error            | Not http(s), an IP address, an internal host (`localhost`, `.local`, `.internal`) or not a domain                                                               |
| `INVALID_COUNTRY`       | error            | Country column is not an ISO code or English country name                                                                                                       |
| `COLUMN_COUNT_MISMATCH` | error            | Row has a different number of cells than the header (trailing empty cells are fine)                                                                             |
| `TOO_MANY_VALUES`       | error or warning | More than 5 phones or emails in one cell (error); more than 10 categories (warning, first 10 kept)                                                              |
| `SOCIAL_PROFILE`        | warning          | Website column holds a Facebook, Instagram, LinkedIn, X, TikTok or YouTube URL; saved as a social profile                                                       |
| `POSSIBLE_DUPLICATE`    | warning          | Shares a domain, phone or email with a business whose name differs; kept separate                                                                               |
| `SUPPRESSED`            | warning          | Row matched a suppression entry and was skipped                                                                                                                 |

Spreadsheet placeholders (`N/A`, `-`, `nil`, `none`, `null`, `#N/A`) count as blank. Multi-valued cells split on `,`, `;`, `|`, newline and `/`. WhatsApp column: `yes`/`true`/`1` marks the row's first phone `user_asserted`; a phone number marks that number (adding it if needed); `no`/`false`/`0` or blank leaves `unknown`. Imports never set WhatsApp to `confirmed`.

Normalization: names are tidied (whitespace, invisible characters); phones become E.164 with national and international formats, number country and line type; emails are lowercased without `mailto:`; websites keep the scheme (`https` assumed when absent), drop query, fragment and trailing slash, and the domain is the lowercase punycode host without `www.`; Nigerian states are canonicalized (`Lagos State` → `Lagos`, `FCT`/`Abuja` → `Federal Capital Territory`); uniform-case places are title-cased.

Exact dedup at ingest: a row merges into an existing business in the same organization when they share the website domain, a phone or an email (checked in that order) and their normalized names match (case, punctuation, diacritics and trailing `Ltd`, `Limited`, `PLC`, `Inc`, `LLC`, `Co` ignored). Merging unions phones, emails, categories and socials; agreeing values gain an observation; a disagreeing website or location becomes `conflicting` with the new value kept in `alternatives`. Rows within the same file dedup the same way. Shared identifiers with different names are kept apart with `POSSIBLE_DUPLICATE`; names alone never merge. Similarity matching and the review queue arrive with the dedup module.

Each imported value is a `user_import` observation with `importId`, `sourceRef: "import:<id>"`, the importing user as actor, `collectedAt` = commit time, confidence 0.6 and `metadata.rowNumber`.

Errors: `400 VALIDATION_FAILED` (no file, bad mapping, missing attestation), `404 NOT_FOUND`, `409 CONFLICT` (already committed), `413 PAYLOAD_TOO_LARGE` (over 20 MB or 50,000 rows), `415 UNSUPPORTED_MEDIA_TYPE` (extension, MIME type or sniffed content), `422 IMPORT_INVALID` (empty file, header only, more than 100 columns, unreadable CSV such as an unclosed quote; `details[0] = { path: "file", message: "line N" }` when the line is known), `429 RATE_LIMITED`.

Audit: `import.uploaded`, `import.committed`, `import.finished` (system actor, with final counts or the failure).

### Exports, synchronous (shipped in Phase 2)

| Method | Path                  | Permission                                    | Body                      | Returns        |
| ------ | --------------------- | --------------------------------------------- | ------------------------- | -------------- |
| POST   | `/exports/businesses` | `exports:create` or `exports:create_assigned` | `ExportBusinessesRequest` | `200 text/csv` |

Body: `{ filter?: BusinessListFilter, ids?: ObjectId[] (1..1000), columns?: ExportColumn[] }`. `filter` takes the same fields as the directory query, as JSON (`{ "region": ["Lagos"], "hasPhone": true }`); with `ids` the selection is the intersection of the ids and the filter. Columns (default: all, in this order): `id, name, categories, street, locality, lga, region, country, website, website_state, phone, phone_state, phones_all, whatsapp, email, email_state, emails_all, sources, source_records, source_datasets, source_licenses, overture_release, attribution, license_urls, last_verified_at, created_at, updated_at`. Multi-valued cells are joined with `; `. Stage 4 added the six source columns: `source_records` (`overture_places:<GERS id>`), `source_datasets` (`meta`, `Foursquare`, ...), `source_licenses` (`CDLA-Permissive-2.0`, ...), `overture_release`, `attribution` (the lines the record must carry, `|`-separated per source) and `license_urls` (absolute URLs of the licence texts, space-separated); they are empty for rows without open data. When any row carries openly licensed data the response also has `Link: <https://<api>/api/v1/public/data-licenses>; rel="license"` (CDLA-Permissive-2.0 section 2.1: the licence text must be available with shared data).

The response is UTF-8 CSV with a BOM, CRLF line endings, RFC 4180 quoting, `Content-Disposition: attachment; filename="leadforge-businesses-<timestamp>.csv"`, `X-Export-Row-Count` and `Cache-Control: no-store` (both headers are CORS-exposed). Every cell that starts with `=`, `+`, `-`, `@`, tab or carriage return is prefixed with `'` so spreadsheets treat it as text; a strict E.164 number (`+2348031234567`) is left as is. Suppressed businesses are never exported, whatever the filter. The browser should `fetch` with credentials and the organization and CSRF headers, then save the blob.

Errors: `400 VALIDATION_FAILED`, `404 NOT_FOUND` (`filter.importId` from another organization), `422 EXPORT_TOO_LARGE` (more than 1,000 matching rows; narrow the filter or select rows), `429 RATE_LIMITED` (10 exports per hour per user). Audit: `export.created` with row count, columns and the filter or the number of ids.

Phase 5: Sales Representatives (`exports:create_assigned`) can export, limited to businesses whose lead is assigned to them; other roles are unchanged. Async export jobs (`/exports`, signed downloads, plan row caps) are documented under "Exports, asynchronous".

### Sources (Phase 2 registry; per-organization settings in Phase 3)

| Method | Path            | Permission                        | Body                   | Returns                                                                                            |
| ------ | --------------- | --------------------------------- | ---------------------- | -------------------------------------------------------------------------------------------------- |
| GET    | `/sources`      | `businesses:read`                 | none                   | `200` list of `SourceRegistryEntry` with this organization's setting (`meta.nextCursor` is `null`) |
| PATCH  | `/sources/:key` | `settings:sources` (owner, admin) | `{ enabled: boolean }` | `200 SourceRegistryEntry`                                                                          |

```json
{
  "key": "overture_places",
  "name": "Overture Maps Places",
  "kind": "discovery",
  "method": "dataset_snapshot",
  "status": "configured",
  "statusReason": null,
  "statusDetail": "Release 2026-10-21.0 loaded 2026-10-26: 162,475 Nigerian places, 156,760 offerable after removing duplicates and closed places.",
  "enabled": true,
  "configurable": true,
  "fieldsProvided": ["name", "category", "location", "phone", "email", "website", "social"],
  "coverage": "Nigeria only. About 162,000 places in release 2026-10-21.0, 98% from Meta ...",
  "policy": {
    "storage": "Stored indefinitely under the open data licences ...",
    "retentionDays": null,
    "fieldRetention": [
      {
        "field": "GERS id (Overture place id)",
        "retention": "indefinite",
        "days": null,
        "note": "..."
      }
    ],
    "attribution": "Source: Overture Maps Foundation (overturemaps.org), with the record's dataset line ...",
    "rateLimit": "Discovery reads LeadForge's own staging catalogue; no call reaches Overture at job time. ...",
    "lawfulBasis": "Open data licences permit storage and commercial reuse. ...",
    "termsCheckedAt": "2026-10-25",
    "terms": [
      {
        "title": "Overture Maps attribution and licensing",
        "url": "https://docs.overturemaps.org/attribution/",
        "lastModified": "2026-05-15"
      }
    ],
    "licensing": {
      "label": "Overture Maps Foundation",
      "text": "Source: Overture Maps Foundation (overturemaps.org)",
      "url": "https://overturemaps.org",
      "licenses": [
        {
          "id": "CDLA-Permissive-2.0",
          "name": "Community Data License Agreement – Permissive, Version 2.0",
          "textPath": "/api/v1/public/data-licenses/CDLA-Permissive-2.0",
          "referenceUrl": "https://cdla.dev/permissive-2-0/"
        }
      ],
      "upstream": [
        {
          "dataset": "meta",
          "text": "Data from Meta. Available under CDLA Permissive 2.0.",
          "license": "CDLA-Permissive-2.0"
        }
      ],
      "requirements": [
        "Wherever Overture-derived values appear ... show \"Source: Overture Maps Foundation (overturemaps.org)\" and the record's dataset line ..."
      ],
      "licensesPath": "/api/v1/public/data-licenses"
    }
  },
  "docsUrl": "https://docs.overturemaps.org/guides/places/",
  "config": null
}
```

Google Places, for comparison (Stage 4: never runnable):

```json
{
  "key": "google_places",
  "name": "Google Places API (New)",
  "kind": "discovery",
  "method": "api",
  "status": "not_available",
  "statusReason": "provider_terms",
  "statusDetail": "Unavailable under Google's terms. The Google Maps Platform Terms of Service (last modified 2026-08-26) section 3.2.3 forbid ... LeadForge keeps business records, so this source never runs, with or without an API key. Overture Maps Places is the discovery source.",
  "enabled": true,
  "configurable": true,
  "fieldsProvided": ["name", "category", "location", "phone", "website"],
  "coverage": "Official Google Maps Platform data. Coverage of small Nigerian businesses varies by area; at most 60 results per query.",
  "policy": {
    "storage": "Only the Google place ID is stored long term. ...",
    "retentionDays": 0,
    "fieldRetention": [
      { "field": "place_id", "retention": "indefinite", "days": null, "note": "..." },
      { "field": "latitude, longitude", "retention": "not_collected", "days": 30, "note": "..." },
      {
        "field": "name, address, phone, website, category, opening hours",
        "retention": "none",
        "days": 0,
        "note": "..."
      }
    ],
    "attribution": "Results from Google Places must show the Google Maps attribution ...",
    "rateLimit": "LeadForge sends at most 5 requests per second to Google Places across all organizations; ...",
    "lawfulBasis": "Licensed API access under the Google Maps Platform Terms. Legal review is required before production use ...",
    "termsCheckedAt": "2026-10-25",
    "terms": [
      {
        "title": "Google Maps Platform Terms of Service, section 3.2.3",
        "url": "https://cloud.google.com/maps-platform/terms",
        "lastModified": "2026-08-26"
      }
    ],
    "licensing": null
  },
  "docsUrl": "https://developers.google.com/maps/documentation/places/web-service/text-search",
  "config": { "updatedAt": "...", "updatedByUserId": "..." }
}
```

`status`: `active` (in use now: `user_import`, `user_edit`, and since Phase 4 `website`, the business's own website through SafeFetch), `configured` (`overture_places` once a snapshot is loaded), `not_configured` (`overture_places` before the first sync: `statusReason: "snapshot_missing"`), `not_available` (`google_places`: `statusReason: "provider_terms"`, with or without a key). `statusReason` (Stage 4, new required field) is `provider_terms`, `credentials_missing`, `snapshot_missing` or `null` when the source can run (always `null` for user-supplied and enrichment sources). `policy.licensing` (Stage 4, new required field) is the `SourceLicensing` block (label, attribution line, per-dataset lines, licences with text links, display requirements, `licensesPath`) or `null`. Discovery sources are listed runnable first, so `overture_places` comes before `google_places`. `policy.retentionDays` is 0 when values expire on collection and `null` when unlimited; `policy.fieldRetention` lists the rule per field (`indefinite`, `limited`, `none`, `not_collected`). `enabled` defaults to `true`; only `configurable` (discovery) sources can be switched, and `PATCH` on another key is `400 VALIDATION_FAILED` (an unknown key is also 400). Disabling stops new jobs and estimates with `SOURCE_DISABLED`; a queued job whose source was disabled fails when it starts and its hold is released. Changes are audited as `source.enabled` and `source.disabled` with before and after.

### Overview (shipped in Phase 2)

| Method | Path                | Permission        | Query                                     | Returns               |
| ------ | ------------------- | ----------------- | ----------------------------------------- | --------------------- |
| GET    | `/reports/overview` | `businesses:read` | `period=7d \| 30d \| 90d` (default `30d`) | `200 OverviewMetrics` |

```json
{
  "data": {
    "period": "30d",
    "periodStart": "...",
    "generatedAt": "...",
    "freshnessDays": 180,
    "businesses": { "total": 24, "suppressed": 1, "addedInPeriod": 24 },
    "contacts": {
      "withPhone": 19,
      "withEmail": 13,
      "withWebsite": 11,
      "verifiedPhone": 1,
      "verifiedEmail": 2,
      "verifiedWebsite": 0,
      "whatsappConfirmed": 1,
      "whatsappUserAsserted": 1
    },
    "sources": [
      { "source": "user_import", "businesses": 14 },
      { "source": "user_edit", "businesses": 10 }
    ],
    "imports": {
      "total": 3,
      "inProgress": 0,
      "recent": [
        {
          "id": "...",
          "status": "completed_with_errors",
          "fileName": "...",
          "rowCount": 12,
          "progress": { "...": "..." },
          "createdAt": "...",
          "finishedAt": "..."
        }
      ]
    }
  }
}
```

`businesses.total` counts every live business including suppressed ones; `addedInPeriod` counts records created in the period. `contacts` counts non-suppressed businesses with at least one value, and with at least one `verified` (and not stale or expired) value. Phase 3 added:

```json
{
  "discovery": {
    "total": 4,
    "inProgress": 1,
    "completedInPeriod": 2,
    "failedInPeriod": 1,
    "recent": [
      {
        "id": "...",
        "name": "Ikeja restaurants",
        "status": "completed",
        "progress": { "...": "..." },
        "createdAt": "...",
        "finishedAt": "..."
      }
    ]
  },
  "credits": { "balance": 977, "held": 50 }
}
```

`discovery.total` and `inProgress` (queued or running) are all-time; `completedInPeriod` (completed or completed with warnings) and `failedInPeriod` count jobs finished in the period; `recent` holds the 5 newest jobs. `credits` comes from the PostgreSQL ledger. Phase 5 added (always sent; typed optional in `OverviewMetrics` so older clients compile):

```json
{
  "credits": { "balance": 977, "held": 0, "usedInPeriod": 23 },
  "pipeline": {
    "openLeads": 12,
    "qualifiedLeads": 7,
    "unassignedOpenLeads": 3,
    "wonInPeriod": 2,
    "lostInPeriod": 1
  },
  "jobs": { "active": 1, "failedInPeriod": 0, "recent": ["JobSummary x5"] },
  "activity": { "loggedInPeriod": 31, "recent": ["Activity x10"] },
  "quality": {
    "total": 210,
    "unscored": 12,
    "fit": [{ "min": 0, "max": 9, "count": 4 }],
    "dataConfidence": [{ "min": 0, "max": 9, "count": 1 }]
  }
}
```

`usedInPeriod` is credits captured in the period. `openLeads` are leads not in a won or lost stage; `qualifiedLeads` are open leads past the entry stage. `jobs.active` counts queued and running jobs of every kind (capped at 100); `failedInPeriod` counts jobs created in the period that failed; `recent` are the 5 newest jobs (exports follow their visibility). `activity` counts logged activities (stage changes and assignments excluded). `quality` histograms cover live, non-suppressed businesses, ten 10-point buckets each (the last is 90 to 100), fit and data confidence kept separate. Subscription status arrives with billing (Phase 6).

### Discovery (shipped in Phase 3)

Every route needs a signed-in, email-verified member, `X-Organization-Id`, and `X-CSRF-Token` on `POST`. Ids are ObjectIds; another organization's job id is `404 NOT_FOUND`.

| Method | Path                               | Permission        | Body or query                                                                                                 | Returns                                                                                            |
| ------ | ---------------------------------- | ----------------- | ------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| GET    | `/discovery/sources`               | `businesses:read` | none                                                                                                          | `200` list of `DiscoverySourceOption` for the wizard (runnable first)                              |
| GET    | `/discovery/categories`            | `businesses:read` | `source?` (default `overture_places`), `q?` (prefix over labels and synonyms), `limit?` (1..500, default 100) | `200` list of `DiscoveryCategoryOption` (Stage 4)                                                  |
| GET    | `/discovery/locations`             | `businesses:read` | `source?` (default `overture_places`)                                                                         | `200 DiscoveryLocationOptions`: states and LGAs with place counts (Stage 4)                        |
| POST   | `/discovery/jobs/estimate`         | `discovery:run`   | `DiscoveryJobSpec`                                                                                            | `200 DiscoveryEstimate` (never fails for an unconfigured or disabled source; see `blockers`)       |
| POST   | `/discovery/jobs`                  | `discovery:run`   | `DiscoveryJobSpec` plus header `Idempotency-Key` (required)                                                   | `201 DiscoveryJob` (`queued`); `200` with the same job when the key is replayed with the same spec |
| GET    | `/discovery/jobs`                  | `businesses:read` | `status[]?, source?, cursor?, pageSize?`                                                                      | `200` page of `DiscoveryJob`, newest first                                                         |
| GET    | `/discovery/jobs/:id`              | `businesses:read` | none                                                                                                          | `200 DiscoveryJob` (poll this)                                                                     |
| GET    | `/discovery/jobs/:id/items`        | `businesses:read` | `outcome[]?, cursor?, pageSize?`                                                                              | `200` page of `DiscoveryJobItem` in discovery order                                                |
| POST   | `/discovery/jobs/:id/cancel`       | `discovery:run`   | none                                                                                                          | `200 DiscoveryJob`                                                                                 |
| POST   | `/discovery/jobs/:id/retry-failed` | `discovery:run`   | none                                                                                                          | `202 DiscoveryJob` (`queued`, next `round`)                                                        |

Server-Sent Events (`/discovery/jobs/:id/events`) are not shipped; poll `GET /discovery/jobs/:id` every 2 seconds while `status` is `queued` or `running`, and stop when it is terminal and `credits.settled` is true (usually the same response). Every progress number comes from item records written by the worker.

`DiscoverySourceOption` (Stage 4 shape; `statusReason`, `licensing`, `specSupport` and `snapshot` are new required fields):

```json
{
  "key": "overture_places",
  "name": "Overture Maps Places",
  "status": "configured",
  "statusReason": null,
  "statusDetail": "Release 2026-10-21.0 loaded ...",
  "enabled": true,
  "runnable": true,
  "maxResultsPerQuery": 0,
  "providesFields": ["name", "category", "location", "phone", "email", "website", "social"],
  "attribution": "Overture Maps Foundation",
  "retentionSummary": "Stored indefinitely under the open data licences ...",
  "licensing": {
    "label": "Overture Maps Foundation",
    "text": "Source: Overture Maps Foundation (overturemaps.org)",
    "...": "SourceLicensing"
  },
  "specSupport": {
    "location": ["region", "lga", "locality", "query", "geo"],
    "confidence": true,
    "requireContact": true,
    "priorityFields": false,
    "catalog": true
  },
  "snapshot": {
    "release": "2026-10-21.0",
    "syncedAt": "2026-10-26T06:42:42.000Z",
    "places": 162475,
    "offerable": 156760
  }
}
```

`google_places` comes back with `status: "not_available"`, `statusReason: "provider_terms"`, `runnable: false`, `licensing: null`, `snapshot: null`. `maxResultsPerQuery` is 0 when the source has no per-query cap. `specSupport.location` lists the location fields the source uses; `catalog` says whether `/discovery/categories` and `/discovery/locations` have options for it.

`DiscoveryJobSpec`:

```json
{
  "name": "Ikeja pharmacies",
  "sources": ["overture_places"],
  "location": { "country": "NG", "region": "Lagos", "lga": "Ikeja" },
  "categories": ["Pharmacy", "chemist"],
  "domainsInclude": [],
  "domainsExclude": ["chain.example.com"],
  "maxRecords": 100,
  "priorityFields": ["phone", "website"],
  "confidence": "standard",
  "requireContact": true
}
```

`name` 2..120; `sources` 1..3 distinct from `overture_places` and `google_places` (Google is refused: `422 SOURCE_POLICY_BLOCKED`); `location.country` ISO alpha-2 (default `NG`), `region`, `lga` (Stage 4) and `locality` 2..120 (Nigerian state spellings are canonicalized), `query` 2..200 (extra place text), `geo` optional circle (radius 100..50,000 m); `categories` 1..10 distinct; `confidence` (Stage 4, default `standard`) and `requireContact` (Stage 4, default `true`) are Overture options and ignored by other sources; `domainsInclude` / `domainsExclude` bare domains, max 50 each, applied to each place's website (`DOMAIN_NOT_INCLUDED` / `DOMAIN_EXCLUDED` skips); `maxRecords` 1..5,000; `priorityFields` from `phone`, `email`, `whatsapp`, `website` (default `["phone", "website"]`). `priorityFields` only changed Google's field mask; Overture ignores it. WhatsApp is never inferred from a phone number.

Overture Maps Places (Stage 4) reads LeadForge's staging catalogue (one GERS id per place):

- **Categories**: each term maps to Overture taxonomy categories through the Nigerian vocabulary (`GET /discovery/categories`; "supermarket", "chemist", "lawyer", "church", "filling station", "POS agent", "bureau de change" and about 70 more have curated mappings), else an Overture category of the same name ("pet store" is `pet_store`) or ending in it, else words in the place name (items carry `MATCHED_BY_NAME`, estimates warn). A category matches its whole subtree.
- **Location**: `region` is the state, `lga` the local government area, both from Overture's division boundaries (spelling, case, diacritics, hyphens and the suffix "LGA" are ignored; "AMAC" means Municipal Area Council); `locality` matches the address city or an LGA of that name; `query` requires every word in the street address; `geo` keeps places inside the circle. Nigeria only (`400` on `location.country` otherwise; an unknown state is `400` on `location.region`). No location means nationwide.
- **Quality**: `confidence: "standard"` keeps places with Overture confidence 0.5 or more, `"high"` 0.7 or more; places between 0.5 and 0.6 carry `LOWER_CONFIDENCE`. Closed places, duplicates (same upstream record or Facebook page as a place offered instead) and retired places are never offered. `requireContact` keeps only places with a phone, email or real website (not only a social or messaging link), so contact-less records are never charged.
- **Order**: confidence, then contact completeness, then GERS id; pages of `OVERTURE_PAGE_SIZE` (default 100) with a resumable token.
- **Already in the directory**: places linked to a business in the organization (the same GERS id, or the same upstream record or Facebook page under another id) are left out of the estimate and the search, and an item that still resolves to one is `duplicate` with `ALREADY_IN_DIRECTORY`, never charged.

`DiscoveryEstimate` (what the job wizard shows):

```json
{
  "estimateAvailable": true,
  "credits": { "perRecord": 1, "hold": 100, "balance": 977, "sufficient": true },
  "maxRecords": 100,
  "sources": [
    {
      "source": "overture_places",
      "name": "Overture Maps Places",
      "status": "configured",
      "enabled": true,
      "runnable": true,
      "queries": 1,
      "maxResults": 100,
      "maxRequests": 1,
      "providerSku": null,
      "exact": true,
      "alreadyInDirectory": 5,
      "fields": [
        "name",
        "category",
        "address",
        "state and LGA",
        "phone",
        "email",
        "website",
        "social"
      ],
      "warnings": [
        "5 matching places are already in your directory and are skipped (never charged twice).",
        "Overture's confidence says whether a place exists, not whether its phone or email works."
      ]
    }
  ],
  "basis": "1 credit per business record produced (a new record, or an existing record that gains new observations). ...",
  "warnings": ["..."],
  "blockers": []
}
```

`credits.hold` = `maxRecords` = min(spec `maxRecords`, sum of the **runnable** sources' `maxResults`; 0 when none can run). For Overture `maxResults` is the exact number of matching places not already in the directory (`exact: true`; `alreadyInDirectory` counts the ones left out), so the hold is exactly what the job can produce; `exact` and `alreadyInDirectory` are new required fields (Google: `false` and 0). `maxRequests` excludes retries. `blockers` lists `{ code, source, message }` with `code` one of `SOURCE_NOT_CONFIGURED`, `SOURCE_DISABLED`, `SOURCE_POLICY_BLOCKED` (Stage 4), `VALIDATION_FAILED`, `INSUFFICIENT_CREDITS`, and from Phase 6 `ENTITLEMENT_REQUIRED` (the plan does not include discovery) and `CREDIT_BALANCE_NEGATIVE` (the balance is below zero; replaces `INSUFFICIENT_CREDITS` then); creating the job returns the same codes as 402 errors; `estimateAvailable` is false when no selected source can run. The job is charged only for records it produces.

Create: validates the spec, checks every source is configured and enabled, applies the per-organization rate limit, holds `credits.hold` in PostgreSQL under key `job:<id>:hold`, inserts the job (`queued`) and enqueues it; a failure after the hold releases it. `Idempotency-Key` (8 to 128 of `A-Z a-z 0-9 _ - . :`) is scoped to the user: the same key with the same spec returns the first job with `200`; with a different spec it is `409 CONFLICT`; a missing key is `400` on `Idempotency-Key`. Errors: `400 VALIDATION_FAILED` (Stage 4: also `path: "sources"` when no place matches, or every match is already in the directory; nothing is held), `402 INSUFFICIENT_CREDITS` (`details: [{ path: "credits.required", message: "100" }, { path: "credits.available", message: "42" }]`), `422 SOURCE_POLICY_BLOCKED` (`google_places`), `422 SOURCE_NOT_CONFIGURED` or `422 SOURCE_DISABLED` (`details: [{ path: "sources", message: "overture_places" }]`), `429 RATE_LIMITED`, `409 CONFLICT`. Audit: `discovery.created`.

`DiscoveryJob`:

```json
{
  "id": "6add8b76520012303c641f9f",
  "name": "Ikeja restaurants",
  "status": "running",
  "spec": { "...": "DiscoveryJobSpec as stored" },
  "estimate": { "maxRecords": 100, "hold": 100, "basis": "..." },
  "credits": { "held": 100, "captured": 0, "released": 0, "settled": false, "settledAt": null },
  "progress": {
    "processed": 20,
    "created": 17,
    "updated": 1,
    "duplicates": 0,
    "skipped": 2,
    "failed": 0,
    "billable": 18,
    "pagesFetched": 1,
    "limit": 100,
    "lastEventAt": "..."
  },
  "sourceOutcomes": [
    {
      "source": "overture_places",
      "status": "running",
      "pages": 1,
      "records": 20,
      "rateLimited": 0,
      "errors": []
    }
  ],
  "errors": [],
  "warnings": [],
  "cancelRequested": false,
  "round": 0,
  "retryableItems": 0,
  "attributions": ["Overture Maps Foundation"],
  "sourceReleases": [{ "source": "overture_places", "release": "2026-10-21.0" }],
  "createdByUserId": "...",
  "createdAt": "...",
  "updatedAt": "...",
  "queuedAt": "...",
  "startedAt": "...",
  "finishedAt": null,
  "cancelledAt": null,
  "timeoutAt": "..."
}
```

Statuses: `queued` → `running` → `completed` (no failed items, no source failure), `completed_with_warnings` (some items failed on our side, or a source stopped with an error after producing records), `failed` (every source failed before producing anything, the job timed out, the creator lost access, or it could not be queued; see `errors[].code`), `cancelled`. `draft` is reserved and not produced. `progress.billable` counts created plus updated items; `limit` is the most this round may produce. `sourceOutcomes[].errors` also lists transient errors that were retried successfully; `errors` holds final failures with codes such as `SOURCE_AUTH_FAILED`, `SOURCE_REQUEST_INVALID`, `SOURCE_NOT_CONFIGURED`, `SOURCE_DISABLED`, `JOB_TIMEOUT`, `ACCESS_REVOKED`, `ENQUEUE_FAILED`. `retryableItems` is the number of failed items retry-failed would re-queue (0 until the job is finished and settled). `attributions` must be shown wherever these results are displayed. `sourceReleases` (Stage 4, new required field) names the open-data release each snapshot source read when the job was created.

`DiscoveryJobItem` (`GET /discovery/jobs/:id/items?outcome=failed`):

```json
{
  "id": "...",
  "source": "overture_places",
  "externalId": "e1c1c8aa-....",
  "outcome": "created",
  "billable": true,
  "attempts": 1,
  "round": 0,
  "error": null,
  "warnings": [{ "code": "LOWER_CONFIDENCE", "message": "Overture confidence 0.55 (below 0.6)" }],
  "business": { "id": "...", "name": "Ikeja Pharmacy (Sample)", "nameState": "unverified" },
  "duplicateOfId": null,
  "processedAt": "..."
}
```

Outcomes: `created` (new business), `updated` (an existing business gained new observations; matched by source record first, then by exact domain, phone or email with the same normalized name), `duplicate` (resolved to a business another item of this job produced, or, Stage 4, to one already linked to the same place before this job: warning `ALREADY_IN_DIRECTORY`; not billed), `skipped` (`PERMANENTLY_CLOSED`, `MISSING_NAME`, `INVALID_VALUE`, `DOMAIN_EXCLUDED`, `DOMAIN_NOT_INCLUDED`, `SUPPRESSED`, `PLACE_NOT_FOUND`; not billed), `failed` (`INGEST_FAILED`, retryable, never billed). Items hold the place ID only, no place content; `business.name` follows the field model (null when expired). Warnings include `TEMPORARILY_CLOSED`, `INVALID_VALUE` (a phone or website that was dropped), `POSSIBLE_DUPLICATE`, and for Overture `LOWER_CONFIDENCE`, `MATCHED_BY_NAME` and `ALREADY_IN_DIRECTORY`. Two different source records are never merged unless they are the same upstream place (Overture match keys), so chain branches stay separate.

Cancel: a `queued` job is cancelled at once and its whole hold released. A `running` job gets `cancelRequested: true` (still `running` in the response) and stops before its next page; items already produced are captured and the rest released. A finished job is `409 JOB_NOT_CANCELLABLE`. Audit: `discovery.cancelled` or `discovery.cancel_requested`.

Retry-failed: for a finished and settled job with failed items, re-queues up to 1,000 of them as round `n + 1` with a new hold of one credit per item (`job:<id>:retry:<n>:hold`), re-fetching each place by id from the source (Overture: the staging catalogue; a place retired since is skipped with `PLACE_NOT_FOUND`). Returns `202` with `status: "queued"`. `409 JOB_NOT_RETRYABLE` while the job runs, before it is settled, or when nothing failed; `402 INSUFFICIENT_CREDITS`; `422 SOURCE_NOT_CONFIGURED` or `SOURCE_DISABLED`. Audit: `discovery.retry_requested`.

#### Wizard catalogues (Stage 4)

`GET /discovery/categories` (`businesses:read`). Query: `source` (`overture_places`, the default, or `google_places`), `q` (optional, up to 80 characters; matches the start of any word of the label, the key or a synonym, ignoring case and accents), `limit` (1..500, default 100). Returns `200 DiscoveryCategoryOption[]`: curated Nigerian categories first (in a fixed order), then every other Overture category in the loaded snapshot by place count. Each label appears once: an Overture category whose label is already a curated label, key or synonym is left out (submitting it would resolve to the curated category anyway, and the curated category covers its subtree, for example `pharmacy` under `pharmacy_and_drug_store`), and Overture categories with the same label are merged into one entry. `GET /discovery/categories?q=chem`:

```json
[
  {
    "key": "pharmacy",
    "label": "Pharmacy",
    "synonyms": [
      "chemist",
      "drug store",
      "drugstore",
      "patent medicine store",
      "patent medicine vendor"
    ],
    "sourceCategories": ["pharmacy_and_drug_store"],
    "kind": "curated",
    "places": 419
  }
]
```

Fields: `key` (stable id: the curated key, or the Overture category), `label` (display text), `synonyms` (curated only; Nigerian terms that resolve to this category), `sourceCategories` (the Overture taxonomy categories matched, each with its subtree), `kind` (`curated` or `taxonomy`), `places` (offerable places nationwide: confidence 0.5 or more, open, with a contact, after duplicate grouping; for a curated entry the largest of its categories; `null` before the first sync). Send the `label` (or any synonym, or the `key`) in `spec.categories`. `source=google_places` returns `[]`; any other `source` is `400 VALIDATION_FAILED`.

`GET /discovery/locations` (`businesses:read`). Query: `source` (`overture_places`, the default). Returns `200 DiscoveryLocationOptions`: every Nigerian state with offerable places in the loaded snapshot (sorted by name), each with its LGAs (sorted by name), from the latest completed sync run, so it costs no place query:

```json
{
  "source": "overture_places",
  "release": "2026-10-21.0",
  "country": "NG",
  "states": [
    {
      "key": "lagos",
      "name": "Lagos",
      "code": "NG-LA",
      "places": 32967,
      "lgas": [
        { "key": "ikeja", "name": "Ikeja", "places": 5140 },
        { "key": "ikorodu", "name": "Ìkòròdú", "places": 1522 }
      ]
    }
  ],
  "boundariesAttribution": "States and LGAs assigned from Overture Maps divisions boundaries: © OpenStreetMap contributors, available under the Open Database License (ODbL); geoBoundaries and Esri Community Maps contributors, available under CC BY 4.0."
}
```

Fields: `release` (the loaded Overture release, `null` before the first sync), `country` (`NG`), `states[]` with `key` (the name in lower case), `name` (canonical, as in `NIGERIAN_STATES`), `code` (ISO 3166-2, as in `NIGERIAN_STATE_CODES`), `places` and `lgas[]` with `key` (the name without accents, in lower case, separators as spaces), `name` (as Overture spells it, accents kept, for example `Ìkòròdú`) and `places`; `boundariesAttribution` (the ODbL and CC BY 4.0 credit for the boundaries). Send a state `name` as `location.region` and an LGA `name` (or `key`) as `location.lga`; show `boundariesAttribution` near the picker. Empty `states` and `release: null` before the first sync. Counts are offerable places (confidence 0.5 or more with a contact), refreshed by each sync. The 36 states and the FCT, with their codes, are also exported by `@leadforge/contracts` (`NIGERIAN_STATES`, `NIGERIAN_STATE_CODES`, `nigerianStateKey`), so the web app can list states without a request; LGAs come only from this endpoint.

Charging (PRODUCT_REQUIREMENTS section 8): 1 credit per produced record (`created` or `updated`). At the end of each round the worker captures that round's billable items and releases the rest of its hold (`job:<id>[:retry:<n>]:capture|release`). Failed, skipped and duplicate items are never charged, cancelled and failed jobs are charged only for what they produced, and an item that failed and later succeeded is charged once. Notifications: the creator gets an in-app notification when a job completes, completes with warnings or fails, and an email when it fails (preferences permitting).

### Website analysis (shipped in Phase 4)

Every route needs a signed-in, email-verified member, `X-Organization-Id`, and `X-CSRF-Token` on `POST`. Another organization's ids are `404`.

| Method | Path                       | Permission                                | Body or query                                                          | Returns                                                                                 |
| ------ | -------------------------- | ----------------------------------------- | ---------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| POST   | `/analysis/websites`       | `analysis:run` (owner, admin, researcher) | `{ businessId }` or `{ businessIds: [1..50] }`                         | `202 CreateAnalysisResponse`                                                            |
| GET    | `/analysis/websites`       | `businesses:read`                         | `status[]?, opportunity[]?, businessId?, batchId?, cursor?, pageSize?` | `200` page of `WebsiteAnalysis`, newest first                                           |
| GET    | `/analysis/websites/:id`   | `businesses:read`                         | none                                                                   | `200 WebsiteAnalysis` (poll this)                                                       |
| GET    | `/businesses/:id/analysis` | `businesses:read`                         | none                                                                   | `200 WebsiteAnalysis` (newest completed, else newest of any status) or `{ data: null }` |

Credits (PRODUCT_REQUIREMENTS section 8): each new analysis holds 1 credit when queued (`analysis:<id>:hold`), captures it when the analysis completes (`analysis:<id>:capture`) and releases it when it fails (`analysis:<id>:release`). A business has at most one queued or running analysis: asking again (or refreshing) returns that analysis in `alreadyInProgress` and holds nothing. The balance must cover every new analysis of the request, else `402 INSUFFICIENT_CREDITS` (`details: credits.required, credits.available`) and nothing is created. Ledger rows use `referenceType: "website_analysis"`, `referenceId: <analysisId>`.

`CreateAnalysisResponse`:

```json
{
  "analyses": ["WebsiteAnalysis (new ones first, then ones already in progress)"],
  "alreadyInProgress": ["<analysisId>"],
  "skipped": [
    {
      "businessId": "...",
      "code": "NOT_FOUND | WEBSITE_MISSING | SUPPRESSED | INSUFFICIENT_CREDITS",
      "message": "..."
    }
  ],
  "batchId": "<id for a bulk request, else null>",
  "credits": { "held": 2 }
}
```

Single request errors: `404 NOT_FOUND` (no such business in the organization), `422 WEBSITE_MISSING` (no website on record, or it expired), `409 CONFLICT` (the business is suppressed: its website is never fetched), `402 INSUFFICIENT_CREDITS`, `400 VALIDATION_FAILED`. A bulk request lists those businesses in `skipped` instead (51 or more ids, or duplicates, is `400`). Audit: `analysis.requested` or `analysis.bulk_requested` (requested, created, skipped, credits held).

`WebsiteAnalysis`:

```json
{
  "id": "...",
  "businessId": "...",
  "business": { "name": "Mama Put Kitchen (Sample)", "nameState": "unverified" },
  "url": "https://mamaput.example.test",
  "finalUrl": "https://mamaput.example.test/",
  "status": "completed",
  "trigger": "single",
  "batchId": null,
  "fetched": {
    "status": 200,
    "redirects": [{ "url": "http://mamaput.example.test/", "status": 301 }],
    "bytes": 18234,
    "contentType": "text/html; charset=utf-8",
    "durationMs": 412,
    "tls": {
      "secure": true,
      "valid": true,
      "issuer": "Let's Encrypt / R11",
      "validTo": "Jan  9 12:00:00 2027 GMT",
      "error": null
    }
  },
  "robots": { "fetched": true, "allowed": true },
  "pagesVisited": [
    {
      "url": "https://mamaput.example.test",
      "finalUrl": "https://mamaput.example.test/",
      "kind": "home",
      "status": 200,
      "error": null
    },
    {
      "url": "https://mamaput.example.test/contact",
      "finalUrl": "https://mamaput.example.test/contact",
      "kind": "contact",
      "status": 200,
      "error": null
    }
  ],
  "detections": [
    {
      "key": "no_contact_form",
      "label": "No contact form was detected",
      "observed": "yes",
      "confidence": 0.75,
      "evidence": [
        {
          "type": "url",
          "value": "https://mamaput.example.test/contact",
          "page": "https://mamaput.example.test/contact"
        },
        { "type": "text", "value": "Checked 2 pages including the contact page", "page": null }
      ],
      "observedValue": null,
      "analyzedAt": "..."
    }
  ],
  "opportunities": [
    {
      "key": "contact_form",
      "title": "Website contact form",
      "rationale": "No contact form was detected on the pages checked. Checked 2 pages including the contact page.",
      "confidence": 0.75,
      "detectionKeys": ["no_contact_form"]
    }
  ],
  "credits": { "held": 1, "captured": 1, "released": 0, "settled": true },
  "error": null,
  "requestedByUserId": "...",
  "createdAt": "...",
  "startedAt": "...",
  "analyzedAt": "...",
  "finishedAt": "..."
}
```

Statuses: `queued` → `running` → `completed` or `failed`. Poll `GET /analysis/websites/:id` every 2 seconds while `queued` or `running`, and stop when it is terminal and `credits.settled` is true (usually the same response; per-host fetch limits mean an analysis takes about 10 to 20 seconds once running).

Detections, always in this order, each with `observed` (`yes`: the gap was observed; `no`: the feature was seen; `unknown`: it could not be checked), `confidence` (0 to 1) and evidence (`selector`, `url`, `text` or `header`, snippets of at most 300 characters):

| `key`                  | `label` when `observed: "yes"`                                   | What is checked                                                                                                                                                                                                                      |
| ---------------------- | ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `website_unreachable`  | No reachable website was detected                                | DNS failure, refused or failed connection, timeout, TLS failure with no http fallback, redirect loop, or a 4xx or 5xx home page, after 2 retries. When `yes`, every other detection is `unknown`                                     |
| `mobile_unfriendly`    | Indicators of a layout that is not mobile-friendly were detected | missing viewport meta (0.8), fixed-width viewport (0.7), fixed widths of 960 px or more in inline CSS or tables (0.5), font sizes under 12 px (0.4)                                                                                  |
| `no_contact_form`      | No contact form was detected                                     | forms with an email or message field on the home and contact pages; embedded form providers (Google Forms, Typeform, Jotform, Tally, HubSpot...) count; newsletter sign-ups and search boxes do not                                  |
| `no_booking_flow`      | No booking flow was detected                                     | booking widgets and links (Calendly, Acuity, Fresha, Booksy, OpenTable...), booking phrases and booking paths                                                                                                                        |
| `no_online_ordering`   | No online ordering flow was detected                             | cart, checkout and order links or buttons, shop platforms, delivery platforms (Chowdeck, Glovo, Jumia Food...)                                                                                                                       |
| `no_whatsapp_link`     | No WhatsApp link was detected                                    | `wa.me`, `api.whatsapp.com`, `whatsapp:` links                                                                                                                                                                                       |
| `no_https`             | No working HTTPS was detected                                    | invalid certificate (`tls.valid: false`), or served over http with https not answering                                                                                                                                               |
| `outdated_platform`    | An old platform version string was detected                      | `<meta name="generator">`: WordPress before 5, Joomla before 3, Drupal before 8, TYPO3 before 9, FrontPage and similar. `observedValue` is the generator string exactly as observed; no other claim is made. No generator: `unknown` |
| `missing_seo_metadata` | No complete basic SEO metadata was detected                      | home page `<title>` and meta description                                                                                                                                                                                             |

Labels for `no` and `unknown` are observations too ("A contact form was detected", "Booking could not be checked"). Copy never says a business "has no" feature: pages rendered by JavaScript, external stylesheets and pages that were not fetched are invisible to the analysis. Opportunities (`website_rebuild`, `mobile_friendly_site`, `contact_form`, `online_booking`, `online_ordering`, `whatsapp_click_to_chat`, `https_setup`, `platform_update`, `seo_basics`) are one per detection observed `yes`, sorted by confidence, each linking to its detection through `detectionKeys`.

Failures release the credit: `ROBOTS_DISALLOWED` (robots.txt forbids the home page; `robots.allowed: false`), `ADDRESS_NOT_ALLOWED` and `URL_NOT_ALLOWED` (the site resolves to a private or reserved address, or uses a refused port), `CONTENT_TYPE_NOT_ALLOWED`, `TOO_LARGE`, `ACCESS_REVOKED` (the requester lost `analysis:run`), `BUSINESS_GONE` (merged or deleted), `SUPPRESSED`, `ANALYSIS_TIMEOUT` (running over 30 minutes; reconciliation), `ANALYSIS_ERROR` (failed on our side after 3 attempts), `ENQUEUE_FAILED`. An unreachable website is a completed analysis (it is the finding) and is charged.

Bulk: when every analysis of a bulk request has finished, the requester gets one in-app notification `analysis.bulk_completed` ("Website analysis of N businesses finished"; body with completed and failed counts; `href` `/app/analysis?batchId=<id>`).

### Enrichment and refresh (shipped in Phase 4)

| Method | Path                                          | Permission        | Body or query                              | Returns                                     |
| ------ | --------------------------------------------- | ----------------- | ------------------------------------------ | ------------------------------------------- |
| POST   | `/enrichment/businesses/:id/website-contacts` | `analysis:run`    | none                                       | `202 EnrichmentRun`                         |
| POST   | `/enrichment/businesses/:id/check-email`      | `analysis:run`    | `{ address }` (an address on the business) | `202 EnrichmentRun`                         |
| POST   | `/businesses/:id/refresh`                     | `analysis:run`    | none                                       | `202 RefreshResponse`                       |
| GET    | `/enrichment/runs/:id`                        | `businesses:read` | none                                       | `200 EnrichmentRun` (poll this)             |
| GET    | `/businesses/:id/enrichment-runs`             | `businesses:read` | `kind[]?, status[]?, cursor?, pageSize?`   | `200` page of `EnrichmentRun`, newest first |

Enrichment is free (no credits) and rate limited to 600 runs per hour per organization (`429 RATE_LIMITED`). A business has at most one queued or running run per kind; asking again returns it.

`website-contacts` crawls the business's own website through SafeFetch (home, then its contact and about pages; at most 3 pages), extracts `mailto:`, `tel:`, WhatsApp (`wa.me`, `api.whatsapp.com`, `whatsapp:`) and social profile links, plus a number written right after an explicit "WhatsApp" label, and records each value as a `website` observation with evidence. Then:

- a phone is set `verified` when it is valid for its numbering plan and was found on the business's own site (`output.ownSite`: the home page ended on the business's website domain); verification event `website_presence: passed`;
- WhatsApp becomes `confirmed` on that phone from an explicit link or label on the own site; event `whatsapp_link` or `whatsapp_label`, and `whatsapp.evidenceObservationId` points at the observation;
- emails found, plus emails on the business never checked (up to 10), are checked: events `email_syntax`, `email_mx`, `email_disposable`, and `emails[].verification = { method: "syntax_mx_disposable", result, checkedAt }`. Emails stay `unverified` (no mailbox probing in release 1; the UI says "Mailbox not confirmed").

Plain phone numbers in page text are not collected; nothing is inferred. A new value that matches a suppression entry suppresses the business.

`check-email` runs the three email checks for one address already on the business (`400 VALIDATION_FAILED` on `address` otherwise).

`EnrichmentRun`:

```json
{
  "id": "...",
  "businessId": "...",
  "kind": "website_contacts",
  "status": "completed",
  "trigger": "manual",
  "input": { "url": "https://mamaput.example.test", "address": null },
  "output": {
    "pagesVisited": [{ "url": "https://mamaput.example.test/", "status": 200, "error": null }],
    "observationIds": ["..."],
    "found": { "phones": 2, "emails": 2, "socials": 1, "whatsapp": 2 },
    "phonesVerified": 2,
    "whatsappConfirmed": 2,
    "emailChecks": [
      { "address": "hello@mamaput.example.test", "result": "mx_found" },
      { "address": "orders@mailinator.com", "result": "disposable" }
    ],
    "ownSite": true
  },
  "error": null,
  "requestedByUserId": "...",
  "createdAt": "...",
  "startedAt": "...",
  "finishedAt": "..."
}
```

`emailChecks[].result`: `mx_found`, `no_mx`, `disposable`, `invalid_syntax`, `dns_error`. Failure codes: `WEBSITE_MISSING`, `SUPPRESSED`, `BUSINESS_GONE`, `ACCESS_REVOKED`, `EMAIL_NOT_ON_BUSINESS`, any SafeFetch code for the home page (`ROBOTS_DISALLOWED`, `DNS_FAILED`, `CONNECTION_FAILED`, `TIMEOUT`, `TLS_INVALID`, `ADDRESS_NOT_ALLOWED`, `HTTP_STATUS`...), `RUN_TIMEOUT`, `ENRICHMENT_ERROR`. Poll `GET /enrichment/runs/:id` every 2 seconds while `queued` or `running`.

Refresh re-collects contacts and re-analyzes the website: it requests an analysis (1 credit held, or the analysis already in progress) and a website-contacts run. `RefreshResponse`: `{ enrichmentRun: EnrichmentRun, analysis: WebsiteAnalysis, analysisAlreadyInProgress: boolean }`. Errors: `422 WEBSITE_MISSING`, `402 INSUFFICIENT_CREDITS` (nothing is queued), `409 CONFLICT` (suppressed), `404`. Audit: `business.refresh_requested`, `enrichment.requested`. Field states `stale` and `expired` (section "Field model") tell the UI when to offer Refresh.

### Scoring (shipped in Phase 4)

| Method | Path                    | Permission                        | Body                          | Returns                                                               |
| ------ | ----------------------- | --------------------------------- | ----------------------------- | --------------------------------------------------------------------- |
| GET    | `/scoring/profile`      | `businesses:read`                 | none                          | `200 ScoringProfile` (created with the default weights on first read) |
| PATCH  | `/scoring/profile`      | `settings:scoring` (owner, admin) | `{ version, weights?, icp? }` | `200 ScoringProfile` (recompute queued)                               |
| POST   | `/scoring/recompute`    | `settings:scoring`                | none                          | `202 ScoringProfile` (recompute queued)                               |
| GET    | `/businesses/:id/score` | `businesses:read`                 | none                          | `200 ScoreSnapshot` or `{ data: null }` before the first score        |

One default profile per organization. `weights`: the seven signals `contactCompleteness`, `contactVerification`, `websiteOpportunity`, `industryMatch`, `locationMatch`, `freshness`, `sourceReliability`, whole numbers 0 to 100 that add up to exactly 100 (defaults 20, 15, 20, 15, 15, 10, 5). `icp`: `{ categories: [label] (max 50, case-insensitive, duplicates collapse), locations: [{ country?, region?, locality? }] (max 50; each needs one part; every given part must match) }`. `version` must be the version the editor loaded: a different current version is `409 CONFLICT`. Errors: `400 VALIDATION_FAILED` (`weights` with "Weights must add up to 100 (they add up to N)", `weights.<signal>` for range or whole-number errors), `409 CONFLICT`, `403 FORBIDDEN`. Audit: `scoring.profile_updated` (weights and ICP before and after), `scoring.recompute_requested`.

`ScoringProfile`: `{ id, name: "Default", isDefault: true, weights, icp: { categories, locations: [{ country, region, locality }] }, version, recompute: { status: "idle" | "queued" | "running" | "completed" | "failed", profileVersion, processed, total, requestedAt, startedAt, finishedAt, error }, updatedByUserId, createdAt, updatedAt }`. After saving, poll `GET /scoring/profile` every 2 seconds until `recompute.status` is `completed` (or `failed`) for `recompute.profileVersion === version`.

Scores are also recomputed for businesses whose data changes (imports, discovery, corrections, enrichment, analyses, merges; queue `scoring`) and refreshed daily (freshness follows the calendar).

`ScoreSnapshot` (also `BusinessDetail.score`; the list returns `score: { fit, dataConfidence }`):

```json
{
  "fit": 66,
  "dataConfidence": 48,
  "computedAt": "...",
  "profileId": "...",
  "profileVersion": 2,
  "breakdown": [
    {
      "signal": "contactCompleteness",
      "label": "Contact completeness",
      "weight": 20,
      "value": 1,
      "points": 20,
      "detail": "4 of 4 present: phone, email, website and address"
    },
    {
      "signal": "contactVerification",
      "label": "Contact verification",
      "weight": 15,
      "value": 0.25,
      "points": 3.75,
      "detail": "1 of 4 present fields verified (phone)"
    },
    {
      "signal": "websiteOpportunity",
      "label": "Website opportunity",
      "weight": 20,
      "value": 0.67,
      "points": 13.4,
      "detail": "2 opportunities with confidence of at least 0.7 in the website analysis of 2026-10-25: contact_form and online_booking"
    },
    {
      "signal": "industryMatch",
      "label": "Industry match",
      "weight": 15,
      "value": 1,
      "points": 15,
      "detail": "Category Restaurant is in your ICP"
    },
    {
      "signal": "locationMatch",
      "label": "Location match",
      "weight": 15,
      "value": 0,
      "points": 0,
      "detail": "Location is outside your ICP locations"
    },
    {
      "signal": "freshness",
      "label": "Freshness",
      "weight": 10,
      "value": 1,
      "points": 10,
      "detail": "Last observed or verified 3 days ago (freshness window 180 days)"
    },
    {
      "signal": "sourceReliability",
      "label": "Source reliability",
      "weight": 5,
      "value": 0.7,
      "points": 3.5,
      "detail": "Most reliable source: website (trust 0.7)"
    }
  ],
  "dataConfidenceDetail": {
    "basis": "Average over name, website, phone, email and address of ...",
    "fields": [{ "field": "phone", "state": "verified", "confidence": 0.7, "quality": 0.7 }]
  },
  "summary": "Fit 66 of 100 from contact completeness (20 of 20), industry match (15 of 15), ...",
  "explanation": "Score reflects fit with your configured criteria. It is not a prediction of purchase intent."
}
```

Fit = round(sum of weight x value), with each value rounded to 2 decimals first; `points` is weight x value rounded to 2 decimals for display. The example's points add up to 65.65, so fit is 66 (corrected in Phase 6: the example used to say 64). Because only the total is rounded to a whole number, fit can differ from the sum of the displayed points by less than 1. Signals: completeness = present of phone, email, website, address / 4; verification = share of present fields whose best state is `verified` (in release 1 only phones can be verified); website opportunity = opportunities with confidence of at least 0.7 in the latest completed analysis, 3 or more give 1; industry and location match = 1 when a business category or its location matches the ICP (0 with no ICP configured); freshness = 1 up to 30 days since the last observation or verification, falling linearly to 0 at the organization's freshness window; source reliability = trust of the most reliable source (user edit 0.8, Google Places 0.8, website 0.7, import 0.6). **Data confidence** is a separate number: the average over name, website, phone, email and address of confidence times a state factor (verified 1, unverified 0.8, stale 0.5, conflicting 0.4, missing or expired 0). It is never added to, multiplied into or shown as part of the fit score. Always show `explanation` with the score.

### Duplicate review (shipped in Phase 4)

| Method | Path                           | Permission                                                                 | Body or query                                                                                 | Returns                                                     |
| ------ | ------------------------------ | -------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| GET    | `/dedup/candidates`            | `businesses:read`                                                          | `status[]?` (default `pending`), `businessId?`, `minScore?`, `cursor?`, `pageSize?`           | `200` page of `DuplicateCandidate`, highest score first     |
| GET    | `/dedup/candidates/:id`        | `businesses:read`                                                          | none                                                                                          | `200 DuplicateCandidate`                                    |
| POST   | `/dedup/candidates/:id/merge`  | `dedup:write` (owner, admin, researcher)                                   | `MergeRequest`                                                                                | `200 { merge: MergeRecord, candidate: DuplicateCandidate }` |
| POST   | `/dedup/candidates/:id/reject` | `dedup:write`                                                              | none                                                                                          | `200 DuplicateCandidate` (`rejected`; never proposed again) |
| POST   | `/dedup/candidates/:id/defer`  | `dedup:write`                                                              | none                                                                                          | `200 DuplicateCandidate` (`deferred`)                       |
| GET    | `/dedup/merges`                | `businesses:read`                                                          | `businessId?` (survivor or merged), `status[]?` (`applied`, `undone`), `cursor?`, `pageSize?` | `200` page of `MergeRecord`, newest first                   |
| GET    | `/dedup/merges/:id`            | `businesses:read`                                                          | none                                                                                          | `200 MergeRecord`                                           |
| POST   | `/dedup/merges/:id/undo`       | `dedup:write`, and owner or admin, or the person who merged within 30 days | `{ force?: boolean }`                                                                         | `200 MergeRecord` (`undone`)                                |
| POST   | `/dedup/scan`                  | `dedup:write`                                                              | `{ businessIds?: [1..500] }`                                                                  | `202 { queued, scope: "businesses"                          | "organization", businesses }` |

Candidates are found by the worker after every import, discovery page, correction, enrichment and merge (queue `dedup`), and on request with `/dedup/scan`. A pair is proposed only with corroboration beyond the name: a shared phone, email or website domain (name similarity of at least 0.5), or the same locality or LGA (similarity of at least 0.85). A name match alone, however close, is never proposed, and nothing is ever merged without a reviewer.

`DuplicateCandidate`:

```json
{
  "id": "...",
  "businessIds": ["<a>", "<b>"],
  "businesses": [
    {
      "id": "<a>",
      "name": "Mama Put Kitchen (Sample)",
      "nameState": "unverified",
      "categories": ["Restaurant"],
      "location": {
        "formatted": "Ikeja, Lagos, Nigeria",
        "locality": "Ikeja",
        "lga": null,
        "region": "Lagos"
      },
      "website": "https://mamaput.example.test",
      "phones": ["+2348031112222"],
      "emails": [],
      "sources": ["user_import"],
      "suppressed": false,
      "live": true,
      "createdAt": "..."
    },
    { "id": "<b>", "...": "..." }
  ],
  "stage": "name_location",
  "score": 0.84,
  "signals": [
    {
      "kind": "name_similarity",
      "aValue": "Mama Put Kitchen (Sample)",
      "bValue": "Mama Put Kitchens (Sample)",
      "similarity": 0.99
    },
    { "kind": "same_locality", "aValue": "Ikeja", "bValue": "Ikeja", "similarity": 1 }
  ],
  "reasons": [
    "Both are in Ikeja",
    "Names are 99% similar (\"Mama Put Kitchen (Sample)\" and \"Mama Put Kitchens (Sample)\")"
  ],
  "status": "pending",
  "decidedByUserId": null,
  "decidedAt": null,
  "mergeId": null,
  "createdAt": "...",
  "updatedAt": "..."
}
```

`businesses[]` is `CandidateBusiness`: `{ id, name, nameState, categories, location, website, phones (E.164), phonesDisplay: [{ e164, international }] (Phase 6, backlog 11: the same numbers in display format, e.g. "+234 803 111 2222", in the same order), emails, sources, suppressed, live, createdAt }`. `stage`: `domain`, `phone`, `email` (the shared identifier) or `name_location`. `status`: `pending`, `deferred`, `merged`, `rejected`, `superseded` (one of its businesses was merged through another candidate; restored on undo). `businesses[].live` is false after a business was merged or deleted.

`MergeRequest`: `{ survivorId, fields?: { name?: "survivor" | "merged", website?: ..., location?: ... } }`. The survivor keeps its id; phones, emails, socials, categories, sources and external references are combined; each of name, website and location comes from the chosen side (default: the survivor's when it has one); a differing website or location from the other side is kept in `alternatives`. The other business disappears from the directory (`404` on its detail) and its provenance is listed with the survivor (`dedup.absorbedIds`). If either side is suppressed the survivor stays suppressed.

`MergeRecord`: `{ id, candidateId, survivorId, mergedIds, survivorName, mergedNames: [{ id, name }], fieldDecisions: [{ field, chosenFrom }], status: "applied" | "undone", performedByUserId, performedAt, undoneAt, undoneByUserId, undoForced, canUndo }` (`canUndo` is for the caller). Phase 6 (backlog 8): `survivorName` and `mergedNames` are the business names at merge time, read from the merge snapshots (null when not stored or expired under source retention), so history needs no extra lookups.

Undo writes both records back exactly as they were before the merge (only their internal version moves forward) and reopens the candidates the merge closed. When either record changed after the merge, undo is `409 MERGE_CONFLICT` unless `force: true`, which restores the snapshots and discards those later changes (their observations stay in provenance).

Errors: `400 VALIDATION_FAILED` (`survivorId` not in the pair), `404 NOT_FOUND`, `409 CONFLICT` (candidate already decided, merge already undone), `409 MERGE_CONFLICT` (a business changed or was merged meanwhile; undo over later changes without `force`), `403 FORBIDDEN` (permission, or undo by someone else than the performer, past 30 days, who is not an owner or admin). Audit: `dedup.merged`, `dedup.merge_undone`, `dedup.candidate_rejected`, `dedup.candidate_deferred`, `dedup.scan_requested`.

### CRM (shipped in Phase 5)

Lead state is kept apart from the business's facts and from its score. Permissions (docs/SECURITY_AND_DATA_COLLECTION.md section 2): every role reads (`businesses:read`); `pipeline:write` (owner, admin, sales rep) moves stages, edits leads and logs activities and outreach; `leads:assign` (owner, admin, researcher) assigns; `lists:manage` (owner, admin, researcher) manages every list and `lists:manage_own` (sales rep) the lists the rep owns; `settings:pipeline` (owner, admin) edits the stages. Members without `leads:assign` (sales reps) work only leads assigned to them: moving, editing, logging activity or outreach on another lead is `403 FORBIDDEN`.

#### Pipeline configuration

| Method | Path               | Permission          | Body or query                                                                                        | Returns                                                    |
| ------ | ------------------ | ------------------- | ---------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| GET    | `/pipeline/config` | `businesses:read`   | none                                                                                                 | `200 PipelineConfig` (default stages created on first use) |
| PUT    | `/pipeline/config` | `settings:pipeline` | `UpdatePipelineConfigRequest`                                                                        | `200 PipelineConfig`                                       |
| GET    | `/pipeline/board`  | `businesses:read`   | `perStage? (1..50, default 20), assignedToUserId?, unassigned?, listId? (Stage 8), includeArchived?` | `200 PipelineBoard`                                        |

`PipelineConfig`: `{ id, version, stages: [{ key, label, kind: "open" | "won" | "lost", order, archived }], entryStageKey, updatedAt, updatedByUserId }`. Defaults: `new` New, `qualified` Qualified, `contacted` Contacted, `interested` Interested, `opportunity` Opportunity, `won` Won (kind won), `lost` Lost (kind lost). New leads enter `entryStageKey`, the first active open stage.

`PUT` body: `{ version, stages: [{ key?, label (1..40), archived? }] (3..20) }` in board order. A stage with `key` is an existing one (rename, move, archive or restore); a stage without `key` is new (its key is derived from the label, e.g. "Proposal sent" becomes `proposal_sent`). Rules, each a `400 VALIDATION_FAILED` with a per-stage path: every existing stage must be listed (archive instead of removing), unknown or repeated keys are refused, won and lost cannot be archived (their kind never changes), at least one active open stage, at most 12 active stages, active labels unique (case-insensitive), a new stage cannot start archived. `409 VERSION_CONFLICT` (details `version` = current) when `version` is stale; `409 STAGE_NOT_EMPTY` (details `stageKey`, `leads`) when a stage being archived still holds leads. Audit `pipeline.config_updated` with the stages before and after.

`PipelineBoard`: `{ config, columns: [{ stage, count, leads: Lead[], nextCursor }] }`, one column per active stage (plus archived stages that hold leads when `includeArchived=true`). Leads in a column are newest activity first; continue a column with `GET /pipeline/leads?stage=<key>&cursor=<nextCursor>` with the same `assignedToUserId`/`unassigned`/`listId` filters. `listId` (Stage 8) keeps only leads of businesses on that list (counts included) and combines with the assignee filters; as everywhere, a list of another organization (or an unknown id) is `404` and a malformed id `400`. Every role may filter by any list of its organization (see "Lead lists", visibility).

#### Leads

| Method | Path                         | Permission                         | Body or query                                                                                                                                                         | Returns                                                                    |
| ------ | ---------------------------- | ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| GET    | `/pipeline/leads`            | `businesses:read`                  | `stage[]?, assignedToUserId?, unassigned?, priority[]?, businessId?, listId?, sort? (updatedAt, createdAt, nextActionAt; default updatedAt:desc), cursor?, pageSize?` | `200` page of `Lead`, `meta.total` on the first page                       |
| GET    | `/pipeline/leads/:id`        | `businesses:read`                  | none                                                                                                                                                                  | `200 Lead`                                                                 |
| POST   | `/pipeline/leads`            | `pipeline:write` or `leads:assign` | `{ businessId, stageKey?, assignedToUserId?, priority? }`                                                                                                             | `201 Lead`; `200` with the existing lead when the business already has one |
| POST   | `/pipeline/leads/:id/move`   | `pipeline:write`                   | `{ stageKey } or { direction: "next" or "previous" }`, `version?`, `lostReason?`, `wonValueMinor?`, `currency?`                                                       | `200 Lead`                                                                 |
| PATCH  | `/pipeline/leads/:id`        | `pipeline:write`                   | `{ version?, priority?, nextActionAt?, lostReason?, wonValueMinor?, currency? }`                                                                                      | `200 Lead`                                                                 |
| POST   | `/pipeline/leads/:id/assign` | `leads:assign`                     | `{ assignedToUserId: uuid or null, version? }`                                                                                                                        | `200 Lead`                                                                 |

`Lead`: `{ id, businessId, business: { id, name, nameState, categories (3), locality, region, fit, dataConfidence, suppressed } | null, stageKey, stageKind, stageEnteredAt, assignedToUserId, priority: "low" | "medium" | "high" | null, nextActionAt, lastActivityAt, lostReason, wonValueMinor, currency, closedAt, version, createdByUserId, createdAt, updatedAt }`. One lead per business per organization. `closedAt` is set while the lead is in the won or lost stage. `lastActivityAt` is the latest logged activity; it does not change `version`.

Create: owners and admins may set the stage and the assignee; researchers may assign but a `stageKey` is `403`; a sales rep's lead is assigned to the rep (`assignedToUserId` of someone else is `403`). A suppressed business is `409 CONFLICT`. Writes a `stage_change` activity (from `null`) and, when assigned, an `assignment` activity; audit `lead.created`.

Move (keyboard-safe): one atomic, version-checked write. With `version`, a lead that changed since it was read is `409 VERSION_CONFLICT` (details `version` = current), so the UI refetches and retries. Without `version`, the move applies to the current state: `direction: next` from wherever the lead is when the write lands (two quick presses move two stages). Moving into the current stage returns the lead unchanged. Unknown or archived stage, or no next/previous stage, is `400` (paths `stageKey`, `direction`). Writes a `stage_change` activity; audit `lead.stage_changed`. Keyboard pattern: keep the lead's `version`; on `ArrowRight` send `{ direction: "next", version }`; on 409 refetch the lead (or the board column) and retry once.

Assign: the assignee must be an active owner, admin or sales rep of the organization, else `422 INVALID_ASSIGNEE` (details `assignedToUserId`). Writes an `assignment` activity, notifies the assignee in-app (`lead.assigned`) and by email unless their `emailAssignments` preference is off (no notice when assigning to yourself); audit `lead.assigned`. Edits: audit `lead.updated` with the changed fields.

#### Lead lists

| Method | Path                           | Permission                           | Body or query                                                                                                               | Returns                                               |
| ------ | ------------------------------ | ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| GET    | `/lists`                       | `businesses:read`                    | `q? (name prefix), ownerUserId?, businessId? (lists containing it), sort? (name, updatedAt, createdAt), cursor?, pageSize?` | `200` page of `LeadList`                              |
| POST   | `/lists`                       | `lists:manage` or `lists:manage_own` | `{ name (1..80), description?, ownerUserId? }`                                                                              | `201 LeadList`                                        |
| GET    | `/lists/:id`                   | `businesses:read`                    | none                                                                                                                        | `200 LeadList`                                        |
| PATCH  | `/lists/:id`                   | `lists:manage` or own list           | `{ name?, description?, ownerUserId? (managers only) }`                                                                     | `200 LeadList`                                        |
| DELETE | `/lists/:id`                   | `lists:manage` or own list           | none                                                                                                                        | `200 { deleted: true, items }` (businesses untouched) |
| GET    | `/lists/:id/items`             | `businesses:read`                    | `cursor?, pageSize?`                                                                                                        | `200` page of `LeadListItem`, newest first            |
| POST   | `/lists/:id/items`             | `lists:manage` or own list           | `{ businessIds (1..100) }`                                                                                                  | `200 ListItemsResult`                                 |
| POST   | `/lists/:id/items/remove`      | `lists:manage` or own list           | `{ businessIds (1..100) }`                                                                                                  | `200 ListItemsResult`                                 |
| DELETE | `/lists/:id/items/:businessId` | `lists:manage` or own list           | none                                                                                                                        | `200 ListItemsResult`                                 |

Visibility (Stage 8, written out after a security check; the behaviour did not change): **every role reads every list of its organization**, because the role matrix (docs/SECURITY_AND_DATA_COLLECTION.md section 2) gives all five roles "View businesses, lists, pipeline, reports". `GET /lists`, `GET /lists/:id`, `GET /lists/:id/items`, `GET /pipeline/board?listId=`, `GET /pipeline/leads?listId=`, `GET /activities?listId=` and `GET /outreach?listId=` therefore answer a sales representative for any list of the organization (another organization's list is `404` for everyone). What the matrix limits, the server enforces: a sales representative changes only lists they own (rename, describe, hand over, delete, add and remove items, and bulk `add_to_list`/`remove_from_list`; anything else is `403`), works only leads assigned to them (bulk `move_stage` reports other leads as `not_assigned_to_you`), and exports only businesses whose lead is assigned to them, whichever list is exported (`scope: "assigned"`). The lists a rep owns are `GET /lists?ownerUserId=<their id>` (created by them or handed to them); a "my lists" view in the UI is that filter, a convenience rather than the access boundary. The business data on a list is directory data every role can already read. Tested in `apps/api/test/phase5-access.test.ts` ("Lead list visibility for sales representatives").

`LeadList`: `{ id, name, description, ownerUserId, itemCount, createdByUserId, createdAt, updatedAt }`. Names are unique per organization, case-insensitively (`409 CONFLICT`). A sales rep's lists are the ones they own (created by them, or handed to them by a manager through `ownerUserId`); they cannot hand a list to someone else. `LeadListItem`: `{ businessId, addedAt, addedByUserId, business: BusinessListItem | null, lead: { id, stageKey, stageKind, assignedToUserId } | null }`. `ListItemsResult`: `{ list, results: [{ businessId, outcome }], summary: { requested, changed, unchanged, notFound, suppressed, listFull } }` with outcomes `added`, `already_in_list`, `removed`, `not_in_list`, `not_found`, `suppressed` (suppressed businesses are not added), `list_full` (10,000 businesses per list). Item counts are recounted after every change. Larger selections use bulk operations. Audit `list.created`, `list.updated`, `list.deleted`, `list.items_added`, `list.items_removed`.

#### Activities

| Method | Path              | Permission                              | Body or query                                                                                                      | Returns                                              |
| ------ | ----------------- | --------------------------------------- | ------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------- |
| GET    | `/activities`     | `businesses:read`                       | `type[]?, userId? (author), businessId?, leadId?, listId?, from?, to? (occurredAt, inclusive), cursor?, pageSize?` | `200` page of `Activity`, newest `occurredAt` first  |
| GET    | `/activities/:id` | `businesses:read`                       | none                                                                                                               | `200 Activity`                                       |
| POST   | `/activities`     | `pipeline:write`                        | `CreateActivityRequest`                                                                                            | `201 { activity, outreach: OutreachRecord or null }` |
| PATCH  | `/activities/:id` | `pipeline:write`, author or owner/admin | `{ body?, outcome?, occurredAt? }`                                                                                 | `200 Activity`                                       |
| DELETE | `/activities/:id` | `pipeline:write`, author or owner/admin | none                                                                                                               | `200 { deleted: true }`                              |

`Activity`: `{ id, type: "note" | "call" | "whatsapp" | "email" | "meeting" | "stage_change" | "assignment", businessId, business: { id, name, nameState } | null, leadId, outreachId, direction: "outbound" | "inbound" | null, outcome, body, target, occurredAt, authorUserId, stageChange: { fromStageKey, toStageKey } | null, assignment: { fromUserId, toUserId } | null, suppressionOverride: { reason } | null, editedAt, createdAt }`. `stage_change` and `assignment` are written by the system and cannot be edited or deleted (`409 CONFLICT`). Render `body` as text.

`CreateActivityRequest`: `{ businessId, type: note | call | whatsapp | email | meeting, body? (notes require it, at most 5,000), outcome?, direction? (calls, WhatsApp, email; default outbound), occurredAt? (default now; at most 5 minutes ahead), target? (phone for calls and WhatsApp, normalized to E.164; address for email), suppressionOverride?: { reason (10..500) } }`. Outcomes per type (`ACTIVITY_OUTCOMES`): calls `connected, no_answer, busy, voicemail, wrong_number`; WhatsApp `sent, delivered, read, replied, failed`; email `sent, replied, bounced, failed`; meetings `completed, no_show, rescheduled, cancelled`; any contact also `interested, not_interested, callback_requested, meeting_booked, other`; notes none (`400` on `outcome`). An outbound call, WhatsApp message or email counts an attempt on the business's outreach record for that channel (created on first contact; the response includes it); an inbound one marks an open record `replied`.

Suppression (choice: block, with an audited override): contact activities (call, WhatsApp, email, meeting) and outreach records on a suppressed business, or to a phone number or address on the suppression list, are `409 CONTACT_SUPPRESSED` (details path `suppressionOverride.reason`) unless the request carries `suppressionOverride.reason`. The reason is stored on the activity and outreach record and audited as `contact.suppression_overridden` (for example, the business called in). Notes are always allowed. Edits and deletes are audited (`activity.updated`, `activity.deleted` with the content).

#### Outreach records

| Method | Path                     | Permission        | Body or query                                                                                                  | Returns                                                     |
| ------ | ------------------------ | ----------------- | -------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| GET    | `/outreach`              | `businesses:read` | `channel[]?, status[]?, userId? (owner), businessId?, listId?, from?, to? (lastAttemptAt), cursor?, pageSize?` | `200` page of `OutreachRecord`, most recently updated first |
| GET    | `/outreach/:id`          | `businesses:read` | none                                                                                                           | `200 OutreachRecord`                                        |
| POST   | `/outreach`              | `pipeline:write`  | `{ businessId, channel: call                                                                                   | whatsapp                                                    | email, target?, nextAttemptAt?, suppressionOverride? }` | `201 OutreachRecord` (`200` with the existing record for that business and channel) |
| PATCH  | `/outreach/:id`          | `pipeline:write`  | `{ version?, status?, nextAttemptAt?, target? }`                                                               | `200 OutreachRecord`                                        |
| POST   | `/outreach/:id/attempts` | `pipeline:write`  | `{ outcome?, body?, occurredAt?, target?, suppressionOverride? }`                                              | `201 { outreach, activity }`                                |

`OutreachRecord`: `{ id, businessId, business, leadId, channel, target, status: planned | in_progress | replied | no_response | not_interested | converted | opted_out | closed, attempts, lastAttemptAt, lastOutcome, nextAttemptAt, ownerUserId, suppressionOverride: { reason, byUserId, at } | null, version, createdAt, updatedAt }`. One record per business and channel. Status after an outbound attempt: `planned` becomes `in_progress`; outcomes `replied`, `interested`, `callback_requested`, `meeting_booked` set `replied`; `not_interested` sets `not_interested`; other statuses are set by `PATCH` (stale `version` is `409 VERSION_CONFLICT`). Recording `opted_out` does not suppress the business; suppress it through `POST /businesses/:id/suppress`.

### Bulk operations (shipped in Phase 5)

| Method | Path                         | Permission                                                                                    | Body or query                              | Returns                                                                                                                           |
| ------ | ---------------------------- | --------------------------------------------------------------------------------------------- | ------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------- |
| POST   | `/bulk-operations/preview`   | any of `lists:manage`, `lists:manage_own`, `leads:assign`, `pipeline:write` (then per action) | `BulkOperationRequest`                     | `200 BulkPreview` (nothing written)                                                                                               |
| POST   | `/bulk-operations`           | same; `Idempotency-Key` header required (8..128)                                              | `BulkOperationRequest`                     | `202 BulkOperation` (`200` on a replay of the same key and body)                                                                  |
| GET    | `/bulk-operations`           | `businesses:read`                                                                             | `status[]?, action[]?, cursor?, pageSize?` | `200` page of `BulkOperation`                                                                                                     |
| GET    | `/bulk-operations/:id`       | `businesses:read`                                                                             | none                                       | `200 BulkOperation`                                                                                                               |
| GET    | `/bulk-operations/:id/items` | `businesses:read`                                                                             | `outcome[]?, cursor?, pageSize?`           | `200` page of `BulkOperationItem` `{ businessId, businessName, businessNameState, outcome, message, processedAt }` (kept 30 days) |

`BulkOperationRequest` (discriminated by `action`): `{ action: "add_to_list" | "remove_from_list", listId, selection }` (`lists:manage`, or `lists:manage_own` on an own list), `{ action: "assign", assignedToUserId: uuid | null, selection }` (`leads:assign`; businesses without a lead get one in the entry stage), `{ action: "move_stage", stageKey, selection }` (`pipeline:write`; existing leads only; sales reps only leads assigned to them). `selection` is `{ ids: ObjectId[] (1..1000) }` or `{ filter: BusinessListFilter }` (the directory query fields, as JSON), never both.

Flow for the UI: preview, then confirm, then poll.

1. `POST /bulk-operations/preview` returns `{ action, matched, cap: 5000, overCap, willChange, breakdown: [{ outcome, count }] }`. Show "N businesses will change" from `willChange` and the breakdown; when `overCap` is true, confirming would be `422 BULK_LIMIT_EXCEEDED`.
2. `POST /bulk-operations` with a fresh `Idempotency-Key` per confirmation. The selection is resolved now and frozen (`progress.total`), so a retry never picks up new rows.
3. Poll `GET /bulk-operations/:id` every 1 to 2 s while `status` is `queued` or `running`; show `progress.percent`. Final status `completed`, `completed_with_errors` (some items `failed`) or `failed` (`error.code`: `ACCESS_REVOKED`, `LIST_DELETED`, `TIMED_OUT`, `BULK_ERROR`).

`BulkOperationItem` (Stage 8 added `businessName` and `businessNameState`; optional in the schema, always sent by the API): the business's current name and its field state as in directory rows (`states.name`), read with each page rather than stored on the item, so corrections show at once and a name whose source retention has passed is `null` with state `expired`, as everywhere. An id that is not a business of the organization (an `ids` selection naming another organization's or an unknown business; outcome `not_found`) has `businessName: null` and `businessNameState: null`; a business merged away since the selection keeps its last name. The join costs one projected, organization-scoped `_id` lookup per page (at most `pageSize` ids). Storing a copy on up to 5,000 items per operation would have made every item write heavier and kept names outside the business record, beyond the reach of retention purges, corrections and merges.

`BulkOperation`: `{ id, action, params: { listId, assignedToUserId, stageKey }, status, selection: { kind: "ids" | "filter", filter }, progress: { total, processed, changed, unchanged, skipped, failed, percent }, breakdown, error, requestedByUserId, createdAt, startedAt, finishedAt }`. Item outcomes: `added`, `removed`, `assigned`, `created_and_assigned`, `moved` (changed); `unchanged`; `not_found`, `suppressed`, `not_in_pipeline`, `not_assigned_to_you`, `list_full` (skipped); `failed`. Errors: `400 VALIDATION_FAILED` (missing key, empty selection, unknown or archived stage), `403`, `404` (list), `409 CONFLICT` (key reused with another body), `422 BULK_LIMIT_EXCEEDED` (details `selection.matched`, `selection.cap`), `422 INVALID_ASSIGNEE`. The worker re-checks the requester's membership and permission before running. Notifications: the requester gets `bulk.completed`, `bulk.completed_with_errors` or `bulk.failed`; an assignee gets one `lead.assigned` ("N leads were assigned to you") per operation. Audit `bulk.requested`, `bulk.finished`. Operations appear in `GET /jobs` as kind `bulk` (`href` `/app/jobs/bulk/<id>`).

### Exports, asynchronous (shipped in Phase 5)

| Method | Path                                    | Permission                                                                | Body or query                   | Returns                                                                                                      |
| ------ | --------------------------------------- | ------------------------------------------------------------------------- | ------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| POST   | `/exports`                              | `exports:create` or `exports:create_assigned`; optional `Idempotency-Key` | `CreateExportRequest`           | `202 ExportJob` (`200` on a replay)                                                                          |
| GET    | `/exports`                              | same                                                                      | `status[]?, cursor?, pageSize?` | `200` page of `ExportJob` (owners and admins: all; others: their own)                                        |
| GET    | `/exports/:id`                          | same, visible exports only                                                | none                            | `200 ExportJob`                                                                                              |
| GET    | `/exports/:id/download-url`             | same, visible exports only                                                | none                            | `200 { url, expiresAt }`                                                                                     |
| GET    | `/exports/:id/download?org&expires&sig` | signed in (no organization header)                                        | signed query                    | `200 application/zip`; `303` for a browser navigation that fails (Stage 8) or is signed out (Stage 9), below |

`CreateExportRequest`: `{ kind: "directory", filter?: BusinessListFilter, columns? }`, `{ kind: "list", listId, columns? }` or `{ kind: "selection", ids (1..5000), columns? }`. Columns as for the synchronous export (default all). Rate limit 10 per hour per user. Sales reps (`exports:create_assigned`) get only businesses whose lead is assigned to them, whatever the selection (`scope: "assigned"`); suppressed businesses are never exported.

Row cap: the organization's `export_row_cap` entitlement (an `override` row wins over a `plan` row; Phase 6 derives them from plans), else `EXPORT_DEFAULT_ROW_CAP` (10,000). A selection matching more is `422 EXPORT_TOO_LARGE` with details `rowCap` and `matched`. If more rows match when the worker builds the file, it stops at the cap and sets `truncated: true`.

`ExportJob`: `{ id, kind, status: queued | running | completed | failed | expired, format: "zip", scope: "all" | "assigned", selection: { listId, listName, idsCount, filter }, columns, rowCap, matchedAtRequest, rowCount, truncated, progress: { processed, total }, file: { name, bytes, sha256, expiresAt, available, licenses[] } | null, error, requestedByUserId, createdAt, startedAt, finishedAt }`.

The ZIP holds `leadforge-<kind>-<timestamp>.csv` (UTF-8 with BOM, CRLF, formula cells prefixed with `'`, E.164 numbers left as is), `ATTRIBUTION.txt` (selection, scope, sources, the attribution lines of every dataset in the file, LeadForge's changes, the disclaimer and the public licences URL) and, when rows carry open data, `LICENSES/<id>.txt` for each licence that applies (CDLA-Permissive-2.0, Apache-2.0, ODbL-1.0, CC-BY-4.0, CC0-1.0) plus `LICENSES/FOURSQUARE-NOTICE.txt` for Foursquare records. `file.licenses` lists the bundled licences.

Flow for the UI: create, then poll, then download.

1. `POST /exports` (202).
2. Poll `GET /exports/:id` every 2 s while `queued` or `running` (`progress.processed` of `progress.total`).
3. On `completed`, call `GET /exports/:id/download-url` and navigate the browser to `url` (a plain GET with cookies; no headers). The link is valid 15 minutes (`EXPORT_DOWNLOAD_URL_TTL_SECONDS`) and is bound to the signed-in user, the organization and the export. Request a new link for each download.

Download checks, in order: signature (`403 DOWNLOAD_LINK_INVALID` when tampered with, or issued to another user or organization), expiry (`410 DOWNLOAD_LINK_EXPIRED`), current membership (`403 ORG_FORBIDDEN`) and export permission (`403 FORBIDDEN`), visibility (`404`), file state (`409 EXPORT_NOT_READY` while queued, running or failed; `410 EXPORT_EXPIRED` after the 7-day retention, `EXPORT_FILE_TTL_HOURS`). The same `EXPORT_NOT_READY` and `EXPORT_EXPIRED` apply to `download-url`. The maintenance queue deletes expired files and marks the export `expired`.

Failed links opened by a browser (Stage 8): when the request is a navigation (`Sec-Fetch-Mode: navigate`, or, from browsers without Fetch Metadata, an `Accept` header that prefers `text/html` over `application/json`) and the download fails with `DOWNLOAD_LINK_INVALID`, `DOWNLOAD_LINK_EXPIRED`, `EXPORT_EXPIRED` or `EXPORT_NOT_READY` (`EXPORT_DOWNLOAD_ERROR_CODES`), the answer is `303 See Other` with `Location: <APP_URL>/app/jobs/exports/<id>?downloadError=<code>` and `Cache-Control: no-store` instead of the JSON error. A link whose query fails validation (signature cut off, edited by hand) counts as `DOWNLOAD_LINK_INVALID`. The location is built only from `APP_URL` (the origin already used for email links), the export id after validation (lowercased) and the fixed code, never from the request's host, forwarding headers, referrer or query, so it cannot serve as an open redirect. Signed-out navigations (Stage 9): a navigation refused with `401 UNAUTHENTICATED` (no access cookie) or `401 TOKEN_EXPIRED` (the access token ran out; a navigation cannot refresh it) gets `303 See Other` with `Location: <APP_URL>/sign-in?next=/app/jobs/exports/<id>` and `Cache-Control: no-store`, built the same way (`APP_URL`, the fixed path, the validated lowercased id), so after signing in the web app returns the user to the export page, where a fresh link can be requested. The guard refuses before the export is looked up, so the redirect says nothing about whether the export exists. Everything else keeps the JSON envelope: requests that are not navigations (no `Accept`, `*/*`, `application/json`, `fetch()` with `Sec-Fetch-Mode: cors`), including signed-out ones (`401`), a malformed export id (`400`, or `401` when signed out: there is no page to return to), and `ORG_FORBIDDEN`, `FORBIDDEN` or `404`, where the export page could not help. The web app reads `downloadError` on the export page. The error counters (`/metrics`) still count the original code and status. Audit `export.requested`, `export.finished` (system), `export.downloaded`. Notifications `export.completed` and `export.failed` go to the requester (`href` `/app/jobs/exports/<id>`). Exports appear in `GET /jobs` as kind `export` for their requester and for owners and admins.

### Credits (shipped in Phase 3)

| Method | Path               | Permission                                       | Query                                                            | Returns                                         |
| ------ | ------------------ | ------------------------------------------------ | ---------------------------------------------------------------- | ----------------------------------------------- |
| GET    | `/credits/balance` | `businesses:read`                                | none                                                             | `200 { balance, held, openHolds, updatedAt }`   |
| GET    | `/credits/ledger`  | `usage:read` (owner, admin, researcher, analyst) | `entryType[]?, referenceType?, referenceId?, cursor?, pageSize?` | `200` page of `CreditLedgerEntry`, newest first |

`balance` is spendable now; credits held by queued or running jobs are already subtracted and shown in `held` (`openHolds` holds). `CreditLedgerEntry`: `{ id, entryType: "grant" | "purchase" | "hold" | "capture" | "release" | "adjustment" | "refund_reversal" | "expiry", units (signed), capturedUnits (capture rows only), balanceAfter, referenceType ("discovery_job", "website_analysis"), referenceId (job or analysis id), referenceName, holdId, description, actorUserId, createdAt }`. A hold is `units: -h`; a capture is `units: 0` with `capturedUnits: n`; a release is `units: +(h - n)`. Phase 5: `referenceName` names what the entry belongs to (the discovery job name, "<name> (retry n)" for a retry round, "Website analysis: <host>"), copied from the hold to its capture and release; it is null for entries written before Phase 5 (typed optional so older clients compile). A fully captured hold no longer gets a 0-unit release row: the capture closes the hold, and a release row is written only when units go back. The cursor is the last entry id; a malformed cursor is `400 VALIDATION_FAILED` on `cursor`. Development organizations get a seeded `grant` ("Development grant from the seed script"). Phase 6 adds `purchase` (a credit pack, `referenceType` `payment`, `referenceId` the payment id, `referenceName` the pack), `grant` with `referenceType` `payment` (a plan's included credits for a paid period) and `refund_reversal` (negative; `referenceType` `refund`, credits taken back by a processed refund). The balance can be negative after a `refund_reversal`; new holds are then refused with `402 CREDIT_BALANCE_NEGATIVE`.

### All jobs (shipped in Phase 3)

| Method | Path    | Permission        | Query                                                                                                              | Returns                                  |
| ------ | ------- | ----------------- | ------------------------------------------------------------------------------------------------------------------ | ---------------------------------------- |
| GET    | `/jobs` | `businesses:read` | `kind[]?` (`discovery`, `import`, `analysis`, `enrichment`, `export`, `bulk`), `status[]?`, `cursor?`, `pageSize?` | `200` page of `JobSummary`, newest first |

`JobSummary`: `{ id, kind, name, status, kindStatus, progress: { processed, total, failed }, createdByUserId, createdAt, startedAt, finishedAt, href }`. `status` is normalized across kinds (`draft`, `queued`, `running`, `completed`, `completed_with_warnings`, `failed`, `cancelled`): imports map `uploaded` to `draft`, `processing` to `running` and `completed_with_errors` to `completed_with_warnings`; `kindStatus` keeps the original. `progress.total` is the import row count, `null` for discovery, 1 for analyses and enrichment runs. `href` is the dashboard route (`/app/discovery/<id>`, `/app/businesses?importId=<id>`, `/app/analysis/<id>` for analyses, `/app/businesses/<businessId>` for enrichment runs). Analyses (Phase 4): `name` "Website analysis: <host>", statuses `queued`, `running`, `completed`, `failed`. Enrichment runs (Phase 4): `name` "Website contacts" or "Email check: <address>", `kindStatus` `<kind>:<status>`. Phase 5: exports (`name` "Export of list \"<name>\"", "Export of N selected businesses" or "Export of directory results"; `expired` maps to `completed` with `kindStatus` `expired`; `href` `/app/jobs/exports/<id>`; listed for their requester and for owners and admins) and bulk operations (`name` such as `Add 120 businesses to "Lagos pharmacies"`; `completed_with_errors` maps to `completed_with_warnings`; `progress.total` is the frozen selection; `href` `/app/jobs/bulk/<id>`). The analysis `href` stays `/app/analysis/<id>`.

### Usage and billing

Usage (shipped in Phase 5): see below. Billing (shipped in Phase 6) is PostgreSQL only; MongoDB never stores billing state. Money is always an integer in minor units (kobo for NGN) with an ISO 4217 `currency`. Prices come from the database: the client sends only a plan or pack id, never an amount.

| Method | Path                                  | Permission                            | Body or query                                   | Returns                                                                                                      |
| ------ | ------------------------------------- | ------------------------------------- | ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| GET    | `/usage`                              | `usage:read`                          | `period`                                        | see below                                                                                                    |
| GET    | `/billing/overview`                   | `billing:manage` (owner, admin)       | none                                            | `200 BillingOverview`                                                                                        |
| GET    | `/billing/banners`                    | `businesses:read` (every role)        | none                                            | `200 { banners: BillingBanner[] }`                                                                           |
| GET    | `/billing/plans`                      | `billing:manage`                      | none                                            | `200 BillingCatalogue`                                                                                       |
| POST   | `/billing/checkout/credits`           | `billing:manage`                      | `{ packId }` + **`Idempotency-Key`**            | `201 CheckoutSession` (a repeated key: `200`, same session)                                                  |
| POST   | `/billing/checkout/subscription`      | `billing:manage`                      | `{ planId }` + **`Idempotency-Key`**            | `201 CheckoutSession`                                                                                        |
| GET    | `/billing/payments`                   | `billing:manage`                      | `status[]?`, `purpose?`, `cursor?`, `pageSize?` | `200` page of `PaymentView`, newest first                                                                    |
| GET    | `/billing/payments/:reference`        | `billing:manage`                      | reference or payment id                         | `200 PaymentView` (the return page polls this)                                                               |
| POST   | `/billing/payments/:reference/verify` | `billing:manage`                      | none                                            | `202 { queued, payment: PaymentView }`                                                                       |
| POST   | `/billing/payments/:id/refund`        | `billing:refund` (owner only)         | `{ amountMinor?, reason }`                      | `202 PaymentView` (refund `pending`)                                                                         |
| GET    | `/billing/invoices`                   | `billing:manage`                      | `cursor?`, `pageSize?`                          | `200` page of `InvoiceView`, newest first                                                                    |
| GET    | `/billing/invoices/:id`               | `billing:manage`                      | none                                            | `200 InvoiceView`                                                                                            |
| GET    | `/billing/invoices/:id/download-url`  | `billing:manage`                      | none                                            | `200 { url, expiresAt }` (15 minutes)                                                                        |
| GET    | `/billing/invoices/:id/download`      | signed in (`@AuthOnly`) + signed link | `org, expires, sig`                             | `200 application/pdf`; `303` for a browser navigation that fails (Stage 8) or is signed out (Stage 9), below |
| POST   | `/billing/subscription/cancel`        | `billing:manage`                      | `{ atPeriodEnd: true }` or `{}`                 | `200 SubscriptionView`                                                                                       |
| POST   | `/billing/subscription/resume`        | `billing:manage`                      | none                                            | `200 SubscriptionView`                                                                                       |
| GET    | `/billing/subscription/manage-link`   | `billing:manage`                      | none                                            | `200 { url }` (Paystack's card-update page)                                                                  |

The planned `/billing/invoices/:id/pdf` shipped as `download-url` plus `download` (signed links, exactly like export downloads). Stage 8: a browser navigation to an invoice link that fails with `DOWNLOAD_LINK_INVALID` or `DOWNLOAD_LINK_EXPIRED` (`INVOICE_DOWNLOAD_ERROR_CODES`; a damaged query or invoice id counts as `DOWNLOAD_LINK_INVALID`) gets `303 See Other` to `<APP_URL>/app/billing?downloadError=<code>`, under the same rules as export links: the same navigation detection, a fixed location from `APP_URL` and the code only, and JSON for everything else, including `ORG_FORBIDDEN` or `FORBIDDEN` for a member who is no longer a billing manager. Stage 9: a signed-out navigation (`401 UNAUTHENTICATED` or `TOKEN_EXPIRED`) gets `303 See Other` to `<APP_URL>/sign-in?next=/app/billing` (`Cache-Control: no-store`; a fixed location, whatever the invoice id), and requests that are not navigations keep the JSON `401`. Invoices have no "not ready" or "expired" state: the PDF is rendered on the first download and kept as a statutory record.

**Shapes** (`packages/contracts/src/billing/schemas.ts`):

- `BillingProviderStatus`: `{ provider: "paystack", configured, mode: "test" | "live" | null }`. `configured: false` means no `PAYSTACK_SECRET_KEY`: show "Payments are not set up yet" and disable purchase buttons with that label.
- `BillingCatalogue`: `{ plans: BillingPlan[], creditPacks: BillingCreditPack[], pricingPublished, provider }`. `BillingPlan`: `{ id, code, name, description, interval, priceMinor, currency, includedCredits, maxMembers, exportRowCap, discoveryEnabled, websiteAnalysisEnabled, isPlaceholder, purchasable, blocker }`; `BillingCreditPack`: `{ id, code, name, credits, priceMinor, currency, isPlaceholder, purchasable, blocker }`. `blocker` is `not_configured`, `price_not_published` (placeholder or zero price; placeholders are only purchasable with a Paystack **test** key) or `current_plan`, else null. While `pricingPublished` is false the UI must say "Pricing not yet published" next to any price.
- `BillingOverview`: `{ provider, subscription: SubscriptionView | null (active or past_due), pendingSubscription: PendingSubscriptionView | null (an incomplete checkout from the last 24 hours), entitlements: EntitlementsView, credits: { balance, held }, members: { active, pendingInvitations, cap }, latestPayment: PaymentView | null, banners: BillingBanner[], pricingPublished }`.
- `SubscriptionView`: `{ id, status: "incomplete" | "active" | "past_due" | "cancelled" | "expired", plan: { id, code, name, interval, priceMinor, currency, includedCredits }, currentPeriodStart, currentPeriodEnd, renewsAt (null when it will not renew), cancelAtPeriodEnd, cancelledAt, pastDueAt, endedAt, providerLinked, createdAt }`. Cancel, resume and the card page need `providerLinked: true` (Paystack's `subscription.create` webhook links it, normally within seconds of the first payment); otherwise they are `409 CONFLICT` "try again in a minute".
- `PendingSubscriptionView` (Stage 9): a `SubscriptionView` plus optional `authorizationUrl` and `authorizationUrlExpiresAt`, both present or both absent. `authorizationUrl` is the Paystack hosted checkout this subscription was started with (stored on the payment at `POST /transaction/initialize`); send the browser there to resume an abandoned checkout, exactly like `CheckoutSession.authorizationUrl`. It is present only while that payment is `pending`, not under review, Paystack is configured, and the checkout started less than `CHECKOUT_RESUME_WINDOW_MINUTES` (30) ago; `authorizationUrlExpiresAt` is that start plus 30 minutes. It is never present once the payment is final (`success`, `failed`, `abandoned`, `reversed`). Paystack's documentation gives no lifetime for an authorization URL, so the 30 minutes are LeadForge's conservative assumption, not a Paystack limit. When it is absent (or after `authorizationUrlExpiresAt`), offer a new checkout instead.
- `EntitlementsView`: `{ maxMembers, exportRowCap, discoveryEnabled, websiteAnalysisEnabled, monthlyIncludedCredits, sources: { <each>: "plan" | "override" | "free" }, basis: { kind: "subscription" | "free", planCode, planName } }`.
- `BillingBanner`: `{ kind, severity: "info" | "warning" | "error", title, message, href, since }`. Kinds: `negative_balance` (every role; `href` `/app/billing` for owners and admins, null for others), `not_configured`, `past_due` and `payment_failed` (owners and admins only; `payment_failed` = the latest payment failed in the last 7 days and no renewal is past due).
- `CheckoutSession`: `{ paymentId, reference, authorizationUrl, purpose: "credit_pack" | "subscription", amountMinor, currency, description }`.
- `PaymentView`: `{ id, reference, purpose, status: "pending" | "success" | "failed" | "reversed" | "abandoned", description, amountMinor, currency, creditsGranted (null before success), channel, card: { brand, last4, expMonth, expYear, bank } | null (masked only), gatewayResponse, invoiceId, initiatedAt, paidAt, verifiedAt, failedAt, reversedAt, refundedMinor, refundableMinor, refunds: RefundView[], underReview }`. `underReview` is true while a verification mismatch or an open dispute is recorded; nothing is granted for a pending payment under review.
- `RefundView`: `{ id, status: "pending" | "processed" | "failed", amountMinor, currency, reason, reversalUnits, failureReason, createdAt, processedAt }`.
- `InvoiceView`: `{ id, number (LF-<year>-<6 digits>, sequential, gap-free), status, lines: [{ description, quantity, unitMinor, amountMinor }], subtotalMinor, taxMinor (0: tax is not computed until pricing is approved), totalMinor, currency, issuedAt, paidAt, periodStart, periodEnd, paymentReference, subscriptionId, pdfReady }`.

**Checkout and return flow (never grants on redirect):**

1. The Billing page calls `POST /billing/checkout/credits` or `/checkout/subscription` with a fresh `Idempotency-Key` per click (a double click returns the same session; the same key for another item is `409 CONFLICT`; a missing or malformed key is `400` on `Idempotency-Key`).
2. Send the browser to `authorizationUrl` (Paystack's hosted page). No card data ever touches LeadForge.
3. Paystack returns the browser to `<APP_URL>/app/billing/return?trxref=<reference>&reference=<reference>` (`BILLING_CALLBACK_URL` overrides it). That page calls `POST /billing/payments/:reference/verify` once (it only queues a verify in the worker), then polls `GET /billing/payments/:reference` every 2 seconds until `status` is `success`, `failed`, `abandoned` or `reversed`, or `underReview` is true. Show "Confirming payment" meanwhile; after about 60 seconds say "Still confirming; we will notify you" (the webhook or the 10-minute reconciliation finishes it).
4. Credits and plans are granted only by the worker, after Paystack's verify returns `success` with the same reference, amount and currency, in one PostgreSQL transaction with the payment state change, the ledger entry (`purchase` for packs, `grant` for a plan's included credits, key `payment:<id>:grant`), the subscription period, the entitlements and the invoice.

Subscriptions: a subscription checkout creates an `incomplete` subscription; its first verified payment makes it `active` (period = paid date plus one interval, Paystack's next charge date afterwards), grants the plan's included credits and writes the plan's entitlements. Buying a different plan replaces the current one (the old one is cancelled and disabled at Paystack when the new one activates). A failed renewal (`invoice.payment_failed`) makes it `past_due` with a banner and a notification; a successful retry makes it `active` again; `BILLING_PAST_DUE_GRACE_DAYS` (7) after the failure it `expired`s and the free tier applies. Cancelling stops renewal at Paystack now and keeps the plan until `currentPeriodEnd`, then it becomes `cancelled`. Errors: `409 CONFLICT` (already on this plan; past due: update the card instead), `404` (plan).

Refunds (owner): `amountMinor` defaults to what is left; above it is `400` on `amountMinor`; a payment that is not `success` is `409 CONFLICT`. The refund is `pending` until Paystack's `refund.processed`, which takes back the payment's credits in proportion (`refund_reversal` ledger entry, key `refund:<id>:reversal`; a refund that completes the payment takes back exactly the rest and marks it `reversed`). The balance may go below zero; then `CREDIT_BALANCE_NEGATIVE` blocks new discovery jobs and analyses until credits are bought. `refund.failed` marks it `failed` and takes nothing back.

Entitlements enforced server-side: member cap (`MEMBER_LIMIT_REACHED` on inviting, accepting and reactivating), `discovery_enabled` and `website_analysis_enabled` (`ENTITLEMENT_REQUIRED`), `export_row_cap` (`EXPORT_TOO_LARGE` on async exports). Without a subscription the free tier applies: `BILLING_FREE_MAX_MEMBERS` (5) members, `EXPORT_DEFAULT_ROW_CAP` (10,000) export rows, discovery and analysis on (they cost credits), no included credits.

Usage (shipped in Phase 5): `GET /usage?period=7d|30d|90d` (default `30d`; `usage:read`: owner, admin, researcher, analyst) returns `UsageSummary`:

```json
{
  "period": "7d",
  "from": "2026-10-20",
  "to": "2026-10-26",
  "computedAt": "2026-10-26T10:40:00.000Z",
  "metrics": [
    "credits_used",
    "discovery_jobs",
    "discovery_records",
    "analyses",
    "enrichment_runs",
    "exports",
    "export_rows"
  ],
  "series": [
    {
      "day": "2026-10-20",
      "values": {
        "credits_used": 0,
        "discovery_jobs": 0,
        "discovery_records": 0,
        "analyses": 0,
        "enrichment_runs": 0,
        "exports": 0,
        "export_rows": 0
      }
    }
  ],
  "totals": {
    "credits_used": 3,
    "discovery_jobs": 1,
    "discovery_records": 2,
    "analyses": 1,
    "enrichment_runs": 0,
    "exports": 2,
    "export_rows": 4
  },
  "credits": { "balance": 47, "held": 0 }
}
```

One series point per UTC day, oldest first, read from PostgreSQL `usage_daily`. `credits_used` is credits captured (all kinds); `discovery_records` and `analyses` are the credits captured by discovery jobs and website analyses; `discovery_jobs` and `enrichment_runs` count jobs created; `exports` and `export_rows` count completed asynchronous exports and synchronous downloads with their rows. The worker rolls the values up every 10 minutes (last 2 days) and daily (90 days); `computedAt` is null before the first rollup. Show the ledger (`GET /credits/ledger`, with `referenceName`) for the per-job detail.

### Webhooks (shipped in Phase 6)

| Method | Path                 | Auth                           | Returns                             |
| ------ | -------------------- | ------------------------------ | ----------------------------------- |
| POST   | `/webhooks/paystack` | public; `x-paystack-signature` | `200 { received: true, duplicate }` |

- The signature is HMAC-SHA512 of the exact raw request body with `PAYSTACK_SECRET_KEY`, hex, compared in constant time. The app keeps the raw bytes (`rawBody`), so re-serialized JSON is never what is checked. Missing, malformed or wrong signature: `401 WEBHOOK_SIGNATURE_INVALID`, nothing stored. Without a key: `422 BILLING_NOT_CONFIGURED`, nothing stored. With `PAYSTACK_WEBHOOK_IP_ALLOWLIST` set, other addresses get `403 FORBIDDEN`. A signed body that is not `{ event, data }` is `400`.
- Every authentic event is stored once in `payment_webhook_events` (unique per provider and derived event key, see docs/DATABASE_DESIGN.md section 5), then `process-webhook` is queued and the endpoint answers 200 at once. A redelivery returns `duplicate: true` and does nothing else. No CSRF (it is not a browser request), no organization header.
- Handled events: `charge.success`, `subscription.create`, `subscription.not_renew`, `subscription.disable`, `invoice.create` (noted only), `invoice.update`, `invoice.payment_failed`, `refund.pending`, `refund.processing`, `refund.processed`, `refund.failed`, `charge.dispute.create`, `charge.dispute.remind`, `charge.dispute.resolve`. Others are stored and marked `ignored`. Charge events are always verified with Paystack before anything is granted.
- Hidden from the OpenAPI document (it is not for API clients).

### Reports (shipped in Phase 5; `GET /reports/overview` documented above)

Every report needs `businesses:read` (all roles), is organization-scoped and runs on indexes that start with `organizationId`.

| Method | Path                            | Query             | Returns                                                                                                                                                                                      |
| ------ | ------------------------------- | ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/reports/source-breakdown`     | `period=7d        | 30d                                                                                                                                                                                          | 90d  | all`(default`30d`)                                                                                                                    | `{ period, periodStart, generatedAt, totalBusinesses, sources: [{ source, businesses, share }] }` |
| GET    | `/reports/quality-distribution` | `period` as above | `{ period, periodStart, generatedAt, total, unscored, fit: Bucket[10], dataConfidence: Bucket[10] }`                                                                                         |
| GET    | `/reports/jobs-timeline`        | `period=7d        | 30d                                                                                                                                                                                          | 90d` | `{ period, periodStart, generatedAt, days: [{ day, created: Counts, failed: Counts }], totals: { created: Counts, failed: Counts } }` |
| GET    | `/reports/pipeline-funnel`      | `period` as above | `{ period, periodStart, generatedAt, stages: [{ key, label, kind, order, archived, current, entered }], totals: { leads, open, won, lost, winRate, wonValue: [{ currency, valueMinor }] } }` |
| GET    | `/reports/activity-summary`     | `period` as above | `{ period, periodStart, generatedAt, total, byType: [{ type, count }], byUser: [{ userId, name, total, byType }] }`                                                                          |

`period` filters records created (businesses), changed (stage entries) or logged (activities) since `periodStart` (null for `all`). Source breakdown: live, non-suppressed businesses per source (a business with several sources counts under each; `share` of `totalBusinesses`, 3 decimals). Quality: `Bucket` is `{ min, max, count }` (0 to 9, ..., 90 to 100); fit and data confidence are separate measures and must never be added; unscored businesses are in neither. Jobs timeline: one entry per UTC day, oldest first; `Counts` is `{ discovery, import, analysis, enrichment, export, bulk }`; `failed` counts jobs created that day that failed. Pipeline funnel: stages in board order (archived ones only when they hold leads or saw entries); `current` leads now, `entered` stage-change activities into the stage in the period (lead creation counts as entering the entry stage); `winRate` is won / (won + lost) for leads closed in the period (null when none). Activity summary: logged activities only (notes, calls, WhatsApp, email, meetings); `name` is null for former members.

### Notifications, audit, admin

| Method   | Path                                                 | Notes                                                                                                                                                                                                            |
| -------- | ---------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET      | `/notifications`                                     | shipped (Phase 3): see below                                                                                                                                                                                     |
| POST     | `/notifications/:id/read`, `/notifications/read-all` | shipped (Phase 3)                                                                                                                                                                                                |
| GET, PUT | `/notifications/preferences`                         | shipped (Phase 3)                                                                                                                                                                                                |
| GET      | `/audit-events`                                      | planned: admin and above; `resourceType, actorUserId, from, to, cursor`                                                                                                                                          |
| any      | `/admin/*`                                           | planned, not in release 1: platform admin views of failed jobs, dead letters, reconciliation runs, source health. Release 1 operators use `pnpm queue:admin`, the metrics and the runbooks in docs/OPERATIONS.md |

Notifications (shipped in Phase 3; permission `notifications:read`, held by every role; each user sees only their own, in the current organization):

| Method | Path                          | Body or query                      | Returns                                                                                  |
| ------ | ----------------------------- | ---------------------------------- | ---------------------------------------------------------------------------------------- |
| GET    | `/notifications`              | `unread?=true, cursor?, pageSize?` | `200` page of `Notification`, newest first                                               |
| GET    | `/notifications/unread-count` | none                               | `200 { unread }` (capped at 1,000)                                                       |
| POST   | `/notifications/:id/read`     | none                               | `200 Notification`; another user's or organization's id is `404`                         |
| POST   | `/notifications/read-all`     | none                               | `200 { updated }`                                                                        |
| GET    | `/notifications/preferences`  | none                               | `200 { emailJobEvents, emailBilling, inappAll, emailAssignments }` (defaults all `true`) |
| PUT    | `/notifications/preferences`  | any subset of the four booleans    | `200` the saved preferences                                                              |

`Notification`: `{ id, type, title, body, href, readAt, createdAt }` with `type` one of `discovery.completed`, `discovery.completed_with_warnings`, `discovery.failed`, `import.completed`, `import.completed_with_errors`, `import.failed`, `analysis.bulk_completed` (Phase 4: once per bulk analysis request, when its last analysis finishes), and from Phase 5 `lead.assigned` (to the assignee; once per single assignment, once per bulk operation), `bulk.completed`, `bulk.completed_with_errors`, `bulk.failed` and `export.completed`, `export.failed` (to the requester), and from Phase 6 (to every active owner and admin, `href` `/app/billing`) `billing.payment_succeeded` (receipt with the invoice number and credits added), `billing.payment_failed` (a failed checkout or renewal), `billing.subscription_changed` (activated, renewed, set not to renew, ended, expired), `billing.refund_updated` (processed or failed) and `billing.attention` (a payment that failed verification, or a dispute). Billing notices are also emailed unless the recipient turned `emailBilling` off. Stage 10 added `organization.deletion_requested` and `organization.deletion_cancelled` (to every active owner and admin, `href` `/app/settings?tab=organization`, whatever their preferences; also emailed) and `organization.export_completed`, `organization.export_failed` (to the owner who requested the organization data export). Discovery and import notices go to the user who started the job, once per job round (a replayed event finds the existing notice). `inappAll: false` stops in-app notices; `emailJobEvents: false` stops the discovery failure email; `emailAssignments: false` (Phase 5) stops lead-assignment emails. Notifications are kept 90 days. Poll the unread count (for example every 30 seconds, and after a job reaches a terminal status).

## 3. Key schemas (Zod, abbreviated)

```ts
// Shipped Phase 3 schemas (packages/contracts/src/discovery/schemas.ts). Abbreviated:
export const DiscoveryJobSpec = z.object({
  name: z.string().trim().min(2).max(120),
  sources: z
    .array(z.enum(["google_places", "overture_places"]))
    .min(1)
    .max(3), // distinct; Google refused (SOURCE_POLICY_BLOCKED)
  location: z.object({
    country: CountryCode.default("NG"),
    region: z.string().trim().min(2).max(120).optional(),
    locality: z.string().trim().min(2).max(120).optional(),
    lga: z.string().trim().min(2).max(120).optional(), // Stage 4
    query: z.string().trim().min(2).max(200).optional(),
    geo: z
      .object({ lat: z.number(), lng: z.number(), radiusM: z.number().int().min(100).max(50000) })
      .optional(),
  }),
  categories: z.array(z.string().trim().min(2).max(80)).min(1).max(10), // distinct, case-insensitive
  domainsInclude: z.array(Domain).max(50).default([]),
  domainsExclude: z.array(Domain).max(50).default([]),
  maxRecords: z.number().int().min(1).max(5000),
  priorityFields: z
    .array(z.enum(["phone", "email", "whatsapp", "website"]))
    .max(4)
    .default(["phone", "website"]),
});

// Shipped Phase 2 schemas live in packages/contracts/src:
//   businesses/fields.ts   FieldState, WhatsAppStatus, SourceKey, CollectionMethod, ObservationField, FieldMeta, fieldValue()
//   businesses/schemas.ts  BusinessListFilter (Stage 8: ids), BUSINESS_IDS_FILTER_MAX, BusinessListQuery, BusinessListItem, BusinessFacets, BusinessDetail,
//                          Observation, VerificationEvent, CorrectionRequest, CreateBusinessRequest, SuppressRequest
//   imports/schemas.ts     IMPORT_LIMITS, ImportField, ImportMapping, ImportJob, ImportPreviewRequest/Response,
//                          ImportCommitRequest, ImportRowResult, ImportRowsQuery, ImportIssueCode
//   exports/schemas.ts     EXPORT_SYNC_ROW_CAP, ExportColumn, ExportBusinessesRequest
//   sources/schemas.ts     SourceRegistryEntry, SourceStatus, RetentionRule, FieldRetention, UpdateSourceConfigRequest
//   reports/schemas.ts     OverviewQuery, OverviewMetrics
// Phase 3:
//   discovery/schemas.ts      DISCOVERY_LIMITS, DiscoveryJobSpec, DiscoveryEstimate, DiscoveryJob, DiscoveryJobItem,
//                             DiscoveryJobListQuery, DiscoveryItemsQuery, DiscoverySourceOption, DiscoveryIssueCode
//   credits/schemas.ts        CreditBalance, CreditLedgerEntry, CreditLedgerQuery, LedgerEntryType
//   jobs/schemas.ts           JobKind, JobStatus, JobSummary, JobListQuery
//   notifications/schemas.ts  Notification, NotificationType, NotificationListQuery, NotificationPreferences
// Phase 4:
//   analysis/schemas.ts       ANALYSIS_LIMITS, DetectionKey, Detection, Evidence, OpportunityKey, Opportunity, WebsiteAnalysis,
//                             CreateAnalysisRequest, CreateAnalysisResponse, AnalysisListQuery, AnalysisSummary
//   enrichment/schemas.ts     EnrichmentRun, EnrichmentRunKind, EnrichmentRunListQuery, EmailCheckRequest, EmailCheckResult, RefreshResponse
//   scoring/schemas.ts        SCORING_SIGNALS, DEFAULT_SCORING_WEIGHTS, SCORE_EXPLANATION, ScoringWeights (sum 100), ScoringIcp,
//                             ScoringProfile, UpdateScoringProfileRequest, ScoreSnapshot
//   dedup/schemas.ts          DuplicateCandidate, DuplicateCandidateListQuery, MergeRequest, MergeRecord, MergeResponse,
//                             UndoMergeRequest, MergeListQuery, DedupScanRequest, MERGE_UNDO_WINDOW_DAYS
// Phase 5:
//   crm/schemas.ts            CRM_LIMITS, StageKey, PipelineStage, PipelineConfig, DEFAULT_PIPELINE_STAGES, UpdatePipelineConfigRequest,
//                             Lead, LeadBusiness, LeadListQuery, CreateLeadRequest, MoveLeadRequest, UpdateLeadRequest, AssignLeadRequest,
//                             PipelineBoard(Query), LeadList, LeadListListQuery, Create/UpdateLeadListRequest, ListItemsRequest,
//                             LeadListItem, ListItemsResult, ActivityType, ActivityOutcome, ACTIVITY_OUTCOMES, Activity,
//                             ActivityListQuery, CreateActivityRequest(Response), UpdateActivityRequest, SuppressionOverride,
//                             OutreachChannel, OutreachStatus, OutreachRecord, OutreachListQuery, Create/UpdateOutreachRequest,
//                             LogOutreachAttemptRequest(Response)
//   bulk/schemas.ts           BULK_LIMITS, BulkAction, BulkSelection, BulkOperationRequest, BulkItemOutcome, BulkPreview,
//                             BulkStatus, BulkOperation, BulkOperationListQuery, BulkOperationItem, BulkOperationItemsQuery
//   exports/schemas.ts        EXPORT_LIMITS, ExportKind, CreateExportRequest, ExportStatus, ExportJob, ExportListQuery,
//                             ExportDownloadLink, ExportDownloadQuery, EXPORT_DOWNLOAD_ERROR_CODES, ExportDownloadErrorCode (Stage 8)
//   usage/schemas.ts          UsageMetric, UsagePeriod, UsageQuery, UsageValues, UsageSummary
//   billing/schemas.ts        (Phase 6) BillingProviderStatus, PurchaseBlocker, BillingPlan, BillingCreditPack, BillingCatalogue,
//                             SubscriptionStatus, SubscriptionView, PendingSubscriptionView and
//                             CHECKOUT_RESUME_WINDOW_MINUTES (Stage 9), EntitlementsView, BillingBanner(s), PaymentPurpose,
//                             PaymentStatus, PAYMENT_TERMINAL_STATUSES, RefundView, PaymentView, PaymentListQuery,
//                             PaymentReference, CheckoutCreditsRequest, CheckoutSubscriptionRequest, CheckoutSession,
//                             VerifyPaymentResponse, InvoiceView, InvoiceListQuery, InvoiceDownloadLink, InvoiceDownloadQuery,
//                             INVOICE_DOWNLOAD_ERROR_CODES, InvoiceDownloadErrorCode (Stage 8),
//                             CancelSubscriptionRequest, SubscriptionManageLink, RefundRequest, BillingOverview, WebhookAck
//   reports/schemas.ts        ReportPeriod, ReportQuery, TimelineQuery, SourceBreakdown, HistogramBucket, QualityHistograms,
//                             QualityDistribution, JobKindCounts, JobsTimeline, PipelineFunnel, ActivitySummary
export const FieldState = z.enum([
  "verified",
  "unverified",
  "stale",
  "expired",
  "missing",
  "conflicting",
]);
export const WhatsAppStatus = z.enum(["confirmed", "user_asserted", "unknown"]);
```

## 4. Versioning

Breaking changes create `/api/v2` routes alongside `/api/v1`; `v1` is maintained for at least six months after `v2` ships. Additive changes (new optional fields) do not bump the version.
