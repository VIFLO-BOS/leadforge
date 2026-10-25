import type { Db } from "mongodb";
import { collectionDefinitions, type CollectionDefinition } from "./schemas/index.js";

export interface SyncResult {
  created: string[];
  updated: string[];
  indexesEnsured: number;
}

/**
 * Idempotently creates collections, applies validators via collMod, and ensures indexes.
 * Safe to run on every deploy.
 */
export async function syncCollections(
  db: Db,
  definitions: CollectionDefinition[] = collectionDefinitions,
): Promise<SyncResult> {
  const existing = new Set(
    (await db.listCollections({}, { nameOnly: true }).toArray()).map((c) => c.name),
  );
  const result: SyncResult = { created: [], updated: [], indexesEnsured: 0 };

  for (const def of definitions) {
    if (!existing.has(def.name)) {
      await db.createCollection(def.name, {
        validator: def.validator,
        validationLevel: "moderate",
        validationAction: "error",
      });
      result.created.push(def.name);
    } else {
      await db.command({
        collMod: def.name,
        validator: def.validator,
        validationLevel: "moderate",
        validationAction: "error",
      });
      result.updated.push(def.name);
    }

    const collection = db.collection(def.name);
    for (const index of def.indexes) {
      await collection.createIndex(index.keys, index.options ?? {});
      result.indexesEnsured += 1;
    }
  }

  return result;
}
