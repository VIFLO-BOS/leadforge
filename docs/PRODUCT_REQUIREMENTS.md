# LeadForge Product Requirements

Status: Phase 0 proposal, pending approval. Last updated 2026-10-24.

## 1. Product statement

LeadForge helps sales and research teams find businesses worth their next conversation. It discovers businesses through permitted sources, collects and verifies publicly available business contact information with full provenance, analyzes public websites for digital-service opportunities, scores leads against configurable criteria, and manages the resulting pipeline. The first market is Nigeria. The architecture supports other countries through country-aware normalization, per-country source configuration, and currency-aware billing.

LeadForge does not claim to find every business. Every screen that shows discovered data also shows which sources were used and when.

## 2. Users and roles

| Persona                         | Goal                                                                             | Role in product      |
| ------------------------------- | -------------------------------------------------------------------------------- | -------------------- |
| Agency founder or sales lead    | Find SMEs in a city and industry that lack a website or booking flow, then pitch | Owner                |
| Sales representative            | Work assigned leads, log calls and WhatsApp outreach, move pipeline stages       | Sales Representative |
| Researcher or virtual assistant | Run discovery jobs, clean data, resolve duplicates, verify contacts              | Researcher           |
| Analyst or manager              | Read reports, export lists, no edits                                             | Read-only Analyst    |
| Workspace admin                 | Manage members, billing, settings                                                | Administrator        |

The role permission matrix is in `SECURITY_AND_DATA_COLLECTION.md` section 2.

## 3. Objectives mapped to features

| #   | Objective                                                                               | Release 1 feature                                          | Phase  |
| --- | --------------------------------------------------------------------------------------- | ---------------------------------------------------------- | ------ |
| 1   | Discover businesses via permitted sources                                               | Discovery jobs over the approved source adapter(s)         | 3      |
| 2   | Collect public business information                                                     | Business profile with normalized fields                    | 2 to 3 |
| 3   | Find names, industries, locations, websites, phones, explicit WhatsApp, emails, socials | Field model with per-field state                           | 2 to 4 |
| 4   | Track source, collection date, verification status per field                            | Provenance panel; field badges                             | 2 to 4 |
| 5   | Identify duplicates across sources                                                      | Multi-stage dedup, review queue, merge and undo            | 3 to 4 |
| 6   | Analyze websites for opportunities                                                      | SSRF-safe analysis with evidence and confidence            | 4      |
| 7   | Transparent configurable scoring                                                        | Scoring profiles with per-signal weights and explanation   | 4      |
| 8   | Save, filter, categorize, assign, export                                                | Directory filters, lead lists, assignment, CSV export jobs | 2, 5   |
| 9   | Manage sales activities                                                                 | Pipeline, notes, activities, outreach records              | 5      |
| 10  | Pay via billing system                                                                  | Paystack subscriptions and credit packs                    | 6      |
| 11  | View jobs, usage, reports, team activity                                                | Overview, jobs, usage pages, reports                       | 2 to 6 |
| 12  | Manage members and roles                                                                | Team page, invitations, roles                              | 1      |

## 4. First-release scope

### In scope

- Registration, email verification, sign-in, password reset, organization creation, invitations, five roles.
- Business directory with server-side search, filters, sorting, cursor pagination, row selection, bulk add-to-list, bulk suppress, CSV export job.
- Business detail: overview, contacts with field state, provenance, verification history, website analysis, score explanation, opportunities, discovery history, activities, duplicate candidates, corrections, add to list.
- CSV import of businesses (user-supplied source) with column mapping and provenance recorded as `source: user_import`.
- Discovery jobs over the approved first source: creation wizard, usage estimate, job states (queued, running, completed, completed with warnings, failed, cancelled), item-level results and errors, retry of failed items, cancellation.
- Website enrichment and analysis: contact extraction from the business's own site; detections listed in section 6.
- Deduplication: automatic exact matches on domain, phone and email at ingest; similarity candidates to a review queue; manual merge and undo with history.
- Lead scoring with one default profile per org, editable weights, per-business explanation.
- CRM: lead lists, pipeline with default stages (New, Qualified, Contacted, Interested, Opportunity, Won, Lost), stage customization, owner assignment, notes, activities (call, WhatsApp message, email, meeting, note), outreach records.
- Usage and credits page; billing page with plans, subscription status, renewal date, invoices, payments, credit purchases.
- Paystack: subscription checkout, credit pack checkout, webhook processing, failed-payment handling, reconciliation.
- Overview dashboard with real metrics and empty states.
- Reports: lead-source breakdown, lead-quality distribution, jobs over time.
- Notifications: in-app for job completion or failure, invitation, payment events; email for invitations, verification, password reset, payment receipts, job failure.
- Settings: organization profile, notification preferences, security (sessions list and revoke), data export request, organization deletion request workflow.
- Marketing site: Home, Product, Pricing (live plans), About, Contact (working form), Legal (Privacy, Terms, Acceptable Use, Data Collection Policy).
- Responsive from 240px, light and dark themes, reduced-motion support.

### Out of scope for release 1 (shown as unavailable, never as broken)

- Customer API keys and public API docs for customers (navigation item disabled).
- Scheduled recurring discovery jobs (job creation offers "run now" only; the schedule control is disabled with a badge).
- Flutterwave.
- Third-party email deliverability verification (release 1 does syntax, MX and disposable-domain checks only).
- Phone carrier or HLR lookups.
- Source adapters beyond the approved first source.
- Mobile apps.

## 5. Field model and states

Every contact-bearing field on a business carries:

| Property                                        | Values                                                                 |
| ----------------------------------------------- | ---------------------------------------------------------------------- |
| `value`                                         | normalized value or null                                               |
| `rawValue`                                      | as observed                                                            |
| `state`                                         | `verified`, `unverified`, `stale`, `expired`, `missing`, `conflicting` |
| `confidence`                                    | 0 to 1                                                                 |
| `observationIds`                                | provenance references                                                  |
| `lastObservedAt`, `lastVerifiedAt`, `expiresAt` | timestamps                                                             |

Definitions:

- `verified`: a verification method succeeded (email MX plus SMTP recipient check passed; phone parsed as valid and observed on the business's own site; WhatsApp link explicitly present).
- `unverified`: observed but not verified.
- `stale`: older than the org's freshness window (default 180 days).
- `expired`: past the source's retention limit; value hidden, placeholder shown with a Refresh action.
- `conflicting`: two or more sources disagree and no resolution rule applies; all values shown.
- `missing`: no observation.

WhatsApp has three values only: `confirmed` (explicit evidence), `user_asserted` (team member marked it after contact), `unknown`. There is no "probably".

## 6. Website analysis detections (release 1)

Each detection records `observed: yes | no | unknown`, `evidence` (selector, URL, snippet), `confidence` and `analyzedAt`.

- No reachable website (DNS failure, timeout, 4xx or 5xx after retries).
- Not-mobile-friendly indicators: missing viewport meta, fixed-width layout hints, tiny font declarations.
- No observable contact form (no form with email or message fields on home or contact pages).
- No observable booking flow (no booking keywords, links or widgets detected).
- No observable online ordering flow (no cart, order or menu-order patterns detected).
- No observable WhatsApp link.
- No HTTPS or invalid certificate.
- Outdated platform indicators (generator meta for very old CMS versions), reported as the observed version string only.
- Missing basic SEO metadata (title, description).

UI copy must read "No X was detected" rather than "Business has no X". Each suggestion links to its evidence.

## 7. Lead scoring (release 1)

Signals, each with a weight editable per org (defaults in parentheses, summing to 100):

- Contact completeness (20): phone, email, website, address present.
- Contact verification (15): share of present fields in `verified` state.
- Website opportunity (20): count of opportunity detections with confidence at or above 0.7.
- Industry match (15): business category in the org's ideal customer profile (ICP) categories.
- Location match (15): within ICP locations.
- Freshness (10): age of the most recent observation.
- Source reliability (5): weighted by source trust configuration.

Score = sum of weight times signal (each signal 0 to 1). Shown with a breakdown table and the sentence: "Score reflects fit with your configured criteria. It is not a prediction of purchase intent."

Two separate numbers are shown: **Data confidence** (quality of the record) and **Fit score** (commercial match). They are never blended into one.

## 8. Credits and plans (to be approved)

Charging events:

| Event                                 | Charge                                                                         | When                                                                       |
| ------------------------------------- | ------------------------------------------------------------------------------ | -------------------------------------------------------------------------- |
| Discovery job                         | 1 credit per produced business record (new, or existing with new observations) | Hold `maxRecords` at queue; capture actual at completion; release the rest |
| Website analysis                      | 1 credit per analysis                                                          | Hold at queue; capture on completion; release on failure                   |
| Email verification (release 1 checks) | 0                                                                              | Included                                                                   |
| CSV import                            | 0                                                                              | Included                                                                   |
| Export                                | 0                                                                              | Included, rows capped per plan                                             |

Failed or cancelled jobs: credits are captured only for items that completed successfully before failure or cancellation. Items that fail because of our error (not source refusal) are not billed.

Plans are seeded from configuration and displayed from the backend. Seeded prices are placeholders flagged `is_placeholder = true`, and the pricing page shows a "Pricing not yet published" notice while that flag is set. No invented numbers are shown as final.

## 9. Page inventory

### Marketing `(marketing)`

| Route                                                                               | Purpose                                                                                                                                                              | Data                                          |
| ----------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------- |
| `/`                                                                                 | Home: hero, interface preview, discovery, enrichment and qualification sections, workflow, sources, security and provenance, pricing preview, FAQ, final CTA, footer | Plans from API; no fabricated metrics         |
| `/product`                                                                          | Feature deep-dive                                                                                                                                                    | static                                        |
| `/pricing`                                                                          | Plans and credit packs                                                                                                                                               | Plans from API                                |
| `/about`                                                                            | Mission, Nigeria focus, expansion                                                                                                                                    | static                                        |
| `/contact`                                                                          | Contact form                                                                                                                                                         | POST `/api/v1/public/contact` with rate limit |
| `/legal/privacy`, `/legal/terms`, `/legal/acceptable-use`, `/legal/data-collection` | Legal                                                                                                                                                                | static                                        |

### Auth `(auth)`

`/sign-up`, `/sign-in`, `/verify-email`, `/forgot-password`, `/reset-password`, `/invite/[token]`.

### Dashboard `(app)` under `/app`

| Group      | Route                                                                  | Status in release 1                   |
| ---------- | ---------------------------------------------------------------------- | ------------------------------------- |
| Workspace  | `/app` Overview                                                        | Implemented                           |
|            | `/app/businesses` Directory                                            | Implemented                           |
|            | `/app/businesses/[id]` Detail                                          | Implemented                           |
|            | `/app/discovery`, `/app/discovery/new`, `/app/discovery/[id]`          | Implemented                           |
|            | `/app/lists`, `/app/lists/[id]`                                        | Implemented                           |
|            | `/app/analysis` Website analyses                                       | Implemented                           |
|            | `/app/reports`                                                         | Implemented                           |
| Sales      | `/app/pipeline`                                                        | Implemented                           |
|            | `/app/activities`                                                      | Implemented                           |
|            | `/app/outreach`                                                        | Implemented                           |
| Automation | `/app/jobs` All background jobs (discovery, analysis, export)          | Implemented                           |
|            | `/app/jobs/scheduled`                                                  | Disabled, "Coming soon"               |
|            | `/app/sources` Source registry, coverage, policy                       | Implemented (read, enable or disable) |
| Account    | `/app/usage`                                                           | Implemented                           |
|            | `/app/billing`                                                         | Implemented                           |
|            | `/app/team`                                                            | Implemented                           |
|            | `/app/settings` (profile, organization, notifications, security, data) | Implemented; API keys tab disabled    |

## 10. Acceptance criteria (release 1)

The sixteen criteria in the brief's Final Acceptance Criteria are adopted verbatim as the release checklist, with these measurable additions:

- Layouts verified at 240, 320, 375, 768, 1024 and 1440 px with no horizontal page overflow.
- Keyboard-only traversal of every dashboard page.
- Tenant isolation suite: zero cross-org reads across all list and detail endpoints, exports and job payloads.
- Duplicate webhook test: delivering the same Paystack event 10 times concurrently yields exactly one payment row and one credit grant.
- Concurrent credit consumption test: 50 parallel holds against a balance that covers 10 yields exactly 10 successes.
- Retry test: a discovery item that fails twice with a retryable error and then succeeds is billed once.
