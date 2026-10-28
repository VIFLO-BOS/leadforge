import type { CreateIndexesOptions, Document, IndexSpecification } from "mongodb";
import { Collections } from "../collections.js";

export interface IndexDefinition {
  keys: IndexSpecification;
  options?: CreateIndexesOptions;
}

export interface CollectionDefinition {
  name: string;
  validator: Document;
  indexes: IndexDefinition[];
  /** Index names from earlier releases that the sync drops when present. */
  dropIndexes?: string[];
}

const orgId = { bsonType: "string", description: "PostgreSQL organization UUID" };
const date = { bsonType: "date" };
const nullableDate = { bsonType: ["date", "null"] };
const nullableString = { bsonType: ["string", "null"] };
/** States persisted on a field; stale, expired and missing are derived at read time. */
const storedFieldState = { enum: ["verified", "unverified", "conflicting"] };
const sourceKey = {
  enum: ["google_places", "overture_places", "website", "user_import", "user_edit"],
};
const discoverySourceKey = { enum: ["google_places", "overture_places"] };
const observationField = {
  enum: [
    "name",
    "website",
    "phone",
    "email",
    "social",
    "category",
    "location",
    "whatsapp",
    "hours",
    "description",
  ],
};
const fieldMeta = {
  state: storedFieldState,
  confidence: { bsonType: "number", minimum: 0, maximum: 1 },
  observationIds: { bsonType: "array", maxItems: 50, items: { bsonType: "objectId" } },
  lastObservedAt: nullableDate,
  lastVerifiedAt: nullableDate,
  expiresAt: nullableDate,
};
const importIssue = {
  bsonType: "object",
  required: ["code", "message"],
  properties: {
    column: { bsonType: ["int", "null"] },
    code: { bsonType: "string" },
    message: { bsonType: "string" },
  },
};

/**
 * Release 1 collections with JSON Schema validators and indexes. Applied idempotently by
 * the sync script. Validators are intentionally permissive about optional fields and strict
 * about identifiers, timestamps and enumerations.
 */
export const collectionDefinitions: CollectionDefinition[] = [
  {
    name: Collections.auditEvents,
    validator: {
      $jsonSchema: {
        bsonType: "object",
        required: ["action", "resourceType", "occurredAt"],
        properties: {
          organizationId: {
            bsonType: ["string", "null"],
            description: "null for user-level events",
          },
          actorUserId: { bsonType: ["string", "null"] },
          actorType: { enum: ["user", "system", "platform_admin"] },
          action: { bsonType: "string" },
          resourceType: { bsonType: "string" },
          resourceId: { bsonType: ["string", "null"] },
          before: {},
          after: {},
          ip: { bsonType: ["string", "null"] },
          userAgent: { bsonType: ["string", "null"] },
          requestId: { bsonType: ["string", "null"] },
          occurredAt: date,
        },
      },
    },
    indexes: [
      { keys: { organizationId: 1, occurredAt: -1 } },
      { keys: { organizationId: 1, resourceType: 1, resourceId: 1 } },
      { keys: { actorUserId: 1, occurredAt: -1 } },
    ],
  },
  {
    name: Collections.notifications,
    validator: {
      $jsonSchema: {
        bsonType: "object",
        required: ["organizationId", "userId", "type", "title", "createdAt"],
        properties: {
          organizationId: orgId,
          userId: { bsonType: "string" },
          type: { bsonType: "string" },
          title: { bsonType: "string" },
          body: { bsonType: ["string", "null"] },
          href: { bsonType: ["string", "null"] },
          readAt: { bsonType: ["date", "null"] },
          dedupeKey: { bsonType: ["string", "null"] },
          createdAt: date,
        },
      },
    },
    indexes: [
      { keys: { organizationId: 1, userId: 1, createdAt: -1, _id: -1 } },
      { keys: { organizationId: 1, userId: 1, readAt: 1 } },
      {
        keys: { organizationId: 1, userId: 1, dedupeKey: 1 },
        options: { unique: true, partialFilterExpression: { dedupeKey: { $type: "string" } } },
      },
      { keys: { createdAt: 1 }, options: { expireAfterSeconds: 60 * 60 * 24 * 90 } },
    ],
    dropIndexes: ["userId_1_readAt_1_createdAt_-1"],
  },
  {
    name: Collections.businesses,
    validator: {
      $jsonSchema: {
        bsonType: "object",
        required: [
          "organizationId",
          "name",
          "slug",
          "categories",
          "location",
          "phones",
          "emails",
          "sources",
          "whatsappStatus",
          "flags",
          "search",
          "version",
          "createdAt",
          "updatedAt",
        ],
        properties: {
          organizationId: orgId,
          name: {
            bsonType: "object",
            required: ["value", "normalized", "state"],
            properties: {
              value: { bsonType: "string", minLength: 1, maxLength: 200 },
              rawValue: nullableString,
              normalized: { bsonType: "string" },
              ...fieldMeta,
            },
          },
          slug: { bsonType: "string", minLength: 1 },
          categories: {
            bsonType: "array",
            maxItems: 20,
            items: {
              bsonType: "object",
              required: ["value", "key", "taxonomy"],
              properties: {
                value: { bsonType: "string" },
                key: { bsonType: "string" },
                taxonomy: { enum: ["leadforge", "google", "overture", "user"] },
              },
            },
          },
          location: {
            bsonType: "object",
            required: ["state"],
            properties: {
              country: { bsonType: ["string", "null"], maxLength: 2 },
              regionKey: nullableString,
              localityKey: nullableString,
              lgaKey: nullableString,
              ...fieldMeta,
            },
          },
          website: {
            bsonType: ["object", "null"],
            required: ["value", "domain", "state"],
            properties: {
              value: { bsonType: "string" },
              domain: { bsonType: "string" },
              ...fieldMeta,
            },
          },
          phones: {
            bsonType: "array",
            maxItems: 20,
            items: {
              bsonType: "object",
              required: ["e164", "state", "whatsapp"],
              properties: {
                e164: { bsonType: "string", pattern: "^\\+[1-9][0-9]{4,14}$" },
                whatsapp: {
                  bsonType: "object",
                  required: ["status"],
                  properties: { status: { enum: ["confirmed", "user_asserted", "unknown"] } },
                },
                ...fieldMeta,
              },
            },
          },
          emails: {
            bsonType: "array",
            maxItems: 20,
            items: {
              bsonType: "object",
              required: ["address", "domain", "state"],
              properties: {
                address: { bsonType: "string" },
                domain: { bsonType: "string" },
                ...fieldMeta,
              },
            },
          },
          sources: { bsonType: "array", items: sourceKey },
          importIds: { bsonType: "array", items: { bsonType: "objectId" } },
          whatsappStatus: { enum: ["confirmed", "user_asserted", "unknown"] },
          flags: {
            bsonType: "object",
            required: ["suppressed"],
            properties: { suppressed: { bsonType: "bool" }, doNotContact: { bsonType: "bool" } },
          },
          search: {
            bsonType: "object",
            required: ["tokens"],
            properties: {
              tokens: { bsonType: "array", maxItems: 200, items: { bsonType: "string" } },
            },
          },
          version: { bsonType: "int", minimum: 1 },
          score: {
            bsonType: ["object", "null"],
            properties: {
              fit: { bsonType: ["int", "long", "double"], minimum: 0, maximum: 100 },
              dataConfidence: { bsonType: ["int", "long", "double"], minimum: 0, maximum: 100 },
            },
          },
          dedupKeys: { bsonType: "array", maxItems: 20, items: { bsonType: "string" } },
          lastVerifiedAt: nullableDate,
          createdAt: date,
          updatedAt: date,
          deletedAt: nullableDate,
        },
      },
    },
    indexes: [
      { keys: { organizationId: 1, slug: 1 }, options: { unique: true } },
      // Live records (Phase 7 load test): the directory's first-page total counts live,
      // unsuppressed businesses from this index alone (COUNT_SCAN, no document reads); at 100k
      // businesses that is 4 ms instead of ~90 to 460 ms.
      { keys: { organizationId: 1, "flags.suppressed": 1, deletedAt: 1 } },
      // Exact dedup at ingest and the hasWebsite filter.
      {
        keys: { organizationId: 1, "website.domain": 1 },
        options: { partialFilterExpression: { "website.domain": { $exists: true } } },
      },
      { keys: { organizationId: 1, "phones.e164": 1 } },
      { keys: { organizationId: 1, "emails.address": 1 } },
      // Directory filters.
      { keys: { organizationId: 1, "search.tokens": 1 } },
      { keys: { organizationId: 1, "categories.key": 1, updatedAt: -1 } },
      { keys: { organizationId: 1, "location.regionKey": 1, "location.localityKey": 1 } },
      { keys: { organizationId: 1, "location.lgaKey": 1 } },
      { keys: { organizationId: 1, sources: 1 } },
      { keys: { organizationId: 1, "phones.state": 1 } },
      { keys: { organizationId: 1, "emails.state": 1 } },
      { keys: { organizationId: 1, "website.state": 1 } },
      { keys: { organizationId: 1, whatsappStatus: 1 } },
      { keys: { organizationId: 1, importIds: 1 } },
      // Directory sorts (cursor pagination breaks ties on _id).
      { keys: { organizationId: 1, updatedAt: -1, _id: -1 } },
      { keys: { organizationId: 1, createdAt: -1, _id: -1 } },
      { keys: { organizationId: 1, "name.normalized": 1, _id: 1 } },
      { keys: { organizationId: 1, lastVerifiedAt: -1, _id: -1 } },
      { keys: { organizationId: 1, "score.fit": -1, _id: -1 } },
      { keys: { organizationId: 1, "score.dataConfidence": -1, _id: -1 } },
      // Dedup stage 4 blocking keys (name token + locality or LGA).
      { keys: { organizationId: 1, dedupKeys: 1 } },
      // Maintenance: scores older than a day are refreshed (freshness changes with time).
      {
        keys: { "score.computedAt": 1 },
        options: { partialFilterExpression: { "score.computedAt": { $type: "date" } } },
      },
      { keys: { organizationId: 1, "externalRefs.source": 1, "externalRefs.externalId": 1 } },
      // Overture dedup: other keys of the same real place (duplicate GERS ids, upstream records).
      {
        keys: { organizationId: 1, "externalRefs.matchKeys": 1 },
        options: { partialFilterExpression: { "externalRefs.matchKeys": { $exists: true } } },
      },
      {
        keys: { "retention.nextExpiryAt": 1 },
        options: { partialFilterExpression: { "retention.nextExpiryAt": { $type: "date" } } },
      },
      { keys: { "location.geo": "2dsphere" }, options: { sparse: true } },
    ],
    // Phase 1 shipped a text index; Phase 2 search uses prefix tokens instead.
    dropIndexes: ["business_text", "organizationId_1_categories.value_1_location.locality_1"],
  },
  {
    name: Collections.sourceObservations,
    validator: {
      $jsonSchema: {
        bsonType: "object",
        required: [
          "organizationId",
          "businessId",
          "source",
          "field",
          "collectedAt",
          "collectionMethod",
          "confidence",
        ],
        properties: {
          organizationId: orgId,
          businessId: { bsonType: "objectId" },
          source: sourceKey,
          sourceRef: nullableString,
          field: observationField,
          fieldKey: nullableString,
          rawValue: { bsonType: ["string", "null"], maxLength: 4000 },
          normalizedValue: {},
          collectedAt: date,
          collectionMethod: {
            enum: ["api", "dataset_snapshot", "website_fetch", "user_import", "user_edit"],
          },
          confidence: { bsonType: "number", minimum: 0, maximum: 1 },
          importId: { bsonType: "objectId" },
          discoveryJobId: { bsonType: "objectId" },
          enrichmentRunId: { bsonType: "objectId" },
          sourceExternalId: nullableString,
          action: { enum: ["set", "remove"] },
          redactedAt: nullableDate,
        },
      },
    },
    indexes: [
      { keys: { organizationId: 1, businessId: 1, collectedAt: -1, _id: -1 } },
      { keys: { organizationId: 1, businessId: 1, field: 1, collectedAt: -1, _id: -1 } },
      { keys: { organizationId: 1, source: 1, collectedAt: -1 } },
      { keys: { organizationId: 1, importId: 1 }, options: { sparse: true } },
      { keys: { organizationId: 1, discoveryJobId: 1 }, options: { sparse: true } },
      { keys: { organizationId: 1, enrichmentRunId: 1 }, options: { sparse: true } },
      { keys: { "policy.retainValueUntil": 1 }, options: { sparse: true } },
    ],
    dropIndexes: ["organizationId_1_businessId_1_field_1_collectedAt_-1"],
  },
  {
    name: Collections.verificationEvents,
    validator: {
      $jsonSchema: {
        bsonType: "object",
        required: ["organizationId", "businessId", "field", "method", "result", "occurredAt"],
        properties: {
          organizationId: orgId,
          businessId: { bsonType: "objectId" },
          field: observationField,
          fieldKey: nullableString,
          method: { bsonType: "string" },
          result: { enum: ["passed", "failed", "inconclusive"] },
          actorType: { enum: ["system", "user"] },
          occurredAt: date,
        },
      },
    },
    indexes: [{ keys: { organizationId: 1, businessId: 1, occurredAt: -1, _id: -1 } }],
    dropIndexes: ["organizationId_1_businessId_1_occurredAt_-1"],
  },
  {
    name: Collections.importJobs,
    validator: {
      $jsonSchema: {
        bsonType: "object",
        required: [
          "organizationId",
          "status",
          "fileName",
          "headers",
          "rowCount",
          "progress",
          "createdByUserId",
          "createdAt",
          "updatedAt",
          "rowsExpireAt",
        ],
        properties: {
          organizationId: orgId,
          status: {
            enum: [
              "uploaded",
              "queued",
              "processing",
              "completed",
              "completed_with_errors",
              "failed",
            ],
          },
          fileName: { bsonType: "string", maxLength: 255 },
          sizeBytes: { bsonType: ["int", "long"] },
          headers: { bsonType: "array", maxItems: 100, items: { bsonType: "string" } },
          rowCount: { bsonType: "int", minimum: 0 },
          progress: {
            bsonType: "object",
            required: ["total", "processed", "created", "updated", "suppressed", "failed"],
          },
          createdByUserId: { bsonType: "string" },
          createdAt: date,
          updatedAt: date,
          rowsExpireAt: date,
        },
      },
    },
    indexes: [
      { keys: { organizationId: 1, createdAt: -1, _id: -1 } },
      { keys: { organizationId: 1, status: 1, createdAt: -1 } },
    ],
  },
  {
    name: Collections.importRows,
    validator: {
      $jsonSchema: {
        bsonType: "object",
        required: ["organizationId", "importId", "rowNumber", "cells", "expiresAt"],
        properties: {
          organizationId: orgId,
          importId: { bsonType: "objectId" },
          rowNumber: { bsonType: "int", minimum: 2 },
          cells: { bsonType: "array", maxItems: 100, items: { bsonType: "string" } },
          outcome: { enum: [null, "created", "updated", "suppressed", "failed"] },
          businessId: { bsonType: ["objectId", "null"] },
          errors: { bsonType: "array", items: importIssue },
          warnings: { bsonType: "array", items: importIssue },
          processedAt: nullableDate,
          expiresAt: date,
        },
      },
    },
    indexes: [
      { keys: { organizationId: 1, importId: 1, rowNumber: 1 }, options: { unique: true } },
      { keys: { organizationId: 1, importId: 1, outcome: 1, rowNumber: 1 } },
      { keys: { expiresAt: 1 }, options: { expireAfterSeconds: 0 } },
    ],
  },
  {
    name: Collections.discoveryJobs,
    validator: {
      $jsonSchema: {
        bsonType: "object",
        required: [
          "organizationId",
          "name",
          "status",
          "spec",
          "round",
          "limit",
          "credits",
          "progress",
          "createdByUserId",
          "createdAt",
          "updatedAt",
        ],
        properties: {
          organizationId: orgId,
          name: { bsonType: "string", maxLength: 120 },
          status: {
            enum: [
              "draft",
              "queued",
              "running",
              "completed",
              "completed_with_warnings",
              "failed",
              "cancelled",
            ],
          },
          spec: {
            bsonType: "object",
            required: ["sources", "categories", "maxRecords"],
            properties: {
              sources: { bsonType: "array", minItems: 1, maxItems: 3, items: discoverySourceKey },
              maxRecords: { bsonType: ["int", "long", "double"], minimum: 1, maximum: 5000 },
            },
          },
          idempotencyKey: { bsonType: ["string", "null"], maxLength: 128 },
          round: { bsonType: ["int", "long", "double"], minimum: 0 },
          limit: { bsonType: ["int", "long", "double"], minimum: 0 },
          credits: {
            bsonType: "object",
            required: ["rounds"],
            properties: { rounds: { bsonType: "array" }, settledAt: nullableDate },
          },
          cancelRequested: { bsonType: "bool" },
          createdByUserId: { bsonType: "string" },
          createdAt: date,
          updatedAt: date,
          startedAt: nullableDate,
          finishedAt: nullableDate,
          timeoutAt: nullableDate,
        },
      },
    },
    indexes: [
      { keys: { organizationId: 1, createdAt: -1, _id: -1 } },
      { keys: { organizationId: 1, status: 1, createdAt: -1, _id: -1 } },
      { keys: { organizationId: 1, "spec.sources": 1, createdAt: -1, _id: -1 } },
      {
        keys: { organizationId: 1, createdByUserId: 1, idempotencyKey: 1 },
        options: { unique: true, partialFilterExpression: { idempotencyKey: { $type: "string" } } },
      },
      // Reconciliation: terminal jobs without settlement, and running jobs past their timeout.
      { keys: { "credits.settledAt": 1, status: 1, finishedAt: 1 } },
      { keys: { status: 1, timeoutAt: 1 } },
    ],
    dropIndexes: [
      "organizationId_1_createdAt_-1",
      "organizationId_1_status_1_createdAt_-1",
      "status_1_finishedAt_1",
      "credits.settledAt_1_status_1",
    ],
  },
  {
    name: Collections.discoveryJobItems,
    validator: {
      $jsonSchema: {
        bsonType: "object",
        required: [
          "organizationId",
          "jobId",
          "source",
          "externalId",
          "outcome",
          "round",
          "attempts",
          "billable",
        ],
        properties: {
          organizationId: orgId,
          jobId: { bsonType: "objectId" },
          source: discoverySourceKey,
          externalId: { bsonType: "string", maxLength: 512 },
          outcome: { enum: ["created", "updated", "duplicate", "skipped", "failed"] },
          round: { bsonType: ["int", "long", "double"], minimum: 0 },
          attempts: { bsonType: ["int", "long", "double"], minimum: 0 },
          billable: { bsonType: "bool" },
          businessId: { bsonType: ["objectId", "null"] },
          processedAt: nullableDate,
        },
      },
    },
    indexes: [
      { keys: { jobId: 1, source: 1, externalId: 1 }, options: { unique: true } },
      { keys: { organizationId: 1, jobId: 1, _id: 1 } },
      { keys: { organizationId: 1, jobId: 1, outcome: 1, _id: 1 } },
      { keys: { organizationId: 1, jobId: 1, round: 1, billable: 1 } },
    ],
    dropIndexes: ["organizationId_1_jobId_1_outcome_1"],
  },
  {
    name: Collections.enrichmentRuns,
    validator: {
      $jsonSchema: {
        bsonType: "object",
        required: [
          "organizationId",
          "businessId",
          "kind",
          "status",
          "requestedByUserId",
          "createdAt",
          "updatedAt",
        ],
        properties: {
          organizationId: orgId,
          businessId: { bsonType: "objectId" },
          kind: { enum: ["website_contacts", "email_check"] },
          status: { enum: ["queued", "running", "completed", "failed"] },
          trigger: { enum: ["manual", "refresh"] },
          active: { bsonType: "bool" },
          requestedByUserId: { bsonType: "string" },
          createdAt: date,
          updatedAt: date,
          startedAt: nullableDate,
          finishedAt: nullableDate,
        },
      },
    },
    indexes: [
      { keys: { organizationId: 1, businessId: 1, createdAt: -1, _id: -1 } },
      { keys: { organizationId: 1, createdAt: -1, _id: -1 } },
      { keys: { organizationId: 1, status: 1, createdAt: -1, _id: -1 } },
      // One queued or running run per business and kind: a double click reuses it.
      {
        keys: { organizationId: 1, businessId: 1, kind: 1 },
        options: {
          unique: true,
          partialFilterExpression: { active: true },
          name: "active_run_per_business_kind",
        },
      },
      // Reconciliation: runs stuck in queued or running.
      { keys: { status: 1, updatedAt: 1 } },
    ],
    dropIndexes: ["organizationId_1_businessId_1_startedAt_-1"],
  },
  {
    name: Collections.websiteAnalyses,
    validator: {
      $jsonSchema: {
        bsonType: "object",
        required: [
          "organizationId",
          "businessId",
          "url",
          "status",
          "trigger",
          "credits",
          "requestedByUserId",
          "createdAt",
          "updatedAt",
        ],
        properties: {
          organizationId: orgId,
          businessId: { bsonType: "objectId" },
          url: { bsonType: "string", maxLength: 2048 },
          status: { enum: ["queued", "running", "completed", "failed"] },
          trigger: { enum: ["single", "bulk", "refresh"] },
          active: { bsonType: "bool" },
          batchId: { bsonType: ["objectId", "null"] },
          credits: {
            bsonType: "object",
            required: ["holdKey", "held"],
            properties: {
              holdKey: { bsonType: "string" },
              held: { bsonType: ["int", "long", "double"], minimum: 0 },
              settledAt: nullableDate,
            },
          },
          detections: { bsonType: "array", maxItems: 20 },
          opportunities: { bsonType: "array", maxItems: 20 },
          requestedByUserId: { bsonType: "string" },
          createdAt: date,
          updatedAt: date,
          analyzedAt: nullableDate,
          finishedAt: nullableDate,
        },
      },
    },
    indexes: [
      { keys: { organizationId: 1, createdAt: -1, _id: -1 } },
      { keys: { organizationId: 1, status: 1, createdAt: -1, _id: -1 } },
      { keys: { organizationId: 1, businessId: 1, createdAt: -1, _id: -1 } },
      { keys: { organizationId: 1, "opportunities.key": 1, createdAt: -1, _id: -1 } },
      { keys: { organizationId: 1, batchId: 1 }, options: { sparse: true } },
      // One queued or running analysis per business: a repeat request reuses it (no second hold).
      {
        keys: { organizationId: 1, businessId: 1 },
        options: {
          unique: true,
          partialFilterExpression: { active: true },
          name: "active_analysis_per_business",
        },
      },
      // Reconciliation: stuck runs and terminal analyses whose credits are unsettled.
      { keys: { status: 1, updatedAt: 1 } },
      { keys: { "credits.settledAt": 1, status: 1, finishedAt: 1 } },
    ],
    dropIndexes: [
      "organizationId_1_businessId_1_analyzedAt_-1",
      "organizationId_1_status_1",
      "organizationId_1_opportunities.key_1",
    ],
  },
  {
    name: Collections.scoringProfiles,
    validator: {
      $jsonSchema: {
        bsonType: "object",
        required: [
          "organizationId",
          "name",
          "isDefault",
          "weights",
          "icp",
          "version",
          "createdAt",
          "updatedAt",
        ],
        properties: {
          organizationId: orgId,
          name: { bsonType: "string", maxLength: 80 },
          isDefault: { bsonType: "bool" },
          weights: {
            bsonType: "object",
            required: [
              "contactCompleteness",
              "contactVerification",
              "websiteOpportunity",
              "industryMatch",
              "locationMatch",
              "freshness",
              "sourceReliability",
            ],
          },
          icp: { bsonType: "object", required: ["categories", "locations"] },
          version: { bsonType: ["int", "long"], minimum: 1 },
          createdAt: date,
          updatedAt: date,
        },
      },
    },
    indexes: [
      { keys: { organizationId: 1, name: 1 }, options: { unique: true } },
      {
        keys: { organizationId: 1, isDefault: 1 },
        options: {
          unique: true,
          partialFilterExpression: { isDefault: true },
          name: "one_default_profile",
        },
      },
    ],
  },
  {
    name: Collections.duplicateCandidates,
    validator: {
      $jsonSchema: {
        bsonType: "object",
        required: [
          "organizationId",
          "businessIds",
          "pairKey",
          "stage",
          "score",
          "signals",
          "status",
          "createdAt",
          "updatedAt",
        ],
        properties: {
          organizationId: orgId,
          businessIds: {
            bsonType: "array",
            minItems: 2,
            maxItems: 2,
            items: { bsonType: "objectId" },
          },
          pairKey: { bsonType: "string" },
          stage: { enum: ["phone", "email", "domain", "name_location"] },
          score: { bsonType: ["int", "long", "double"], minimum: 0, maximum: 1 },
          signals: { bsonType: "array", maxItems: 20 },
          status: { enum: ["pending", "deferred", "merged", "rejected", "superseded"] },
          createdAt: date,
          updatedAt: date,
        },
      },
    },
    indexes: [
      // One record per pair, so a rejected pair is never proposed again.
      { keys: { organizationId: 1, pairKey: 1 }, options: { unique: true } },
      { keys: { organizationId: 1, status: 1, score: -1, _id: -1 } },
      { keys: { organizationId: 1, businessIds: 1, status: 1 } },
    ],
    // Phase 1 declared a unique index on the businessIds array, which (being multikey) would
    // have allowed each business in only one pair.
    dropIndexes: ["organizationId_1_businessIds_1", "organizationId_1_status_1_score_-1"],
  },
  {
    name: Collections.mergeHistory,
    validator: {
      $jsonSchema: {
        bsonType: "object",
        required: [
          "organizationId",
          "survivorId",
          "mergedIds",
          "snapshotBefore",
          "status",
          "performedByUserId",
          "performedAt",
        ],
        properties: {
          organizationId: orgId,
          survivorId: { bsonType: "objectId" },
          mergedIds: { bsonType: "array", minItems: 1, items: { bsonType: "objectId" } },
          snapshotBefore: { bsonType: "object", required: ["survivor", "merged"] },
          status: { enum: ["applying", "applied", "undone", "failed"] },
          performedByUserId: { bsonType: "string" },
          performedAt: date,
          undoneAt: nullableDate,
        },
      },
    },
    indexes: [
      { keys: { organizationId: 1, performedAt: -1, _id: -1 } },
      { keys: { organizationId: 1, survivorId: 1, performedAt: -1 } },
      { keys: { organizationId: 1, mergedIds: 1 } },
      { keys: { organizationId: 1, candidateId: 1 }, options: { sparse: true } },
    ],
    dropIndexes: ["organizationId_1_survivorId_1"],
  },
  {
    name: Collections.leadLists,
    validator: {
      $jsonSchema: {
        bsonType: "object",
        required: [
          "organizationId",
          "name",
          "nameKey",
          "ownerUserId",
          "itemCount",
          "createdByUserId",
          "createdAt",
          "updatedAt",
        ],
        properties: {
          organizationId: orgId,
          name: { bsonType: "string", minLength: 1, maxLength: 80 },
          nameKey: { bsonType: "string", minLength: 1, maxLength: 80 },
          description: { bsonType: ["string", "null"], maxLength: 500 },
          ownerUserId: { bsonType: "string" },
          itemCount: { bsonType: ["int", "long"], minimum: 0 },
          createdByUserId: { bsonType: "string" },
          createdAt: date,
          updatedAt: date,
        },
      },
    },
    indexes: [
      // Names are unique per organization, case-insensitively; prefix search uses the same index.
      { keys: { organizationId: 1, nameKey: 1 }, options: { unique: true } },
      { keys: { organizationId: 1, updatedAt: -1, _id: -1 } },
      { keys: { organizationId: 1, createdAt: -1, _id: -1 } },
      { keys: { organizationId: 1, ownerUserId: 1, updatedAt: -1 } },
    ],
    dropIndexes: ["organizationId_1_name_1"],
  },
  {
    name: Collections.leadListItems,
    validator: {
      $jsonSchema: {
        bsonType: "object",
        required: ["organizationId", "listId", "businessId", "addedByUserId", "addedAt"],
        properties: {
          organizationId: orgId,
          listId: { bsonType: "objectId" },
          businessId: { bsonType: "objectId" },
          addedByUserId: { bsonType: "string" },
          addedAt: date,
        },
      },
    },
    indexes: [
      { keys: { organizationId: 1, listId: 1, businessId: 1 }, options: { unique: true } },
      { keys: { organizationId: 1, listId: 1, addedAt: -1, _id: -1 } },
      { keys: { organizationId: 1, businessId: 1 } },
    ],
    dropIndexes: ["listId_1_businessId_1"],
  },
  {
    name: Collections.leads,
    validator: {
      $jsonSchema: {
        bsonType: "object",
        required: [
          "organizationId",
          "businessId",
          "stageKey",
          "stageEnteredAt",
          "version",
          "createdByUserId",
          "createdAt",
          "updatedAt",
        ],
        properties: {
          organizationId: orgId,
          businessId: { bsonType: "objectId" },
          stageKey: { bsonType: "string", pattern: "^[a-z][a-z0-9_]{0,39}$" },
          stageEnteredAt: date,
          assignedToUserId: nullableString,
          priority: { enum: ["low", "medium", "high", null] },
          nextActionAt: nullableDate,
          lastActivityAt: nullableDate,
          lostReason: { bsonType: ["string", "null"], maxLength: 500 },
          wonValueMinor: { bsonType: ["int", "long", "double", "null"], minimum: 0 },
          currency: { bsonType: ["string", "null"], pattern: "^[A-Z]{3}$" },
          closedAt: nullableDate,
          version: { bsonType: ["int", "long"], minimum: 1 },
          createdByUserId: { bsonType: "string" },
          createdAt: date,
          updatedAt: date,
        },
      },
    },
    indexes: [
      // One lead per business per organization.
      { keys: { organizationId: 1, businessId: 1 }, options: { unique: true } },
      { keys: { organizationId: 1, stageKey: 1, updatedAt: -1, _id: -1 } },
      { keys: { organizationId: 1, assignedToUserId: 1, updatedAt: -1, _id: -1 } },
      { keys: { organizationId: 1, updatedAt: -1, _id: -1 } },
      { keys: { organizationId: 1, createdAt: -1, _id: -1 } },
      { keys: { organizationId: 1, assignedToUserId: 1, nextActionAt: 1, _id: 1 } },
      { keys: { organizationId: 1, nextActionAt: 1, _id: 1 } },
      { keys: { organizationId: 1, closedAt: -1 } },
    ],
    dropIndexes: [
      "organizationId_1_stageKey_1_updatedAt_-1",
      "organizationId_1_ownerUserId_1_nextActionAt_1",
    ],
  },
  {
    name: Collections.pipelineConfigs,
    validator: {
      $jsonSchema: {
        bsonType: "object",
        required: ["organizationId", "stages", "version", "createdAt", "updatedAt"],
        properties: {
          organizationId: orgId,
          version: { bsonType: ["int", "long"], minimum: 1 },
          stages: {
            bsonType: "array",
            minItems: 3,
            maxItems: 20,
            items: {
              bsonType: "object",
              required: ["key", "label", "kind", "order", "archived"],
              properties: {
                key: { bsonType: "string", pattern: "^[a-z][a-z0-9_]{0,39}$" },
                label: { bsonType: "string", minLength: 1, maxLength: 40 },
                kind: { enum: ["open", "won", "lost"] },
                order: { bsonType: ["int", "long"], minimum: 0 },
                archived: { bsonType: "bool" },
              },
            },
          },
          createdAt: date,
          updatedAt: date,
        },
      },
    },
    indexes: [{ keys: { organizationId: 1 }, options: { unique: true } }],
  },
  {
    name: Collections.leadActivities,
    validator: {
      $jsonSchema: {
        bsonType: "object",
        required: [
          "organizationId",
          "businessId",
          "type",
          "occurredAt",
          "createdByUserId",
          "createdAt",
        ],
        properties: {
          organizationId: orgId,
          businessId: { bsonType: "objectId" },
          leadId: { bsonType: ["objectId", "null"] },
          outreachId: { bsonType: ["objectId", "null"] },
          type: {
            enum: ["note", "call", "whatsapp", "email", "meeting", "stage_change", "assignment"],
          },
          direction: { enum: ["outbound", "inbound", null] },
          outcome: nullableString,
          body: { bsonType: ["string", "null"], maxLength: 5000 },
          target: { bsonType: ["string", "null"], maxLength: 254 },
          occurredAt: date,
          createdByUserId: { bsonType: "string" },
          createdAt: date,
          editedAt: nullableDate,
        },
      },
    },
    indexes: [
      { keys: { organizationId: 1, occurredAt: -1, _id: -1 } },
      { keys: { organizationId: 1, businessId: 1, occurredAt: -1, _id: -1 } },
      { keys: { organizationId: 1, createdByUserId: 1, occurredAt: -1, _id: -1 } },
      { keys: { organizationId: 1, type: 1, occurredAt: -1, _id: -1 } },
      { keys: { organizationId: 1, leadId: 1, occurredAt: -1, _id: -1 } },
      // Pipeline funnel: stage changes into a stage in a period.
      { keys: { organizationId: 1, "stageChange.toStageKey": 1, occurredAt: -1 } },
    ],
    dropIndexes: [
      "organizationId_1_businessId_1_occurredAt_-1",
      "organizationId_1_createdByUserId_1_occurredAt_-1",
    ],
  },
  {
    name: Collections.outreachRecords,
    validator: {
      $jsonSchema: {
        bsonType: "object",
        required: [
          "organizationId",
          "businessId",
          "channel",
          "status",
          "attempts",
          "ownerUserId",
          "version",
          "createdAt",
          "updatedAt",
        ],
        properties: {
          organizationId: orgId,
          businessId: { bsonType: "objectId" },
          leadId: { bsonType: ["objectId", "null"] },
          channel: { enum: ["call", "whatsapp", "email"] },
          target: { bsonType: ["string", "null"], maxLength: 254 },
          status: {
            enum: [
              "planned",
              "in_progress",
              "replied",
              "no_response",
              "not_interested",
              "converted",
              "opted_out",
              "closed",
            ],
          },
          attempts: { bsonType: ["int", "long"], minimum: 0 },
          lastAttemptAt: nullableDate,
          nextAttemptAt: nullableDate,
          ownerUserId: { bsonType: "string" },
          version: { bsonType: ["int", "long"], minimum: 1 },
          createdAt: date,
          updatedAt: date,
        },
      },
    },
    indexes: [
      { keys: { organizationId: 1, businessId: 1, channel: 1 }, options: { unique: true } },
      { keys: { organizationId: 1, updatedAt: -1, _id: -1 } },
      { keys: { organizationId: 1, ownerUserId: 1, updatedAt: -1, _id: -1 } },
      { keys: { organizationId: 1, status: 1, updatedAt: -1, _id: -1 } },
      { keys: { organizationId: 1, channel: 1, updatedAt: -1, _id: -1 } },
    ],
  },
  {
    name: Collections.bulkOperations,
    validator: {
      $jsonSchema: {
        bsonType: "object",
        required: [
          "organizationId",
          "action",
          "status",
          "targetIds",
          "idempotencyKey",
          "requestHash",
          "requestedByUserId",
          "createdAt",
          "updatedAt",
        ],
        properties: {
          organizationId: orgId,
          action: { enum: ["add_to_list", "remove_from_list", "assign", "move_stage"] },
          status: { enum: ["queued", "running", "completed", "completed_with_errors", "failed"] },
          targetIds: { bsonType: "array", maxItems: 5000, items: { bsonType: "objectId" } },
          idempotencyKey: { bsonType: "string", maxLength: 128 },
          requestHash: { bsonType: "string" },
          requestedByUserId: { bsonType: "string" },
          createdAt: date,
          updatedAt: date,
          startedAt: nullableDate,
          finishedAt: nullableDate,
        },
      },
    },
    indexes: [
      { keys: { organizationId: 1, createdAt: -1, _id: -1 } },
      { keys: { organizationId: 1, status: 1, createdAt: -1, _id: -1 } },
      {
        keys: { organizationId: 1, requestedByUserId: 1, idempotencyKey: 1 },
        options: { unique: true },
      },
      // Maintenance: operations stuck in queued or running.
      { keys: { status: 1, updatedAt: 1 } },
    ],
  },
  {
    name: Collections.bulkOperationItems,
    validator: {
      $jsonSchema: {
        bsonType: "object",
        required: [
          "organizationId",
          "operationId",
          "businessId",
          "outcome",
          "processedAt",
          "expiresAt",
        ],
        properties: {
          organizationId: orgId,
          operationId: { bsonType: "objectId" },
          businessId: { bsonType: "objectId" },
          outcome: { bsonType: "string" },
          message: nullableString,
          processedAt: date,
          expiresAt: date,
        },
      },
    },
    indexes: [
      // One result per business per operation: a retried chunk never records twice.
      { keys: { organizationId: 1, operationId: 1, businessId: 1 }, options: { unique: true } },
      { keys: { organizationId: 1, operationId: 1, outcome: 1, _id: 1 } },
      { keys: { organizationId: 1, operationId: 1, _id: 1 } },
      { keys: { expiresAt: 1 }, options: { expireAfterSeconds: 0 } },
    ],
  },
  {
    name: Collections.exportJobs,
    validator: {
      $jsonSchema: {
        bsonType: "object",
        required: [
          "organizationId",
          "kind",
          "status",
          "scope",
          "columns",
          "rowCap",
          "requestedByUserId",
          "createdAt",
          "updatedAt",
        ],
        properties: {
          organizationId: orgId,
          kind: { enum: ["directory", "list", "selection"] },
          status: { enum: ["queued", "running", "completed", "failed", "expired"] },
          scope: { enum: ["all", "assigned"] },
          columns: { bsonType: "array", minItems: 1 },
          rowCap: { bsonType: ["int", "long"], minimum: 1 },
          rowCount: { bsonType: ["int", "long", "null"], minimum: 0 },
          idempotencyKey: nullableString,
          requestedByUserId: { bsonType: "string" },
          file: {
            bsonType: ["object", "null"],
            properties: {
              key: { bsonType: "string" },
              bytes: { bsonType: ["int", "long"] },
              expiresAt: date,
              deletedAt: nullableDate,
            },
          },
          createdAt: date,
          updatedAt: date,
          startedAt: nullableDate,
          finishedAt: nullableDate,
        },
      },
    },
    indexes: [
      { keys: { organizationId: 1, createdAt: -1, _id: -1 } },
      { keys: { organizationId: 1, status: 1, createdAt: -1, _id: -1 } },
      { keys: { organizationId: 1, requestedByUserId: 1, createdAt: -1, _id: -1 } },
      // Usage rollup: completed exports per day.
      { keys: { organizationId: 1, finishedAt: -1 } },
      {
        keys: { organizationId: 1, requestedByUserId: 1, idempotencyKey: 1 },
        options: { unique: true, partialFilterExpression: { idempotencyKey: { $type: "string" } } },
      },
      // Maintenance: files past their retention, and stuck builds.
      {
        keys: { "file.expiresAt": 1 },
        options: { partialFilterExpression: { status: "completed" } },
      },
      { keys: { status: 1, updatedAt: 1 } },
    ],
    dropIndexes: ["organizationId_1_createdAt_-1"],
  },
  {
    // Stage 10: whole-organization data exports (owner only). Files expire like export files.
    name: Collections.organizationDataExports,
    validator: {
      $jsonSchema: {
        bsonType: "object",
        required: [
          "organizationId",
          "status",
          "requestedByUserId",
          "requestHash",
          "createdAt",
          "updatedAt",
        ],
        properties: {
          organizationId: orgId,
          status: { enum: ["queued", "running", "completed", "failed", "expired"] },
          active: { bsonType: "bool", description: "true while queued or running" },
          requestedByUserId: { bsonType: "string" },
          idempotencyKey: nullableString,
          requestHash: { bsonType: "string" },
          progress: {
            bsonType: "object",
            properties: {
              completedSections: { bsonType: ["int", "long"], minimum: 0 },
              totalSections: { bsonType: ["int", "long"], minimum: 0 },
              currentSection: nullableString,
            },
          },
          sections: {
            bsonType: "array",
            items: {
              bsonType: "object",
              required: ["key", "rows"],
              properties: {
                key: { bsonType: "string" },
                rows: { bsonType: ["int", "long"], minimum: 0 },
              },
            },
          },
          file: {
            bsonType: ["object", "null"],
            properties: {
              key: { bsonType: "string" },
              bytes: { bsonType: ["int", "long"] },
              expiresAt: date,
              deletedAt: nullableDate,
            },
          },
          createdAt: date,
          updatedAt: date,
          startedAt: nullableDate,
          finishedAt: nullableDate,
        },
      },
    },
    indexes: [
      { keys: { organizationId: 1, createdAt: -1, _id: -1 } },
      {
        keys: { organizationId: 1, requestedByUserId: 1, idempotencyKey: 1 },
        options: { unique: true, partialFilterExpression: { idempotencyKey: { $type: "string" } } },
      },
      // At most one export queued or running per organization (`active` is true exactly then).
      {
        keys: { organizationId: 1 },
        options: {
          name: "one_active_org_export",
          unique: true,
          partialFilterExpression: { active: true },
        },
      },
      // Maintenance: files past their retention, and stuck builds.
      {
        keys: { "file.expiresAt": 1 },
        options: { partialFilterExpression: { status: "completed" } },
      },
      { keys: { status: 1, updatedAt: 1 } },
    ],
  },
  {
    name: Collections.suppressionEntries,
    validator: {
      $jsonSchema: {
        bsonType: "object",
        required: ["kind", "value", "reason", "createdAt"],
        properties: {
          organizationId: { bsonType: ["string", "null"] },
          kind: { enum: ["domain", "phone", "email", "business"] },
          value: { bsonType: "string" },
          reason: { bsonType: "string", maxLength: 500 },
          sourceBusinessId: { bsonType: "objectId" },
          createdByUserId: nullableString,
          createdAt: date,
        },
      },
    },
    indexes: [
      { keys: { organizationId: 1, kind: 1, value: 1 }, options: { unique: true } },
      { keys: { organizationId: 1, sourceBusinessId: 1 }, options: { sparse: true } },
    ],
  },
  {
    name: Collections.sourceConfigs,
    validator: {
      $jsonSchema: {
        bsonType: "object",
        required: ["sourceKey", "enabled"],
        properties: {
          organizationId: { bsonType: ["string", "null"] },
          sourceKey: { bsonType: "string" },
          enabled: { bsonType: "bool" },
          updatedAt: date,
          updatedByUserId: { bsonType: ["string", "null"] },
        },
      },
    },
    indexes: [{ keys: { organizationId: 1, sourceKey: 1 }, options: { unique: true } }],
  },
  {
    // Platform-level reference data: no organizationId (see OverturePlaceRepository and DATABASE_DESIGN).
    name: Collections.overturePlaces,
    validator: {
      $jsonSchema: {
        bsonType: "object",
        required: [
          "_id",
          "release",
          "name",
          "nameKey",
          "categoryNodes",
          "confidence",
          "offerable",
          "contentHash",
          "updatedAt",
        ],
        properties: {
          _id: {
            bsonType: "string",
            pattern: "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$",
            description: "GERS id",
          },
          release: { bsonType: "string" },
          firstSeenRelease: { bsonType: "string" },
          retiredAt: nullableDate,
          retiredInRelease: nullableString,
          name: { bsonType: "string", minLength: 1, maxLength: 200 },
          nameKey: { bsonType: "string" },
          nameTokens: { bsonType: "array", maxItems: 50, items: { bsonType: "string" } },
          categoryNodes: { bsonType: "array", items: { bsonType: "string" } },
          confidence: { bsonType: "number", minimum: 0, maximum: 1 },
          operatingStatus: nullableString,
          closed: { bsonType: "bool" },
          offerable: { bsonType: "bool" },
          isCanonical: { bsonType: "bool" },
          canonicalId: { bsonType: "string" },
          licenses: {
            bsonType: "array",
            items: {
              enum: ["CDLA-Permissive-2.0", "Apache-2.0", "CC0-1.0", "ODbL-1.0", "CC-BY-4.0"],
            },
          },
          contentHash: { bsonType: "string" },
          location: {
            bsonType: ["object", "null"],
            properties: {
              type: { enum: ["Point"] },
              coordinates: { bsonType: "array", minItems: 2, maxItems: 2 },
            },
          },
          createdAt: date,
          updatedAt: date,
        },
      },
    },
    indexes: [
      // Discovery (sorted by confidence, then contact score, then id): state or LGA with category,
      // city, category alone, a circle, name words. Kept to what the queries use: every multikey
      // index on categoryNodes costs several keys per place on each insert.
      { keys: { "admin.stateKey": 1, categoryNodes: 1, confidence: -1 } },
      { keys: { "admin.lgaKey": 1, categoryNodes: 1, confidence: -1 } },
      { keys: { "address.localityKey": 1 } },
      { keys: { categoryNodes: 1, confidence: -1 } },
      { keys: { location: "2dsphere" } },
      { keys: { nameTokens: 1 } },
      // Sync: duplicate groups by upstream record.
      {
        keys: { upstreamKey: 1 },
        options: { partialFilterExpression: { upstreamKey: { $type: "string" } } },
      },
    ],
    dropIndexes: [
      "lastSeenRelease_1_retiredAt_1",
      "address.localityKey_1_categoryNodes_1_confidence_-1",
      "categoryNodes_1_confidence_-1_contacts.score_-1__id_1",
      "location_2dsphere_categoryNodes_1",
      "nameTokens_1_confidence_-1",
      "canonicalId_1",
      "retiredAt_1",
      "offerable_1_confidence_-1_contacts.score_-1__id_1",
    ],
  },
  {
    // Platform-level operational records for the Overture sync (no organizationId).
    name: Collections.overtureSyncRuns,
    validator: {
      $jsonSchema: {
        bsonType: "object",
        required: ["release", "status", "trigger", "startedAt"],
        properties: {
          release: { bsonType: "string" },
          status: {
            enum: ["running", "completed", "completed_with_warnings", "failed", "skipped"],
          },
          trigger: { enum: ["schedule", "manual", "test"] },
          error: nullableString,
          startedAt: date,
          heartbeatAt: nullableDate,
          finishedAt: nullableDate,
        },
      },
    },
    indexes: [
      { keys: { status: 1, finishedAt: -1 } },
      { keys: { release: 1, status: 1, finishedAt: -1 } },
      { keys: { startedAt: -1 } },
      // The sync lease: at most one run is `running` (see OvertureSyncRunRepository.acquire).
      {
        keys: { status: 1 },
        options: {
          name: "one_running_sync",
          unique: true,
          partialFilterExpression: { status: "running" },
        },
      },
    ],
  },
];
