import {
  DATA_LICENSES,
  DataLicenseId,
  type Observation,
  type ObservationLicensing,
  type VerificationEvent,
} from "@leadforge/contracts";
import type { ObservationDocument, VerificationEventDocument } from "./provenance.types.js";

/**
 * Values past their source's retention window are hidden at once, before the scheduled purge
 * redacts them in storage; `fieldKey` (an E.164 number, domain or address) is hidden with them.
 */
export function toObservationView(o: ObservationDocument, now: Date = new Date()): Observation {
  const hidden =
    Boolean(o.redactedAt) ||
    Boolean(o.policy && o.policy.retainValueUntil.getTime() <= now.getTime());
  const attribution = typeof o.metadata?.attribution === "string" ? o.metadata.attribution : null;
  return {
    id: o._id.toHexString(),
    businessId: o.businessId.toHexString(),
    source: o.source,
    sourceRef: o.sourceRef,
    field: o.field,
    fieldKey: hidden && o.policy ? null : o.fieldKey,
    rawValue: hidden ? null : o.rawValue,
    normalizedValue: hidden ? null : o.normalizedValue,
    collectedAt: o.collectedAt.toISOString(),
    collectionMethod: o.collectionMethod,
    verification: o.verification
      ? {
          method: o.verification.method,
          status: o.verification.status,
          checkedAt: o.verification.checkedAt.toISOString(),
          details: o.verification.details,
        }
      : null,
    confidence: o.confidence,
    importId: o.importId ? o.importId.toHexString() : null,
    actor: { type: o.actor.type, userId: o.actor.userId },
    note: o.note,
    action: o.action,
    redacted: hidden,
    sourceExternalId: o.sourceExternalId ?? null,
    discoveryJobId: o.discoveryJobId ? o.discoveryJobId.toHexString() : null,
    retainValueUntil: o.policy ? o.policy.retainValueUntil.toISOString() : null,
    attribution,
    enrichmentRunId: o.enrichmentRunId ? o.enrichmentRunId.toHexString() : null,
    evidence: evidenceOf(o.metadata),
    licensing: licensingOf(o.metadata),
  };
}

/** Open-data provenance stored on Overture observations (metadata.overture). */
function licensingOf(metadata: Record<string, unknown> | undefined): ObservationLicensing | null {
  const o = metadata?.overture as
    | { release?: unknown; upstream?: { dataset?: unknown; recordId?: unknown; license?: unknown } }
    | undefined;
  if (!o || typeof o !== "object") return null;
  const str = (v: unknown) => (typeof v === "string" ? v : null);
  const license = DataLicenseId.safeParse(o.upstream?.license);
  return {
    release: str(o.release),
    dataset: str(o.upstream?.dataset),
    recordId: str(o.upstream?.recordId),
    license: license.success ? license.data : null,
    licenseTextPath: license.success ? DATA_LICENSES[license.data].textPath : null,
  };
}

export function toVerificationEventView(e: VerificationEventDocument): VerificationEvent {
  return {
    id: e._id.toHexString(),
    businessId: e.businessId.toHexString(),
    field: e.field,
    fieldKey: e.fieldKey,
    method: e.method,
    result: e.result,
    details: e.details,
    actorType: e.actorType,
    actorId: e.actorId,
    occurredAt: e.occurredAt.toISOString(),
  };
}

function evidenceOf(
  metadata: Record<string, unknown> | undefined,
): { page: string; selector: string; snippet: string } | null {
  const e = metadata?.evidence as
    { page?: unknown; selector?: unknown; snippet?: unknown } | undefined;
  if (
    !e ||
    typeof e.page !== "string" ||
    typeof e.selector !== "string" ||
    typeof e.snippet !== "string"
  )
    return null;
  return { page: e.page, selector: e.selector, snippet: e.snippet };
}
