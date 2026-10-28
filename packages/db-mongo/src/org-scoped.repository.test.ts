import { describe, expect, it } from "vitest";
import { ObjectId } from "mongodb";
import { decodeCursor, encodeCursor, getPath } from "./org-scoped.repository.js";
import { collectionDefinitions } from "./schemas/index.js";

describe("cursor encoding", () => {
  it("round-trips a date sort value, id and sort tag", () => {
    const id = new ObjectId();
    const when = new Date("2026-10-24T12:00:00.000Z");
    const cursor = encodeCursor(when, id, "updatedAt:desc");
    const decoded = decodeCursor(cursor);
    expect(decoded).not.toBeNull();
    expect(decoded?.[1]).toBe(id.toHexString());
    expect(decoded?.[0]).toEqual({ $date: when.toISOString() });
    expect(decoded?.[2]).toBe("updatedAt:desc");
  });

  it("encodes null sort values", () => {
    const id = new ObjectId();
    expect(decodeCursor(encodeCursor(null, id, "lastVerifiedAt:desc"))?.[0]).toBeNull();
  });

  it("rejects garbage cursors instead of throwing", () => {
    expect(decodeCursor("not-base64!!")).toBeNull();
    expect(decodeCursor(Buffer.from("[1,2,3]").toString("base64url"))).toBeNull();
    expect(decodeCursor(Buffer.from('["x","nothex"]').toString("base64url"))).toBeNull();
  });

  it("rejects operator objects smuggled in as the sort value", () => {
    const id = new ObjectId().toHexString();
    const evil = Buffer.from(JSON.stringify([{ $ne: null }, id])).toString("base64url");
    expect(decodeCursor(evil)).toBeNull();
    const arr = Buffer.from(JSON.stringify([["a"], id])).toString("base64url");
    expect(decodeCursor(arr)).toBeNull();
  });
});

describe("getPath", () => {
  it("reads dotted paths and returns null for missing segments", () => {
    expect(getPath({ name: { normalized: "acme" } }, "name.normalized")).toBe("acme");
    expect(getPath({ name: null }, "name.normalized")).toBeNull();
    expect(getPath({}, "a.b.c")).toBeNull();
  });
});

describe("collection definitions", () => {
  it("starts every org-scoped index with organizationId", () => {
    // Exempt: per-user and append-only collections, and the platform-level Overture reference
    // catalogue and its sync runs, which hold no organization data (docs/DATABASE_DESIGN.md).
    const exempt = new Set([
      "notifications",
      "audit_events",
      "overture_places",
      "overture_sync_runs",
    ]);
    for (const def of collectionDefinitions) {
      if (exempt.has(def.name)) continue;
      for (const index of def.indexes) {
        const keys = Object.keys(index.keys as Record<string, unknown>);
        const isTtlOrGlobal =
          index.options?.expireAfterSeconds !== undefined ||
          keys[0] === "location.geo" ||
          keys[0] === "policy.retainValueUntil" ||
          (def.name === "businesses" && keys[0] === "retention.nextExpiryAt") ||
          (def.name === "discovery_jobs" &&
            (keys[0] === "status" || keys[0] === "credits.settledAt")) ||
          (def.name === "discovery_job_items" && keys[0] === "jobId") ||
          (def.name === "lead_list_items" && keys[0] === "listId") ||
          // Phase 4 maintenance queries (daily score refresh, analysis and run reconciliation).
          (def.name === "businesses" && keys[0] === "score.computedAt") ||
          (def.name === "website_analyses" &&
            (keys[0] === "status" || keys[0] === "credits.settledAt")) ||
          (def.name === "enrichment_runs" && keys[0] === "status") ||
          // Phase 5 maintenance: stuck bulk operations and exports, expired export files.
          (def.name === "bulk_operations" && keys[0] === "status") ||
          (def.name === "export_jobs" && (keys[0] === "status" || keys[0] === "file.expiresAt")) ||
          // Stage 10 maintenance: expired and stuck organization data exports.
          (def.name === "organization_data_exports" &&
            (keys[0] === "status" || keys[0] === "file.expiresAt"));
        if (isTtlOrGlobal) continue;
        expect(keys[0], `${def.name} ${JSON.stringify(index.keys)}`).toBe("organizationId");
      }
    }
  });

  it("keeps one active analysis and run per business, one default scoring profile and one record per candidate pair", () => {
    const find = (name: string) => collectionDefinitions.find((d) => d.name === name)!;
    const unique = (name: string) => find(name).indexes.filter((i) => i.options?.unique);
    expect(unique("website_analyses")).toEqual([
      expect.objectContaining({
        keys: { organizationId: 1, businessId: 1 },
        options: expect.objectContaining({ partialFilterExpression: { active: true } }),
      }),
    ]);
    expect(unique("enrichment_runs")[0]!.options?.partialFilterExpression).toEqual({
      active: true,
    });
    expect(unique("scoring_profiles").map((i) => i.keys)).toEqual([
      { organizationId: 1, name: 1 },
      { organizationId: 1, isDefault: 1 },
    ]);
    expect(unique("duplicate_candidates").map((i) => i.keys)).toEqual([
      { organizationId: 1, pairKey: 1 },
    ]);
    // The Phase 1 unique index on the pair array is dropped: it would allow a business in only one pair.
    expect(find("duplicate_candidates").dropIndexes).toContain("organizationId_1_businessIds_1");
  });

  it("defines the Phase 2 import collections", () => {
    const names = collectionDefinitions.map((d) => d.name);
    expect(names).toContain("import_jobs");
    expect(names).toContain("import_rows");
  });
});

describe("Overture staging collections", () => {
  it("are platform-level (no organizationId) with discovery and sync indexes", () => {
    const places = collectionDefinitions.find((d) => d.name === "overture_places")!;
    const runs = collectionDefinitions.find((d) => d.name === "overture_sync_runs")!;
    expect(places.validator.$jsonSchema.required).not.toContain("organizationId");
    expect(runs.validator.$jsonSchema.required).not.toContain("organizationId");
    const keys = places.indexes.map((i) =>
      Object.keys(i.keys as Record<string, unknown>).join(","),
    );
    expect(keys).toEqual(
      expect.arrayContaining([
        "admin.stateKey,categoryNodes,confidence",
        "admin.lgaKey,categoryNodes,confidence",
        "location",
        "upstreamKey",
      ]),
    );
  });

  it("accept overture_places in every source enum", () => {
    const find = (name: string) =>
      collectionDefinitions.find((d) => d.name === name)!.validator.$jsonSchema.properties;
    expect(find("source_observations").source.enum).toContain("overture_places");
    expect(find("source_observations").collectionMethod.enum).toContain("dataset_snapshot");
    expect(find("discovery_jobs").spec.properties.sources.items.enum).toContain("overture_places");
    expect(find("discovery_job_items").source.enum).toContain("overture_places");
    expect(find("businesses").categories.items.properties.taxonomy.enum).toContain("overture");
  });
});
