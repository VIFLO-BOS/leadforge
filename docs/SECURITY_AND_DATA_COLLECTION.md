# LeadForge Security and Data Collection Policy

Status: Phase 0 proposal, pending approval. Last updated 2026-10-24.

This document is binding on implementation. Where it conflicts with a feature request, the feature changes.

## 1. Authentication

- Passwords hashed with Argon2id (memory 64 MiB, 3 iterations, parallelism 1). Minimum 10 characters, zxcvbn score 3 or higher.
- Access JWT (EdDSA, 15 minutes) plus rotating refresh token (30 days, hashed at rest, session family tracked). Reuse of a rotated refresh token revokes the whole family.
- Cookies: httpOnly, Secure, SameSite=Lax; refresh cookie path-restricted.
- Email verification required before any organization data is accessible. Password reset invalidates all sessions.
- Login throttling per account and per IP; generic error messages; constant-time comparisons.
- No OAuth providers in release 1. A reserved `users.auth_providers` jsonb column allows adding them without a breaking migration.

## 2. Authorization

Roles and permissions, enforced server-side on every request, job, export and resource lookup:

| Permission                                       | Owner | Admin            | Researcher | Sales Rep        | Analyst |
| ------------------------------------------------ | ----- | ---------------- | ---------- | ---------------- | ------- |
| View businesses, lists, pipeline, reports        | yes   | yes              | yes        | yes              | yes     |
| Create or edit businesses, corrections, suppress | yes   | yes              | yes        | no               | no      |
| Create or cancel discovery jobs, run analysis    | yes   | yes              | yes        | no               | no      |
| Merge or undo duplicates                         | yes   | yes              | yes        | no               | no      |
| Manage lead lists                                | yes   | yes              | yes        | own and assigned | no      |
| Pipeline stage changes, activities               | yes   | yes              | no         | yes              | no      |
| Assign leads                                     | yes   | yes              | yes        | no               | no      |
| Export                                           | yes   | yes              | yes        | assigned only    | yes     |
| Scoring profiles, pipeline config, sources       | yes   | yes              | no         | no               | no      |
| Members, invitations, roles                      | yes   | yes (not owners) | no         | no               | no      |
| Billing, checkout, cancel subscription           | yes   | yes              | no         | no               | no      |
| Org settings, deletion request                   | yes   | no               | no         | no               | no      |
| Audit log                                        | yes   | yes              | no         | no               | no      |

Implementation:

- `@RequirePermission("businesses:write")` decorator plus `PermissionsGuard`. A lint rule fails CI on any route handler without a permission decorator or an explicit `@Public()`.
- Organization resolution from `X-Organization-Id` is verified against `memberships` on every request; cached 60 seconds per user and org pair with invalidation on membership change.
- Repositories take `organizationId` as a required positional parameter. An ESLint rule bans importing the raw Mongo `Db` or `Collection` and `PrismaClient` outside `packages/db-*` repositories.
- Background job payloads include `organizationId`; processors re-check organization status, and membership of the requesting user when the job acts on their behalf.
- Exports are generated server-side from filters re-evaluated under the requester's permissions; download URLs are signed, single-org, 15 minutes.
- The frontend hides controls by permission for usability only. No authorization decision is made in the browser.

## 3. Tenant isolation testing

A dedicated suite seeds two organizations and asserts, for every list, detail and mutation endpoint, every export and every job type:

- Org A cannot read, update, delete or enumerate Org B resources by ID. Cross-org IDs return 404, never 403, to avoid revealing existence.
- Filters cannot be crafted to leak counts (a `listId` from another org yields 404, not an empty result).
- Job payloads with a mismatched `organizationId` are rejected before any work.

## 4. Input handling

- All request bodies, queries and params validated with Zod before reaching services. Unknown keys are stripped.
- Mongo queries are built from allowlisted fields; user text never becomes an operator; regex input is escaped and anchored.
- CSV import: size cap 20 MB, row cap per plan, cell length cap 2,000. Export neutralizes formula injection by prefixing cells that start with `=`, `+`, `-` or `@`.
- HTML from collected pages is parsed with `parse5` or `cheerio` only. It is never rendered or executed. Evidence snippets are stored as text and escaped on display.
- File uploads: CSV only in release 1, MIME sniffed, stored outside the web root.

## 5. Website analysis and SSRF prevention

Fetching is performed only by the worker through a dedicated `SafeFetch` service:

1. Parse the URL; allow only `http:` and `https:`; reject userinfo; allow ports 80, 443, 8080 and 8443 only.
2. Resolve DNS (A and AAAA). Reject if any resolved address falls in: `0.0.0.0/8`, `10.0.0.0/8`, `100.64.0.0/10`, `127.0.0.0/8`, `169.254.0.0/16`, `172.16.0.0/12`, `192.0.0.0/24`, `192.168.0.0/16`, `198.18.0.0/15`, `224.0.0.0/4`, `240.0.0.0/4`, `::1/128`, `::/128`, `fc00::/7`, `fe80::/10`, `::ffff:0:0/96` (the mapped IPv4 is re-checked against the IPv4 list), `64:ff9b::/96`. Also reject literal hostnames `localhost`, `metadata.google.internal`, anything under `.internal` or `.local`, and any hostname that resolves to nothing.
3. Connect to the resolved IP with the original `Host` header and TLS SNI set to the hostname (IP pinning defeats DNS rebinding between check and connect).
4. Follow at most 5 redirects, re-running steps 1 to 3 on every hop.
5. Timeout 10 seconds for connect plus read; response cap 2 MiB, streamed and aborted on overflow; accept only `text/html`, `application/xhtml+xml`, `text/plain` and `application/json` (for robots and manifests).
6. Fetch and honor `robots.txt` for our user agent `LeadForgeBot/1.0 (+<bot info URL>)`; cache rules 24 hours; disallowed paths are not fetched and the analysis records `robots.allowed = false`.
7. Per-domain limit 1 request per 2 seconds; max 5 pages per analysis (home, contact, about, services or menu, booking when linked); global 10 requests per second.
8. No JavaScript execution. No headless browser in release 1.
9. Page content is data. No LLM consumes it in release 1. If LLM summarization is added later, content is passed as untrusted quoted data with strict output schemas and no tool access.
10. The worker runs with a network-level egress allowlist where the host supports it. Documented for deployment in Phase 7.

## 6. Data collection policy

Principles:

- Collect only business-facing information: business name, category, address, business phone, business email, website, social profile URLs, opening hours, description.
- Do not collect personal names, personal phone numbers, personal emails or employee data from sources. Where a sole trader's business contact is also personal, it is handled as business contact information under legitimate interest, and suppression requests are honored.

Source rules, recorded in `source_configs.policy` and shown on the Sources page:

| Source                  | Method                         | Allowed storage                                                                   | Attribution                  | Rate                               | Status                                  |
| ----------------------- | ------------------------------ | --------------------------------------------------------------------------------- | ---------------------------- | ---------------------------------- | --------------------------------------- |
| Google Places API (New) | Official API                   | Place ID indefinitely; other fields for the policy window, then refresh or expire | Required, shown next to data | Google quota                       | Proposed first source, pending approval |
| Business's own website  | Direct fetch respecting robots | Indefinitely as an observation with URL and date                                  | Link to page                 | 1 request per 2 seconds per domain | Proposed                                |
| User CSV import         | User-supplied                  | Indefinitely; user attests lawful basis on import                                 | "Imported by <user>"         | n/a                                | Proposed                                |

Prohibited in release 1, and until individually reviewed and approved: scraping Google Maps HTML; Facebook, Instagram, LinkedIn, TikTok; marketplaces such as Jiji, Konga, Jumia; directories whose terms forbid automated access; the Corporate Affairs Commission (CAC) portal; any login-walled or CAPTCHA-protected source; any site whose robots directives disallow us.

"Publicly accessible" is not the test. The test is an official API or explicit permission, or a public web page whose terms and robots directives allow automated access, plus a lawful basis under the Nigeria Data Protection Act 2023 and, for expansion markets, GDPR or UK GDPR where applicable. Legal review of the first source's terms is a Phase 3 entry condition.

Never:

- Invent or infer contact values. Missing stays missing.
- Mark WhatsApp as available without a `wa.me` or `api.whatsapp.com` link, an explicit WhatsApp label adjacent to the number on the business's own site, or a user assertion after contact.
- Bypass rate limits by rotating IPs or user agents.

## 7. Privacy, rights and suppression

- Suppression list per organization (domain, phone, email, business) checked at ingest, merge, bulk actions and export.
- Platform-wide do-not-collect list, maintained by operators, for businesses that request removal; applied across all organizations.
- Public removal and correction request form on the data collection legal page, stored as `contact_submissions` with `kind = data_request`; 30-day handling target; operator tooling under `/admin`.
- Data minimization: observation values for retention-limited sources are redacted when the retention window ends; metadata is kept.
- Organization data export (JSON and CSV) and an organization deletion workflow (14-day grace, then purge Mongo by `organizationId` and anonymize PG users while billing records are kept for the statutory period).
- Access to exports and to contact fields on detail views is written to `audit_events`.

## 8. Billing security

- The Paystack secret key exists only on the server. Release 1 uses the redirect flow, so no client-side key is needed.
- Webhook: HMAC SHA-512 over the raw request body compared in constant time to `x-paystack-signature`; raw body preserved by a dedicated middleware on this route only. Optional Paystack IP allowlist in production.
- Idempotency at three layers: webhook event uniqueness, `payments.provider_reference` uniqueness, `credit_ledger.idempotency_key` uniqueness.
- Entitlements are granted only after the provider's verify call returns success with matching amount and currency.
- Card data never touches our servers. Only the provider's masked authorization (last4, brand, bank, expiry) is stored for display.
- Prices and plan IDs come from the database; the client sends only `planId` or `packId`.
- Credit balance is read from PostgreSQL under row lock on every charging decision.

## 9. Secrets and configuration

- All secrets come from environment variables validated at boot by a Zod schema; the app refuses to start on missing or malformed values.
- `.env.example` documents every variable; real `.env` files are git-ignored.
- Production uses the hosting platform's secret manager. Rotation procedure documented in Phase 7.
- JWT signing uses an asymmetric key pair; the private key is present only in the API process.

## 10. Logging, monitoring, audit

- pino structured JSON logs with `requestId`, `userId`, `organizationId`, `jobId`; emails and phones redacted by pino redact paths.
- Health: `/health/live` and `/health/ready` (checks Postgres, Mongo, Redis).
- Metrics: queue depth, job durations, failure rates, source error rates, webhook lag, reconciliation fixes; exposed in Prometheus format on an internal interface.
- Audit events for auth events, role changes, invitations, billing actions, exports, merges, suppressions, corrections, org settings and deletion requests.

## 11. Dependency and supply-chain hygiene

- `pnpm` with committed lockfile; `pnpm audit` and Renovate in CI; build scripts allowed only for an explicit allowlist of packages.
- Minimal dependency set. Each new dependency is justified in its pull request.

## 12. Security testing in CI

- Unit: SSRF deny list including IPv6-mapped and rebinding cases, URL parser, signature verification, idempotency keys, permission matrix.
- Integration: tenant isolation suite, duplicate webhook replay, concurrent credit holds, refresh-token reuse detection.
- Static: `eslint-plugin-security`, type checks, secret scanning with gitleaks.
- Pre-release: manual review against the relevant OWASP ASVS Level 2 items; dependency audit clean of high and critical findings.
