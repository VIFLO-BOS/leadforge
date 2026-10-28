import { describe, expect, it } from "vitest";
import { Collections } from "./collections.js";
import { collectionDefinitions } from "./schemas/index.js";
import {
  hasOrganizationIdField,
  ORGANIZATION_PURGE_RETAINED,
  organizationPurgePlan,
} from "./organization-scope.js";

describe("organization purge plan (Stage 10)", () => {
  const plan = organizationPurgePlan();

  it("covers every collection whose validator has an organizationId field", () => {
    const scoped = collectionDefinitions
      .filter(hasOrganizationIdField)
      .map((d) => d.name)
      .sort();
    const covered = [...plan.delete, ...plan.retain.map((r) => r.collection)].sort();
    expect(covered).toEqual(scoped);
    // Every registered collection is either organization-scoped or global, never both or neither.
    expect([...covered, ...plan.global].sort()).toEqual(
      collectionDefinitions.map((d) => d.name).sort(),
    );
  });

  it("never touches the platform catalogue (Overture places and sync runs)", () => {
    expect(plan.global).toEqual(
      expect.arrayContaining([Collections.overturePlaces, Collections.overtureSyncRuns]),
    );
    expect(plan.delete).not.toContain(Collections.overturePlaces);
    expect(plan.delete).not.toContain(Collections.overtureSyncRuns);
  });

  it("keeps only the audit log, and every retained collection names a reason", () => {
    expect(plan.retain.map((r) => r.collection)).toEqual([Collections.auditEvents]);
    for (const r of plan.retain) expect(r.reason.length).toBeGreaterThan(20);
    for (const name of Object.keys(ORGANIZATION_PURGE_RETAINED))
      expect(collectionDefinitions.some((d) => d.name === name)).toBe(true);
  });

  it("deletes the organization's businesses, CRM, jobs, exports and notifications", () => {
    for (const name of [
      Collections.businesses,
      Collections.sourceObservations,
      Collections.mergeHistory,
      Collections.leads,
      Collections.notifications,
      Collections.exportJobs,
      Collections.organizationDataExports,
      Collections.suppressionEntries,
      Collections.sourceConfigs,
    ]) {
      expect(plan.delete).toContain(name);
    }
  });

  it("picks up a new organization-scoped collection without a hand-written list", () => {
    const extra = organizationPurgePlan([
      ...collectionDefinitions,
      {
        name: "future_things",
        validator: { $jsonSchema: { properties: { organizationId: { bsonType: "string" } } } },
        indexes: [],
      },
      {
        name: "future_reference",
        validator: { $jsonSchema: { properties: { code: { bsonType: "string" } } } },
        indexes: [],
      },
    ]);
    expect(extra.delete).toContain("future_things");
    expect(extra.global).toContain("future_reference");
  });
});
