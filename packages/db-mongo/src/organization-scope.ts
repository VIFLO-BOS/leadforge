import type { Document } from "mongodb";
import { Collections, type CollectionName } from "./collections.js";
import { collectionDefinitions, type CollectionDefinition } from "./schemas/index.js";

/**
 * Organization-scoped collections the organization purge keeps, with the reason. Everything else
 * that carries `organizationId` is deleted for the purged organization (Stage 10,
 * docs/DATABASE_DESIGN.md "Organization deletion").
 */
export const ORGANIZATION_PURGE_RETAINED: Readonly<Partial<Record<CollectionName, string>>> = {
  [Collections.auditEvents]:
    "security audit log (who did what, when): kept for its 2-year retention after an organization is deleted, like billing records",
};

/** True when the collection's validator declares an `organizationId` property. */
export function hasOrganizationIdField(
  definition: Pick<CollectionDefinition, "validator">,
): boolean {
  const schema = (definition.validator as { $jsonSchema?: { properties?: Document } }).$jsonSchema;
  return Boolean(
    schema?.properties && Object.prototype.hasOwnProperty.call(schema.properties, "organizationId"),
  );
}

/** Every collection whose documents can belong to an organization, derived from the schema registry. */
export function organizationScopedCollections(
  definitions: readonly CollectionDefinition[] = collectionDefinitions,
): string[] {
  return definitions.filter(hasOrganizationIdField).map((d) => d.name);
}

/** Platform-level collections without `organizationId` (the Overture catalogue and its sync runs). */
export function globalCollections(
  definitions: readonly CollectionDefinition[] = collectionDefinitions,
): string[] {
  return definitions.filter((d) => !hasOrganizationIdField(d)).map((d) => d.name);
}

export interface OrganizationPurgePlan {
  /** Collections the purge empties of the organization's documents (`{ organizationId }` only). */
  delete: string[];
  /** Organization-scoped collections the purge keeps, with the reason. */
  retain: Array<{ collection: string; reason: string }>;
  /** Collections the purge never touches: no document there belongs to an organization. */
  global: string[];
}

/**
 * The purge plan, derived from the registry rather than a hand-written list: a new collection with
 * an `organizationId` field is purged automatically unless it is listed in
 * ORGANIZATION_PURGE_RETAINED. Collections whose `organizationId` may be null (global suppression
 * entries, platform source switches) only lose the organization's own documents: the purge filters
 * on the exact id, never on null.
 */
export function organizationPurgePlan(
  definitions: readonly CollectionDefinition[] = collectionDefinitions,
): OrganizationPurgePlan {
  const scoped = organizationScopedCollections(definitions);
  const retained = ORGANIZATION_PURGE_RETAINED as Record<string, string>;
  return {
    delete: scoped.filter((name) => !(name in retained)),
    retain: scoped
      .filter((name) => name in retained)
      .map((name) => ({ collection: name, reason: retained[name]! })),
    global: globalCollections(definitions),
  };
}
