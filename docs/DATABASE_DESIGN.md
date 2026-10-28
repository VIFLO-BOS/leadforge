# LeadForge Database Design

Status: identity, billing schema (Phase 1), business records, provenance and CSV import (Phase 2), discovery jobs, credits, source settings, notifications and source retention (Phase 3), enrichment runs, website analyses, scoring profiles, duplicate candidates and merge history (Phase 4), and lead lists, leads, pipeline configs, activities, outreach records, bulk operations, export jobs and usage aggregates (Phase 5) shipped; billing (Phase 6) shipped; Phase 7 added one `businesses` index, documented the Redis keys and the backup and restore procedure. Stage 10 added the organization deletion workflow (four `organizations` columns, `organization_erasures`, the purge) and the `organization_data_exports` collection. Last updated 2026-10-28.

Two databases, strict ownership. MongoDB holds business intelligence. PostgreSQL holds identity and money. Nothing authoritative is duplicated across them.

## 1. Conventions

- PostgreSQL IDs: UUID v7 generated in the application; timestamps `timestamptz`; money as `bigint` minor units plus `char(3)` currency.
- MongoDB IDs: `ObjectId` for `_id`; `organizationId` is the PostgreSQL UUID as a string; timestamps are BSON dates; every collection has a JSON Schema validator (`validationLevel: moderate`).
- Soft delete only where workflows need it (businesses, leads); hard delete for tokens and ephemeral data.
- Every org-scoped collection's indexes begin with `organizationId`.
- **Exception: platform-level reference data.** `overture_places` (the Overture Maps Places staging catalogue) and `overture_sync_runs` hold no organization data: the same open-data catalogue serves every organization, only the Overture sync writes it, and organizations only read it through discovery. They have no `organizationId`, their repositories (`OverturePlaceRepository`, `OvertureSyncRunRepository`) are not `OrgScopedRepository` subclasses and say why, and the db-mongo index test lists them as exempt. Whatever an organization keeps from them is copied into its own `businesses` and `source_observations` through the normal org-scoped ingest.

## 2. MongoDB collections

### `businesses` (canonical profile, one per org per business; shipped in Phase 2)

Every contact-bearing field stores the field model from `docs/PRODUCT_REQUIREMENTS.md` section 5. The persisted `state` is only `verified`, `unverified` or `conflicting`; `stale` (older than the organization's `freshness_days`), `expired` (past `expiresAt`) and `missing` are derived when read, so changing the freshness window needs no migration.

```
FieldMeta = { state: "verified" | "unverified" | "conflicting", confidence (0..1),
              observationIds: [ObjectId] (newest last, capped at 50),
              lastObservedAt, lastVerifiedAt, expiresAt }

{
  _id, organizationId,
  name:      { value, rawValue, normalized, ...FieldMeta },     // normalized = dedup key: lowercase, no diacritics or
                                                                // punctuation, trailing Ltd/Limited/PLC/Inc/LLC/Co removed
  slug,                                                         // org-unique: slug(name + locality), suffixed on collision
  categories: [{ value, key (lowercase), taxonomy: "leadforge" | "google" | "overture" | "user", observationIds, expiresAt? }],   // max 20
  location: {
    formatted, street, locality, lga, region, country (ISO 3166-1 alpha-2), postalCode, rawValue,
    regionKey, localityKey, lgaKey,                             // lowercase filter keys; Nigerian states canonicalized
    alternatives: [{ value: {formatted, street, locality, lga, region, country, postalCode}, rawValue, observationIds, lastObservedAt }],
    ...FieldMeta                                                // all parts null and observationIds [] when unknown
  },
  website: { value (canonical URL), rawValue, domain (lowercase punycode host without www.),
             alternatives: [{ value, rawValue, observationIds, lastObservedAt }], ...FieldMeta } | null,
  phones: [{                                                    // max 20
    e164, raw, national, international, country (of the number), type: "mobile" | "fixed_line" | "fixed_line_or_mobile" | "toll_free" | "voip" | "other" | "unknown",
    whatsapp: { status: "confirmed" | "user_asserted" | "unknown", evidenceObservationId, assertedByUserId, assertedAt },
    ...FieldMeta
  }],
  emails: [{ address, raw, domain, verification: { method, result, checkedAt } | null, ...FieldMeta }],   // max 20
  socials: [{ platform: "facebook" | "instagram" | "linkedin" | "x" | "tiktok" | "youtube", url, handle, raw, ...FieldMeta }],
  externalRefs: [{ source, externalId, lastFetchedAt, expiresAt,       // Phase 3: source records (Google place IDs; Overture GERS ids); max 20
                  matchKeys?,                                        // Overture: other keys of the same place (gers:<id> of its duplicates, up:<dataset>:<record id>); max 40
                  discoveryJobId?,                                   // the job that first linked the record
                  release?, dataset?, recordId?, license? }],        // Overture: release, upstream dataset and record, licence (export columns, attribution)
  sourceSeen: { <sourceKey>: { firstSeenAt, lastSeenAt } },     // per-source first and last observation
  sources: [sourceKey],                                         // keys of sourceSeen, for the source filter and facets
  importIds: [ObjectId],                                        // imports that created or updated the record
  whatsappStatus,                                               // best status across phones
  lastVerifiedAt, lastObservedAt,                               // max across fields
  score: { fit, dataConfidence, computedAt, profileId, profileVersion,          // Phase 4: two separate 0..100 numbers
           breakdown: [{ signal, weight, value, points, detail }],              // the seven signals
           dataConfidenceFields: [{ field, state, confidence, quality }], summary } | null,
  latestAnalysis: { analysisId, status, analyzedAt, opportunities: [key] } | null,   // Phase 4: latest completed analysis
  dedup: { status: "unique" | "has_candidates" | "merged_into", mergedIntoId, candidateCount,
           absorbedIds: [ObjectId] },                          // Phase 4: records merged into this one
  dedupKeys: [string],                                          // Phase 4: "<name token>|l:<localityKey>", "<token>|g:<lgaKey>" (max 8)
  flags: { suppressed, suppressedReason, suppressedAt, suppressedByUserId, doNotContact },
  search: { tokens: [string] },                                 // max 200, see "Search" below
  createdVia: { kind: "import" | "manual" | "discovery" | "seed", importId, userId, discoveryJobId },
  retention: { nextExpiryAt },                                  // Phase 3: earliest expiresAt among stored values; drives the purge
  version,                                                      // optimistic concurrency, +1 on every write
  createdAt, updatedAt, deletedAt
}
```

Writes are read-modify-write with a version check (`replaceOne({ _id, organizationId, version })`); a lost race reloads and re-applies, up to three times. Ingest merges never overwrite: multi-valued fields are unioned, agreeing values gain an observation id, and a disagreeing website or location becomes `conflicting` with the new value appended to `alternatives` (max 10). A user correction replaces the value, clears `alternatives` and sets `unverified`.

Source retention (Phase 3). Values from a retention-limited source carry `expiresAt` (fields, categories and alternatives). Observing a value again combines expiries: if any source without a limit observed it, `expiresAt` becomes `null` (corroborated); between two limited sources the later end wins. When a newer observation arrives for a value already past its expiry (judged at the new observation's collection time), the name, website or location is replaced instead of being marked conflicting. Expired values are hidden on every read and export. The retention purge (worker, every 10 minutes) removes them from storage: expired phones, emails, socials, categories and alternatives are dropped, an expired website or location is cleared, and an expired name is replaced by the label "Name expired under source terms" with `rawValue: null` and an empty `normalized` key (so it never drives identifier dedup); `externalRefs` stay so the record can be refreshed.

Derived Phase 4 fields. `score` is written by the scoring worker without bumping `version` (it is a derived snapshot; a data write that races it carries the older score and queues a recompute for the business). `latestAnalysis` is a data write (version bump) and only a newer analysis replaces it. `dedupKeys` is recomputed on every write from the normalized name and the location keys (up to four distinctive name tokens, longest first, each paired with the locality key and the LGA key); the dedup scan backfills it on older records. A merged record keeps its document with `deletedAt` set, `dedup.status = "merged_into"` and `dedup.mergedIntoId`; the survivor lists it in `dedup.absorbedIds`, and provenance reads for the survivor include the absorbed ids.

Exact dedup at ingest has four stages: 0, the source record (`externalRefs.source` + `externalId`, an Overture GERS id or a Google place ID, or for Overture any shared `externalRefs.matchKeys` entry: the same upstream record under another GERS id), which matches regardless of name; 1 to 3, exact website domain, phone and email with the same normalized name. Two different records of the same source (two place IDs) are never merged, so chain branches sharing a name and website stay separate with a `POSSIBLE_DUPLICATE` warning.

Search: Phase 1 planned a text index or Atlas Search. Phase 2 ships prefix search over `search.tokens` instead, because it works the same on local MongoDB and Atlas, matches as the user types, and stays organization-scoped in one compound index. Tokens are the lowercase, diacritic-free words of the name, categories, locality, LGA, region, street, social handles and email addresses, plus the whole website domain and email addresses, the E.164 digits, the national digits and the national digits without the trunk 0. A query becomes anchored, escaped prefix regexes (`$all` for several words) on `{ organizationId, search.tokens }`; a phone-like query collapses to one digit string.

Indexes (all prefixed with `organizationId` except the geo index):

| Index                                                                                                       | Serves                                                                                                                                                                          |
| ----------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `{ organizationId, slug }` unique                                                                           | slug lookups, slug uniqueness                                                                                                                                                   |
| `{ organizationId, flags.suppressed, deletedAt }`                                                           | Phase 7: the directory's first-page total for the default view (live, unsuppressed) is a `COUNT_SCAN` with no document reads (at 100k businesses: 4 ms instead of 88 to 460 ms) |
| `{ organizationId, website.domain }` partial on `website.domain` existing                                   | exact domain dedup, `hasWebsite=true`                                                                                                                                           |
| `{ organizationId, phones.e164 }`                                                                           | exact phone dedup, suppression matching                                                                                                                                         |
| `{ organizationId, emails.address }` (not unique: shared emails are legitimate)                             | exact email dedup                                                                                                                                                               |
| `{ organizationId, search.tokens }`                                                                         | `q`                                                                                                                                                                             |
| `{ organizationId, categories.key, updatedAt: -1 }`                                                         | `category`                                                                                                                                                                      |
| `{ organizationId, location.regionKey, location.localityKey }`                                              | `region`, `region` + `locality`                                                                                                                                                 |
| `{ organizationId, location.lgaKey }`                                                                       | `lga`                                                                                                                                                                           |
| `{ organizationId, sources }`                                                                               | `source`, source facet and overview breakdown                                                                                                                                   |
| `{ organizationId, phones.state }`, `{ organizationId, emails.state }`, `{ organizationId, website.state }` | field-state filters                                                                                                                                                             |
| `{ organizationId, whatsappStatus }`                                                                        | `whatsapp`                                                                                                                                                                      |
| `{ organizationId, importIds }`                                                                             | `importId`                                                                                                                                                                      |
| `{ organizationId, updatedAt: -1, _id: -1 }`                                                                | default sort                                                                                                                                                                    |
| `{ organizationId, createdAt: -1, _id: -1 }`                                                                | `sort=createdAt`                                                                                                                                                                |
| `{ organizationId, name.normalized: 1, _id: 1 }`                                                            | `sort=name`                                                                                                                                                                     |
| `{ organizationId, lastVerifiedAt: -1, _id: -1 }`                                                           | `sort=lastVerifiedAt`                                                                                                                                                           |
| `{ organizationId, score.fit: -1, _id: -1 }`                                                                | `sort=fit`, `fitMin`/`fitMax` (Phase 4)                                                                                                                                         |
| `{ organizationId, score.dataConfidence: -1, _id: -1 }`                                                     | `sort=dataConfidence`, `dataConfidenceMin`/`Max` (Phase 4)                                                                                                                      |
| `{ organizationId, dedupKeys }`                                                                             | similarity candidate blocking (Phase 4)                                                                                                                                         |
| `{ score.computedAt }` partial on `$type: "date"` (not organization-prefixed: maintenance query)            | daily score refresh (Phase 4)                                                                                                                                                   |
| `{ organizationId, externalRefs.source, externalRefs.externalId }`                                          | dedup stage 0 by place ID, source refresh (Phase 3)                                                                                                                             |
| `{ organizationId, externalRefs.matchKeys }` partial (keys exist)                                           | Overture dedup stage 0 by group key; leaving out places already in the directory (Stage 4)                                                                                      |
| `{ retention.nextExpiryAt }` partial on `$type: "date"` (not organization-prefixed: maintenance query)      | retention purge (Phase 3)                                                                                                                                                       |
| `{ location.geo: "2dsphere" }` sparse                                                                       | radius search (planned; LeadForge does not request Google coordinates)                                                                                                          |

The sync drops two Phase 1 indexes that Phase 2 replaced: `business_text` and `organizationId_1_categories.value_1_location.locality_1`. An integration test runs `explain` on every directory filter shape under every sort (17 filter shapes, including the Phase 4 score ranges, under 6 sorts, including `fit` and `dataConfidence`) and fails on any `COLLSCAN`. The validator (moderate) adds `score.fit` and `score.dataConfidence` in 0..100 and `dedupKeys` as at most 20 strings.

Document growth is bounded: `observationIds` arrays are capped at 50 per field; older IDs are dropped from the array while the observations themselves remain queryable by `businessId`. Arrays of phones, emails, socials and categories are capped at 20, alternatives at 10.

### `source_observations` (immutable provenance)

```
{
  _id, organizationId, businessId, source: "overture_places" | "google_places" | "website" | "user_import" | "user_edit",
  sourceRef,                                   // URL, API path, or "import:<importId>" for imports
  sourceExternalId,
  field: "name" | "website" | "phone" | "email" | "social" | "category" | "location" | "whatsapp" | "hours" | "description",
  fieldKey,                                    // which value of a multi-valued field: E.164, email, domain, category key, social URL
  rawValue (max 4,000 chars), normalizedValue (string, string array or object),
  collectedAt, collectionMethod: "api" | "dataset_snapshot" | "website_fetch" | "user_import" | "user_edit",   // dataset_snapshot: Overture
  verification: { method, status: "verified" | "unverified" | "failed", checkedAt, details } | null,
  confidence,                                  // source base: user_edit 0.8, google_places 0.8, website 0.7, user_import 0.6, overture_places 0.6
                                               // (Overture's own existence score is kept in metadata.overture.confidence)
  importId,                                    // present only on imported observations
  discoveryJobId,                              // Phase 3: present only on discovered observations
  enrichmentRunId,                             // Phase 4: present only on website observations (sparse index)
  actor: { type: "user" | "system", userId },
  note,                                        // correction note
  action: "set" | "remove",                    // "remove" records a correction that deleted a value
  policy: { retainValueUntil } | null,         // only for retention-limited sources (Google Places: collectedAt + 0)
  redactedAt,                                  // set when the value was removed per policy; metadata kept
  metadata                                     // imports: { rowNumber, fileName }; discovery: { round, attribution };
                                               // Overture: { overture: { release, schemaVersion, gersId, featureVersion, confidence,
                                               //   upstream: { dataset, recordId, license, updateTime, provider, version } } }
                                               // website (Phase 4): { evidence: { page, selector, snippet }, ownSite, type?, platform?, method? }
}
```

Indexes: `{ organizationId, businessId, collectedAt: -1, _id: -1 }` (provenance list; Phase 4 reads it with `businessId: { $in: [survivor, ...absorbedIds] }`), `{ organizationId, businessId, field, collectedAt: -1, _id: -1 }` (field filter), `{ organizationId, source, collectedAt: -1 }`, `{ organizationId, importId }` sparse, `{ organizationId, discoveryJobId }` sparse, `{ organizationId, enrichmentRunId }` sparse (Phase 4), `{ policy.retainValueUntil }` sparse for the redaction job. Website observations (Phase 4) have source `website`, collection method `website_fetch`, `sourceRef` = the page URL, confidence 0.7, a system actor, and ids derived from `enrichment:<runId>:obs:<n>` so a retried run inserts nothing twice. The sync drops the Phase 1 index `organizationId_1_businessId_1_field_1_collectedAt_-1`. No TTL index: a scheduled job redacts `rawValue` and `normalizedValue` after `retainValueUntil` so the fact that "field X was observed from source Y on date Z" survives without the restricted value.

Observation ids for imported rows are derived from `import:<importId>:row:<rowNumber>:obs:<n>` (first 4 bytes the commit time, last 8 bytes a SHA-256 prefix), so reprocessing a row inserts nothing new. Discovered observations use `discovery:<jobId>:<source>:<externalId>:obs:<n>` with the job's creation time, and the business id for a new record `discovery:<jobId>:<source>:<externalId>:business`, so reprocessing a page (a retry, or a crash before the item outcome was written) adds nothing.

Redaction (Phase 3, shipped): the `purge-expired-content` job sets `rawValue`, `normalizedValue` and `fieldKey` (which can hold an E.164 number or a domain) to `null` and stamps `redactedAt` on every observation whose `policy.retainValueUntil` has passed; reads hide those values before the job runs.

### `verification_events`

`{ _id, organizationId, businessId, field, fieldKey (E.164 or address), method, result: "passed" | "failed" | "inconclusive", details, actorType: "system" | "user", actorId, occurredAt }`. Index `{ organizationId, businessId, occurredAt: -1, _id: -1 }` (the sync drops the Phase 1 index without `_id`). Written by enrichment (Phase 4), with ids derived from `enrichment:<runId>:ve:<n>` (a retried run writes each event once). Methods: `website_presence` (phone valid and on the own site: passed), `whatsapp_link` and `whatsapp_label` (explicit WhatsApp evidence on the own site: passed), and three per email check: `email_syntax`, `email_mx` (failed when there is no MX or a null MX, inconclusive on DNS errors) and `email_disposable` (failed for a disposable domain). There is no SMTP check, so no email event ever makes an email `verified`.

### `import_jobs` (Phase 2)

```
{
  _id, organizationId, status: "uploaded" | "queued" | "processing" | "completed" | "completed_with_errors" | "failed",
  fileName (sanitized, max 255), contentType, sizeBytes, sha256, encoding, delimiter,
  headers: [string] (max 100), rowCount, blankRowsSkipped, sampleRows: [[string]] (first 5 rows, cells cut at 200 chars),
  suggestedMapping: [{ column, field }], mapping: [{ column, field }] | null, defaultCountry,
  attestation: { userId, at } | null,          // lawful-basis attestation given at commit
  progress: { total, processed, created, updated, suppressed, failed },
  error: { code, message } | null,
  createdByUserId, committedByUserId,
  createdAt, updatedAt, queuedAt, startedAt, finishedAt,
  rowsExpireAt,                                // createdAt + 30 days; when import_rows are removed
  queue: { jobId }                             // BullMQ job id "import-<importId>"
}
```

Indexes: `{ organizationId, createdAt: -1, _id: -1 }` (list), `{ organizationId, status, createdAt: -1 }` (status filter, overview in-progress count). Status changes are atomic `findOneAndUpdate` transitions guarded by the current status (a second commit finds no `uploaded` job and gets 409).

### `import_rows` (Phase 2, staged rows and per-row report)

`{ _id, organizationId, importId, rowNumber (spreadsheet row, header = 1), cells: [string] (max 100, each cut at 2,001 chars), outcome: null | "created" | "updated" | "suppressed" | "failed", businessId, errors: [{ column, header, field, code, message }], warnings: [...], processedAt, expiresAt }`.

Indexes: `{ organizationId, importId, rowNumber }` unique (file order, preview, resume), `{ organizationId, importId, outcome, rowNumber }` (pending rows for the worker, outcome filter, progress counts), `{ expiresAt }` TTL (expire at the stored time, 30 days after upload). Raw cells are staged here so a committed import can resume after a crash; they are deleted with the report when the TTL passes, while the businesses and observations remain.

### `discovery_jobs` (shipped in Phase 3)

```
{
  _id, organizationId, name,
  status: "draft" | "queued" | "running" | "completed" | "completed_with_warnings" | "failed" | "cancelled",   // draft reserved
  spec: { name, sources: ["overture_places" | "google_places"], location: { country, region, lga, locality, query, geo: { lat, lng, radiusM } },
          categories: [], domainsInclude: [], domainsExclude: [], maxRecords, priorityFields: [],
          confidence: "standard" | "high", requireContact },          // Stage 4: Overture floor 0.5 or 0.7; phone, email or website required
  sourceReleases: [{ source, release }],        // Stage 4: snapshot release read at creation (Overture)
  specHash,                                     // sha256 of the normalized spec; Idempotency-Key replays must match it
  idempotencyKey,                               // per creator; unique with organizationId + createdByUserId
  limit,                                        // billable records the current round may produce (= its hold)
  estimate: { maxRecords, hold, basis },
  round, roundMode: "search" | "retry",         // 0 = first run; each retry-failed adds a round
  units: [{ key, source, externalIds? }],       // round's units: "search-<source>" chains, or "retry-<source>-<n>" batches of 20
  pendingUnits: [unitKey],                      // the round ends when this is empty ($pull, once per unit)
  credits: { rounds: [{ round, holdKey, holdId, heldUnits, capturedUnits, releasedUnits, settledAt }], settledAt },
  progress: { processed, created, updated, duplicates, skipped, failed, billable, pagesFetched, lastEventAt },   // from item records
  pageKeys: ["<source>:<query>:<page>"],        // pages counted once even when a page is retried
  sourceOutcomes: [{ source, status: "pending" | "running" | "completed" | "failed" | "cancelled", pages, records, rateLimited, errors: [{ code, message, count }] }],
  errors: [{ code, message, at, source }], warnings: [...],       // final failures (max 50)
  cancelRequested,
  createdByUserId, createdAt, updatedAt, queuedAt, startedAt, finishedAt, cancelledAt, timeoutAt
}
```

Validator (moderate): required `organizationId, name, status, spec, round, limit, credits, progress, createdByUserId, createdAt, updatedAt`; `spec.sources` items `overture_places` or `google_places` (Google jobs are refused by the API under its terms), `spec.maxRecords` 1..5,000.

| Index                                                                                | Serves                                   |
| ------------------------------------------------------------------------------------ | ---------------------------------------- |
| `{ organizationId, createdAt: -1, _id: -1 }`                                         | job list (cursor)                        |
| `{ organizationId, status, createdAt: -1, _id: -1 }`                                 | status filter, overview counts           |
| `{ organizationId, spec.sources, createdAt: -1, _id: -1 }`                           | source filter                            |
| `{ organizationId, createdByUserId, idempotencyKey }` unique, partial on string keys | Idempotency-Key                          |
| `{ credits.settledAt, status, finishedAt }`                                          | reconciliation: terminal and unsettled   |
| `{ status, timeoutAt }`                                                              | reconciliation: running past the timeout |

The sync drops the Phase 1 names `organizationId_1_createdAt_-1`, `organizationId_1_status_1_createdAt_-1`, `status_1_finishedAt_1` and `credits.settledAt_1_status_1`. Status changes are atomic `findOneAndUpdate` transitions guarded by the current status and round, so a job finalizes once.

### `discovery_job_items` (shipped in Phase 3)

`{ _id, organizationId, jobId, source ("overture_places" | "google_places"), externalId (GERS id or place ID; no place content), round, outcome: "created" | "updated" | "duplicate" | "skipped" | "failed", billable, attempts, businessId, duplicateOfId, error: { code, message, retryable } | null, warnings: [{ code, message }] (max 10), processedAt, createdAt, updatedAt }`.

Writes are upserts keyed by `{ organizationId, jobId, source, externalId }` with `$inc: { attempts: 1 }`; the unique index `{ jobId, source, externalId }` guarantees one item per place per job, so reprocessing a page updates items instead of adding them. A round captures `count({ jobId, round, billable: true })`; an item that failed and later succeeded is one billable item. Indexes: the unique one, `{ organizationId, jobId, _id }` (item list), `{ organizationId, jobId, outcome, _id }` (outcome filter, counts; replaces the Phase 1 `organizationId_1_jobId_1_outcome_1`), `{ organizationId, jobId, round, billable }` (settlement).

### `enrichment_runs` (shipped in Phase 4)

```
{
  _id, organizationId, businessId, kind: "website_contacts" | "email_check",
  status: "queued" | "running" | "completed" | "failed",
  active: true,                                  // only while queued or running
  trigger: "manual" | "refresh",
  input: { url, address },
  output: { pagesVisited: [{ url, status, error }], observationIds: [ObjectId],
            found: { phones, emails, socials, whatsapp }, phonesVerified, whatsappConfirmed,
            emailChecks: [{ address, result: "mx_found" | "no_mx" | "disposable" | "invalid_syntax" | "dns_error" }],
            ownSite },
  error: { code, message } | null, attempts, requestedByUserId,
  createdAt, updatedAt, startedAt, finishedAt
}
```

Indexes: `{ organizationId, businessId, createdAt: -1, _id: -1 }` (runs of a business), `{ organizationId, createdAt: -1, _id: -1 }` (all-jobs merge), `{ organizationId, status, createdAt: -1, _id: -1 }`, unique `{ organizationId, businessId, kind }` partial on `active: true` (named `active_run_per_business_kind`: one queued or running run per business and kind, so a double click reuses it), `{ status, updatedAt }` (maintenance: runs stuck over 30 minutes are failed, queued over 15 minutes re-enqueued). The sync drops the Phase 1 `organizationId_1_businessId_1_startedAt_-1`. Status changes are guarded transitions; finishing unsets `active`.

### `website_analyses` (shipped in Phase 4)

```
{
  _id, organizationId, businessId, url (the business website when queued), finalUrl,
  status: "queued" | "running" | "completed" | "failed", active: true (queued or running only),
  trigger: "single" | "bulk" | "refresh", batchId (bulk requests),
  fetched: { status, redirects: [{ url, status }], bytes, contentType, durationMs,
             tls: { secure, valid, issuer, validTo, error } } | null,
  robots: { fetched, allowed },
  pagesVisited: [{ url, finalUrl, kind: "home" | "contact" | "about" | "services" | "booking", status, error }],
  detections: [{ key, label, observed: "yes" | "no" | "unknown", confidence, evidence: [{ type: "selector" | "url" | "text" | "header", value (max 300 chars), page }], observedValue, analyzedAt }],
  opportunities: [{ key, title, rationale, confidence, detectionKeys: [] }],
  credits: { holdKey, holdId, held: 1, captured, released, settledAt },
  error: { code, message } | null, attempts, requestedByUserId,
  createdAt, updatedAt, queuedAt, startedAt, analyzedAt, finishedAt
}
```

Detection keys: `website_unreachable`, `mobile_unfriendly`, `no_contact_form`, `no_booking_flow`, `no_online_ordering`, `no_whatsapp_link`, `no_https`, `outdated_platform`, `missing_seo_metadata`. Opportunity keys: `website_rebuild`, `mobile_friendly_site`, `contact_form`, `online_booking`, `online_ordering`, `whatsapp_click_to_chat`, `https_setup`, `platform_update`, `seo_basics`. Page content is never stored, only evidence snippets.

Indexes: `{ organizationId, createdAt: -1, _id: -1 }` (list), `{ organizationId, status, createdAt: -1, _id: -1 }`, `{ organizationId, businessId, createdAt: -1, _id: -1 }` (latest per business), `{ organizationId, opportunities.key, createdAt: -1, _id: -1 }` (opportunity filter), `{ organizationId, batchId }` sparse, unique `{ organizationId, businessId }` partial on `active: true` (named `active_analysis_per_business`: a second request for a business with an analysis in progress gets that analysis and holds nothing), `{ status, updatedAt }` and `{ credits.settledAt, status, finishedAt }` (reconciliation). The sync drops the Phase 1 names `organizationId_1_businessId_1_analyzedAt_-1`, `organizationId_1_status_1` and `organizationId_1_opportunities.key_1`. Validator (moderate): required `organizationId, businessId, url, status, trigger, credits, requestedByUserId, createdAt, updatedAt`; status and trigger enums; detections and opportunities at most 20.

### `scoring_profiles` (shipped in Phase 4)

`{ _id, organizationId, name: "Default", isDefault: true, weights: { contactCompleteness, contactVerification, websiteOpportunity, industryMatch, locationMatch, freshness, sourceReliability } (whole numbers 0..100 summing to 100; defaults 20, 15, 20, 15, 15, 10, 5), icp: { categories: [label], locations: [{ country, region, locality }] }, version, recompute: { status: "idle" | "queued" | "running" | "completed" | "failed", profileVersion, processed, total, requestedAt, startedAt, finishedAt, error }, updatedByUserId, createdAt, updatedAt }`. Unique `{ organizationId, name }` and unique `{ organizationId, isDefault }` partial on `isDefault: true` (`one_default_profile`). Created on first read (a concurrent first read loses the insert race and reads the winner). Edits are version-checked (`version` must match) and bump `version`; recompute progress is written only for the version being recomputed, so a newer edit supersedes an older recompute. ICP regions are canonicalized like the directory filter (`Lagos State` becomes `Lagos`).

### `duplicate_candidates` (shipped in Phase 4)

`{ _id, organizationId, businessIds: [a, b] (sorted by id), pairKey: "<a>:<b>", stage: "domain" | "phone" | "email" | "name_location", score (0..1), signals: [{ kind: "name_similarity" | "shared_phone" | "shared_email" | "shared_domain" | "same_locality" | "same_lga", aValue, bValue, similarity }], reasons: [string], status: "pending" | "deferred" | "merged" | "rejected" | "superseded", decidedByUserId, decidedAt, mergeId, createdAt, updatedAt }`.

Indexes: unique `{ organizationId, pairKey }` (one record per pair, so a rejected pair is never proposed again), `{ organizationId, status, score: -1, _id: -1 }` (review queue), `{ organizationId, businessIds, status }` (candidates of a business). The sync drops the Phase 1 unique `organizationId_1_businessIds_1` (a unique multikey index on the pair array would have allowed each business in only one pair) and `organizationId_1_status_1_score_-1`. Scans refresh the score and reasons of open (pending or deferred) pairs and leave decided pairs alone.

Candidate rule (`packages/core/src/dedup/candidate-scoring.ts`): a pair needs corroboration beyond the name (a shared live phone, email or website domain, or the same locality or LGA key; the same state is not enough); with an identifier, name similarity must reach 0.5; with only the place, 0.85. Score = 0.55 x similarity + 0.30 (identifier) + 0.15 (place). Similarity is a one-to-one soft match of distinctive name tokens (Jaro-Winkler 0.88 per token, Dice-style). Nothing is merged automatically.

### `merge_history` (shipped in Phase 4)

`{ _id, organizationId, candidateId, candidateStatusBefore, survivorId, mergedIds: [ObjectId], snapshotBefore: { survivor: <full business document>, merged: [<full business document>] }, versionsAfter: { survivor, merged: [] }, fieldDecisions: [{ field: "name" | "website" | "location", chosenFrom }], supersededCandidates: [{ id, status }], status: "applying" | "applied" | "undone" | "failed", performedByUserId, performedAt, undoneAt, undoneByUserId, undoForced }`. Indexes `{ organizationId, performedAt: -1, _id: -1 }`, `{ organizationId, survivorId, performedAt: -1 }`, `{ organizationId, mergedIds }`, `{ organizationId, candidateId }` sparse; the sync drops the Phase 1 `organizationId_1_survivorId_1`. Retained 2 years (section 8).

Merge: both documents are copied through BSON into `snapshotBefore` before anything is written; the history row is inserted as `applying`; the survivor and the merged record are written with version checks (a failed second write restores the first and marks the history `failed`, `409 MERGE_CONFLICT`). Phones, emails, socials, categories, sources, external references and import ids are unioned (field metadata combined: verified wins, observation ids unioned); name, website and location come from the chosen side, and a differing website or location from the other side is kept in `alternatives`. The merged record gets `deletedAt` and `dedup.mergedIntoId`. Other open candidates of the merged record become `superseded`. Undo writes both snapshots back exactly (only `version` moves forward), restores the candidate statuses, and is refused with `409 MERGE_CONFLICT` when either record changed since the merge unless `force` is sent.

### `lead_lists` and `lead_list_items` (shipped in Phase 5)

`lead_lists`: `{ _id, organizationId, name, nameKey (trimmed, lowercased), description, ownerUserId, itemCount, createdByUserId, createdAt, updatedAt }`. Indexes: unique `{ organizationId, nameKey }` (names unique per organization, case-insensitively; name-prefix search), `{ organizationId, updatedAt: -1, _id: -1 }`, `{ organizationId, createdAt: -1, _id: -1 }`, `{ organizationId, ownerUserId, updatedAt: -1 }`. The sync drops the Phase 1 `organizationId_1_name_1`. `itemCount` is recounted from `lead_list_items` after every change (single, bulk, retry), never incremented, so it stays exact. Deleting a list hard-deletes its items; businesses are untouched.

`lead_list_items`: `{ _id, organizationId, listId, businessId, addedByUserId, addedAt }`. Indexes: unique `{ organizationId, listId, businessId }` (a business is on a list once; adds are upserts, so retries and concurrent adds never duplicate), `{ organizationId, listId, addedAt: -1, _id: -1 }` (list page), `{ organizationId, businessId }` (lists containing a business, list filters). The sync drops the Phase 1 `listId_1_businessId_1`. At most 10,000 items per list (`CRM_LIMITS.listMaxItems`); list filters on leads, activities and outreach resolve the list to at most that many business ids.

### `leads` (pipeline state, separate from business facts and score; shipped in Phase 5)

`{ _id, organizationId, businessId, stageKey, stageEnteredAt, assignedToUserId, assignedAt, priority: "low" | "medium" | "high" | null, nextActionAt, lastActivityAt, lostReason, wonValueMinor, currency, closedAt, closedKind: "won" | "lost" | null, version, createdByUserId, createdAt, updatedAt }`. Indexes: unique `{ organizationId, businessId }` (one lead per business per organization), `{ organizationId, stageKey, updatedAt: -1, _id: -1 }` (board columns), `{ organizationId, assignedToUserId, updatedAt: -1, _id: -1 }`, `{ organizationId, updatedAt: -1, _id: -1 }`, `{ organizationId, createdAt: -1, _id: -1 }`, `{ organizationId, assignedToUserId, nextActionAt: 1, _id: 1 }`, `{ organizationId, nextActionAt: 1, _id: 1 }`, `{ organizationId, closedAt: -1 }` (open leads, won and lost in a period). The sync drops the Phase 1 `organizationId_1_stageKey_1_updatedAt_-1` and `organizationId_1_ownerUserId_1_nextActionAt_1` (the owner field is `assignedToUserId`).

Every stage move, assignment and edit is one `findOneAndUpdate` filtered on `{ _id, organizationId, version }` that sets the fields and increments `version`; a stale version updates nothing and the API answers `409 VERSION_CONFLICT`. `lastActivityAt` is derived and written with `$max` without touching `version`. `closedAt`/`closedKind` are set while the lead is in a won or lost stage.

`pipeline_configs` (shipped in Phase 5): `{ _id, organizationId, version, stages: [{ key, label, kind: "open" | "won" | "lost", order, archived }], createdAt, updatedAt, updatedByUserId }`, unique `{ organizationId }`. Created with the default stages on first read (an upsert, so concurrent first reads create one). Updates are version-checked like leads. Stage keys are immutable; won and lost are never archived; a stage that holds leads cannot be archived (the check counts leads first, so a lead moved in during the same instant can end up in an archived stage, which the board shows with `includeArchived`).

### `lead_activities` (shipped in Phase 5)

`{ _id, organizationId, businessId, leadId, outreachId, type: "note" | "call" | "whatsapp" | "email" | "meeting" | "stage_change" | "assignment", direction: "outbound" | "inbound" | null, outcome, body, target, occurredAt, createdByUserId, createdAt, editedAt, stageChange: { fromStageKey, toStageKey } | null, assignment: { fromUserId, toUserId } | null, suppressionOverride: { reason } | null, bulkOperationId }`. Indexes: `{ organizationId, occurredAt: -1, _id: -1 }`, `{ organizationId, businessId, occurredAt: -1, _id: -1 }`, `{ organizationId, createdByUserId, occurredAt: -1, _id: -1 }`, `{ organizationId, type, occurredAt: -1, _id: -1 }`, `{ organizationId, leadId, occurredAt: -1, _id: -1 }`, `{ organizationId, stageChange.toStageKey, occurredAt: -1 }` (funnel entries). The sync drops the two Phase 1 indexes without `_id`. Logged activities can be edited and hard-deleted by their author or an owner or admin (audited with the content); `stage_change` and `assignment` are system records and are never edited.

### `outreach_records` (shipped in Phase 5)

`{ _id, organizationId, businessId, leadId, channel: "call" | "whatsapp" | "email", target, status: "planned" | "in_progress" | "replied" | "no_response" | "not_interested" | "converted" | "opted_out" | "closed", attempts, lastAttemptAt, lastOutcome, nextAttemptAt, ownerUserId, suppressionOverride: { reason, byUserId, at } | null, version, createdAt, updatedAt }`. Indexes: unique `{ organizationId, businessId, channel }`, `{ organizationId, updatedAt: -1, _id: -1 }`, `{ organizationId, ownerUserId, updatedAt: -1, _id: -1 }`, `{ organizationId, status, updatedAt: -1, _id: -1 }`, `{ organizationId, channel, updatedAt: -1, _id: -1 }`. An outbound call, WhatsApp or email activity increments `attempts` (version-checked, retried) and creates the record on first contact.

### `bulk_operations` and `bulk_operation_items` (shipped in Phase 5)

`bulk_operations`: `{ _id, organizationId, action: "add_to_list" | "remove_from_list" | "assign" | "move_stage", name, params: { listId, assignedToUserId, stageKey }, selection: { kind: "ids" | "filter", filter }, targetIds: [ObjectId] (at most 5,000, resolved and frozen at creation), status: "queued" | "running" | "completed" | "completed_with_errors" | "failed", progress: { total, processed, changed, unchanged, skipped, failed }, breakdown: [{ outcome, count }], error, idempotencyKey, requestHash, requestedByUserId, createdAt, updatedAt, startedAt, finishedAt }`. Indexes: `{ organizationId, createdAt: -1, _id: -1 }`, `{ organizationId, status, createdAt: -1, _id: -1 }`, unique `{ organizationId, requestedByUserId, idempotencyKey }`, and the maintenance index `{ status, updatedAt }` (stuck operations). List reads project `targetIds` away.

`bulk_operation_items`: `{ _id, organizationId, operationId, businessId, outcome, message, processedAt, expiresAt }`. Indexes: unique `{ organizationId, operationId, businessId }` (one result per business; results are upserted with `$setOnInsert`), `{ organizationId, operationId, outcome, _id }`, `{ organizationId, operationId, _id }`, TTL `{ expiresAt }` (30 days). Progress and breakdown are recomputed from these rows after each chunk of 200, and a retried job skips businesses that already have a result.

### `export_jobs` (shipped in Phase 5)

`{ _id, organizationId, kind: "directory" | "list" | "selection", status: "queued" | "running" | "completed" | "failed" | "expired", scope: "all" | "assigned", selection: { filter, listId, listName, ids }, columns, rowCap, matchedAtRequest, rowCount, truncated, progress: { processed, total }, file: { key, name, bytes, sha256, contentType, expiresAt, deletedAt, licenses } | null, error, idempotencyKey, requestHash, requestedByUserId, createdAt, updatedAt, startedAt, finishedAt }`. Indexes: `{ organizationId, createdAt: -1, _id: -1 }`, `{ organizationId, status, createdAt: -1, _id: -1 }`, `{ organizationId, requestedByUserId, createdAt: -1, _id: -1 }`, `{ organizationId, finishedAt: -1 }` (usage rollup), unique partial `{ organizationId, requestedByUserId, idempotencyKey }` (string keys only), and the maintenance indexes `{ file.expiresAt }` (partial on `status: completed`) and `{ status, updatedAt }`. The sync drops the Phase 1 `organizationId_1_createdAt_-1`. The file lives in object storage under `exports/<organizationId>/<exportId>/<name>.zip`; the maintenance job deletes it after `file.expiresAt` (7 days by default) and sets `status: expired` and `file.deletedAt`. Exports stuck without progress for an hour are failed (`TIMED_OUT`).

### `organization_data_exports` (Stage 10)

`{ _id, organizationId, status: "queued" | "running" | "completed" | "failed" | "expired", active, requestedByUserId, idempotencyKey, requestHash, progress: { completedSections, totalSections, currentSection }, sections: [{ key, rows }], file: { key, name, bytes, sha256, contentType, expiresAt, deletedAt } | null, error, createdAt, updatedAt, startedAt, finishedAt }`. Whole-organization data exports (owner only). `active` is true exactly while queued or running, and the unique partial index `one_active_org_export` on `{ organizationId }` (`active: true`) allows one at a time. Other indexes: `{ organizationId, createdAt: -1, _id: -1 }`, unique partial `{ organizationId, requestedByUserId, idempotencyKey }`, and the maintenance indexes `{ file.expiresAt }` (partial on `status: completed`) and `{ status, updatedAt }`. Files live under `org-exports/<organizationId>/<exportId>/<name>.zip` and follow the export file retention (7 days, `cleanup-exports`).

### `suppression_entries`

`{ _id, organizationId, kind: "domain" | "phone" | "email" | "business", value (domain, E.164, address or business id), reason, sourceBusinessId, createdByUserId, createdAt }`. Unique `{ organizationId: 1, kind: 1, value: 1 }`; `{ organizationId: 1, sourceBusinessId: 1 }` sparse (lifting suppression removes the entries created from that business). Checked at ingest (matching rows are skipped and reported), on corrections (a business that gains a suppressed identifier becomes suppressed) and at export (suppressed businesses are never exported); merge checks it, and bulk suppression (`POST /businesses/suppress`, Stage 4) adds entries for up to 100 businesses at once. Suppressing flags every matching business with `flags.suppressed`. A platform-wide list uses `organizationId: null` and is read alongside the organization's entries.

### `overture_places` (Stage 4, platform-level staging catalogue; not organization-scoped)

One document per Overture place in Nigeria, loaded from a release by the Overture sync and normalized once (`packages/core/src/overture`). Discovery jobs read it; nothing else writes it.

```
{
  _id: <GERS id (UUID)>,
  release,                                      // release the stored values were last written from (unchanged places are not rewritten)
  schemaVersion, firstSeenRelease,
  retiredAt, retiredInRelease,                  // set when a release drops the place; the row is kept, never deleted
  featureVersion, contentHash,                  // sha256 of the normalized payload: unchanged places are skipped
  name, nameKey, nameTokens[],                  // tokens for keyword matches when a term maps to no category
  basicCategory, taxonomy: { primary, hierarchy[], alternates[] }, categoryNodes[],   // hierarchy ∪ alternates: a node matches its subtree
  confidence, operatingStatus, closed,
  phones: [{ raw, e164, type, country }],       // type from libphonenumber (mobile, fixed_line, ...)
  emails: [{ raw, address, domain, kind }],     // kind: free_mail | business
  websites: [{ raw, url, domain, kind }],       // kind: website | social | messaging | link_hub | shortener | invalid
  socials: [{ raw, platform, url, handle }],
  brand: { name, wikidata } | null,
  address: { freeform, locality, localityKey, postcode (6 digits or null), regionRaw, country },
  addressTokens[],
  admin: { stateName, stateKey, stateCode (NG-LA), lgaName, lgaKey, regionDivisionId, countyDivisionId },   // point-in-polygon, Overture divisions
  location: { type: "Point", coordinates: [lon, lat] },
  rootSource: { dataset, recordId, license, licenseRaw, updateTime, provider, version },   // the property "" source item
  sources: [{ property, dataset, license, recordId, updateTime, provider, resource, version }],
  licenses[],                                   // every licence among the source items
  upstreamKey,                                  // "up:<dataset>:<record id>", null for Overture-only rows
  socialKeys[],                                 // "fb:<numeric page id>"
  canonicalId, isCanonical, groupKeys[],        // duplicate group: representative, membership keys (gers:<id> and up: keys of every member)
  contacts: { phone, email, website, any, score },
  offerable,                                    // canonical, not closed, not retired: the only rows discovery offers
  syncRunId, createdAt, updatedAt
}
```

Duplicate groups: places sharing `upstreamKey` (the same Facebook page under two GERS ids; 7% of Nigeria) always join; places sharing a numeric Facebook page join only across different datasets and with the same `nameKey` (so chain branches listing one corporate page stay apart). The representative is the highest confidence, then the most contacts, then the lowest id. The database finds candidate rows (aggregations on `upstreamKey` and `socialKeys`); only those are regrouped in the sync.

Validator (moderate): `_id` matches the UUID pattern; required `release, name, nameKey, categoryNodes, confidence, offerable, contentHash, updatedAt`; `licenses` from the licence enum.

| Index                                               | Serves                                          |
| --------------------------------------------------- | ----------------------------------------------- |
| `{ admin.stateKey, categoryNodes, confidence: -1 }` | discovery by state and category                 |
| `{ admin.lgaKey, categoryNodes, confidence: -1 }`   | discovery by LGA (and city names that are LGAs) |
| `{ address.localityKey }`                           | discovery by city                               |
| `{ categoryNodes, confidence: -1 }`                 | nationwide category searches                    |
| `{ location: "2dsphere" }`                          | radius searches                                 |
| `{ nameTokens }`                                    | name keyword fallback                           |
| `{ upstreamKey }` partial (string)                  | duplicate grouping                              |

Kept to what the queries use: each multikey index on `categoryNodes` adds several keys per place on every insert. The sync drops the earlier indexes `lastSeenRelease_1_retiredAt_1`, `address.localityKey_1_categoryNodes_1_confidence_-1`, `categoryNodes_1_confidence_-1_contacts.score_-1__id_1`, `location_2dsphere_categoryNodes_1`, `nameTokens_1_confidence_-1`, `canonicalId_1`, `retiredAt_1` and `offerable_1_confidence_-1_contacts.score_-1__id_1`. Discovery sorts by `confidence` descending, `contacts.score` descending, `_id` ascending; the page token is that triple.

Writes: new places in unordered `insertMany` batches of 1,000, changed places in unordered `updateOne` batches, up to 4 batches in flight, write concern `{ w: 1, j: false }` (the catalogue is rebuilt from the release and every load is idempotent). Unchanged places are not written.

### `overture_sync_runs` (Stage 4, platform-level)

`{ _id, release, schemaVersion, origin: { kind: "s3" | "azure" | "local" | "fixture", location }, trigger: "schedule" | "manual" | "test", status: "running" | "completed" | "completed_with_warnings" | "failed" | "skipped", counts: { read, invalid, inserted, updated, unchanged, retired, restored, withoutState, withoutLga, duplicateGroups, duplicatesHidden, offerable, live }, warnings[], error, summary: { states: [{ key, name, code, places, lgas: [{ key, name, places }] }], categories: [{ node, places }] }, startedAt, heartbeatAt, finishedAt, durationMs }`. The latest completed run is the loaded snapshot (discovery's release, the wizard's state, LGA and category catalogues). Indexes: `{ status, finishedAt: -1 }`, `{ release, status, finishedAt: -1 }`, `{ startedAt: -1 }`, and `one_running_sync`: `{ status: 1 }` unique with `partialFilterExpression: { status: "running" }`.

One sync at a time, as a lease in MongoDB: a sync inserts its run as `running`, and the unique partial index admits only one such run, so two processes that share the database exclude each other even when they use different Redis databases (Stage 4 follow-up: a Redis lock let two local runs overlap). While it runs, the sync refreshes `heartbeatAt` every 30 seconds. A `running` run whose heartbeat (or, for runs recorded before heartbeats, whose start) is more than 10 minutes old belonged to a process that stopped (crash, kill, lost connection): every sync attempt, including one that then skips an already loaded release, first marks such runs `failed` with `error: "The sync process stopped before finishing (no heartbeat since <time>)"`, `finishedAt` and `durationMs`. A sync whose own run was expired that way stops at its next batch (`OvertureSyncLeaseLostError`) and does not overwrite the recorded failure. Concurrent writers would still be harmless to the data (writes are keyed by GERS id and idempotent, and duplicate grouping recomputes from the whole collection), but the lease keeps run records and counts honest.

### `source_configs`

`{ _id, organizationId | null (platform default), sourceKey, enabled, settings, rateLimit, retentionDays, policy, lastHealthAt, lastHealthStatus }`. Unique `{ organizationId: 1, sourceKey: 1 }`. Phase 3 ships the per-organization switch only: `{ organizationId, sourceKey, enabled, updatedAt, updatedByUserId }`, upserted by `PATCH /sources/:key`; no row means enabled. Source policy (retention per field, attribution, rate limits, terms checked) is code (`SourcePolicy` on each adapter), not configuration, so it cannot drift from what the adapter does.

### `notifications` (shipped in Phase 3)

`{ _id, organizationId, userId, type, title, body, href, readAt, dedupeKey, createdAt }`. `dedupeKey` (`discovery:<jobId>:r<round>`, `import:<importId>`) makes each event notify once. Indexes: `{ organizationId, userId, createdAt: -1, _id: -1 }` (list), `{ organizationId, userId, readAt }` (unread count), `{ organizationId, userId, dedupeKey }` unique partial on string keys, TTL 90 days on `createdAt`. The sync drops the Phase 1 `userId_1_readAt_1_createdAt_-1`.

### `audit_events`

`{ _id, organizationId, actorUserId, actorType, action, resourceType, resourceId, before, after, ip, userAgent, requestId, occurredAt }`. Indexes `{ organizationId: 1, occurredAt: -1 }`, `{ organizationId: 1, resourceType: 1, resourceId: 1 }`. Append-only; the application database role has no update or delete privilege on this collection. Stage 10: the organization purge keeps an organization's audit events (the only organization-scoped collection it keeps, `ORGANIZATION_PURGE_RETAINED`), for the audit retention below; the organization data export includes them without `ip` and `userAgent`.

## 3. PostgreSQL schema (Prisma)

### Identity

```
users(id uuid pk, email citext unique, email_verified_at, password_hash, name, avatar_url, locale,
      is_platform_admin bool default false, created_at, updated_at, deleted_at)
sessions(id uuid pk, user_id fk users on delete cascade, refresh_token_hash unique, family_id uuid,
         user_agent, ip, created_at, last_used_at, expires_at, revoked_at)
email_tokens(id uuid pk, user_id fk, purpose enum(verify_email, reset_password), token_hash unique, expires_at, consumed_at)
organizations(id uuid pk, name, slug citext unique, country char(2), default_currency char(3),
              freshness_days int default 180, created_by_user_id fk users, created_at, updated_at, deleted_at, deletion_requested_at,
              deletion_requested_by_user_id uuid, purge_after, deletion_reminder_sent_at, purged_at)   -- Stage 10
organization_erasures(id uuid pk, organization_id uuid unique (no foreign key), requested_at, requested_by_user_id, purge_after,
              trigger text (schedule | reapply), started_at, completed_at, attempts int, steps jsonb, last_error, updated_at)   -- Stage 10
memberships(id uuid pk, organization_id fk on delete cascade, user_id fk on delete cascade,
            role enum(owner, admin, researcher, sales_rep, analyst), status enum(active, suspended), created_at,
            unique(organization_id, user_id))
invitations(id uuid pk, organization_id fk, email citext, role, token_hash unique, invited_by_user_id, expires_at, accepted_at, revoked_at)
  partial unique(organization_id, email) where accepted_at is null and revoked_at is null
api_keys(id uuid pk, organization_id fk, name, key_prefix, key_hash unique, scopes text[], created_by, last_used_at, revoked_at)
  -- table created in Phase 1, feature disabled in release 1
notification_preferences(user_id fk, organization_id fk, email_job_events bool, email_billing bool, inapp_all bool,
                         email_assignments bool default true, updated_at,
                         primary key(user_id, organization_id))
```

### Billing

```
billing_customers(id uuid pk, organization_id fk unique, provider enum(paystack), provider_customer_code unique,
                  email, credit_balance int not null default 0, currency char(3), created_at, updated_at)
plans(id uuid pk, code text unique, name, description, interval enum(monthly, yearly), price_minor bigint, currency char(3),
      included_credits int, max_members int, export_row_cap int, discovery_enabled bool default true,
      website_analysis_enabled bool default true, is_active bool, is_placeholder bool,
      provider_plan_code text unique null, sort_order int, created_at, updated_at)
credit_packs(id uuid pk, code unique, name, credits int, price_minor bigint, currency, is_active, is_placeholder, created_at)
subscriptions(id uuid pk, billing_customer_id fk, plan_id fk, status enum(incomplete, active, past_due, cancelled, expired),
              provider_subscription_code unique null, provider_email_token, current_period_start, current_period_end,
              cancel_at_period_end bool, cancelled_at, past_due_at, ended_at, provider_status, last_synced_at,
              created_at, updated_at, index(status, current_period_end))
invoices(id uuid pk, billing_customer_id fk, subscription_id fk null, number text unique,
         status enum(draft, open, paid, void, uncollectible), subtotal_minor, tax_minor, total_minor, currency,
         issued_at, due_at, paid_at, provider_invoice_code unique null, pdf_key, pdf_generated_at,
         lines jsonb default '[]',   -- [{ description, quantity, unitMinor, amountMinor }], minor units as strings
         bill_to jsonb null,         -- { organizationName, email, country, testMode } frozen at issue
         period_start, period_end)
invoice_counters(scope text pk, last_value int)   -- gap-free numbering, one row per calendar year
payments(id uuid pk, billing_customer_id fk, invoice_id fk null, purpose enum(subscription, credit_pack), purpose_ref uuid,
         provider, provider_reference text unique not null, provider_transaction_id text unique null,
         amount_minor bigint, currency, status enum(pending, success, failed, reversed, abandoned), channel,
         authorization_masked jsonb,     -- last4, brand, bank, expiry only; never PAN
         initiated_at, verified_at, failed_at, reversed_at, last_event_id uuid null, idempotency_key text unique,
         credit_units int null, description, authorization_url, access_code, provider_status, gateway_response,
         paid_at, last_verified_at, verify_attempts int, flag_reason, flagged_at, refunded_minor bigint default 0,
         initiated_by_user_id uuid null, index(status, initiated_at))
refunds(id uuid pk, payment_id fk, provider_refund_reference unique, amount_minor, currency,
        status enum(pending, processed, failed), reason, created_at, processed_at,
        requested_by_user_id uuid null, provider_status, failure_reason, failed_at, reversal_units int null, index(payment_id))
payment_disputes(id uuid pk, billing_customer_id fk, payment_id fk, provider_dispute_id unique,
                 status enum(open, awaiting_merchant, awaiting_bank, resolved), provider_status, resolution,
                 amount_minor bigint null, currency, reason, due_at, opened_at, resolved_at, updated_at)
payment_webhook_events(id uuid pk, provider, provider_event_id text, event_type, reference text, signature_valid bool,
                       payload jsonb, received_at, processed_at, processing_status enum(received, processed, ignored, failed), error,
                       attempts int default 0,
                       unique(provider, provider_event_id), index(reference), index(processing_status, received_at))
credit_ledger(id uuid pk, billing_customer_id fk,
              entry_type enum(grant, purchase, hold, capture, release, adjustment, refund_reversal, expiry),
              units int not null,            -- signed
              captured_units int null,       -- set on capture rows only
              balance_after int not null, reference_type text, reference_id text, reference_name text null, hold_id uuid null fk credit_ledger,
              idempotency_key text unique not null, description, actor_user_id uuid null, created_at)
entitlements(id uuid pk, billing_customer_id fk, key text, value_int, value_bool, source enum(plan, override),
             valid_from, valid_to, unique(billing_customer_id, key, source))
reconciliation_runs(id uuid pk, kind enum(payments, holds, subscriptions, webhooks), started_at, finished_at, checked int, fixed int, errors jsonb)
billing_audit(id uuid pk, billing_customer_id fk, actor_type, actor_id, action, before jsonb, after jsonb, request_id, created_at)
usage_daily(id uuid pk, organization_id fk, day date, metric text, value bigint, updated_at,
            unique(organization_id, day, metric), index(organization_id, metric, day))
contact_submissions(id uuid pk, kind enum(contact, data_request), name, email, company, message, ip_hash, created_at, handled_at)
```

Monetary precision: all `*_minor` columns are `bigint` (Prisma `BigInt`). Paystack amounts in kobo map directly. Credits are integer units, not money.

Phase 5 migration `20261026090000_phase5_crm_usage` adds `credit_ledger.reference_name` (the job or analysis name shown on the Usage page; copied from a hold to its capture and release; null for older rows), `notification_preferences.email_assignments` (default true) and `usage_daily.updated_at` with an `(organization_id, metric, day)` index.

`usage_daily` (Phase 5): one row per organization, UTC day and metric (`credits_used`, `discovery_jobs`, `discovery_records`, `analyses`, `enrichment_runs`, `exports`, `export_rows`). Choice: a rollup, not incremental counters. The worker's `rollup-usage` job (maintenance queue) recomputes whole days from the source records (capture rows of the credit ledger; `discovery_jobs`, `enrichment_runs` and `export_jobs` per day on their `{ organizationId, createdAt }` and `{ organizationId, finishedAt }` indexes; synchronous exports from their `export.created` audit events) and writes absolute values with `INSERT ... ON CONFLICT (organization_id, day, metric) DO UPDATE`. Reruns therefore give the same values, a missed run heals on the next one, and a retried domain event can never be counted twice. Schedule: the last 2 days every 10 minutes, the last 90 days daily (and when the worker starts).

Phase 3 migration `20261025140000_credit_ledger_indexes` adds `credit_ledger(hold_id)` (capture and release lookups) and `credit_ledger(entry_type, created_at)` (open-hold scans). Phase 3 reads and writes `notification_preferences` (in-app and job-email switches) and writes `reconciliation_runs` (`kind = holds`) once per reconciliation pass.

Phase 6 migration `20261026180000_phase6_billing` adds the columns and tables marked above: plan feature flags (`discovery_enabled`, `website_analysis_enabled`), the subscription lifecycle columns (`past_due_at`, `ended_at`, `provider_status`, `last_synced_at`), invoice lines, bill-to, period and PDF timestamps, `invoice_counters`, the payment checkout, verification, flag and refund columns, refund request and failure columns, `payment_disputes`, webhook `attempts`, the `webhooks` reconciliation kind and the indexes for the reconciliation scans.

Paystack webhook payloads carry no event ID. `provider_event_id` is `sha256(event + ":" + data.id + ":" + reference + ":" + subscription_code + ":" + invoice_code + ":" + refund_reference + ":" + data.status + ":" + data.paid)`, where reference is `data.reference`, `data.transaction_reference` or `data.transaction.reference` and the subscription code may be nested in `data.subscription` (subscription and invoice events have no transaction reference). A redelivery of the same event hashes to the same key; a real state change (another status, another invoice) to a new one. Only events with a valid signature are stored (`signature_valid` is always true), so unauthenticated traffic cannot fill the table. The payload field names follow Paystack's documentation as known on 2026-10-26; the live shapes still need checking in test mode (docs/SECURITY_AND_DATA_COLLECTION.md section 8).

Deletion: organization deletion is a workflow (request, 14-day grace, worker purges Mongo collections by `organizationId` and anonymizes PG user rows while retaining billing records for the statutory period). Cascades are limited to sessions, memberships, invitations and preferences. Shipped in Stage 10; see "Organization deletion (Stage 10)" below.

### Organization deletion (Stage 10)

Migration `20261028090000_stage10_org_lifecycle` adds `organizations.deletion_requested_by_user_id`, `purge_after` (indexed), `deletion_reminder_sent_at` and `purged_at`, and the `organization_erasures` table (requests made before it get `purge_after = deletion_requested_at + 14 days`).

1. **Request** (owner, typed name and current password): `deletion_requested_at`, `purge_after` (+14 days) and the requester are set in one conditional update, so a second request (or a race) changes nothing. **Cancel** (owner) clears the four columns while `deleted_at` is still null.
2. **Grace period**: the organization works normally except for new paid or long work (docs/API_CONTRACTS.md, "Organization deletion and data export"). The state is cached in Redis (`lf:org:lifecycle:<org>`, 60 s) and dropped on request, cancel and purge.
3. **Scan** (`scan-organization-deletions`, maintenance queue, every 10 minutes): emails a reminder to owners and admins when `purge_after` is less than 3 days away (once, `deletion_reminder_sent_at`), and enqueues `purge-organization` (job id `purge-org-<org>`, removed on completion or failure so the next scan retries) for every organization with `purge_after <= now` and `purged_at` null.
4. **Purge** (`purge-organization`, `OrganizationPurgeService`): six idempotent steps, each recorded in `organization_erasures.steps` with its counts so a crash resumes after the last finished step:
   - `stop_work`: sets `deleted_at` (the organization is closed: membership checks in the API and every worker refuse it from now on, and cached memberships are dropped); removes the organization's waiting, prioritized, delayed and paused jobs from every organization-scoped queue; marks unfinished discovery jobs cancelled and unfinished imports, enrichment runs, analyses, bulk operations and exports failed. Running jobs stop at their next organization check; an export that still finishes deletes its own file when its record is gone.
   - `subscription`: disables renewal at Paystack for active or past-due subscriptions that still renew (a provider error fails the step and the purge retries); when Paystack is not configured the provider call is skipped and recorded (`providerSkipped`). Locally every active, past-due or incomplete subscription becomes `cancelled` (`ended_at`, `cancelled_at`, billing_audit `subscription.cancelled`, entitlements back to the free tier). No owner notice.
   - `storage`: deletes the files of the organization's export jobs and organization data exports. Invoice PDFs (`invoices/<org>/...`) are kept.
   - `mongo`: `deleteMany({ organizationId })` on every collection of `organizationPurgePlan()` (packages/db-mongo `organization-scope.ts`): every collection whose validator declares `organizationId`, except `audit_events`. The plan is derived from the schema registry, so a new organization-scoped collection is purged without a code change; a unit test and the purge integration test (which scans the live database for collections holding `organizationId` documents) fail if one is ever missed. Global documents are never touched: the Overture catalogue and sync runs have no `organizationId`, and platform rows in `suppression_entries` and `source_configs` have `organizationId: null`, which the exact-id filter never matches.
   - `postgres` (one transaction): deletes the organization's memberships, invitations, notification preferences, API keys and `usage_daily` rows; anonymizes every member with no membership in another organization (email `erased+<userId>@erased.invalid`, a unique placeholder under the reserved `.invalid` TLD; `name` and `password_hash` empty; `email_verified_at`, `avatar_url` and `auth_providers` null; `deleted_at` set; email tokens deleted; sessions revoked in PostgreSQL and in Redis); leaves members of other organizations untouched apart from this membership; replaces `billing_customers.email` with `erased+<orgId>@erased.invalid`.
   - `finalize`: `purged_at` set, `name` replaced by `Deleted organization <first 8 characters of the id>` and `slug` by `deleted-<id>`; the erasure record is completed; an erasure receipt (ids, timestamps, step counts, no personal data) is written to object storage at `erasures/<organizationId>.json`, the audit event `org.purged` is recorded and a structured log line `Organization purged` is written.
5. **Kept for the statutory period**: the organization row (anonymized; invoices, payments and the ledger point at it), `billing_customers` (with `provider_customer_code`), subscriptions, payments (with masked card fields), invoices (with their frozen `bill_to`, which billing law needs) and invoice PDFs, refunds, disputes, the credit ledger, entitlements, `billing_audit`, `payment_webhook_events`, and the organization's `audit_events`. The organization's display name is not needed by billing law once each invoice carries its own bill-to, so it is anonymized.
6. **Re-run**: a completed purge answers `already_purged` and touches nothing. `purge(organizationId, { trigger: "reapply" })` runs every step again; operators use it after restoring a backup older than the purge (docs/OPERATIONS.md).

## 4. Credit ledger semantics

Balance invariant: `billing_customers.credit_balance` equals the signed sum of `credit_ledger.units` for that customer. The balance may be negative only after a `refund_reversal` (Phase 6); while it is, every new hold fails with `CREDIT_BALANCE_NEGATIVE` (402). `grant`, `purchase`, `release` and positive `adjustment` are positive; `hold`, `expiry`, `refund_reversal` and negative `adjustment` are negative.

A hold debits the balance immediately, so settlement must not debit again. The convention for a job that held `h` units and produced `n` billable units is:

- `hold`: `units = -h` (balance drops by h at queue time)
- `release`: `units = +(h - n)` (unused portion returned at settlement)
- `capture`: `units = 0`, with `n` recorded in a `captured_units` column; it exists for reporting and marks the hold closed

The net effect of a settled job is exactly `-n`. From Phase 5 the release row is written only when `h - n > 0`: the capture already closes the hold (open-hold scans look for a capture or a release), so a fully captured hold has a hold and a capture and no 0-unit release. Settling again still finds the capture and records nothing. A `capture` always references its `hold_id` and `n` never exceeds `h`. Tests assert the balance invariant after every scenario, including partial failure and reconciliation.

Hold procedure (one PG transaction):

1. `SELECT ... FROM billing_customers WHERE id = $1 FOR UPDATE`
2. If an entry with this `idempotency_key` exists, return it (no-op).
3. Check `credit_balance >= h`, else raise `INSUFFICIENT_CREDITS`.
4. Insert ledger row, update cached balance, commit.

Settle procedure: under the same lock, insert `capture` and `release` with keys `job:<id>:capture` and `job:<id>:release`; both idempotent. A second settle returns what the first recorded; the capture is clamped to `0..h`.

Shipped in Phase 3 (`CreditsService`, `packages/core/src/credits`):

- Keys: round 0 of a discovery job uses `job:<jobId>:hold|capture|release`; retry-failed round `n` uses `job:<jobId>:retry:<n>:hold|capture|release`. `reference_type = 'discovery_job'`, `reference_id = <jobId>`.
- `h` is min(spec `maxRecords`, what the sources can return), held when the job is created. `n` is the round's billable items (created or updated) counted when the round reaches a terminal status.
- A compensating release (the job could not be saved or queued) inserts only a `release` of `h`; a later settle sees the hold closed and captures nothing.
- Every transaction locks the customer row with `SELECT ... FOR UPDATE` and runs with a 60-second `maxWait` and timeout so a burst of concurrent holds queues instead of failing. Test: 50 parallel holds of 1 against a balance of 10 give exactly 10 holds and 40 `INSUFFICIENT_CREDITS`, and the invariant holds.
- Reconciliation (`reconcile-credits`, billing queue, every 10 minutes): fails running jobs past `timeoutAt`; settles terminal jobs without `credits.settledAt` finished over 5 minutes ago; re-enqueues jobs queued over 15 minutes; settles holds older than 24 hours against their finished job, or releases them in full when no job exists; holds of live jobs are left alone. Each pass writes `reconciliation_runs`.
- Development seed: `grant` of 1,000 credits per seeded organization, key `seed:dev-grant:<orgId>`, described as a development grant (never a purchase).

## 5. Payment workflow (PostgreSQL only; shipped in Phase 6)

1. **Checkout** (`POST /billing/checkout/credits` or `/subscription`, owner or admin, `Idempotency-Key` header required). The price comes from `plans` or `credit_packs`, never from the client. A zero price, or a placeholder price on a live key, is refused (`PRICE_NOT_PUBLISHED`). The API creates the Paystack customer lazily (`billing_customers.provider_customer_code`) and, for a plan, the Paystack plan lazily (`plans.provider_plan_code`, with the database price). It inserts a `payments` row (`status = pending`, `provider_reference = lf-<payment uuid>`, `idempotency_key = checkout:<orgId>:<userId>:<Idempotency-Key>`, `credit_units` and `description` frozen; a subscription checkout first inserts an `incomplete` subscription and points `purpose_ref` at it), then calls Paystack transaction initialize with that reference, the amount in kobo, the customer email, the callback URL and the plan code. The authorization URL is stored so a repeated key returns the same checkout. A provider failure marks the payment `failed` (and the incomplete subscription `expired`): nothing was charged.
2. **Return.** Paystack sends the browser to `<APP_URL>/app/billing/return?reference=...`. The page calls `POST /billing/payments/:reference/verify`, which only queues `verify-payment`, then polls the payment. Nothing is granted by the redirect.
3. **Webhook** (`POST /webhooks/paystack`): optional IP allowlist, then HMAC-SHA512 of the raw body with the secret key compared in constant time; only authentic events are stored (`payment_webhook_events`, unique per derived key, so a redelivery stops there), `process-webhook` is queued and the endpoint returns 200 at once.
4. **Verify and settle** (`verify-payment`, `process-webhook` for `charge.success` and paid `invoice.update`, and reconciliation): the worker calls Paystack transaction verify by reference. Only `status = success` with the same reference, amount and currency settles. In one transaction holding the billing customer row lock (`SELECT ... FOR UPDATE`): the payment is re-read (a final payment is a no-op), the ledger entry is written (`purchase` of the pack's `credit_units`, or `grant` of the plan's `included_credits`, key `payment:<paymentId>:grant`), the subscription becomes `active` with `current_period_start = paid_at` and `current_period_end = paid_at + interval` (Paystack's `next_payment_date` replaces it when the subscription webhooks report it), any other live subscription of the customer is `cancelled` (plan change; it is disabled at Paystack after commit), the plan's entitlements are written, an invoice is numbered and created `paid`, the payment becomes `success` with the masked authorization, and `billing_audit` records it. After commit: the invoice PDF is queued, notices are sent. A replay at any layer finds the payment final or the ledger key taken.
5. **Mismatch.** A `success` whose reference, amount or currency differs from the payment row sets `flag_reason` and `flagged_at` (status stays `pending`), writes `billing_audit` (`payment.verification_mismatch`) and an application audit event, alerts the owners and admins and logs an error. Nothing is granted; reconciliation reports flagged payments every pass and never settles them; a person resolves them with the reference.
6. **Renewals.** Paystack charges a subscription itself, with its own reference. A `charge.success` (or a paid `invoice.update`) whose reference is unknown is verified first; if Paystack confirms a success for a LeadForge customer (`customer_code`) and a matching subscription (by `subscription_code`, else plan code, else the customer's only subscription), a `payments` row is created (`idempotency_key = renewal:<reference>`, amount = the plan price) and settled as above, so a changed Paystack amount is flagged rather than granted.
7. **Failures.** A failed charge sets the payment `failed` (and expires an incomplete subscription); `invoice.payment_failed` sets the subscription `past_due` (`past_due_at`) with a notification and banner; Paystack retries, and a successful retry makes it `active` again. An unpaid checkout older than `BILLING_PENDING_ABANDON_AFTER_HOURS` (24) becomes `abandoned`. A later verified success of an abandoned or failed payment still settles (the money moved).
8. **Refunds and reversals.** `POST /billing/payments/:id/refund` (owner) inserts a `pending` refund and asks Paystack; nothing moves until `refund.processed`, which in one transaction under the customer lock marks the refund `processed`, adds to `payments.refunded_minor` (`reversed` when fully refunded) and writes a negative `refund_reversal` entry (key `refund:<refundId>:reversal`) taking back the payment's credits in proportion (rounded half up; the refund that completes the payment takes exactly the rest). The balance may go negative; a negative balance blocks new holds (`CREDIT_BALANCE_NEGATIVE`) until credits are bought. `refund.failed` marks the refund `failed` and takes nothing. A refund started in the Paystack dashboard arrives as an event without our row and is recorded from it. Disputes (`charge.dispute.*`) are recorded in `payment_disputes`, alerted, and show the payment as under review while open.
9. **Reconciliation** (`reconcile-billing`, billing queue, every 10 minutes; each pass writes a `reconciliation_runs` row): `payments` verifies unflagged pending payments older than `BILLING_PENDING_VERIFY_AFTER_MINUTES` (20) and settles, fails or abandons them; `webhooks` re-enqueues events still `received` (or `failed` with fewer than 10 attempts) 5 minutes after arrival; `subscriptions` cancels subscriptions whose cancel-at-period-end period ended, fetches renewing subscriptions whose period ended over an hour ago without a renewal event from Paystack (a missed renewal charge is verified and settled; `attention` makes it `past_due`; `non-renewing`, `complete` or `cancelled` ends it), expires `past_due` ones `BILLING_PAST_DUE_GRACE_DAYS` (7) after the failure (disabling them at Paystack) and expires incomplete checkouts after 24 hours. Every end recalculates entitlements in the same transaction. Orphan credit holds stay with `reconcile-credits` (kind `holds`).

## 6. Entitlements (shipped in Phase 6)

Keys: `max_members`, `export_row_cap`, `discovery_enabled`, `website_analysis_enabled`, `monthly_included_credits`. The API reads entitlements, never the plan, so overrides are possible. `EntitlementsService.writeForPlanInTx` replaces the customer's `plan` rows inside the transaction that changes the subscription: from the live subscription's plan, or the free tier when none is left (on activation, plan change, cancellation and expiry); `override` rows are never touched and win over `plan` rows. A new organization gets the free tier's rows at registration. A key with no current row falls back to the free tier: `BILLING_FREE_MAX_MEMBERS` (default 5) members, `EXPORT_DEFAULT_ROW_CAP` (10,000) export rows, discovery and website analysis on (they are paid per use with credits), no included credits. Enforcement: member cap on invitation (active members plus live invitations, a re-invite replacing the old one), on acceptance (active members, under a lock on the organization row) and on reactivating a suspended member (`MEMBER_LIMIT_REACHED`); `discovery_enabled` on discovery estimate, create and retry, and `website_analysis_enabled` on analysis requests (`ENTITLEMENT_REQUIRED`); `export_row_cap` on async exports. Included credits are granted at each successful plan payment under the payment's own key (`payment:<id>:grant`), so two genuine charges grant twice and a replayed one never does.

## 7. Migrations and seeds

- Prisma migrations in `packages/db-postgres/prisma/migrations`, applied by `pnpm db:migrate`.
- Mongo validators and indexes applied idempotently by `pnpm db:mongo:sync` (creates missing collections, `collMod`s validators at `moderate` level, ensures indexes, drops the obsolete index names listed per collection). The API test harness runs the same sync against its test database.
- Plans and credit packs come from configuration (`packages/core/src/billing/catalogue.ts`, or the JSON file named by `BILLING_CATALOGUE_PATH`), upserted by code by `pnpm billing:catalogue` (any environment) and by the seed. The built-in catalogue has three placeholder plans and three placeholder credit packs, every price 0 and `is_placeholder = true`; checkout refuses them.
- `pnpm db:seed` creates one synthetic organization named "Acme Demo (Synthetic)", an owner `owner@example.test`, the placeholder plans and credit packs, development entitlement overrides for that organization (`override` rows: 25 members, discovery and website analysis on; no subscription or payment is invented), a development credit grant of 1,000 (ledger `grant`, idempotent key `seed:dev-grant:<orgId>`), and 24 sample businesses whose names end in "(Sample)": two CSV imports run through upload, commit and the worker's processing code (with deliberately invalid rows so the per-row report has content), hand-entered and long-ago observed records (stale), sample website observations with verification events (verified phone and emails, one failed check), one WhatsApp `confirmed` by a sample `wa.me` observation, one `user_asserted`, one conflicting website and one suppressed business. Domains and emails are under the reserved `.test` TLD and phone numbers come from Ofcom's ranges reserved for drama (020 7946 0xxx, 0113/0161/0117 496 0xxx), so no sample value reaches a real business or person. The seed uses deterministic ids and is idempotent. Seeds refuse to run when `NODE_ENV=production`.

## 8. Backup and retention

- Procedure, scripts (`infra/backup/backup.mjs`, `restore.mjs`), RPO and RTO targets, the 2026-10-27 drill and what must not be restored: docs/OPERATIONS.md, "Backup and restore".
- PostgreSQL: provider point-in-time recovery plus a daily logical dump (`pg_dump -Fc`). Dumps kept 7 daily, 5 weekly, 12 monthly.
- MongoDB: Atlas continuous backup plus a daily `mongodump --archive --gzip`, same retention. `audit_events` and `merge_history` retained 2 years (merge history holds full business snapshots, so it follows the same suppression and deletion workflows as `businesses`); `notifications` 90 days; export files and organization data export files 7 days (`EXPORT_FILE_TTL_HOURS`, deleted by the `cleanup-exports` maintenance job); `bulk_operation_items` 30 days (TTL); `import_rows` (staged CSV rows and the per-row report) 30 days after upload by TTL index.
- Billing (Phase 6): payments, invoices, refunds, disputes, the ledger and `billing_audit` are kept for the statutory period (organization deletion anonymizes users but keeps them; Stage 10, "Organization deletion"). Invoice PDFs live in object storage at `invoices/<organizationId>/<invoiceId>.pdf`, outside the export cleanup, and can always be rendered again from the invoice row. `payment_webhook_events` keeps the verified payloads (no card numbers: Paystack sends only masked card fields) for reconciliation and disputes.
- Source content: values with a source retention limit are hidden at `expiresAt` and removed by the purge within 10 minutes (Google Places content: at collection; place IDs kept). Backups taken in between can still hold them until the backup itself expires; after any restore the purge runs before the service reopens (docs/OPERATIONS.md).
- Redis is never backed up: it holds BullMQ queues, rate-limit counters (`throttler` keys), caches (`lf:member:<user>:<org>` 60 s, `lf:facets:<org>` 60 s, `lf:robots:<origin>` 24 h, and from Stage 10 `lf:org:lifecycle:<org>` 60 s, the pending-deletion state) and, from Phase 7, `lf:session-revoked:<sessionId>` (revoked sessions, kept for the access-token lifetime plus a minute) and `lf:login-failures:<hash of email>` (failed sign-ins, 15-minute window). All are rebuilt or harmless to lose; a restore starts with an empty Redis.
