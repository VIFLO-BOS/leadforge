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
}

const orgId = { bsonType: "string", description: "PostgreSQL organization UUID" };
const date = { bsonType: "date" };

/**
 * Release 1 collections with JSON Schema validators and indexes. Applied idempotently by
 * the sync script. Validators are intentionally permissive about optional fields and strict
 * about identifiers and timestamps.
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
          createdAt: date,
        },
      },
    },
    indexes: [
      { keys: { userId: 1, readAt: 1, createdAt: -1 } },
      { keys: { createdAt: 1 }, options: { expireAfterSeconds: 60 * 60 * 24 * 90 } },
    ],
  },
  {
    name: Collections.businesses,
    validator: {
      $jsonSchema: {
        bsonType: "object",
        required: ["organizationId", "name", "slug", "createdAt", "updatedAt"],
        properties: {
          organizationId: orgId,
          name: {
            bsonType: "object",
            required: ["value", "normalized"],
            properties: { value: { bsonType: "string" }, normalized: { bsonType: "string" } },
          },
          slug: { bsonType: "string" },
          createdAt: date,
          updatedAt: date,
          deletedAt: { bsonType: ["date", "null"] },
        },
      },
    },
    indexes: [
      { keys: { organizationId: 1, slug: 1 }, options: { unique: true } },
      {
        keys: { organizationId: 1, "website.domain": 1 },
        options: { partialFilterExpression: { "website.domain": { $exists: true } } },
      },
      { keys: { organizationId: 1, "phones.e164": 1 } },
      { keys: { organizationId: 1, "emails.address": 1 } },
      { keys: { organizationId: 1, "categories.value": 1, "location.locality": 1 } },
      { keys: { organizationId: 1, "score.fit": -1, _id: -1 } },
      { keys: { organizationId: 1, updatedAt: -1, _id: -1 } },
      { keys: { organizationId: 1, "externalRefs.source": 1, "externalRefs.externalId": 1 } },
      { keys: { "location.geo": "2dsphere" }, options: { sparse: true } },
      {
        keys: { "name.normalized": "text", "website.domain": "text", "location.formatted": "text" },
        options: { name: "business_text", default_language: "english" },
      },
    ],
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
        ],
        properties: {
          organizationId: orgId,
          businessId: { bsonType: "objectId" },
          source: { bsonType: "string" },
          field: { bsonType: "string" },
          collectedAt: date,
          collectionMethod: { enum: ["api", "website_fetch", "user_import", "user_edit"] },
        },
      },
    },
    indexes: [
      { keys: { organizationId: 1, businessId: 1, field: 1, collectedAt: -1 } },
      { keys: { organizationId: 1, source: 1, collectedAt: -1 } },
      { keys: { organizationId: 1, discoveryJobId: 1 }, options: { sparse: true } },
      { keys: { "policy.retainValueUntil": 1 }, options: { sparse: true } },
    ],
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
          occurredAt: date,
        },
      },
    },
    indexes: [{ keys: { organizationId: 1, businessId: 1, occurredAt: -1 } }],
  },
  {
    name: Collections.discoveryJobs,
    validator: {
      $jsonSchema: {
        bsonType: "object",
        required: ["organizationId", "name", "status", "spec", "createdAt"],
        properties: {
          organizationId: orgId,
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
          createdAt: date,
        },
      },
    },
    indexes: [
      { keys: { organizationId: 1, createdAt: -1 } },
      { keys: { organizationId: 1, status: 1, createdAt: -1 } },
      { keys: { status: 1, finishedAt: 1 } },
      { keys: { "credits.settledAt": 1, status: 1 } },
    ],
  },
  {
    name: Collections.discoveryJobItems,
    validator: {
      $jsonSchema: {
        bsonType: "object",
        required: ["organizationId", "jobId", "source", "externalId", "outcome"],
        properties: {
          organizationId: orgId,
          jobId: { bsonType: "objectId" },
          outcome: { enum: ["created", "updated", "duplicate", "skipped", "failed"] },
        },
      },
    },
    indexes: [
      { keys: { jobId: 1, source: 1, externalId: 1 }, options: { unique: true } },
      { keys: { organizationId: 1, jobId: 1, outcome: 1 } },
    ],
  },
  {
    name: Collections.enrichmentRuns,
    validator: {
      $jsonSchema: {
        bsonType: "object",
        required: ["organizationId", "businessId", "kind", "status", "startedAt"],
        properties: {
          organizationId: orgId,
          businessId: { bsonType: "objectId" },
          startedAt: date,
        },
      },
    },
    indexes: [{ keys: { organizationId: 1, businessId: 1, startedAt: -1 } }],
  },
  {
    name: Collections.websiteAnalyses,
    validator: {
      $jsonSchema: {
        bsonType: "object",
        required: ["organizationId", "businessId", "url", "status", "createdAt"],
        properties: {
          organizationId: orgId,
          businessId: { bsonType: "objectId" },
          status: { enum: ["queued", "running", "completed", "failed"] },
          createdAt: date,
        },
      },
    },
    indexes: [
      { keys: { organizationId: 1, businessId: 1, analyzedAt: -1 } },
      { keys: { organizationId: 1, status: 1 } },
      { keys: { organizationId: 1, "opportunities.key": 1 } },
    ],
  },
  {
    name: Collections.scoringProfiles,
    validator: {
      $jsonSchema: {
        bsonType: "object",
        required: ["organizationId", "name", "weights", "createdAt"],
        properties: { organizationId: orgId, name: { bsonType: "string" }, createdAt: date },
      },
    },
    indexes: [{ keys: { organizationId: 1, name: 1 }, options: { unique: true } }],
  },
  {
    name: Collections.duplicateCandidates,
    validator: {
      $jsonSchema: {
        bsonType: "object",
        required: ["organizationId", "businessIds", "stage", "score", "status", "createdAt"],
        properties: {
          organizationId: orgId,
          businessIds: {
            bsonType: "array",
            minItems: 2,
            maxItems: 2,
            items: { bsonType: "objectId" },
          },
          status: { enum: ["pending", "merged", "dismissed"] },
          createdAt: date,
        },
      },
    },
    indexes: [
      { keys: { organizationId: 1, businessIds: 1 }, options: { unique: true } },
      { keys: { organizationId: 1, status: 1, score: -1 } },
    ],
  },
  {
    name: Collections.mergeHistory,
    validator: {
      $jsonSchema: {
        bsonType: "object",
        required: ["organizationId", "survivorId", "mergedIds", "snapshotBefore", "performedAt"],
        properties: {
          organizationId: orgId,
          survivorId: { bsonType: "objectId" },
          performedAt: date,
        },
      },
    },
    indexes: [
      { keys: { organizationId: 1, survivorId: 1 } },
      { keys: { organizationId: 1, mergedIds: 1 } },
    ],
  },
  {
    name: Collections.leadLists,
    validator: {
      $jsonSchema: {
        bsonType: "object",
        required: ["organizationId", "name", "createdAt"],
        properties: { organizationId: orgId, name: { bsonType: "string" }, createdAt: date },
      },
    },
    indexes: [{ keys: { organizationId: 1, name: 1 }, options: { unique: true } }],
  },
  {
    name: Collections.leadListItems,
    validator: {
      $jsonSchema: {
        bsonType: "object",
        required: ["organizationId", "listId", "businessId", "addedAt"],
        properties: {
          organizationId: orgId,
          listId: { bsonType: "objectId" },
          businessId: { bsonType: "objectId" },
        },
      },
    },
    indexes: [
      { keys: { listId: 1, businessId: 1 }, options: { unique: true } },
      { keys: { organizationId: 1, businessId: 1 } },
    ],
  },
  {
    name: Collections.leads,
    validator: {
      $jsonSchema: {
        bsonType: "object",
        required: ["organizationId", "businessId", "stageKey", "createdAt"],
        properties: {
          organizationId: orgId,
          businessId: { bsonType: "objectId" },
          stageKey: { bsonType: "string" },
        },
      },
    },
    indexes: [
      { keys: { organizationId: 1, businessId: 1 }, options: { unique: true } },
      { keys: { organizationId: 1, stageKey: 1, updatedAt: -1 } },
      { keys: { organizationId: 1, ownerUserId: 1, nextActionAt: 1 } },
    ],
  },
  {
    name: Collections.pipelineConfigs,
    validator: {
      $jsonSchema: {
        bsonType: "object",
        required: ["organizationId", "stages"],
        properties: { organizationId: orgId, stages: { bsonType: "array" } },
      },
    },
    indexes: [{ keys: { organizationId: 1 }, options: { unique: true } }],
  },
  {
    name: Collections.leadActivities,
    validator: {
      $jsonSchema: {
        bsonType: "object",
        required: ["organizationId", "businessId", "type", "occurredAt", "createdByUserId"],
        properties: {
          organizationId: orgId,
          businessId: { bsonType: "objectId" },
          type: {
            enum: ["note", "call", "whatsapp", "email", "meeting", "stage_change", "assignment"],
          },
          occurredAt: date,
        },
      },
    },
    indexes: [
      { keys: { organizationId: 1, businessId: 1, occurredAt: -1 } },
      { keys: { organizationId: 1, createdByUserId: 1, occurredAt: -1 } },
    ],
  },
  {
    name: Collections.exportJobs,
    validator: {
      $jsonSchema: {
        bsonType: "object",
        required: ["organizationId", "kind", "status", "createdAt"],
        properties: {
          organizationId: orgId,
          kind: { enum: ["businesses", "list", "pipeline"] },
          createdAt: date,
        },
      },
    },
    indexes: [{ keys: { organizationId: 1, createdAt: -1 } }],
  },
  {
    name: Collections.suppressionEntries,
    validator: {
      $jsonSchema: {
        bsonType: "object",
        required: ["kind", "value", "createdAt"],
        properties: {
          organizationId: { bsonType: ["string", "null"] },
          kind: { enum: ["domain", "phone", "email", "business"] },
          value: { bsonType: "string" },
          createdAt: date,
        },
      },
    },
    indexes: [{ keys: { organizationId: 1, kind: 1, value: 1 }, options: { unique: true } }],
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
        },
      },
    },
    indexes: [{ keys: { organizationId: 1, sourceKey: 1 }, options: { unique: true } }],
  },
];
