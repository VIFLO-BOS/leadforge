import { createHash } from "node:crypto";
import { ObjectId } from "@leadforge/db-mongo";
import type { CollectionMethod, ObservationField, SourceKey } from "@leadforge/contracts";

/** Immutable provenance record: one observed value of one field from one source. */
export interface ObservationDocument {
  _id: ObjectId;
  organizationId: string;
  businessId: ObjectId;
  source: SourceKey;
  sourceRef: string | null;
  sourceExternalId: string | null;
  field: ObservationField;
  /** E.164, email address, domain or category key for multi-valued fields. */
  fieldKey: string | null;
  rawValue: string | null;
  normalizedValue: string | Record<string, unknown> | string[] | null;
  collectedAt: Date;
  collectionMethod: CollectionMethod;
  verification: {
    method: string;
    status: "verified" | "unverified" | "failed";
    checkedAt: Date;
    details: string | null;
  } | null;
  confidence: number;
  /** Present only for imported observations (sparse index). */
  importId?: ObjectId;
  /** Present only for observations collected by a discovery job (sparse index). */
  discoveryJobId?: ObjectId;
  /** Present only for observations collected by an enrichment run (sparse index). */
  enrichmentRunId?: ObjectId;
  actor: { type: "user" | "system"; userId: string | null };
  note: string | null;
  action: "set" | "remove";
  policy: { retainValueUntil: Date } | null;
  redactedAt: Date | null;
  metadata: Record<string, unknown>;
}

export interface VerificationEventDocument {
  _id: ObjectId;
  organizationId: string;
  businessId: ObjectId;
  field: ObservationField;
  fieldKey: string | null;
  method: string;
  result: "passed" | "failed" | "inconclusive";
  details: string | null;
  actorType: "system" | "user";
  actorId: string | null;
  occurredAt: Date;
}

/**
 * Deterministic ObjectId for idempotent reprocessing: the first 4 bytes carry the given
 * time (so ids still sort roughly by creation), the last 8 bytes a hash of the seed.
 */
export function deterministicObjectId(seed: string, at: Date): ObjectId {
  const buf = Buffer.alloc(12);
  buf.writeUInt32BE(Math.floor(at.getTime() / 1000) >>> 0, 0);
  createHash("sha256").update(seed).digest().copy(buf, 4, 0, 8);
  return new ObjectId(buf);
}
